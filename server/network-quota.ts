/**
 * 模块职责：设置并查询客户机网络配额，执行结果依赖实际客户机规则与状态回执。
 * Module purpose: Sets/queries guest network quotas using actual guest rule state and command receipts.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';

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
/**
 * 入口 / Entry: ownedRoot.
 * 功能：把本层请求转交 `inline.test`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `inline.test` and propagates the provider result or rejection.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `/^qdisc tbf 42: root\b/m.test(output)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const ownedRoot = (output: string) => /^qdisc tbf 42: root\b/m.test(output);
/**
 * 入口 / Entry: defaultRoot.
 * 功能：在设置并查询客户机网络配额中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!output.trim() || /^qdisc (?:fq_codel|noqueue|pfifo_fast|mq|fq) (?:0:|[0-9a-f]+:) root\b/m.test(output)` 供上层消费（`network-quota.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network-quota.ts`; this entry produces `!output.trim() || /^qdisc (?:fq_codel|noqueue|pfifo_fast|mq|fq) (?:0:|[0-9a-f]+:) root\b/m.test(output)` for its caller. Module context: Sets/queries guest network quotas using actual guest rule state and command receipts.
 * 处理：通过 `output.trim`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `output.trim`, `inline.test`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `!output.trim() || /^qdisc (?:fq_codel|noqueue|pfifo_fast|mq|fq) (?:0:|[0-9a-f]+:) root\b/m.test(output)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const defaultRoot = (output: string) =>
  !output.trim() || /^qdisc (?:fq_codel|noqueue|pfifo_fast|mq|fq) (?:0:|[0-9a-f]+:) root\b/m.test(output);

/**
 * 入口 / Entry: networkQuota.
 * 功能：读取或变更客户机流量配额规则，检查工具与当前计数回执。
 * Purpose: Reads/mutates guest traffic quota rules and checks tooling/current counters.
 * 设计：状态和清除使用固定命令；工具不可用或规则执行失败保留明确失败，不由零计数推断已生效。
 * Design: Fixed status/clear commands report unavailable tooling/rule failures explicitly rather than inferring activation from zero counters.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, preview, reason: '请先启动发行版。' }`; `{ ready: true, executed: false, preview, current: before, active: ownedRoot(before), connectionControlsAvailable: firewall.av…`; `machines.locked(`network-quota:${id}`, async () => { const root = await inspectRoot(); const current = await inspectFirewall(…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `options.mode === 'apply' && !ownedRoot(before) && !defaultRoot(before)`; 异常 / errors `new AppError('网卡已有其他根队列规则，拒绝覆盖；请先移除冲突规则', 409)`.
 */
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
  /**
   * 入口 / Entry: networkQuota.execute.
   * 功能：在设置并查询客户机网络配额中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`network-quota.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `network-quota.ts`; this entry produces `result` for its caller. Module context: Sets/queries guest network quotas using actual guest rule state and command receipts.
   * 处理：通过 `signal.throwIfAborted`, `machines.exec`, `result.stderr.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `machines.exec`, `result.stderr.trim`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `readOnly`.
   * 输入 / Inputs: script: string; tolerate: default=false
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 && !tolerate`; 异常 / errors `new AppError(result.stderr.trim() || '客户机网络配额操作失败', 409)`.
   */
  const execute = async (script: string, tolerate = false) => {
    if (readOnly) signal?.throwIfAborted();
    const result = await machines.exec(id, script, 15000, readOnly ? signal : undefined);
    if (result.code !== 0 && !tolerate)
      throw new AppError(result.stderr.trim() || '客户机网络配额操作失败', 409);
    return result;
  };
  /**
   * 入口 / Entry: networkQuota.inspectRoot.
   * 功能：在设置并查询客户机网络配额中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result.stdout.trim()` 供上层消费（`network-quota.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `network-quota.ts`; this entry produces `result.stdout.trim()` for its caller. Module context: Sets/queries guest network quotas using actual guest rule state and command receipts.
   * 处理：通过 `execute`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `execute`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `result.stdout.trim()`.
   * 副作用 / Effects: `execute`.
   * 拒绝 / Refusals: 条件 / conditions `result.code === 127`; `result.code === 2`; `result.code !== 0`; 异常 / errors `new AppError('客户机缺少 tc；请安装 iproute2', 409)`; `new AppError(`客户机网卡 ${options.interface} 不存在`, 409)`.
   */
  const inspectRoot = async () => {
    const result = await execute(
      `command -v tc >/dev/null || exit 127\ntest -d /sys/class/net/${options.interface} || exit 2\ntc qdisc show dev ${options.interface}`,
      true);
    if (result.code === 127) throw new AppError('客户机缺少 tc；请安装 iproute2', 409);
    if (result.code === 2) throw new AppError(`客户机网卡 ${options.interface} 不存在`, 409);
    if (result.code !== 0) throw new AppError(result.stderr || '读取客户机带宽规则失败', 409);
    return result.stdout.trim();
  };
  /**
   * 入口 / Entry: networkQuota.inspectFirewall.
   * 功能：在设置并查询客户机网络配额中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ available, jumps }` 供上层消费（`network-quota.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `network-quota.ts`; this entry produces `{ available, jumps }` for its caller. Module context: Sets/queries guest network quotas using actual guest rule state and command receipts.
   * 处理：通过 `execute`, `result.stdout.split`, `inline.exec`, `line.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `execute`, `result.stdout.split`, `inline.exec`, `line.trim`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `result.code === 127`; `!match`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ available, jumps }`.
   * 副作用 / Effects: `execute`; `inline.exec`; `jumps.push`; 更新 / updates `available`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; `!chain.stdout.includes(`--comment ${marker}`) && !chain.stdout.includes(`--comment "${marker}"`)`; 异常 / errors `new AppError(result.stderr || `读取 ${family} 规则失败`, 409)`; `new AppError(`发现同名非 Sakura 防火墙链 ${match[2]}，拒绝修改`, 409)`.
   */
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
  /**
   * 入口 / Entry: networkQuota.remove.
   * 功能：把本层请求转交 `execute`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `execute` and propagates the provider result or rejection.
   * 输入 / Inputs: jump: Jump
   * 输出 / Returns: `execute( `set -e\n${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain}\n` + `${jump.family} -w -F ${jump.chain}\…`.
   * 副作用 / Effects: `execute`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const remove = async (jump: Jump) => execute(
    `set -e\n${jump.family} -w -D OUTPUT -o ${jump.interface} -j ${jump.chain}\n` +
    `${jump.family} -w -F ${jump.chain}\n${jump.family} -w -X ${jump.chain}`);
  /**
   * 入口 / Entry: networkQuota.cleanupNew.
   * 功能：在设置并查询客户机网络配额中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`network-quota.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `network-quota.ts`; the calls and state transitions below complete the operation. Module context: Sets/queries guest network quotas using actual guest rule state and command receipts.
   * 处理：通过 `execute` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `execute`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: jumps: Jump[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `execute`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

  /**
   * 入口 / Entry: networkQuota.callback@105.
   * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked）。
   * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ ready: !ownedRoot(after), executed: ownedRoot(root) || current.jumps.length > 0, preview, previous: root, current: after, a…`; `{ ready: exact, executed: true, preview, previous: root, current: after, active: ownedRoot(after), connectionPolicyActive: up…`.
   * 副作用 / Effects: `execute`; `script.push`; `cleanupWarnings.push`.
   * 拒绝 / Refusals: 条件 / conditions `options.mode === 'apply' && !ownedRoot(root) && !defaultRoot(root)`; `restrictConnections && !current.available`; `restrictConnections`; 异常 / errors `new AppError('网卡已有其他根队列规则，拒绝覆盖；请先移除冲突规则', 409)`; `new AppError('限制连接需要在客户机安装 iptables 与 ip6tables', 409)`.
   * 失败处理：catch 分支执行 `await cleanupNew(next);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await cleanupNew(next);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
