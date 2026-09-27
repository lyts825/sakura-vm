import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';

export const networkQuotaShape = {
  mode: z.enum(['status', 'apply', 'clear']).default('status'),
  interface: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,14}$/).default('eth0'),
  egressKbps: z.number().int().min(64).max(1_000_000).default(1024),
  burstKiB: z.number().int().min(4).max(4096).default(32),
  latencyMs: z.number().int().min(10).max(1000).default(200),
};

export const networkQuotaSchema = z.object(networkQuotaShape).strict();

const ownedRoot = (output: string) => /^qdisc tbf 42: root\b/m.test(output);
const defaultRoot = (output: string) =>
  !output.trim() || /^qdisc (?:fq_codel|noqueue|pfifo_fast|mq|fq) (?:0:|[0-9a-f]+:) root\b/m.test(output);

export async function networkQuota(
  machines: Machines,
  id: string,
  input: unknown,
  action: 'check' | 'run',
  signal?: AbortSignal,
) {
  const options = networkQuotaSchema.parse(input);
  const preview = {
    interface: options.interface,
    egressKbps: options.egressKbps,
    burstKiB: options.burstKiB,
    latencyMs: options.latencyMs,
  };
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, preview, reason: '请先启动发行版。' };

  const inspect = async () => {
    signal?.throwIfAborted();
    const result = await machines.exec(id,
      `command -v tc >/dev/null || exit 127\ntest -d /sys/class/net/${options.interface} || exit 2\ntc qdisc show dev ${options.interface}`,
      10000, signal);
    if (result.code === 127) throw new AppError('客户机缺少 tc；请安装 iproute2', 409);
    if (result.code === 2) throw new AppError(`客户机网卡 ${options.interface} 不存在`, 409);
    if (result.code !== 0) throw new AppError(result.stderr || '读取客户机带宽规则失败', 409);
    return result.stdout.trim();
  };

  const before = await inspect();
  const active = ownedRoot(before);
  if (action === 'check' || options.mode === 'status')
    return { ready: true, executed: false, preview, current: before, active };
  if (!active && !defaultRoot(before))
    throw new AppError('网卡已有其他根队列规则，拒绝覆盖；请先移除冲突规则', 409);
  if (options.mode === 'clear' && !active)
    return { ready: true, executed: false, preview, current: before, active: false };

  const command = options.mode === 'clear'
    ? `tc qdisc del dev ${options.interface} root`
    : `tc qdisc replace dev ${options.interface} root handle 42: tbf rate ${options.egressKbps}kbit burst ${options.burstKiB}kb latency ${options.latencyMs}ms`;
  signal?.throwIfAborted();
  const changed = await machines.exec(id, command, 10000, signal);
  if (changed.code !== 0) throw new AppError(changed.stderr || '修改客户机带宽规则失败', 409);
  const current = await inspect();
  const nowActive = ownedRoot(current);
  if (nowActive !== (options.mode === 'apply')) throw new AppError('客户机带宽规则未达到预期状态', 409);
  return { ready: true, executed: true, preview, previous: before, current, active: nowActive };
}
