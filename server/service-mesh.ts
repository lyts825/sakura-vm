import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';

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
        z.string(),
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
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private file = join(DATA, 'service-mesh.json'),
  ) {}

  async init() {
    this.store = storeSchema.parse(await readStore(this.file, defaults));
  }
  private project(id: string) {
    this.machines.get(id);
    const projectId = this.workspaces.projects.current(id);
    if (!/^(default|[a-f0-9]{16})$/.test(projectId)) throw new AppError('项目标识无效', 409);
    return projectId;
  }
  private session(projectId: string) {
    return `sakura-mesh-${projectId}`;
  }
  private configPath(projectId: string) {
    return `/etc/sakura/mesh/${projectId}.json`;
  }
  private logPath(projectId: string) {
    return `/var/log/sakura-mesh-${projectId}.log`;
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
  private async guestStatus(id: string, projectId: string, signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running')
      return {
        guestRunning: false,
        envoyInstalled: false,
        tmuxInstalled: false,
        sidecarRunning: false,
        version: null as string | null,
      };
    const script = `set +e
printf 'ENVOY='; command -v envoy || true
printf 'TMUX='; command -v tmux || true
printf 'RUNNING='; tmux has-session -t =${this.session(projectId)} 2>/dev/null && echo yes || echo no
envoy --version 2>/dev/null | head -n 1
`;
    const result = await this.machines.exec(id, script, 15_000, signal);
    if (result.code !== 0) throw new AppError(result.stderr || '边车状态检查失败', 409);
    const lines = result.stdout.split(/\r?\n/);
    return {
      guestRunning: true,
      envoyInstalled: !!lines.find((line) => /^ENVOY=\//.test(line)),
      tmuxInstalled: !!lines.find((line) => /^TMUX=\//.test(line)),
      sidecarRunning: lines.includes('RUNNING=yes'),
      version: lines.find((line) => /envoy/i.test(line) && !line.startsWith('ENVOY='))?.slice(0, 200) || null,
    };
  }
  async status(id: string, signal?: AbortSignal) {
    const projectId = this.project(id);
    const policy = this.store.policies[id]?.[projectId] || null;
    const guest = await this.guestStatus(id, projectId, signal);
    return {
      projectId,
      policy,
      ...guest,
      ready: Boolean(policy && guest.guestRunning && guest.envoyInstalled && guest.tmuxInstalled),
      executed: false,
      ...(!policy
        ? { reason: '请先保存此项目的边车策略。' }
        : !guest.guestRunning
          ? { reason: '请先启动 Linux 实例。' }
          : !guest.envoyInstalled
            ? { reason: '客户机尚未安装 Envoy。' }
            : !guest.tmuxInstalled
              ? { reason: '客户机尚未安装 tmux。' }
              : {}),
    };
  }
  async assertNoRunning(id: string) {
    if (this.machines.state(id) !== 'running') return;
    for (const projectId of Object.keys(this.store.policies[id] || {}))
      if ((await this.guestStatus(id, projectId)).sidecarRunning)
        throw new AppError('请先停止所有项目的服务网格边车', 409);
  }

  async action(id: string, raw: unknown, action: 'check' | 'run', signal?: AbortSignal) {
    const input = serviceMeshInput.parse(raw);
    const projectId = this.project(id);
    const portInUse =
      input.mode === 'save' &&
      Object.entries(this.store.policies[id] || {}).some(
        ([otherProject, policy]) =>
          otherProject !== projectId && policy.listenPort === input.policy.listenPort,
      );
    if (portInUse) throw new AppError('此监听端口已由同一实例的其他项目边车使用', 409);
    if (action === 'check') {
      const current = await this.status(id, signal);
      return input.mode === 'save'
        ? {
            ...current,
            preview: input.policy,
            config: envoySidecarConfig(input.policy),
            ready: true,
            message: '策略可保存；启动前还会由客户机 Envoy 验证配置。',
          }
        : current;
    }
    if (input.mode === 'status') return this.status(id, signal);
    return this.serial(async () => {
      const current = this.store.policies[id]?.[projectId] || null;
      if (input.mode === 'save' || input.mode === 'remove') {
        const guest = await this.guestStatus(id, projectId, signal);
        if (guest.sidecarRunning) throw new AppError('请先停止当前项目的边车', 409);
        const next = structuredClone(this.store);
        if (input.mode === 'save') {
          (next.policies[id] ||= {})[projectId] = { ...input.policy, updatedAt: new Date().toISOString() };
        } else {
          if (!current) throw new AppError('此项目尚无边车策略', 404);
          delete next.policies[id][projectId];
        }
        await this.save(next);
        if (input.mode === 'remove' && guest.guestRunning) {
          const cleanup = await this.machines.exec(id, `rm -f ${this.configPath(projectId)}`, 15_000, signal);
          if (cleanup.code !== 0) throw new AppError('策略已移除，但客户机配置文件清理失败', 409);
        }
        return {
          ...(await this.status(id, signal)),
          ready: true,
          executed: true,
          message: input.mode === 'save' ? '项目边车策略已保存。' : '项目边车策略已移除。',
        };
      }
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动 Linux 实例', 409);
      const guest = await this.guestStatus(id, projectId, signal);
      if (input.mode === 'stop') {
        if (!guest.sidecarRunning)
          return {
            ...(await this.status(id, signal)),
            ready: true,
            executed: false,
            message: '边车已停止。',
          };
        const result = await this.machines.exec(
          id,
          `tmux kill-session -t =${this.session(projectId)}`,
          15_000,
          signal,
        );
        if (result.code !== 0) throw new AppError(result.stderr || '停止边车失败', 409);
        return { ...(await this.status(id, signal)), ready: true, executed: true, message: '边车已停止。' };
      }
      if (!current) throw new AppError('请先保存此项目的边车策略', 409);
      if (!guest.envoyInstalled || !guest.tmuxInstalled)
        throw new AppError('客户机需要已安装的 Envoy 和 tmux', 409);
      if (guest.sidecarRunning) throw new AppError('此项目边车已经运行，请先停止', 409);
      const config = JSON.stringify(envoySidecarConfig(current));
      const encoded = Buffer.from(config).toString('base64');
      const path = this.configPath(projectId),
        log = this.logPath(projectId);
      const script = `set -eu
mkdir -p /etc/sakura/mesh
printf '%s' '${encoded}' | base64 -d > ${path}.tmp
envoy --mode validate -c ${path}.tmp >/dev/null
mv ${path}.tmp ${path}
tmux new-session -d -s ${this.session(projectId)} "exec envoy -c ${path} > ${log} 2>&1"
sleep 1
if ! tmux has-session -t =${this.session(projectId)} 2>/dev/null; then
  tail -c 2000 ${log} >&2 || true
  exit 1
fi
`;
      const result = await this.machines.exec(id, script, 30_000, signal);
      if (result.code !== 0) throw new AppError(result.stderr.slice(-2000) || '启动边车失败', 409);
      const status = await this.status(id, signal);
      if (!status.sidecarRunning) throw new AppError('边车启动后未保持运行', 409);
      return { ...status, executed: true, configPath: path };
    });
  }
  async close() {
    this.closed = true;
    await this.writes;
  }
}
