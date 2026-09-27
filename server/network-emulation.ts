import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';

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

const netemRoot = (output: string) => /^qdisc netem \S+ root\b/m.test(output);

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
