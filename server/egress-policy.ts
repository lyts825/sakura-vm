/**
 * 模块职责：校验并应用客户机 IPv4 出站策略，限制白名单格式、重复项及空策略。
 * Module purpose: Validates and applies IPv4 guest egress policies, rejecting malformed, duplicated or empty allowlists.
 */
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';

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

/**
 * 入口 / Entry: egressPolicy.
 * 功能：生成并执行客户机 IPv4 出站策略的状态、应用或清除动作。
 * Purpose: Builds/executes status, apply or clear operations for guest IPv4 egress policy.
 * 设计：核对项目运行域和实例规则能力后应用；脚本明确区分空配置、白名单与规则恢复，不从项目环境加载管理逻辑。
 * Design: Application follows project-scope/rule capability checks; fixed scripts distinguish empty/allowlist/recovery state without project-loaded admin logic.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, preview, reason: '请先启动发行版。' }`; `{ ready: true, executed: false, preview, active: before.length > 0, rules: before }`; `machines.locked(`egress-policy:${id}`, async () => { // Re-read under the per-instance lock, so two policy updates cannot sha…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  /**
   * 入口 / Entry: egressPolicy.execute.
   * 功能：在校验并应用客户机 IPv4 出站策略中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`egress-policy.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `egress-policy.ts`; this entry produces `result` for its caller. Module context: Validates and applies IPv4 guest egress policies, rejecting malformed, duplicated or empty allowlists.
   * 处理：通过 `signal.throwIfAborted`, `machines.exec`, `result.stderr.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `machines.exec`, `result.stderr.trim`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `readOnly`.
   * 输入 / Inputs: script: string; tolerate: default=false
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code === 127 && !tolerate`; `result.code !== 0 && !tolerate`; 异常 / errors `new AppError('客户机缺少 iptables 或 ip6tables；请安装防火墙工具', 409)`; `new AppError(result.stderr.trim() || '客户机出站防火墙操作失败', 409)`.
   */
  const execute = async (script: string, tolerate = false) => {
    if (readOnly) signal?.throwIfAborted();
    const result = await machines.exec(id, script, 15000, readOnly ? signal : undefined);
    if (result.code === 127 && !tolerate)
      throw new AppError('客户机缺少 iptables 或 ip6tables；请安装防火墙工具', 409);
    if (result.code !== 0 && !tolerate)
      throw new AppError(result.stderr.trim() || '客户机出站防火墙操作失败', 409);
    return result;
  };
  /**
   * 入口 / Entry: egressPolicy.list.
   * 功能：在校验并应用客户机 IPv4 出站策略中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `jumps` 供上层消费（`egress-policy.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `egress-policy.ts`; this entry produces `jumps` for its caller. Module context: Validates and applies IPv4 guest egress policies, rejecting malformed, duplicated or empty allowlists.
   * 处理：通过 `execute`, `result.stdout.split`, `inline.exec`, `line.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `execute`, `result.stdout.split`, `inline.exec`, `line.trim`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!match`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `jumps`.
   * 副作用 / Effects: `execute`; `inline.exec`; `jumps.push`.
   * 拒绝 / Refusals: 条件 / conditions `!chainResult.stdout.includes(`--comment ${marker}`) && !chainResult.stdout.includes(`--comment "${marker}"`)`; 异常 / errors `new AppError(`发现同名非 Sakura 防火墙链 ${match[2]}，拒绝修改`, 409)`.
   */
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
  /**
   * 入口 / Entry: egressPolicy.remove.
   * 功能：把本层请求转交 `execute`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `execute` and propagates the provider result or rejection.
   * 输入 / Inputs: jump: Jump; tolerate: default=false
   * 输出 / Returns: `execute( `set -e\n${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain}\n` + `${jump.family} -w -F ${jump.chain}\…`.
   * 副作用 / Effects: `execute`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const remove = async (jump: Jump, tolerate = false) => execute(
    `set -e\n${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain}\n` +
    `${jump.family} -w -F ${jump.chain}\n` +
    `${jump.family} -w -X ${jump.chain}`,
    tolerate,
  );

  const before = await list();
  if (action === 'check' || options.mode === 'status')
    return { ready: true, executed: false, preview, active: before.length > 0, rules: before };

  /**
   * 入口 / Entry: egressPolicy.callback@91.
   * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked）。
   * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ ready: true, executed: current.length > 0, preview, active: false, removed: current.length }`; `{ ready: exact, executed: true, preview, active: true, rules: after, ...(exact ? {} : { reason: '旧规则未完全撤销，请检查当前规则后重试', cleanu…`.
   * 副作用 / Effects: `execute`; `errors.push`; 更新 / updates `inserted`.
   * 拒绝 / Refusals: 条件 / conditions `!managedChain.test(chain)`; `!inserted`; `!next.every((jump) => after.some((item) => item.family === jump.family && item.interface === jump.interface && item.chain ===…`; 异常 / errors `new AppError('防火墙链名称无效')`; `error`.
   * 失败处理：catch 分支执行 `for (const jump of next) await execute(`${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain} 2>/dev/null || true…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `for (const jump of next) await execute(`${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain} 2>/dev/null || true…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
