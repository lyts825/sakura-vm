import { AppError } from './model.ts';
import type { Machines } from './machines.ts';

type PackageVersion = { name: string; version: string };
export type VulnerabilityMatch = PackageVersion & { ids: string[] };
export type VulnerabilityScan = {
  source: 'OSV';
  status: 'complete' | 'unavailable';
  ecosystem: string | null;
  packagesChecked: number;
  affectedPackages: number;
  vulnerabilityCount: number;
  matches: VulnerabilityMatch[];
  error?: string;
};

function releaseVersion(text: string) {
  const match = /^VERSION_ID=["']?([A-Za-z0-9_.-]+)["']?$/m.exec(text);
  return match?.[1] || '';
}

export function securityEcosystem(distro: string | undefined, release: string) {
  const version = releaseVersion(release);
  if (distro === 'alpine' || !distro) {
    const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
    if (match) return `Alpine:v${match[1]}.${match[2]}`;
  } else if (distro === 'debian') {
    const match = /^(\d+)$/.exec(version);
    if (match) return `Debian:${match[1]}`;
  } else if (distro === 'ubuntu' && version === '24.04') return 'Ubuntu:24.04:LTS';
  throw new AppError('无法确定受支持的 OSV 发行版版本', 409);
}

const packageField = /^[A-Za-z0-9][A-Za-z0-9+._~:-]{0,159}$/;
function boundedPackages(rows: PackageVersion[]) {
  const unique = new Map<string, PackageVersion>();
  for (const row of rows) {
    if (!packageField.test(row.name) || !packageField.test(row.version))
      throw new AppError('客户机软件包清单包含无法识别的名称或版本', 409);
    unique.set(`${row.name}\0${row.version}`, row);
    if (unique.size > 3000) throw new AppError('客户机软件包数量超过扫描上限', 413);
  }
  if (!unique.size) throw new AppError('客户机没有可扫描的软件包', 409);
  return [...unique.values()];
}

export function parseAlpinePackages(output: string) {
  return boundedPackages(output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, version, extra] = line.split('\t');
    if (extra !== undefined || !name || !version) throw new AppError('Alpine 软件包清单格式错误', 409);
    return { name, version };
  }));
}

export function parseDpkgPackages(output: string) {
  return boundedPackages(output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [status, binary, binaryVersion, source, sourceVersion, extra] = line.split('\t');
    if (extra !== undefined || !status || !binary || !binaryVersion)
      throw new AppError('Debian 软件包清单格式错误', 409);
    return status.trim() === 'ii' ? [{ name: source || binary, version: sourceVersion || binaryVersion }] : [];
  }));
}

const alpineInventory = `awk '
  /^P:/ { package=substr($0,3) }
  /^V:/ { version=substr($0,3) }
  /^o:/ { origin=substr($0,3) }
  /^$/ { if (package != "" && version != "") printf "%s\\t%s\\n", (origin != "" ? origin : package), version; package=""; version=""; origin="" }
  END { if (package != "" && version != "") printf "%s\\t%s\\n", (origin != "" ? origin : package), version }
' /lib/apk/db/installed`;
const dpkgInventory = "dpkg-query -W -f='${db:Status-Abbrev}\\t${Package}\\t${Version}\\t${source:Package}\\t${source:Version}\\n'";

export async function guestPackageInventory(machines: Machines, id: string,
  signal?: AbortSignal) {
  const vm = machines.get(id);
  const release = await machines.exec(id, 'cat /etc/os-release', 10000, signal);
  if (release.code !== 0) throw new AppError('无法读取客户机发行版版本', 502);
  const ecosystem = securityEcosystem(vm.distro, release.stdout);
  const inventory = await machines.exec(id,
    ecosystem.startsWith('Alpine:') ? alpineInventory : dpkgInventory, 30000, signal);
  if (inventory.code !== 0) throw new AppError(inventory.stderr.trim() || '无法读取已安装软件包', 502);
  const packages = ecosystem.startsWith('Alpine:')
    ? parseAlpinePackages(inventory.stdout) : parseDpkgPackages(inventory.stdout);
  return { ecosystem, packages };
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
async function boundedResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('OSV 漏洞库响应为空', 502);
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new AppError('OSV 漏洞库响应过大', 502);
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function queryVulnerabilities(ecosystem: string, packages: PackageVersion[],
  signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<VulnerabilityScan> {
  const uniqueIds = new Set<string>();
  const packageIds = new Map<number, Set<string>>();
  const pageTokens = new Set<string>();
  let requests = 0;
  type Query = { index: number; token?: string };
  for (let start = 0; start < packages.length; start += 80) {
    let pending: Query[] = packages.slice(start, start + 80).map((_, index) => ({ index: start + index }));
    while (pending.length) {
      signal?.throwIfAborted();
      if (++requests > 100) throw new AppError('OSV 漏洞结果分页超过扫描上限', 502);
      const batch = pending;
      pending = [];
      const response = await fetcher('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queries: batch.map(({ index, token }) => ({
          package: { ecosystem, name: packages[index].name }, version: packages[index].version,
          ...(token ? { page_token: token } : {}),
        })) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new AppError(`OSV 漏洞库返回 ${response.status}`, 502);
      if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024)
        throw new AppError('OSV 漏洞库响应过大', 502);
      let parsed: unknown;
      try { parsed = JSON.parse(await boundedResponse(response)); }
      catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('OSV 漏洞库响应格式错误', 502);
      }
      const results = (parsed as { results?: unknown })?.results;
      if (!Array.isArray(results) || results.length !== batch.length)
        throw new AppError('OSV 漏洞库结果数量与查询不一致', 502);
      for (let index = 0; index < batch.length; index++) {
        const result = results[index] as { vulns?: unknown; next_page_token?: unknown };
        const vulns = result?.vulns;
        if (vulns !== undefined && !Array.isArray(vulns))
          throw new AppError('OSV 漏洞库结果格式错误', 502);
        for (const item of vulns || []) {
          const value = (item as { id?: unknown })?.id;
          if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{1,119}$/.test(value))
            throw new AppError('OSV 漏洞编号格式错误', 502);
          uniqueIds.add(value);
          const ids = packageIds.get(batch[index].index) || new Set<string>();
          ids.add(value);
          packageIds.set(batch[index].index, ids);
        }
        if (result?.next_page_token !== undefined) {
          const token = result.next_page_token;
          if (typeof token !== 'string' || !token || token.length > 4096)
            throw new AppError('OSV 漏洞分页标记格式错误', 502);
          const key = `${batch[index].index}:${token}`;
          if (pageTokens.has(key)) throw new AppError('OSV 漏洞分页标记重复', 502);
          pageTokens.add(key);
          pending.push({ index: batch[index].index, token });
        }
      }
    }
  }
  const matches = [...packageIds.entries()].slice(0, 200).map(([index, ids]) =>
    ({ ...packages[index], ids: [...ids].slice(0, 30) }));
  return { source: 'OSV', status: 'complete', ecosystem, packagesChecked: packages.length,
    affectedPackages: packageIds.size, vulnerabilityCount: uniqueIds.size, matches };
}

export async function scanGuestVulnerabilities(machines: Machines, id: string,
  signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<VulnerabilityScan> {
  let ecosystem: string | null = null;
  let packagesChecked = 0;
  try {
    const inventory = await guestPackageInventory(machines, id, signal);
    ecosystem = inventory.ecosystem;
    packagesChecked = inventory.packages.length;
    return await queryVulnerabilities(ecosystem, inventory.packages, signal, fetcher);
  } catch (error) {
    if (signal?.aborted) throw error;
    return { source: 'OSV', status: 'unavailable', ecosystem, packagesChecked,
      affectedPackages: 0, vulnerabilityCount: 0, matches: [],
      error: error instanceof Error ? error.message : String(error) };
  }
}
