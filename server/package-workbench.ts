/**
 * 模块职责：查询和操作客户机软件包，校验包名并解析不同包管理器的列表结果。
 * Module purpose: Queries/mutates guest packages, validating names and parsing the selected package-manager output.
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
import type { VmAccess as Machines } from './vm-access.ts';

const packageName = z.string().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9+_.-]*$/, '软件包名称无效')
  .refine((value) => !/[+-]$/.test(value), '软件包名称不能以 + 或 - 结尾');
const querySchema = z.object({
  mode: z.enum(['installed', 'search', 'updates']),
  query: z.string().trim().max(100).default(''),
  page: z.number().int().min(1).max(100).default(1),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
const changeSchema = z.enum(['install', 'remove', 'upgrade', 'upgrade-all']);
export const packageWorkbenchRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('preview'), change: changeSchema,
    name: packageName.optional() }).strict(),
  z.object({ operation: z.literal('apply'), token: z.uuid() }).strict(),
  z.object({ operation: z.literal('refresh-index') }).strict(),
]);
type Change = z.infer<typeof changeSchema>;
type Item = { name: string; version: string; description?: string;
  installedVersion?: string; availableVersion?: string };
type Preview = { vmId: string; change: Change; name?: string; digest: string;
  boot: object; expiresAt: number };
/**
 * 签名 / Signature: Runner.Runner.
 * 功能：为查询和操作客户机软件包声明 Runner 的输入与结果契约，所属容器为 Runner。
 * Purpose: Declares the input/result contract for Runner in Runner. Module responsibility: Queries/mutates guest packages, validating names and parsing the selected package-manager output.
 * 输入 / Inputs: id: string; operation: Change | 'update'; name: string optional
 * 输出 / Returns: unknown.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type Runner = (id: string, operation: Change | 'update', name?: string) => unknown;
/**
 * 入口 / Entry: hash.
 * 功能：在查询和操作客户机软件包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`package-workbench.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `package-workbench.ts`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Queries/mutates guest packages, validating names and parsing the selected package-manager output.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * 入口 / Entry: parsePackageRows.
 * 功能：在查询和操作客户机软件包中，转换协议或持久数据表示并保持调用边界；本入口产生 `items` 供上层消费（`package-workbench.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `package-workbench.ts`; this entry produces `items` for its caller. Module context: Queries/mutates guest packages, validating names and parsing the selected package-manager output.
 * 处理：通过 `output.split`, `line.match`, `items.push`, `line.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `output.split`, `line.match`, `items.push`, `line.split`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `manager === 'apk' && mode === 'installed'`; `match`; `manager === 'apk' && mode === 'search'`.
 * 输入 / Inputs: manager: 'apk' | 'apt'; mode: 'installed' | 'search' | 'updates'; output: string
 * 输出 / Returns: Item[]；结果来自 / values from `items`.
 * 副作用 / Effects: `items.push`; `status.startsWith`; 更新 / updates `match`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function parsePackageRows(manager: 'apk' | 'apt', mode: 'installed' | 'search' | 'updates',
  output: string): Item[] {
  const items: Item[] = [];
  for (const line of output.split(/\r?\n/)) {
    let match: RegExpMatchArray | null;
    if (manager === 'apk' && mode === 'installed') {
      match = line.match(/^(.+)-([0-9][^ ]*)\s+\S+.*\[installed\]$/);
      if (match) items.push({ name: match[1], version: match[2], installedVersion: match[2] });
    } else if (manager === 'apk' && mode === 'search') {
      match = line.match(/^(.+)-([0-9][^ ]*) - (.*)$/);
      if (match) items.push({ name: match[1], version: match[2], description: match[3] });
    } else if (manager === 'apk') {
      match = line.match(/^(.+)-([0-9][^ ]*)\s+<\s+(\S+)/);
      if (match) items.push({ name: match[1], version: match[3],
        installedVersion: match[2], availableVersion: match[3] });
    } else if (mode === 'installed') {
      const [status, name, version] = line.split('\t');
      if (status?.startsWith('ii') && name && version)
        items.push({ name, version, installedVersion: version });
    } else if (mode === 'search') {
      match = line.match(/^([^\s]+) - (.*)$/);
      if (match) items.push({ name: match[1], version: '', description: match[2] });
    } else {
      match = line.match(/^([^/\s]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from: (\S+)\]$/);
      if (match) items.push({ name: match[1], version: match[2],
        installedVersion: match[3], availableVersion: match[2] });
    }
  }
  return items;
}

/**
 * 入口 / Entry: managerFor.
 * 功能：从当前输入或状态计算 `!distro || distro === 'alpine' ? 'apk' : 'apt'`，供调用方后续验证或使用。
 * Purpose: Computes `!distro || distro === 'alpine' ? 'apk' : 'apt'` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: distro: string optional
 * 输出 / Returns: 'apk' | 'apt'；结果来自 / values from `!distro || distro === 'alpine' ? 'apk' : 'apt'`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function managerFor(distro?: string): 'apk' | 'apt' {
  return !distro || distro === 'alpine' ? 'apk' : 'apt';
}

/**
 * 入口 / Entry: simulateCommand.
 * 功能：在查询和操作客户机软件包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ install: `apk add --simulate ${argument}`, remove: `apk del --simulate ${argument}`, upgrade: `apk upgrade --simulate ${arg…` / `{ install: `apt-get -s install ${argument}`, remove: `apt-get -s remove ${argument}`, upgrade: `apt-get -s --only-upgrade ins…` 供上层消费（`package-workbench.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `package-workbench.ts`; this entry produces `{ install: `apk add --simulate ${argument}`, remove: `apk del --simulate ${argument}`, upgrade: `apk upgrade --simulate ${arg…` / `{ install: `apt-get -s install ${argument}`, remove: `apt-get -s remove ${argument}`, upgrade: `apt-get -s --only-upgrade ins…` for its caller. Module context: Queries/mutates guest packages, validating names and parsing the selected package-manager output.
 * 处理：通过 `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `quote`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `manager === 'apk'`.
 * 输入 / Inputs: manager: 'apk' | 'apt'; change: Change; name: string optional
 * 输出 / Returns: `{ install: `apk add --simulate ${argument}`, remove: `apk del --simulate ${argument}`, upgrade: `apk upgrade --simulate ${arg…`; `{ install: `apt-get -s install ${argument}`, remove: `apt-get -s remove ${argument}`, upgrade: `apt-get -s --only-upgrade ins…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function simulateCommand(manager: 'apk' | 'apt', change: Change, name?: string) {
  const argument = name ? quote(name) : '';
  if (manager === 'apk') return {
    install: `apk add --simulate ${argument}`,
    remove: `apk del --simulate ${argument}`,
    upgrade: `apk upgrade --simulate ${argument}`,
    'upgrade-all': 'apk upgrade --simulate',
  }[change];
  return {
    install: `apt-get -s install ${argument}`,
    remove: `apt-get -s remove ${argument}`,
    upgrade: `apt-get -s --only-upgrade install ${argument}`,
    'upgrade-all': 'apt-get -s upgrade',
  }[change];
}

export class PackageWorkbench {
  private previews = new Map<string, Preview>();
  /**
   * 入口 / Entry: PackageWorkbench.constructor.
   * 功能：建立 PackageWorkbench 的查询和操作客户机软件包上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PackageWorkbench context for this module's responsibility: Queries/mutates guest packages, validating names and parsing the selected package-manager output. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; run: Runner
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private run: Runner) {}

  /**
   * 入口 / Entry: PackageWorkbench.query.
   * 功能：在查询和操作客户机软件包中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ vmId: id, mode: input.mode, manager, query: input.query, page: input.page, total: all.length, items: all.slice(start, start…` 供上层消费（`PackageWorkbench`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `PackageWorkbench`; this entry produces `{ vmId: id, mode: input.mode, manager, query: input.query, page: input.page, total: all.length, items: all.slice(start, start…` for its caller. Module context: Queries/mutates guest packages, validating names and parsing the selected package-manager output.
   * 处理：通过 `querySchema.parse`, `this.machines.get`, `this.machines.state`, `managerFor` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `querySchema.parse`, `this.machines.get`, `this.machines.state`, `managerFor`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal optional
   * 输出 / Returns: `{ vmId: id, mode: input.mode, manager, query: input.query, page: input.page, total: all.length, items: all.slice(start, start…`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `input.mode === 'search' && input.query.length < 2`; `result.code !== 0`; 异常 / errors `new AppError('请先启动发行版', 409)`; `new AppError('搜索至少需要 2 个字符')`.
   */
  async query(id: string, raw: unknown, signal?: AbortSignal) {
    const input = querySchema.parse(raw);
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    if (input.mode === 'search' && input.query.length < 2)
      throw new AppError('搜索至少需要 2 个字符');
    const manager = managerFor(vm.distro);
    const command = manager === 'apk'
      ? { installed: 'apk list --installed',
        search: `apk search -v ${quote(input.query)}`,
        updates: "apk version -l '<'" }[input.mode]
      : { installed: "dpkg-query -W -f='${db:Status-Abbrev}\\t${binary:Package}\\t${Version}\\n'",
        search: `apt-cache search ${quote(input.query)}`,
        updates: 'apt list --upgradable 2>/dev/null' }[input.mode];
    const result = await this.machines.exec(id, command, 30_000, signal);
    if (result.code !== 0) throw new AppError(result.stderr || '软件包列表查询失败', 502);
    const filter = input.mode === 'search' ? '' : input.query.toLowerCase();
    const all = parsePackageRows(manager, input.mode, result.stdout)
      .filter((item) => !filter || item.name.toLowerCase().includes(filter));
    const start = (input.page - 1) * input.limit;
    return { vmId: id, mode: input.mode, manager, query: input.query, page: input.page,
      total: all.length, items: all.slice(start, start + input.limit),
      hasMore: start + input.limit < all.length,
      warning: result.stderr.trim().slice(0, 1000) };
  }

  /**
   * 入口 / Entry: PackageWorkbench.simulate.
   * 功能：在查询和操作客户机软件包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ manager, plan: plan.slice(0, 32_768), digest: hash(plan) }` 供上层消费（`PackageWorkbench`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PackageWorkbench`; this entry produces `{ manager, plan: plan.slice(0, 32_768), digest: hash(plan) }` for its caller. Module context: Queries/mutates guest packages, validating names and parsing the selected package-manager output.
   * 处理：通过 `this.machines.get`, `this.machines.state`, `packageName.parse`, `managerFor` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.state`, `packageName.parse`, `managerFor`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `name`.
   * 输入 / Inputs: id: string; change: Change; name: string optional; signal: AbortSignal optional
   * 输出 / Returns: `{ manager, plan: plan.slice(0, 32_768), digest: hash(plan) }`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `change === 'upgrade-all' ? !!name : !name`; `result.code !== 0`; 异常 / errors `new AppError('请先启动发行版', 409)`; `new AppError('软件包操作参数无效')`.
   */
  private async simulate(id: string, change: Change, name?: string, signal?: AbortSignal) {
    this.machines.get(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    if (change === 'upgrade-all' ? !!name : !name)
      throw new AppError('软件包操作参数无效');
    if (name) packageName.parse(name);
    const manager = managerFor(this.machines.get(id).distro);
    const command = simulateCommand(manager, change, name);
    const result = await this.machines.exec(id, command, 60_000, signal);
    if (result.code !== 0) throw new AppError(result.stderr || result.stdout || '软件包预览失败', 502);
    const plan = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    if (!plan) throw new AppError('软件包管理器没有返回可复核的预览', 502);
    return { manager, plan: plan.slice(0, 32_768), digest: hash(plan) };
  }

  /**
   * 入口 / Entry: PackageWorkbench.action.
   * 功能：在查询和操作客户机软件包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ job: this.run(id, 'update') }` / `{ token, expiresAt, manager: result.manager, plan: result.plan, change: input.change, name: input.name || null }` 供上层消费（`PackageWorkbench`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PackageWorkbench`; this entry produces `{ job: this.run(id, 'update') }` / `{ token, expiresAt, manager: result.manager, plan: result.plan, change: input.change, name: input.name || null }` for its caller. Module context: Queries/mutates guest packages, validating names and parsing the selected package-manager output.
   * 处理：通过 `packageWorkbenchRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `packageWorkbenchRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `input.operation === 'preview'`; `this.previews.size > 100`; `value.expiresAt < Date.now() || this.previews.size > 100`.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal optional
   * 输出 / Returns: `{ job: this.run(id, 'update') }`; `{ token, expiresAt, manager: result.manager, plan: result.plan, change: input.change, name: input.name || null }`; `{ job: this.run(id, preview.change, preview.name) }`.
   * 副作用 / Effects: `this.previews.set`; `this.previews.delete`.
   * 拒绝 / Refusals: 条件 / conditions `input.operation === 'refresh-index'`; `this.machines.state(id) !== 'running'`; `!preview || preview.vmId !== id || preview.expiresAt < Date.now() || preview.boot !== this.machines.live.get(id)`; 异常 / errors `new AppError('请先启动发行版', 409)`; `new AppError('预览已过期，请重新检查软件包变更', 409)`.
   */
  async action(id: string, raw: unknown, signal?: AbortSignal) {
    const input = packageWorkbenchRequest.parse(raw);
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (input.operation === 'refresh-index') {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
      return { job: this.run(id, 'update') };
    }
    if (input.operation === 'preview') {
      const result = await this.simulate(id, input.change, input.name, signal);
      const token = randomUUID();
      const expiresAt = Date.now() + 5 * 60_000;
      this.previews.set(token, { vmId: id, change: input.change, name: input.name,
        digest: result.digest, expiresAt, boot: this.machines.live.get(id)! });
      if (this.previews.size > 100) {
        for (const [key, value] of this.previews)
          if (value.expiresAt < Date.now() || this.previews.size > 100) this.previews.delete(key);
      }
      return { token, expiresAt, manager: result.manager, plan: result.plan,
        change: input.change, name: input.name || null };
    }
    const preview = this.previews.get(input.token);
    this.previews.delete(input.token);
    if (!preview || preview.vmId !== id || preview.expiresAt < Date.now() ||
        preview.boot !== this.machines.live.get(id))
      throw new AppError('预览已过期，请重新检查软件包变更', 409);
    const current = await this.simulate(id, preview.change, preview.name, signal);
    if (current.digest !== preview.digest)
      throw new AppError('软件包计划已变化，请重新预览', 409);
    return { job: this.run(id, preview.change, preview.name) };
  }
}
