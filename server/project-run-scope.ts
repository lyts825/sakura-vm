import { createHash, randomUUID } from 'node:crypto';
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
import { SshAgentScopes, OwnedForwardAgent, sshAgentResourceSchema, sshAgentSocketPath, bindTaskAgent,
  type SshAgentResource, type SshAgentContext } from './ssh-agent-scope.ts';
import { GpgAgentScopes, gpgAgentResourceSchema, gpgAgentHomePath, bindTaskGpg,
  type GpgAgentResource, type GpgAgentContext } from './gpg-agent-scope.ts';
import { OwnedGpgForward } from './gpg-agent-host.ts';
import { ProjectIdentities, projectIdentitySchema, projectIdentityRunSchema, projectIdentityNetworkSchema,
  type ProjectIdentity, type ProjectIdentityRun, type ProjectIdentityExecution } from './project-identity.ts';
import { projectIdentitySshDaemonSchema, type ProjectIdentitySshDaemon } from './project-identity.ts';

const bindingSchema = z.object({ directory: z.string().min(1), networkIsolation: z.enum(['host', 'private']) }).strict();
const ownerSchema = z.object({ kind: z.enum(['task', 'main', 'service', 'terminal', 'ssh']), runId: z.uuid(), bootId: z.uuid(),
  cgroupName: z.string().regex(/^(openrc\.sakura-ssh-(default|[a-f0-9]{16})|system\.slice\/sakura-ssh-(default|[a-f0-9]{16})\.service)$/).optional(),
}).strict().refine(value => (value.kind === 'ssh') === Boolean(value.cgroupName));
export type ProjectRunOwner = z.infer<typeof ownerSchema>;
const terminalSchema = z.object({ name: z.string().regex(/^sakura-terminal-(default|[a-f0-9]{16})-[a-z0-9-]{1,48}$/),
  persistent: z.boolean() }).strict();
const cacheTransferSchema = z.object({ stageId: z.uuid(), manager: z.enum(['npm', 'pip']),
  build: z.string().regex(/^[a-f0-9]{64}$/), phase: z.enum(['pending', 'closed']) }).strict();
export type ProjectTaskResourceDescriptor = Omit<z.infer<typeof cacheTransferSchema>, 'phase'>;
const entrySchema = z.object({ version: z.literal(1), projectId: projectIdSchema, identity: projectIdentitySchema,
  runId: z.uuid(), owner: ownerSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['intent', 'active', 'closed']), run: projectIdentityRunSchema.nullable(),
  cacheTransfer: cacheTransferSchema.optional(),
  sshAgent: sshAgentResourceSchema.optional(),
  gpgAgent: gpgAgentResourceSchema.optional(),
  terminal: terminalSchema.optional(),
  retirement: z.object({ reason: z.literal('guest-reboot'), bootId: z.uuid() }).strict().optional() }).strict()
  .superRefine((value, ctx) => {
    if (value.projectId !== value.identity.projectId || value.runId !== value.owner.runId ||
        (value.owner.kind === 'ssh' && !['openrc.sakura-ssh-' + value.projectId,
          'system.slice/sakura-ssh-' + value.projectId + '.service'].includes(value.owner.cgroupName!)) ||
        (Boolean(value.terminal) !== (value.owner.kind === 'terminal')) ||
        (value.terminal && !value.terminal.name.startsWith('sakura-terminal-' + value.projectId + '-')) ||
        (value.run && (value.run.runId !== value.runId || value.run.mode !== (value.owner.kind === 'terminal' ? 'independent' : 'inherit-current') ||
          value.run.projectId !== value.projectId || value.run.identityId !== value.identity.identityId ||
          value.run.registryId !== value.identity.registryId || value.run.revision !== value.identity.revision ||
          value.run.bootId !== value.owner.bootId || value.run.cgroupName !== scopeName(value.owner))) ||
        (value.phase === 'active' && !value.run) ||
        ((value.sshAgent || value.gpgAgent) && value.owner.kind !== 'task') ||
        (value.sshAgent && value.gpgAgent) || (value.cacheTransfer && value.owner.kind !== 'task') ||
        (value.cacheTransfer?.phase === 'closed' && value.phase !== 'closed') ||
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
  Partial<Pick<ProjectIdentities, 'runReadonly' | 'networkReadonly' | 'prepare' | 'retireTerminal' | 'sshSnapshotInput' | 'prepareSsh'>> & {
    beginNetworkRelease?: (vmId: string, identity: ProjectIdentity, options: { releaseId: string; bootId: string },
      signal?: AbortSignal) => Promise<z.infer<typeof networkLeaseSchema> | null>;
    releaseNetwork?: (vmId: string, identity: ProjectIdentity, lease: z.infer<typeof networkLeaseSchema>,
      signal?: AbortSignal) => Promise<{ version: 1; phase: 'released'; releaseId: string; network: z.infer<typeof projectIdentityNetworkSchema> }>;
  };
const sharedCores = new WeakMap<Machines, ProjectIdentities>();
const scopeQueues = new WeakMap<Machines, Map<string, Promise<unknown>>>();
type TaskContext = { live: NonNullable<ReturnType<Machines['live']['get']>>; bootId: string };
export type ProjectTaskResourceContext = { identity: ProjectIdentity; owner: { kind: 'task'; runId: string; bootId: string };
  sha256: string; live: TaskContext['live'] };
export type ProjectTaskResourceReceipt = { run: ProjectIdentityRun | null;
  retirement?: { reason: 'guest-reboot'; bootId: string } };
export type ProjectTaskAdmissionOptions = { resource?: {
  descriptor: ProjectTaskResourceDescriptor;
  prepare(context: ProjectTaskResourceContext): Promise<void>;
  retire(context: ProjectTaskResourceContext, receipt: ProjectTaskResourceReceipt): Promise<void>;
}; beforeIntent?: (value: { identity: ProjectIdentity; owner: ProjectRunOwner; sha256: string }) => Promise<void>;
  expectedLive?: TaskContext['live']; expectedBootId?: string;
  sshAgent?: { resource: SshAgentResource; agent: OwnedForwardAgent; scopes?: SshAgentScopes };
  gpgAgent?: { resource: GpgAgentResource; bridge: OwnedGpgForward; scopes?: GpgAgentScopes } };
type ActiveTask = TaskContext & { file: string; entry: Entry };
const activeTasks = new WeakMap<Machines, Map<string, ActiveTask>>();
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
const scopeName = (owner: ProjectRunOwner) => owner.kind === 'ssh' ? owner.cgroupName! :
  `sakura-${owner.kind === 'terminal' ? 'identity' : owner.kind}-${owner.runId}`;
const sameIdentity = (left: ProjectIdentity, right: ProjectIdentity, rebind = false) => {
  const mutable = new Set(['phase', ...(rebind ? ['revision', 'directory', 'directoryDevice', 'directoryInode', 'networkIsolation'] : [])]);
  return Object.keys(left).every(key => mutable.has(key) || left[key as keyof ProjectIdentity] === right[key as keyof ProjectIdentity]) &&
    (left.phase !== 'active' || right.phase === 'active') && (!rebind || right.revision === left.revision + 1);
};

/** Host receipts contain identities and hashes only, never project command/environment bodies. */
export class ProjectRunScopes {
  private core: Core;
  constructor(private machines: Machines, private options: { identities?: Core; rootDirectory?: string;
    agentScopes?: Pick<SshAgentScopes, 'cleanup'>; gpgScopes?: Pick<GpgAgentScopes, 'cleanup'> } = {}) {
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
    const closed = journal.runs.filter(run => run.phase === 'closed' && run.cacheTransfer?.phase !== 'pending').slice(0, 512);
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
    if (value.runs.some(run => run.phase !== 'closed' || run.cacheTransfer?.phase === 'pending'))
      throw new AppError('项目账号仍有待确认的运行，请先完成所属运行清理', 409, 'PROJECT_IDENTITY_RUNS_MUST_STOP');
  }
  async withLock<T>(vmId: string, id: string, action: (access: Access) => Promise<T>) {
    id = projectIdSchema.parse(id);
    const key = `project-identity:${vmId}:${id}`;
    let queue = scopeQueues.get(this.machines);
    if (!queue) { queue = new Map(); scopeQueues.set(this.machines, queue); }
    const operation = (queue.get(key) || Promise.resolve()).catch(() => {}).then(() =>
      this.machines.locked(key, async () => {
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
      }));
    queue.set(key, operation);
    try { return await operation; }
    finally { if (queue.get(key) === operation) queue.delete(key); }
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
  /** Read-only resource discovery preserves active owners and never issues execution. */
  async taskResources(vmId: string, id: string) {
    const journal = await this.read(vmId, projectIdSchema.parse(id));
    return journal.runs.filter(entry => entry.cacheTransfer?.phase === 'pending').map(entry => ({
      context: { identity: structuredClone(entry.identity), owner: { ...entry.owner, kind: 'task' as const },
        sha256: entry.sha256, live: this.machines.live.get(vmId)! },
      descriptor: { stageId: entry.cacheTransfer!.stageId, manager: entry.cacheTransfer!.manager, build: entry.cacheTransfer!.build },
      active: entry.phase !== 'closed' && Boolean(activeTasks.get(this.machines)?.get(this.taskKey(vmId, id, entry.runId))) &&
        activeTasks.get(this.machines)!.get(this.taskKey(vmId, id, entry.runId))!.live === this.machines.live.get(vmId),
    }));
  }
  async completeTaskResource(vmId: string, context: ProjectTaskResourceContext, descriptor: ProjectTaskResourceDescriptor) {
    return this.withLock(vmId, context.identity.projectId, async () => {
      const journal = await this.read(vmId, context.identity.projectId), entry = journal.runs.find(run => run.runId === context.owner.runId);
      const hint = cacheTransferSchema.parse({ ...descriptor, phase: 'pending' });
      if (!entry || entry.phase !== 'closed' || !entry.cacheTransfer ||
          !same({ ...entry.cacheTransfer, phase: 'pending' }, hint) || !same(entry.identity, context.identity) ||
          !same(entry.owner, context.owner) || entry.sha256 !== context.sha256 || this.machines.live.get(vmId) !== context.live)
        throw new AppError('任务缓存退休缺少准确原 journal', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      if (entry.cacheTransfer.phase === 'closed') return;
      const boot = await this.confirmScopeStopped(vmId, entry.owner);
      if (this.machines.live.get(vmId) !== context.live || boot !== (entry.retirement?.bootId || entry.owner.bootId))
        throw new AppError('任务缓存退休开机身份改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      entry.cacheTransfer.phase = 'closed'; await this.save(vmId, context.identity.projectId, journal);
    });
  }
  /** Read the original closed proof; this cannot issue a run or authorize execution. */
  async taskResourceReceipt(vmId: string, context: ProjectTaskResourceContext): Promise<ProjectTaskResourceReceipt> {
    const id = projectIdSchema.parse(context.identity.projectId), runId = z.uuid().parse(context.owner.runId);
    const entry = (await this.read(vmId, id)).runs.find(run => run.runId === runId) ||
      await this.archived(vmId, id, runId);
    if (!entry || entry.phase !== 'closed' || entry.owner.kind !== 'task' ||
        !same(entry.identity, context.identity) || !same(entry.owner, context.owner) || entry.sha256 !== context.sha256)
      throw new AppError('任务资源缺少准确原账号核销证明', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return structuredClone({ run: entry.run, ...(entry.retirement ? { retirement: entry.retirement } : {}) });
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
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id);
      if (journal.networkRelease && journal.networkRelease.phase !== 'released')
        throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
      if (journal.pending)
        throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
    });
  }
  /** Read the complete saved host/guest network proof without issuing a run. */
  async networkStatus(vmId: string, project: Project, signal?: AbortSignal) {
    const id = projectId(project), target = binding(project);
    return this.withLock(vmId, id, async () => {
      signal?.throwIfAborted();
      const live = this.machines.live.get(vmId), journal = await this.read(vmId, id);
      const unchanged = () => {
        signal?.throwIfAborted();
        if (!live || this.machines.live.get(vmId) !== live || this.machines.state(vmId) !== 'running')
          throw new AppError('网络检查期间客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      };
      unchanged();
      if (journal.pending)
        throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
      if (journal.networkRelease && journal.networkRelease.phase !== 'released')
        throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
      if (!journal.identity || journal.identity.phase !== 'active' || target.networkIsolation !== 'private' ||
          !same(binding(journal.identity), target))
        throw new AppError('当前项目尚无已确认的私有网络账号绑定，请先启动项目', 409, 'PROJECT_IDENTITY_NETWORK_UNPREPARED');
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      if (!this.core.networkReadonly)
        throw new AppError('项目网络只读检查入口不可用', 409, 'PROJECT_IDENTITY_READONLY_UNAVAILABLE');
      const proof = await this.core.networkReadonly(vmId, journal.identity, signal);
      unchanged();
      const current = await this.read(vmId, id);
      if (!same(current.identity, journal.identity) || !same(current.pending, journal.pending) ||
          !same(current.networkRelease, journal.networkRelease))
        throw new AppError('网络检查期间原项目绑定已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      unchanged();
      return proof;
    });
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
      entry.run = run; entry.phase = run.phase === 'closed' && !entry.sshAgent && !entry.gpgAgent ? 'closed' : 'active';
      await this.save(vmId, id, journal);
      this.pinActiveTask(vmId, id, entry, run);
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
  async taskRun(vmId: string, id: string, runId: string) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(value => value.runId === runId) || await this.archived(vmId, id, runId);
    if (!entry) return null;
    if (entry.owner.kind !== 'task') throw new AppError('原运行不属于任务域', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return structuredClone({ identity: entry.identity, owner: entry.owner, sha256: entry.sha256, phase: entry.phase, run: entry.run });
  }
  async readonlyTask(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    const entry = await this.taskRun(vmId, id, runId);
    if (!entry || entry.phase !== 'active' || !entry.run || entry.run.phase !== 'active')
      throw new AppError('原完整任务票据未登记，拒绝只读接管', 409, 'PROJECT_IDENTITY_RUN_STALE');
    if (!this.core.runReadonly) throw new AppError('账号只读核对入口不可用', 409, 'PROJECT_IDENTITY_READONLY_UNAVAILABLE');
    const live = this.machines.live.get(vmId), run = await this.core.runReadonly(vmId, entry.identity, runId, signal);
    if (!live || this.machines.live.get(vmId) !== live || run.phase !== 'active' ||
        !same(run, entry.run) || !same(await this.taskRun(vmId, id, runId), entry) || this.machines.live.get(vmId) !== live)
      throw new AppError('账号只读回执与原完整任务不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    return { identity: structuredClone(entry.identity), owner: { ...entry.owner }, sha256: entry.sha256,
      run: structuredClone(entry.run), phase: entry.phase };
  }
  private matches(entry: Entry, run: ProjectIdentityRun) {
    return run.mode === (entry.owner.kind === 'terminal' ? 'independent' : 'inherit-current') &&
      run.cgroupName === scopeName(entry.owner) && run.bootId === entry.owner.bootId &&
      run.runId === entry.runId && run.projectId === entry.projectId && run.identityId === entry.identity.identityId &&
      run.registryId === entry.identity.registryId && run.revision === entry.identity.revision &&
      (!entry.run || same({ ...run, phase: entry.run.phase }, entry.run));
  }
  async inherited(vmId: string, project: Project, execution: ProjectIdentityExecution,
    owner: ProjectRunOwner, signal?: AbortSignal): Promise<ProjectInheritedPayload> {
    owner = ownerSchema.parse(owner);
    if (owner.kind === 'terminal' || owner.kind === 'ssh') throw new AppError('会话须使用专属运行登记入口', 400);
    return this.withLock(vmId, projectId(project), () =>
      this.inheritedUnlocked(vmId, project, execution, owner, signal));
  }
  private async inheritedUnlocked(vmId: string, project: Project, execution: ProjectIdentityExecution,
    owner: ProjectRunOwner, signal?: AbortSignal, sshAgent?: SshAgentResource,
    gpgAgent?: GpgAgentResource,
    beforeIntent?: (identity: ProjectIdentity, sha256: string) => Promise<void>,
    cacheTransfer?: z.infer<typeof cacheTransferSchema>): Promise<ProjectInheritedPayload> {
      const identity = await this.reserveUnlocked(vmId, project, false, signal), id = identity.projectId;
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      const journal = await this.read(vmId, id);
      const payload = await this.core.inheritedInput(identity, execution, { runId: owner.runId });
      if (payload.runId !== owner.runId || createHash('sha256').update(payload.input).digest('hex') !== payload.sha256)
        throw new AppError('项目正文摘要或本次运行身份不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      signal?.throwIfAborted();
      const entry: Entry = { version: 1, projectId: id, identity, runId: owner.runId, owner,
        sha256: payload.sha256, phase: 'intent', run: null, ...(sshAgent ? { sshAgent } : {}),
        ...(gpgAgent ? { gpgAgent } : {}), ...(cacheTransfer ? { cacheTransfer } : {}) };
      if (await this.archived(vmId, id, owner.runId))
        throw new AppError('项目账号运行票据已经归档，拒绝重新执行', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const prior = journal.runs.find(run => run.runId === owner.runId);
      if (prior) {
        if (prior.phase !== 'intent' || !same(prior, entry))
          throw new AppError('项目账号运行票据已存在或被关闭，拒绝重新执行', 409, 'PROJECT_IDENTITY_RUN_STALE');
      } else {
        await this.compact(vmId, id, journal);
      }
      // GPG helpers have an independent host lifetime. Its exact unstarted
      // receipt must exist before a durable project intent can need recovery.
      await beforeIntent?.(identity, payload.sha256);
      signal?.throwIfAborted();
      if (!prior) journal.runs.push(entry);
      await this.save(vmId, id, journal);
      // A process cannot survive a real guest reboot between this guard and
      // launcher entry. No user command/environment is part of this argv.
      const command = `test "$(cat /proc/sys/kernel/random/boot_id)" = ${quote(owner.bootId)} && ${payload.command}`;
      return { ...payload, command, identity, runId: owner.runId };
  }
  async terminalRuns(vmId: string, id: string) {
    id = projectIdSchema.parse(id);
    const journal = await this.read(vmId, id);
    return journal.runs.filter(entry => entry.owner.kind === 'terminal' && entry.phase !== 'closed')
      .map(entry => ({ runId: entry.runId, terminal: entry.terminal!, phase: entry.phase }));
  }
  async sshRuns(vmId: string, id: string) {
    id = projectIdSchema.parse(id);
    return (await this.read(vmId, id)).runs.filter(entry => entry.owner.kind === 'ssh' && entry.phase !== 'closed')
      .map(entry => ({ runId: entry.runId, owner: entry.owner, identity: entry.identity,
        sha256: entry.sha256, run: entry.run, phase: entry.phase }));
  }
  async beginSsh(vmId: string, project: Project, runId: string,
    owner: ProjectRunOwner, environment: Record<string, string>, signal?: AbortSignal) {
    runId = z.uuid().parse(runId); owner = ownerSchema.parse(owner);
    if (owner.kind !== 'ssh' || owner.runId !== runId || !['openrc.sakura-ssh-' + projectId(project),
        'system.slice/sakura-ssh-' + projectId(project) + '.service'].includes(owner.cgroupName!))
      throw new AppError('SSH 登记身份不符', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return this.withLock(vmId, projectId(project), async () => {
      const context = await this.taskContext(vmId, signal);
      if (context.bootId !== owner.bootId) throw new AppError('SSH 登记期间客户机已重启', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const identity = await this.reserveUnlocked(vmId, project, false, signal), id = identity.projectId;
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      if (!this.core.sshSnapshotInput) throw new AppError('项目 SSH 登记入口不可用', 503);
      const journal = await this.read(vmId, id);
      if (journal.runs.some(entry => entry.runId === runId || entry.owner.kind === 'ssh' && entry.phase !== 'closed') ||
          await this.archived(vmId, id, runId))
        throw new AppError('项目 SSH 原运行尚未清理', 409, 'PROJECT_IDENTITY_RUN_STALE');
      await this.compact(vmId, id, journal);
      const snapshot = await this.core.sshSnapshotInput(identity, runId, environment);
      if (snapshot.runId !== runId || createHash('sha256').update(snapshot.input).digest('hex') !== snapshot.sha256)
        throw new AppError('项目 SSH 环境摘要不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const current = await this.taskContext(vmId, signal);
      if (current.live !== context.live || current.bootId !== context.bootId)
        throw new AppError('项目 SSH 登记期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const entry: Entry = { version: 1, projectId: id, identity, owner, runId,
        sha256: snapshot.sha256, phase: 'intent', run: null };
      journal.runs.push(entry); await this.save(vmId, id, journal);
      return { identity, owner, snapshot };
    });
  }
  async activateSsh(vmId: string, id: string, runId: string, daemon: ProjectIdentitySshDaemon, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId); daemon = projectIdentitySshDaemonSchema.parse(daemon);
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.runId === runId);
      if (!entry || entry.owner.kind !== 'ssh' || entry.phase !== 'intent' || entry.run || !this.core.prepareSsh ||
          entry.owner.bootId !== daemon.bootId || scopeName(entry.owner) !== daemon.cgroupName)
        throw new AppError('SSH 原启动登记或服务身份不符', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const context = await this.taskContext(vmId, signal);
      if (context.bootId !== daemon.bootId) throw new AppError('SSH 启动期间客户机已重启', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const run = await this.core.prepareSsh(vmId, entry.identity, { runId, daemon, snapshotSha256: entry.sha256 }, signal);
      const current = await this.taskContext(vmId, signal);
      if (current.live !== context.live || current.bootId !== context.bootId || run.phase !== 'active' || !this.matches(entry, run))
        throw new AppError('SSH 完整运行归属未确认，原登记保留', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      entry.run = run; entry.phase = 'active'; await this.save(vmId, id, journal);
      return { identity: entry.identity, run, owner: entry.owner, sha256: entry.sha256 };
    });
  }
  async recoverSshTicket(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.runId === runId);
      if (!entry || entry.owner.kind !== 'ssh' || entry.phase === 'closed')
        throw new AppError('SSH 原启动登记不存在或已关闭，拒绝恢复其他运行', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const context = await this.taskContext(vmId, signal);
      if (context.bootId !== entry.owner.bootId)
        throw new AppError('客户机已重启，原 SSH 票据须在全域停止后核销', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const unchanged = async () => {
        const current = await this.taskContext(vmId, signal);
        if (current.live !== context.live || current.bootId !== context.bootId ||
            !same(await this.read(vmId, id), journal))
          throw new AppError('SSH 恢复期间客户机或主机原登记已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        signal?.throwIfAborted();
      };
      let run: ProjectIdentityRun;
      try { run = await this.core.run(vmId, entry.identity, runId, signal); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) throw error;
        await unchanged(); return null;
      }
      const checked = projectIdentityRunSchema.safeParse(run);
      if (!checked.success || !this.matches(entry, checked.data) ||
          checked.data.namespace !== (entry.identity.networkIsolation === 'private' ? 'sk-' + id : '') ||
          (entry.run?.phase === 'closed' && checked.data.phase !== 'closed'))
        throw new AppError('SSH 完整恢复票据与原运行不可变归属不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      await unchanged();
      // This is a cleanup query, never another prepare. Even a closed native
      // receipt keeps the host run guarded until its whole original domain is
      // confirmed stopped by closeAfterScopeStopped.
      entry.run = checked.data; entry.phase = 'active'; await this.save(vmId, id, journal);
      return { runId: entry.runId, owner: entry.owner, identity: entry.identity,
        sha256: entry.sha256, run: entry.run, phase: entry.phase };
    });
  }
  async sshRun(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId);
    if (!entry || entry.owner.kind !== 'ssh' || entry.phase !== 'active' || !entry.run || !this.core.runReadonly)
      throw new AppError('SSH 完整账号票据尚未确认，请先停止原服务', 409, 'PROJECT_IDENTITY_RUN_STALE');
    const instance = this.machines.live.get(vmId), run = await this.core.runReadonly(vmId, entry.identity, runId, signal);
    if (!instance || this.machines.live.get(vmId) !== instance || run.phase !== 'active' || !this.matches(entry, run))
      throw new AppError('SSH 原账号运行归属已改变', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return { identity: entry.identity, run, owner: entry.owner, sha256: entry.sha256 };
  }
  async retireRebootedTerminals(vmId: string, id: string) {
    id = projectIdSchema.parse(id);
    const context = await this.taskContext(vmId), journal = await this.read(vmId, id);
    for (const entry of journal.runs) {
      if (entry.owner.kind === 'terminal' && entry.phase !== 'closed' && entry.owner.bootId !== context.bootId)
        await this.stopTerminal(vmId, id, entry.runId);
    }
  }
  async prepareTerminal(vmId: string, project: Project, runId: string,
    terminal: z.infer<typeof terminalSchema>, signal?: AbortSignal) {
    runId = z.uuid().parse(runId); terminal = terminalSchema.parse(terminal);
    return this.withLock(vmId, projectId(project), async () => {
      const context = await this.taskContext(vmId, signal), identity = await this.reserveUnlocked(vmId, project, false, signal);
      const id = identity.projectId;
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      if (!this.core.prepare) throw new AppError('项目终端独立运行入口不可用', 503);
      const journal = await this.read(vmId, id);
      if (journal.runs.some(entry => entry.runId === runId ||
          (entry.owner.kind === 'terminal' && entry.phase !== 'closed' && entry.terminal?.name === terminal.name)) ||
          await this.archived(vmId, id, runId))
        throw new AppError('终端运行已登记，请先核对或停止原会话', 409, 'PROJECT_IDENTITY_RUN_STALE');
      await this.compact(vmId, id, journal);
      const owner: ProjectRunOwner = { kind: 'terminal', runId, bootId: context.bootId };
      const entry: Entry = { version: 1, projectId: id, identity, owner, runId, terminal,
        sha256: createHash('sha256').update(JSON.stringify({ identity, owner, terminal })).digest('hex'),
        phase: 'intent', run: null };
      journal.runs.push(entry); await this.save(vmId, id, journal);
      const run = await this.core.prepare(vmId, identity, { runId }, signal);
      const current = await this.taskContext(vmId, signal);
      if (current.live !== context.live || current.bootId !== context.bootId || run.phase !== 'active' || !this.matches(entry, run))
        throw new AppError('项目终端完整运行归属未确认，原 intent 保留', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      entry.run = run; entry.phase = 'active'; await this.save(vmId, id, journal);
      return { identity, run, terminal };
    });
  }
  async terminalRun(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId);
    if (!entry || entry.owner.kind !== 'terminal' || entry.phase !== 'active' || !entry.run || !this.core.runReadonly)
      throw new AppError('终端的完整运行票据尚未确认，请先停止原会话', 409, 'PROJECT_IDENTITY_RUN_STALE');
    const instance = this.machines.live.get(vmId), run = await this.core.runReadonly(vmId, entry.identity, runId, signal);
    if (!instance || this.machines.live.get(vmId) !== instance || run.phase !== 'active' || !this.matches(entry, run))
      throw new AppError('终端已结束或客户机运行归属已改变', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return { identity: entry.identity, run, terminal: entry.terminal! };
  }
  async stopTerminal(vmId: string, id: string, runId: string) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    return this.withLock(vmId, id, async () => {
      const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId);
      if (!entry) {
        const prior = await this.archived(vmId, id, runId);
        if (prior?.owner.kind === 'terminal') return;
        throw new AppError('原终端运行记录不存在，清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      }
      if (entry.owner.kind !== 'terminal') throw new AppError('停止请求不属于交互终端', 409);
      if (entry.phase === 'closed') return;
      const context = await this.taskContext(vmId);
      if (context.bootId === entry.owner.bootId) {
        let run: ProjectIdentityRun;
        try { run = await this.core.run(vmId, entry.identity, runId); }
        catch (error) {
          if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) throw error;
          await this.closeUnlocked(vmId, id, runId); return;
        }
        if (!this.matches(entry, run)) throw new AppError('终端运行票据已改变，拒绝停止其他运行', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        const stopped = await this.core.stop(vmId, entry.identity, run);
        if (stopped.phase !== 'closed' || !same({ ...stopped, phase: run.phase }, run) || !this.core.retireTerminal)
          throw new AppError('原终端停止回执未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        await this.core.retireTerminal(vmId, entry.identity, stopped);
      } else {
        const paths = ['/run/sakura-project-terminals/' + runId, '/run/sakura-project-identities/terminals/' + runId + '.json'];
        const result = await this.machines.exec(vmId,
          `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S -c ${quote(
            `import os\nassert all(not os.path.lexists(p) for p in ${JSON.stringify(paths)})\n`)}`, 10000);
        if (result.code !== 0) throw new AppError('新开机仍存在原终端资源，保留核销记录', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      }
      if (this.machines.live.get(vmId) !== context.live || await this.kernelBoot(vmId) !== context.bootId)
        throw new AppError('终端清理期间客户机身份改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await this.closeUnlocked(vmId, id, runId);
    }).catch(error => {
      if (error instanceof AppError && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED') throw error;
      throw new AppError('原终端全域或资源清理尚未确认，保留原运行记录：' +
        (error instanceof Error ? error.message : String(error)), 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    });
  }
  async stopTerminals(vmId: string, id: string, name?: string) {
    const runs = await this.terminalRuns(vmId, id);
    for (const entry of runs) if (!name || entry.terminal.name === name) await this.stopTerminal(vmId, id, entry.runId);
  }
  private taskKey(vmId: string, id: string, runId: string) {
    return vmId + ':' + id + ':' + runId;
  }
  private taskMetadataMatches(record: ActiveTask, entry: Entry) {
    return entry.owner.kind === 'task' && entry.version === record.entry.version &&
      entry.projectId === record.entry.projectId && entry.runId === record.entry.runId &&
      entry.sha256 === record.entry.sha256 && same(entry.owner, record.entry.owner) &&
      same(entry.identity, record.entry.identity) && same(entry.sshAgent, record.entry.sshAgent) &&
      same(entry.gpgAgent, record.entry.gpgAgent) && same(entry.cacheTransfer, record.entry.cacheTransfer);
  }
  private pinActiveTask(vmId: string, id: string, entry: Entry, run: ProjectIdentityRun) {
    const record = activeTasks.get(this.machines)?.get(this.taskKey(vmId, id, entry.runId));
    if (!record || record.file !== this.file(vmId, id) || record.live !== this.machines.live.get(vmId) ||
        record.bootId !== run.bootId || !this.taskMetadataMatches(record, entry)) return;
    if (record.entry.run && !same({ ...run, phase: record.entry.run.phase }, record.entry.run))
      throw new AppError('当前任务完整票据已变化', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    record.entry.run = structuredClone(run);
  }
  private isActiveTask(vmId: string, id: string, entry: Entry, context?: TaskContext) {
    const record = activeTasks.get(this.machines)?.get(this.taskKey(vmId, id, entry.runId));
    if (!record || !context || record.file !== this.file(vmId, id) ||
        record.live !== context.live || record.live !== this.machines.live.get(vmId) ||
        record.bootId !== context.bootId || !this.taskMetadataMatches(record, entry)) return false;
    return entry.run === null ? record.entry.run === null : Boolean(record.entry.run &&
      same({ ...entry.run, phase: record.entry.run.phase }, record.entry.run));
  }
  private async taskContext(vmId: string, signal?: AbortSignal): Promise<TaskContext> {
    const live = this.machines.live.get(vmId), result = await this.machines.exec(vmId,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10000, signal);
    const bootId = z.uuid().safeParse(result.stdout.trim());
    if (result.code !== 0 || !bootId.success || !live || this.machines.live.get(vmId) !== live)
      throw new AppError('无法固定客户机开机身份，项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    return { live, bootId: bootId.data };
  }
  /** Only this admission creates an in-process owner; disk receipts never do. */
  async admitTask(vmId: string, project: Project, execution: ProjectIdentityExecution, signal: AbortSignal,
    options: ProjectTaskAdmissionOptions = {}) {
    const id = projectId(project);
    await (new (await import('./project-cache-transfer.ts')).ProjectCacheTransfers(this.machines, { scopes: this, rootDirectory: this.options.rootDirectory })).recover(vmId, id);
    const cacheTransfer = options.resource ? cacheTransferSchema.parse({ ...options.resource.descriptor, phase: 'pending' }) : undefined;
    const expectedLive = options.expectedLive;
    const forwarding = options.sshAgent ? { ...options.sshAgent,
      resource: sshAgentResourceSchema.parse(options.sshAgent.resource) } : undefined;
    const gpgForwarding = options.gpgAgent ? { ...options.gpgAgent,
      resource: gpgAgentResourceSchema.parse(options.gpgAgent.resource) } : undefined;
    if (forwarding && gpgForwarding)
      throw new AppError('单次任务不能同时登记两种 Agent 转发', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    return this.withLock(vmId, id, async () => {
      signal.throwIfAborted();
      const context = await this.taskContext(vmId, signal), runId = randomUUID();
      if ((expectedLive && context.live !== expectedLive) || (options.expectedBootId && context.bootId !== z.uuid().parse(options.expectedBootId)))
        throw new AppError('客户机运行身份与本次任务准备不符，项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      await this.recoverStoppedTasksUnlocked(vmId, id, context);
      const owner: ProjectRunOwner = { kind: 'task', runId, bootId: context.bootId };
      const resource = forwarding?.resource;
      const gpgResource = gpgForwarding?.resource;
      if (forwarding && !(forwarding.agent instanceof OwnedForwardAgent))
        throw new AppError('SSH Agent 缺少本次独立的宿主 stream owner', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      if (gpgForwarding && (!(gpgForwarding.bridge instanceof OwnedGpgForward) ||
          gpgForwarding.bridge.hostSourceSha256 !== gpgResource!.hostSourceSha256 ||
          gpgForwarding.bridge.hostHelperSha256 !== gpgResource!.hostHelperSha256))
        throw new AppError('GPG Agent 宿主来源与本次资源摘要不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const body = resource ? { ...execution, environment: { ...execution.environment,
        SSH_AUTH_SOCK: sshAgentSocketPath(resource.leaseId) } } : gpgResource ? {
          ...execution, environment: { ...execution.environment, GNUPGHOME: gpgAgentHomePath(gpgResource.leaseId) },
        } : execution;
      const payload = await this.inheritedUnlocked(vmId, project, body, owner, signal, resource, gpgResource,
        options.beforeIntent || gpgResource && gpgForwarding ? async (identity, sha256) => {
          await options.beforeIntent?.({ identity: structuredClone(identity), owner: { ...owner }, sha256 });
          if (gpgResource && gpgForwarding)
            await gpgForwarding.bridge.prepareAdmission({ resource: structuredClone(gpgResource), identity,
              owner: { ...owner, kind: 'task' }, sha256 }, context.live, signal);
        } : undefined, cacheTransfer);
      const current = await this.taskContext(vmId);
      if (current.live !== context.live || current.bootId !== context.bootId)
        throw new AppError('客户机身份在任务入场期间改变，原 intent 保留', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const entry: Entry = { version: 1, projectId: id, identity: structuredClone(payload.identity),
        owner, runId, sha256: payload.sha256, phase: 'intent', run: null,
        ...(resource ? { sshAgent: structuredClone(resource) } : {}),
        ...(gpgResource ? { gpgAgent: structuredClone(gpgResource) } : {}), ...(cacheTransfer ? { cacheTransfer } : {}) };
      const agentContext: SshAgentContext | undefined = resource ? {
        resource: structuredClone(resource), identity: payload.identity,
        owner: { ...owner, kind: 'task' }, sha256: payload.sha256 } : undefined;
      const gpgContext: GpgAgentContext | undefined = gpgResource ? {
        resource: structuredClone(gpgResource), identity: payload.identity,
        owner: { ...owner, kind: 'task' }, sha256: payload.sha256 } : undefined;
      const unbind = agentContext && forwarding ?
        bindTaskAgent(this.machines, vmId, agentContext, forwarding.agent, context.live) : undefined;
      const unbindGpg = gpgContext && gpgForwarding ?
        bindTaskGpg(this.machines, vmId, gpgContext, gpgForwarding.bridge, context.live) : undefined;
      const record: ActiveTask = { ...context, file: this.file(vmId, id), entry };
      let registry = activeTasks.get(this.machines);
      if (!registry) { registry = new Map(); activeTasks.set(this.machines, registry); }
      const key = this.taskKey(vmId, id, runId);
      registry.set(key, record);
      return { payload, live: context.live, owner: { ...owner, kind: 'task' as const }, agentContext, forwarding, gpgContext, gpgForwarding, release: () => {
        unbind?.(); unbindGpg?.();
        if (registry.get(key) === record) registry.delete(key);
      } };
    });
  }
  private async confirmScopeStopped(vmId: string, owner: ProjectRunOwner) {
    const source = `import json,os,stat\nname=${JSON.stringify(scopeName(owner))}\nboot=open('/proc/sys/kernel/random/boot_id').read().strip()\nmounts=open('/proc/self/mountinfo').read().splitlines()\nassert any(len(line.split())>6 and line.split()[4]=='/sys/fs/cgroup' and line.split()[3]=='/' and ' - cgroup2 ' in line for line in mounts)\npath='/sys/fs/cgroup'\ninfo=os.lstat(path)\nassert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\nfor part in name.split('/')[:-1]:\n path+='/'+part\n if not os.path.lexists(path): break\n info=os.lstat(path)\n assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\nassert not os.path.lexists('/sys/fs/cgroup/'+name)\nprint(json.dumps({'bootId':boot,'absent':True}))\n`;
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
  private async recoverStoppedTasksUnlocked(vmId: string, id: string, context?: TaskContext) {
    const journal = await this.read(vmId, id);
    if (!context && journal.runs.some(entry =>
      activeTasks.get(this.machines)?.has(this.taskKey(vmId, id, entry.runId))))
      context = await this.taskContext(vmId);
    for (const entry of journal.runs) {
      if (entry.owner.kind === 'task' && entry.phase !== 'closed' && !this.isActiveTask(vmId, id, entry, context))
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
      const closeAgent = async () => {
        if (!entry.sshAgent && !entry.gpgAgent) return;
        if (entry.owner.kind !== 'task') throw new AppError('Agent 归属不是单次任务', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        if (entry.sshAgent) await (this.options.agentScopes || new SshAgentScopes(this.machines)).cleanup(vmId, {
          resource: entry.sshAgent, identity: entry.identity, owner: { ...entry.owner, kind: 'task' }, sha256: entry.sha256 });
        if (entry.gpgAgent) await (this.options.gpgScopes || new GpgAgentScopes(this.machines)).cleanup(vmId, {
          resource: entry.gpgAgent, identity: entry.identity, owner: { ...entry.owner, kind: 'task' }, sha256: entry.sha256 });
        await unchanged();
        if (await this.confirmScopeStopped(vmId, entry.owner) !== currentBoot)
          throw new AppError('Agent 清理期间客户机开机身份已改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        await unchanged();
      };
      if (currentBoot !== entry.owner.bootId) {
        if (await this.confirmScopeStopped(vmId, entry.owner) !== currentBoot)
          throw new AppError('客户机开机身份再次改变，原账号运行核销未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        await unchanged();
        await closeAgent();
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
        await closeAgent();
        entry.phase = 'closed'; await this.save(vmId, id, journal); return;
      }
      if (!this.matches(entry, run))
        throw new AppError('账号票据的上层运行归属不符', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      // A closed native receipt cannot retire an unresolved Agent resource.
      entry.run = run; entry.phase = run.phase === 'closed' && !entry.sshAgent && !entry.gpgAgent ? 'closed' : 'active';
      await this.save(vmId, id, journal);
      this.pinActiveTask(vmId, id, entry, run);
      if (entry.phase === 'closed') return;
      // Once a complete ticket was received, an absent or changed receipt is
      // never treated as a task that did not start.
      await this.confirmScopeStopped(vmId, entry.owner); await unchanged();
      await closeAgent();
      if (run.phase === 'closed') { entry.phase = 'closed'; await this.save(vmId, id, journal); return; }
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
  timeout = 1200000, agentPath?: string, afterCleanup?: () => Promise<void>,
  options: ProjectTaskAdmissionOptions = {}) {
  signal.throwIfAborted();
  const scopes = new ProjectRunScopes(machines), admission = await scopes.admitTask(vmId, project, execution, signal, options);
  const { payload } = admission, runId = payload.runId;
  const resourceContext: ProjectTaskResourceContext = { identity: structuredClone(payload.identity),
    owner: admission.owner, sha256: payload.sha256, live: admission.live };
  let launched = false;
  try {
    await options.resource?.prepare(resourceContext);
    if (machines.live.get(vmId) !== admission.live)
      throw new AppError('客户机运行身份在任务启动前改变，原 intent 保留且项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    if (signal.aborted) {
      await scopes.closeAfterScopeStopped(vmId, projectId(project), runId);
      signal.throwIfAborted();
    }
    let command = payload.command;
    if (admission.agentContext && admission.forwarding) {
      const agentScopes = admission.forwarding.scopes || new SshAgentScopes(machines);
      await agentScopes.install(vmId, admission.agentContext.resource, signal);
      if (machines.live.get(vmId) !== admission.live)
        throw new AppError('Agent 安装期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      command = agentScopes.command('run', admission.agentContext, payload.command);
    }
    if (admission.gpgContext && admission.gpgForwarding) {
      const gpgScopes = admission.gpgForwarding.scopes || new GpgAgentScopes(machines);
      await gpgScopes.install(vmId, admission.gpgContext.resource, signal);
      const prepared = await gpgScopes.prepare(vmId, admission.gpgContext, signal);
      if (machines.live.get(vmId) !== admission.live)
        throw new AppError('GPG 准备期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      await admission.gpgForwarding.bridge.start(machines, vmId, admission.gpgContext, prepared.sourcePath, signal);
      if (machines.live.get(vmId) !== admission.live)
        throw new AppError('GPG 转发准备期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      command = gpgScopes.command('run', admission.gpgContext, payload.command);
    }
    launched = true;
    const executed = await guestTask(machines, vmId, command, signal, log, timeout,
      admission.forwarding?.agent || agentPath, async () => {
      await scopes.closeAfterScopeStopped(vmId, projectId(project), runId);
      if (options.resource) {
        await options.resource.retire(resourceContext, await scopes.taskResourceReceipt(vmId, resourceContext));
        await scopes.completeTaskResource(vmId, resourceContext, options.resource.descriptor);
      }
      await afterCleanup?.();
    }, { input: payload.input, runId, ...(admission.agentContext ? { forwardedAgent: true } : {}) });
    await scopes.assertTaskIssued(vmId, projectId(project), runId, executed);
    return executed;
  } catch (error) {
    if (!launched && (admission.agentContext || admission.gpgContext || options.resource)) {
      if (machines.live.get(vmId) !== admission.live)
        throw new AppError('客户机运行身份改变，任务资源核销未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await scopes.closeAfterScopeStopped(vmId, projectId(project), runId);
      if (options.resource) {
        await options.resource.retire(resourceContext, await scopes.taskResourceReceipt(vmId, resourceContext));
        await scopes.completeTaskResource(vmId, resourceContext, options.resource.descriptor);
      }
    }
    throw error;
  } finally { admission.release(); }
}
