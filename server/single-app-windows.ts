import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError, vmDir } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectVersion, type Project, type Workspaces } from './workspaces.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { ProjectIdentities, projectIdentitySchema, projectIdentityRunSchema, projectIdentitySources } from './project-identity.ts';
import { appIdentity, appOriginSchema, appReceiptSchema, appStatusSchema, appStopSchema, appRetirementSchema,
  appAbsenceSchema, appRecoverySchema, SingleAppControl, type AppOrigin, type AppReceipt } from './single-app-sandbox.ts';

export const singleAppProgram = z.string().regex(/^[A-Za-z][A-Za-z0-9+._-]{0,63}$/);
export const singleAppClipboard = z.object({ copy: z.boolean(), paste: z.boolean() }).strict();
const clipboardStoreSchema = z.object({ version: z.literal(1), rules: z.record(singleAppProgram, singleAppClipboard) }).strict()
  .refine(value => Object.keys(value.rules).length <= 64, '单应用剪贴板规则不能超过 64 条');
export const singleAppInput = z.object({ program: singleAppProgram,
  args: z.array(z.string().max(256).refine(value => !/[\x00-\x1f]/.test(value))).max(12).default([]),
  resolution: z.enum(['800x600', '1024x768', '1280x800']).default('1024x768'),
  clipboard: singleAppClipboard.default({ copy: true, paste: true }),
}).strict();
export const singleAppViewSchema = z.object({ id: z.uuid(), vmId: z.uuid(), program: z.string(), display: z.number().int(),
  port: z.number().int(), resolution: z.string(), clipboard: singleAppClipboard, startedAt: z.string(), projectId: z.string().optional(),
  networkIsolation: z.enum(['host', 'private']).optional(), password: z.string(), dataDirectory: z.string(), revoked: z.boolean(),
  projectOwner: z.object({ uid: z.number().int().min(20000).max(59999), user: z.string() }).strict().optional(),
  applicationOwner: z.object({ uid: z.number().int().min(1000), user: z.string() }).strict().optional(),
  cleanupPending: z.boolean(), lastError: z.string().optional(),
  status: z.enum(['running', 'stopped', 'relaunch-required', 'preparing', 'cleanup-pending', 'review-required']),
}).strict();
export type SingleAppWindowView = z.infer<typeof singleAppViewSchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const singleAppRunRecordSchema = z.object({ version: z.literal(1), id: z.uuid(), vmId: z.uuid(),
  program: singleAppProgram, args: singleAppInput.shape.args, resolution: singleAppInput.shape.resolution,
  clipboard: singleAppClipboard, startedAt: z.string(), projectId: z.string().regex(/^(default|[a-f0-9]{16})$/),
  directory: z.string().startsWith('/'), networkIsolation: z.enum(['host', 'private']), configVersion: digest,
  bootId: z.uuid(), build: digest, nativeBuild: digest,
  phase: z.enum(['intent', 'prepared', 'starting', 'running', 'stopping', 'stopped', 'cleanup-failed']),
  identity: projectIdentitySchema, run: projectIdentityRunSchema.nullable(), receipt: appReceiptSchema.nullable(),
  revoked: z.boolean().default(false), retirement: appRetirementSchema.nullable(), closure: projectIdentityRunSchema.nullable(),
  lastError: z.string().max(128).optional(),
  absence: appAbsenceSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.identity.projectId !== value.projectId || value.identity.directory !== value.directory ||
      value.identity.networkIsolation !== value.networkIsolation || value.identity.phase !== 'active' ||
      (value.run && (value.run.runId !== value.id || value.run.bootId !== value.bootId || value.run.mode !== 'independent' ||
        value.run.build !== value.nativeBuild || (['registryId', 'identityId', 'projectId', 'revision'] as const)
          .some(key => value.identity[key] !== value.run![key]))) ||
      (value.receipt && (!value.run || value.receipt.id !== value.id || value.receipt.build !== value.build ||
        JSON.stringify(value.receipt.origin) !== JSON.stringify(origin(value)))) ||
      (['prepared', 'starting', 'running'].includes(value.phase) && (!value.run || !value.receipt)) ||
      (value.phase === 'running' && value.receipt?.state !== 'running') ||
      (value.closure && (!value.run || !sameRun(value.closure, value.run) ||
        (value.retirement ? value.retirement.bootId === value.bootId : value.closure.phase !== 'closed'))) ||
      (value.phase === 'stopped' && (value.run ? !value.closure : !value.absence)) ||
      (value.retirement && (!['stopped', 'stopping', 'cleanup-failed'].includes(value.phase) || value.retirement.bootId === value.bootId)) ||
      (value.absence && (!['stopped', 'stopping', 'cleanup-failed'].includes(value.phase) || value.run || value.receipt || value.absence.id !== value.id ||
        value.absence.bootId !== value.bootId || value.absence.nativeBuild !== value.nativeBuild)))
    ctx.addIssue({ code: 'custom', message: '单应用持久运行记录不完整' });
});
type Session = z.infer<typeof singleAppRunRecordSchema>;
const journalSchema = z.object({ version: z.literal(1), sessions: z.array(singleAppRunRecordSchema).max(1024) }).strict()
  .refine(value => new Set(value.sessions.map(session => session.id)).size === value.sessions.length);
type Live = NonNullable<ReturnType<Machines['live']['get']>>;
type Preparation = Awaited<ReturnType<ProjectTerminals['prepare']>>;
type Options = { rootDirectory?: string; terminals?: Pick<ProjectTerminals, 'prepare' | 'close'>;
  scopes?: Pick<ProjectRunScopes, 'identity'>; identities?: Pick<ProjectIdentities, 'install'>;
  control?: Pick<SingleAppControl, 'install' | 'call' | 'streamCommand' | 'recover' | 'legacy' | 'prepareRun'>;
  nativeBuild?: () => Promise<string>; exitPollMs?: number };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function sameRun(left: z.infer<typeof projectIdentityRunSchema>, right: z.infer<typeof projectIdentityRunSchema>) {
  return Object.keys(left).every(key => key === 'phase' || left[key as keyof typeof left] === right[key as keyof typeof right]);
}
function matchOriginal(old: Session, session: Session) {
  const immutable = ['id', 'vmId', 'program', 'args', 'resolution', 'clipboard', 'startedAt', 'projectId', 'directory',
    'networkIsolation', 'configVersion', 'bootId', 'build', 'nativeBuild', 'identity'] as const;
  if (immutable.some(key => !same(old[key], session[key])) ||
      (old.run && !same(old.run, session.run)) ||
      (old.receipt && (!session.receipt ||
        (['uid', 'gid', 'user', 'home', 'runtime', 'password', 'display', 'port', 'image', 'tools'] as const)
          .some(key => !same(old.receipt![key], session.receipt![key])) ||
        (['homeDevice', 'homeInode', 'runtimeDevice', 'runtimeInode', 'directoryView', 'supervisor', 'endpoint', 'processes'] as const)
          .some(key => old.receipt![key] !== null && !same(old.receipt![key], session.receipt![key])))))
    throw new AppError('单应用原持久票据已变化，保留原记录', 409, 'SINGLE_APP_HOST_CHANGED');
}
function origin(session: Pick<Session, 'identity' | 'run' | 'program' | 'args' | 'resolution' | 'clipboard' | 'configVersion'>): AppOrigin {
  if (!session.run) throw new AppError('单应用原完整运行票据尚未确认', 503, 'SINGLE_APP_RUN_PENDING');
  return appOriginSchema.parse({ identity: session.identity, run: session.run, program: session.program, args: session.args,
    resolution: session.resolution, clipboard: session.clipboard, configVersion: session.configVersion });
}

/** Persisted exact original runs remain cleanup-retryable across service reloads. */
export class SingleAppWindows {
  private sessions = new Map<string, Session>();
  private loaded = new Map<string, Promise<void>>();
  private leases = new Map<string, () => void | Promise<void>>();
  private livePins = new Map<string, Live>();
  private sessionListeners = new Map<string, Set<() => void>>();
  private pending = new Set<Promise<unknown>>();
  private watchers = new Map<string, NodeJS.Timeout>();
  private closed = false;
  private closeAbort = new AbortController();
  private removeConfigGuard?: () => void;
  private terminals?: Pick<ProjectTerminals, 'prepare' | 'close'>;
  private scopes: Pick<ProjectRunScopes, 'identity'>;
  private identities: Pick<ProjectIdentities, 'install'>;
  private control: Pick<SingleAppControl, 'install' | 'call' | 'streamCommand' | 'recover' | 'legacy' | 'prepareRun'>;
  constructor(private machines: Machines, private workspaces?: Workspaces, private options: Options = {}) {
    this.terminals = options.terminals || (workspaces ? new ProjectTerminals(machines, workspaces) : undefined);
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    this.control = options.control || new SingleAppControl(machines);
    machines.on('change', this.onChange);
    machines.on('incident-lockdown', this.onLock);
    this.removeConfigGuard = workspaces?.beforeConfigChange(async (id, previous, next) => {
      if (previous.directory === next.directory && (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')) return;
      await this.load(id);
      await this.sync(id);
      if ([...this.sessions.values()].some(session => session.vmId === id &&
          session.projectId === (previous._workspace || 'default') && session.phase !== 'stopped'))
        throw new AppError('请先停止此项目的单应用窗口并确认原运行清理，再修改目录或网络隔离模式', 409, 'SINGLE_APP_RUNS_MUST_STOP');
    });
  }
  private file(id: string) { return join(this.options.rootDirectory || vmDir(id), 'single-app-runs.json'); }
  private async readJournal(id: string) {
    let journal: z.infer<typeof journalSchema>;
    try { journal = journalSchema.parse(await readStore(this.file(id), () => ({ version: 1, sessions: [] }))); }
    catch { throw new AppError('单应用主机登记无法核对，保留原记录', 409, 'SINGLE_APP_HOST_CHANGED'); }
    if (journal.sessions.some(session => session.vmId !== id)) throw new AppError('单应用登记属于其他实例', 409, 'SINGLE_APP_HOST_CHANGED');
    return journal;
  }
  private async sync(id: string) {
    const journal = await this.readJournal(id);
    for (const saved of journal.sessions) {
      const current = this.sessions.get(saved.id);
      if (current) {
        matchOriginal(current, saved);
        saved.revoked ||= current.revoked;
        current.revoked ||= saved.revoked;
        if (saved.phase !== 'stopped') continue;
        this.disconnect(saved.id);
      }
      this.sessions.set(saved.id, saved);
      if (saved.phase !== 'stopped') this.enforcePolicy(saved);
    }
    return journal;
  }
  private async load(id: string) {
    let loading = this.loaded.get(id);
    if (!loading) {
      loading = (async () => {
        const journal = await this.readJournal(id);
        for (const session of journal.sessions) {
          this.sessions.set(session.id, session);
          if (session.phase !== 'stopped') this.enforcePolicy(session);
        }
      })();
      this.loaded.set(id, loading);
    }
    return loading;
  }
  private async save(id: string) {
    const previous = await this.readJournal(id);
    const merged = new Map(previous.sessions.map(session => [session.id, session]));
    for (const session of this.sessions.values()) if (session.vmId === id) {
      const old = merged.get(session.id);
      if (old) {
        matchOriginal(old, session);
        // A concurrently reloaded owner can retire this same run. Never erase
        // another UUID, resurrect a stopped row, or relax its saved revocation.
        if (old.phase === 'stopped') { old.revoked ||= session.revoked; merged.set(session.id, old); continue; }
        session.revoked ||= old.revoked;
      }
      merged.set(session.id, session);
    }
    return writeStore(this.file(id), journalSchema.parse({ version: 1, sessions: [...merged.values()] }));
  }
  private onChange = () => {
    for (const session of this.sessions.values())
      if (this.machines.state(session.vmId) !== 'running' || this.machines.live.get(session.vmId) !== this.livePins.get(session.id))
        this.disconnect(session.id);
  };
  private onLock = (id: string) => { for (const session of this.sessions.values()) if (session.vmId === id) this.disconnect(session.id); };
  private disconnect(id: string) {
    const listeners = this.sessionListeners.get(id); this.sessionListeners.delete(id);
    for (const listener of listeners || []) listener();
  }
  private async retireLease(session: Session) {
    this.disconnect(session.id); clearTimeout(this.watchers.get(session.id)); this.watchers.delete(session.id);
    await this.leases.get(session.id)?.(); this.leases.delete(session.id); this.livePins.delete(session.id);
  }
  private watch(id: string) {
    if (this.closed || this.watchers.has(id) || !this.leases.has(id) || this.sessions.get(id)?.phase !== 'running') return;
    const timer = setTimeout(() => {
      this.watchers.delete(id); const known = this.sessions.get(id);
      if (!known || this.closed || !this.leases.has(id) || known.phase !== 'running') return;
      let entered = false;
      const operation = this.machines.locked(`single-app:${known.vmId}`, async () => {
        entered = true;
        await this.sync(known.vmId);
        const session = this.sessions.get(id)!;
        if (!this.leases.has(id)) return;
        if (session.phase === 'stopped') { await this.retireLease(session); return; }
        if (session.phase !== 'running' || this.closed || this.machines.state(session.vmId) !== 'running') return;
        this.live(session.vmId, this.livePins.get(id));
        const status = await this.status(session);
        if (status.state === 'exited' || status.state === 'stopped') await this.terminate(session);
      }).catch(error => {
        if (entered) {
          this.disconnect(id);
          const current = this.sessions.get(id);
          if (current) current.lastError = error instanceof AppError ? error.code || 'SINGLE_APP_EXIT_UNCONFIRMED' : 'SINGLE_APP_EXIT_UNCONFIRMED';
        }
      }).finally(() => { this.pending.delete(operation); this.watch(id); });
      this.pending.add(operation);
    }, this.options.exitPollMs ?? 2000);
    timer.unref(); this.watchers.set(id, timer);
  }
  onSessionInvalidated(id: string, sessionId: string, listener: () => void) {
    const session = this.sessions.get(z.uuid().parse(sessionId));
    if (session) this.enforcePolicy(session);
    if (!session || session.vmId !== id || session.phase !== 'running' || session.revoked || this.machines.state(id) !== 'running')
      throw new AppError('应用窗口会话已失效，请停止并重开', 409);
    const listeners = this.sessionListeners.get(sessionId) || new Set<() => void>(); listeners.add(listener);
    this.sessionListeners.set(sessionId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size && this.sessionListeners.get(sessionId) === listeners)
      this.sessionListeners.delete(sessionId); };
  }
  private clipboardFile(id: string) { return join(vmDir(id), 'single-app-clipboard.json'); }
  private enforcePolicy(session: Session) {
    let rules: z.infer<typeof clipboardStoreSchema>['rules'];
    try { rules = clipboardStoreSchema.parse(JSON.parse(readFileSync(this.clipboardFile(session.vmId), 'utf8'))).rules; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') rules = {};
      else { this.disconnect(session.id); throw new AppError('单应用剪贴板规则无法核对', 409, 'SINGLE_APP_CLIPBOARD_POLICY_CHANGED'); }
    }
    const rule = rules[session.program];
    if (rule && ((session.clipboard.copy && !rule.copy) || (session.clipboard.paste && !rule.paste))) {
      session.revoked = true; this.disconnect(session.id);
    }
  }
  async clipboardPolicies(id: string) {
    this.machines.get(id);
    return clipboardStoreSchema.parse(await readStore(this.clipboardFile(id), () => ({ version: 1, rules: {} }))).rules;
  }
  async saveClipboardPolicy(id: string, program: string, raw: unknown) {
    singleAppProgram.parse(program); const clipboard = singleAppClipboard.parse(raw);
    this.machines.get(id); this.machines.requireUnlocked(id);
    return this.machines.locked(`single-app:${id}`, async () => {
      await this.load(id); await this.sync(id); const rules = await this.clipboardPolicies(id);
      for (const session of this.sessions.values()) if (session.vmId === id && session.program === program && session.phase !== 'stopped' &&
          ((session.clipboard.copy && !clipboard.copy) || (session.clipboard.paste && !clipboard.paste))) {
        session.revoked = true; this.disconnect(session.id);
      }
      await writeStore(this.clipboardFile(id), clipboardStoreSchema.parse({ version: 1, rules: { ...rules, [program]: clipboard } }));
      await this.save(id); return { program, clipboard };
    });
  }
  async removeClipboardPolicy(id: string, program: string) {
    singleAppProgram.parse(program); this.machines.get(id); this.machines.requireUnlocked(id);
    return this.machines.locked(`single-app:${id}`, async () => {
      const rules = await this.clipboardPolicies(id), removed = Object.hasOwn(rules, program);
      await writeStore(this.clipboardFile(id), { version: 1, rules: Object.fromEntries(Object.entries(rules).filter(([key]) => key !== program)) });
      return { removed, program };
    });
  }
  private live(id: string, expected?: Live) {
    const live = this.machines.live.get(id);
    if (this.machines.state(id) !== 'running' || !live || (expected && live !== expected))
      throw new AppError('原单应用客户机运行身份已变化，请保留原票据并恢复核对', 409, 'SINGLE_APP_LIVE_CHANGED');
    return live;
  }
  private async boot(id: string, live: Live) {
    this.live(id, live); const result = await this.machines.exec(id, 'cat /proc/sys/kernel/random/boot_id', 5000); this.live(id, live);
    if (result.code !== 0) throw new AppError('单应用原客户机 boot 无法核对', 409, 'SINGLE_APP_BOOT_CHANGED');
    return z.uuid().parse(result.stdout.trim());
  }
  private async validateCapture(id: string, live: Live, projectId: string, version: string, signal?: AbortSignal) {
    signal?.throwIfAborted(); this.live(id, live); this.machines.requireUnlocked(id);
    const current = await this.workspaces!.projects.inScope(id, projectId, () => this.workspaces!.config(id));
    signal?.throwIfAborted(); this.live(id, live);
    if (projectVersion(current) !== version || (current._workspace || 'default') !== projectId)
      throw new AppError('原单应用项目配置已变化，请按原配置重试', 409, 'SINGLE_APP_CONFIG_CHANGED');
  }
  private matchReceipt(session: Session, raw: unknown): AppReceipt {
    const receipt = appReceiptSchema.parse(raw);
    if (receipt.id !== session.id || receipt.build !== session.build || !same(receipt.origin, origin(session)))
      throw new AppError('单应用客户机回执不属于原运行', 409, 'SINGLE_APP_RECEIPT_CHANGED');
    if (session.receipt) matchOriginal(session, { ...session, receipt });
    return receipt;
  }
  private async status(session: Session) {
    const live = this.live(session.vmId);
    const result = appStatusSchema.parse(await this.control.call(session.vmId, session.build, 'status', origin(session)));
    this.live(session.vmId, live); this.matchReceipt(session, result.receipt);
    if (result.state === 'running' && (session.receipt?.endpoint === null || !same(result.endpoint, session.receipt?.endpoint)))
      throw new AppError('单应用真实图形监听已变化', 409, 'SINGLE_APP_LISTENER_CHANGED');
    return result;
  }
  private view(session: Session, status: SingleAppWindowView['status'] = session.phase === 'running' ?
    (session.revoked ? 'relaunch-required' : 'running') : session.phase === 'stopped' ? 'stopped' : 'cleanup-pending'): SingleAppWindowView {
    return singleAppViewSchema.parse({ id: session.id, vmId: session.vmId, program: session.program, display: session.receipt?.display || 0,
      port: session.receipt?.port || 0, resolution: session.resolution, clipboard: session.clipboard, startedAt: session.startedAt,
      projectId: session.projectId, networkIsolation: session.networkIsolation, password: session.receipt?.password || '',
      dataDirectory: appIdentity(session.id).home, revoked: session.revoked, projectOwner: { uid: session.identity.uid, user: session.identity.account },
      applicationOwner: session.receipt ? { uid: session.receipt.uid, user: session.receipt.user } : undefined,
      cleanupPending: status === 'cleanup-pending' || (session.phase !== 'running' && session.phase !== 'stopped'), lastError: session.lastError,
      status });
  }
  async list(id: string) {
    this.machines.get(id); await this.load(id); await this.sync(id);
    const rows = await Promise.all([...this.sessions.values()].filter(session => session.vmId === id).map(async session => {
      if (session.phase === 'stopped') return this.view(session, 'stopped');
      try { this.enforcePolicy(session); }
      catch { return { ...this.view(session, 'cleanup-pending'), cleanupPending: true, lastError: 'SINGLE_APP_CLIPBOARD_POLICY_CHANGED' }; }
      if (this.machines.state(id) === 'paused') return this.view(session, 'cleanup-pending');
      if (session.phase !== 'running' || this.machines.state(id) !== 'running') return this.view(session,
        ['intent', 'prepared', 'starting'].includes(session.phase) ? 'preparing' : 'cleanup-pending');
      try { const state = await this.status(session); return this.view(session, state.state === 'running'
        ? (session.revoked ? 'relaunch-required' : 'running') : 'cleanup-pending'); }
      catch (error) { return { ...this.view(session, 'cleanup-pending'), cleanupPending: true,
        lastError: error instanceof AppError ? error.code || 'SINGLE_APP_CONTROL_FAILED' : 'SINGLE_APP_CONTROL_FAILED' }; }
    }));
    if (this.machines.state(id) === 'running') {
      const live = this.live(id), legacy = await this.control.legacy(id);
      this.live(id, live);
      for (const entry of legacy) if (!this.sessions.has(entry.id)) rows.push({
        id: entry.id, vmId: id, program: 'legacy', display: 0, port: 0, resolution: '1024x768',
        clipboard: { copy: false, paste: false }, startedAt: '', projectId: undefined, networkIsolation: undefined,
        password: '', dataDirectory: entry.home, revoked: true, projectOwner: undefined,
        applicationOwner: { uid: entry.uid, user: entry.user }, cleanupPending: false,
        lastError: '旧窗口缺少原项目、boot、cgroup 和 namespace 票据；请管理员人工核对', status: 'review-required',
      });
    }
    return rows;
  }
  async port(id: string, sessionId: string) {
    await this.load(id); await this.sync(id); const session = this.sessions.get(z.uuid().parse(sessionId));
    if (!session || session.vmId !== id || session.phase !== 'running') throw new AppError('应用窗口会话不存在或待清理', 404);
    this.enforcePolicy(session);
    if (session.revoked) throw new AppError('剪贴板规则已收紧，请停止并重开此窗口', 409);
    this.machines.requireUnlocked(id); const status = await this.status(session);
    this.enforcePolicy(session);
    if (status.state !== 'running' || session.revoked || this.sessions.get(sessionId) !== session || session.phase !== 'running')
      throw new AppError('应用窗口会话已退出或变化', 409);
    this.livePins.set(session.id, this.live(id)); return session.receipt!.port;
  }
  async connectionCommand(id: string, sessionId: string, port: number) {
    if (await this.port(id, sessionId) !== port) throw new AppError('应用窗口端口不匹配', 409);
    this.machines.requireUnlocked(id); const session = this.sessions.get(sessionId)!;
    return this.control.streamCommand(session.build, origin(session));
  }
  async start(id: string, raw: unknown, signal?: AbortSignal) {
    const input = singleAppInput.parse(raw), scope = this.workspaces?.projects.current(id), live = this.live(id);
    const abort = AbortSignal.any([this.closeAbort.signal, ...(signal ? [signal] : [])]);
    const pending = this.machines.locked(`single-app:${id}`, async () => {
      if (!this.workspaces || !this.terminals || !scope) throw new AppError('单应用窗口需要项目工作区服务', 409);
      if (this.closed || this.machines.closing) throw new AppError('应用窗口服务正在关闭', 503);
      abort.throwIfAborted(); this.machines.requireUnlocked(id); this.live(id, live); await this.load(id); await this.sync(id);
      const all = [...this.sessions.values()].filter(session => session.vmId === id);
      if (all.filter(session => session.phase !== 'stopped').length >= 4)
        throw new AppError('每个实例最多保留四个未清理的单应用窗口，请先确认原窗口停止', 409);
      if (all.length >= 1024) throw new AppError('单应用历史票据达到上限，请保留记录并显式整理', 409, 'SINGLE_APP_HOST_LIMIT');
      let preparation: Preparation | undefined, retained = false, published = false, session: Session | undefined;
      try {
        preparation = await this.terminals.prepare(id, scope, null, false, abort, undefined, { mode: 'task' });
        if (!preparation.captured) throw new AppError('单应用项目准备未返回捕获配置', 409);
        const captured = preparation.captured;
        if (captured.live !== live || preparation.projectId !== scope) throw new AppError('单应用原项目或 live 已变化', 409, 'SINGLE_APP_LIVE_CHANGED');
        const project: Project = structuredClone(captured.project);
        Object.defineProperty(project, '_workspace', { value: scope, enumerable: false });
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        const rules = await this.clipboardPolicies(id), rule = rules[input.program];
        const clipboard = { copy: input.clipboard.copy && (rule?.copy ?? true), paste: input.clipboard.paste && (rule?.paste ?? true) };
        const identity = await this.scopes.identity(id, project, abort);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        const build = await this.control.install(id, abort);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        const nativeBuild = await this.identities.install(id, abort);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        const expectedNativeBuild = await (this.options.nativeBuild?.() || projectIdentitySources().then(source => source.manifest.build));
        if (nativeBuild !== expectedNativeBuild) throw new AppError('原项目 native 构建在捕获中已变化', 409, 'SINGLE_APP_NATIVE_CHANGED');
        const bootId = await this.boot(id, live);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        session = singleAppRunRecordSchema.parse({ version: 1, id: randomUUID(), vmId: id, ...input, clipboard,
          startedAt: new Date().toISOString(), projectId: scope, directory: project.directory, networkIsolation: project.networkIsolation || 'host',
          configVersion: captured.configVersion, bootId, build, nativeBuild, phase: 'intent', identity,
          run: null, receipt: null, revoked: false, retirement: null, closure: null });
        this.sessions.set(session.id, session); this.leases.set(session.id, preparation.release); this.livePins.set(session.id, live); retained = true;
        // The stable UUID and captured boot/account precede native prepare.
        await this.save(id);
        published = true;
        const run = projectIdentityRunSchema.parse(await this.control.prepareRun(id, session.build,
          { id: session.id, identity, bootId: session.bootId, nativeBuild: session.nativeBuild }, abort));
        singleAppRunRecordSchema.parse({ ...session, run }); origin({ ...session, run });
        session.run = run;
        await this.save(id);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        session.receipt = this.matchReceipt(session, await this.control.call(id, build, 'prepare', origin(session), undefined, abort));
        session.phase = 'prepared'; await this.save(id); await this.validateCapture(id, live, scope, captured.configVersion, abort);
        session.phase = 'starting'; await this.save(id);
        const running = this.matchReceipt(session, await this.control.call(id, build, 'start', origin(session), project.environment || {}, abort));
        if (running.state !== 'running') throw new AppError('单应用图形监听尚未确认', 409, 'SINGLE_APP_START_FAILED');
        session.receipt = running; session.phase = 'running'; await this.save(id);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        if (this.closed || this.machines.closing) throw new AppError('应用窗口服务正在关闭', 503);
        this.watch(session.id);
        return this.view(session);
      } catch (error) {
        if (session && retained && !published) {
          // No native prepare was issued. A failed host intent write never
          // authorizes creating guest resources merely to clean them up.
          this.sessions.delete(session.id); this.leases.delete(session.id); this.livePins.delete(session.id); retained = false;
        } else if (session && retained) {
          try { await this.terminate(session); retained = false; preparation = undefined; }
          catch { throw new AppError('单应用原运行清理未确认；票据和准备租约已保留，请重试停止原会话', 503, 'SINGLE_APP_CLEANUP_FAILED'); }
        }
        throw error;
      } finally { if (!retained && preparation) await preparation.release(); }
    });
    this.pending.add(pending); try { return await pending; } finally { this.pending.delete(pending); }
  }
  private async terminate(session: Session) {
    clearTimeout(this.watchers.get(session.id)); this.watchers.delete(session.id);
    this.disconnect(session.id); session.phase = 'stopping'; await this.save(session.vmId);
    try {
      const live = this.live(session.vmId);
      const cleanupBoot = await this.boot(session.vmId, live);
      if (this.livePins.has(session.id) && this.livePins.get(session.id) !== live && cleanupBoot === session.bootId)
        throw new AppError('原单应用 live 已变化且尚未证明客户机重启', 409, 'SINGLE_APP_LIVE_CHANGED');
      if (!session.run) {
        const recovered = appRecoverySchema.parse(await this.control.recover(session.vmId, session.build,
          { id: session.id, identity: session.identity, bootId: session.bootId, nativeBuild: session.nativeBuild }));
        this.live(session.vmId, live);
        if (recovered.absence) {
          if (recovered.absence.currentBootId !== cleanupBoot)
            throw new AppError('原单应用不存在证明的客户机 boot 已变化', 503, 'SINGLE_APP_CLEANUP_UNCONFIRMED');
          singleAppRunRecordSchema.parse({ ...session, absence: recovered.absence, phase: 'stopped' });
          session.absence = recovered.absence; session.phase = 'stopped';
          await this.save(session.vmId); await this.retireLease(session); return;
        }
        const run = projectIdentityRunSchema.parse({ ...recovered.run!, phase: 'active' });
        singleAppRunRecordSchema.parse({ ...session, run }); origin({ ...session, run });
        session.run = run; await this.save(session.vmId);
      }
      this.live(session.vmId, live);
      const stopped = appStopSchema.parse(await this.control.call(session.vmId, session.build, 'stop', origin(session)));
      this.live(session.vmId, live);
      const original = session.run;
      if (Object.keys(original).some(key => key !== 'phase' && original[key as keyof typeof original] !== stopped.run[key as keyof typeof stopped.run]) ||
          (stopped.retirement ? stopped.retirement.bootId !== cleanupBoot || stopped.retirement.bootId === session.bootId
            : cleanupBoot !== session.bootId || stopped.run.phase !== 'closed') ||
          (stopped.receipt && (this.matchReceipt(session, stopped.receipt).state !== 'stopped' ||
            !same(stopped.receipt.retirement, stopped.retirement))))
        throw new AppError('单应用原运行关闭回执不符', 503, 'SINGLE_APP_CLEANUP_UNCONFIRMED');
      session.receipt = stopped.receipt; session.retirement = stopped.retirement; session.closure = stopped.run;
      session.phase = 'stopped'; delete session.lastError;
      await this.save(session.vmId); await this.retireLease(session);
    } catch (error) {
      session.phase = 'cleanup-failed'; session.lastError = error instanceof AppError ? error.code || 'SINGLE_APP_CLEANUP_FAILED' : 'SINGLE_APP_CLEANUP_FAILED';
      await this.save(session.vmId); throw error;
    }
  }
  async stop(id: string, sessionId: string) {
    return this.machines.locked(`single-app:${id}`, async () => {
      await this.load(id); await this.sync(id); const session = this.sessions.get(z.uuid().parse(sessionId));
      if (!session || session.vmId !== id) throw new AppError('应用窗口会话不存在', 404);
      if (session.phase === 'stopped') {
        // The validated durable row carries the exact closed run or complete
        // absence/retirement proof. A reloaded owner already closed it. Only
        // retire this owner's RAM lease; never rewrite a stale journal or
        // invoke native stop/prepare again.
        await this.retireLease(session);
        return { stopped: true };
      }
      if (this.machines.state(id) === 'paused') throw new AppError('请先恢复实例，再停止应用窗口', 409);
      await this.terminate(session); return { stopped: true };
    });
  }
  async close() {
    this.closed = true; this.closeAbort.abort();
    for (const timer of this.watchers.values()) clearTimeout(timer); this.watchers.clear();
    await Promise.allSettled([...this.pending]);
    // Serialize each VM; parallel stop calls would collide on Machines.locked.
    const ids = [...new Set([...this.sessions.values()].filter(session => session.phase !== 'stopped' || this.leases.has(session.id)).map(session => session.vmId))];
    const results = await Promise.allSettled(ids.map(async id => {
      const failures: unknown[] = [];
      for (const session of [...this.sessions.values()].filter(value => value.vmId === id && (value.phase !== 'stopped' || this.leases.has(value.id))))
        try { await this.stop(id, session.id); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, '原实例单应用清理未确认');
    }));
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), '单应用原运行清理未确认；记录和配置门闩继续保留');
    this.machines.off('change', this.onChange); this.machines.off('incident-lockdown', this.onLock); this.removeConfigGuard?.();
    if (!this.options.terminals) await this.terminals?.close(); this.sessionListeners.clear();
  }
}
