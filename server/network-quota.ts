import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';

export const networkQuotaShape = {
  mode: z.enum(['status', 'apply', 'clear']).default('status'),
  interface: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,14}$/).default('eth0'),
  egressKbps: z.number().int().min(64).max(1_000_000).default(1024),
  burstKiB: z.number().int().min(4).max(4096).default(32),
  latencyMs: z.number().int().min(10).max(1000).default(200),
  maxTcpConnections: z.number().int().min(0).max(100_000).default(0),
  newTcpConnectionsPerSecond: z.number().int().min(0).max(10_000).default(0),
  connectionBurst: z.number().int().min(1).max(10_000).default(10),
};
export const networkQuotaSchema = z.object(networkQuotaShape).strict();

type Family = 'iptables' | 'ip6tables';
type Jump = { family: Family; interface: string; chain: string; rules?: string[] };
const marker = 'sakura-network-quota-v1';
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
    maxTcpConnections: options.maxTcpConnections,
    newTcpConnectionsPerSecond: options.newTcpConnectionsPerSecond,
    connectionBurst: options.connectionBurst,
  };
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, preview, reason: '请先启动发行版。' };
  signal?.throwIfAborted();
  // Complete changes to both IP families once a write begins, even if a job is cancelled.
  const readOnly = action === 'check' || options.mode === 'status';
  const execute = async (script: string, tolerate = false) => {
    if (readOnly) signal?.throwIfAborted();
    const result = await machines.exec(id, script, 15000, readOnly ? signal : undefined);
    if (result.code !== 0 && !tolerate)
      throw new AppError(result.stderr.trim() || '客户机网络配额操作失败', 409);
    return result;
  };
  const inspectRoot = async () => {
    const result = await execute(
      `command -v tc >/dev/null || exit 127\ntest -d /sys/class/net/${options.interface} || exit 2\ntc qdisc show dev ${options.interface}`,
      true);
    if (result.code === 127) throw new AppError('客户机缺少 tc；请安装 iproute2', 409);
    if (result.code === 2) throw new AppError(`客户机网卡 ${options.interface} 不存在`, 409);
    if (result.code !== 0) throw new AppError(result.stderr || '读取客户机带宽规则失败', 409);
    return result.stdout.trim();
  };
  const inspectFirewall = async () => {
    const jumps: Jump[] = [];
    let available = true;
    for (const family of ['iptables', 'ip6tables'] as const) {
      const result = await execute(`command -v ${family} >/dev/null || exit 127\n${family} -w -S OUTPUT`, true);
      if (result.code === 127) { available = false; continue; }
      if (result.code !== 0) throw new AppError(result.stderr || `读取 ${family} 规则失败`, 409);
      for (const line of result.stdout.split(/\r?\n/)) {
        const match = /^-A OUTPUT -o ([A-Za-z][A-Za-z0-9_.-]{0,14}) -j (SK_NQ_[A-F0-9]{8})$/.exec(line.trim());
        if (!match) continue;
        const chain = await execute(`${family} -w -S ${match[2]}`);
        if (!chain.stdout.includes(`--comment ${marker}`) &&
            !chain.stdout.includes(`--comment "${marker}"`))
          throw new AppError(`发现同名非 Sakura 防火墙链 ${match[2]}，拒绝修改`, 409);
        jumps.push({ family, interface: match[1], chain: match[2],
          rules: chain.stdout.trim().split(/\r?\n/).filter(Boolean) });
      }
    }
    return { available, jumps };
  };
  const remove = async (jump: Jump) => execute(
    `set -e\n${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain}\n` +
    `${jump.family} -w -F ${jump.chain}\n${jump.family} -w -X ${jump.chain}`);
  const cleanupNew = async (jumps: Jump[]) => {
    for (const jump of jumps)
      await execute(`${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain} 2>/dev/null || true\n` +
        `${jump.family} -w -F ${jump.chain} 2>/dev/null || true\n` +
        `${jump.family} -w -X ${jump.chain} 2>/dev/null || true`, true);
  };

  const before = await inspectRoot();
  const firewall = await inspectFirewall();
  if (action === 'check' || options.mode === 'status')
    return { ready: true, executed: false, preview, current: before,
      active: ownedRoot(before), connectionControlsAvailable: firewall.available,
      connectionPolicyActive: firewall.jumps.length > 0, connectionRules: firewall.jumps };
  if (options.mode === 'apply' && !ownedRoot(before) && !defaultRoot(before))
    throw new AppError('网卡已有其他根队列规则，拒绝覆盖；请先移除冲突规则', 409);

  return machines.locked(`network-quota:${id}`, async () => {
    const root = await inspectRoot();
    const current = await inspectFirewall();
    if (options.mode === 'apply' && !ownedRoot(root) && !defaultRoot(root))
      throw new AppError('网卡已有其他根队列规则，拒绝覆盖；请先移除冲突规则', 409);
    if (options.mode === 'clear') {
      if (ownedRoot(root)) await execute(`tc qdisc del dev ${options.interface} root`);
      for (const jump of current.jumps) await remove(jump);
      const after = await inspectRoot();
      return { ready: !ownedRoot(after), executed: ownedRoot(root) || current.jumps.length > 0,
        preview, previous: root, current: after, active: false, connectionPolicyActive: false };
    }

    const restrictConnections = options.maxTcpConnections > 0 || options.newTcpConnectionsPerSecond > 0;
    if (restrictConnections && !current.available)
      throw new AppError('限制连接需要在客户机安装 iptables 与 ip6tables', 409);
    const chain = 'SK_NQ_' + randomBytes(4).toString('hex').toUpperCase();
    const next: Jump[] = restrictConnections ? [
      { family: 'iptables', interface: options.interface, chain },
      { family: 'ip6tables', interface: options.interface, chain },
    ] : [];
    if (restrictConnections) {
      try {
        const script = ['set -e'];
        for (const jump of next) {
          script.push(`${jump.family} -w -N ${chain}`);
          if (options.maxTcpConnections)
            script.push(`${jump.family} -w -A ${chain} -p tcp -m conntrack --ctstate NEW -m connlimit --connlimit-above ${options.maxTcpConnections} --connlimit-mask 0 -j REJECT --reject-with tcp-reset`);
          if (options.newTcpConnectionsPerSecond) {
            script.push(`${jump.family} -w -A ${chain} -p tcp -m conntrack --ctstate NEW -m limit --limit ${options.newTcpConnectionsPerSecond}/second --limit-burst ${options.connectionBurst} -j RETURN`);
            script.push(`${jump.family} -w -A ${chain} -p tcp -m conntrack --ctstate NEW -j REJECT --reject-with tcp-reset`);
          }
          script.push(`${jump.family} -w -A ${chain} -m comment --comment ${marker} -j RETURN`);
        }
        await execute(script.join('\n'));
        await execute(`set -e\niptables -w -I OUTPUT 1 -o ${options.interface} -j ${chain}\nip6tables -w -I OUTPUT 1 -o ${options.interface} -j ${chain}`);
      } catch (error) {
        await cleanupNew(next);
        throw error;
      }
    }
    try {
      await execute(`tc qdisc replace dev ${options.interface} root handle 42: tbf rate ${options.egressKbps}kbit burst ${options.burstKiB}kb latency ${options.latencyMs}ms`);
    } catch (error) {
      await cleanupNew(next);
      throw error;
    }
    const cleanupWarnings: string[] = [];
    for (const jump of current.jumps)
      try { await remove(jump); } catch (error) { cleanupWarnings.push((error as Error).message); }
    const after = await inspectRoot();
    const updated = await inspectFirewall();
    const exact = ownedRoot(after) && cleanupWarnings.length === 0 &&
      updated.jumps.length === next.length &&
      next.every((jump) => updated.jumps.some((item) =>
        item.family === jump.family && item.interface === jump.interface && item.chain === jump.chain));
    return { ready: exact, executed: true, preview, previous: root, current: after,
      active: ownedRoot(after), connectionPolicyActive: updated.jumps.length > 0,
      connectionRules: updated.jumps,
      ...(exact ? {} : { reason: '网络配额规则未完全达到目标状态', cleanupWarnings }) };
  });
}
