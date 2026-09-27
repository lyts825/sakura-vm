import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';

const ipv4Destination = z.string().refine((value) => {
  const [address, prefix, extra] = value.split('/');
  return extra === undefined && isIP(address) === 4 &&
    (prefix === undefined || (/^(?:[0-9]|[12][0-9]|3[012])$/.test(prefix)));
}, '只支持 IPv4 地址或 CIDR 网段');

export const egressPolicyShape = {
  mode: z.enum(['status', 'apply', 'clear']).default('status'),
  interface: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,14}$/).default('eth0'),
  allowedDestinations: z.array(ipv4Destination).max(64).default([]),
};
export const egressPolicySchema = z.object(egressPolicyShape).strict().superRefine((value, ctx) => {
  if (value.mode === 'apply' && !value.allowedDestinations.length)
    ctx.addIssue({ code: 'custom', path: ['allowedDestinations'], message: '启用白名单时至少需要一个目标' });
  if (new Set(value.allowedDestinations).size !== value.allowedDestinations.length)
    ctx.addIssue({ code: 'custom', path: ['allowedDestinations'], message: '白名单目标不能重复' });
});

type Family = 'iptables' | 'ip6tables';
type Jump = { family: Family; interface: string; chain: string; rules?: string[] };
const managedChain = /^SK_EG_[A-F0-9]{8}$/;
const marker = 'sakura-egress-v1';

export async function egressPolicy(
  machines: Machines,
  id: string,
  input: unknown,
  action: 'check' | 'run',
  signal?: AbortSignal,
) {
  const options = egressPolicySchema.parse(input);
  const preview = {
    interface: options.interface,
    allowedDestinations: options.allowedDestinations,
    ipv6: '新建 IPv6 出站连接一律拒绝',
  };
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, preview, reason: '请先启动发行版。' };

  signal?.throwIfAborted();
  // Once a write starts, finish both IP families and rollback even if the job is cancelled.
  const readOnly = action === 'check' || options.mode === 'status';
  const execute = async (script: string, tolerate = false) => {
    if (readOnly) signal?.throwIfAborted();
    const result = await machines.exec(id, script, 15000, readOnly ? signal : undefined);
    if (result.code === 127 && !tolerate)
      throw new AppError('客户机缺少 iptables 或 ip6tables；请安装防火墙工具', 409);
    if (result.code !== 0 && !tolerate)
      throw new AppError(result.stderr.trim() || '客户机出站防火墙操作失败', 409);
    return result;
  };
  const list = async () => {
    const jumps: Jump[] = [];
    for (const family of ['iptables', 'ip6tables'] as const) {
      const result = await execute(`command -v ${family} >/dev/null || exit 127\n${family} -w -S OUTPUT`);
      for (const line of result.stdout.split(/\r?\n/)) {
        const match = /^-A OUTPUT -o ([A-Za-z][A-Za-z0-9_.-]{0,14}) -j (SK_EG_[A-F0-9]{8})$/.exec(line.trim());
        if (!match) continue;
        const chainResult = await execute(`${family} -w -S ${match[2]}`);
        if (!chainResult.stdout.includes(`--comment ${marker}`) &&
            !chainResult.stdout.includes(`--comment "${marker}"`))
          throw new AppError(`发现同名非 Sakura 防火墙链 ${match[2]}，拒绝修改`, 409);
        jumps.push({
          family, interface: match[1], chain: match[2],
          rules: chainResult.stdout.trim().split(/\r?\n/).filter(Boolean),
        });
      }
    }
    return jumps;
  };
  const remove = async (jump: Jump, tolerate = false) => execute(
    `set -e\n${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain}\n` +
    `${jump.family} -w -F ${jump.chain}\n` +
    `${jump.family} -w -X ${jump.chain}`,
    tolerate,
  );

  const before = await list();
  if (action === 'check' || options.mode === 'status')
    return { ready: true, executed: false, preview, active: before.length > 0, rules: before };

  return machines.locked(`egress-policy:${id}`, async () => {
    // Re-read under the per-instance lock, so two policy updates cannot share a chain.
    const current = await list();
    if (options.mode === 'clear') {
      for (const jump of current) await remove(jump);
      return { ready: true, executed: current.length > 0, preview, active: false, removed: current.length };
    }

    const chain = 'SK_EG_' + randomBytes(4).toString('hex').toUpperCase();
    if (!managedChain.test(chain)) throw new AppError('防火墙链名称无效');
    const next: Jump[] = [
      { family: 'iptables', interface: options.interface, chain },
      { family: 'ip6tables', interface: options.interface, chain },
    ];
    const ipv4Rules = options.allowedDestinations.map((destination) =>
      `iptables -w -A ${chain} -d ${destination} -j RETURN`);
    const build = [
      'set -e',
      `iptables -w -N ${chain}`,
      `iptables -w -A ${chain} -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN`,
      `iptables -w -A ${chain} -p udp --sport 68 --dport 67 -j RETURN`,
      ...ipv4Rules,
      `iptables -w -A ${chain} -m comment --comment ${marker} -j REJECT`,
      `ip6tables -w -N ${chain}`,
      `ip6tables -w -A ${chain} -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN`,
      `ip6tables -w -A ${chain} -m comment --comment ${marker} -j REJECT`,
    ].join('\n');
    let inserted = false;
    try {
      await execute(build);
      await execute(`set -e\niptables -w -I OUTPUT 1 -o ${options.interface} -j ${chain}\nip6tables -w -I OUTPUT 1 -o ${options.interface} -j ${chain}`);
      inserted = true;
    } catch (error) {
      // A failed second family insert must not leave the first family locked down.
      for (const jump of next)
        await execute(`${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain} 2>/dev/null || true\n` +
          `${jump.family} -w -F ${jump.chain} 2>/dev/null || true\n` +
          `${jump.family} -w -X ${jump.chain} 2>/dev/null || true`, true);
      throw error;
    }
    if (!inserted) throw new AppError('防火墙规则未安装', 409);
    const errors: string[] = [];
    for (const jump of current) {
      try { await remove(jump); }
      catch (error) { errors.push((error as Error).message); }
    }
    const after = await list();
    if (!next.every((jump) => after.some((item) =>
      item.family === jump.family && item.interface === jump.interface && item.chain === jump.chain)))
      throw new AppError('出站白名单未在 IPv4 和 IPv6 同时生效', 409);
    const exact = after.length === 2 && errors.length === 0;
    return {
      ready: exact, executed: true, preview, active: true, rules: after,
      ...(exact ? {} : { reason: '旧规则未完全撤销，请检查当前规则后重试', cleanupWarnings: errors }),
    };
  });
}
