/**
 * 模块职责：生成并维护系统 hosts 的 Sakura 区块，发现未知或重复标记时保留文件供核查。
 * Module purpose: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
 */
import { networkFor } from './network/index.ts';
import { lstat, open, readFile } from 'node:fs/promises';

import { join } from 'node:path';
import { z } from 'zod';
import { localAliasActionSchema, type LocalAliasView } from '../shared/local-aliases.ts';
import { readStore, writeStore } from './local-store.ts';
import { metadataPath, type PluginMetadata } from './plugin-metadata.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';

const { lookup } = networkFor('core:local-aliases');

const BEGIN = '# BEGIN SAKURA LOCAL ALIASES';
const END = '# END SAKURA LOCAL ALIASES';
const aliasPattern = /^app-[a-f0-9]{32}\.sakura\.localhost$/;
const configSchema = z.object({ enabled: z.boolean() }).strict();
const defaultHosts = process.platform === 'win32'
  ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : null;

type Parsed = { outside: string; managed: string[]; newline: string };

/**
 * 入口 / Entry: parseHosts.
 * 功能：在生成并维护系统 hosts 的 Sakura 区块中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ outside, managed, newline: text.includes('\r\n') ? '\r\n' : '\n' }` 供上层消费（`local-aliases.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `local-aliases.ts`; this entry produces `{ outside, managed, newline: text.includes('\r\n') ? '\r\n' : '\n' }` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
 * 处理：通过 `text.split`, `lines.map`, `normalized.flatMap`, `normalized.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `text.split`, `lines.map`, `normalized.flatMap`, `normalized.slice`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: Parsed；结果来自 / values from `{ outside, managed, newline: text.includes('\r\n') ? '\r\n' : '\n' }`.
 * 副作用 / Effects: `inline.exec`; `managed.push`.
 * 拒绝 / Refusals: 条件 / conditions `starts.length !== ends.length || starts.length > 1 || (starts.length === 1 && starts[0] >= ends[0])`; `starts.length`; `!match || !aliasPattern.test(match[1])`; 异常 / errors `new AppError('系统 hosts 文件中的 Sakura 标记区块不完整或重复，请先人工检查', 409)`; `new AppError('Sakura 标记区块包含未知内容，请先人工检查', 409)`.
 */
function parseHosts(text: string): Parsed {
  const lines = text.split('\n');
  const normalized = lines.map((line) => line.replace(/\r$/, ''));
  const starts = normalized.flatMap((line, index) => line === BEGIN ? [index] : []);
  const ends = normalized.flatMap((line, index) => line === END ? [index] : []);
  if (starts.length !== ends.length || starts.length > 1 ||
      (starts.length === 1 && starts[0] >= ends[0]))
    throw new AppError('系统 hosts 文件中的 Sakura 标记区块不完整或重复，请先人工检查', 409);
  const managed: string[] = [];
  if (starts.length) {
    for (const line of normalized.slice(starts[0] + 1, ends[0])) {
      const match = /^127\.0\.0\.1 ([^\s#]+)$/.exec(line);
      if (!match || !aliasPattern.test(match[1]))
        throw new AppError('Sakura 标记区块包含未知内容，请先人工检查', 409);
      managed.push(match[1]);
    }
  }
  const outside = starts.length
    ? [...lines.slice(0, starts[0]), ...lines.slice(ends[0] + 1)].join('\n') : text;
  return { outside, managed, newline: text.includes('\r\n') ? '\r\n' : '\n' };
}

/**
 * 入口 / Entry: decodeHosts.
 * 功能：在生成并维护系统 hosts 的 Sakura 区块中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ text, bom }` 供上层消费（`local-aliases.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `local-aliases.ts`; this entry produces `{ text, bom }` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
 * 处理：通过 `buffer.subarray().equals`, `buffer.subarray`, `TextDecoder.decode`, `text.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `buffer.subarray().equals`, `buffer.subarray`, `TextDecoder.decode`, `text.includes`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: buffer: Buffer
 * 输出 / Returns: `{ text, bom }`.
 * 副作用 / Effects: 更新 / updates `text`.
 * 拒绝 / Refusals: 条件 / conditions `text.includes('\0')`; 异常 / errors `new AppError('系统 hosts 文件不是 UTF-8，无法安全修改', 409)`; `new AppError('系统 hosts 文件使用不受支持的编码', 409)`.
 * 失败处理：catch 分支执行 `throw new AppError('系统 hosts 文件不是 UTF-8，无法安全修改', 409);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('系统 hosts 文件不是 UTF-8，无法安全修改', 409);`; these statements determine whether a failure is absorbed or rejected again.
 */
function decodeHosts(buffer: Buffer) {
  const bom = buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? buffer.subarray(3) : buffer); }
  catch { throw new AppError('系统 hosts 文件不是 UTF-8，无法安全修改', 409); }
  if (text.includes('\0')) throw new AppError('系统 hosts 文件使用不受支持的编码', 409);
  return { text, bom };
}

/**
 * 入口 / Entry: renderLocalAliases.
 * 功能：在生成并维护系统 hosts 的 Sakura 区块中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ next: Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(next, 'utf8')]), managed: parsed.…` 供上层消费（`local-aliases.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `local-aliases.ts`; this entry produces `{ next: Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(next, 'utf8')]), managed: parsed.…` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
 * 处理：通过 `desired.some`, `decodeHosts`, `parseHosts`, `parsed.outside.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `desired.some`, `decodeHosts`, `parseHosts`, `parsed.outside.split`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!desired.includes(name.toLowerCase())`; `managed.length`; `next && !next.endsWith('\n')`.
 * 输入 / Inputs: original: Buffer; desired: string[]
 * 输出 / Returns: `{ next: Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(next, 'utf8')]), managed: parsed.…`.
 * 副作用 / Effects: `external.add`; 更新 / updates `next`.
 * 拒绝 / Refusals: 条件 / conditions `desired.length > 24 || desired.some((name) => !aliasPattern.test(name)) || new Set(desired).size !== desired.length`; `parts[0] !== '127.0.0.1'`; 异常 / errors `new AppError('本地域名列表无效', 400)`; `new AppError(`本地域名 ${name} 已被其他 hosts 规则占用`, 409)`.
 */
export function renderLocalAliases(original: Buffer, desired: string[]) {
  if (desired.length > 24 || desired.some((name) => !aliasPattern.test(name)) ||
      new Set(desired).size !== desired.length)
    throw new AppError('本地域名列表无效', 400);
  const { text, bom } = decodeHosts(original);
  const parsed = parseHosts(text);
  const external = new Set<string>();
  for (const line of parsed.outside.split(/\r?\n/)) {
    const parts = line.split('#', 1)[0].trim().split(/\s+/);
    for (const name of parts.slice(1)) {
      if (!desired.includes(name.toLowerCase())) continue;
      if (parts[0] !== '127.0.0.1')
        throw new AppError(`本地域名 ${name} 已被其他 hosts 规则占用`, 409);
      external.add(name.toLowerCase());
    }
  }
  const managed = desired.filter((name) => !external.has(name)).sort();
  let next = parsed.outside;
  if (managed.length) {
    if (next && !next.endsWith('\n')) next += parsed.newline;
    next += [BEGIN, ...managed.map((name) => `127.0.0.1 ${name}`), END, '']
      .join(parsed.newline);
  }
  return { next: Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
    Buffer.from(next, 'utf8')]), managed: parsed.managed, external: [...external] };
}

export class LocalAliases {
  private enabled = false;
  private lastError?: string;
  private writes: Promise<unknown> = Promise.resolve();
  private file: string;
  /**
   * 入口 / Entry: LocalAliases.constructor.
   * 功能：建立 LocalAliases 的生成并维护系统 hosts 的 Sakura 区块上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the LocalAliases context for this module's responsibility: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: names: () => string[]; hostsFile: string | null default=defaultHosts; file: string | PluginMetadata default=join(DATA, 'plugins', 'network', 'local-aliases.json'); resolver: ((name: string) => Promise<string>) | undefined default=hostsFile && hostsFile === defaultHosts ? async (name) …
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.file`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private names: () => string[], private hostsFile: string | null = defaultHosts,
    file: string | PluginMetadata = join(DATA, 'plugins', 'network', 'local-aliases.json'),
    private resolver: ((name: string) => Promise<string>) | undefined =
      hostsFile && hostsFile === defaultHosts
        ? async (name) => (await lookup(name, { family: 4 })).address : undefined) { this.file = metadataPath(file); }

  /**
   * 入口 / Entry: LocalAliases.init.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，初始化并核对当前领域状态；处理结果记录到 `this.enabled`（`LocalAliases`）。
   * Purpose: Initializes and verifies current domain state in `LocalAliases`; the outcome is recorded in `this.enabled`. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `configSchema.parse`, `readStore`, `this.refresh` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `configSchema.parse`, `readStore`, `this.refresh`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.enabled`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.enabled = configSchema.parse(await readStore(this.file, () => ({ enabled: false }))).enabled;
    await this.refresh();
  }

  /**
   * 入口 / Entry: LocalAliases.desired.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...new Set(this.names())].sort()` 供上层消费（`LocalAliases`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAliases`; this entry produces `[...new Set(this.names())].sort()` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `inline.sort`, `this.names` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.sort`, `this.names`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...new Set(this.names())].sort()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private desired() {
    return [...new Set(this.names())].sort();
  }

  /**
   * 入口 / Entry: LocalAliases.requireHosts.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，核对调用资格、输入或资源归属；本入口产生 `this.hostsFile` 供上层消费（`LocalAliases`）。
   * Purpose: Checks admission, input or resource ownership in `LocalAliases`; this entry produces `this.hostsFile` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.hostsFile`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.hostsFile`; 异常 / errors `new AppError('当前系统不支持 Windows hosts 别名管理', 501)`.
   */
  private requireHosts() {
    if (!this.hostsFile) throw new AppError('当前系统不支持 Windows hosts 别名管理', 501);
    return this.hostsFile;
  }

  /**
   * 入口 / Entry: LocalAliases.readHosts.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `readFile(path)` 供上层消费（`LocalAliases`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `LocalAliases`; this entry produces `readFile(path)` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `this.requireHosts`, `lstat`, `info.isFile`, `info.isSymbolicLink` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.requireHosts`, `lstat`, `info.isFile`, `info.isSymbolicLink`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `readFile(path)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024`; 异常 / errors `new AppError('系统 hosts 文件不是普通文件或超过 1 MiB', 409)`.
   */
  private async readHosts() {
    const path = this.requireHosts();
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
      throw new AppError('系统 hosts 文件不是普通文件或超过 1 MiB', 409);
    return readFile(path);
  }

  /**
   * 入口 / Entry: LocalAliases.view.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ enabled: this.enabled, supported: false, aliases, installed: [], missing: aliases, stale: [], error: '当前系统不支持 Windows hosts…` / `{ enabled: this.enabled, supported: true, aliases, installed, missing: this.enabled ? aliases.filter((name) => !installed.inc…` 供上层消费（`LocalAliases`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `LocalAliases`; this entry produces `{ enabled: this.enabled, supported: false, aliases, installed: [], missing: aliases, stale: [], error: '当前系统不支持 Windows hosts…` / `{ enabled: this.enabled, supported: true, aliases, installed, missing: this.enabled ? aliases.filter((name) => !installed.inc…` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `this.desired`, `this.readHosts`, `parseHosts`, `decodeHosts` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.desired`, `this.readHosts`, `parseHosts`, `decodeHosts`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.hostsFile`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<LocalAliasView>；结果来自 / values from `{ enabled: this.enabled, supported: false, aliases, installed: [], missing: aliases, stale: [], error: '当前系统不支持 Windows hosts…`; `{ enabled: this.enabled, supported: true, aliases, installed, missing: this.enabled ? aliases.filter((name) => !installed.inc…`; `{ enabled: this.enabled, supported: true, aliases, installed: [], missing: this.enabled ? aliases : [], stale: [], error: (er…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return { enabled: this.enabled, supported: true, aliases, installed: [], missing: this.enabled ? aliases : [], stale: [], err…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { enabled: this.enabled, supported: true, aliases, installed: [], missing: this.enabled ? aliases : [], stale: [], err…`; these statements determine whether a failure is absorbed or rejected again.
   */
  async view(): Promise<LocalAliasView> {
    const aliases = this.desired();
    if (!this.hostsFile) return { enabled: this.enabled, supported: false,
      aliases, installed: [], missing: aliases, stale: [],
      error: '当前系统不支持 Windows hosts 别名管理' };
    try {
      const current = await this.readHosts();
      const parsed = parseHosts(decodeHosts(current).text);
      const { external } = renderLocalAliases(current, aliases);
      const installed = [...new Set([...parsed.managed, ...external])].sort();
      return { enabled: this.enabled, supported: true, aliases, installed,
        missing: this.enabled ? aliases.filter((name) => !installed.includes(name)) : [],
        stale: parsed.managed.filter((name) => !this.enabled || !aliases.includes(name)),
        ...(this.lastError ? { error: this.lastError } : {}) };
    } catch (error) {
      return { enabled: this.enabled, supported: true, aliases, installed: [],
        missing: this.enabled ? aliases : [], stale: [], error: (error as Error).message };
    }
  }

  /**
   * 入口 / Entry: LocalAliases.writeHosts.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，校验并提交领域状态变更；完成下述调用及状态处理（`LocalAliases`）。
   * Purpose: Validates and commits a domain state change in `LocalAliases`; the calls and state transitions below complete the operation. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `open().catch`, `open`, `this.requireHosts`, `handle.stat` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `open().catch`, `open`, `this.requireHosts`, `handle.stat`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: next: Buffer; original: Buffer
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `replace`; `replace().then`; `handle.close`; 更新 / updates `started`.
   * 拒绝 / Refusals: 条件 / conditions `info.size !== original.length`; `bytesRead !== original.length || !check.equals(original)`; `rollbackError`; 异常 / errors `new AppError('系统 hosts 文件已被其他程序修改，请重试', 409)`; `new AppError('系统 hosts 文件写入与回滚都失败，请立即人工检查 hosts 文件', 500)`.
   * 收尾：退出 try 区域时始终执行 `await handle.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await handle.close();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `const rollbackError = started ? await replace(original).then(() => null, (failure: Error) => failure) : null;`; `if (rollbackError) throw new AppError('系统 hosts 文件写入与回滚都失败，请立即人工检查 hosts 文件', 500);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const rollbackError = started ? await replace(original).then(() => null, (failure: Error) => failure) : null;`; `if (rollbackError) throw new AppError('系统 hosts 文件写入与回滚都失败，请立即人工检查 hosts 文件', 500);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async writeHosts(next: Buffer, original: Buffer) {
    const handle = await open(this.requireHosts(), 'r+').catch((error) => {
      if (['EACCES', 'EPERM'].includes(error.code))
        throw new AppError('修改系统 hosts 文件需要管理员权限；请以管理员身份运行 Sakura 后重试', 403);
      throw error;
    });
    let started = false;
    /**
     * 入口 / Entry: LocalAliases.writeHosts.replace.
     * 功能：在生成并维护系统 hosts 的 Sakura 区块中，校验并提交领域状态变更；完成下述调用及状态处理（`LocalAliases`）。
     * Purpose: Validates and commits a domain state change in `LocalAliases`; the calls and state transitions below complete the operation. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
     * 处理：通过 `handle.write`, `handle.truncate`, `handle.sync` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `handle.write`, `handle.truncate`, `handle.sync`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: value: Buffer
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `handle.write`; 更新 / updates `offset`.
     * 拒绝 / Refusals: 条件 / conditions `!bytesWritten`; 异常 / errors `new Error('系统 hosts 文件写入未完成')`.
     */
    const replace = async (value: Buffer) => {
      let offset = 0;
      while (offset < value.length) {
        const { bytesWritten } = await handle.write(value, offset, value.length - offset, offset);
        if (!bytesWritten) throw new Error('系统 hosts 文件写入未完成');
        offset += bytesWritten;
      }
      await handle.truncate(value.length);
      await handle.sync();
    };
    try {
      const info = await handle.stat();
      if (info.size !== original.length) throw new AppError('系统 hosts 文件已被其他程序修改，请重试', 409);
      const check = Buffer.alloc(original.length);
      const { bytesRead } = await handle.read(check, 0, check.length, 0);
      if (bytesRead !== original.length || !check.equals(original))
        throw new AppError('系统 hosts 文件已被其他程序修改，请重试', 409);
      started = true;
      await replace(next);
    } catch (error) {
      const rollbackError = started ? await replace(original).then(() => null,
        (failure: Error) => failure) : null;
      if (rollbackError)
        throw new AppError('系统 hosts 文件写入与回滚都失败，请立即人工检查 hosts 文件', 500);
      if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code || ''))
        throw new AppError('修改系统 hosts 文件需要管理员权限；请以管理员身份运行 Sakura 后重试', 403);
      throw error;
    } finally { await handle.close(); }
  }

  /**
   * 入口 / Entry: LocalAliases.syncNow.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.lastError`（`LocalAliases`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAliases`; the outcome is recorded in `this.lastError`. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `this.readHosts`, `this.desired`, `renderLocalAliases`, `next.equals` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.readHosts`, `this.desired`, `renderLocalAliases`, `next.equals`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!next.equals(original)`; `!this.resolver`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.writeHosts`; 更新 / updates `address`, `this.lastError`.
   * 拒绝 / Refusals: 条件 / conditions `address !== '127.0.0.1'`; 异常 / errors `new AppError(`系统解析器仍无法解析 ${name}；请刷新 DNS 缓存后重试`, 409)`; `new AppError(`系统解析器把 ${name} 解析为 ${address}，而不是本机回环地址`, 409)`.
   * 失败处理：catch 分支执行 `throw new AppError(`系统解析器仍无法解析 ${name}；请刷新 DNS 缓存后重试`, 409);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError(`系统解析器仍无法解析 ${name}；请刷新 DNS 缓存后重试`, 409);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async syncNow() {
    const original = await this.readHosts();
    const desired = this.enabled ? this.desired() : [];
    const { next } = renderLocalAliases(original, desired);
    if (!next.equals(original)) await this.writeHosts(next, original);
    for (const name of desired) {
      if (!this.resolver) break;
      let address: string;
      try { address = await this.resolver(name); }
      catch { throw new AppError(`系统解析器仍无法解析 ${name}；请刷新 DNS 缓存后重试`, 409); }
      if (address !== '127.0.0.1')
        throw new AppError(`系统解析器把 ${name} 解析为 ${address}，而不是本机回环地址`, 409);
    }
    this.lastError = undefined;
  }

  /**
   * 入口 / Entry: LocalAliases.serialize.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`LocalAliases`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAliases`; this entry produces `operation` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serialize<T>(work: () => Promise<T>) {
    const operation = this.writes.catch(() => {}).then(work);
    this.writes = operation;
    return operation;
  }

  /**
   * 入口 / Entry: LocalAliases.refresh.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`LocalAliases`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAliases`; the calls and state transitions below complete the operation. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `this.serialize` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serialize`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async refresh() {
    await this.serialize(async () => {
      try { await this.syncNow(); }
      catch (error) { this.lastError = (error as Error).message; }
    });
  }

  /**
   * 入口 / Entry: LocalAliases.action.
   * 功能：在生成并维护系统 hosts 的 Sakura 区块中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serialize(async () => { if (parsed.action === 'set-enabled') { await writeStore(this.file, { enabled: parsed.enabled });…` 供上层消费（`LocalAliases`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LocalAliases`; this entry produces `this.serialize(async () => { if (parsed.action === 'set-enabled') { await writeStore(this.file, { enabled: parsed.enabled });…` for its caller. Module context: Maintains the Sakura hosts-file block, preserving unknown or duplicate markers for inspection instead of overwriting them.
   * 处理：通过 `localAliasActionSchema.parse`, `this.serialize` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `localAliasActionSchema.parse`, `this.serialize`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serialize(async () => { if (parsed.action === 'set-enabled') { await writeStore(this.file, { enabled: parsed.enabled });…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(input: unknown) {
    const parsed = localAliasActionSchema.parse(input);
    /**
     * 入口 / Entry: LocalAliases.action.callback@205.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.serialize）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.serialize).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.enabled`, `this.lastError`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     * 失败处理：catch 分支执行 `this.lastError = (error as Error).message;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.lastError = (error as Error).message;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serialize(async () => {
      if (parsed.action === 'set-enabled') {
        await writeStore(this.file, { enabled: parsed.enabled });
        this.enabled = parsed.enabled;
      }
      try { await this.syncNow(); }
      catch (error) {
        this.lastError = (error as Error).message;
        throw error;
      }
      return this.view();
    });
  }
}
