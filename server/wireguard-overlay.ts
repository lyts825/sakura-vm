/**
 * 模块职责：校验并管理客户机 WireGuard 配置与动作，周期核对隧道状态及私密密钥引用。
 * Module purpose: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
 */
import type { SecretsV1 } from './service-contracts/v1.ts';
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { redactValues, secretName } from './secrets.ts';

const interfaceName = 'wg-sakura';
const key = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).refine((value) =>
  Buffer.from(value, 'base64').length === 32);
const cidr = z.string().max(50).refine((value) => {
  const [address, length, extra] = value.split('/');
  const version = isIP(address);
  return !extra && !!version && /^(0|[1-9][0-9]*)$/.test(length || '') &&
    Number(length) <= (version === 4 ? 32 : 128);
}, '需要 IPv4/IPv6 CIDR');
const endpoint = z.string().max(260).refine((value) => {
  try {
    const url = new URL(`udp://${value}`);
    return !!url.hostname && Number(url.port) >= 1 && Number(url.port) <= 65535 &&
      !url.username && !url.password && (url.pathname === '/' || url.pathname === '') &&
      !url.search && !url.hash &&
      !/\s/.test(value);
  } catch { return false; }
}, '需要主机名或 IP 及 UDP 端口');
/**
 * 入口 / Entry: callback@47.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: config; ctx
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `ctx.addIssue`; `keys.add`; `ranges.add`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const wireGuardConfigSchema = z.object({
  address: cidr,
  listenPort: z.number().int().min(1).max(65535),
  privateKeySecret: secretName,
  peers: z.array(z.object({
    publicKey: key,
    endpoint: endpoint.optional(),
    allowedIPs: z.array(cidr).min(1).max(16),
    keepaliveSeconds: z.number().int().min(0).max(65535).default(0),
  }).strict()).min(1).max(8),
  enabled: z.boolean().default(false),
}).strict().superRefine((config, ctx) => {
  const keys = new Set<string>();
  const ranges = new Set<string>();
  for (const [index, peer] of config.peers.entries()) {
    if (keys.has(peer.publicKey))
      ctx.addIssue({ code: 'custom', path: ['peers', index, 'publicKey'], message: '同一公钥只能出现一次' });
    keys.add(peer.publicKey);
    for (const range of peer.allowedIPs) {
      if (range.endsWith('/0'))
        ctx.addIssue({ code: 'custom', path: ['peers', index, 'allowedIPs'],
          message: '覆盖网络不能接管默认路由' });
      if (ranges.has(range))
        ctx.addIssue({ code: 'custom', path: ['peers', index, 'allowedIPs'],
          message: '不同对端的允许网段不能重复' });
      ranges.add(range);
    }
  }
});
export const wireGuardInput = z.object({
  mode: z.enum(['status', 'generate-key', 'save', 'start', 'stop']).default('status'),
  config: z.object({
    address: wireGuardConfigSchema.shape.address,
    listenPort: wireGuardConfigSchema.shape.listenPort,
    privateKeySecret: wireGuardConfigSchema.shape.privateKeySecret,
    peers: wireGuardConfigSchema.shape.peers,
  }).strict().optional(),
  secret: secretName.optional(),
}).strict();

/**
 * 入口 / Entry: wireGuardPublicKey.
 * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Buffer.from(publicDer).subarray(-32).toString('base64')` 供上层消费（`wireguard-overlay.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `wireguard-overlay.ts`; this entry produces `Buffer.from(publicDer).subarray(-32).toString('base64')` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
 * 处理：通过 `key.parse`, `createPrivateKey`, `createPublicKey().export`, `createPublicKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `key.parse`, `createPrivateKey`, `createPublicKey().export`, `createPublicKey`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: privateKey: string
 * 输出 / Returns: `Buffer.from(publicDer).subarray(-32).toString('base64')`.
 * 副作用 / Effects: `createPrivateKey`; `createPublicKey().export`; `createPublicKey`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function wireGuardPublicKey(privateKey: string) {
  key.parse(privateKey);
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b656e04220420', 'hex'),
    Buffer.from(privateKey, 'base64'),
  ]);
  const privateObject = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicDer = createPublicKey(privateObject).export({ format: 'der', type: 'spki' });
  return Buffer.from(publicDer).subarray(-32).toString('base64');
}

export class WireGuardOverlay {
  private timer: ScheduleHandle;
  private ticking?: Promise<void>;
  private booted = new Map<string, object>();
  private failures = new Map<string, { at: number; reason: string }>();
  private abort = new AbortController();
  private closed = false;
  /**
   * 入口 / Entry: WireGuardOverlay.constructor.
   * 功能：建立 WireGuardOverlay 的校验并管理客户机 WireGuard 配置与动作上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the WireGuardOverlay context for this module's responsibility: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; secrets: () => SecretsV1 | undefined
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private secrets: () => SecretsV1 | undefined) {
    this.timer = scheduler.register({ owner: 'plugin:network', label: 'WireGuard 状态校准', intervalMs: 30000,
      overlap: 'skip',
      /**
       * 入口 / Entry: WireGuardOverlay.constructor.run.
       * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.ticking`（`WireGuardOverlay`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; the outcome is recorded in `this.ticking`. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
       * 处理：通过 `this.tick().finally`, `this.tick` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.tick().finally`, `this.tick`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!this.ticking`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `this.ticking`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: async () => {
      if (!this.ticking) this.ticking = this.tick().finally(() => {
        this.ticking = undefined;
      });
      await this.ticking;
    } });
  }
  /**
   * 入口 / Entry: WireGuardOverlay.file.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), 'wireguard-overlay.json')` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; this entry produces `join(vmDir(id), 'wireguard-overlay.json')` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(vmDir(id), 'wireguard-overlay.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string) { return join(vmDir(id), 'wireguard-overlay.json'); }
  /**
   * 入口 / Entry: WireGuardOverlay.config.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `wireGuardConfigSchema.nullable().parse(await readStore(this.file(id), () => null))` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; this entry produces `wireGuardConfigSchema.nullable().parse(await readStore(this.file(id), () => null))` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `wireGuardConfigSchema.nullable().parse`, `wireGuardConfigSchema.nullable`, `readStore`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `wireGuardConfigSchema.nullable().parse`, `wireGuardConfigSchema.nullable`, `readStore`, `this.file`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `wireGuardConfigSchema.nullable().parse(await readStore(this.file(id), () => null))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async config(id: string) {
    return wireGuardConfigSchema.nullable().parse(await readStore(this.file(id), () => null));
  }
  /**
   * 入口 / Entry: WireGuardOverlay.requireSecrets.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，核对调用资格、输入或资源归属；本入口产生 `secrets` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Checks admission, input or resource ownership in `WireGuardOverlay`; this entry produces `secrets` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `this.secrets` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.secrets`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `secrets`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!secrets`; 异常 / errors `new AppError('请启用私密配置插件', 409)`.
   */
  private requireSecrets() {
    const secrets = this.secrets();
    if (!secrets) throw new AppError('请启用私密配置插件', 409);
    return secrets;
  }
  /**
   * 入口 / Entry: WireGuardOverlay.exec.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result.stdout.trim()` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; this entry produces `result.stdout.trim()` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `this.machines.exec`, `inline.slice`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `inline.slice`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; command: string; signal: AbortSignal; timeout: default=30_000
   * 输出 / Returns: `result.stdout.trim()`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code`; 异常 / errors `new AppError((result.stderr || result.stdout || '客户机命令失败').slice(0, 500), 409)`.
   */
  private async exec(id: string, command: string, signal: AbortSignal, timeout = 30_000) {
    const result = await this.machines.exec(id, command, timeout, signal);
    if (result.code) throw new AppError((result.stderr || result.stdout || '客户机命令失败').slice(0, 500), 409);
    return result.stdout.trim();
  }
  /**
   * 入口 / Entry: WireGuardOverlay.guestStatus.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ active: false, reason: '客户机未运行' }` / `{ active: false, reason: result.stderr.slice(0, 500) }` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; this entry produces `{ active: false, reason: '客户机未运行' }` / `{ active: false, reason: result.stderr.slice(0, 500) }` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `this.machines.state`, `this.machines.exec`, `result.stderr.slice`, `result.stdout.trim().split` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.state`, `this.machines.exec`, `result.stderr.slice`, `result.stdout.trim().split`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) !== 'running'`; `result.code`.
   * 输入 / Inputs: id: string; signal: AbortSignal
   * 输出 / Returns: `{ active: false, reason: '客户机未运行' }`; `{ active: false, reason: result.stderr.slice(0, 500) }`; `lines[0] === 'active' ? { active: true, publicKey: lines[1] || '', handshakes: lines.slice(2) } : { active: false }`.
   * 副作用 / Effects: `this.machines.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async guestStatus(id: string, signal: AbortSignal) {
    if (this.machines.state(id) !== 'running') return { active: false, reason: '客户机未运行' };
    const result = await this.machines.exec(id,
      `if command -v wg >/dev/null 2>&1 && ip link show dev ${interfaceName} >/dev/null 2>&1; then ` +
      `printf 'active\\n'; wg show ${interfaceName} public-key; wg show ${interfaceName} latest-handshakes; ` +
      `else printf 'inactive\\n'; fi`, 15_000, signal);
    if (result.code) return { active: false, reason: result.stderr.slice(0, 500) };
    const lines = result.stdout.trim().split(/\r?\n/);
    return lines[0] === 'active'
      ? { active: true, publicKey: lines[1] || '', handshakes: lines.slice(2) }
      : { active: false };
  }
  /**
   * 入口 / Entry: WireGuardOverlay.install.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; this entry produces `void` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `this.machines.exec`, `this.machines.get`, `this.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `this.machines.get`, `this.exec`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!found.code`.
   * 输入 / Inputs: id: string; signal: AbortSignal
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.machines.exec`; `this.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async install(id: string, signal: AbortSignal) {
    const found = await this.machines.exec(id, 'command -v wg >/dev/null && command -v ip >/dev/null',
      15_000, signal);
    if (!found.code) return;
    const distro = this.machines.get(id).distro || 'alpine';
    const command = distro === 'alpine' ? 'apk add --no-cache wireguard-tools' :
      'DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard-tools iproute2';
    await this.exec(id, command, signal, 180_000);
  }
  /**
   * 入口 / Entry: WireGuardOverlay.withGuestConfig.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await work(path)` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; this entry produces `await work(path)` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `randomUUID`, `this.machines.sftp`, `work`, `this.machines.exec().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `randomUUID`, `this.machines.sftp`, `work`, `this.machines.exec().catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; content: string; signal: AbortSignal; work: (path: string) => Promise<T>
   * 输出 / Returns: `await work(path)`.
   * 副作用 / Effects: `this.machines.exec().catch`; `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `!fallback || fallback.code`; 异常 / errors `new AppError('无法确认客户机临时 WireGuard 密钥文件已清理', 500)`.
   * 收尾：退出 try 区域时始终执行 `try { await this.machines.sftp(id, (ftp) => new Promise<void>((resolve, reject) => ftp.unlink(path, (error) => { const code =…`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `try { await this.machines.sftp(id, (ftp) => new Promise<void>((resolve, reject) => ftp.unlink(path, (error) => { const code =…`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `const fallback = await this.machines.exec(id, `rm -f -- ${path}`, 10_000).catch(() => null);`; `if (!fallback || fallback.code) throw new AppError('无法确认客户机临时 WireGuard 密钥文件已清理', 500);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const fallback = await this.machines.exec(id, `rm -f -- ${path}`, 10_000).catch(() => null);`; `if (!fallback || fallback.code) throw new AppError('无法确认客户机临时 WireGuard 密钥文件已清理', 500);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async withGuestConfig<T>(id: string, content: string, signal: AbortSignal,
    work: (path: string) => Promise<T>) {
    const path = `/run/sakura-wireguard-${randomUUID()}.conf`;
    try {
      await this.machines.sftp(id, async (ftp, transport) => {
        await pipeline(Readable.from([Buffer.from(content)]),
          ftp.createWriteStream(path, { flags: 'wx', mode: 0o600 }),
          { signal: transport || signal });
      }, signal);
      return await work(path);
    } finally {
      try {
        await this.machines.sftp(id, (ftp) => new Promise<void>((resolve, reject) =>
          ftp.unlink(path, (error) => {
            const code = (error as Error & { code?: string | number } | undefined)?.code;
            error && code !== 2 && code !== 'ENOENT' ? reject(error) : resolve();
          })));
      } catch {
        const fallback = await this.machines.exec(id, `rm -f -- ${path}`, 10_000).catch(() => null);
        if (!fallback || fallback.code)
          throw new AppError('无法确认客户机临时 WireGuard 密钥文件已清理', 500);
      }
    }
  }
  /**
   * 入口 / Entry: WireGuardOverlay.start.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; signal: AbortSignal
   * 输出 / Returns: `this.machines.locked(`wireguard:${id}`, async () => { this.machines.requireUnlocked(id); if (this.machines.state(id) !== 'run…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async start(id: string, signal: AbortSignal) {
    /**
     * 入口 / Entry: WireGuardOverlay.start.callback@163.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ready: true, executed: false, config: { ...config, enabled: true }, status }`; `{ ready: true, executed: true, config: { ...config, enabled: true }, status: await this.guestStatus(id, signal) }`.
     * 副作用 / Effects: `writeStore`; `this.booted.set`; `this.install`; `lines.push`; `this.failures.delete`.
     * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `!config`; `status.active`; 异常 / errors `new AppError('请先启动客户机', 409)`; `new AppError('请先保存 WireGuard 覆盖网络配置', 409)`.
     */
    return this.machines.locked(`wireguard:${id}`, async () => {
      this.machines.requireUnlocked(id);
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动客户机', 409);
      const config = await this.config(id);
      if (!config) throw new AppError('请先保存 WireGuard 覆盖网络配置', 409);
      const secret = await this.requireSecrets().value(id, config.privateKeySecret);
      key.parse(secret);
      const expectedPublicKey = wireGuardPublicKey(secret);
      const status = await this.guestStatus(id, signal);
      if (status.active) {
        if (status.publicKey !== expectedPublicKey)
          throw new AppError('同名 WireGuard 接口不属于当前配置', 409);
        if (!config.enabled) await writeStore(this.file(id), { ...config, enabled: true });
        this.booted.set(id, this.machines.live.get(id)!);
        return { ready: true, executed: false, config: { ...config, enabled: true }, status };
      }
      await this.install(id, signal);
      const lines = ['[Interface]', `PrivateKey = ${secret}`, `ListenPort = ${config.listenPort}`];
      for (const peer of config.peers) lines.push('', '[Peer]', `PublicKey = ${peer.publicKey}`,
        `AllowedIPs = ${peer.allowedIPs.join(', ')}`,
        ...(peer.endpoint ? [`Endpoint = ${peer.endpoint}`] : []),
        ...(peer.keepaliveSeconds ? [`PersistentKeepalive = ${peer.keepaliveSeconds}`] : []));
      /**
       * 入口 / Entry: WireGuardOverlay.start.callback@185.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withGuestConfig）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withGuestConfig).
       * 输入 / Inputs: path
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.exec`.
       * 拒绝 / Refusals: 异常 / errors `new AppError(redactValues(String((error as Error).message || error), [secret]), 409)`.
       * 失败处理：catch 分支执行 `throw new AppError(redactValues(String((error as Error).message || error), [secret]), 409);`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `throw new AppError(redactValues(String((error as Error).message || error), [secret]), 409);`; these statements determine whether a failure is absorbed or rejected again.
       */
      await this.withGuestConfig(id, lines.join('\n') + '\n', signal, async (path) => {
        const routes = config.peers.flatMap((peer) => peer.allowedIPs);
        const command = `set -e\n` +
          `ip link add dev ${interfaceName} type wireguard\n` +
          `trap 'ip link del dev ${interfaceName} >/dev/null 2>&1 || true' EXIT\n` +
          `wg setconf ${interfaceName} ${path}\n` +
          `ip address add dev ${interfaceName} ${config.address}\n` +
          `ip link set up dev ${interfaceName}\n` +
          routes.map((range) => `ip ${isIP(range.split('/')[0]) === 6 ? '-6 ' : ''}route add ${range} dev ${interfaceName}`).join('\n') + '\n' +
          `trap - EXIT`;
        try { await this.exec(id, command, signal, 30_000); }
        catch (error) {
          throw new AppError(redactValues(String((error as Error).message || error), [secret]), 409);
        }
      });
      await writeStore(this.file(id), { ...config, enabled: true });
      this.booted.set(id, this.machines.live.get(id)!);
      this.failures.delete(id);
      return { ready: true, executed: true, config: { ...config, enabled: true },
        status: await this.guestStatus(id, signal) };
    });
  }
  /**
   * 入口 / Entry: WireGuardOverlay.action.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: true, executed: false, config: candidate }` / `{ ready: !!config && status.active, executed: false, config, status, lastAutoError: this.failures.get(id)?.reason }` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; this entry produces `{ ready: true, executed: false, config: candidate }` / `{ ready: !!config && status.active, executed: false, config, status, lastAutoError: this.failures.get(id)?.reason }` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `this.machines.get`, `wireGuardInput.parse`, `this.config`, `wireGuardConfigSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `wireGuardInput.parse`, `this.config`, `wireGuardConfigSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `action === 'check' && options.mode === 'save' && options.config`; `action === 'check' || options.mode === 'status'`; `options.mode === 'start'`.
   * 输入 / Inputs: id: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal
   * 输出 / Returns: `{ ready: true, executed: false, config: candidate }`; `{ ready: !!config && status.active, executed: false, config, status, lastAutoError: this.failures.get(id)?.reason }`; `this.machines.locked(`wireguard:${id}`, async () => { if (this.machines.state(id) === 'running' && (await this.guestStatus(id…`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `this.start`.
   * 拒绝 / Refusals: 条件 / conditions `options.mode === 'save'`; `!options.config`; `options.mode === 'generate-key'`; 异常 / errors `new AppError('请填写 WireGuard 配置', 400)`; `new AppError('请指定保存私钥的私密配置名称', 400)`.
   */
  async action(id: string, input: unknown, action: 'check' | 'run', signal: AbortSignal) {
    this.machines.get(id);
    const options = wireGuardInput.parse(input);
    const config = await this.config(id);
    if (action === 'check' && options.mode === 'save' && options.config) {
      const candidate = wireGuardConfigSchema.parse({ ...options.config, enabled: false });
      key.parse(await this.requireSecrets().value(id, candidate.privateKeySecret));
      return { ready: true, executed: false, config: candidate };
    }
    if (action === 'check' || options.mode === 'status') {
      const status = await this.guestStatus(id, signal);
      return { ready: !!config && status.active, executed: false, config, status,
        lastAutoError: this.failures.get(id)?.reason };
    }
    this.machines.requireUnlocked(id);
    if (options.mode === 'save') {
      if (!options.config) throw new AppError('请填写 WireGuard 配置', 400);
      /**
       * 入口 / Entry: WireGuardOverlay.action.callback@224.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ ready: true, executed: true, config: saved }`.
       * 副作用 / Effects: `writeStore`; `this.booted.delete`; `this.failures.delete`.
       * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) === 'running' && (await this.guestStatus(id, signal)).active`; 异常 / errors `new AppError('请先停止现有 WireGuard 接口，再修改配置', 409)`.
       */
      return this.machines.locked(`wireguard:${id}`, async () => {
        if (this.machines.state(id) === 'running' && (await this.guestStatus(id, signal)).active)
          throw new AppError('请先停止现有 WireGuard 接口，再修改配置', 409);
        key.parse(await this.requireSecrets().value(id, options.config!.privateKeySecret));
        const saved = wireGuardConfigSchema.parse({ ...options.config, enabled: false });
        await writeStore(this.file(id), saved);
        this.booted.delete(id);
        this.failures.delete(id);
        return { ready: true, executed: true, config: saved };
      });
    }
    if (options.mode === 'generate-key') {
      if (!options.secret) throw new AppError('请指定保存私钥的私密配置名称', 400);
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动客户机', 409);
      /**
       * 入口 / Entry: WireGuardOverlay.action.callback@238.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ ready: true, executed: true, secret: options.secret, publicKey: wireGuardPublicKey(secret) }`.
       * 副作用 / Effects: `this.install`; `this.exec`; `this.requireSecrets().save`.
       * 拒绝 / Refusals: 条件 / conditions `current?.privateKeySecret === options.secret && (await this.guestStatus(id, signal)).active`; 异常 / errors `new AppError('请先停止使用此密钥的 WireGuard 接口', 409)`.
       */
      return this.machines.locked(`wireguard:${id}`, async () => {
        const current = await this.config(id);
        if (current?.privateKeySecret === options.secret && (await this.guestStatus(id, signal)).active)
          throw new AppError('请先停止使用此密钥的 WireGuard 接口', 409);
        await this.install(id, signal);
        const secret = await this.exec(id, 'wg genkey', signal);
        key.parse(secret);
        await this.requireSecrets().save(id, { name: options.secret!, value: secret });
        return { ready: true, executed: true, secret: options.secret,
          publicKey: wireGuardPublicKey(secret) };
      });
    }
    if (options.mode === 'start') return this.start(id, signal);
    if (options.mode === 'stop') {
      /**
       * 入口 / Entry: WireGuardOverlay.action.callback@252.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ ready: true, executed: true, status: { active: false } }`.
       * 副作用 / Effects: `this.machines.exec`; `writeStore`; `this.booted.delete`; `this.failures.delete`.
       * 拒绝 / Refusals: 条件 / conditions `!current`; `this.machines.state(id) === 'running'`; `status.active`; 异常 / errors `new AppError('没有已保存的 WireGuard 配置', 409)`; `new AppError('同名 WireGuard 接口不属于当前配置', 409)`.
       */
      return this.machines.locked(`wireguard:${id}`, async () => {
        const current = await this.config(id);
        if (!current) throw new AppError('没有已保存的 WireGuard 配置', 409);
        if (this.machines.state(id) === 'running') {
          const status = await this.guestStatus(id, signal);
          if (status.active) {
            const secret = await this.requireSecrets().value(id, current.privateKeySecret);
            if (status.publicKey !== wireGuardPublicKey(secret))
              throw new AppError('同名 WireGuard 接口不属于当前配置', 409);
          }
          await this.machines.exec(id, `ip link del dev ${interfaceName} 2>/dev/null || true`, 15_000, signal);
        }
        await writeStore(this.file(id), { ...current, enabled: false });
        this.booted.delete(id);
        this.failures.delete(id);
        return { ready: true, executed: true, status: { active: false } };
      });
    }
    throw new AppError('未知 WireGuard 操作', 400);
  }
  /**
   * 入口 / Entry: WireGuardOverlay.tick.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`WireGuardOverlay`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `WireGuardOverlay`; this entry produces `void` for its caller. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `this.secrets`, `this.machines.records.keys`, `this.machines.state`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.secrets`, `this.machines.records.keys`, `this.machines.state`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || !this.secrets()`; `this.closed || this.abort.signal.aborted`; `this.machines.state(id) !== 'running'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.start`; `this.failures.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `this.failures.set(id, { at: Date.now(), reason: String((error as Error).message || error).slice(0, 500) });`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.failures.set(id, { at: Date.now(), reason: String((error as Error).message || error).slice(0, 500) });`; these statements determine whether a failure is absorbed or rejected again.
   */
  async tick() {
    if (this.closed || !this.secrets()) return;
    for (const id of this.machines.records.keys()) {
      if (this.closed || this.abort.signal.aborted) return;
      if (this.machines.state(id) !== 'running') continue;
      const live = this.machines.live.get(id);
      if (!live || this.booted.get(id) === live) continue;
      const failed = this.failures.get(id);
      if (failed && Date.now() - failed.at < 300_000) continue;
      try {
        if ((await this.config(id))?.enabled) await this.start(id, this.abort.signal);
      } catch (error) {
        this.failures.set(id, { at: Date.now(),
          reason: String((error as Error).message || error).slice(0, 500) });
      }
    }
  }
  /**
   * 入口 / Entry: WireGuardOverlay.close.
   * 功能：在校验并管理客户机 WireGuard 配置与动作中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`WireGuardOverlay`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `WireGuardOverlay`; the outcome is recorded in `this.closed`. Module context: Validates/owns guest WireGuard settings/actions, periodically checking tunnel state and private key references.
   * 处理：通过 `this.abort.abort`, `this.timer.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.abort.abort`, `this.timer.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.abort.abort`; `this.timer.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.abort.abort();
    await this.timer.close();
    await this.ticking;
  }
}
