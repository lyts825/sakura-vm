import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Duplex, type Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { projectVersion, projectPrivateValues, type Project, type Workspaces } from './workspaces.ts';
import { AppError, vmDir } from './model.ts';
import { quote } from './files.ts';
import { readStore, writeStore } from './local-store.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { ProjectRunScopes, type ProjectTaskAdmissionOptions } from './project-run-scope.ts';
import { ProjectIdentities, projectIdentitySchema, projectIdentityRunSchema, projectIdentityPayload,
  type ProjectIdentity, type ProjectIdentityExecution, type ProjectIdentityRun } from './project-identity.ts';
import { guestTaskControlPlan, guestTaskControlPaths, cleanupGuestTaskPlan } from './guest-task.ts';
import { projectIdSchema } from './project-catalog.ts';
import { redactValues } from './secrets.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/), uuidFile = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/;
const same = isDeepStrictEqual;
const changed = () => new AppError('协议流原项目、配置、账号或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
const cloneProject = (project: Project) => Object.defineProperty(structuredClone(project), '_workspace', {
  value: project._workspace, enumerable: false,
});
function immutable(record: ProjectProtocolStreamRecord) {
  const { phase: _phase, issued: _issued, run: _run, closure: _closure, ...metadata } = record;
  return metadata;
}
export const projectProtocolStreamSchema = z.object({ version: z.literal(1), vmId: z.uuid(), projectId: projectIdSchema,
  kind: z.enum(['lsp', 'dap']), runId: z.uuid(), bootId: z.uuid(), controlToken: z.uuid(), configSha256: hash,
  identity: projectIdentitySchema, sha256: hash, timeoutMs: z.number().int().min(1000).max(24 * 60 * 60 * 1000),
  phase: z.enum(['intent', 'active', 'review', 'closed']), issued: z.boolean(), run: projectIdentityRunSchema.nullable(),
  closure: z.object({ reason: z.enum(['scope-stopped', 'guest-reboot', 'never-issued']), bootId: z.uuid() }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.identity.projectId !== value.projectId || value.identity.phase !== 'active' ||
      value.phase === 'active' && (!value.issued || !value.run || value.run.phase !== 'active') ||
      (value.phase === 'closed') !== Boolean(value.closure) || value.closure && (
        value.closure.reason === 'guest-reboot' ? value.closure.bootId === value.bootId : value.closure.bootId !== value.bootId) ||
      value.run && !matches(value, value.run)) context.addIssue({ code: 'custom', message: '协议流原完整运行归属不符' });
});
export type ProjectProtocolStreamRecord = z.infer<typeof projectProtocolStreamSchema>;
export type ProjectProtocolCapture = { projectId: string; project: Project; resolved: Project; configSha256: string;
  live: object; bootId: string; signal: AbortSignal };
function matches(record: Pick<ProjectProtocolStreamRecord, 'identity' | 'runId' | 'bootId' | 'projectId'>, run: ProjectIdentityRun) {
  const identity = record.identity;
  return run.mode === 'inherit-current' && run.projectId === record.projectId && run.runId === record.runId &&
    run.bootId === record.bootId && run.cgroupName === 'sakura-task-' + record.runId &&
    run.registryId === identity.registryId && run.identityId === identity.identityId && run.revision === identity.revision &&
    run.namespace === (identity.networkIsolation === 'private' ? 'sk-' + record.projectId : '');
}

/** Only the first bounded frame is consumed here. The unread protocol channel
 * is inherited independently as fd3; C accepts frame+EOF before its UID drop. */
export function projectProtocolRelaySource(sha256: string, command: string) {
  hash.parse(sha256);
  if (Buffer.byteLength(command) > 8192 || command.includes('\0')) throw changed();
  return `import fcntl,hashlib,json,os,selectors,signal,stat,struct,subprocess,time
request=json.loads(${JSON.stringify(JSON.stringify({ sha256, command }))})
def refuse():raise ValueError('protected protocol stream frame refused')
def frame():
 info=os.fstat(0);flags=fcntl.fcntl(0,fcntl.F_GETFL)
 if flags&os.O_ACCMODE==os.O_WRONLY or not (stat.S_ISFIFO(info.st_mode) or stat.S_ISSOCK(info.st_mode)):refuse()
 deadline=time.monotonic()+8;fcntl.fcntl(0,fcntl.F_SETFL,flags|os.O_NONBLOCK)
 try:
  with selectors.DefaultSelector() as poller:
   poller.register(0,selectors.EVENT_READ)
   def exact(size):
    data=b''
    while len(data)<size:
     remaining=deadline-time.monotonic()
     if remaining<=0 or not poller.select(remaining):refuse()
     try:part=os.read(0,min(65536,size-len(data)))
     except (BlockingIOError,InterruptedError):continue
     if not part:refuse()
     data+=part
    return data
   header=exact(32);magic,version,flags2,body,count,script,reserved=struct.unpack('<8s6I',header)
   if magic!=b'SKIDP001' or version!=1 or flags2!=2 or reserved or body>131040 or not 0<script<=65536 or script>body or count>128:refuse()
   payload=header+exact(body)
   if hashlib.sha256(payload).hexdigest()!=request['sha256']:refuse()
   return payload
 finally:fcntl.fcntl(0,fcntl.F_SETFL,flags)
payload=frame()
environment={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','USER':'root','LOGNAME':'root','LANG':'C','LC_ALL':'C'}
os.dup2(0,3)
try:child=subprocess.Popen(['/bin/sh','-ec',request['command']],stdin=subprocess.PIPE,stdout=None,stderr=None,env=environment,close_fds=True,pass_fds=(3,))
finally:os.close(3)
def cancelled(signum,_frame):
 if child.poll() is None:child.send_signal(signum)
 raise InterruptedError('protocol stream cancelled')
try:
 for signum in [signal.SIGHUP,signal.SIGTERM,signal.SIGINT,signal.SIGQUIT]:signal.signal(signum,cancelled)
 os.set_blocking(child.stdin.fileno(),False);deadline=time.monotonic()+8
 with selectors.DefaultSelector() as poller:
  poller.register(child.stdin,selectors.EVENT_WRITE);view=memoryview(payload)
  while view:
   remaining=deadline-time.monotonic()
   if remaining<=0 or not poller.select(remaining):refuse()
   try:count=os.write(child.stdin.fileno(),view)
   except (BlockingIOError,InterruptedError):continue
   if count<=0:refuse()
   view=view[count:]
 child.stdin.close();code=child.wait();raise SystemExit(code if code>=0 else 128-code)
finally:
 if not child.stdin.closed:child.stdin.close()
 if child.poll() is None:
  child.terminate()
  try:child.wait(timeout=3)
  except subprocess.TimeoutExpired:
   child.kill();child.wait(timeout=3)
`;
}
export function projectProtocolRelayCommand(sha256: string, command: string) {
  return 'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' +
    '/usr/bin/python3 -I -S -u -c ' + quote(projectProtocolRelaySource(sha256, command));
}
type Wire = Duplex & { stderr?: Readable; close?: () => void };

/** SSH readiness does not retain its connect-time abort listener. Bound the
 * subsequent exec acknowledgment independently and discard late channels. */
export async function openProjectProtocolChannel(machines: Pick<Machines, 'connect' | 'live' | 'state'>,
  id: string, command: string, live: object, signal: AbortSignal,
  beforeLaunch: () => Promise<void>, setupTimeoutMs = 10000): Promise<{ wire: Wire; close: () => void }> {
  signal.throwIfAborted();
  const client = await machines.connect(id, Math.min(setupTimeoutMs, 10000), signal);
  const current = () => { signal.throwIfAborted();
    if (machines.live.get(id) !== live || machines.state(id) !== 'running') throw changed(); };
  try {
    return await new Promise<{ wire: Wire; close: () => void }>((resolve, reject) => {
      let settled = false;
      const clear = () => { clearTimeout(timer); signal.removeEventListener('abort', abort);
        client.off('close', closed); client.off('error', failed); };
      const fail = (error: unknown) => { if (settled) return; settled = true; clear(); client.destroy(); reject(error); };
      const abort = () => fail(signal.reason || new DOMException('Protocol setup aborted', 'AbortError'));
      const closed = () => fail(new AppError('协议 SSH 通道就绪应答前已关闭', 409));
      const failed = (error: Error) => fail(error);
      const timer = setTimeout(() => fail(new AppError('协议 SSH 通道就绪应答超时', 408)), setupTimeoutMs);
      signal.addEventListener('abort', abort, { once: true }); client.once('close', closed); client.once('error', failed);
      void Promise.resolve().then(async () => {
        current(); if (settled) return;
        await beforeLaunch(); current(); if (settled) return;
        client.exec(command, (error, wire) => {
          if (settled) { wire?.destroy(); return; }
          if (error) { fail(error); return; }
          try { current(); }
          catch (error) { wire.destroy(); fail(error); return; }
          settled = true; clear();
          resolve({ wire, close: () => { wire.destroy(); client.destroy(); } });
        });
      }).catch(fail);
    });
  } catch (error) { client.destroy(); throw error; }
}

export class ProjectProtocolDuplex extends Duplex {
  private stopped = false;
  private finish() { if (!this.stopped) { this.stopped = true; this.stop(); } }
  constructor(private wire: Wire, private stop: () => void) {
    super({ allowHalfOpen: true, readableHighWaterMark: 65536, writableHighWaterMark: 65536 });
    wire.pause();
    wire.on('data', (chunk: Buffer) => { if (!this.push(Buffer.from(chunk))) wire.pause(); });
    wire.on('end', () => this.push(null));
    wire.on('error', error => this.destroy(error));
    // Preserve already-buffered final protocol bytes until the reader observes EOF.
    wire.on('close', () => { this.push(null); this.finish(); });
    this.on('error', () => {});
  }
  override _read() { this.wire.resume(); }
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.wire.write(Buffer.from(chunk), done);
  }
  override _final(done: (error?: Error | null) => void) { this.wire.end(done); }
  override _destroy(error: Error | null, done: (error?: Error | null) => void) {
    this.finish(); this.wire.destroy(); done(error);
  }
}
type Preparation = Pick<ProjectTerminals, 'prepare' | 'close'>;
type Admission = Awaited<ReturnType<ProjectRunScopes['admitTask']>>;
type Scopes = Pick<ProjectRunScopes, 'admitTask' | 'active' | 'readonlyTask' | 'taskRun' | 'closeAfterScopeStopped'>;
type Options = { scopes?: Scopes; identities?: Pick<ProjectIdentities, 'runReadonly'>;
  createPreparation?: () => Preparation; rootDirectory?: string;
  channel?: (id: string, command: string, signal: AbortSignal) => Promise<{ wire: Wire; close: () => void }>; };
export type OwnedProjectProtocolStream = { stream: Duplex; capture: ProjectProtocolCapture;
  record: () => ProjectProtocolStreamRecord; close: () => Promise<void>; done: Promise<void>; detachRequest: () => void;
  assertCurrent: () => Promise<void>; assertNative: () => Promise<void> };

/** A durable original ticket owns one binary protocol connection and all its descendants. */
export class ProjectProtocolStreams {
  private scopes: Scopes;
  private identities: NonNullable<Options['identities']>;
  private owners = new Map<string, OwnedProjectProtocolStream>();
  private recoveries = new Map<string, { projectId: string; close: () => Promise<void>; record: () => ProjectProtocolStreamRecord }>();
  private cleanups = new Set<() => Promise<void>>();
  private writes = new Map<string, Promise<unknown>>();
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  constructor(private machines: Machines, private workspaces: Workspaces, private options: Options = {}) {
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
  }
  private file(id: string, projectId: string, runId: string) {
    z.uuid().parse(id); projectIdSchema.parse(projectId); z.uuid().parse(runId);
    return join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams', projectId, runId + '.json');
  }
  private async save(record: ProjectProtocolStreamRecord) {
    record = projectProtocolStreamSchema.parse(structuredClone(record));
    const file = this.file(record.vmId, record.projectId, record.runId);
    const next = (this.writes.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      const archived = join(dirname(file), 'closed', record.runId + '.json');
      const value = await readStore<unknown>(file, () => null) || await readStore<unknown>(archived, () => null);
      const prior = value ? projectProtocolStreamSchema.parse(value) : null;
      if (prior && (prior.phase === 'closed' && record.phase !== 'closed' || prior.phase === 'review' && ['intent', 'active'].includes(record.phase) ||
          !same(immutable(prior), immutable(record)) || prior.issued && !record.issued ||
          prior.run && !same(prior.run, record.run) || prior.closure && !same(prior.closure, record.closure))) throw changed();
      if (prior?.phase === 'closed' && await readStore<unknown>(archived, () => null)) return;
      await writeStore(file, record);
      if (record.phase === 'closed') {
        await mkdir(dirname(archived), { recursive: true }); await rename(file, archived);
      }
    });
    this.writes.set(file, next); try { await next; } finally { if (this.writes.get(file) === next) this.writes.delete(file); }
  }
  private async acceptedClosure(record: ProjectProtocolStreamRecord) {
    const file = this.file(record.vmId, record.projectId, record.runId);
    const value = await readStore<unknown>(file, () => null) || await readStore<unknown>(join(dirname(file), 'closed', record.runId + '.json'), () => null);
    if (!value) return false;
    const prior = projectProtocolStreamSchema.parse(value); if (prior.phase !== 'closed') return false;
    if (!same(immutable(prior), immutable(record)) || prior.issued !== record.issued || record.run && !same(prior.run, record.run)) throw changed();
    Object.assign(record, prior); return true;
  }
  async records(id: string, projectId: string) {
    projectIdSchema.parse(projectId); z.uuid().parse(id);
    const directory = join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams', projectId);
    let files: string[]; try { files = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    files = files.filter(file => file !== 'closed' && !/^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/.test(file));
    if (files.length > 1024 || files.some(file => !uuidFile.test(file))) throw changed();
    const records = await Promise.all(files.map(file => readStore<unknown>(join(directory, file), () => null)));
    const rows = records.map(value => projectProtocolStreamSchema.parse(value)).filter(record => {
      if (record.vmId !== id || record.projectId !== projectId) throw changed(); return record.phase !== 'closed';
    });
    for (const [key, recovery] of this.recoveries) if (key.startsWith(id + ':') && recovery.projectId === projectId) {
      const record = recovery.record(); if (record.phase === 'closed' && !rows.some(row => row.runId === record.runId)) rows.push(record);
    }
    return rows;
  }
  async recordsAll(id: string) {
    z.uuid().parse(id); const directory = join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams');
    let projects: string[];
    try { projects = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (projects.length > 1024 || projects.some(projectId => !projectIdSchema.safeParse(projectId).success)) throw changed();
    return (await Promise.all(projects.map(projectId => this.records(id, projectId)))).flat();
  }
  async readonly(record: ProjectProtocolStreamRecord, signal?: AbortSignal) {
    record = projectProtocolStreamSchema.parse(record);
    const live = this.machines.live.get(record.vmId);
    if (!live || this.machines.state(record.vmId) !== 'running' || await this.boot(record.vmId, signal) !== record.bootId) throw changed();
    await this.native(record, signal);
    if (this.machines.live.get(record.vmId) !== live || await this.boot(record.vmId, signal) !== record.bootId) throw changed();
  }
  async recover(id: string, projectId: string, kind: 'lsp' | 'dap', signal?: AbortSignal) {
    for (const record of await this.records(id, projectId)) {
      signal?.throwIfAborted(); if (record.kind !== kind) continue;
      const key = id + ':' + record.runId, owner = this.owners.get(key), recovery = this.recoveries.get(key);
      if (recovery && ['intent', 'active'].includes(recovery.record().phase) && (!owner || !owner.stream.destroyed)) continue;
      await this.stop(id, projectId, record.runId);
    }
  }
  private async boot(id: string, signal?: AbortSignal) {
    const live = this.machines.live.get(id), result = await this.machines.exec(id,
      'env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10000, signal);
    const parsed = z.uuid().safeParse(result.stdout.trim());
    if (!live || this.machines.live.get(id) !== live || result.code || !parsed.success) throw changed(); return parsed.data;
  }
  async assertCapture(id: string, capture: ProjectProtocolCapture, boot = true) {
    return this.workspaces.projects.inScope(id, capture.projectId, async () => {
      const current = () => { capture.signal.throwIfAborted();
        if (this.machines.state(id) !== 'running' || this.machines.live.get(id) !== capture.live ||
            this.workspaces.projects.current(id) !== capture.projectId) throw changed(); };
      current(); const project = await this.workspaces.config(id); current();
      if ((project._workspace || 'default') !== capture.projectId || projectVersion(project) !== capture.configSha256) throw changed();
      if (boot && await this.boot(id, capture.signal) !== capture.bootId) throw changed(); current();
    });
  }
  private async native(record: ProjectProtocolStreamRecord, signal?: AbortSignal) {
    if (record.phase !== 'active' || !record.run) throw changed();
    const value = await this.scopes.readonlyTask(record.vmId, record.projectId, record.runId, signal);
    if (!same(value.identity, record.identity) || value.sha256 !== record.sha256 || value.owner.bootId !== record.bootId ||
        value.owner.kind !== 'task' || value.owner.runId !== record.runId || !same(value.run, record.run) || !matches(record, value.run)) throw changed();
  }
  open(id: string, kind: 'lsp' | 'dap', project: Project, execution: (resolved: Project) => ProjectIdentityExecution,
    signal?: AbortSignal, timeoutMs = kind === 'lsp' ? 180000 : 12 * 60 * 60 * 1000, expectedLive?: object): Promise<OwnedProjectProtocolStream> {
    const operation = this.start(id, kind, project, execution, signal, timeoutMs, expectedLive);
    this.pending.add(operation); void operation.finally(() => this.pending.delete(operation)).catch(() => {}); return operation;
  }
  private async start(id: string, kind: 'lsp' | 'dap', original: Project,
    execute: (resolved: Project) => ProjectIdentityExecution, incoming: AbortSignal | undefined, timeoutMs: number, expectedLive?: object) {
    this.controller.signal.throwIfAborted(); incoming?.throwIfAborted();
    z.number().int().min(1000).max(24 * 60 * 60 * 1000).parse(timeoutMs);
    const projectId = projectIdSchema.parse(original._workspace || 'default'), project = cloneProject(original), configSha256 = projectVersion(project);
    if (this.workspaces.projects.current(id) !== projectId) throw changed();
    const live = this.machines.live.get(id); if (!live || expectedLive && live !== expectedLive || this.machines.state(id) !== 'running') throw changed();
    const controller = new AbortController(), abortRequest = () => controller.abort(incoming?.reason);
    incoming?.addEventListener('abort', abortRequest, { once: true });
    const detachRequest = () => incoming?.removeEventListener('abort', abortRequest);
    const lifetime = AbortSignal.any([this.controller.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new AppError('协议会话期限已到', 408)), timeoutMs); timer.unref();
    const preparation = this.options.createPreparation?.() || new ProjectTerminals(this.machines, this.workspaces);
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined, admission: Admission | undefined;
    let record: ProjectProtocolStreamRecord | undefined, capture: ProjectProtocolCapture | undefined;
    let channel: { wire: Wire; close: () => void } | undefined, owner: OwnedProjectProtocolStream | undefined, cleanup: Promise<void> | undefined;
    let abortProtocol: (() => void) | undefined;
    let resolveDone!: () => void, rejectDone!: (error: unknown) => void;
    const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; }); void done.catch(() => {});
    const finish = async () => {
      // Assign before abort/destroy emits nested close callbacks.
      if (!cleanup) cleanup = Promise.resolve().then(async () => {
        try { if (record) { if (record.phase !== 'closed' && !await this.acceptedClosure(record)) { record.phase = 'review'; await this.save(record); await this.stopRecord(record, live); }
            else await this.save(record); } }
        catch (error) {
          const failure = (error as any)?.status === 503 ? error : new AppError('原协议运行归属或闭合登记未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
          if (failure !== error) Object.defineProperty(failure, 'cause', { value: error, configurable: true });
          cleanup = undefined; rejectDone(failure); throw failure;
        }
        finally { channel?.close(); }
        const errors: unknown[] = [];
        try { await prepared?.release(); } catch (error) { errors.push(error); }
        try { await preparation.close(); } catch (error) { errors.push(error); }
        if (errors.length) { cleanup = undefined; const critical = errors.find((error: any) => error?.status === 503) as any;
          const failure = new AggregateError(errors, critical?.message || '协议准备租约清理未确认', { cause: critical || errors[0] });
          Object.assign(failure, { status: critical?.status || 503, code: critical?.code || 'GUEST_TASK_CLEANUP_FAILED' }); rejectDone(failure); throw failure; }
        admission?.release();
        if (record) { this.owners.delete(id + ':' + record.runId); this.recoveries.delete(id + ':' + record.runId); }
        this.cleanups.delete(finish); resolveDone();
      });
      if (abortProtocol) prepared?.signal?.removeEventListener('abort', abortProtocol);
      controller.abort(); detachRequest(); clearTimeout(timer); channel?.wire.destroy();
      return cleanup;
    };
    this.cleanups.add(finish);
    try {
      prepared = await preparation.prepare(id, projectId, null, false, lifetime, undefined, { mode: 'task' });
      const originalCapture = prepared.captured;
      if (!originalCapture || !prepared.signal || prepared.projectId !== projectId || originalCapture.live !== live ||
          (originalCapture.project._workspace || 'default') !== projectId || originalCapture.configVersion !== configSha256 ||
          projectVersion(originalCapture.project) !== configSha256) throw changed();
      const resolved = await this.workspaces.projects.inScope(id, projectId, () => this.workspaces.resolveProject(id, cloneProject(project)));
      if ((resolved._workspace || 'default') !== projectId || resolved.directory !== project.directory ||
          (resolved.networkIsolation || 'host') !== (project.networkIsolation || 'host')) throw changed();
      capture = { projectId, project, resolved: cloneProject(resolved), configSha256, live, bootId: await this.boot(id, prepared.signal), signal: prepared.signal };
      await this.assertCapture(id, capture);
      const body = { ...execute(capture.resolved), environment: { ...capture.resolved.environment }, stdin: 'session' as const };
      projectIdentityPayload(body);
      const controlToken = randomUUID();
      const options: ProjectTaskAdmissionOptions = { expectedLive: live as never, expectedBootId: capture.bootId,
        beforeIntent: async ({ identity, owner: outer, sha256 }) => {
          record = projectProtocolStreamSchema.parse({ version: 1, vmId: id, projectId, kind, controlToken, timeoutMs,
            runId: outer.runId, bootId: outer.bootId, identity, sha256, configSha256, phase: 'intent', issued: false, run: null });
          await this.save(record);
          this.recoveries.set(id + ':' + record.runId, { projectId, close: finish, record: () => structuredClone(record!) });
        } };
      admission = await this.scopes.admitTask(id, project, body, prepared.signal, options);
      if (!record || record.runId !== admission.payload.runId || record.sha256 !== admission.payload.sha256 ||
          !same(record.identity, admission.payload.identity) || admission.live !== live || admission.payload.input.readUInt32LE(12) !== 2 ||
          createHash('sha256').update(admission.payload.input).digest('hex') !== record.sha256) throw changed();
      await this.assertCapture(id, capture);
      const plan = guestTaskControlPlan(record.runId, record.controlToken,
        projectProtocolRelayCommand(record.sha256, admission.payload.command), timeoutMs);
      if (this.options.channel) {
        record.issued = true; await this.save(record);
        channel = await this.options.channel(id, plan.run, prepared.signal);
      }
      else {
        channel = await openProjectProtocolChannel(this.machines, id, plan.run, live, prepared.signal, async () => {
          await this.assertCapture(id, capture!); record!.issued = true; await this.save(record!);
        });
      }
      if (!record.issued) { record.issued = true; await this.save(record); }
      const secrets = projectPrivateValues(capture.resolved); let stderr = '';
      channel.wire.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-65536); });
      channel.wire.once('close', () => { void finish().catch(() => {}); });
      const stream = new ProjectProtocolDuplex(channel.wire, () => { void finish().catch(() => {}); });
      owner = { stream, capture, record: () => structuredClone(record!), close: finish, done, detachRequest,
        assertCurrent: () => this.assertCapture(id, capture!), assertNative: () => this.native(record!, capture!.signal) };
      this.owners.set(id + ':' + record.runId, owner);
      abortProtocol = () => { stream.destroy(); }; prepared.signal.addEventListener('abort', abortProtocol, { once: true });
      void done.finally(() => prepared!.signal!.removeEventListener('abort', abortProtocol!)).catch(() => {});
      await new Promise<void>((resolve, reject) => channel!.wire.write(Buffer.from(admission!.payload.input), error => error ? reject(error) : resolve()));
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await this.assertCapture(id, capture);
        if (await this.scopes.active(id, projectId, record.runId, prepared.signal)) {
          const run = await this.identities.runReadonly(id, record.identity, record.runId, prepared.signal);
          if (!matches(record, run) || run.phase !== 'active') throw changed();
          await this.assertCapture(id, capture); record.run = run; record.phase = 'active'; await this.save(record); return owner;
        }
        if (channel.wire.destroyed) throw new AppError('协议适配器未就绪：' + redactValues(stderr, secrets), 409);
        await delay(50, undefined, { signal: prepared.signal });
      }
      throw new AppError('项目账号协议适配器入场超时：' + redactValues(stderr, secrets), 409);
    } catch (error) {
      try { await finish(); } catch (cleanupError) {
        const failure = cleanupError instanceof AppError ? cleanupError : new AppError('协议原完整运行域清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
        Object.defineProperty(failure, 'cause', { value: new AggregateError([error, cleanupError]), configurable: true }); throw failure;
      }
      throw error;
    }
  }
  private async stopRecord(record: ProjectProtocolStreamRecord, live: object) {
    if (record.phase === 'closed') return this.save(record);
    try {
    if (this.machines.live.get(record.vmId) !== live || this.machines.state(record.vmId) !== 'running')
      throw new AppError('协议原客户机 live 身份改变，完整票据继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    const original = await this.scopes.taskRun(record.vmId, record.projectId, record.runId);
    if (!original && (record.issued || record.run) || original && (
        !same(original.identity, record.identity) || original.sha256 !== record.sha256 || original.owner.kind !== 'task' ||
        original.owner.runId !== record.runId || original.owner.bootId !== record.bootId ||
        record.run && (!original.run || !same({ ...original.run, phase: record.run.phase }, record.run)) ||
        original.run && !matches(record, original.run))) throw changed();
    const bootId = await this.boot(record.vmId);
    if (bootId !== record.bootId) {
      const { directory } = guestTaskControlPaths(record.runId);
      const result = await this.machines.exec(record.vmId, 'env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/sh -ec ' +
        quote('test ! -e ' + quote(directory) + ' && test ! -L ' + quote(directory)), 10000);
      if (result.code !== 0) throw new AppError('新 boot 已有同路径控制归属，拒绝旧协议流停止', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await this.scopes.closeAfterScopeStopped(record.vmId, record.projectId, record.runId);
      if (await this.boot(record.vmId) !== bootId || this.machines.live.get(record.vmId) !== live) throw changed();
      record.phase = 'closed'; record.closure = { reason: 'guest-reboot', bootId }; await this.save(record); return;
    }
    if (record.issued) {
      const plan = guestTaskControlPlan(record.runId, record.controlToken, '', record.timeoutMs);
      await cleanupGuestTaskPlan(this.machines, record.vmId, live, record.runId, plan,
        () => this.scopes.closeAfterScopeStopped(record.vmId, record.projectId, record.runId));
    } else if (original)
      await this.scopes.closeAfterScopeStopped(record.vmId, record.projectId, record.runId);
    if (await this.boot(record.vmId) !== bootId || this.machines.live.get(record.vmId) !== live) throw changed();
    record.phase = 'closed'; record.closure = { reason: record.issued ? 'scope-stopped' : 'never-issued', bootId }; await this.save(record);
    } catch (error) {
      if ((error as any)?.status === 503) throw error;
      const failure = new AppError('协议原完整运行域清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      Object.defineProperty(failure, 'cause', { value: error, configurable: true }); throw failure;
    }
  }
  async stop(id: string, projectId: string, runId: string) {
    z.uuid().parse(id); projectIdSchema.parse(projectId); z.uuid().parse(runId);
    const recovery = this.recoveries.get(id + ':' + runId);
    if (recovery) { if (recovery.projectId !== projectId) throw changed(); return recovery.close(); }
    try {
    const file = this.file(id, projectId, runId);
    const value = await readStore<unknown>(file, () => null) || await readStore<unknown>(join(dirname(file), 'closed', runId + '.json'), () => null);
    const record = projectProtocolStreamSchema.parse(value); if (record.vmId !== id || record.projectId !== projectId || record.runId !== runId) throw changed();
    if (record.phase === 'closed') return;
    const live = this.machines.live.get(id); if (!live) throw new AppError('请先恢复原实例核对协议运行域', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    record.phase = 'review'; await this.save(record); await this.stopRecord(record, live);
    } catch (error) {
      if ((error as any)?.status === 503) throw error;
      const failure = new AppError('原协议运行登记或完整域清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      Object.defineProperty(failure, 'cause', { value: error, configurable: true }); throw failure;
    }
  }
  async close() {
    this.controller.abort(); await Promise.allSettled(this.pending);
    const results = await Promise.allSettled([...this.cleanups].map(cleanup => cleanup()));
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) { const error = new AggregateError(errors, '协议服务关闭时完整原运行域清理未确认', { cause: errors[0] });
      Object.assign(error, { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' }); throw error; }
  }
}
