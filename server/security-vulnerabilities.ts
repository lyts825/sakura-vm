/**
 * 模块职责：读取受支持发行版的软件包清单并查询 OSV，校验包名称、版本与发行版映射。
 * Module purpose: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 */
import { networkFor } from './network/index.ts';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';

const { fetch } = networkFor('core:security-vulnerabilities');

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

/**
 * 入口 / Entry: releaseVersion.
 * 功能：从当前输入或状态计算 `match?.[1] || ''`，供调用方后续验证或使用。
 * Purpose: Computes `match?.[1] || ''` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `match?.[1] || ''`.
 * 副作用 / Effects: `inline.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function releaseVersion(text: string) {
  const match = /^VERSION_ID=["']?([A-Za-z0-9_.-]+)["']?$/m.exec(text);
  return match?.[1] || '';
}

/**
 * 入口 / Entry: securityEcosystem.
 * 功能：在读取受支持发行版的软件包清单并查询 OSV中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``Alpine:v${match[1]}.${match[2]}`` / ``Debian:${match[1]}`` 供上层消费（`security-vulnerabilities.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `security-vulnerabilities.ts`; this entry produces ``Alpine:v${match[1]}.${match[2]}`` / ``Debian:${match[1]}`` for its caller. Module context: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 处理：通过 `releaseVersion`, `inline.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `releaseVersion`, `inline.exec`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `distro === 'alpine' || !distro`; `match`; `distro === 'debian'`.
 * 输入 / Inputs: distro: string | undefined; release: string
 * 输出 / Returns: ``Alpine:v${match[1]}.${match[2]}``; ``Debian:${match[1]}``; `'Ubuntu:24.04:LTS'`.
 * 副作用 / Effects: `releaseVersion`; `inline.exec`.
 * 拒绝 / Refusals: 异常 / errors `new AppError('无法确定受支持的 OSV 发行版版本', 409)`.
 */
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
/**
 * 入口 / Entry: boundedPackages.
 * 功能：在读取受支持发行版的软件包清单并查询 OSV中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...unique.values()]` 供上层消费（`security-vulnerabilities.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `security-vulnerabilities.ts`; this entry produces `[...unique.values()]` for its caller. Module context: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 处理：通过 `packageField.test`, `unique.set`, `unique.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `packageField.test`, `unique.set`, `unique.values`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: rows: PackageVersion[]
 * 输出 / Returns: `[...unique.values()]`.
 * 副作用 / Effects: `unique.set`.
 * 拒绝 / Refusals: 条件 / conditions `!packageField.test(row.name) || !packageField.test(row.version)`; `unique.size > 3000`; `!unique.size`; 异常 / errors `new AppError('客户机软件包清单包含无法识别的名称或版本', 409)`; `new AppError('客户机软件包数量超过扫描上限', 413)`.
 */
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

/**
 * 入口 / Entry: parseAlpinePackages.
 * 功能：在读取受支持发行版的软件包清单并查询 OSV中，转换协议或持久数据表示并保持调用边界；本入口产生 `boundedPackages(output.split(/\r?\n/).filter(Boolean).map((line) => { const [name, version, extra] = line.split('\t'); if (ex…` 供上层消费（`security-vulnerabilities.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `security-vulnerabilities.ts`; this entry produces `boundedPackages(output.split(/\r?\n/).filter(Boolean).map((line) => { const [name, version, extra] = line.split('\t'); if (ex…` for its caller. Module context: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 处理：通过 `boundedPackages`, `output.split().filter().map`, `output.split().filter`, `output.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `boundedPackages`, `output.split().filter().map`, `output.split().filter`, `output.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `boundedPackages(output.split(/\r?\n/).filter(Boolean).map((line) => { const [name, version, extra] = line.split('\t'); if (ex…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function parseAlpinePackages(output: string) {
  return boundedPackages(output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, version, extra] = line.split('\t');
    if (extra !== undefined || !name || !version) throw new AppError('Alpine 软件包清单格式错误', 409);
    return { name, version };
  }));
}

/**
 * 入口 / Entry: parseDpkgPackages.
 * 功能：在读取受支持发行版的软件包清单并查询 OSV中，转换协议或持久数据表示并保持调用边界；本入口产生 `boundedPackages(output.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [status, binary, binaryVersion, source, sourc…` 供上层消费（`security-vulnerabilities.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `security-vulnerabilities.ts`; this entry produces `boundedPackages(output.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [status, binary, binaryVersion, source, sourc…` for its caller. Module context: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 处理：通过 `boundedPackages`, `output.split().filter().flatMap`, `output.split().filter`, `output.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `boundedPackages`, `output.split().filter().flatMap`, `output.split().filter`, `output.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `boundedPackages(output.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [status, binary, binaryVersion, source, sourc…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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

/**
 * 入口 / Entry: guestPackageInventory.
 * 功能：在读取受支持发行版的软件包清单并查询 OSV中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ecosystem, packages }` 供上层消费（`security-vulnerabilities.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `security-vulnerabilities.ts`; this entry produces `{ ecosystem, packages }` for its caller. Module context: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 处理：通过 `machines.get`, `machines.exec`, `securityEcosystem`, `ecosystem.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.get`, `machines.exec`, `securityEcosystem`, `ecosystem.startsWith`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: `{ ecosystem, packages }`.
 * 副作用 / Effects: `machines.exec`; `ecosystem.startsWith`.
 * 拒绝 / Refusals: 条件 / conditions `release.code !== 0`; `inventory.code !== 0`; 异常 / errors `new AppError('无法读取客户机发行版版本', 502)`; `new AppError(inventory.stderr.trim() || '无法读取已安装软件包', 502)`.
 */
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

/**
 * 签名 / Signature: Fetcher.Fetcher.
 * 功能：为读取受支持发行版的软件包清单并查询 OSV声明 Fetcher 的输入与结果契约，所属容器为 Fetcher。
 * Purpose: Declares the input/result contract for Fetcher in Fetcher. Module responsibility: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 输入 / Inputs: input: string; init: RequestInit
 * 输出 / Returns: Promise<Response>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
/**
 * 入口 / Entry: boundedResponse.
 * 功能：在读取受支持发行版的软件包清单并查询 OSV中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Buffer.concat(chunks).toString('utf8')` 供上层消费（`security-vulnerabilities.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `security-vulnerabilities.ts`; this entry produces `Buffer.concat(chunks).toString('utf8')` for its caller. Module context: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 处理：通过 `response.body.getReader`, `reader.read`, `chunks.push`, `reader.releaseLock` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `response.body.getReader`, `reader.read`, `chunks.push`, `reader.releaseLock`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `done`.
 * 输入 / Inputs: response: Response
 * 输出 / Returns: `Buffer.concat(chunks).toString('utf8')`.
 * 副作用 / Effects: `chunks.push`; `reader.releaseLock`; 更新 / updates `bytes`.
 * 拒绝 / Refusals: 条件 / conditions `!reader`; `bytes > 8 * 1024 * 1024`; 异常 / errors `new AppError('OSV 漏洞库响应为空', 502)`; `new AppError('OSV 漏洞库响应过大', 502)`.
 * 收尾：退出 try 区域时始终执行 `reader.releaseLock();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `reader.releaseLock();`; these steps also apply to exceptional exits.
 */
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
/**
 * 入口 / Entry: queryVulnerabilities.
 * 功能：在读取受支持发行版的软件包清单并查询 OSV中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ source: 'OSV', status: 'complete', ecosystem, packagesChecked: packages.length, affectedPackages: packageIds.size, vulnerab…` 供上层消费（`security-vulnerabilities.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `security-vulnerabilities.ts`; this entry produces `{ source: 'OSV', status: 'complete', ecosystem, packagesChecked: packages.length, affectedPackages: packageIds.size, vulnerab…` for its caller. Module context: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 处理：通过 `packages.slice().map`, `packages.slice`, `signal.throwIfAborted`, `fetcher` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `packages.slice().map`, `packages.slice`, `signal.throwIfAborted`, `fetcher`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: ecosystem: string; packages: PackageVersion[]; signal: AbortSignal optional; fetcher: Fetcher default=fetch
 * 输出 / Returns: Promise<VulnerabilityScan>；结果来自 / values from `{ source: 'OSV', status: 'complete', ecosystem, packagesChecked: packages.length, affectedPackages: packageIds.size, vulnerab…`.
 * 副作用 / Effects: `fetcher`; `AbortSignal.any`; `AbortSignal.timeout`; `uniqueIds.add`; `ids.add`; 更新 / updates `start`, `pending`, `parsed`.
 * 拒绝 / Refusals: 条件 / conditions `++requests > 100`; `!response.ok`; `Number(response.headers.get('content-length')) > 8 * 1024 * 1024`; 异常 / errors `new AppError('OSV 漏洞结果分页超过扫描上限', 502)`; `new AppError(`OSV 漏洞库返回 ${response.status}`, 502)`.
 * 失败处理：catch 分支执行 `if (error instanceof AppError) throw error;`; `throw new AppError('OSV 漏洞库响应格式错误', 502);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (error instanceof AppError) throw error;`; `throw new AppError('OSV 漏洞库响应格式错误', 502);`; these statements determine whether a failure is absorbed or rejected again.
 */
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

/**
 * 入口 / Entry: scanGuestVulnerabilities.
 * 功能：在读取受支持发行版的软件包清单并查询 OSV中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await queryVulnerabilities(ecosystem, inventory.packages, signal, fetcher)` / `{ source: 'OSV', status: 'unavailable', ecosystem, packagesChecked, affectedPackages: 0, vulnerabilityCount: 0, matches: [], …` 供上层消费（`security-vulnerabilities.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `security-vulnerabilities.ts`; this entry produces `await queryVulnerabilities(ecosystem, inventory.packages, signal, fetcher)` / `{ source: 'OSV', status: 'unavailable', ecosystem, packagesChecked, affectedPackages: 0, vulnerabilityCount: 0, matches: [], …` for its caller. Module context: Reads supported distribution package inventories and queries OSV after validating names, versions and ecosystem mappings.
 * 处理：通过 `guestPackageInventory`, `queryVulnerabilities` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `guestPackageInventory`, `queryVulnerabilities`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional; fetcher: Fetcher default=fetch
 * 输出 / Returns: Promise<VulnerabilityScan>；结果来自 / values from `await queryVulnerabilities(ecosystem, inventory.packages, signal, fetcher)`; `{ source: 'OSV', status: 'unavailable', ecosystem, packagesChecked, affectedPackages: 0, vulnerabilityCount: 0, matches: [], …`.
 * 副作用 / Effects: 更新 / updates `ecosystem`, `packagesChecked`.
 * 拒绝 / Refusals: 条件 / conditions `signal?.aborted`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if (signal?.aborted) throw error;`; `return { source: 'OSV', status: 'unavailable', ecosystem, packagesChecked, affectedPackages: 0, vulnerabilityCount: 0, matche…`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (signal?.aborted) throw error;`; `return { source: 'OSV', status: 'unavailable', ecosystem, packagesChecked, affectedPackages: 0, vulnerabilityCount: 0, matche…`; these statements determine whether a failure is absorbed or rejected again.
 */
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
