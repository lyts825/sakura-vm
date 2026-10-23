/** 协调本地模型、单文件补丁、单次沙箱验证和受控接受。
 * Coordinates local models, single-file patches, one-run sandbox validation and guarded acceptance. */
import { createHash, randomUUID } from 'node:crypto';
import type { VmAccess } from './vm-access.ts';
import type { LocalAssistantV1, SandboxesV1, WorkspacesV1, FileLocksV1 } from './service-contracts/v1.ts';
import { AppError } from '../shared/errors.ts';
import { redactAssistantContext } from '../shared/assistant.ts';
import { repairFilesSchema, repairPatchSchema, repairStartSchema, repairValidateSchema,
  type RepairFile, type RepairSession } from '../shared/contracts/repair-session.ts';
import { repairFiles } from './repair-files.ts';
import { sandboxInputDirectory } from './sandbox-inputs.ts';
import { vmLifetime } from './vm-lifetime.ts';
import { withoutOperationContext } from './operation-context.ts';

type Session = { view: RepairSession; files: RepairFile[]; modelToken: string; version: string;
  directory: string; binding: string; sandboxCreatedAt?: string; controller?: AbortController; pending?: Promise<unknown> };
/** 对文本内容生成精确摘要。 Hash the exact text content. */
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export class RepairSessions {
  private sessions = new Map<string, Session>();
  private closed = false;
  /** 注入受限能力和可隔离验证的文件端口。 Bind restricted capabilities and a testable file port. */
  constructor(private machines: VmAccess, private workspaces: WorkspacesV1,
    private assistant: LocalAssistantV1 | (() => LocalAssistantV1), private sandboxes: SandboxesV1, private fileLocks: FileLocksV1,
    private fileAccess = repairFiles) {}

  /** 允许本体模型服务降级，使用时明确报告不可用。 Allow degraded host availability and report unavailability at use time. */
  private model() { return typeof this.assistant === 'function' ? this.assistant() : this.assistant; }

  /** 固定运行代次及项目；所有文件操作均核对同一绑定。 Fix runtime generation and project for all file operations. */
  private binding(id: string) {
    const live = this.machines.live.get(id);
    if (!live || this.machines.state(id) !== 'running') throw new AppError('请先启动项目实例', 409);
    this.machines.requireUnlocked(id);
    // 首次探测会补上 bootId；稳定代次已包含重启/恢复变化。 The first probe adds bootId; stable generations already cover reboot/resume changes.
    const { vmId, vmProcessId, executionGeneration } = vmLifetime(id, live).capture();
    return JSON.stringify({ vm: this.machines.get(id), identity: { vmId, vmProcessId, executionGeneration },
      projectId: this.workspaces.projects.current(id) });
  }

  /** 获取属于当前实例和项目的会话。 Resolve a session owned by this VM and project. */
  private get(id: string, sessionId: string) {
    if (this.closed) throw new AppError('修复插件正在关闭', 503);
    const session = this.sessions.get(sessionId);
    if (!session || session.view.vmId !== id || session.view.projectId !== this.workspaces.projects.current(id))
      throw new AppError('修复会话不存在于当前项目', 404);
    return session;
  }

  /** 返回防止调用方修改的会话快照。 Return a detached session snapshot. */
  view(id: string, sessionId: string): RepairSession { return structuredClone(this.get(id, sessionId).view); }

  /** 文件端口在准备前后核对捕获的运行身份。 Recheck the captured runtime identity around file preparation. */
  private fileGuard(id: string, binding: string, version: string) {
    return { workspaces: this.workspaces, version, assertCurrent: () => {
      if (this.binding(id) !== binding) throw new AppError('实例已变化，请重新选择文件', 409);
    } };
  }

  /** 只清理本会话创建的沙箱；同标识替代资源必须保留。 Clean only the sandbox created by this session, preserving replacements. */
  private async cleanupSandbox(session: Session) {
    const validation = session.view.validation, sandboxId = validation?.sandboxId;
    if (!sandboxId || validation.cleanup === 'done') return;
    const current = this.machines.records.get(sandboxId);
    if (current && current.createdAt !== session.sandboxCreatedAt)
      throw new AppError('沙箱身份已变化，拒绝清理替代资源', 409);
    if (!current && this.machines.live.has(sandboxId)) throw new AppError('沙箱记录缺失但运行仍存在，清理未确认', 409);
    if (current) await withoutOperationContext(() => this.sandboxes.control(sandboxId, 'destroy', session.sandboxCreatedAt));
    validation.cleanup = 'done';
  }

  /** 核对配置、运行代次和全部原始文件摘要。 Recheck config, runtime generation and every original file digest. */
  private async verify(session: Session, signal?: AbortSignal) {
    const id = session.view.vmId;
    signal?.throwIfAborted();
    if (Date.parse(session.view.expiresAt) <= Date.now() || this.binding(id) !== session.binding)
      throw new AppError('修复会话已过期或实例已变化，请重新选择文件', 409);
    const current = await this.workspaces.view(id);
    if (current.version !== session.version || current.project.directory !== session.directory)
      throw new AppError('项目配置已变化，请重新选择文件', 409);
    await this.fileAccess(this.machines, id, { root: session.directory,
      paths: session.files.map(file => file.path), expected: Object.fromEntries(session.view.files.map(file => [file.path, file.sha256])) }, signal,
      this.fileGuard(id, session.binding, session.version));
    if (this.binding(id) !== session.binding) throw new AppError('实例已变化', 409);
  }

  /** 读取明确选中的文件，生成可审阅的脱敏发送预览。 Read selected files and prepare a reviewable redacted model preview. */
  async preview(id: string, input: unknown, signal?: AbortSignal) {
    if (this.closed) throw new AppError('修复插件正在关闭', 503);
    const config = repairStartSchema.parse(input), binding = this.binding(id), project = await this.workspaces.view(id);
    const paths = [...new Set([config.target, ...config.context])];
    const files = await this.fileAccess(this.machines, id, { root: project.project.directory, paths }, signal, this.fileGuard(id, binding, project.version));
    signal?.throwIfAborted();
    if (this.closed) throw new AppError('修复插件正在关闭', 503);
    if (this.binding(id) !== binding || (await this.workspaces.view(id)).version !== project.version)
      throw new AppError('项目已变化，请重试', 409);
    const target = files.find(file => file.path === config.target)!;
    if (redactAssistantContext(target.content).redactions || target.content.includes('[REDACTED'))
      throw new AppError('目标文件包含敏感内容标记，请选择不含密钥的文件；避免自动替换损坏敏感值', 409);
    const preview = this.model().preview({ mode: 'fix', instruction: config.instruction +
      '\n只返回 JSON 对象 {"path":"目标相对路径","content":"修复后完整文件内容","summary":"变更说明"}。' +
      '\n仅允许修改目标文件 ' + config.target + '。不要返回 Markdown，不要修改或推测脱敏内容。', context: JSON.stringify(files) });
    for (const [key, old] of this.sessions) if (!old.pending && (!old.view.validation?.sandboxId || old.view.validation.cleanup === 'done') &&
      (old.view.state === 'applied' || Date.parse(old.view.expiresAt) <= Date.now())) this.sessions.delete(key);
    if (this.sessions.size >= 8) throw new AppError('最多保留 8 个修复会话，请先取消不用的会话', 409);
    const view: RepairSession = { id: randomUUID(), vmId: id, projectId: project.projectId, target: config.target,
      state: 'preview', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), before: target.content,
      files: files.map(file => ({ path: file.path, sha256: sha(file.content), bytes: Buffer.byteLength(file.content) })),
      preview: { content: preview.content, model: preview.model, endpoint: preview.endpoint,
        redactions: preview.redactions, expiresAt: preview.expiresAt } };
    this.sessions.set(view.id, { view, files, modelToken: preview.id, version: project.version,
      directory: project.project.directory, binding });
    return structuredClone(view);
  }

  /** 为一次异步阶段提供取消及互斥，失败不改原项目。 Serialize a cancellable stage without changing source files on failure. */
  private async operate(session: Session, signal: AbortSignal | undefined, work: (active: AbortSignal) => Promise<void>) {
    if (session.pending) throw new AppError('修复会话已有操作进行中', 409);
    const controller = new AbortController(); session.controller = controller;
    const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const pending = Promise.resolve().then(() => work(active)); session.pending = pending;
    try { await pending; }
    catch (error) {
      if (session.view.state !== 'apply-unknown') session.view.state = active.aborted ? 'cancelled' : 'failed';
      session.view.error = session.view.state === 'apply-unknown'
        ? '应用结果待核对：文件可能已替换，请检查原文件及补丁摘要；本会话不能自动重试。' + (error as Error).message
        : (error as Error).message;
      throw error;
    }
    finally { session.pending = undefined; session.controller = undefined; }
    return structuredClone(session.view);
  }

  /** 用户确认发送后才消费模型令牌并生成补丁。 Consume the model token only after explicit send confirmation. */
  async generate(id: string, sessionId: string, signal?: AbortSignal) {
    const session = this.get(id, sessionId);
    if (session.view.state !== 'preview') throw new AppError('请重新创建发送预览', 409);
    return this.operate(session, signal, async active => {
      session.view.state = 'generating'; await this.verify(session, active);
      const result = await this.model().generate(session.modelToken, active); active.throwIfAborted();
      if (result.truncated) throw new AppError('模型结果被截断，未生成可应用补丁', 502);
      const patch = repairPatchSchema.parse(JSON.parse(result.content));
      if (patch.path !== session.view.target || patch.content.includes('[REDACTED')) throw new AppError('模型补丁目标或内容不符合预览', 502);
      repairFilesSchema.parse(session.files.map(file => file.path === patch.path ? { path: file.path, content: patch.content } : file));
      await this.verify(session, active);
      session.view.patch = patch; session.view.patchSha256 = sha(patch.content); session.view.state = 'review';
    });
  }

  /** 在新建的断网沙箱中执行审阅后的命令；只重建选中的文本。 Execute the reviewed command in a new isolated sandbox containing selected text only. */
  async validate(id: string, input: unknown, signal?: AbortSignal) {
    const config = repairValidateSchema.parse(input), session = this.get(id, config.sessionId);
    if (!session.view.patch || !['review', 'validated', 'failed'].includes(session.view.state)) throw new AppError('请先生成补丁', 409);
    if (session.view.validation?.sandboxId && session.view.validation.cleanup !== 'done') throw new AppError('上次沙箱清理未完成，请先取消会话重试清理', 409);
    return this.operate(session, signal, async active => {
      await this.verify(session, active);
      const patch = session.view.patch!, hash = sha(patch.content);
      session.view.state = 'validating'; session.view.error = undefined;
      session.view.validation = { command: config.command, patchSha256: hash, cleanup: 'pending', passed: false };
      let sandboxId: string | undefined;
      try {
        active.throwIfAborted();
        const box = await this.sandboxes.create({ name: 'repair-' + session.view.id.slice(0, 8),
          distro: this.machines.get(id).distro, network: 'isolated', storage: 'discard-on-stop',
          lifetimeMinutes: 10, onExpire: 'delete' });
        sandboxId = box.id; session.view.validation.sandboxId = sandboxId; session.sandboxCreatedAt = box.createdAt;
        active.throwIfAborted();
        const job = this.sandboxes.run(sandboxId, { command: config.command, cwd: sandboxInputDirectory,
          timeoutSeconds: config.timeoutSeconds, inputFiles: session.files.map(file =>
            file.path === patch.path ? { path: file.path, content: patch.content } : file) });
        session.view.validation.job = job;
        /** 只取消本会话创建的沙箱任务。 Cancel only this session's sandbox job. */
        const cancel = () => {
          try {
            if (this.machines.records.get(sandboxId!)?.createdAt === session.sandboxCreatedAt)
              withoutOperationContext(() => this.sandboxes.jobs.cancel(sandboxId!));
          }
          catch { /* 最终清理仍须确认退出。 Final cleanup must still confirm termination. */ }
        };
        active.addEventListener('abort', cancel, { once: true });
        try {
          if (active.aborted) cancel();
          await this.sandboxes.jobs.wait(sandboxId);
          session.view.validation.job = this.sandboxes.jobs.view(sandboxId) || undefined;
          active.throwIfAborted();
        } finally { active.removeEventListener('abort', cancel); }
      } finally {
        if (sandboxId) {
          try {
            // 此处仅释放已捕获的本会话资源，取消不阻止清理。 Release only the captured session resource after cancellation.
            await this.cleanupSandbox(session);
          } catch (error) { session.view.validation.cleanup = 'failed'; throw error; }
        } else session.view.validation.cleanup = 'done';
      }
      const verification = session.view.validation, job = verification.job;
      verification.passed = job?.status === 'done' && job.admission !== 'cleanup-pending' &&
        job.execution?.outcome === 'success' && job.execution.exitCode === 0 && verification.cleanup === 'done';
      session.view.state = verification.passed ? 'validated' : 'review';
      if (!verification.passed) session.view.error = '验证未通过；请检查真实退出码和日志。原项目未修改。';
    });
  }

  /** 仅接受验证过的同一补丁，并再次比较所有原始文件。 Accept only the validated patch after rechecking every original file. */
  async apply(id: string, sessionId: string, signal?: AbortSignal) {
    const session = this.get(id, sessionId), verification = session.view.validation;
    if (session.view.state !== 'validated' || !session.view.patch || !verification?.passed ||
      verification.cleanup !== 'done' || verification.patchSha256 !== sha(session.view.patch.content))
      throw new AppError('需要通过验证且已清理沙箱的同一补丁', 409);
    return this.operate(session, signal, async active => {
      await this.fileLocks.withMutation(id, [session.directory], undefined, () => this.machines.locked(id, async () => {
        await this.verify(session, active); active.throwIfAborted();
        // 写入开始后失败不等于未修改，保留不确定状态防止重放。 A failure after write admission may have changed the file; retain uncertainty and prevent replay.
        session.view.state = 'apply-unknown';
        await this.fileAccess(this.machines, id, { root: session.directory, paths: session.files.map(file => file.path),
          expected: Object.fromEntries(session.view.files.map(file => [file.path, file.sha256])),
          target: session.view.target, replacement: session.view.patch!.content }, active, this.fileGuard(id, session.binding, session.version));
        session.view.state = 'applied';
      }));
    });
  }

  /** 取消模型或验证，清理沙箱并忘记会话。 Cancel work, release its sandbox and forget the session. */
  async cancel(id: string, sessionId: string) {
    if (!this.sessions.has(sessionId)) return { ok: true as const };
    const session = this.get(id, sessionId); session.controller?.abort(new Error('修复会话已取消'));
    await session.pending?.catch(() => {});
    const sandboxId = session.view.validation?.sandboxId;
    if (sandboxId && session.view.validation?.cleanup !== 'done') {
      await this.cleanupSandbox(session);
    }
    session.view.state = 'cancelled'; this.sessions.delete(sessionId);
    return { ok: true as const };
  }

  /** 插件停用时等待在途阶段退出，未清理资源明确报错。 Await in-flight work on shutdown and surface unfinished cleanup. */
  async close() {
    this.closed = true;
    for (const session of this.sessions.values()) session.controller?.abort(new Error('修复插件已停用'));
    await Promise.allSettled([...this.sessions.values()].map(session => session.pending));
    const failures: unknown[] = [];
    for (const [id, session] of this.sessions) {
      try { await this.cleanupSandbox(session); this.sessions.delete(id); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AppError('修复沙箱清理未完成，保留会话身份以便重试；也可在沙箱工作台处理到期资源', 409);
  }
}
