import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError, DATA, guestPath } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { Machines } from './machines.ts';
import type { Project, Workspaces } from './workspaces.ts';
import { quote } from './files.ts';
import { guestTask } from './guest-task.ts';
import { redactProjectOutput } from './project-execution.ts';
import { projectIdSchema } from './project-catalog.ts';
import {
  ensureProjectNetworkScript,
  projectNetworkCheckScript,
  projectNetworkNamespace,
} from './project-network-isolation.ts';
import {
  meshConfigPath,
  meshLogPath,
  meshProjectCommand,
  meshRuntimeCommand,
  meshSession,
  meshStartScript,
  meshStopCommand,
} from './service-mesh-guest.ts';

const policySchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    listenPort: z.number().int().min(1024).max(65535),
    upstreamPort: z.number().int().min(1024).max(65535),
  })
  .strict();
export const serviceMeshPolicy = policySchema.refine(
  (value) => value.listenPort !== value.upstreamPort,
  '监听端口与上游端口不能相同',
);
export const serviceMeshInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('status') }).strict(),
  z.object({ mode: z.literal('save'), policy: serviceMeshPolicy }).strict(),
  z.object({ mode: z.literal('remove') }).strict(),
  z.object({ mode: z.literal('start') }).strict(),
  z.object({ mode: z.literal('stop') }).strict(),
]);
type Policy = z.infer<typeof serviceMeshPolicy> & { updatedAt: string };
const storeSchema = z
  .object({
    version: z.literal(1),
    policies: z.record(
      z.string(),
      z.record(
        projectIdSchema,
        policySchema
          .extend({
            updatedAt: z.iso.datetime(),
          })
          .refine((value) => value.listenPort !== value.upstreamPort),
      ),
    ),
  })
  .strict();
type Store = z.infer<typeof storeSchema>;
const defaults = (): Store => ({ version: 1, policies: {} });

/** A fixed loopback TCP Envoy configuration; no arbitrary bootstrap or admin listener. */
export function envoySidecarConfig(policy: z.infer<typeof serviceMeshPolicy>) {
  return {
    static_resources: {
      listeners: [
        {
          name: 'sakura_mesh_listener',
          address: { socket_address: { address: '127.0.0.1', port_value: policy.listenPort } },
          filter_chains: [
            {
              filters: [
                {
                  name: 'envoy.filters.network.tcp_proxy',
                  typed_config: {
                    '@type': 'type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy',
                    stat_prefix: 'sakura_mesh',
                    cluster: 'sakura_mesh_upstream',
                  },
                },
              ],
            },
          ],
        },
      ],
      clusters: [
        {
          name: 'sakura_mesh_upstream',
          connect_timeout: '1s',
          type: 'STATIC',
          load_assignment: {
            cluster_name: 'sakura_mesh_upstream',
            endpoints: [
              {
                lb_endpoints: [
                  {
                    endpoint: {
                      address: {
                        socket_address: {
                          address: '127.0.0.1',
                          port_value: policy.upstreamPort,
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  };
}

export class ServiceMesh {
  private store: Store = defaults();
  private writes = Promise.resolve();
  private closed = false;
  private controller = new AbortController();
  private unguard: () => void;
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private file = join(DATA, 'service-mesh.json'),
    private canStart: (id: string) => Promise<boolean> = async () => true,
  ) {
    this.unguard = workspaces.beforeConfigChange(async (id, previous, next) => {
      const projectId = previous._workspace || 'default';
      const policy = this.store.policies[id]?.[projectId];
      if (
        previous.directory !== next.directory ||
        (previous.networkIsolation || 'host') !== (next.networkIsolation || 'host')
      ) {
        if (this.machines.state(id) === 'running') {
          const guest = await this.guestStatus(id, previous, policy || null);
          if (guest.sidecarRunning || (!guest.pythonInstalled && (policy || guest.configPresent)))
            throw new AppError('请先停止此项目的服务网格边车，再修改目录或网络模式', 409);
        }
      }
      if (policy) await this.assertPortAvailable(id, projectId, policy.listenPort, next);
    });
  }

  async init() {
    this.store = storeSchema.parse(await readStore(this.file, defaults));
  }
  private project(id: string) {
    this.machines.get(id);
    const projectId = this.workspaces.projects.current(id);
    return projectIdSchema.parse(projectId);
  }
  private async save(next: Store) {
    await writeStore(this.file, next);
    this.store = next;
  }
  private serial<T>(work: () => Promise<T>) {
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('服务网格正在关闭', 503);
        return work();
      });
    this.writes = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private async assertPortAvailable(id: string, projectId: string, port: number, project: Project) {
    if (project.networkIsolation === 'private') return;
    for (const [otherProject, policy] of Object.entries(this.store.policies[id] || {})) {
      if (otherProject === projectId || policy.listenPort !== port) continue;
      const other = await this.workspaces.projects.with(id, otherProject, () => this.workspaces.config(id));
      if (other.networkIsolation !== 'private')
        throw new AppError('此监听端口已由同一实例的其他共享网络项目边车使用', 409);
    }
  }
  private async guestStatus(id: string, project: Project, policy: Policy | null, signal?: AbortSignal) {
    const tools = { envoy: '', tmux: '', python: '' };
    if (this.machines.state(id) !== 'running')
      return {
        guestRunning: false,
        envoyInstalled: false,
        tmuxInstalled: false,
        pythonInstalled: false,
        sidecarRunning: false,
        bindingValid: null as boolean | null,
        bindingError: null as string | null,
        runId: null as string | null,
        processes: [] as number[],
        configPresent: false,
        directoryPresent: false,
        namespacePresent: false,
        version: null as string | null,
        tools,
      };
    const projectId = project._workspace || 'default';
    const namespace = projectNetworkNamespace(project);
    const script = `set +e
printf 'ENVOY='; command -v envoy || true
printf 'TMUX='; command -v tmux || true
printf 'PYTHON='; command -v python3 || true
printf 'CONFIG='; test -f ${quote(meshConfigPath(projectId))} && echo yes || echo no
printf 'DIRECTORY='; test -d ${quote(project.directory)} && echo yes || echo no
printf 'NAMESPACE='; ${namespace ? `ip netns exec ${namespace} true >/dev/null 2>&1 && echo yes || echo no` : 'echo yes'}
printf 'RUNNING='; tmux has-session -t =${meshSession(projectId)} 2>/dev/null && echo yes || echo no
`;
    const result = await this.machines.exec(id, script, 15_000, signal);
    if (result.code !== 0) throw new AppError(result.stderr || '边车状态检查失败', 409);
    const lines = result.stdout.split(/\r?\n/);
    for (const [key, prefix] of [
      ['envoy', 'ENVOY='],
      ['tmux', 'TMUX='],
      ['python', 'PYTHON='],
    ] as const) {
      const value = lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) || '';
      if (value) guestPath(value);
      tools[key] = value;
    }
    let runtime = {
      sidecarRunning: lines.includes('RUNNING=yes'),
      bindingValid: null as boolean | null,
      bindingError: null as string | null,
      runId: null as string | null,
      processes: [] as number[],
    };
    if (tools.python) {
      const checked = await this.machines.exec(
        id,
        meshRuntimeCommand(
          project,
          policy,
          policy ? JSON.stringify(envoySidecarConfig(policy)) : null,
          tools,
        ),
        15_000,
        signal,
      );
      if (checked.code !== 0) throw new AppError('无法核对边车进程，请检查客户机 Python 3 与 tmux', 409);
      runtime = z
        .object({
          sidecarRunning: z.boolean(),
          bindingValid: z.boolean().nullable(),
          bindingError: z.string().max(1000).nullable(),
          runId: z.uuid().nullable(),
          processes: z.array(z.number().int().min(2)),
        })
        .strict()
        .parse(JSON.parse(checked.stdout));
    } else if (runtime.sidecarRunning) {
      runtime.bindingValid = false;
      runtime.bindingError = '客户机缺少 Python 3，无法核对边车的实际进程，请先安装后停止旧边车';
    }
    return {
      guestRunning: true,
      envoyInstalled: !!tools.envoy,
      tmuxInstalled: !!tools.tmux,
      pythonInstalled: !!tools.python,
      ...runtime,
      configPresent: lines.includes('CONFIG=yes'),
      directoryPresent: lines.includes('DIRECTORY=yes'),
      namespacePresent: lines.includes('NAMESPACE=yes'),
      version: null as string | null,
      tools,
    };
  }
  async status(id: string, signal?: AbortSignal) {
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    abort.throwIfAborted();
    const projectId = this.project(id);
    const policy = this.store.policies[id]?.[projectId] || null;
    const project = await this.workspaces.config(id);
    const { tools, ...guest } = await this.guestStatus(id, project, policy, abort);
    let envoyUsable: boolean | null = null;
    if (
      guest.guestRunning &&
      tools.envoy &&
      guest.directoryPresent &&
      guest.namespacePresent &&
      (!guest.sidecarRunning || guest.bindingValid)
    ) {
      const version = await guestTask(
        this.machines,
        id,
        meshProjectCommand(project, `exec ${quote(tools.envoy)} --version`),
        abort,
        undefined,
        10_000,
      );
      envoyUsable = version.code === 0;
      if (envoyUsable)
        guest.version = redactProjectOutput(project, version).stdout.trim().slice(0, 200) || null;
    }
    const guestPaused = this.machines.state(id) === 'paused';
    abort.throwIfAborted();
    return {
      projectId,
      policy,
      ...guest,
      envoyUsable,
      directory: project.directory,
      networkIsolation: project.networkIsolation || 'host',
      sidecarStateKnown: guest.guestRunning || !guestPaused,
      ready: Boolean(
        policy &&
        guest.guestRunning &&
        guest.envoyInstalled &&
        guest.tmuxInstalled &&
        guest.pythonInstalled &&
        envoyUsable !== false &&
        (!guest.sidecarRunning || guest.bindingValid),
      ),
      executed: false,
      ...(guest.bindingError
        ? { reason: guest.bindingError }
        : !policy
          ? { reason: '请先保存此项目的边车策略。' }
          : guestPaused
            ? { reason: '请先恢复 Linux 实例并检查边车状态。' }
            : !guest.guestRunning
              ? { reason: '请先启动 Linux 实例。' }
              : !guest.envoyInstalled
                ? { reason: '客户机尚未安装 Envoy。' }
                : !guest.tmuxInstalled
                  ? { reason: '客户机尚未安装 tmux。' }
                  : !guest.pythonInstalled
                    ? { reason: '客户机尚未安装 Python 3，无法核对和停止边车进程。' }
                    : envoyUsable === false
                      ? { reason: '项目中的 Envoy 版本检查失败，请检查网络和客户机二进制兼容性。' }
                      : {}),
    };
  }
  async assertNoRunning(id: string) {
    if (this.machines.state(id) === 'paused')
      throw new AppError('请先恢复实例并停止所有项目的服务网格边车', 409);
    if (this.machines.state(id) !== 'running') return;
    const index = await this.workspaces.projects.list(id);
    const projects = new Set([
      ...index.projects.map((project) => project.id),
      ...Object.keys(this.store.policies[id] || {}),
    ]);
    for (const projectId of projects) {
      const policy = this.store.policies[id]?.[projectId] || null;
      const project = await this.workspaces.projects.inScope(id, projectId, () => this.workspaces.config(id));
      const guest = await this.guestStatus(id, project, policy);
      if (guest.sidecarRunning || (!guest.pythonInstalled && (policy || guest.configPresent)))
        throw new AppError('请先停止所有项目的服务网格边车', 409);
    }
  }
  /** Settings and sidecar mutations share a lock, including the final enabled check. */
  configure<T>(id: string, enabled: boolean, save: () => Promise<T>) {
    return this.serial(() =>
      this.machines.locked(id, async () => {
        if (!enabled) await this.assertNoRunning(id);
        return save();
      }),
    );
  }

  async action(id: string, raw: unknown, action: 'check' | 'run', signal?: AbortSignal) {
    const input = serviceMeshInput.parse(raw);
    const projectId = this.project(id);
    if (action === 'check') {
      if (input.mode === 'save')
        await this.assertPortAvailable(
          id,
          projectId,
          input.policy.listenPort,
          await this.workspaces.config(id),
        );
      const current = await this.status(id, signal);
      return input.mode === 'save'
        ? {
            ...current,
            preview: input.policy,
            config: envoySidecarConfig(input.policy),
            ready: current.sidecarStateKnown && !current.sidecarRunning,
            message: '策略可保存；启动前还会由客户机 Envoy 验证配置。',
          }
        : current;
    }
    if (input.mode === 'status') return this.status(id, signal);
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    return this.serial(() =>
      this.workspaces.projects.inScope(id, projectId, () =>
        this.machines.locked(id, async () => {
          abort.throwIfAborted();
          const current = this.store.policies[id]?.[projectId] || null;
          const project = await this.workspaces.config(id);
          if (input.mode === 'save' || input.mode === 'remove') {
            if (this.machines.state(id) === 'paused')
              throw new AppError('请先恢复实例并停止此项目的边车', 409);
            const guest = await this.guestStatus(id, project, current, abort);
            if (guest.sidecarRunning) throw new AppError('请先停止当前项目的边车', 409);
            if (current && guest.guestRunning && !guest.pythonInstalled)
              throw new AppError('请先安装 Python 3 核对当前边车进程', 409);
            const next = structuredClone(this.store);
            if (input.mode === 'save') {
              await this.assertPortAvailable(id, projectId, input.policy.listenPort, project);
              (next.policies[id] ||= {})[projectId] = {
                ...input.policy,
                updatedAt: new Date().toISOString(),
              };
            } else {
              if (!current) throw new AppError('此项目尚无边车策略', 404);
              delete next.policies[id][projectId];
            }
            await this.save(next);
            if (input.mode === 'remove' && guest.guestRunning) {
              const cleanup = await this.machines.exec(
                id,
                `rm -f ${quote(meshConfigPath(projectId))}`,
                15_000,
                abort,
              );
              if (cleanup.code !== 0) throw new AppError('策略已移除，但客户机配置文件清理失败', 409);
            }
            return {
              ...(await this.status(id, abort)),
              ready: true,
              executed: true,
              message: input.mode === 'save' ? '项目边车策略已保存。' : '项目边车策略已移除。',
            };
          }
          if (this.machines.state(id) !== 'running') throw new AppError('请先启动 Linux 实例', 409);
          const guest = await this.guestStatus(id, project, current, abort);
          if (input.mode === 'stop') {
            if (!guest.sidecarRunning)
              return {
                ...(await this.status(id, abort)),
                ready: true,
                executed: false,
                message: '边车已停止。',
              };
            if (!guest.pythonInstalled) throw new AppError('请先安装 Python 3，以便核对并停止边车进程', 409);
            const result = await this.machines.exec(id, meshStopCommand(project, guest.tools), 15_000, abort);
            if (result.code !== 0) throw new AppError(result.stderr || '停止边车失败', 409);
            const status = await this.status(id, abort);
            if (status.sidecarRunning) throw new AppError('边车进程仍在运行，项目绑定不可修改', 409);
            return { ...status, ready: true, executed: true, message: '边车已停止。' };
          }
          if (!(await this.canStart(id))) throw new AppError('此能力已禁用', 409);
          if (!current) throw new AppError('请先保存此项目的边车策略', 409);
          if (!guest.envoyInstalled || !guest.tmuxInstalled || !guest.pythonInstalled)
            throw new AppError('客户机需要已安装的 Envoy、tmux 和 Python 3', 409);
          if (guest.sidecarRunning) throw new AppError('此项目边车已经运行，请先停止', 409);
          await this.assertPortAvailable(id, projectId, current.listenPort, project);
          const resolved = await this.workspaces.resolvedConfig(id);
          const config = JSON.stringify(envoySidecarConfig(current));
          const encoded = Buffer.from(config).toString('base64');
          const path = meshConfigPath(projectId),
            staged = `${path}.${randomUUID()}.new.json`;
          const namespace = projectNetworkNamespace(resolved);
          const prepared = await guestTask(
            this.machines,
            id,
            `set -eu\n` +
              (namespace
                ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\nfi\n`
                : '') +
              ensureProjectNetworkScript(resolved, this.machines.get(id).distro || 'alpine') +
              `umask 077\nmkdir -p /etc/sakura/mesh ${quote(resolved.directory)}\n` +
              `test ! -L /etc/sakura/mesh\ntrap 'rm -f ${staged}' EXIT\n` +
              `printf '%s' '${encoded}' | base64 -d > ${quote(staged)}\n` +
              meshProjectCommand(
                resolved,
                `${quote(guest.tools.python)} -I -S -c ${quote('import os,signal\nassert hasattr(signal,"pidfd_send_signal")\nfd=os.pidfd_open(os.getpid())\nos.close(fd)')}\n` +
                  `exec ${quote(guest.tools.envoy)} --mode validate -c ${quote(staged)}`,
                false,
              ) +
              '\n' +
              `mv -f ${quote(staged)} ${quote(path)}`,
            abort,
            undefined,
            180_000,
          );
          if (prepared.code !== 0)
            throw new AppError(
              redactProjectOutput(resolved, prepared).stderr.slice(-2000) || '无法准备边车',
              409,
            );
          const runId = randomUUID();
          let verified = false;
          try {
            abort.throwIfAborted();
            const launched = await this.machines.exec(
              id,
              meshStartScript(resolved, current, guest.tools.envoy, runId),
              15_000,
              abort,
            );
            if (launched.code !== 0)
              throw new AppError(
                redactProjectOutput(resolved, launched).stderr.slice(-2000) || '启动边车失败',
                409,
              );
            abort.throwIfAborted();
            let status = await this.status(id, abort);
            for (
              let attempt = 0;
              attempt < 20 && (!status.bindingValid || status.runId !== runId);
              attempt++
            ) {
              await delay(100, undefined, { signal: abort });
              status = await this.status(id, abort);
            }
            if (!status.bindingValid || status.runId !== runId) {
              const log = await this.machines.exec(
                id,
                `tail -c 2000 ${quote(meshLogPath(projectId))} 2>/dev/null || true`,
                5000,
                abort,
              );
              throw new AppError(
                status.reason || redactProjectOutput(resolved, log).stdout || '边车启动后未保持运行',
                409,
              );
            }
            abort.throwIfAborted();
            verified = true;
            return { ...status, executed: true, configPath: path };
          } finally {
            if (!verified && this.machines.state(id) === 'running') {
              const stopped = await this.machines.exec(
                id,
                meshStopCommand(resolved, guest.tools, runId),
                15_000,
              );
              if (stopped.code !== 0)
                throw new AppError('启动未完成，且边车清理失败，请先停止此项目的边车', 409);
            }
          }
        }),
      ),
    );
  }
  async close() {
    this.closed = true;
    this.controller.abort();
    await this.writes;
    this.unguard();
  }
}
