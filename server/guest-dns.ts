/**
 * 模块职责：解析客户机 DNS 配置和诊断结果，区分实例未运行与配置不可读情况。
 * Module purpose: Parses guest DNS configuration and diagnostics, distinguishing stopped guests from unreadable resolver state.
 */
import type { VmAccess as Machines } from './vm-access.ts';

const probeCommand = `set -eu
test -r /etc/resolv.conf
printf 'SOURCE=%s\n' "$(readlink -f /etc/resolv.conf 2>/dev/null || printf /etc/resolv.conf)"
awk '
  $1 == "nameserver" && NF > 1 && nameservers++ < 16 { print "NAMESERVER=" $2 }
  ($1 == "search" || $1 == "domain") && domains++ < 16 {
    for (i = 2; i <= NF; i++) print "DOMAIN=" $i
  }
' /etc/resolv.conf
for tool in resolvectl dig delv drill unbound-host; do
  if command -v "$tool" >/dev/null 2>&1; then printf 'TOOL=%s\n' "$tool"; fi
done
if command -v resolvectl >/dev/null 2>&1; then
  resolvectl domain 2>/dev/null | awk '$1 == "Global:" { for (i = 2; i <= NF; i++) print "ROUTE_DOMAIN=" $i }' || true
  state="$(resolvectl dnssec 2>/dev/null | head -n 8 | tr '\n' ' ' | cut -c 1-300 || true)"
  printf 'DNSSEC_STATE=%s\n' "$state"
fi`;

/**
 * 入口 / Entry: parseGuestDns.
 * 功能：在解析客户机 DNS 配置和诊断结果中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ source, nameservers, searchDomains, routingDomains, dnssecTools, dnssecState, dnssecValidation: 'not-verified' as const, }` 供上层消费（`guest-dns.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `guest-dns.ts`; this entry produces `{ source, nameservers, searchDomains, routingDomains, dnssecTools, dnssecState, dnssecValidation: 'not-verified' as const, }` for its caller. Module context: Parses guest DNS configuration and diagnostics, distinguishing stopped guests from unreadable resolver state.
 * 处理：通过 `output.slice().split`, `output.slice`, `line.indexOf`, `line.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `output.slice().split`, `output.slice`, `line.indexOf`, `line.slice`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `index < 1`; `!value`; `key === 'SOURCE'`.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `{ source, nameservers, searchDomains, routingDomains, dnssecTools, dnssecState, dnssecValidation: 'not-verified' as const, }`.
 * 副作用 / Effects: `nameservers.push`; `searchDomains.push`; `routingDomains.push`; `dnssecTools.push`; 更新 / updates `source`, `dnssecState`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function parseGuestDns(output: string) {
  const nameservers: string[] = [], searchDomains: string[] = [], routingDomains: string[] = [], dnssecTools: string[] = [];
  let source = '/etc/resolv.conf', dnssecState: string | null = null;
  for (const line of output.slice(0, 16000).split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index), value = line.slice(index + 1).trim();
    if (!value) continue;
    if (key === 'SOURCE') source = value.slice(0, 500);
    if (key === 'NAMESERVER' && nameservers.length < 16) nameservers.push(value.slice(0, 256));
    if (key === 'DOMAIN' && searchDomains.length < 32) searchDomains.push(value.slice(0, 256));
    if (key === 'ROUTE_DOMAIN' && routingDomains.length < 32) routingDomains.push(value.slice(0, 256));
    if (key === 'TOOL' && dnssecTools.length < 5) dnssecTools.push(value);
    if (key === 'DNSSEC_STATE') dnssecState = value.slice(0, 300);
  }
  return {
    source,
    nameservers,
    searchDomains,
    routingDomains,
    dnssecTools,
    dnssecState,
    dnssecValidation: 'not-verified' as const,
  };
}

/**
 * 入口 / Entry: guestDnsDiagnostics.
 * 功能：在解析客户机 DNS 配置和诊断结果中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, executed: false, reason: '请先启动实例，再检查客户机解析器。' }` / `{ ready: false, executed: false, reason: '客户机解析器配置不可读或检查失败。', exitCode: result.code, }` 供上层消费（`guest-dns.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `guest-dns.ts`; this entry produces `{ ready: false, executed: false, reason: '请先启动实例，再检查客户机解析器。' }` / `{ ready: false, executed: false, reason: '客户机解析器配置不可读或检查失败。', exitCode: result.code, }` for its caller. Module context: Parses guest DNS configuration and diagnostics, distinguishing stopped guests from unreadable resolver state.
 * 处理：通过 `machines.state`, `signal.throwIfAborted`, `machines.exec`, `parseGuestDns` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.state`, `signal.throwIfAborted`, `machines.exec`, `parseGuestDns`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) !== 'running'`; `result.code !== 0`.
 * 输入 / Inputs: machines: Machines; id: string; action: 'check' | 'run'; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, reason: '请先启动实例，再检查客户机解析器。' }`; `{ ready: false, executed: false, reason: '客户机解析器配置不可读或检查失败。', exitCode: result.code, }`; `{ ready: true, executed: action === 'run', checkedAt: new Date().toISOString(), ...parseGuestDns(result.stdout), message: '已读…`.
 * 副作用 / Effects: `machines.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function guestDnsDiagnostics(
  machines: Machines,
  id: string,
  action: 'check' | 'run',
  signal?: AbortSignal,
) {
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, reason: '请先启动实例，再检查客户机解析器。' };
  signal?.throwIfAborted();
  const result = await machines.exec(id, probeCommand, 10000, signal);
  signal?.throwIfAborted();
  if (result.code !== 0)
    return {
      ready: false,
      executed: false,
      reason: '客户机解析器配置不可读或检查失败。',
      exitCode: result.code,
    };
  return {
    ready: true,
    executed: action === 'run',
    checkedAt: new Date().toISOString(),
    ...parseGuestDns(result.stdout),
    message: '已读取客户机解析器配置、域名路由和 DNSSEC 状态；可在开发 → 网络配置预览、应用和恢复策略。此诊断未执行外部 DNS 查询，因此不声称 DNSSEC 验证已生效。',
  };
}
