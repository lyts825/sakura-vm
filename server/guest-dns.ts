import type { Machines } from './machines.ts';

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
  state="$(resolvectl dnssec 2>/dev/null | head -n 8 | tr '\n' ' ' | cut -c 1-300 || true)"
  printf 'DNSSEC_STATE=%s\n' "$state"
fi`;

export function parseGuestDns(output: string) {
  const nameservers: string[] = [], searchDomains: string[] = [], dnssecTools: string[] = [];
  let source = '/etc/resolv.conf', dnssecState: string | null = null;
  for (const line of output.slice(0, 16000).split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index), value = line.slice(index + 1).trim();
    if (!value) continue;
    if (key === 'SOURCE') source = value.slice(0, 500);
    if (key === 'NAMESERVER' && nameservers.length < 16) nameservers.push(value.slice(0, 256));
    if (key === 'DOMAIN' && searchDomains.length < 32) searchDomains.push(value.slice(0, 256));
    if (key === 'TOOL' && dnssecTools.length < 5) dnssecTools.push(value);
    if (key === 'DNSSEC_STATE') dnssecState = value.slice(0, 300);
  }
  return {
    source,
    nameservers,
    searchDomains,
    dnssecTools,
    dnssecState,
    dnssecValidation: 'not-verified' as const,
  };
}

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
    message: '已读取客户机解析器配置并检测 DNSSEC 工具；未执行外部 DNS 查询，因此不声称 DNSSEC 验证已生效。',
  };
}
