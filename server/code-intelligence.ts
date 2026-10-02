import { posix } from 'node:path';
import type { Machines } from './machines.ts';
import { projectPrivateValues, projectVersion, type Project, type Workspaces } from './workspaces.ts';
import { repositoryPath } from './git-workbench.ts';
import { quote } from './files.ts';
import { AppError, guestPath } from './model.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactValues } from './secrets.ts';

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
};
type Preparation = Pick<ProjectTerminals, 'prepare' | 'close'>;
export type CodeIntelligenceOptions = {
  createPreparation?: () => Preparation;
  runProjectTask?: typeof projectIdentityTask;
};

function capturedProject(project: Project, projectId: string) {
  // Workspaces.config deliberately keeps this outside the serialized config.
  // structuredClone alone would silently turn a named project into default.
  const captured = structuredClone(project);
  Object.defineProperty(captured, '_workspace', {
    value: projectId === 'default' ? undefined : projectId,
    enumerable: false,
  });
  return captured;
}

export class CodeIntelligence {
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private options: CodeIntelligenceOptions = {},
  ) {}
  async diagnose(id: string, path: string, signal?: AbortSignal) {
    // Capture scope and Live before the first asynchronous config read.
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    const requestSignal = signal || new AbortController().signal;
    requestSignal.throwIfAborted();
    return this.workspaces.projects.inScope(id, projectId, async () => {
      const original = await this.workspaces.config(id);
      requestSignal.throwIfAborted();
      if ((original._workspace || 'default') !== projectId)
        throw new AppError('诊断配置不属于原项目', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const project = capturedProject(original, projectId), version = projectVersion(project);
      // The file editor uses absolute guest paths; CLI callers use project-relative paths.
      // Both forms must stay inside the originally captured project directory.
      path = repositoryPath.parse(
        path.startsWith('/') ? posix.relative(project.directory, guestPath(path)) : path,
      );
      const target = posix.join(project.directory, path);
      const ext = path.split('.').pop()?.toLowerCase();
      let command: string;
      if (['js', 'jsx', 'mjs', 'cjs'].includes(ext || '')) command = `node --check ${quote(target)}`;
      else if (['ts', 'tsx'].includes(ext || ''))
        command = `if command -v tsc >/dev/null; then tsc --noEmit --pretty false ${quote(target)}; else node --check ${quote(target)}; fi`;
      else if (ext === 'py') command = `python3 -m py_compile ${quote(target)}`;
      else if (ext === 'json') command = `python3 -m json.tool ${quote(target)} >/dev/null`;
      else return { path, diagnostics: [], supported: false };
      if (!live || this.machines.state(id) !== 'running')
        throw new AppError('请先启动或恢复实例', 409);
      const assertCurrent = async () => {
        const assertOrigin = () => {
          requestSignal.throwIfAborted();
          if (this.workspaces.projects.current(id) !== projectId ||
              this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
            throw new AppError('诊断原项目或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        };
        assertOrigin();
        const current = await this.workspaces.config(id);
        assertOrigin();
        if ((current._workspace || 'default') !== projectId || projectVersion(current) !== version)
          throw new AppError('诊断原项目配置已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      };
      await assertCurrent();
      // Each finite check owns its preparation manager. Its config guard stays
      // registered until the UID task has confirmed cleanup of the whole domain.
      const preparation = this.options.createPreparation?.() || new ProjectTerminals(this.machines, this.workspaces);
      let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
      let failed = false, failure: unknown;
      try {
        prepared = await preparation.prepare(id, projectId, null, false, requestSignal, undefined, { mode: 'task' });
        const { captured, signal: executionSignal } = prepared;
        if (!captured || !executionSignal || prepared.projectId !== projectId || captured.live !== live ||
            (captured.project._workspace || 'default') !== projectId || captured.configVersion !== version ||
            projectVersion(captured.project) !== version)
          throw new AppError('诊断准备租约不属于原项目、配置或客户机', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        await assertCurrent();
        executionSignal.throwIfAborted();
        const resolved = await this.workspaces.resolveProject(id, project);
        await assertCurrent();
        executionSignal.throwIfAborted();
        if ((resolved._workspace || 'default') !== projectId || resolved.directory !== project.directory ||
            (resolved.networkIsolation || 'host') !== (project.networkIsolation || 'host') ||
            projectVersion(project) !== version)
          throw new AppError('诊断解析配置改变了原项目执行边界', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        const execution = { command, environment: resolved.environment };
        // Body and resolved environment travel in the bounded native stdin
        // frame. Neither is interpolated into the root infrastructure argv.
        projectIdentityPayload(execution);
        const result = await (this.options.runProjectTask || projectIdentityTask)(this.machines, id, project,
          execution, executionSignal, undefined, 30000, undefined, undefined, { expectedLive: live });
        await assertCurrent();
        executionSignal.throwIfAborted();
        const output = redactValues(`${result.stdout}\n${result.stderr}`.trim(), projectPrivateValues(resolved));
        if (result.code === 0) return { path, diagnostics: [], supported: true };
        const diagnostics: Diagnostic[] = output
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 100)
          .map((line) => {
            const match = line.match(/(?::|\()([0-9]+)(?::|,)([0-9]+)?(?:\)|:)?\s*(.*)$/);
            return {
              severity: 'error' as const,
              line: match ? Number(match[1]) : undefined,
              column: match?.[2] ? Number(match[2]) : undefined,
              message: match?.[3] || line.slice(0, 500),
            };
          });
        return { path, diagnostics, supported: true };
      } catch (error) { failed = true; failure = error; throw error; }
      finally {
        // Try both releases even if either fails. A successful compiler result
        // must never hide an unconfirmed preparation or native cleanup.
        const errors: unknown[] = [];
        try { await prepared?.release(); } catch (error) { errors.push(error); }
        try { await preparation.close(); } catch (error) { errors.push(error); }
        if (errors.length) {
          if (failed) errors.unshift(failure);
          if (errors.length === 1) throw errors[0];
          const critical = errors.find((error): error is AppError => error instanceof AppError && error.status === 503);
          const combined = new AggregateError(errors, critical?.message || '诊断任务准备清理未确认，请核查原运行记录',
            { cause: critical || failure || errors[0] });
          // Preserve the cleanup status/code at the HTTP boundary while keeping
          // every original exception in errors. A lone task error is unchanged.
          if (critical) Object.assign(combined, { status: critical.status, code: critical.code });
          throw combined;
        }
      }
    });
  }
}
