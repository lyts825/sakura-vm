/**
 * 模块职责：保存网络档案并预览、应用或恢复镜像、代理和转发设置，拒绝重复端口及 URL 凭据。
 * Module purpose: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { join, posix } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import { type VMConfig } from '../shared/contracts/vm.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { Files, ftpStat, textVersion } from './files.ts';
import { quote } from './shell.ts';
import { envPrefix } from './project-services.ts';
import { readStore, writeStore } from './local-store.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { dependencyDownloadsSchema } from './dependency-downloads.ts';

/**
 * 入口 / Entry: callback@24.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.string().max().default().refine / 请输入不含凭证、查询参数的 HTTP(S) 地址）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.string().max().default().refine / 请输入不含凭证、查询参数的 HTTP(S) 地址).
 * 输入 / Inputs: value
 * 输出 / Returns: `true`; `( ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !/[\s\x00-\x1f]…`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
const networkUrl = z
  .string()
  .max(2048)
  .default('')
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/[\s\x00-\x1f]/.test(value)
      );
    } catch {
      return false;
    }
  }, '请输入不含凭证、查询参数的 HTTP(S) 地址');
export const forwardsSchema = z
  .array(
    z
      .object({
        name: z.string().trim().max(40).optional(),
        host: z.number().int().min(1024).max(65535),
        guest: z.number().int().min(1).max(65535),
      })
      .strict(),
  )
  .max(12)
  .refine((values) => new Set(values.map((item) => item.host)).size === values.length, '主机端口不能重复');
const dnsDomain = z.string().trim().toLowerCase().max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, '请输入完整 DNS 域名')
  .refine((value) => !value.endsWith('.local') && !value.endsWith('.localhost'),
    '.local 和 .localhost 不作为单播私有 DNS 路由域名');
export const networkSchema = z
  .object({
    dnsServers: z
      .array(
        z.string().refine((value) => isIP(value) !== 0 && !value.includes('%'), 'DNS 需要 IPv4 或 IPv6 地址'),
      )
      .max(3)
      .refine((values) => new Set(values).size === values.length, 'DNS 地址不能重复')
      .default([]),
    dnsDomains: z.array(dnsDomain).max(8)
      .refine((values) => new Set(values).size === values.length, 'DNS 域名不能重复')
      .default([]),
    dnssec: z.enum(['inherit', 'yes', 'allow-downgrade', 'no']).default('inherit'),
    forwards: forwardsSchema.optional(),
    httpProxy: networkUrl,
    httpsProxy: networkUrl,
    noProxy: z
      .string()
      .max(2048)
      .regex(/^[A-Za-z0-9_.,:*\-\[\]/]*$/)
      .default('localhost,127.0.0.1,::1'),
    npmRegistry: networkUrl,
    pipIndex: networkUrl,
    apkMirror: networkUrl,
    aptMirror: networkUrl,
    aptSecurityMirror: networkUrl,
    dependencyDownloads: dependencyDownloadsSchema.optional(),
  })
  .strict();
export type NetworkProfile = z.infer<typeof networkSchema>;
export type NetworkChange = { path: string; before: string | null; after: string };
export type ForwardChange = { before: VMConfig['forwards']; after: VMConfig['forwards'] };
type NetworkState = {
  config: NetworkProfile;
  changes: NetworkChange[];
  forwards?: ForwardChange;
  dnsBackend?: 'resolved';
  resolverLink?: { before: string; after: string };
  appliedAt?: string;
};
const savedProfileSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(60),
    config: networkSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type SavedNetworkProfile = z.infer<typeof savedProfileSchema>;
/**
 * 入口 / Entry: sameForwards.
 * 功能：从当前输入或状态计算 `JSON.stringify(left) === JSON.stringify(right)`，供调用方后续验证或使用。
 * Purpose: Computes `JSON.stringify(left) === JSON.stringify(right)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: left: VMConfig['forwards']; right: VMConfig['forwards']
 * 输出 / Returns: `JSON.stringify(left) === JSON.stringify(right)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const sameForwards = (left: VMConfig['forwards'], right: VMConfig['forwards']) =>
  JSON.stringify(left) === JSON.stringify(right);
/**
 * 入口 / Entry: canonicalIp.
 * 功能：从当前输入或状态计算 `(isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value)`，供调用方后续验证或使用。
 * Purpose: Computes `(isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `(isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const canonicalIp = (value: string) => (isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value);
/**
 * 入口 / Entry: networkEnvironment.
 * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `values` 供上层消费（`network-profiles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network-profiles.ts`; this entry produces `values` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
 * 处理：通过 `name.toLowerCase` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `name.toLowerCase`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `setting`; `value.npmRegistry`; `value.pipIndex`.
 * 输入 / Inputs: value: NetworkProfile
 * 输出 / Returns: Record<string, string>；结果来自 / values from `values`.
 * 副作用 / Effects: 更新 / updates `values[name]`, `values[name.toLowerCase()]`, `values.NPM_CONFIG_REGISTRY`, `values.PIP_INDEX_URL`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function networkEnvironment(value: NetworkProfile): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, setting] of [
    ['HTTP_PROXY', value.httpProxy],
    ['HTTPS_PROXY', value.httpsProxy],
    ['NO_PROXY', value.noProxy],
  ])
    if (setting) {
      values[name] = setting;
      values[name.toLowerCase()] = setting;
    }
  if (value.npmRegistry) values.NPM_CONFIG_REGISTRY = value.npmRegistry;
  if (value.pipIndex) values.PIP_INDEX_URL = value.pipIndex;
  return values;
}
/**
 * 入口 / Entry: rewriteMirrors.
 * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `config.apkMirror ? text.replace(/https?:\/\/[^\s#]+?(?=\/v\d+\.\d+\/|\/edge\/)/g, () => config.apkMirror.replace(/\/$/, ''), …` / `text .split('\n') .map((line) => { // Only repository URI fields may change; preserve comments and signing-key URLs. if (!/^\…` 供上层消费（`network-profiles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network-profiles.ts`; this entry produces `config.apkMirror ? text.replace(/https?:\/\/[^\s#]+?(?=\/v\d+\.\d+\/|\/edge\/)/g, () => config.apkMirror.replace(/\/$/, ''), …` / `text .split('\n') .map((line) => { // Only repository URI fields may change; preserve comments and signing-key URLs. if (!/^\…` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
 * 处理：通过 `text.replace`, `text.split().map().join`, `text.split().map`, `text.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `text.replace`, `text.split().map().join`, `text.split().map`, `text.split`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `distro === 'alpine'`.
 * 输入 / Inputs: text: string; distro: string; config: NetworkProfile
 * 输出 / Returns: `config.apkMirror ? text.replace(/https?:\/\/[^\s#]+?(?=\/v\d+\.\d+\/|\/edge\/)/g, () => config.apkMirror.replace(/\/$/, ''), …`; `text .split('\n') .map((line) => { // Only repository URI fields may change; preserve comments and signing-key URLs. if (!/^\…`.
 * 副作用 / Effects: `text.replace`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function rewriteMirrors(text: string, distro: string, config: NetworkProfile) {
  if (distro === 'alpine')
    return config.apkMirror
      ? text.replace(/https?:\/\/[^\s#]+?(?=\/v\d+\.\d+\/|\/edge\/)/g, () =>
          config.apkMirror.replace(/\/$/, ''),
        )
      : text;
  /**
   * 入口 / Entry: rewriteMirrors.callback@132.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（text.split().map）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (text.split().map).
   * 输入 / Inputs: line
   * 输出 / Returns: `line`; `( body.replace(/https?:\/\/[^\s]+/g, (value) => { const url = new URL(value); if (!/(^|\.)(debian\.org|ubuntu\.com)$/.test(ur…`.
   * 副作用 / Effects: `body.replace`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return text
    .split('\n')
    .map((line) => {
      // Only repository URI fields may change; preserve comments and signing-key URLs.
      if (!/^\s*(?:deb(?:-src)?\s|URIs:)/.test(line)) return line;
      const split = line.indexOf('#'),
        body = split < 0 ? line : line.slice(0, split),
        comment = split < 0 ? '' : line.slice(split);
      /**
       * 入口 / Entry: rewriteMirrors.callback@139.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（body.replace）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (body.replace).
       * 输入 / Inputs: value
       * 输出 / Returns: `value`; `(security ? config.aptSecurityMirror : config.aptMirror) || value`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return (
        body.replace(/https?:\/\/[^\s]+/g, (value) => {
          const url = new URL(value);
          if (!/(^|\.)(debian\.org|ubuntu\.com)$/.test(url.hostname)) return value;
          const security = /security|debian-security/.test(url.hostname + url.pathname);
          return (security ? config.aptSecurityMirror : config.aptMirror) || value;
        }) + comment
      );
    })
    .join('\n');
}
export const networkProfileRequest = savedProfileSchema
      .omit({ id: true, updatedAt: true })
      .extend({ id: z.uuid().optional() });

export class NetworkProfiles {
  jobs = new Jobs('network');
  /**
   * 入口 / Entry: NetworkProfiles.constructor.
   * 功能：建立 NetworkProfiles 的保存网络档案并预览、应用或恢复镜像、代理和转发设置上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the NetworkProfiles context for this module's responsibility: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines) {}
  /**
   * 入口 / Entry: NetworkProfiles.file.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), 'network.json')` 供上层消费（`NetworkProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkProfiles`; this entry produces `join(vmDir(id), 'network.json')` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `this.machines.get`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(vmDir(id), 'network.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string) {
    this.machines.get(id);
    return join(vmDir(id), 'network.json');
  }
  /**
   * 入口 / Entry: NetworkProfiles.state.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...state, config: networkSchema.parse(state.config) }` 供上层消费（`NetworkProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkProfiles`; this entry produces `{ ...state, config: networkSchema.parse(state.config) }` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `readStore`, `this.file`, `networkSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `this.file`, `networkSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ ...state, config: networkSchema.parse(state.config) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async state(id: string) {
    const state = await readStore<NetworkState>(this.file(id), () => ({
      config: networkSchema.parse({}),
      changes: [],
    }));
    return { ...state, config: networkSchema.parse(state.config) };
  }
  /**
   * 入口 / Entry: NetworkProfiles.profiles.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `z .array(savedProfileSchema) .max(40) .parse(await readStore(join(DATA, 'network-profiles.json'), () => []))` 供上层消费（`NetworkProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkProfiles`; this entry produces `z .array(savedProfileSchema) .max(40) .parse(await readStore(join(DATA, 'network-profiles.json'), () => []))` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `z.array().max().parse`, `z.array().max`, `z.array`, `readStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.array().max().parse`, `z.array().max`, `z.array`, `readStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `z .array(savedProfileSchema) .max(40) .parse(await readStore(join(DATA, 'network-profiles.json'), () => []))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async profiles() {
    return z
      .array(savedProfileSchema)
      .max(40)
      .parse(await readStore(join(DATA, 'network-profiles.json'), () => []));
  }
  /**
   * 入口 / Entry: NetworkProfiles.saveProfile.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，校验并提交领域状态变更；本入口产生 `this.machines.locked('network-profiles', async () => { const profiles = await this.profiles(); const existing = value.id ? pr…` 供上层消费（`NetworkProfiles`）。
   * Purpose: Validates and commits a domain state change in `NetworkProfiles`; this entry produces `this.machines.locked('network-profiles', async () => { const profiles = await this.profiles(); const existing = value.id ? pr…` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `networkProfileRequest.parse`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `networkProfileRequest.parse`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.machines.locked('network-profiles', async () => { const profiles = await this.profiles(); const existing = value.id ? pr…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async saveProfile(input: unknown) {
    const value = networkProfileRequest
      .parse(input);
    /**
     * 入口 / Entry: NetworkProfiles.saveProfile.callback@176.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked / network-profiles）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked / network-profiles).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `saved`.
     * 副作用 / Effects: `writeStore`.
     * 拒绝 / Refusals: 条件 / conditions `value.id && !existing`; `!existing && profiles.length >= 40`; `profiles.some( (item) => item.id !== existing?.id && item.name.toLowerCase() === value.name.toLowerCase(), )`; 异常 / errors `new AppError('网络档案不存在', 404)`; `new AppError('最多保存 40 个网络档案')`.
     */
    return this.machines.locked('network-profiles', async () => {
      const profiles = await this.profiles();
      const existing = value.id ? profiles.find((item) => item.id === value.id) : undefined;
      if (value.id && !existing) throw new AppError('网络档案不存在', 404);
      if (!existing && profiles.length >= 40) throw new AppError('最多保存 40 个网络档案');
      if (
        profiles.some(
          (item) => item.id !== existing?.id && item.name.toLowerCase() === value.name.toLowerCase(),
        )
      )
        throw new AppError('网络档案名称已存在', 409);
      const saved = { ...value, id: existing?.id || randomUUID(), updatedAt: new Date().toISOString() };
      const next = [...profiles.filter((item) => item.id !== saved.id), saved];
      await writeStore(join(DATA, 'network-profiles.json'), next);
      return saved;
    });
  }
  /**
   * 入口 / Entry: NetworkProfiles.removeProfile.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.machines.locked('network-profiles', async () => { const profiles = await this.profiles(); if (!profiles.some((item) => i…` 供上层消费（`NetworkProfiles`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `NetworkProfiles`; this entry produces `this.machines.locked('network-profiles', async () => { const profiles = await this.profiles(); if (!profiles.some((item) => i…` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.machines.locked('network-profiles', async () => { const profiles = await this.profiles(); if (!profiles.some((item) => i…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async removeProfile(id: string) {
    z.uuid().parse(id);
    /**
     * 入口 / Entry: NetworkProfiles.removeProfile.callback@195.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked / network-profiles）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked / network-profiles).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ removed: id }`.
     * 副作用 / Effects: `writeStore`.
     * 拒绝 / Refusals: 条件 / conditions `!profiles.some((item) => item.id === id)`; 异常 / errors `new AppError('网络档案不存在', 404)`.
     */
    return this.machines.locked('network-profiles', async () => {
      const profiles = await this.profiles();
      if (!profiles.some((item) => item.id === id)) throw new AppError('网络档案不存在', 404);
      await writeStore(
        join(DATA, 'network-profiles.json'),
        profiles.filter((item) => item.id !== id),
      );
      return { removed: id };
    });
  }
  /**
   * 入口 / Entry: NetworkProfiles.environment.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `state.appliedAt ? networkEnvironment(state.config) : {}` 供上层消费（`NetworkProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkProfiles`; this entry produces `state.appliedAt ? networkEnvironment(state.config) : {}` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `this.state`, `networkEnvironment` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state`, `networkEnvironment`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `state.appliedAt ? networkEnvironment(state.config) : {}`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async environment(id: string) {
    const state = await this.state(id);
    return state.appliedAt ? networkEnvironment(state.config) : {};
  }
  /**
   * 入口 / Entry: NetworkProfiles.read.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `null` / `this.machines.readGuestFile(id, path)` 供上层消费（`NetworkProfiles`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `NetworkProfiles`; this entry produces `null` / `this.machines.readGuestFile(id, path)` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `this.machines.sftp`, `info.isFile`, `this.machines.readGuestFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.sftp`, `info.isFile`, `this.machines.readGuestFile`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!info`.
   * 输入 / Inputs: id: string; path: string
   * 输出 / Returns: `null`; `this.machines.readGuestFile(id, path)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile()`; 异常 / errors `new AppError(`配置不是普通文件：${path}`)`.
   */
  private async read(id: string, path: string) {
    const info = await this.machines.sftp(id, (ftp) => ftpStat(ftp, path));
    if (!info) return null;
    if (!info.isFile()) throw new AppError(`配置不是普通文件：${path}`);
    return this.machines.readGuestFile(id, path);
  }
  /**
   * 入口 / Entry: NetworkProfiles.preview.
   * 功能：读取原网络配置及客户机文件，构造镜像、代理、DNS 和转发的变更预览。
   * Purpose: Reads original network settings/guest files to preview mirror/proxy/DNS/forwarding changes.
   * 设计：预览固定 before/after 证据，拒绝未恢复的旧应用记录或不完整 DNS 配置；本调用不提交客户机改动。
   * Design: Preview pins before/after evidence, refusing unrestored prior changes/incomplete DNS without committing guest mutations.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal optional
   * 输出 / Returns: `{ config, changes, forwards, dnsBackend, resolverLink, token }`.
   * 副作用 / Effects: `add`; `this.machines.exec`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `resolverLink`, `dnsBackend`.
   * 拒绝 / Refusals: 条件 / conditions `previous.appliedAt || previous.changes.length || previous.forwards || previous.dnsBackend || previous.resolverLink`; `config.dnsDomains.length && !config.dnsServers.length`; `config.dnssec !== 'inherit' && !config.dnsServers.length`; 异常 / errors `new AppError('请先恢复原配置，再应用新的网络设置')`; `new AppError('私有域名路由需要指定 DNS 服务器')`.
   */
  async preview(id: string, input: unknown, signal?: AbortSignal) {
    const config = networkSchema.parse(input),
      vm = this.machines.get(id);
    const previous = await this.state(id);
    if (previous.appliedAt || previous.changes.length || previous.forwards || previous.dnsBackend || previous.resolverLink)
      throw new AppError('请先恢复原配置，再应用新的网络设置');
    const changes: NetworkChange[] = [];
    let dnsBackend: 'resolved' | undefined;
    let resolverLink: NetworkState['resolverLink'];
    const forwards =
      config.forwards && !sameForwards(vm.forwards, config.forwards)
        ? { before: structuredClone(vm.forwards), after: config.forwards }
        : undefined;
    /**
     * 入口 / Entry: NetworkProfiles.preview.add.
     * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NetworkProfiles`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkProfiles`; the calls and state transitions below complete the operation. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
     * 处理：通过 `signal.throwIfAborted`, `this.read`, `after`, `changes.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.read`, `after`, `changes.push`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `next !== before`.
     * 输入 / Inputs: path: string; after: (before: string | null) => string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `changes.push`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const add = async (path: string, after:
    /**
     * 中文功能：根据预览修改前的文本构造变更后的文本。
     * English: Constructs replacement text from the text preceding a previewed change.
     * 所属 / Owner: NetworkProfiles.preview.add.after.
     * 输入 / Inputs: before: string | null.
     * 结果 / Result: `string`.
     */
    (before: string | null) => string) => {
      signal?.throwIfAborted();
      const before = await this.read(id, path),
        next = after(before);
      if (next !== before) changes.push({ path, before, after: next });
    };
    if (config.dnsDomains.length && !config.dnsServers.length)
      throw new AppError('私有域名路由需要指定 DNS 服务器');
    if (config.dnssec !== 'inherit' && !config.dnsServers.length)
      throw new AppError('DNSSEC 策略需要同时指定 DNS 服务器，避免沿用未受该策略控制的链路 DNS');
    if (config.dnsServers.length || config.dnssec !== 'inherit') {
      if (!vm.distro || vm.distro === 'alpine') {
        if (config.dnsDomains.length || config.dnssec !== 'inherit')
          throw new AppError('私有域名路由和 DNSSEC 策略需要 systemd-resolved；Alpine 当前仅支持静态 DNS 地址');
        const interfaces = await this.read(id, '/etc/network/interfaces');
        if (
          !interfaces ||
          !/^\s*iface\s+eth0\s+inet\s+static\s*$/m.test(interfaces) ||
          /\binet6?\s+(?:dhcp|auto)\b/.test(interfaces)
        )
          throw new AppError('自定义 DNS 需要 Alpine 静态网络，当前解析器由其他网络管理器维护');
        await add(
          '/etc/resolv.conf',
          (before) =>
            (before || '')
              .split('\n')
              .filter((line) => !/^\s*nameserver\s/.test(line) && line !== '# Managed by Sakura')
              .join('\n')
              .trimEnd() +
            '\n# Managed by Sakura\n' +
            config.dnsServers.map((address) => `nameserver ${address}`).join('\n') +
            '\n',
        );
      } else {
        const resolver = await this.machines.exec(
          id,
          'systemctl is-active --quiet systemd-resolved && readlink -f /etc/resolv.conf',
          10000,
          signal,
        );
        const target = resolver.stdout.trim();
        if (resolver.code !== 0 ||
            !['/run/systemd/resolve/stub-resolv.conf', '/run/systemd/resolve/resolv.conf'].includes(target))
          throw new AppError(
            '此实例的 DNS 后端不受支持：需要 systemd-resolved 管理 /etc/resolv.conf；可清空 DNS 地址沿用系统设置',
          );
        if (target === '/run/systemd/resolve/resolv.conf' &&
            (config.dnsDomains.length || config.dnssec !== 'inherit')) {
          const link = await this.machines.exec(id, 'readlink /etc/resolv.conf', 10000, signal);
          const before = link.stdout.trim();
          if (link.code !== 0 || posix.resolve('/etc', before) !== target)
            throw new AppError('无法安全切换客户机解析器链接');
          resolverLink = { before, after: '/run/systemd/resolve/stub-resolv.conf' };
        }
        dnsBackend = 'resolved';
        await add(
          '/etc/systemd/resolved.conf.d/90-sakura.conf',
          () => [
            '[Resolve]',
            ...(config.dnsServers.length ? [
              'DNS=',
              `DNS=${config.dnsServers.join(' ')}`,
              'Domains=',
              `Domains=${config.dnsDomains.length ? config.dnsDomains.map((domain) => `~${domain}`).join(' ') : '~.'}`,
            ] : []),
            ...(config.dnssec !== 'inherit' ? [`DNSSEC=${config.dnssec}`] : []),
            '',
          ].join('\n'),
        );
      }
    }
    await add(
      '/etc/profile.d/sakura-network.sh',
      () => '# Managed by Sakura\n' + envPrefix(networkEnvironment(config)) + '\n',
    );
    if (!vm.distro || vm.distro === 'alpine') {
      if (config.apkMirror)
        await add('/etc/apk/repositories', (before) => rewriteMirrors(before || '', 'alpine', config));
    } else {
      await add(
        '/etc/apt/apt.conf.d/90sakura-proxy',
        () =>
          [
            config.httpProxy && `Acquire::http::Proxy "${config.httpProxy.replaceAll('"', '%22')}";`,
            config.httpsProxy && `Acquire::https::Proxy "${config.httpsProxy.replaceAll('"', '%22')}";`,
          ]
            .filter(Boolean)
            .join('\n') + '\n',
      );
      if (config.aptMirror || config.aptSecurityMirror) {
        const result = await this.machines.exec(
          id,
          "find /etc/apt -maxdepth 2 -type f \\( -name '*.list' -o -name '*.sources' \\) -print",
          10000,
          signal,
        );
        if (result.code !== 0) throw new AppError('无法读取 APT 软件源');
        const paths = result.stdout.trim().split('\n').filter(Boolean);
        if (paths.length > 30) throw new AppError('软件源文件过多，请手动配置');
        for (const path of paths) {
          if (!/^\/etc\/apt\/[A-Za-z0-9_./-]+\.(list|sources)$/.test(path) || path.includes('..'))
            throw new AppError('软件源路径不受支持');
          await add(path, (before) => rewriteMirrors(before || '', vm.distro!, config));
        }
      }
    }
    const token = createHash('sha256')
      .update(JSON.stringify({ id, config, changes, forwards, dnsBackend, resolverLink }))
      .digest('hex');
    return { config, changes, forwards, dnsBackend, resolverLink, token };
  }
  /**
   * 入口 / Entry: NetworkProfiles.readResolverLink.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result.stdout.trim()` 供上层消费（`NetworkProfiles`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `NetworkProfiles`; this entry produces `result.stdout.trim()` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `this.machines.exec`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `result.stdout.trim()`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('客户机解析器链接不可读取', 409)`.
   */
  private async readResolverLink(id: string) {
    const result = await this.machines.exec(id, 'readlink /etc/resolv.conf', 10000);
    if (result.code !== 0) throw new AppError('客户机解析器链接不可读取', 409);
    return result.stdout.trim();
  }
  /**
   * 入口 / Entry: NetworkProfiles.switchResolverLink.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NetworkProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkProfiles`; the calls and state transitions below complete the operation. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `randomUUID`, `inline.join`, `quote`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `randomUUID`, `inline.join`, `quote`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; before: string; after: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('客户机解析器链接切换失败，请恢复原配置', 409)`.
   */
  private async switchResolverLink(id: string, before: string, after: string) {
    const temp = `/etc/.sakura-resolv-${randomUUID()}`;
    const command = [
      'set -eu',
      `test "$(readlink /etc/resolv.conf)" = ${quote(before)}`,
      `temp=${quote(temp)}`,
      'trap \'rm -f "$temp"\' EXIT',
      `ln -s ${quote(after)} "$temp"`,
      'mv -Tf "$temp" /etc/resolv.conf',
      `test "$(readlink /etc/resolv.conf)" = ${quote(after)}`,
    ].join('\n');
    const result = await this.machines.exec(id, command, 10000);
    if (result.code !== 0) throw new AppError('客户机解析器链接切换失败，请恢复原配置', 409);
  }
  /**
   * 入口 / Entry: NetworkProfiles.reloadDns.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NetworkProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkProfiles`; the calls and state transitions below complete the operation. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `this.machines.exec`, `result.stdout.split().find().slice().trim().split`, `result.stdout.split().find().slice().trim`, `result.stdout.split().find().slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `result.stdout.split().find().slice().trim().split`, `result.stdout.split().find().slice().trim`, `result.stdout.split().find().slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; expected: Pick<NetworkProfile, 'dnsServers' | 'dnsDomains' | 'dnssec'> optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; `expected?.dnsServers.length`; `!expected.dnsServers.every((address) => global.map(canonicalIp).includes(canonicalIp(address)))`; 异常 / errors `new AppError('重新加载 DNS 失败，请恢复原配置后检查解析器')`; `new AppError('DNS 服务没有使用所选地址，请恢复原配置后检查解析器')`.
   */
  private async reloadDns(id: string, expected?: Pick<NetworkProfile, 'dnsServers' | 'dnsDomains' | 'dnssec'>) {
    const result = await this.machines.exec(
      id,
      'set -eu\nsystemctl restart systemd-resolved\nLC_ALL=C resolvectl dns',
      30000,
    );
    if (result.code !== 0) throw new AppError('重新加载 DNS 失败，请恢复原配置后检查解析器');
    if (expected?.dnsServers.length) {
      const global =
        result.stdout
          .split('\n')
          .find((line) => /^Global:/.test(line))
          ?.slice(7)
          .trim()
          .split(/\s+/) || [];
      if (!expected.dnsServers.every((address) => global.map(canonicalIp).includes(canonicalIp(address))))
        throw new AppError('DNS 服务没有使用所选地址，请恢复原配置后检查解析器');
    }
    if (expected?.dnsServers.length) {
      const domain = await this.machines.exec(id, 'LC_ALL=C resolvectl domain', 10000);
      if (domain.code !== 0) throw new AppError('无法核对私有域名路由，请恢复原配置后检查解析器');
      const global = domain.stdout.split('\n').find((line) => /^Global:/.test(line))?.slice(7).trim().split(/\s+/) || [];
      const required = expected.dnsDomains.length
        ? expected.dnsDomains.map((value) => `~${value}`)
        : ['~.'];
      if (!required.every((value) => global.includes(value)))
        throw new AppError('DNS 服务没有使用所选域名路由，请恢复原配置后检查解析器');
    }
    if (expected?.dnssec !== undefined && expected.dnssec !== 'inherit') {
      const dnssec = await this.machines.exec(id, 'LC_ALL=C resolvectl dnssec', 10000);
      if (dnssec.code !== 0 ||
          !dnssec.stdout.split('\n').some((line) => line.trim() === `Global: ${expected.dnssec}`))
        throw new AppError('DNSSEC 策略没有生效，请恢复原配置后检查解析器');
    }
  }
  /**
   * 入口 / Entry: NetworkProfiles.apply.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; input: unknown; token: string
   * 输出 / Returns: `this.machines.locked(`network:${id}`, async () => { const preview = await this.preview(id, input); if (preview.token !== toke…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async apply(id: string, input: unknown, token: string) {
    /**
     * 入口 / Entry: NetworkProfiles.apply.callback@394.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `state`.
     * 副作用 / Effects: `writeStore`; `this.machines.setForwards`; `this.machines.exec`; `this.machines.writeGuestFile`; 更新 / updates `state.appliedAt`.
     * 拒绝 / Refusals: 条件 / conditions `preview.token !== token`; 异常 / errors `new AppError('配置已变化，请重新预览', 409)`.
     */
    return this.machines.locked(`network:${id}`, async () => {
      const preview = await this.preview(id, input);
      if (preview.token !== token) throw new AppError('配置已变化，请重新预览', 409);
      // Persist the complete rollback plan before the first guest write.
      const state: NetworkState = {
        config: preview.config,
        changes: preview.changes,
        forwards: preview.forwards,
        dnsBackend: preview.dnsBackend,
        resolverLink: preview.resolverLink,
      };
      await writeStore(this.file(id), state);
      if (preview.forwards)
        await this.machines.setForwards(id, preview.forwards.after, preview.forwards.before);
      for (const change of preview.changes) {
        await this.machines.exec(id, `mkdir -p ${quote(posix.dirname(change.path))}`);
        await this.machines.writeGuestFile(
          id,
          change.path,
          change.after,
          change.before !== null,
          change.before === null ? undefined : textVersion(change.before),
        );
      }
      if (preview.dnsBackend) await this.reloadDns(id, preview.config);
      if (preview.resolverLink)
        await this.switchResolverLink(id, preview.resolverLink.before, preview.resolverLink.after);
      state.appliedAt = new Date().toISOString();
      await writeStore(this.file(id), state);
      return state;
    });
  }
  /**
   * 入口 / Entry: NetworkProfiles.restore.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.machines.locked(`network:${id}`, async () => { const state = await this.state(id); // Validate every file before restori…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async restore(id: string) {
    /**
     * 入口 / Entry: NetworkProfiles.restore.callback@427.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `state`.
     * 副作用 / Effects: `this.machines.setForwards`; `writeStore`; `this.machines.writeGuestFile`; `state.changes.pop`.
     * 拒绝 / Refusals: 条件 / conditions `current !== change.after && current !== change.before`; `state.resolverLink`; `current !== state.resolverLink.before && current !== state.resolverLink.after`; 异常 / errors `new AppError(`配置被外部修改，恢复前请处理：${change.path}`, 409)`; `new AppError('解析器链接被外部修改，恢复前请处理', 409)`.
     */
    return this.machines.locked(`network:${id}`, async () => {
      const state = await this.state(id);
      // Validate every file before restoring any of them.
      for (const change of state.changes) {
        const current = await this.read(id, change.path);
        if (current !== change.after && current !== change.before)
          throw new AppError(`配置被外部修改，恢复前请处理：${change.path}`, 409);
      }
      if (state.resolverLink) {
        const current = await this.readResolverLink(id);
        if (current !== state.resolverLink.before && current !== state.resolverLink.after)
          throw new AppError('解析器链接被外部修改，恢复前请处理', 409);
      }
      if (state.forwards) {
        const current = this.machines.get(id).forwards;
        if (!sameForwards(current, state.forwards.before)) {
          if (!sameForwards(current, state.forwards.after))
            throw new AppError('端口映射被外部修改，恢复前请处理', 409);
          await this.machines.setForwards(id, state.forwards.before, state.forwards.after);
        }
        delete state.forwards;
        await writeStore(this.file(id), state);
      }
      const files = new Files(this.machines);
      while (state.changes.length) {
        const change = state.changes.at(-1)!;
        if ((await this.read(id, change.path)) !== change.before) {
          if (change.before === null) await files.operation(id, 'delete', change.path);
          else
            await this.machines.writeGuestFile(
              id,
              change.path,
              change.before,
              true,
              textVersion(change.after),
            );
        }
        state.changes.pop();
        await writeStore(this.file(id), state);
      }
      if (state.dnsBackend) {
        await this.reloadDns(id);
        delete state.dnsBackend;
      }
      if (state.resolverLink) {
        if ((await this.readResolverLink(id)) === state.resolverLink.after)
          await this.switchResolverLink(id, state.resolverLink.after, state.resolverLink.before);
        delete state.resolverLink;
      }
      delete state.appliedAt;
      await writeStore(this.file(id), state);
      return state;
    });
  }
  /**
   * 入口 / Entry: NetworkProfiles.test.
   * 功能：在保存网络档案并预览、应用或恢复镜像、代理和转发设置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( id, async (log, signal) => { const urls = [ ...new Set( [ 'https://example.com', config.npmRegistry, config.…` 供上层消费（`NetworkProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NetworkProfiles`; this entry produces `this.jobs.start( id, async (log, signal) => { const urls = [ ...new Set( [ 'https://example.com', config.npmRegistry, config.…` for its caller. Module context: Stores/previews/applies/restores mirror, proxy and forwarding profiles, refusing duplicate ports and embedded URL credentials.
   * 处理：通过 `networkSchema.parse`, `this.machines.get`, `this.jobs.start` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `networkSchema.parse`, `this.machines.get`, `this.jobs.start`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.jobs.start( id, async (log, signal) => { const urls = [ ...new Set( [ 'https://example.com', config.npmRegistry, config.…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  test(id: string, input: unknown) {
    const config = networkSchema.parse(input);
    this.machines.get(id);
    /**
     * 入口 / Entry: NetworkProfiles.test.callback@486.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError(`连接测试失败：${url}`)`.
     */
    return this.jobs.start(
      id,
      async (log, signal) => {
        const urls = [
          ...new Set(
            [
              'https://example.com',
              config.npmRegistry,
              config.pipIndex,
              config.apkMirror,
              config.aptMirror,
              config.aptSecurityMirror,
            ].filter(Boolean),
          ),
        ];
        for (const url of urls) {
          signal.throwIfAborted();
          log(`测试 ${url}…\n`);
          const result = await guestTask(
            this.machines,
            id,
            `${envPrefix(networkEnvironment(config))}\nif command -v curl >/dev/null; then curl -fsSLI --max-time 10 ${quote(url)} >/dev/null; else wget -q --spider -T 10 ${quote(url)}; fi`,
            signal,
            undefined,
            15000,
          );
          log(result.code === 0 ? '连接通过\n' : '连接失败，请检查地址、代理和证书\n');
          if (result.code !== 0) throw new AppError(`连接测试失败：${url}`);
        }
      },
      { title: '网络配置连通性测试', vmId: id },
    );
  }
  /**
   * 入口 / Entry: NetworkProfiles.close.
   * 功能：把本层请求转交 `this.jobs.close`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.jobs.close` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.jobs.close()`.
   * 副作用 / Effects: `this.jobs.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    return this.jobs.close();
  }
}
