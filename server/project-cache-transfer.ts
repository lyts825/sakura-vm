import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { AppError, vmDir } from './model.ts';
import { quote } from './files.ts';
import { writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';
import { dependencyManagerSchema, type DependencyManager } from './project-dependency-cache.ts';
import { projectIdentityRunSchema, projectIdentitySchema, projectIdentitySources } from './project-identity.ts';
import { ProjectRunScopes, type ProjectTaskAdmissionOptions, type ProjectTaskResourceContext,
  type ProjectTaskResourceReceipt } from './project-run-scope.ts';
import { projectCacheTransferControl } from './project-cache-transfer-control.ts';

export const projectCacheTransferLimits = Object.freeze({ fileBytes: 64 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024, nodes: 65536, depth: 32, controlBytes: 16384,
  replyBytes: 32768, pendingRecords: 1024 });
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/), uuid = z.uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const inode = z.object({ device: decimal, inode: decimal.refine(value => value !== '0') }).strict();
export const projectCacheTransferOwnerSchema = z.object({ stageId: uuid, manager: dependencyManagerSchema, build: digest,
  identity: projectIdentitySchema, owner: z.object({ kind: z.literal('task'), runId: uuid, bootId: uuid }).strict(), sha256: digest,
}).strict().refine(value => value.identity.phase === 'active');
export type ProjectCacheTransferOwner = z.infer<typeof projectCacheTransferOwnerSchema>;
const taskReceiptSchema = z.object({ run: projectIdentityRunSchema.nullable(),
  retirement: z.object({ reason: z.literal('guest-reboot'), bootId: uuid }).strict().optional() }).strict();
export const projectCacheTransferReceiptSchema = z.object({ version: z.literal(1),
  phase: z.enum(['copying', 'ready', 'retiring', 'closed']), owner: projectCacheTransferOwnerSchema, stage: inode, data: inode,
  manifest: z.object({ sha256: digest, bytes: z.number().int().min(0).max(projectCacheTransferLimits.totalBytes),
    nodes: z.number().int().min(1).max(projectCacheTransferLimits.nodes) }).strict().nullable(),
  task: taskReceiptSchema.nullable(),
}).strict().refine(value => value.stage.device === value.data.device &&
  (value.phase === 'copying' || value.manifest !== null || value.phase === 'retiring' || value.phase === 'closed') &&
  ((value.phase === 'retiring' || value.phase === 'closed') === Boolean(value.task)));
type Preparation = z.infer<typeof projectCacheTransferReceiptSchema>;
const replySchema = z.discriminatedUnion('state', [
  z.object({ version: z.literal(1), state: z.literal('absent'), bootId: uuid }).strict(),
  z.object({ version: z.literal(1), state: z.literal('present'), bootId: uuid, receipt: projectCacheTransferReceiptSchema }).strict(),
]);
export type ProjectCacheTransferReply = z.infer<typeof replySchema>;
const recordSchema = z.object({ version: z.literal(1), phase: z.enum(['intent', 'prepared', 'retiring', 'closed']),
  owner: projectCacheTransferOwnerSchema, preparation: projectCacheTransferReceiptSchema.nullable(),
  task: taskReceiptSchema.nullable(), retirement: replySchema.nullable(),
}).strict().refine(value => (!value.preparation || same(value.preparation.owner, value.owner)) &&
  (value.phase !== 'prepared' || value.preparation?.phase === 'ready') &&
  (value.phase !== 'closed' || Boolean(value.task && value.retirement)));
type Record = z.infer<typeof recordSchema>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const cleanupFailure = () => new AppError('项目缓存转交归属或退休未确认，原完整任务证明继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
const queues = new WeakMap<Machines, Map<string, Promise<unknown>>>();
const active = new WeakMap<Machines, Set<string>>();
export type ProjectCacheTransferOptions = {
  rootDirectory?: string;
  source?: typeof projectIdentitySources;
  scopes?: Pick<ProjectRunScopes, 'recoverStoppedTasks' | 'taskResourceReceipt' | 'taskResources' | 'completeTaskResource'>;
  control?: (vmId: string, request: { action: 'prepare' | 'probe' | 'retire'; owner: ProjectCacheTransferOwner;
    preparation?: Preparation | null; task?: ProjectTaskResourceReceipt }, signal?: AbortSignal) => Promise<ProjectCacheTransferReply>;
};

/** A private cache copy is a resource of one exact native task, never a reusable root path. */
export class ProjectCacheTransfers {
  constructor(private machines: Machines, private options: ProjectCacheTransferOptions = {}) {}
  private root(vmId: string, projectId: string) {
    return join(this.options.rootDirectory || vmDir(vmId), 'project-cache-transfers', projectIdSchema.parse(projectId));
  }
  private file(vmId: string, owner: ProjectCacheTransferOwner, archived = false) {
    return join(this.root(vmId, owner.identity.projectId), ...(archived ? ['closed', owner.stageId.slice(0, 2)] : []),
      uuid.parse(owner.stageId) + '.json');
  }
  private async serial<T>(vmId: string, projectId: string, action: () => Promise<T>) {
    let map = queues.get(this.machines);
    if (!map) { map = new Map(); queues.set(this.machines, map); }
    const key = vmId + ':' + projectId, promise = (map.get(key) || Promise.resolve()).catch(() => {}).then(action);
    map.set(key, promise);
    try { return await promise; } finally { if (map.get(key) === promise) map.delete(key); }
  }
  private async read(path: string): Promise<Record | null> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > projectCacheTransferLimits.replyBytes) throw cleanupFailure();
      return recordSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cleanupFailure();
    }
  }
  private async save(vmId: string, record: Record, before: Record | null) {
    const path = this.file(vmId, record.owner);
    if (!same(await this.read(path), before)) throw cleanupFailure();
    await writeStore(path, recordSchema.parse(record));
  }
  private async archive(vmId: string, record: Record) {
    const path = this.file(vmId, record.owner, true), old = await this.read(path);
    if (old && !same(old, record)) throw cleanupFailure();
    if (!old) await writeStore(path, record);
    if (!same(await this.read(path), record) || !same(await this.read(this.file(vmId, record.owner)), record)) throw cleanupFailure();
    await rm(this.file(vmId, record.owner));
  }
  private async control(vmId: string, request: Parameters<NonNullable<ProjectCacheTransferOptions['control']>>[1],
    live: NonNullable<ReturnType<Machines['live']['get']>>, signal?: AbortSignal) {
    if (this.machines.live.get(vmId) !== live) throw cleanupFailure();
    let result: ProjectCacheTransferReply;
    if (this.options.control) result = replySchema.parse(await this.options.control(vmId, request, signal));
    else {
      const bytes = Buffer.from(JSON.stringify(request));
      if (bytes.length > projectCacheTransferLimits.controlBytes) throw cleanupFailure();
      const command = '# SAKURA_PROJECT_CACHE_TRANSFER=' + request.action + '\n' +
        '/usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' +
        '/usr/bin/python3 -I -S -c ' + quote(projectCacheTransferControl) + ' ' + quote(bytes.toString('base64'));
      const reply = await this.machines.exec(vmId, command, 100000, signal);
      if (reply.code !== 0 || Buffer.byteLength(reply.stdout) > projectCacheTransferLimits.replyBytes) throw cleanupFailure();
      try {
        const parsed = JSON.parse(reply.stdout);
        if (parsed.ok !== true || Object.keys(parsed).sort().join(',') !== 'ok,result') throw cleanupFailure();
        result = replySchema.parse(parsed.result);
      } catch { throw cleanupFailure(); }
    }
    if (this.machines.live.get(vmId) !== live) throw cleanupFailure();
    if (result.state === 'present' && !same(result.receipt.owner, request.owner)) throw cleanupFailure();
    return result;
  }
  private preparationMatches(record: Record, receipt: Preparation) {
    return !record.preparation || ['version', 'owner', 'stage', 'data', 'manifest'].every(key =>
      same(record.preparation![key as keyof Preparation], receipt[key as keyof Preparation]));
  }
  private taskMatches(owner: ProjectCacheTransferOwner, task: ProjectTaskResourceReceipt) {
    const run = task.run;
    return (!run || run.projectId === owner.identity.projectId && run.registryId === owner.identity.registryId &&
      run.identityId === owner.identity.identityId && run.revision === owner.identity.revision &&
      run.runId === owner.owner.runId && run.bootId === owner.owner.bootId && run.build === owner.build &&
      run.mode === 'inherit-current' && run.cgroupName === 'sakura-task-' + owner.owner.runId &&
      (run.phase === 'closed' || Boolean(task.retirement))) &&
      (!task.retirement || task.retirement.bootId !== owner.owner.bootId);
  }
  private descriptor(owner: ProjectCacheTransferOwner) {
    return { stageId: owner.stageId, manager: owner.manager, build: owner.build };
  }
  private async complete(vmId: string, context: ProjectTaskResourceContext, owner: ProjectCacheTransferOwner) {
    await (this.options.scopes || new ProjectRunScopes(this.machines)).completeTaskResource(vmId, context, this.descriptor(owner));
  }
  private async retireRecord(vmId: string, record: Record, context: ProjectTaskResourceContext,
    task: ProjectTaskResourceReceipt) {
    try { await this.retireRecordChecked(vmId, record, context, task); }
    catch (error) {
      if (error instanceof AppError && error.status === 503) throw error;
      throw cleanupFailure();
    }
  }
  private async retireRecordChecked(vmId: string, record: Record, context: ProjectTaskResourceContext,
    task: ProjectTaskResourceReceipt) {
    task = taskReceiptSchema.parse(task);
    if (!same(context.identity, record.owner.identity) || !same(context.owner, record.owner.owner) ||
        context.sha256 !== record.owner.sha256 || !this.taskMatches(record.owner, task) ||
        record.task && !same(record.task, task)) throw cleanupFailure();
    if (record.phase === 'closed') { await this.complete(vmId, context, record.owner); await this.archive(vmId, record); return; }
    // Persist the complete original native proof before any guest unlink.
    if (!record.task) {
      const next = { ...record, phase: 'retiring' as const, task }; await this.save(vmId, next, record); record = next;
    }
    const probe = await this.control(vmId, { action: 'probe', owner: record.owner,
      preparation: record.preparation }, context.live);
    if (probe.state === 'present') {
      if (probe.bootId !== record.owner.owner.bootId || !this.preparationMatches(record, probe.receipt)) throw cleanupFailure();
      if (!record.preparation) {
        const next = { ...record, preparation: probe.receipt }; await this.save(vmId, next, record); record = next;
      }
    } else if (record.preparation && probe.bootId === record.owner.owner.bootId) throw cleanupFailure();
    const retired = await this.control(vmId, { action: 'retire', owner: record.owner,
      preparation: record.preparation, task }, context.live);
    if (retired.state === 'present') {
      if (retired.bootId !== record.owner.owner.bootId || retired.receipt.phase !== 'closed' ||
          !this.preparationMatches(record, retired.receipt) || !same(retired.receipt.task, task)) throw cleanupFailure();
    } else if (record.preparation && retired.bootId === record.owner.owner.bootId ||
        retired.bootId !== record.owner.owner.bootId && task.retirement?.bootId !== retired.bootId) throw cleanupFailure();
    const next = { ...record, phase: 'closed' as const, retirement: retired };
    await this.save(vmId, next, record); await this.complete(vmId, context, next.owner); await this.archive(vmId, next);
  }
  /** Recover only original resources whose complete native task has been closed. */
  async recover(vmId: string, projectId: string) {
    projectIdSchema.parse(projectId);
    return this.serial(vmId, projectId, async () => {
      const folder = this.root(vmId, projectId), scopes = this.options.scopes || new ProjectRunScopes(this.machines);
      const resources = await scopes.taskResources(vmId, projectId), live = this.machines.live.get(vmId);
      const owners = resources.filter(resource => !resource.active);
      if (owners.length && !live) throw cleanupFailure();
      for (const resource of owners) {
        const context = resource.context, owner = projectCacheTransferOwnerSchema.parse({ ...resource.descriptor,
          identity: context.identity, owner: context.owner, sha256: context.sha256 });
        if (active.get(this.machines)?.has(vmId + ':' + owner.stageId)) continue;
        if (!await this.read(this.file(vmId, owner))) {
          const archived = await this.read(this.file(vmId, owner, true));
          if (archived) {
            if (archived.phase !== 'closed' || !same(archived.owner, owner)) throw cleanupFailure();
            await this.complete(vmId, context, owner); continue;
          }
          // Only the immutable original native intent may reconstruct a missing cache intent.
          await scopes.recoverStoppedTasks(vmId, projectId);
          await scopes.taskResourceReceipt(vmId, context);
          await this.save(vmId, { version: 1, phase: 'intent', owner, preparation: null, task: null, retirement: null }, null);
        }
      }
      let names: string[];
      try { names = await readdir(folder); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw cleanupFailure();
      }
      const files = names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
      if (files.length > projectCacheTransferLimits.pendingRecords) throw cleanupFailure();
      if (files.length && !live) throw cleanupFailure();
      for (const name of files) {
        const record = await this.read(join(folder, name));
        if (!record || record.owner.identity.projectId !== projectId || name !== record.owner.stageId + '.json') throw cleanupFailure();
        if (active.get(this.machines)?.has(vmId + ':' + record.owner.stageId) ||
            resources.some(resource => resource.active && resource.descriptor.stageId === record.owner.stageId)) continue;
        if (record.phase === 'closed') {
          const context = { identity: record.owner.identity, owner: record.owner.owner, sha256: record.owner.sha256, live: live! };
          await this.complete(vmId, context, record.owner); await this.archive(vmId, record); continue;
        }
        await scopes.recoverStoppedTasks(vmId, projectId);
        if (this.machines.live.get(vmId) !== live) throw cleanupFailure();
        const context = { identity: record.owner.identity, owner: record.owner.owner, sha256: record.owner.sha256, live: live! };
        const task = await scopes.taskResourceReceipt(vmId, context);
        await this.retireRecord(vmId, record, context, task);
      }
    });
  }
  async allocate(vmId: string, project: Project, manager: DependencyManager, signal: AbortSignal,
    live: NonNullable<ReturnType<Machines['live']['get']>>) {
    manager = dependencyManagerSchema.parse(manager);
    const projectId = projectIdSchema.parse(project._workspace || 'default');
    await this.recover(vmId, projectId);
    signal.throwIfAborted();
    const { manifest } = await (this.options.source || projectIdentitySources)();
    if (this.machines.live.get(vmId) !== live) throw cleanupFailure();
    const stageId = randomUUID(); let started = false, submitted = false;
    let registry = active.get(this.machines); if (!registry) { registry = new Set(); active.set(this.machines, registry); }
    const key = vmId + ':' + stageId;
    const resource: NonNullable<ProjectTaskAdmissionOptions['resource']> = {
      descriptor: { stageId, manager, build: manifest.build },
      prepare: async context => this.serial(vmId, projectId, async () => {
        if (started || context.live !== live || this.machines.live.get(vmId) !== live) throw cleanupFailure();
        started = true;
        const owner = projectCacheTransferOwnerSchema.parse({ stageId, manager, build: manifest.build,
          identity: context.identity, owner: context.owner, sha256: context.sha256 });
        if (owner.identity.projectId !== projectId || owner.identity.directory !== project.directory ||
            owner.identity.networkIsolation !== (project.networkIsolation || 'host')) throw cleanupFailure();
        if (await this.read(this.file(vmId, owner)) || await this.read(this.file(vmId, owner, true))) throw cleanupFailure();
        const record: Record = { version: 1, phase: 'intent', owner, preparation: null, task: null, retirement: null };
        await this.save(vmId, record, null); registry!.add(key);
        submitted = true;
        const reply = await this.control(vmId, { action: 'prepare', owner }, context.live, signal);
        if (reply.state !== 'present' || reply.bootId !== context.owner.bootId || reply.receipt.phase !== 'ready') throw cleanupFailure();
        await this.save(vmId, { ...record, phase: 'prepared', preparation: reply.receipt }, record);
      }),
      retire: async (context, task) => this.serial(vmId, projectId, async () => {
        try {
        const owner = projectCacheTransferOwnerSchema.parse({ stageId, manager, build: manifest.build,
          identity: context.identity, owner: context.owner, sha256: context.sha256 });
        let record = await this.read(this.file(vmId, owner));
        if (!record) {
          const archived = await this.read(this.file(vmId, owner, true));
          if (archived && same(archived.owner, owner) && archived.phase === 'closed' && same(archived.task, task)) return;
          if (!submitted) return;
          throw cleanupFailure();
        }
        if (!same(record.owner, owner)) throw cleanupFailure();
        await this.retireRecord(vmId, record, context, task);
        } finally { registry!.delete(key); }
      }),
    };
    return { stageId, directory: '/run/sakura-project-cache-transfers/' + stageId + '/data', resource };
  }
}

/** This text and the project environment enter only the protected native payload. */
export function projectCachedInstallCommand(_directory: string, cache: string, manager: DependencyManager) {
  dependencyManagerSchema.parse(manager);
  if (!/^\/run\/sakura-project-cache-transfers\/[a-f0-9-]{36}\/data$/.test(cache)) throw cleanupFailure();
  // Retain the exact native directory FD instead of resolving the project path again.
  const header = `set -eu\ncache=${quote(cache)}\n`;
  return manager === 'npm' ? header + `command -v npm >/dev/null\ntest -f package.json\nif [ -f npm-shrinkwrap.json ]; then lock=npm-shrinkwrap.json; elif [ -f package-lock.json ]; then lock=package-lock.json; else echo '项目 npm 锁文件不存在' >&2; exit 2; fi\ntest -f "$cache/LOCKSUMS" || { echo '项目依赖缓存不存在' >&2; exit 2; }\nsha256sum -c "$cache/LOCKSUMS" >/dev/null\nnpm ci --offline --ignore-scripts --cache "$cache/data" --no-audit --no-fund\nprintf '已从离线缓存安装 npm 依赖\\n'` :
    header + `command -v python3 >/dev/null\npython3 -m pip --version >/dev/null\ntest -f requirements.txt\nif grep -Ev '^[[:space:]]*(#|$)' requirements.txt | grep -Ev '^[[:space:]]*[A-Za-z0-9_.-]+(\\[[A-Za-z0-9_,.-]+\\])?==[A-Za-z0-9_.+!-]+[[:space:]]*$' | grep -q .; then echo '离线缓存仅支持固定版本的普通 PyPI 包' >&2; exit 2; fi\ntest -f "$cache/LOCKSUMS" && test -f "$cache/wheels/WHEELS" || { echo '项目依赖缓存不存在' >&2; exit 2; }\nsha256sum -c "$cache/LOCKSUMS" >/dev/null\n(cd "$cache/wheels" && sha256sum -c WHEELS >/dev/null)\nmkdir -p .sakura\npython3 -m venv .sakura/venv\n.sakura/venv/bin/python -m pip install --no-index --no-build-isolation --only-binary=:all: --find-links="$cache/wheels" -r requirements.txt\nprintf '已从离线缓存安装 Python 依赖到 .sakura/venv\\n'`;
}
