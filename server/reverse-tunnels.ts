import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual as same } from 'node:util';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import type { Machines } from './machines.ts';
import { projectPrivateValues, projectVersion, type Workspaces, type Project } from './workspaces.ts';
import { projectIdSchema } from './project-catalog.ts';
import { writeStore } from './local-store.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import { ProjectIdentities, projectIdentityPayload, projectIdentitySchema, projectIdentityRunSchema,
  type ProjectIdentity, type ProjectIdentityRun } from './project-identity.ts';
import { ProjectReverseTunnelScope, projectReverseTunnelRecordSchema, type ProjectReverseTunnelRecord } from './project-service-scope.ts';
import { reverseTunnelBrokerCommand, reverseTunnelListenerCommand, reverseTunnelListenerSchema,
  openReverseTunnelBridge, type ReverseTunnelListener } from './reverse-tunnel-transport.ts';
import { redactValues } from './secrets.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const changed = () => new AppError('原临时隧道项目、账号、boot、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED');
const legacy = () => new AppError('临时隧道缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管', 409, 'PROJECT_IDENTITY_REQUIRED');
function matches(run: ProjectIdentityRun, identity: ProjectIdentity, record: ProjectReverseTunnelRecord) {
  return run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId &&
    run.registryId === identity.registryId && run.identityId === identity.identityId && run.revision === identity.revision &&
    run.runId === record.runId && run.bootId === record.bootId && run.cgroupName === record.scopeName &&
    record.inode !== null && run.cgroupInode === record.inode &&
    run.namespace === (identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '');
}
export const reverseTunnelSessionSchema = z.object({ id: z.uuid(), vmId: z.uuid(), projectId: projectIdSchema,
  directory: z.string().min(1).max(4096), networkIsolation: z.enum(['host', 'private']),
  guestPort: z.number().int().min(1).max(65535), localPort: z.number().int().min(0).max(65535),
  startedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), phase: z.enum(['starting', 'running', 'stopping', 'review']),
  configSha256: digest.optional(), token: digest.optional(), listener: reverseTunnelListenerSchema.optional(),
  execution: z.object({ identity: projectIdentitySchema, record: projectReverseTunnelRecordSchema,
    run: projectIdentityRunSchema.nullable(), sha256: digest }).strict().optional(),
}).strict().superRefine((session, context) => {
  const value = session.execution;
  if (value && (!session.token || !session.configSha256 || value.identity.phase !== 'active' ||
      value.identity.projectId !== session.projectId || value.identity.directory !== session.directory ||
      value.identity.networkIsolation !== session.networkIsolation || value.record.projectId !== session.projectId ||
      value.run && !matches(value.run, value.identity, value.record) ||
      session.phase === 'running' && (!value.run || value.record.phase !== 'running' || !session.listener || session.localPort < 1024)))
    context.addIssue({ code: 'custom', message: '临时隧道完整项目运行归属缺失' });
});
type Session = z.infer<typeof reverseTunnelSessionSchema>;
const storeSchema = z.object({ version: z.literal(1), sessions: z.array(reverseTunnelSessionSchema).max(128) }).strict()
  .refine(value => new Set(value.sessions.map(row => `${row.vmId}:${row.projectId}`)).size === value.sessions.length,
    '临时隧道项目归属重复');
type Preparation = Pick<ProjectTerminals, 'prepare' | 'close'>;
type Lease = Awaited<ReturnType<ProjectTerminals['prepare']>>;
type Scope = Pick<ProjectReverseTunnelScope, 'status' | 'newIntent' | 'persistIntent' | 'start' | 'stop' | 'expiresAt'>;
export type ReverseTunnelOptions = {
  file?: string; createPreparation?: () => Preparation; runTask?: typeof projectIdentityTask;
  scopes?: Pick<ProjectRunScopes, 'identity' | 'inherited' | 'active' | 'readonlyActive'>;
  identities?: Pick<ProjectIdentities, 'runReadonly'>;
  processScope?: (id: string, project: Project, durationSeconds?: number) => Scope;
  listener?: (identity: ProjectIdentity, run: ProjectIdentityRun, signal?: AbortSignal) => Promise<ReverseTunnelListener | null>;
  bridge?: typeof openReverseTunnelBridge;
};
type Capture = { vmId: string; projectId: string; project: Project; version: string;
  live: NonNullable<ReturnType<Machines['live']['get']>>; preparation: Preparation; lease: Lease; signal: AbortSignal };
type Tunnel = { session: Session; instance: unknown; capture: Capture; server: Server;
  sockets: Set<Socket>; channels: Set<Duplex>; timer?: ReturnType<typeof setTimeout>; revoked: boolean };
type Opening = { vmId: string; instance: unknown; abort: AbortController; pending: Promise<unknown> };
const probeCommand = '/usr/bin/python3 -I -S -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"';
const keyOf = (row: Pick<Session, 'vmId' | 'projectId'>) => `${row.vmId}:${row.projectId}`;
function copy(project: Project, id = project._workspace || 'default') {
  return Object.defineProperty(structuredClone(project), '_workspace', { value: id === 'default' ? undefined : id, enumerable: false });
}
function binding(row: Session): Project {
  return copy({ directory: row.directory, template: 'none', repository: '', setup: '', command: '',
    networkIsolation: row.networkIsolation }, row.projectId);
}
function cleanup(errors: unknown[]) {
  if (errors.length === 1 && errors[0] instanceof AppError && errors[0].status === 503) return errors[0];
  const critical = errors.find(error => error instanceof AppError && error.status === 503);
  return Object.assign(new AppError('临时隧道完整清理尚未确认，已保留原运行记录', 503,
    critical instanceof AppError ? critical.code : 'PROJECT_IDENTITY_CLEANUP_FAILED'), { errors, cause: critical || errors[0] });
}

export class ReverseTunnels {
  private tunnels = new Map<string, Tunnel>();
  private pendingCaptures = new Map<string, Capture>();
  private stopping = new Map<string, Promise<boolean>>();
  private opening = new Map<string, Opening>();
  private checks = new Set<Promise<unknown>>();
  private controller = new AbortController();
  private closed = false;
  private closing?: Promise<void>;
  private unguard: () => void;
  private records: Session[];
  private writes: Promise<unknown> = Promise.resolve();
  private file: string;
  private scopes: NonNullable<ReverseTunnelOptions['scopes']>;
  private identities: NonNullable<ReverseTunnelOptions['identities']>;
  private key(id: string) { return `${id}:${projectIdSchema.parse(this.workspaces.projects.current(id))}`; }
  private isRunning(id: string) { try { return this.machines.state(id) === 'running'; } catch { return false; } }
  private row(key: string) { return this.records.find(row => keyOf(row) === key); }
  private current(row: Session) { return same(this.row(keyOf(row)), row); }
  private owner(row: Session) { return 'reverse-tunnel:' + row.id; }
  private process(row: Session, duration?: number) {
    return this.options.processScope?.(row.vmId, binding(row), duration) ||
      new ProjectReverseTunnelScope(this.machines, row.vmId, binding(row), duration);
  }
  private save(change: (rows: Session[]) => void) {
    const pending = this.writes.then(async () => {
      if (!same(await this.disk(), this.records)) throw changed();
      const rows = structuredClone(this.records); change(rows);
      const state = storeSchema.parse({ version: 1, sessions: rows }); await writeStore(this.file, state);
      this.records = state.sessions;
    });
    this.writes = pending.catch(() => {}); return pending;
  }
  private async disk() {
    try { return storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).sessions; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw changed(); }
  }
  private async durable(row: Session) {
    await this.writes;
    if (!this.current(row) || !same(await this.disk(), this.records)) throw changed();
  }
  private async update(row: Session, change: (value: Session) => void) {
    await this.save(rows => { const found = rows.find(value => value.id === row.id);
      if (!found || !same(found, row)) throw changed(); change(found); });
    const next = this.row(keyOf(row))!; const tunnel = this.tunnels.get(keyOf(row)); if (tunnel) tunnel.session = next;
    return next;
  }
  private schedule(row: Session, retry = false) {
    const tunnel = this.tunnels.get(keyOf(row)); if (!tunnel) return;
    if (tunnel.timer) clearTimeout(tunnel.timer);
    tunnel.timer = setTimeout(() => void this.stopKey(keyOf(row)).catch(() => this.schedule(tunnel.session, true)),
      retry ? 5000 : Math.max(0, Date.parse(row.expiresAt) - Date.now())); tunnel.timer.unref();
  }
  private automatic(key: string) { void this.stopKey(key).catch(() => { const row = this.row(key); if (row) this.schedule(row, true); }); }
  private readonly changed = () => {
    for (const [key, tunnel] of this.tunnels) if (!this.isRunning(tunnel.session.vmId) ||
        this.machines.live.get(tunnel.session.vmId) !== tunnel.instance) this.automatic(key);
    for (const opening of this.opening.values()) if (!this.isRunning(opening.vmId) ||
        this.machines.live.get(opening.vmId) !== opening.instance) opening.abort.abort();
  };
  private readonly locked = (id: string) => {
    for (const [key, tunnel] of this.tunnels) if (tunnel.session.vmId === id) this.automatic(key);
    for (const opening of this.opening.values()) if (opening.vmId === id) opening.abort.abort();
  };
  constructor(private machines: Machines, private workspaces: Workspaces, private options: ReverseTunnelOptions = {}) {
    this.file = options.file || join(DATA, 'reverse-tunnels.json');
    try { this.records = storeSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))).sessions; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.records = [];
      else throw new AppError('临时隧道主机记录无法核对，原文件保留', 409, 'SERVICE_SCOPE_CHANGED'); }
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    machines.on('change', this.changed); machines.on('incident-lockdown', this.locked);
    this.unguard = workspaces.beforeConfigChange(async (id, previous, next) => {
      if (previous.directory === next.directory && (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')) return;
      const key = `${id}:${previous._workspace || 'default'}`;
      if (this.row(key) || this.opening.has(key) || this.stopping.has(key))
        throw new AppError('请先关闭此项目的临时隧道，再修改目录或网络模式', 409);
    });
  }
  private async assertCapture(value: Capture) {
    const origin = () => { value.signal.throwIfAborted();
      if (this.closed || this.workspaces.projects.current(value.vmId) !== value.projectId ||
          this.machines.live.get(value.vmId) !== value.live || !this.isRunning(value.vmId)) throw changed(); };
    origin(); const current = await this.workspaces.config(value.vmId); origin();
    if ((current._workspace || 'default') !== value.projectId || projectVersion(current) !== value.version ||
        projectVersion(value.project) !== value.version) throw changed();
  }
  private async release(value: Pick<Capture, 'preparation' | 'lease'>, failure?: unknown) {
    const errors: unknown[] = [];
    try { await value.lease.release(); } catch (error) { errors.push(error); }
    try { await value.preparation.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw cleanup([...(failure ? [failure] : []), ...errors]);
  }
  private async capture(id: string, projectId: string, live: Capture['live'], signal: AbortSignal,
    verifyOnly = false): Promise<Capture> {
    signal.throwIfAborted(); if (this.closed || !live || this.machines.live.get(id) !== live || !this.isRunning(id)) throw changed();
    const original = await this.workspaces.config(id);
    signal.throwIfAborted();
    if (this.closed || this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live ||
        !this.isRunning(id) || (original._workspace || 'default') !== projectId) throw changed();
    const project = copy(original, projectId), version = projectVersion(project);
    const preparation = this.options.createPreparation?.() || new ProjectTerminals(this.machines, this.workspaces);
    let lease: Lease | undefined;
    try {
      lease = await preparation.prepare(id, projectId, null, false, signal, undefined,
        { mode: 'task', ...(verifyOnly ? { verifyOnly: true } : {}) });
      if (!lease.captured || !lease.signal || lease.projectId !== projectId || lease.captured.live !== live ||
          (lease.captured.project._workspace || 'default') !== projectId || lease.captured.configVersion !== version ||
          projectVersion(lease.captured.project) !== version) throw changed();
      const captured: Capture = { vmId: id, projectId, project, version, live, preparation, lease,
        signal: AbortSignal.any([signal, lease.signal]) };
      await this.assertCapture(captured); return captured;
    } catch (error) {
      const errors = [error]; try { await lease?.release(); } catch (error) { errors.push(error); }
      try { await preparation.close(); } catch (error) { errors.push(error); }
      throw errors.length > 1 ? cleanup(errors) : error;
    }
  }
  private async probe(capture: Capture, requireReady = true) {
    const resolved = await this.workspaces.resolveProject(capture.vmId, copy(capture.project)); await this.assertCapture(capture);
    if ((resolved._workspace || 'default') !== capture.projectId || resolved.directory !== capture.project.directory ||
        (resolved.networkIsolation || 'host') !== (capture.project.networkIsolation || 'host')) throw changed();
    const execution = { command: probeCommand, environment: resolved.environment };
    try { projectIdentityPayload(execution); }
    catch { throw new AppError('临时隧道探测环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
    const result = await (this.options.runTask || projectIdentityTask)(this.machines, capture.vmId, capture.project, execution,
      capture.signal, undefined, 10000, undefined, undefined, { expectedLive: capture.live });
    await this.assertCapture(capture);
    if (!result || !Number.isInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
        Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 * 1024)
      throw new AppError('项目 Python 探测结果无法核对', 409, 'PROJECT_IDENTITY_RESULT_INVALID');
    if (requireReady && result.code !== 0)
      throw new AppError(redactValues(result.stderr || '项目 Python 或网络空间未就绪', projectPrivateValues(resolved)), 409);
    return { project: resolved, ready: result.code === 0 };
  }
  async check(id: string, signal?: AbortSignal) {
    const projectId = projectIdSchema.parse(this.workspaces.projects.current(id)), key = `${id}:${projectId}`, live = this.machines.live.get(id);
    const active = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]); active.throwIfAborted();
    if (!this.isRunning(id) || !live) return { ready: false, executed: false, reason: '请先启动发行版。', ...this.status(id) };
    const operation = this.workspaces.projects.inScope(id, projectId, async () => {
      const row = this.row(key);
      if (row) {
        if (!row.execution) throw legacy();
        if (row.phase !== 'running' || Date.now() >= Date.parse(row.expiresAt)) {
          await this.stopKey(key); return { ready: true, executed: false, reason: '原临时隧道已确认停止。', ...this.status(id) };
        }
        if (!this.tunnels.has(key)) await this.restore(row, live, active);
        else await this.prove(row, live, active);
        return { ready: true, executed: false, reason: '原项目 UID broker 与回环入口已核对。', ...this.status(id) };
      }
      const capture = await this.capture(id, projectId, live, active); let failure: unknown;
      try { const { ready } = await this.probe(capture, false); return { ready, executed: false,
        reason: ready ? '项目 Python 3.9+ 与网络空间已就绪，可创建限时本机 TCP 入口。' :
          '客户机需要 Python 3.9+，私有项目还需要有效的网络命名空间。', ...this.status(id) }; }
      catch (error) { failure = error; throw error; }
      finally { await this.release(capture, failure); }
    });
    this.checks.add(operation); try { return await operation; } finally { this.checks.delete(operation); }
  }
  private describe(tunnel: Tunnel) { const row = tunnel.session;
    return { active: true as const, host: '127.0.0.1', localPort: row.localPort, guestPort: row.guestPort,
      expiresAt: row.expiresAt, projectId: row.projectId, directory: row.directory,
      networkIsolation: row.networkIsolation, connections: tunnel.sockets.size }; }
  status(id: string) {
    const tunnel = this.tunnels.get(this.key(id));
    try { if (!same(storeSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))).sessions, this.records)) return { active: false as const }; }
    catch { return { active: false as const }; }
    return tunnel && !tunnel.revoked && tunnel.session.phase === 'running' && this.current(tunnel.session) && this.isRunning(id) &&
      this.machines.live.get(id) === tunnel.instance && Date.now() < Date.parse(tunnel.session.expiresAt)
      ? this.describe(tunnel) : { active: false as const };
  }
  private listener(identity: ProjectIdentity, run: ProjectIdentityRun, signal?: AbortSignal) {
    if (this.options.listener) return this.options.listener(identity, run, signal);
    const row = this.records.find(value => value.execution?.record.runId === run.runId); if (!row) throw changed();
    return this.machines.exec(row.vmId, reverseTunnelListenerCommand(identity, run), 10000, signal).then(result => {
      if (result.code !== 0) throw changed();
      return z.object({ listener: reverseTunnelListenerSchema.nullable() }).strict().parse(JSON.parse(result.stdout)).listener;
    });
  }
  private async prove(row: Session, live: unknown, signal?: AbortSignal) {
    await this.durable(row);
    signal?.throwIfAborted(); if (!row.execution?.run || !row.listener || !this.current(row) || row.phase !== 'running' ||
        this.machines.live.get(row.vmId) !== live || !this.isRunning(row.vmId) || Date.now() >= Date.parse(row.expiresAt)) throw changed();
    const origin = () => { signal?.throwIfAborted(); if (this.closed || !this.current(row) ||
        this.workspaces.projects.current(row.vmId) !== row.projectId || this.machines.live.get(row.vmId) !== live ||
        !this.isRunning(row.vmId) || Date.now() >= Date.parse(row.expiresAt)) throw changed(); };
    origin(); const project = await this.workspaces.config(row.vmId); origin();
    if ((project._workspace || 'default') !== row.projectId || projectVersion(project) !== row.configSha256) throw changed();
    const state = await this.process(row).status(signal, row.execution.sha256); origin();
    if (state.status !== 'running' || !same(state.record, row.execution.record) || state.bootId !== row.execution.run.bootId ||
        !await this.scopes.readonlyActive(row.vmId, row.projectId, row.execution.record.runId, signal)) throw changed();
    origin(); const run = await this.identities.runReadonly(row.vmId, row.execution.identity, row.execution.record.runId, signal); origin();
    if (!same(run, row.execution.run) || !matches(run, row.execution.identity, row.execution.record)) throw changed();
    const listener = await this.listener(row.execution.identity, run, signal); origin(); if (!same(listener, row.listener)) throw changed();
  }
  async open(id: string, guestPort: number, durationSeconds: number, signal?: AbortSignal) {
    if (!Number.isInteger(guestPort) || guestPort < 1 || guestPort > 65535 || !Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600)
      throw new AppError('客户机端口或隧道时限无效');
    const projectId = projectIdSchema.parse(this.workspaces.projects.current(id)), key = `${id}:${projectId}`, live = this.machines.live.get(id);
    if (this.closed) throw new AppError('临时隧道服务已关闭', 409);
    if (this.row(key) || this.tunnels.has(key) || this.opening.has(key) || this.stopping.has(key))
      throw new AppError('此项目已有临时调试入口，请先关闭', 409);
    if (!live || !this.isRunning(id)) throw new AppError('请先启动发行版', 409);
    const abort = new AbortController(), active = AbortSignal.any([this.controller.signal, abort.signal, ...(signal ? [signal] : [])]);
    const opening: Opening = { vmId: id, instance: live, abort, pending: Promise.resolve() }; this.opening.set(key, opening);
    const operation = this.workspaces.projects.inScope(id, projectId, () => this.start(id, projectId, live, guestPort, durationSeconds, active));
    opening.pending = operation;
    try { return await operation; } finally { if (this.opening.get(key) === opening) this.opening.delete(key); }
  }
  private async start(id: string, projectId: string, live: Capture['live'], guestPort: number, duration: number, signal: AbortSignal) {
    const capture = await this.capture(id, projectId, live, signal); let row: Session | undefined, retained = false, failure: unknown;
    try {
      const { project } = await this.probe(capture); await this.assertCapture(capture); this.machines.requireUnlocked(id);
      const identity = await this.scopes.identity(id, capture.project, capture.signal); await this.assertCapture(capture);
      const partial: Session = { id: randomUUID(), vmId: id, projectId, directory: capture.project.directory,
        networkIsolation: capture.project.networkIsolation || 'host', guestPort, localPort: 0, startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (duration + 120) * 1000).toISOString(), phase: 'starting',
        configSha256: capture.version, token: randomBytes(32).toString('hex') };
      const process = this.process(partial, duration), state = await process.status(capture.signal);
      await this.assertCapture(capture); if (!['absent', 'stopped'].includes(state.status)) throw legacy();
      const intent = process.newIntent(createHash('sha256').update(JSON.stringify([capture.version, guestPort, partial.token])).digest('hex'), state.bootId);
      const execution = { command: reverseTunnelBrokerCommand(guestPort, partial.token!, duration), environment: project.environment };
      let sha256: string;
      try { sha256 = projectIdentityPayload(execution).sha256; }
      catch { throw new AppError('临时隧道正文或环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
      row = { ...partial, execution: { identity, record: intent, run: null, sha256 } };
      await this.save(rows => { if (rows.some(value => keyOf(value) === keyOf(row!))) throw changed(); rows.push(row!); });
      this.pendingCaptures.set(keyOf(row), capture); retained = true;
      await process.persistIntent(intent);
      const payload = await this.scopes.inherited(id, capture.project, execution,
        { kind: 'service', runId: intent.runId, bootId: intent.bootId }, capture.signal);
      await this.assertCapture(capture); if (!same(payload.identity, identity) || payload.sha256 !== sha256) throw changed();
      const record = await process.start(intent, payload, capture.signal); await this.assertCapture(capture);
      const expiresAt = process.expiresAt(); if (!expiresAt) throw changed();
      row = await this.update(row, value => { value.execution!.record = record; value.expiresAt = expiresAt; });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && Date.now() < Date.parse(row.expiresAt)) {
        await this.assertCapture(capture);
        if (await this.scopes.active(id, projectId, intent.runId, capture.signal)) {
          const run = await this.identities.runReadonly(id, identity, intent.runId, capture.signal); await this.assertCapture(capture);
          if (!matches(run, identity, record)) throw changed();
          const listener = await this.listener(identity, run, capture.signal); await this.assertCapture(capture);
          if (listener) {
            row = await this.update(row, value => { value.execution!.run = run; value.listener = listener; });
            const tunnel = await this.listen(row, capture, signal, false); retained = true;
            row = await this.update(tunnel.session, value => { value.phase = 'running'; }); tunnel.session = row;
            await this.assertCapture(capture); this.schedule(row); return { code: 0, ready: true, executed: true, ...this.describe(tunnel) };
          }
        }
        await delay(100, undefined, { signal: capture.signal });
      }
      throw new AppError('项目 UID 隧道 broker 就绪检查超时', 409);
    } catch (error) {
      failure = error;
      if (row) {
        try { await this.stopRecord(this.row(keyOf(row)) || row); }
        catch (failed) { failure = cleanup([error, failed]); throw failure; }
      }
      throw error;
    } finally { if (!retained) await this.release(capture, failure); }
  }
  private async listen(row: Session, capture: Capture, signal: AbortSignal, restore: boolean) {
    const key = keyOf(row), server = createServer({ allowHalfOpen: true }, socket => void this.bridge(key, server, socket)); let reserved = false;
    try {
      signal.throwIfAborted(); this.machines.requireUnlocked(row.vmId);
      if (restore) { this.machines.reserveHostPorts(this.owner(row), [row.localPort]); reserved = true; }
      await new Promise<void>((resolve, reject) => { server.once('error', reject);
        server.once('close', () => reject(new AppError('临时隧道监听已取消', 409)));
        server.listen({ port: restore ? row.localPort : 0, host: '127.0.0.1' }, resolve); });
      signal.throwIfAborted(); await this.assertCapture(capture);
      const address = server.address(); if (!address || typeof address === 'string') throw changed();
      if (!restore) { this.machines.reserveHostPorts(this.owner(row), [address.port]); reserved = true;
        row = await this.update(row, value => { value.localPort = address.port; }); }
      const tunnel: Tunnel = { session: row, instance: capture.live, capture, server, sockets: new Set(), channels: new Set(), revoked: false };
      this.tunnels.set(key, tunnel);
      if (this.pendingCaptures.get(key) === capture) this.pendingCaptures.delete(key);
      server.on('error', () => this.automatic(key)); return tunnel;
    } catch (error) { await new Promise<void>(resolve => server.close(() => resolve()));
      if (reserved) this.machines.reserveHostPorts(this.owner(row), []); throw error; }
  }
  private async restore(row: Session, live: Capture['live'], signal: AbortSignal) {
    const key = keyOf(row); if (this.opening.has(key) || this.stopping.has(key)) throw changed();
    const abort = new AbortController(), opening: Opening = { vmId: row.vmId, instance: live, abort, pending: Promise.resolve() }; this.opening.set(key, opening);
    const pending = (async () => {
      const active = AbortSignal.any([signal, abort.signal]); await this.prove(row, live, active);
      const capture = await this.capture(row.vmId, row.projectId, live, active, true); let retained = false, failure: unknown;
      try { if (capture.version !== row.configSha256) throw changed(); await this.prove(row, live, capture.signal);
        await this.listen(row, capture, capture.signal, true); retained = true; this.schedule(row); }
      catch (error) { failure = error; throw error; }
      finally { if (!retained) await this.release(capture, failure); }
    })(); opening.pending = pending;
    try { await pending; } finally { if (this.opening.get(key) === opening) this.opening.delete(key); }
  }
  private async bridge(key: string, server: Server, socket: Socket) {
    const tunnel = this.tunnels.get(key); if (!tunnel || tunnel.revoked || tunnel.server !== server || tunnel.sockets.size >= 4) { socket.destroy(); return; }
    const row = tunnel.session, abort = new AbortController(); tunnel.sockets.add(socket);
    socket.once('close', () => { abort.abort(); tunnel.sockets.delete(socket); }); socket.on('error', () => socket.destroy());
    try {
      await this.workspaces.projects.inScope(row.vmId, row.projectId, async () => {
        const validate = () => this.prove(row, tunnel.instance, abort.signal); await validate(); this.machines.requireUnlocked(row.vmId);
        const channel = await (this.options.bridge || openReverseTunnelBridge)(this.machines, row.vmId,
          { identity: row.execution!.identity, run: row.execution!.run!, listener: row.listener!, token: row.token! }, tunnel.instance, abort.signal, validate);
        if (this.tunnels.get(key) !== tunnel || tunnel.revoked || socket.destroyed) { channel.destroy(); return; }
        tunnel.channels.add(channel); channel.once('close', () => { tunnel.channels.delete(channel); socket.end(); });
        channel.once('end', () => socket.end()); channel.on('error', () => socket.destroy()); socket.pipe(channel).pipe(socket);
      });
    } catch { socket.destroy(); }
  }
  private async revoke(tunnel: Tunnel) {
    tunnel.revoked = true; if (tunnel.timer) clearTimeout(tunnel.timer);
    for (const socket of tunnel.sockets) socket.destroy(); for (const channel of tunnel.channels) channel.destroy();
    await new Promise<void>(resolve => tunnel.server.close(() => resolve())); this.machines.reserveHostPorts(this.owner(tunnel.session), []);
  }
  private async stopRecord(row: Session) {
    if (!row.execution) throw legacy(); if (!this.current(row)) throw changed();
    const key = keyOf(row), tunnel = this.tunnels.get(key), capture = tunnel?.capture || this.pendingCaptures.get(key);
    try { row = await this.update(row, value => { value.phase = 'stopping'; }); }
    catch (error) { if (tunnel) { try { await this.revoke(tunnel); } catch (failed) { throw cleanup([error, failed]); } }
      throw cleanup([error]); }
    try {
      if (tunnel) await this.revoke(tunnel);
      if (!this.isRunning(row.vmId)) throw new AppError('请先启动或恢复实例，再核对原隧道完整运行域', 409);
      await this.process(row).stop(row.execution!.record); if (!this.current(row)) throw changed();
      if (capture) await this.release(capture);
      await this.save(rows => { const found = rows.find(value => value.id === row.id);
        if (!found || !same(found, row)) throw changed(); rows.splice(rows.indexOf(found), 1); });
      this.tunnels.delete(key); this.pendingCaptures.delete(key); return true;
    } catch (error) { throw cleanup([error]); }
  }
  private stopKey(key: string): Promise<boolean> {
    const existing = this.stopping.get(key); if (existing) return existing;
    const opening = this.opening.get(key);
    if (opening) { opening.abort.abort(); return opening.pending.catch(() => {}).then(() => this.stopKey(key)); }
    const row = this.row(key); if (!row) return Promise.resolve(false);
    const pending = this.workspaces.projects.inScope(row.vmId, row.projectId, () => this.stopRecord(row))
      .finally(() => { if (this.stopping.get(key) === pending) this.stopping.delete(key); });
    this.stopping.set(key, pending); return pending;
  }
  stop(id: string) { return this.stopKey(this.key(id)); }
  close() {
    if (this.closing) return this.closing; this.closed = true; this.controller.abort();
    this.machines.off('change', this.changed); this.machines.off('incident-lockdown', this.locked);
    for (const opening of this.opening.values()) opening.abort.abort();
    const closing = (async () => {
      const unfinished = await Promise.allSettled([...this.checks, ...[...this.opening.values()].map(value => value.pending)]);
      const stopped = await Promise.allSettled(this.records.filter(row => row.execution).map(row => this.stopKey(keyOf(row))));
      const errors = [...unfinished, ...stopped].flatMap(result => result.status === 'rejected' &&
        result.reason instanceof AppError && result.reason.status === 503 ? [result.reason] : []);
      if (errors.length) throw cleanup(errors); this.unguard();
    })(); this.closing = closing;
    void closing.catch(() => { if (this.closing === closing) this.closing = undefined; }); return closing;
  }
}
