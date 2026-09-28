import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AppError, ROOT } from './model.ts';
import type { Machines } from './machines.ts';
import { projectPrivateValues, type Workspaces } from './workspaces.ts';
import { guestTask } from './guest-task.ts';
import { quote } from './files.ts';
import { redactValues } from './secrets.ts';
import { CommandPresets } from './command-presets.ts';

let source: Promise<string> | undefined;
export function engineeringSource() {
  return (source ||= readFile(join(ROOT, 'server', 'engineering-runner.py'), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(join(ROOT, '.sakura-server', 'assets', 'engineering-runner.py'), 'utf8');
  }));
}
export type EngineeringResult = { code: number; error?: string; [key: string]: unknown };
export function requireSuccessfulResult(result: Record<string, unknown>) {
  if (result.code !== 0)
    throw new AppError(
      String(result.error || '工程操作未通过（退出码 ' + (result.code ?? '未知') + '）'),
      409,
    );
}
export async function runEngineeringOperation(
  machines: Machines,
  workspaces: Workspaces,
  id: string,
  operation: string,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
): Promise<EngineeringResult> {
  const project = await workspaces.resolvedConfig(id);
  const request = JSON.stringify({
    operation,
    directory: project.directory,
    environment: project.environment,
    parameters: operation === 'guest-clock-policy' ? { ...parameters, _hostEpochMs: Date.now() } : parameters,
  });
  const payload = Buffer.from(request).toString('base64');
  const script = await engineeringSource();
  const seconds = Number(parameters.timeout || 60) * Number(parameters.repeats || parameters.shards || 1);
  const steps = (parameters.steps || parameters.checks || []) as Array<{ timeout?: number }>;
  const timeout = Math.max(
    120_000,
    (seconds * ((operation === 'reproducible-build' ||
      (operation === 'dependency-bot' && parameters.mode === 'apply')) ? 2 : 1) +
      steps.reduce((sum, step) => sum + Number(step.timeout || 60), 0) +
      30) *
      1000,
  );
  const helper = '/tmp/.sakura-engineering-' + randomUUID() + '.py';
  await machines.writeGuestFile(id, helper, script, false);
  const command =
    'trap ' +
    quote('rm -f -- ' + quote(helper)) +
    " EXIT\ncommand -v python3 >/dev/null || { printf '%s\\n' '工程操作需要客户机 Python 3，请在工具链中安装 Python。' >&2; exit 127; }\nprintf '%s' " +
    quote(payload) +
    ' | base64 -d | python3 ' +
    quote(helper);
  const output = await guestTask(machines, id, command, signal, undefined, timeout);
  let result: EngineeringResult;
  try {
    result = JSON.parse(output.stdout);
  } catch {
    throw new AppError(
      redactValues(output.stderr || '工程执行器没有返回有效结果', projectPrivateValues(project)),
      409,
    );
  }
  if (typeof result?.code !== 'number') throw new AppError('工程执行器响应缺少退出码', 502);
  if (output.code !== 0 && result.code === 0) result.code = output.code;
  if (operation === 'task-import' && parameters.save && result.code === 0) {
    const presets = new CommandPresets(machines, workspaces);
    try {
      const current = await presets.list(id);
      const tasks = (result.tasks as Array<{ name: string; command: string }>).map((task) => ({
        ...task,
        name: task.name.slice(0, 60),
      }));
      const additions = tasks.filter(
        (task) => !current.some((item) => item.name === task.name && item.command === task.command),
      );
      if (current.length + additions.length > 50)
        throw new AppError('导入后收藏命令超过 50 条，请减少任务数量');
      for (const task of additions)
        await presets.save(id, { name: task.name.slice(0, 60), command: task.command });
      result.saved = additions.length;
    } finally {
      await presets.close();
    }
  }
  const privateValues = projectPrivateValues(project);
  const redact = (value: unknown): unknown =>
    typeof value === 'string'
      ? redactValues(value, privateValues)
      : Array.isArray(value)
        ? value.map(redact)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]))
          : value;
  return redact(result) as EngineeringResult;
}
