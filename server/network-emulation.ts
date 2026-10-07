/**
 * 模块职责：校验并应用客户机延迟、抖动和丢包策略，拒绝相互矛盾或没有效果的输入。
 * Module purpose: Validates/applies guest delay, jitter and packet loss policies, rejecting contradictory or ineffective settings.
 */
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';

export const networkEmulationShape = {
  mode: z.enum(['inspect', 'apply', 'clear']).default('inspect'),
  interface: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,14}$/)
    .default('eth0'),
  delayMs: z.number().int().min(0).max(2000).default(0),
  jitterMs: z.number().int().min(0).max(500).default(0),
  lossPercent: z.number().min(0).max(25).default(0),
};

export const networkEmulationSchema = z
  .object(networkEmulationShape)
  .strict()
  .refine((value) => value.jitterMs <= value.delayMs, '抖动不能超过延迟')
  .refine(
    (value) => value.mode !== 'apply' || value.delayMs > 0 || value.lossPercent > 0,
    '应用仿真时需要延迟或丢包',
  );

/**
 * 入口 / Entry: netemRoot.
 * 功能：把本层请求转交 `inline.test`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `inline.test` and propagates the provider result or rejection.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `/^qdisc netem \S+ root\b/m.test(output)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const netemRoot = (output: string) => /^qdisc netem \S+ root\b/m.test(output);

/**
 * 入口 / Entry: networkEmulation.
 * 功能：在校验并应用客户机延迟、抖动和丢包策略中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, executed: false, preview, reason: '请先启动发行版。' }` / `{ ready: true, executed: false, preview, current: before, netemActive: netemRoot(before) }` 供上层消费（`network-emulation.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network-emulation.ts`; this entry produces `{ ready: false, executed: false, preview, reason: '请先启动发行版。' }` / `{ ready: true, executed: false, preview, current: before, netemActive: netemRoot(before) }` for its caller. Module context: Validates/applies guest delay, jitter and packet loss policies, rejecting contradictory or ineffective settings.
 * 处理：通过 `networkEmulationSchema.parse`, `machines.state`, `inspect`, `netemRoot` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `networkEmulationSchema.parse`, `machines.state`, `inspect`, `netemRoot`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) !== 'running'`; `action === 'check' || options.mode === 'inspect'`; `options.mode === 'clear' && !netemRoot(before)`.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, preview, reason: '请先启动发行版。' }`; `{ ready: true, executed: false, preview, current: before, netemActive: netemRoot(before) }`; `{ ready: true, executed: false, preview, current: before, netemActive: false }`；另有分支返回 / additional branch-specific returns.
 * 副作用 / Effects: `machines.exec`.
 * 拒绝 / Refusals: 条件 / conditions `changed.code !== 0`; `active !== (options.mode === 'apply')`; 异常 / errors `new AppError(changed.stderr || '修改客户机队列规则失败', 409)`; `new AppError('客户机队列规则未达到预期状态', 409)`.
 */
export async function networkEmulation(
  machines: Machines,
  id: string,
  input: unknown,
  action: 'check' | 'run',
  signal?: AbortSignal,
) {
  const options = networkEmulationSchema.parse(input);
  const preview = {
    interface: options.interface,
    delayMs: options.delayMs,
    jitterMs: options.jitterMs,
    lossPercent: options.lossPercent,
  };
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, preview, reason: '请先启动发行版。' };

  /**
   * 入口 / Entry: networkEmulation.inspect.
   * 功能：在校验并应用客户机延迟、抖动和丢包策略中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result.stdout.trim()` 供上层消费（`network-emulation.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `network-emulation.ts`; this entry produces `result.stdout.trim()` for its caller. Module context: Validates/applies guest delay, jitter and packet loss policies, rejecting contradictory or ineffective settings.
   * 处理：通过 `signal.throwIfAborted`, `machines.exec`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `machines.exec`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `result.stdout.trim()`.
   * 副作用 / Effects: `machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code === 127`; `result.code === 2`; `result.code !== 0`; 异常 / errors `new AppError('客户机缺少 tc；请安装 iproute2', 409)`; `new AppError(`客户机网卡 ${options.interface} 不存在`, 409)`.
   */
  const inspect = async () => {
    signal?.throwIfAborted();
    const result = await machines.exec(
      id,
      `command -v tc >/dev/null || exit 127\ntest -d /sys/class/net/${options.interface} || exit 2\ntc qdisc show dev ${options.interface}`,
      10000,
      signal,
    );
    if (result.code === 127) throw new AppError('客户机缺少 tc；请安装 iproute2', 409);
    if (result.code === 2) throw new AppError(`客户机网卡 ${options.interface} 不存在`, 409);
    if (result.code !== 0) throw new AppError(result.stderr || '读取客户机队列规则失败', 409);
    return result.stdout.trim();
  };

  const before = await inspect();
  if (action === 'check' || options.mode === 'inspect')
    return { ready: true, executed: false, preview, current: before, netemActive: netemRoot(before) };
  if (options.mode === 'clear' && !netemRoot(before))
    return { ready: true, executed: false, preview, current: before, netemActive: false };

  const parameters = [
    options.delayMs > 0
      ? `delay ${options.delayMs}ms${options.jitterMs ? ` ${options.jitterMs}ms` : ''}`
      : '',
    options.lossPercent > 0 ? `loss ${options.lossPercent}%` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const command =
    options.mode === 'clear'
      ? `tc qdisc del dev ${options.interface} root`
      : `tc qdisc replace dev ${options.interface} root netem ${parameters}`;
  signal?.throwIfAborted();
  const changed = await machines.exec(id, command, 10000, signal);
  if (changed.code !== 0) throw new AppError(changed.stderr || '修改客户机队列规则失败', 409);
  const current = await inspect();
  const active = netemRoot(current);
  if (active !== (options.mode === 'apply')) throw new AppError('客户机队列规则未达到预期状态', 409);
  return { ready: true, executed: true, preview, previous: before, current, netemActive: active };
}
