import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { AppError, vmDir } from './model.ts';
import { quote } from './files.ts';
import { readStore, writeStore } from './local-store.ts';
import { guestTask } from './guest-task.ts';
import { projectIdSchema } from './project-catalog.ts';
import { assertNoPendingProjectDirectoryMigration } from './project-directory-migration.ts';
import { ProjectIdentities, projectIdentitySchema, projectIdentityRunSchema, projectIdentityNetworkSchema,
  type ProjectIdentity, type ProjectIdentityRun, type ProjectIdentityExecution } from './project-identity.ts';

const bindingSchema = z.object({ directory: z.string().min(1), networkIsolation: z.enum(['host', 'private']) }).strict();
const ownerSchema = z.object({ kind: z.enum(['task', 'main', 'service']), runId: z.uuid(), bootId: z.uuid() }).strict();
export type ProjectRunOwner = z.infer<typeof ownerSchema>;
const entrySchema = z.object({ version: z.literal(1), projectId: projectIdSchema, identity: projectIdentitySchema,
  runId: z.uuid(), owner: ownerSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['intent', 'active', 'closed']), run: projectIdentityRunSchema.nullable(),
  retirement: z.object({ reason: z.literal('guest-reboot'), bootId: z.uuid() }).strict().optional() }).strict()
  .superRefine((value, ctx) => {
    if (value.projectId !== value.identity.projectId || value.runId !== value.owner.runId ||
        (value.run && (value.run.runId !== value.runId || value.run.mode !== 'inherit-current' ||
          value.run.projectId !== value.projectId || value.run.identityId !== value.identity.identityId ||
          value.run.registryId !== value.identity.registryId || value.run.revision !== value.identity.revision ||
          value.run.bootId !== value.owner.bootId || value.run.cgroupName !== scopeName(value.owner))) ||
        (value.phase === 'active' && !value.run) ||
        (value.retirement && (value.phase !== 'closed' || value.retirement.bootId === value.owner.bootId)) ||
        (value.phase === 'closed' && value.run?.phase === 'active' && !value.retirement))
      ctx.addIssue({ code: 'custom', message: '项目账号运行记录不完整' });
  });
type Entry = z.infer<typeof entrySchema>;
const networkLeaseSchema = z.object({ version: z.literal(1), phase: z.literal('pending'), releaseId: z.uuid(),
  network: projectIdentityNetworkSchema }).strict();
const networkReleaseIntentSchema = z.object({ version: z.literal(1), releaseId: z.uuid(), bootId: z.uuid(),
  identity: projectIdentitySchema, lease: networkLeaseSchema.nullable() }).strict().superRefine((value, ctx) => {
  if (value.lease && (value.identity.networkIsolation !== 'private' ||
      value.lease.releaseId !== value.releaseId || value.lease.network.bootId !== value.bootId ||
      (['projectId', 'identityId', 'registryId', 'revision'] as const).some(key =>
        value.lease!.network[key] !== value.identity[key])))
    ctx.addIssue({ code: 'custom', message: '项目网络核销身份不完整' });
});
export type ProjectNetworkReleaseIntent = z.infer<typeof networkReleaseIntentSchema>;
const networkReleaseStateSchema = z.object({ intent: networkReleaseIntentSchema,
  phase: z.enum(['intent', 'pending', 'released']) }).strict();
const journalSchema = z.object({ version: z.literal(1), projectId: projectIdSchema,
  identity: projectIdentitySchema.nullable(),
  pending: z.object({ kind: z.enum(['ensure', 'rebind']), binding: bindingSchema }).strict().nullable(),
  networkRelease: networkReleaseStateSchema.nullable().optional(),
  runs: z.array(entrySchema).max(1024) }).strict().superRefine((value, ctx) => {
    if ((value.identity && value.identity.projectId !== value.projectId) ||
        value.runs.some(run => run.projectId !== value.projectId) ||
        new Set(value.runs.map(run => run.runId)).size !== value.runs.length ||
        (value.pending?.kind === 'rebind' && !value.identity) ||
        (value.networkRelease && (value.networkRelease.intent.identity.projectId !== value.projectId ||
          (value.networkRelease.phase !== 'released' && !same(value.networkRelease.intent.identity, value.identity)))))
      ctx.addIssue({ code: 'custom', message: '项目账号登记记录不完整' });
  });
type Journal = z.infer<typeof journalSchema>;
type Core = Pick<ProjectIdentities, 'ensure' | 'inspect' | 'rebind' | 'inheritedInput' | 'run' | 'stop'> &
  Partial<Pick<ProjectIdentities, 'runReadonly'>> & {
    beginNetworkRelease?: (vmId: string, identity: ProjectIdentity, options: { releaseId: string; bootId: string },
      signal?: AbortSignal) => Promise<z.infer<typeof networkLeaseSchema> | null>;
    releaseNetwork?: (vmId: string, identity: ProjectIdentity, lease: z.infer<typeof networkLeaseSchema>,
      signal?: AbortSignal) => Promise<{ version: 1; phase: 'released'; releaseId: string; network: z.infer<typeof projectIdentityNetworkSchema> }>;
  };
const sharedCores = new WeakMap<Machines, ProjectIdentities>();
export type ProjectInheritedPayload = { identity: ProjectIdentity; runId: string; command: string; input: Buffer; sha256: string };
type Access = {
  reserve(project: Project, signal?: AbortSignal): Promise<ProjectIdentity>;
  identity(project: Project, signal?: AbortSignal): Promise<ProjectIdentity>;
  recoverStoppedTasks(): Promise<void>;
  guard(): Promise<void>;
};
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const binding = (project: { directory: string; networkIsolation?: 'host' | 'private' }) => bindingSchema.parse({ directory: project.directory,
  networkIsolation: project.networkIsolation || 'host' });
const expected = (identity: ProjectIdentity) => ({ registryId: identity.registryId,
  identityId: identity.identityId, revision: identity.revision });
const projectId = (project: Project) => projectIdSchema.parse(project._workspace || 'default');
const scopeName = (owner: ProjectRunOwner) => `sakura-${owner.kind}-${owner.runId}`;
const sameIdentity = (left: ProjectIdentity, right: ProjectIdentity, rebind = false) => {
  const mutable = new Set(['phase', ...(rebind ? ['revision', 'directory', 'directoryDevice', 'directoryInode', 'networkIsolation'] : [])]);
  return Object.keys(left).every(key => mutable.has(key) || left[key as keyof ProjectIdentity] === right[key as keyof ProjectIdentity]) &&
    (left.phase !== 'active' || right.phase === 'active') && (!rebind || right.revision === left.revision + 1);
};

/** Host receipts contain identities and hashes only, never project command/environment bodies. */
export class ProjectRunScopes {
  private core: Core;
  constructor(private machines: Machines, private options: { identities?: Core; rootDirectory?: string } = {}) {
    if (options.identities) this.core = options.identities;
    else {
      let core = sharedCores.get(machines);
      if (!core) { core = new ProjectIdentities(machines); sharedCores.set(machines, core); }
      this.core = core;
    }
  }
  private file(vmId: string, id: string) {
    return join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id) + '.json');
  }
  private async read(vmId: string, id: string) {
    try {
      const value = journalSchema.parse(await readStore(this.file(vmId, id), (): Journal => ({
        version: 1, projectId: id, identity: null, pending: null, runs: [] })));
      if (value.projectId !== id) throw new Error('wrong project');
      return value;
    } catch {
      throw new AppError('项目账号主机登记无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    }
  }
  private save(vmId: string, id: string, value: Journal) {
    return writeStore(this.file(vmId, id), journalSchema.parse(value));
  }
  private archiveFile(vmId: string, id: string, runId: string) {
    return join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id),
      'closed-runs', z.uuid().parse(runId) + '.json');
  }
  private async archived(vmId: string, id: string, runId: string): Promise<Entry | null> {
    try {
      const absent = Symbol('archive absent');
      const value = await readStore<unknown>(this.archiveFile(vmId, id, runId), () => absent);
      if (value === absent) return null;
      const entry = entrySchema.parse(value);
      if (entry.projectId !== id || entry.runId !== runId || entry.phase !== 'closed') throw new Error('wrong archive');
      return entry;
    } catch {
      throw new AppError('项目账号历史记录无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    }
  }
  private async compact(vmId: string, id: string, journal: Journal) {
    if (journal.runs.length < 1024) return;
    const closed = journal.runs.filter(run => run.phase === 'closed').slice(0, 512);
    if (!closed.length)
      throw new AppError('项目账号未确认的运行记录达到上限，请先完成所属运行清理', 409, 'PROJECT_IDENTITY_HOST_LIMIT');
    // Keep each complete closed receipt as a durable tombstone before removing
    // it from the bounded current journal. A partial write leaves the original
    // journal intact, and an archived UUID can never admit a second execution.
    for (const entry of closed) {
      const prior = await this.archived(vmId, id, entry.runId);
      if (prior && !same(prior, entry))
        throw new AppError('项目账号历史记录与原运行不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      if (!prior) await writeStore(this.archiveFile(vmId, id, entry.runId), entrySchema.parse(entry));
      if (!same(await this.archived(vmId, id, entry.runId), entry))
        throw new AppError('项目账号历史记录写入未确认', 503, 'PROJECT_IDENTITY_HOST_CHANGED');
    }
    const retired = new Set(closed.map(run => run.runId));
    journal.runs = journal.runs.filter(run => !retired.has(run.runId));
    await this.save(vmId, id, journal);
  }
  private async guardUnlocked(vmId: string, id: string, permitPending = false, permitNetworkRelease = false) {
    const value = await this.read(vmId, id);
    if (!permitNetworkRelease && value.networkRelease && value.networkRelease.phase !== 'released')
      throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
    if (!permitPending && value.pending)
      throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
    if (value.runs.some(run => run.phase !== 'closed'))
      throw new AppError('项目账号仍有待确认的运行，请先完成所属运行清理', 409, 'PROJECT_IDENTITY_RUNS_MUST_STOP');
  }
  async withLock<T>(vmId: string, id: string, action: (access: Access) => Promise<T>) {
    id = projectIdSchema.parse(id);
    return this.machines.locked(`project-identity:${vmId}:${id}`, async () => {
      let open = true;
      const checked = (project?: Project) => {
        if (!open || (project && projectId(project) !== id))
          throw new AppError('项目账号锁或项目范围已失效', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      };
      try {
        return await action({
          reserve: async (project, signal) => { checked(project); return this.reserveUnlocked(vmId, project, true, signal); },
          identity: async (project, signal) => { checked(project); return this.reserveUnlocked(vmId, project, false, signal); },
          recoverStoppedTasks: async () => { checked(); await this.recoverStoppedTasksUnlocked(vmId, id); },
          guard: async () => { checked(); await this.guardUnlocked(vmId, id); },
        });
      } finally { open = false; }
    });
  }
  reserve(vmId: string, project: Project, signal?: AbortSignal) {
    return this.withLock(vmId, projectId(project), access => access.reserve(project, signal));
  }
  identity(vmId: string, project: Project, signal?: AbortSignal) {
    return this.withLock(vmId, projectId(project), async access => {
      const identity = await access.identity(project, signal);
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, identity.projectId, signal);
      return identity;
    });
  }
  guard(vmId: string, id: string) {
    return this.withLock(vmId, id, access => access.guard());
  }
  private async reserveUnlocked(vmId: string, project: Project, permitIntent: boolean, signal?: AbortSignal): Promise<ProjectIdentity> {
    signal?.throwIfAborted();
    const id = projectId(project), target = binding(project), journal = await this.read(vmId, id);
    if (journal.networkRelease && journal.networkRelease.phase !== 'released')
      throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
    if (journal.pending && !same(journal.pending.binding, target))
      throw new AppError('项目账号有另一份尚未确认的绑定变更，请恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
    let old = journal.identity;
    if (journal.pending?.kind === 'rebind' && old) {
      const actual = await this.core.inspect(vmId, id, signal);
      if (actual && sameIdentity(old, actual, true) && same(binding(actual), target)) {
        journal.identity = actual; journal.pending = null; await this.save(vmId, id, journal); old = actual;
      } else if (!actual || !sameIdentity(old, actual) || !same(binding(actual), binding(old))) {
        throw new AppError('待确认的账号修订与客户机记录不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      }
    }
    const rebind = Boolean(old && !same(binding(old), target));
    if (rebind) await this.guardUnlocked(vmId, id, true);
    journal.pending = { kind: rebind ? 'rebind' : 'ensure', binding: target };
    await this.save(vmId, id, journal);
    let actual: ProjectIdentity;
    try {
      actual = old && rebind
        ? await this.core.rebind(vmId, old, target, signal)
        : await this.core.ensure(vmId, { projectId: id, ...target }, old ? expected(old) : undefined, signal);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED') throw error;
      // The first reservation has no usable command entry. Pin its exact intent
      // so a permissions preview cannot choose or adopt a different account.
      if (!old) {
        const intent = await this.core.inspect(vmId, id, signal);
        if (intent === null && journal.runs.length === 0) {
          // A typed directory refusal followed by a verified absent binding
          // proves this reservation never became an account. Do not pin an
          // invalid path forever; unknown control failures still retain pending.
          journal.pending = null; await this.save(vmId, id, journal); throw error;
        }
        if (!intent || intent.phase !== 'intent' || !same(binding(intent), target))
          throw new AppError('目录迁移所需的账号保留记录不完整', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        actual = intent;
      } else actual = old;
      journal.identity = actual; journal.pending = null; await this.save(vmId, id, journal);
      if (!permitIntent) throw error;
      return actual;
    }
    if (actual.projectId !== id || !same(binding(actual), target) ||
        (old && !sameIdentity(old, actual, rebind)) || actual.phase !== 'active')
      throw new AppError('项目账号完整绑定或修订与主机记录不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    journal.identity = actual; journal.pending = null; await this.save(vmId, id, journal);
    return actual;
  }
  async hasRun(vmId: string, id: string, runId: string) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    return (await this.read(vmId, id)).runs.some(run => run.runId === runId) || Boolean(await this.archived(vmId, id, runId));
  }
  async assertTaskIssued(vmId: string, id: string, runId: string,
    result: { code: number; stdout: string; stderr: string }) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(run => run.runId === runId) ||
      await this.archived(vmId, id, runId);
    if (entry?.owner.kind === 'task' && entry.phase === 'closed' && entry.run && !entry.retirement) return;
    // A user can print any JSON and choose any exit status. Only an accurately
    // closed intent with no issued guest ticket makes this a controller reply.
    const refusal = z.object({ ok: z.literal(false), code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
      detail: z.unknown() }).strict().safeParse(parseJson(result.stdout));
    const controlled = entry?.owner.kind === 'task' && entry.phase === 'closed' && !entry.run &&
      result.code !== 0 && refusal.success;
    throw new AppError('项目启动器未确认发行本次运行票据，项目代码未执行', controlled ? 409 : 503,
      controlled ? 'PROJECT_IDENTITY_' + refusal.data.code : 'PROJECT_IDENTITY_LAUNCH_UNCONFIRMED');
  }
  async assertAdmission(vmId: string, id: string) {
    const journal = await this.read(vmId, projectIdSchema.parse(id));
    if (journal.networkRelease && journal.networkRelease.phase !== 'released')
      throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
    if (journal.pending)
      throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
  }
  private async kernelBoot(vmId: string, signal?: AbortSignal) {
    const result = await this.machines.exec(vmId,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10000, signal);
    const boot = z.uuid().safeParse(result.stdout.trim());
    if (result.code !== 0 || !boot.success)
      throw new AppError('项目网络开机身份无法核对', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
    return boot.data;
  }
  private async confirmNetworkAbsent(vmId: string, id: string, expectedBoot: string) {
    // An intent whose begin reply was lost across a real reboot may be retired
    // only when no current namespace or current native retirement authority exists.
    const source = `import json,os,stat\nproject=${JSON.stringify(id)}\nboot=open('/proc/sys/kernel/random/boot_id').read().strip()\n` +
      `paths=['/run/netns/sk-'+project]\nif boot!=${JSON.stringify(expectedBoot)}:\n` +
      ` paths+=['/run/sakura-project-identities/networks/'+project+suffix for suffix in ['.json','.generation.json','.release.bin','.tool.json']]\n` +
      `for path in paths:\n current='/'\n for part in path.split('/')[1:-1]:\n` +
      `  current=os.path.join(current,part)\n  try:info=os.lstat(current)\n  except FileNotFoundError:break\n` +
      `  assert stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\n` +
      ` assert not os.path.lexists(path)\nprint(json.dumps({'bootId':boot,'absent':True}))\n`;
    const result = await this.machines.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`, 10000);
    const schema = z.object({ bootId: z.uuid(), absent: z.literal(true) }).strict();
    const value = schema.safeParse(parseJson(result.stdout));
    if (result.code !== 0 || !value.success)
      throw new AppError('当前网络对象仍存在或身份未确认，原核销记录继续保留', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
    return value.data.bootId;
  }
  async beginNetworkRelease(vmId: string, id: string, signal?: AbortSignal): Promise<ProjectNetworkReleaseIntent | null> {
    id = projectIdSchema.parse(id);
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId);
      if (!journal.identity) {
        if (journal.pending || journal.runs.length || journal.networkRelease)
          throw new AppError('网络核销缺少原完整账号身份', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        return null; // Only a project that never acquired an account uses legacy deletion.
      }
      if (journal.pending)
        throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
      let state = journal.networkRelease;
      if (!state || state.phase === 'released') {
        state = { phase: 'intent', intent: { version: 1, releaseId: randomUUID(), identity: journal.identity,
          bootId: await this.kernelBoot(vmId, signal), lease: null } };
        if (!instance || this.machines.live.get(vmId) !== instance)
          throw new AppError('客户机实例改变，网络核销未开始', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
        journal.networkRelease = state; await this.save(vmId, id, journal);
      }
      if (state.phase === 'pending') return state.intent;
      if (await this.kernelBoot(vmId, signal) !== state.intent.bootId) {
        const boot = await this.confirmNetworkAbsent(vmId, id, state.intent.bootId);
        if (await this.confirmNetworkAbsent(vmId, id, state.intent.bootId) !== boot)
          throw new AppError('客户机开机身份再次改变，网络核销未确认', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      } else {
        if (!this.core.beginNetworkRelease)
          throw new AppError('项目网络核销入口不可用', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
        state.intent.lease = await this.core.beginNetworkRelease(vmId, state.intent.identity,
          { releaseId: state.intent.releaseId, bootId: state.intent.bootId }, signal);
      }
      if (!instance || this.machines.live.get(vmId) !== instance)
        throw new AppError('客户机实例改变，网络冻结未确认', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      state.phase = 'pending'; await this.save(vmId, id, journal); return state.intent;
    });
  }
  async releaseNetwork(vmId: string, id: string, intent: ProjectNetworkReleaseIntent, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); intent = networkReleaseIntentSchema.parse(intent);
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId), state = journal.networkRelease;
      if (!state || !same(state.intent, intent) || intent.identity.projectId !== id)
        throw new AppError('网络核销请求不属于原停止代次', 409, 'PROJECT_IDENTITY_NETWORK_STALE');
      if (state.phase === 'released') return;
      if (state.phase !== 'pending')
        throw new AppError('原网络冻结回执尚未确认，请重试原停止操作', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      await this.recoverStoppedTasksUnlocked(vmId, id);
      await this.guardUnlocked(vmId, id, false, true);
      if (intent.lease) {
        if (!this.core.releaseNetwork)
          throw new AppError('项目网络核销入口不可用', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
        const released = await this.core.releaseNetwork(vmId, intent.identity, intent.lease, signal);
        if (released.phase !== 'released' || released.releaseId !== intent.releaseId || !same(released.network, intent.lease.network))
          throw new AppError('网络核销回执不属于原冻结代次', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      } else {
        const boot = await this.confirmNetworkAbsent(vmId, id, intent.bootId);
        if (await this.confirmNetworkAbsent(vmId, id, intent.bootId) !== boot)
          throw new AppError('客户机开机身份再次改变，空网络核销未确认', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      }
      if (!instance || this.machines.live.get(vmId) !== instance)
        throw new AppError('客户机实例改变，网络核销未确认', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      // Task recovery may have advanced run receipts; update only the network state.
      const current = await this.read(vmId, id);
      if (!same(current.networkRelease, state))
        throw new AppError('网络核销主机记录已变化', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      current.networkRelease!.phase = 'released'; await this.save(vmId, id, current);
    });
  }
  async active(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    z.uuid().parse(runId);
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), entry = journal.runs.find(run => run.runId === runId);
      if (!entry) { await this.archived(vmId, id, runId); return false; }
      if (entry.phase === 'closed') return false;
      const instance = this.machines.live.get(vmId);
      let run: ProjectIdentityRun;
      try { run = await this.core.run(vmId, entry.identity, runId, signal); }
      catch (error) {
        if (error instanceof AppError && error.code === 'PROJECT_IDENTITY_RECORD_ABSENT' && !entry.run) return false;
        throw error;
      }
      if (!instance || this.machines.live.get(vmId) !== instance || !this.matches(entry, run))
        throw new AppError('项目账号票据与原运行身份不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      entry.run = run; entry.phase = run.phase === 'closed' ? 'closed' : 'active';
      await this.save(vmId, id, journal);
      return run.phase === 'active';
    });
  }
  async readonlyActive(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    const journal = await this.read(vmId, id), entry = journal.runs.find(run => run.runId === runId);
    if (!entry) { await this.archived(vmId, id, runId); return false; }
    if (entry.phase === 'closed') return false;
    if (!this.core.runReadonly)
      throw new AppError('账号只读核对入口不可用', 409, 'PROJECT_IDENTITY_READONLY_UNAVAILABLE');
    const instance = this.machines.live.get(vmId);
    const run = await this.core.runReadonly(vmId, entry.identity, runId, signal);
    if (!instance || this.machines.live.get(vmId) !== instance || !this.matches(entry, run))
      throw new AppError('项目账号只读回执与原运行不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    // Reads never install a guest helper or advance host receipt phases.
    return run.phase === 'active';
  }
  private matches(entry: Entry, run: ProjectIdentityRun) {
    return run.mode === 'inherit-current' && run.cgroupName === scopeName(entry.owner) && run.bootId === entry.owner.bootId &&
      run.runId === entry.runId && run.projectId === entry.projectId && run.identityId === entry.identity.identityId &&
      run.registryId === entry.identity.registryId && run.revision === entry.identity.revision &&
      (!entry.run || same({ ...run, phase: entry.run.phase }, entry.run));
  }
  async inherited(vmId: string, project: Project, execution: ProjectIdentityExecution,
    owner: ProjectRunOwner, signal?: AbortSignal): Promise<ProjectInheritedPayload> {
    owner = ownerSchema.parse(owner);
    return this.withLock(vmId, projectId(project), async access => {
      const identity = await access.identity(project, signal), id = identity.projectId;
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      const journal = await this.read(vmId, id);
      const payload = await this.core.inheritedInput(identity, execution, { runId: owner.runId });
      signal?.throwIfAborted();
      const entry: Entry = { version: 1, projectId: id, identity, runId: owner.runId, owner,
        sha256: payload.sha256, phase: 'intent', run: null };
      if (await this.archived(vmId, id, owner.runId))
        throw new AppError('项目账号运行票据已经归档，拒绝重新执行', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const prior = journal.runs.find(run => run.runId === owner.runId);
      if (prior) {
        if (prior.phase !== 'intent' || !same(prior, entry))
          throw new AppError('项目账号运行票据已存在或被关闭，拒绝重新执行', 409, 'PROJECT_IDENTITY_RUN_STALE');
      } else {
        await this.compact(vmId, id, journal);
        journal.runs.push(entry);
      }
      await this.save(vmId, id, journal);
      // A process cannot survive a real guest reboot between this guard and
      // launcher entry. No user command/environment is part of this argv.
      const command = `test "$(cat /proc/sys/kernel/random/boot_id)" = ${quote(owner.bootId)} && ${payload.command}`;
      return { ...payload, command, identity, runId: owner.runId };
    });
  }
  private async confirmScopeStopped(vmId: string, owner: ProjectRunOwner) {
    const source = `import json,os,stat\nname=${JSON.stringify(scopeName(owner))}\nboot=open('/proc/sys/kernel/random/boot_id').read().strip()\nmounts=open('/proc/self/mountinfo').read().splitlines()\nassert any(len(line.split())>6 and line.split()[4]=='/sys/fs/cgroup' and ' - cgroup2 ' in line for line in mounts)\ninfo=os.lstat('/sys/fs/cgroup')\nassert stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode)\nassert not os.path.lexists('/sys/fs/cgroup/'+name)\nprint(json.dumps({'bootId':boot,'absent':True}))\n`;
    const result = await this.machines.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`, 10000);
    const schema = z.object({ bootId: z.uuid(), absent: z.literal(true) }).strict();
    if (result.code !== 0 || !schema.safeParse(parseJson(result.stdout)).success)
      throw new AppError('所属项目运行域尚未确认停止，账号票据继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return schema.parse(parseJson(result.stdout)).bootId;
  }
  async closeAfterScopeStopped(vmId: string, id: string, runId: string) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    return this.withLock(vmId, id, () => this.closeUnlocked(vmId, id, runId));
  }
  async recoverStoppedTasks(vmId: string, id: string) {
    id = projectIdSchema.parse(id);
    return this.withLock(vmId, id, access => access.recoverStoppedTasks());
  }
  private async recoverStoppedTasksUnlocked(vmId: string, id: string) {
    const journal = await this.read(vmId, id);
    for (const entry of journal.runs) {
      if (entry.owner.kind === 'task' && entry.phase !== 'closed')
        await this.closeUnlocked(vmId, id, entry.runId);
    }
  }
  private async closeUnlocked(vmId: string, id: string, runId: string) {
      const instance = this.machines.live.get(vmId), journal = await this.read(vmId, id);
      const entry = journal.runs.find(run => run.runId === runId);
      if (!entry) {
        if (await this.archived(vmId, id, runId)) return;
        throw new AppError('主机缺少本次账号运行记录，拒绝推断清理成功', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      }
      if (entry.phase === 'closed') return;
      const unchanged = async () => {
        if (!instance || this.machines.live.get(vmId) !== instance)
          throw new AppError('客户机 live 实例改变，账号票据清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        const current = (await this.read(vmId, id)).runs.find(run => run.runId === runId);
        if (!same(current, entry)) throw new AppError('账号运行主机记录已变化', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      };
      await unchanged();
      const currentBoot = await this.confirmScopeStopped(vmId, entry.owner);
      await unchanged();
      if (currentBoot !== entry.owner.bootId) {
        if (await this.confirmScopeStopped(vmId, entry.owner) !== currentBoot)
          throw new AppError('客户机开机身份再次改变，原账号运行核销未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        await unchanged();
        // A real reboot ended every process from the recorded boot. Keep the
        // original guest ticket unchanged rather than inventing a stop receipt
        // after its /run record disappeared. Never send an old stop to this boot.
        entry.phase = 'closed'; entry.retirement = { reason: 'guest-reboot', bootId: currentBoot };
        await this.save(vmId, id, journal); return;
      }
      let run: ProjectIdentityRun;
      try { run = await this.core.run(vmId, entry.identity, runId); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) {
          throw new AppError('账号运行回执读取未确认，原记录继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        }
        await unchanged(); await this.confirmScopeStopped(vmId, entry.owner); await unchanged();
        entry.phase = 'closed'; await this.save(vmId, id, journal); return;
      }
      if (!this.matches(entry, run))
        throw new AppError('账号票据的上层运行归属不符', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      entry.run = run; entry.phase = run.phase === 'closed' ? 'closed' : 'active';
      await this.save(vmId, id, journal);
      if (entry.phase === 'closed') return;
      // Once a complete ticket was received, an absent or changed receipt is
      // never treated as a task that did not start.
      await this.confirmScopeStopped(vmId, entry.owner); await unchanged();
      const stopped = await this.core.stop(vmId, entry.identity, run);
      if (stopped.phase !== 'closed' || !same({ ...stopped, phase: run.phase }, run))
        throw new AppError('账号运行停止回执不属于本次票据', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await unchanged(); entry.run = stopped; entry.phase = 'closed'; await this.save(vmId, id, journal);
  }
}
const parseJson = (value: string) => { try { return JSON.parse(value); } catch { return null; } };

/** All user code remains in the outer task domain; only that owner may authorize retirement. */
export async function projectIdentityTask(machines: Machines, vmId: string, project: Project,
  execution: ProjectIdentityExecution, signal: AbortSignal, log?: (text: string) => void,
  timeout = 1200000, agentPath?: string, afterCleanup?: () => Promise<void>) {
  signal.throwIfAborted();
  const instance = machines.live.get(vmId), result = await machines.exec(vmId,
    'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10000, signal);
  const bootId = z.uuid().safeParse(result.stdout.trim());
  if (result.code !== 0 || !bootId.success || !instance || machines.live.get(vmId) !== instance)
    throw new AppError('无法固定客户机开机身份，项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  const scopes = new ProjectRunScopes(machines), runId = randomUUID();
  await scopes.recoverStoppedTasks(vmId, projectId(project));
  const payload = await scopes.inherited(vmId, project, execution, { kind: 'task', runId, bootId: bootId.data }, signal);
  if (signal.aborted) {
    await scopes.closeAfterScopeStopped(vmId, projectId(project), runId);
    signal.throwIfAborted();
  }
  const executed = await guestTask(machines, vmId, payload.command, signal, log, timeout, agentPath, async () => {
    await scopes.closeAfterScopeStopped(vmId, projectId(project), runId);
    await afterCleanup?.();
  }, { input: payload.input, runId });
  await scopes.assertTaskIssued(vmId, projectId(project), runId, executed);
  return executed;
}
