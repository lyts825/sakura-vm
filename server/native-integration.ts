/**
 * 模块职责：管理 Windows 文件关联及原生集成配置，校验路径、注册项并支持恢复与撤销。
 * Module purpose: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
 */
import { lstat, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA, PORT, ROOT } from './paths.ts';
import { readStore, regularDirectory, within, writeStore } from './local-store.ts';
import {
  launchNative,
  systemExecutable,
  windowsRegistry,
  type RegistryApply,
  type RegistryEntry,
} from './windows-shell.ts';
import type {
  NativeHandoff,
  NativeMapping,
  NativeSettings,
  NativeView,
} from '../shared/native-integration.ts';
import type { Features } from './features.ts';

const project = z.string().regex(/^(default|[a-f0-9]{16})$/);
const extension = z.string().regex(/^\.[a-z0-9][a-z0-9_-]{0,23}$/);
const scope = { vmId: z.uuid(), projectId: project };
export const nativeSettings = z
  .object({
    contextMenu: z.boolean(),
    editor: z.enum(['notepad', 'vscode']),
    associations: z.array(z.object({ extension, ...scope }).strict()).max(32),
  })
  .strict()
  .refine(
    (v) => new Set(v.associations.map((e) => e.extension)).size === v.associations.length,
    '扩展名不能重复',
  );
const safePath = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\x00-\x1f]+$/);
export const nativeRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('configure'),
      version: z.number().int().positive(),
      settings: nativeSettings,
    })
    .strict(),
  z.object({ action: z.literal('repair'), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('receive'), path: safePath, extension: extension.optional() }).strict(),
  z.object({ action: z.literal('resolve'), ticket: z.uuid() }).strict(),
  z
    .object({ action: z.literal('open'), ...scope, path: safePath, target: z.enum(['explorer', 'editor']) })
    .strict(),
]);
const entry = z
  .object({ path: z.string().max(1024), name: z.string().max(128), value: z.string().max(16384) })
  .strict();
const stateSchema = z
  .object({
    version: z.number().int().positive(),
    owner: z.string().regex(/^[a-f0-9]{16}$/),
    settings: nativeSettings,
    registered: z.array(entry).max(500),
    pending: z
      .object({ settings: nativeSettings, entries: z.array(entry).max(500) })
      .strict()
      .optional(),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ contextMenu: false, editor: 'notepad', associations: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ contextMenu: false, editor: 'notepad', associations: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: NativeSettings；结果来自 / values from `({ contextMenu: false, editor: 'notepad', associations: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = (): NativeSettings => ({ contextMenu: false, editor: 'notepad', associations: [] });

/**
 * 入口 / Entry: nativeMappings.
 * 功能：在管理 Windows 文件关联及原生集成配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[]` / `result` 供上层消费（`native-integration.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `native-integration.ts`; this entry produces `[]` / `result` for its caller. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
 * 处理：通过 `features.enabled.has`, `features.machines.records.values`, `features.machines.incidentLocked`, `features.workspaces.projects.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `features.enabled.has`, `features.machines.records.values`, `features.machines.incidentLocked`, `features.workspaces.projects.list`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!features.sync || !features.workspaces || !features.enabled.has('files')`; `vm.sandbox || features.machines.incidentLocked(vm.id)`; `config`.
 * 输入 / Inputs: features: Features
 * 输出 / Returns: Promise<NativeMapping[]>；结果来自 / values from `[]`; `result`.
 * 副作用 / Effects: `result.push`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function nativeMappings(features: Features): Promise<NativeMapping[]> {
  if (!features.sync || !features.workspaces || !features.enabled.has('files')) return [];
  const result: NativeMapping[] = [];
  for (const vm of features.machines.records.values()) {
    // Incident isolation also blocks host-side access to the workspace.
    if (vm.sandbox || features.machines.incidentLocked(vm.id)) continue;
    const index = await features.workspaces.projects.list(vm.id);
    for (const p of index.projects) {
      const config = await features.workspaces.projects.inScope(vm.id, p.id, () =>
        features.sync.config(vm.id),
      );
      if (config)
        result.push({
          vmId: vm.id,
          projectId: p.id,
          name: `${vm.name} / ${p.name}`,
          host: config.host,
          guest: config.guest,
        });
    }
  }
  return result;
}

// Shell substitutes %1 / %V after parsing this template. Windows paths cannot
// contain quotes; literal percent signs in install paths would create placeholders.
/**
 * 入口 / Entry: commandPart.
 * 功能：在管理 Windows 文件关联及原生集成配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``"${value}"`` 供上层消费（`native-integration.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `native-integration.ts`; this entry produces ``"${value}"`` for its caller. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
 * 处理：通过 `win32.isAbsolute`, `inline.test`, `value.endsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `win32.isAbsolute`, `inline.test`, `value.endsWith`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: ``"${value}"``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!win32.isAbsolute(value) || /["%\x00-\x1f]/.test(value) || value.endsWith('\\')`; 异常 / errors `new AppError('Windows 集成安装路径不能包含引号、百分号或控制字符')`.
 */
function commandPart(value: string) {
  if (!win32.isAbsolute(value) || /["%\x00-\x1f]/.test(value) || value.endsWith('\\'))
    throw new AppError('Windows 集成安装路径不能包含引号、百分号或控制字符');
  return `"${value}"`;
}
/**
 * 入口 / Entry: nativeRegistration.
 * 功能：在管理 Windows 文件关联及原生集成配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`native-integration.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `native-integration.ts`; this entry produces `result` for its caller. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
 * 处理：通过 `commandPart`, `put`, `association.extension.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `commandPart`, `put`, `association.extension.slice`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `settings.contextMenu`.
 * 输入 / Inputs: owner: string; settings: NativeSettings; node: string; helper: string; port: number
 * 输出 / Returns: RegistryEntry[]；结果来自 / values from `result`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function nativeRegistration(
  owner: string,
  settings: NativeSettings,
  node: string,
  helper: string,
  port: number,
): RegistryEntry[] {
  const result: RegistryEntry[] = [];
  const progId = `Sakura.Workspace.${owner}`;
  const base = `${commandPart(node)} ${commandPart(helper)} --port ${port}`;
  /**
   * 入口 / Entry: nativeRegistration.put.
   * 功能：把本层请求转交 `result.push`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `result.push` and propagates the provider result or rejection.
   * 输入 / Inputs: path: string; value: string; name: default=''
   * 输出 / Returns: `result.push({ path, name, value })`.
   * 副作用 / Effects: `result.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const put = (path: string, value: string, name = '') => result.push({ path, name, value });
  if (settings.contextMenu) {
    for (const [parent, parameter] of [
      ['Directory', '%1'],
      ['Directory\\Background', '%V'],
      ['*', '%1'],
    ]) {
      const key = `${parent}\\shell\\${progId}`;
      put(key, '在 Sakura 工作区中打开');
      put(key, 'Single', 'MultiSelectModel');
      // A sentinel after the path preserves a directory's trailing backslash
      // through Windows command-line quote parsing. The helper removes it.
      put(key + '\\command', `${base} --shell-path "${parameter}|"`);
    }
  }
  for (const association of settings.associations) {
    const id = `${progId}.${association.extension.slice(1)}`;
    put(id, `Sakura 工作区 (${association.extension})`);
    put(id + '\\shell', 'open');
    put(id + '\\shell\\open', '在 Sakura 工作区中打开');
    put(id + '\\shell\\open\\command', `${base} --extension ${association.extension} --shell-path "%1|"`);
    put(association.extension + '\\OpenWithProgids', '', id);
  }
  return result;
}

/**
 * 入口 / Entry: checkedHostPath.
 * 功能：在管理 Windows 文件关联及原生集成配置中，核对调用资格、输入或资源归属；本入口产生 `{ path: actual, directory: info.isDirectory() }` 供上层消费（`native-integration.ts`）。
 * Purpose: Checks admission, input or resource ownership in `native-integration.ts`; this entry produces `{ path: actual, directory: info.isDirectory() }` for its caller. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
 * 处理：通过 `isAbsolute`, `within`, `inline.test`, `path.slice().includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `isAbsolute`, `within`, `inline.test`, `path.slice().includes`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: string; target: string
 * 输出 / Returns: `{ path: actual, directory: info.isDirectory() }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!isAbsolute(root) || !isAbsolute(target) || !within(root, target)`; `process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(path) || path.slice(2).includes(':'))`; `/[\x00-\x1f]/.test(path) || path .split(/[\\/]/) .some((p) => /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$…`; 异常 / errors `new AppError('文件不在此项目的 Windows 同步目录中', 403)`; `new AppError('仅支持本机驱动器中的普通路径')`.
 */
export async function checkedHostPath(root: string, target: string) {
  if (!isAbsolute(root) || !isAbsolute(target) || !within(root, target))
    throw new AppError('文件不在此项目的 Windows 同步目录中', 403);
  for (const path of [root, target]) {
    // Refuse device/UNC namespaces, ADS, ambiguous suffixes and symlink/junction
    // traversal. Checking every ancestor also protects a renamed root.
    if (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(path) || path.slice(2).includes(':')))
      throw new AppError('仅支持本机驱动器中的普通路径');
    if (
      /[\x00-\x1f]/.test(path) ||
      path
        .split(/[\\/]/)
        .some((p) => /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
    )
      throw new AppError('路径包含不支持的 Windows 文件名');
  }
  await regularDirectory(root);
  await regularDirectory(dirname(target));
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new AppError('Windows 文件尚不存在，请先同步项目', 404);
    throw error;
  });
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink > 1))
    throw new AppError('不能打开链接或特殊文件', 403);
  const actualRoot = await realpath(root),
    actual = await realpath(target);
  if (!within(actualRoot, actual)) throw new AppError('文件已离开 Windows 同步目录', 403);
  return { path: actual, directory: info.isDirectory() };
}

export class NativeIntegration {
  private state: State = {
    version: 1,
    owner: randomBytes(8).toString('hex'),
    settings: defaults(),
    registered: [],
  };
  private busy = false;
  private closed = false;
  private pending = new Set<Promise<unknown>>();
  private epoch = 0;
  private tickets = new Map<string, { value: NativeHandoff; mapping: string; expires: number }>();
  /**
   * 入口 / Entry: NativeIntegration.constructor.
   * 功能：建立 NativeIntegration 的管理 Windows 文件关联及原生集成配置上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the NativeIntegration context for this module's responsibility: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: mappings: () => Promise<NativeMapping[]>; file: default=join(DATA, 'native-integration.json'); registry: RegistryApply default=windowsRegistry(); launch: default=launchNative; runtime: default={ supported: process.platform === 'win32', node: proces…; guard: (vmId?: string) => void default=() => {}; now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private mappings: () => Promise<NativeMapping[]>,
    private file = join(DATA, 'native-integration.json'),
    private registry: RegistryApply = windowsRegistry(),
    private launch = launchNative,
    private runtime = {
      supported: process.platform === 'win32',
      node: process.execPath,
      helper: join(ROOT, 'scripts', 'native-open.mjs'),
      port: PORT,
    },
    private guard: (vmId?: string) => void = () => {},
    private now = Date.now,
  ) {}
  /**
   * 入口 / Entry: NativeIntegration.init.
   * 功能：在管理 Windows 文件关联及原生集成配置中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`NativeIntegration`）。
   * Purpose: Initializes and verifies current domain state in `NativeIntegration`; the outcome is recorded in `this.state`. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
   * 处理：通过 `stateSchema.parse`, `readStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.state = stateSchema.parse(await readStore(this.file, () => this.state));
  }
  /**
   * 入口 / Entry: NativeIntegration.view.
   * 功能：在管理 Windows 文件关联及原生集成配置中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ supported: this.runtime.supported, version: this.state.version, settings: structuredClone(this.state.settings), pending: !!…` 供上层消费（`NativeIntegration`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `NativeIntegration`; this entry produces `{ supported: this.runtime.supported, version: this.state.version, settings: structuredClone(this.state.settings), pending: !!…` for its caller. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
   * 处理：通过 `structuredClone`, `this.mappings` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `structuredClone`, `this.mappings`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<NativeView>；结果来自 / values from `{ supported: this.runtime.supported, version: this.state.version, settings: structuredClone(this.state.settings), pending: !!…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(): Promise<NativeView> {
    return {
      supported: this.runtime.supported,
      version: this.state.version,
      settings: structuredClone(this.state.settings),
      pending: !!this.state.pending,
      mappings: await this.mappings(),
    };
  }
  /**
   * 入口 / Entry: NativeIntegration.revoke.
   * 功能：在管理 Windows 文件关联及原生集成配置中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NativeIntegration`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeIntegration`; the calls and state transitions below complete the operation. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
   * 处理：通过 `this.tickets.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tickets.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.tickets.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  revoke() {
    this.epoch++;
    this.tickets.clear();
  }
  /**
   * 入口 / Entry: NativeIntegration.close.
   * 功能：在管理 Windows 文件关联及原生集成配置中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`NativeIntegration`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `NativeIntegration`; the outcome is recorded in `this.closed`. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
   * 处理：通过 `this.revoke`, `Promise.allSettled` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.revoke`, `Promise.allSettled`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.revoke();
    await Promise.allSettled(this.pending);
  }
  /**
   * 入口 / Entry: NativeIntegration.check.
   * 功能：在管理 Windows 文件关联及原生集成配置中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`NativeIntegration`）。
   * Purpose: Checks admission, input or resource ownership in `NativeIntegration`; the calls and state transitions below complete the operation. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
   * 处理：通过 `this.guard` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.guard`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: epoch: default=this.epoch; vmId: string optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `epoch !== this.epoch`; `!this.runtime.supported`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('操作会话已失效，请重新打开', 409)`.
   */
  private check(epoch = this.epoch, vmId?: string) {
    this.guard(vmId);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (epoch !== this.epoch) throw new AppError('操作会话已失效，请重新打开', 409);
    if (!this.runtime.supported) throw new AppError('宿主机集成仅支持 Windows', 409);
  }
  /**
   * 入口 / Entry: NativeIntegration.action.
   * 功能：在管理 Windows 文件关联及原生集成配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await task` 供上层消费（`NativeIntegration`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeIntegration`; this entry produces `await task` for its caller. Module context: Owns Windows file associations and native integration, validating paths/registry state and supporting restoration and revocation.
   * 处理：通过 `this.perform`, `this.pending.add`, `this.pending.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.perform`, `this.pending.add`, `this.pending.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `await task`.
   * 副作用 / Effects: `this.pending.add`; `this.pending.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.pending.delete(task);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.pending.delete(task);`; these steps also apply to exceptional exits.
   */
  async action(input: unknown) {
    const task = this.perform(input);
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
    }
  }
  /**
   * 入口 / Entry: NativeIntegration.perform.
   * 功能：校验并执行 Windows 集成配置、修复、撤销及原生打开动作。
   * Purpose: Validates/executes Windows integration configuration, repair, revocation and native open actions.
   * 设计：注册表变更核对原值，已有外部修改拒绝覆盖；持久计划和实际注册分阶段推进，finally 恢复 busy 状态。
   * Design: Registry writes compare original values and refuse external changes; plan/registration stages are separate and finally clears busy state.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.view()`; `structuredClone(ticket.value)`; `{ ticket, url: `http://127.0.0.1:${this.runtime.port}/#native=${ticket}` }`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `writeStore`; `this.state.settings.associations.some`; `this.state.settings.associations.find`; `this.tickets.delete`; `this.tickets.set`; 更新 / updates `this.busy`, `this.state`, `candidates`, `executable`.
   * 拒绝 / Refusals: 条件 / conditions `request.action === 'configure' || request.action === 'repair'`; `this.busy`; `request.version !== this.state.version`; 异常 / errors `new AppError('Windows 集成配置正在更新', 409)`; `new AppError('设置已改变，请刷新后重试', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.busy = false;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.busy = false;`; these steps also apply to exceptional exits.
   */
  private async perform(input: unknown) {
    const request = nativeRequest.parse(input),
      epoch = this.epoch;
    this.check(epoch);
    if (request.action === 'configure' || request.action === 'repair') {
      if (this.busy) throw new AppError('Windows 集成配置正在更新', 409);
      if (request.version !== this.state.version) throw new AppError('设置已改变，请刷新后重试', 409);
      this.busy = true;
      try {
        if (request.action === 'configure') {
          if (this.state.pending) throw new AppError('上次注册尚未完成，请先修复', 409);
          const mappings = await this.mappings();
          for (const a of request.settings.associations)
            if (!mappings.some((m) => m.vmId === a.vmId && m.projectId === a.projectId))
              throw new AppError('关联的项目尚未配置 Windows 同步目录', 409);
          const entries = nativeRegistration(
            this.state.owner,
            request.settings,
            this.runtime.node,
            this.runtime.helper,
            this.runtime.port,
          );
          if (entries.length) {
            if (!(await lstat(this.runtime.helper)).isFile())
              throw new AppError('Windows 打开助手未安装', 503);
          }
          this.check(epoch);
          const journal = {
            ...this.state,
            version: this.state.version + 1,
            pending: { settings: request.settings, entries },
          };
          await writeStore(this.file, journal);
          this.state = journal;
        }
        this.check(epoch);
        if (this.state.pending) {
          await this.registry(this.state.registered, this.state.pending.entries);
          // Keep the write-ahead journal if committing fails; repair is idempotent.
          const committed = {
            ...this.state,
            settings: this.state.pending.settings,
            registered: this.state.pending.entries,
            pending: undefined,
          };
          await writeStore(this.file, committed);
          this.state = committed;
          this.revoke();
        }
        return this.view();
      } finally {
        this.busy = false;
      }
    }
    if (this.state.pending || this.busy) throw new AppError('请等待或修复 Windows 集成设置', 409);
    const mappings = await this.mappings();
    this.check(epoch);
    if (request.action === 'resolve') {
      const ticket = this.tickets.get(request.ticket);
      if (!ticket || ticket.expires <= this.now())
        throw new AppError('打开请求已过期，请从资源管理器重新打开', 410);
      const mapping = mappings.find(
        (m) => m.vmId === ticket.value.vmId && m.projectId === ticket.value.projectId,
      );
      if (!mapping || JSON.stringify(mapping) !== ticket.mapping)
        throw new AppError('项目同步目录已改变，请重新打开', 409);
      this.check(epoch, mapping.vmId);
      return structuredClone(ticket.value);
    }
    if (request.action === 'receive') {
      if (
        request.extension
          ? !this.state.settings.associations.some((a) => a.extension === request.extension)
          : !this.state.settings.contextMenu
      )
        throw new AppError('此 Windows 打开入口未启用', 403);
      if (!isAbsolute(request.path)) throw new AppError('需要本机文件的绝对路径');
      const path = resolve(request.path);
      const association = this.state.settings.associations.find((a) => a.extension === request.extension);
      let candidates = mappings.filter(
        (m) =>
          within(m.host, path) &&
          (!association || (m.vmId === association.vmId && m.projectId === association.projectId)),
      );
      if (!candidates.length)
        throw new AppError('此文件不在已配置的 Windows 同步目录中，请先在项目的目录同步页配置', 404);
      candidates = candidates.sort((a, b) => b.host.length - a.host.length);
      const mapping = candidates[0];
      if (
        candidates.length > 1 &&
        resolve(candidates[1].host).toLowerCase() === resolve(mapping.host).toLowerCase()
      )
        throw new AppError('此 Windows 目录关联了多个项目，请通过扩展名关联选择项目', 409);
      const checked = await checkedHostPath(mapping.host, path);
      if (request.extension && (checked.directory || extname(path).toLowerCase() !== request.extension))
        throw new AppError('文件类型与关联不符');
      this.check(epoch, mapping.vmId);
      for (const [id, ticket] of this.tickets) if (ticket.expires <= this.now()) this.tickets.delete(id);
      if (this.tickets.size >= 64) throw new AppError('打开请求过多，请稍后再试', 429);
      const value: NativeHandoff = {
        vmId: mapping.vmId,
        projectId: mapping.projectId,
        path: posix.join(mapping.guest, relative(mapping.host, checked.path).split(sep).join('/')),
        directory: checked.directory,
      };
      const ticket = randomUUID();
      this.tickets.set(ticket, { value, mapping: JSON.stringify(mapping), expires: this.now() + 300000 });
      return { ticket, url: `http://127.0.0.1:${this.runtime.port}/#native=${ticket}` };
    }
    const mapping = mappings.find((m) => m.vmId === request.vmId && m.projectId === request.projectId);
    if (!mapping) throw new AppError('请先配置此项目的 Windows 目录同步', 409);
    const guest = posix.normalize(request.path),
      suffix = posix.relative(mapping.guest, guest);
    if (
      !request.path.startsWith('/') ||
      suffix === '..' ||
      suffix.startsWith('../') ||
      posix.isAbsolute(suffix) ||
      /[\\<>:"|?*]/.test(suffix)
    )
      throw new AppError('文件不在此项目的 Linux 同步目录中', 403);
    const checked = await checkedHostPath(mapping.host, resolve(mapping.host, ...suffix.split('/')));
    let executable: string, args: string[];
    if (request.target === 'explorer') {
      executable = systemExecutable('explorer.exe');
      args = checked.directory ? [checked.path] : ['/select,', checked.path];
    } else if (this.state.settings.editor === 'notepad') {
      if (checked.directory) throw new AppError('记事本只能打开文件；目录请使用资源管理器或 VS Code');
      executable = systemExecutable('notepad.exe');
      args = [checked.path];
    } else {
      const installations = [
        process.env.LOCALAPPDATA &&
          join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
      ].filter((p): p is string => !!p);
      executable = '';
      for (const file of installations)
        if ((await lstat(file).catch(() => null))?.isFile()) {
          executable = file;
          break;
        }
      if (!executable) throw new AppError('未找到 VS Code 的用户或系统安装，请安装后重试', 409);
      args = ['--reuse-window', '--', checked.path];
    }
    this.check(epoch, mapping.vmId);
    await this.launch(executable, args);
    return { opened: true, target: request.target, path: checked.path };
  }
}
