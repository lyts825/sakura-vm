/**
 * 模块职责：导出、验证并应用签名项目策略包，管理受信任 Ed25519 公钥和目标预览。
 * Module purpose: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
 */
import type { ProjectPermissionsV1 } from './service-contracts/v1.ts';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectPermissionDocument } from './project-permissions.ts';

const key = z.object({ name: z.string().trim().min(1).max(64),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  publicKey: z.string().max(2000) }).strict();
const signature = z.object({ algorithm: z.literal('Ed25519'),
  publicKey: z.string().max(2000),
  value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict();
const location = z.object({ vmId: z.uuid(), projectId: projectIdSchema }).strict();
const unsignedBundle = z.object({ format: z.literal('sakura-project-policy/v1'),
  source: location, policy: projectPermissionDocument }).strict();
export const policyBundleSchema = unsignedBundle.extend({ signature }).strict();
export const policyBundleTarget = location;
export const policyBundlePreview = z.object({ bundle: policyBundleSchema,
  target: location }).strict();
export const policyBundleApply = z.object({ bundle: policyBundleSchema,
  target: location, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const policyBundleKeyAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('trust'), revision: z.number().int().min(0),
    name: key.shape.name, publicKey: key.shape.publicKey }).strict(),
  z.object({ action: z.literal('forget'), revision: z.number().int().min(0),
    fingerprint: key.shape.fingerprint }).strict(),
]);
const stateSchema = z.object({ version: z.literal(1), revision: z.number().int().min(0),
  privateKey: z.string().max(4000), trustedKeys: z.array(key).max(32) }).strict();
type State = z.infer<typeof stateSchema>;
type Bundle = z.infer<typeof policyBundleSchema>;

/**
 * 入口 / Entry: canonical.
 * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``[${value.map(canonical).join(',')}]`` / ``{${Object.entries(value) .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) .map(([name, item]) => `${JSON.stringify(name)}:${c…` 供上层消费（`policy-bundles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `policy-bundles.ts`; this entry produces ``[${value.map(canonical).join(',')}]`` / ``{${Object.entries(value) .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) .map(([name, item]) => `${JSON.stringify(name)}:${c…` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
 * 处理：通过 `value.map().join`, `value.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.map().join`, `value.map`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `Array.isArray(value)`; `value && typeof value === 'object'`.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: string；结果来自 / values from ``[${value.map(canonical).join(',')}]``; ``{${Object.entries(value) .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) .map(([name, item]) => `${JSON.stringify(name)}:${c…`; `JSON.stringify(value)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
/**
 * 入口 / Entry: payload.
 * 功能：把本层请求转交 `canonical`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `canonical` and propagates the provider result or rejection.
 * 输入 / Inputs: value: z.infer<typeof unsignedBundle>
 * 输出 / Returns: `Buffer.from('SAKURA01:project-policy-ed25519:v1\n' + canonical(value))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function payload(value: z.infer<typeof unsignedBundle>) {
  return Buffer.from('SAKURA01:project-policy-ed25519:v1\n' + canonical(value));
}
/**
 * 入口 / Entry: publicKeyInfo.
 * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ parsed, publicKey, fingerprint }` 供上层消费（`policy-bundles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `policy-bundles.ts`; this entry produces `{ parsed, publicKey, fingerprint }` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
 * 处理：通过 `inline.test`, `createPublicKey`, `parsed.export().toString`, `parsed.export` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `createPublicKey`, `parsed.export().toString`, `parsed.export`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `{ parsed, publicKey, fingerprint }`.
 * 副作用 / Effects: `createPublicKey`; `createHash().update().digest`; `createHash().update`; `createHash`.
 * 拒绝 / Refusals: 条件 / conditions `!/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(text) || text.length > 2000`; `parsed.asymmetricKeyType !== 'ed25519'`; 异常 / errors `new Error('invalid PEM')`; `new Error('not Ed25519')`.
 * 失败处理：catch 分支执行 `throw new AppError('需要有效的 Ed25519 公钥');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('需要有效的 Ed25519 公钥');`; these statements determine whether a failure is absorbed or rejected again.
 */
function publicKeyInfo(text: string) {
  try {
    if (!/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(text) ||
        text.length > 2000) throw new Error('invalid PEM');
    const parsed = createPublicKey(text);
    if (parsed.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
    const publicKey = parsed.export({ format: 'pem', type: 'spki' }).toString();
    const fingerprint = createHash('sha256').update(
      parsed.export({ format: 'der', type: 'spki' })).digest('hex');
    return { parsed, publicKey, fingerprint };
  } catch { throw new AppError('需要有效的 Ed25519 公钥'); }
}
/**
 * 入口 / Entry: verified.
 * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ bundle, signer }` 供上层消费（`policy-bundles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `policy-bundles.ts`; this entry produces `{ bundle, signer }` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
 * 处理：通过 `policyBundleSchema.parse`, `publicKeyInfo`, `bytes.toString`, `verify` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `policyBundleSchema.parse`, `publicKeyInfo`, `bytes.toString`, `verify`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: input: unknown
 * 输出 / Returns: `{ bundle, signer }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `bytes.length !== 64 || bytes.toString('base64') !== signature.value || !verify(null, payload(unsigned), signer.parsed, bytes)`; 异常 / errors `new AppError('项目策略包签名无效')`.
 */
function verified(input: unknown) {
  const bundle = policyBundleSchema.parse(input);
  const signer = publicKeyInfo(bundle.signature.publicKey);
  const { signature, ...unsigned } = bundle;
  const bytes = Buffer.from(signature.value, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== signature.value ||
      !verify(null, payload(unsigned), signer.parsed, bytes))
    throw new AppError('项目策略包签名无效');
  return { bundle, signer };
}

/** Signs complete project permissions and applies only trusted, version-matched packages. */
export class PolicyBundles {
  private state?: State;
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;

  /**
   * 入口 / Entry: PolicyBundles.constructor.
   * 功能：建立 PolicyBundles 的导出、验证并应用签名项目策略包上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PolicyBundles context for this module's responsibility: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: permissions: ProjectPermissionsV1; file: default=join(DATA, 'policy-bundles.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private permissions: ProjectPermissionsV1,
    private file = join(DATA, 'policy-bundles.json')) {}

  /**
   * 入口 / Entry: PolicyBundles.init.
   * 功能：在导出、验证并应用签名项目策略包中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`PolicyBundles`）。
   * Purpose: Initializes and verifies current domain state in `PolicyBundles`; the outcome is recorded in `this.state`. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 处理：通过 `readStore`, `stateSchema.parse`, `this.localKey`, `publicKeyInfo` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `stateSchema.parse`, `this.localKey`, `publicKeyInfo`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `created`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `seen.add`; `writeStore`; 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `info.publicKey !== entry.publicKey || info.fingerprint !== entry.fingerprint || seen.has(entry.fingerprint)`; `!seen.has(local.fingerprint)`; 异常 / errors `new AppError('项目策略受信任公钥记录损坏', 503)`; `new AppError('本机项目策略签名密钥未受信任', 503)`.
   */
  async init() {
    let created = false;
    /**
     * 入口 / Entry: PolicyBundles.init.callback@91.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（readStore）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (readStore).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ version: 1 as const, revision: 0, privateKey, trustedKeys: [{ name: '本机策略包密钥', fingerprint: local.fingerprint, publicKey: l…`.
     * 副作用 / Effects: 更新 / updates `created`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const raw = await readStore(this.file, () => {
      created = true;
      const pair = generateKeyPairSync('ed25519');
      const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      const local = publicKeyInfo(pair.publicKey.export({ format: 'pem', type: 'spki' }).toString());
      return { version: 1 as const, revision: 0, privateKey,
        trustedKeys: [{ name: '本机策略包密钥', fingerprint: local.fingerprint,
          publicKey: local.publicKey }] };
    });
    const state = stateSchema.parse(raw);
    const local = this.localKey(state);
    const seen = new Set<string>();
    for (const entry of state.trustedKeys) {
      const info = publicKeyInfo(entry.publicKey);
      if (info.publicKey !== entry.publicKey || info.fingerprint !== entry.fingerprint ||
          seen.has(entry.fingerprint)) throw new AppError('项目策略受信任公钥记录损坏', 503);
      seen.add(entry.fingerprint);
    }
    if (!seen.has(local.fingerprint)) throw new AppError('本机项目策略签名密钥未受信任', 503);
    if (created) await writeStore(this.file, state);
    this.state = state;
  }

  /**
   * 入口 / Entry: PolicyBundles.localKey.
   * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `publicKeyInfo(createPublicKey(privateKey) .export({ format: 'pem', type: 'spki' }).toString())` 供上层消费（`PolicyBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PolicyBundles`; this entry produces `publicKeyInfo(createPublicKey(privateKey) .export({ format: 'pem', type: 'spki' }).toString())` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 处理：通过 `createPrivateKey`, `publicKeyInfo`, `createPublicKey().export().toString`, `createPublicKey().export` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createPrivateKey`, `publicKeyInfo`, `createPublicKey().export().toString`, `createPublicKey().export`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: state: default=this.ready()
   * 输出 / Returns: `publicKeyInfo(createPublicKey(privateKey) .export({ format: 'pem', type: 'spki' }).toString())`.
   * 副作用 / Effects: `createPrivateKey`; `createPublicKey().export().toString`; `createPublicKey().export`; `createPublicKey`.
   * 拒绝 / Refusals: 条件 / conditions `privateKey.asymmetricKeyType !== 'ed25519'`; 异常 / errors `new Error('not Ed25519')`; `new AppError('本机项目策略签名密钥损坏', 503)`.
   * 失败处理：catch 分支执行 `throw new AppError('本机项目策略签名密钥损坏', 503);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('本机项目策略签名密钥损坏', 503);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private localKey(state = this.ready()) {
    try {
      const privateKey = createPrivateKey(state.privateKey);
      if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
      return publicKeyInfo(createPublicKey(privateKey)
        .export({ format: 'pem', type: 'spki' }).toString());
    } catch { throw new AppError('本机项目策略签名密钥损坏', 503); }
  }
  /**
   * 入口 / Entry: PolicyBundles.ready.
   * 功能：在导出、验证并应用签名项目策略包中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.state` 供上层消费（`PolicyBundles`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `PolicyBundles`; this entry produces `this.state` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.state`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.state`; 异常 / errors `new AppError('项目策略签名服务尚未启动', 503)`.
   */
  private ready() {
    if (!this.state) throw new AppError('项目策略签名服务尚未启动', 503);
    return this.state;
  }
  /**
   * 入口 / Entry: PolicyBundles.serial.
   * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`PolicyBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PolicyBundles`; this entry produces `task` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 处理：通过 `this.pending.catch().then`, `this.pending.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.catch().then`, `this.pending.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('项目策略签名服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  /**
   * 入口 / Entry: PolicyBundles.keys.
   * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ revision: state.revision, localKey: { name: '本机策略包密钥', fingerprint: local.fingerprint, publicKey: local.publicKey }, truste…` 供上层消费（`PolicyBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PolicyBundles`; this entry produces `{ revision: state.revision, localKey: { name: '本机策略包密钥', fingerprint: local.fingerprint, publicKey: local.publicKey }, truste…` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 处理：通过 `this.ready`, `this.localKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ready`, `this.localKey`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ revision: state.revision, localKey: { name: '本机策略包密钥', fingerprint: local.fingerprint, publicKey: local.publicKey }, truste…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  keys() {
    const state = this.ready();
    const local = this.localKey(state);
    return { revision: state.revision, localKey: { name: '本机策略包密钥',
      fingerprint: local.fingerprint, publicKey: local.publicKey },
      trustedKeys: state.trustedKeys };
  }

  /**
   * 入口 / Entry: PolicyBundles.action.
   * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const current = this.ready(); if (request.revision !== current.revision) throw new AppError('受信任策略密…` 供上层消费（`PolicyBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PolicyBundles`; this entry produces `this.serial(async () => { const current = this.ready(); if (request.revision !== current.revision) throw new AppError('受信任策略密…` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 处理：通过 `policyBundleKeyAction.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `policyBundleKeyAction.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { const current = this.ready(); if (request.revision !== current.revision) throw new AppError('受信任策略密…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  action(input: unknown) {
    const request = policyBundleKeyAction.parse(input);
    /**
     * 入口 / Entry: PolicyBundles.action.callback@145.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.keys()`.
     * 副作用 / Effects: `next.trustedKeys.push`; `writeStore`; 更新 / updates `next.trustedKeys`, `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `request.revision !== current.revision`; `request.action === 'trust'`; `next.trustedKeys.some((entry) => entry.fingerprint === info.fingerprint)`; 异常 / errors `new AppError('受信任策略密钥已变化，请刷新后重试', 409)`; `new AppError('策略签名公钥已受信任', 409)`.
     */
    return this.serial(async () => {
      const current = this.ready();
      if (request.revision !== current.revision)
        throw new AppError('受信任策略密钥已变化，请刷新后重试', 409);
      const next: State = { ...current, revision: current.revision + 1,
        trustedKeys: [...current.trustedKeys] };
      if (request.action === 'trust') {
        const info = publicKeyInfo(request.publicKey);
        if (next.trustedKeys.some((entry) => entry.fingerprint === info.fingerprint))
          throw new AppError('策略签名公钥已受信任', 409);
        next.trustedKeys.push({ name: request.name, fingerprint: info.fingerprint,
          publicKey: info.publicKey });
      } else {
        if (request.fingerprint === this.localKey(current).fingerprint)
          throw new AppError('不能移除本机项目策略签名密钥', 409);
        if (!next.trustedKeys.some((entry) => entry.fingerprint === request.fingerprint))
          throw new AppError('受信任策略签名密钥不存在', 404);
        next.trustedKeys = next.trustedKeys.filter((entry) =>
          entry.fingerprint !== request.fingerprint);
      }
      if (next.trustedKeys.length > 32) throw new AppError('最多信任 32 个项目策略签名密钥');
      await writeStore(this.file, stateSchema.parse(next));
      this.state = next;
      return this.keys();
    });
  }

  /**
   * 入口 / Entry: PolicyBundles.export.
   * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...unsigned, signature: { algorithm: 'Ed25519', publicKey: this.localKey(state).publicKey, value: sign(null, payload(unsign…` 供上层消费（`PolicyBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PolicyBundles`; this entry produces `{ ...unsigned, signature: { algorithm: 'Ed25519', publicKey: this.localKey(state).publicKey, value: sign(null, payload(unsign…` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 处理：通过 `this.permissions.view`, `unsignedBundle.parse`, `this.ready`, `this.localKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.permissions.view`, `unsignedBundle.parse`, `this.ready`, `this.localKey`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: Promise<Bundle>；结果来自 / values from `{ ...unsigned, signature: { algorithm: 'Ed25519', publicKey: this.localKey(state).publicKey, value: sign(null, payload(unsign…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async export(vmId: string, projectId: string): Promise<Bundle> {
    const current = await this.permissions.view(vmId, projectId);
    const unsigned = unsignedBundle.parse({ format: 'sakura-project-policy/v1',
      source: { vmId, projectId }, policy: { roles: current.roles, grants: current.grants,
        approvalRequired: current.approvalRequired } });
    const state = this.ready();
    return { ...unsigned, signature: { algorithm: 'Ed25519',
      publicKey: this.localKey(state).publicKey,
      value: sign(null, payload(unsigned), state.privateKey).toString('base64') } };
  }

  /**
   * 入口 / Entry: PolicyBundles.preview.
   * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ source: bundle.source, target: destination, signer: signer.fingerprint, trusted: this.ready().trustedKeys.some((entry) => e…` 供上层消费（`PolicyBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PolicyBundles`; this entry produces `{ source: bundle.source, target: destination, signer: signer.fingerprint, trusted: this.ready().trustedKeys.some((entry) => e…` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 处理：通过 `verified`, `policyBundleTarget.parse`, `this.permissions.view`, `this.ready().trustedKeys.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `verified`, `policyBundleTarget.parse`, `this.permissions.view`, `this.ready().trustedKeys.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown; target: unknown
   * 输出 / Returns: `{ source: bundle.source, target: destination, signer: signer.fingerprint, trusted: this.ready().trustedKeys.some((entry) => e…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async preview(input: unknown, target: unknown) {
    const { bundle, signer } = verified(input);
    const destination = policyBundleTarget.parse(target);
    const current = await this.permissions.view(destination.vmId, destination.projectId);
    return { source: bundle.source, target: destination, signer: signer.fingerprint,
      trusted: this.ready().trustedKeys.some((entry) => entry.fingerprint === signer.fingerprint),
      expectedVersion: current.version,
      current: { roles: current.roles, grants: current.grants,
        approvalRequired: current.approvalRequired }, proposed: bundle.policy };
  }

  /**
   * 入口 / Entry: PolicyBundles.apply.
   * 功能：在导出、验证并应用签名项目策略包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const { bundle, signer } = verified(request.bundle); if (!this.ready().trustedKeys.some((entry) => …` 供上层消费（`PolicyBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PolicyBundles`; this entry produces `this.serial(async () => { const { bundle, signer } = verified(request.bundle); if (!this.ready().trustedKeys.some((entry) => …` for its caller. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 处理：通过 `policyBundleApply.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `policyBundleApply.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { const { bundle, signer } = verified(request.bundle); if (!this.ready().trustedKeys.some((entry) => …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  apply(input: unknown) {
    const request = policyBundleApply.parse(input);
    /**
     * 入口 / Entry: PolicyBundles.apply.callback@196.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ signer: signer.fingerprint, source: bundle.source, policy }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!this.ready().trustedKeys.some((entry) => entry.fingerprint === signer.fingerprint)`; 异常 / errors `new AppError('项目策略签名公钥不受信任', 403)`.
     */
    return this.serial(async () => {
      const { bundle, signer } = verified(request.bundle);
      if (!this.ready().trustedKeys.some((entry) => entry.fingerprint === signer.fingerprint))
        throw new AppError('项目策略签名公钥不受信任', 403);
      const policy = await this.permissions.configure(request.target.vmId,
        request.target.projectId, bundle.policy, request.expectedVersion);
      return { signer: signer.fingerprint, source: bundle.source, policy };
    });
  }

  /**
   * 入口 / Entry: PolicyBundles.close.
   * 功能：在导出、验证并应用签名项目策略包中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`PolicyBundles`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PolicyBundles`; the outcome is recorded in `this.closed`. Module context: Exports/verifies/applies signed project policy bundles with trusted Ed25519 keys and target previews.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  async close() { this.closed = true; await this.pending; }
}
