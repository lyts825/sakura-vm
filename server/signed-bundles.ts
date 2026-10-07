/**
 * 模块职责：签名并验证实例包清单，管理受信任密钥及外部导入的显式授权范围。
 * Module purpose: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { readStore, writeStore } from './local-store.ts';
import { metadataPath, type PluginMetadata } from './plugin-metadata.ts';

export const bundleSignatureSchema = z
  .object({
    algorithm: z.literal('Ed25519'),
    publicKey: z.string().max(2000),
    value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export type BundleSignature = z.infer<typeof bundleSignatureSchema>;
const trustedKeySchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    publicKey: z.string().max(2000),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().min(0),
    requireTrustedOnImport: z.boolean(),
    privateKey: z.string().max(4000).optional(),
    trustedKeys: z.array(trustedKeySchema).max(32),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
export const signedBundleActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('configure'),
      revision: z.number().int().min(0),
      requireTrustedOnImport: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('trust'),
      revision: z.number().int().min(0),
      name: z.string().trim().min(1).max(64),
      publicKey: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal('forget'),
      revision: z.number().int().min(0),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export const signedBundleViewSchema = z
  .object({
    revision: z.number().int().min(0),
    requireTrustedOnImport: z.boolean(),
    localKey: trustedKeySchema.nullable(),
    trustedKeys: z.array(trustedKeySchema),
  })
  .strict();

/**
 * 入口 / Entry: canonical.
 * 功能：在签名并验证实例包清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``[${value.map(canonical).join(',')}]`` / ``{${Object.entries(value) .filter(([, item]) => item !== undefined) .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) .map(([…` 供上层消费（`signed-bundles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `signed-bundles.ts`; this entry produces ``[${value.map(canonical).join(',')}]`` / ``{${Object.entries(value) .filter(([, item]) => item !== undefined) .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) .map(([…` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
 * 处理：通过 `value.map().join`, `value.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.map().join`, `value.map`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `Array.isArray(value)`; `value && typeof value === 'object'`.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: string；结果来自 / values from ``[${value.map(canonical).join(',')}]``; ``{${Object.entries(value) .filter(([, item]) => item !== undefined) .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) .map(([…`; `JSON.stringify(value)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
/**
 * 入口 / Entry: payload.
 * 功能：把本层请求转交 `canonical`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `canonical` and propagates the provider result or rejection.
 * 输入 / Inputs: manifest: Record<string, unknown>
 * 输出 / Returns: `Buffer.from('SAKURA01:manifest-ed25519:v1\n' + canonical(manifest))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function payload(manifest: Record<string, unknown>) {
  return Buffer.from('SAKURA01:manifest-ed25519:v1\n' + canonical(manifest));
}
/**
 * 入口 / Entry: keyInfo.
 * 功能：在签名并验证实例包清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ key, publicKey, fingerprint }` 供上层消费（`signed-bundles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `signed-bundles.ts`; this entry produces `{ key, publicKey, fingerprint }` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
 * 处理：通过 `inline.test`, `createPublicKey`, `key.export().toString`, `key.export` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `createPublicKey`, `key.export().toString`, `key.export`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `{ key, publicKey, fingerprint }`.
 * 副作用 / Effects: `createPublicKey`; `createHash().update().digest`; `createHash().update`; `createHash`.
 * 拒绝 / Refusals: 条件 / conditions `!/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(text) || text.length > 2000`; `key.asymmetricKeyType !== 'ed25519'`; 异常 / errors `new Error('invalid PEM')`; `new Error('not Ed25519')`.
 * 失败处理：catch 分支执行 `throw new AppError('需要有效的 Ed25519 公钥');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('需要有效的 Ed25519 公钥');`; these statements determine whether a failure is absorbed or rejected again.
 */
function keyInfo(text: string) {
  try {
    if (
      !/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(text) ||
      text.length > 2000
    )
      throw new Error('invalid PEM');
    const key = createPublicKey(text);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
    const publicKey = key.export({ format: 'pem', type: 'spki' }).toString();
    const fingerprint = createHash('sha256')
      .update(key.export({ format: 'der', type: 'spki' }))
      .digest('hex');
    return { key, publicKey, fingerprint };
  } catch {
    throw new AppError('需要有效的 Ed25519 公钥');
  }
}
/**
 * 入口 / Entry: verifySignedManifest.
 * 功能：在签名并验证实例包清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `signer.fingerprint` 供上层消费（`signed-bundles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `signed-bundles.ts`; this entry produces `null` / `signer.fingerprint` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
 * 处理：通过 `keyInfo`, `bytes.toString`, `verify`, `payload` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `keyInfo`, `bytes.toString`, `verify`, `payload`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!manifest.signature`.
 * 输入 / Inputs: manifest: Record<string, unknown> & { signature?: BundleSignature }
 * 输出 / Returns: `null`; `signer.fingerprint`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `bytes.length !== 64 || bytes.toString('base64') !== signature.value || !verify(null, payload(unsigned), signer.key, bytes)`; 异常 / errors `new AppError('实例包签名无效')`.
 */
export function verifySignedManifest(manifest: Record<string, unknown> & { signature?: BundleSignature }) {
  if (!manifest.signature) return null;
  const { signature, ...unsigned } = manifest;
  const signer = keyInfo(signature.publicKey);
  const bytes = Buffer.from(signature.value, 'base64');
  if (
    bytes.length !== 64 ||
    bytes.toString('base64') !== signature.value ||
    !verify(null, payload(unsigned), signer.key, bytes)
  )
    throw new AppError('实例包签名无效');
  return signer.fingerprint;
}

/** A local trust store. Its private key is never included in API views or bundle manifests. */
export class SignedBundles {
  private state: State = { version: 1, revision: 0, requireTrustedOnImport: false, trustedKeys: [] };
  private pending: Promise<unknown> = Promise.resolve();
  private file: string;
  /**
   * 入口 / Entry: SignedBundles.constructor.
   * 功能：建立 SignedBundles 的签名并验证实例包清单上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SignedBundles context for this module's responsibility: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: string | PluginMetadata
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.file`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(file: string | PluginMetadata) { this.file = metadataPath(file); }
  /**
   * 入口 / Entry: SignedBundles.init.
   * 功能：在签名并验证实例包清单中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`SignedBundles`）。
   * Purpose: Initializes and verifies current domain state in `SignedBundles`; the outcome is recorded in `this.state`. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
   * 处理：通过 `stateSchema.parse`, `readStore`, `keyInfo`, `seen.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`, `keyInfo`, `seen.has`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `seen.add`; 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `info.fingerprint !== entry.fingerprint || info.publicKey !== entry.publicKey || seen.has(entry.fingerprint)`; `state.requireTrustedOnImport && (!local || !seen.has(local.fingerprint))`; 异常 / errors `new AppError('受信任实例包公钥记录损坏')`; `new AppError('签名实例包策略缺少受信任的本机密钥')`.
   */
  async init() {
    const state = stateSchema.parse(await readStore(this.file, () => this.state));
    const seen = new Set<string>();
    for (const entry of state.trustedKeys) {
      const info = keyInfo(entry.publicKey);
      if (
        info.fingerprint !== entry.fingerprint ||
        info.publicKey !== entry.publicKey ||
        seen.has(entry.fingerprint)
      )
        throw new AppError('受信任实例包公钥记录损坏');
      seen.add(entry.fingerprint);
    }
    const local = state.privateKey ? this.localKey(state.privateKey) : null;
    if (state.requireTrustedOnImport && (!local || !seen.has(local.fingerprint)))
      throw new AppError('签名实例包策略缺少受信任的本机密钥');
    this.state = state;
  }
  /**
   * 入口 / Entry: SignedBundles.localKey.
   * 功能：在签名并验证实例包清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `keyInfo(createPublicKey(key).export({ format: 'pem', type: 'spki' }).toString())` 供上层消费（`SignedBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SignedBundles`; this entry produces `keyInfo(createPublicKey(key).export({ format: 'pem', type: 'spki' }).toString())` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
   * 处理：通过 `createPrivateKey`, `keyInfo`, `createPublicKey().export().toString`, `createPublicKey().export` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createPrivateKey`, `keyInfo`, `createPublicKey().export().toString`, `createPublicKey().export`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: privateKey: string
   * 输出 / Returns: `keyInfo(createPublicKey(key).export({ format: 'pem', type: 'spki' }).toString())`.
   * 副作用 / Effects: `createPrivateKey`; `createPublicKey().export().toString`; `createPublicKey().export`; `createPublicKey`.
   * 拒绝 / Refusals: 条件 / conditions `key.asymmetricKeyType !== 'ed25519'`; 异常 / errors `new Error('not Ed25519')`; `new AppError('签名实例包本机私钥损坏')`.
   * 失败处理：catch 分支执行 `throw new AppError('签名实例包本机私钥损坏');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('签名实例包本机私钥损坏');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private localKey(privateKey: string) {
    try {
      const key = createPrivateKey(privateKey);
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
      return keyInfo(createPublicKey(key).export({ format: 'pem', type: 'spki' }).toString());
    } catch {
      throw new AppError('签名实例包本机私钥损坏');
    }
  }
  /**
   * 入口 / Entry: SignedBundles.view.
   * 功能：在签名并验证实例包清单中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `signedBundleViewSchema.parse({ revision: this.state.revision, requireTrustedOnImport: this.state.requireTrustedOnImport, loca…` 供上层消费（`SignedBundles`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SignedBundles`; this entry produces `signedBundleViewSchema.parse({ revision: this.state.revision, requireTrustedOnImport: this.state.requireTrustedOnImport, loca…` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
   * 处理：通过 `this.localKey`, `signedBundleViewSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.localKey`, `signedBundleViewSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `signedBundleViewSchema.parse({ revision: this.state.revision, requireTrustedOnImport: this.state.requireTrustedOnImport, loca…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view() {
    const local = this.state.privateKey ? this.localKey(this.state.privateKey) : null;
    return signedBundleViewSchema.parse({
      revision: this.state.revision,
      requireTrustedOnImport: this.state.requireTrustedOnImport,
      localKey: local && { name: '本机签名密钥', publicKey: local.publicKey, fingerprint: local.fingerprint },
      trustedKeys: this.state.trustedKeys,
    });
  }
  /**
   * 入口 / Entry: SignedBundles.signManifest.
   * 功能：在签名并验证实例包清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `manifest` / `{ ...manifest, signature: { algorithm: 'Ed25519', publicKey: local.publicKey, value: sign(null, payload(manifest), this.state…` 供上层消费（`SignedBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SignedBundles`; this entry produces `manifest` / `{ ...manifest, signature: { algorithm: 'Ed25519', publicKey: local.publicKey, value: sign(null, payload(manifest), this.state…` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
   * 处理：通过 `this.localKey`, `sign().toString`, `sign`, `payload` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.localKey`, `sign().toString`, `sign`, `payload`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.state.requireTrustedOnImport`.
   * 输入 / Inputs: manifest: T
   * 输出 / Returns: T & { signature?: BundleSignature }；结果来自 / values from `manifest`; `{ ...manifest, signature: { algorithm: 'Ed25519', publicKey: local.publicKey, value: sign(null, payload(manifest), this.state…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.state.privateKey`; 异常 / errors `new AppError('签名实例包本机私钥缺失')`.
   */
  signManifest<T extends Record<string, unknown>>(manifest: T): T & { signature?: BundleSignature } {
    if (!this.state.requireTrustedOnImport) return manifest;
    if (!this.state.privateKey) throw new AppError('签名实例包本机私钥缺失');
    const local = this.localKey(this.state.privateKey);
    return {
      ...manifest,
      signature: {
        algorithm: 'Ed25519',
        publicKey: local.publicKey,
        value: sign(null, payload(manifest), this.state.privateKey).toString('base64'),
      },
    };
  }
  /**
   * 入口 / Entry: SignedBundles.authorizeExternal.
   * 功能：在签名并验证实例包清单中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`SignedBundles`）。
   * Purpose: Checks admission, input or resource ownership in `SignedBundles`; this entry produces `void` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
   * 处理：通过 `keyInfo`, `this.state.trustedKeys.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `keyInfo`, `this.state.trustedKeys.some`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.state.requireTrustedOnImport`.
   * 输入 / Inputs: signature: BundleSignature optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!signature`; `!this.state.trustedKeys.some((entry) => entry.fingerprint === fingerprint)`; 异常 / errors `new AppError('当前策略要求受信任签名的实例包', 403)`; `new AppError('实例包签名公钥不受信任', 403)`.
   */
  authorizeExternal(signature?: BundleSignature) {
    if (!this.state.requireTrustedOnImport) return;
    if (!signature) throw new AppError('当前策略要求受信任签名的实例包', 403);
    const fingerprint = keyInfo(signature.publicKey).fingerprint;
    if (!this.state.trustedKeys.some((entry) => entry.fingerprint === fingerprint))
      throw new AppError('实例包签名公钥不受信任', 403);
  }
  /**
   * 入口 / Entry: SignedBundles.withAuthorizedExternal.
   * 功能：在签名并验证实例包清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `work` 供上层消费（`SignedBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SignedBundles`; this entry produces `work` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
   * 处理：通过 `this.pending.then`, `work.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.then`, `work.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: signature: BundleSignature | undefined; publish: () => Promise<T>
   * 输出 / Returns: `work`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  withAuthorizedExternal<T>(signature: BundleSignature | undefined, publish: () => Promise<T>) {
    const work = this.pending.then(async () => {
      this.authorizeExternal(signature);
      return publish();
    });
    this.pending = work.catch(() => {});
    return work;
  }
  /**
   * 入口 / Entry: SignedBundles.action.
   * 功能：在签名并验证实例包清单中，执行此领域的具体处理步骤并返回其结果；本入口产生 `work` 供上层消费（`SignedBundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SignedBundles`; this entry produces `work` for its caller. Module context: Signs/verifies bundle manifests and manages trusted keys plus explicit external-import authorization scope.
   * 处理：通过 `signedBundleActionSchema.parse`, `this.pending.then`, `work.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signedBundleActionSchema.parse`, `this.pending.then`, `work.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `work`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  action(input: unknown) {
    const request = signedBundleActionSchema.parse(input);
    /**
     * 入口 / Entry: SignedBundles.action.callback@192.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.pending.then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.pending.then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `next.trustedKeys.push`; `writeStore`; 更新 / updates `next.privateKey`, `next.requireTrustedOnImport`, `next.trustedKeys`, `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `request.revision !== this.state.revision`; `request.action === 'trust'`; `next.trustedKeys.some((item) => item.fingerprint === info.fingerprint)`; 异常 / errors `new AppError('签名策略已变化，请刷新后重试', 409)`; `new AppError('该签名公钥已受信任', 409)`.
     */
    const work = this.pending.then(async () => {
      if (request.revision !== this.state.revision) throw new AppError('签名策略已变化，请刷新后重试', 409);
      const next: State = {
        ...this.state,
        trustedKeys: [...this.state.trustedKeys],
        revision: this.state.revision + 1,
      };
      if (request.action === 'configure') {
        if (request.requireTrustedOnImport && !next.privateKey) {
          const keys = generateKeyPairSync('ed25519');
          next.privateKey = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
        }
        next.requireTrustedOnImport = request.requireTrustedOnImport;
        if (request.requireTrustedOnImport) {
          const local = this.localKey(next.privateKey!);
          if (!next.trustedKeys.some((item) => item.fingerprint === local.fingerprint))
            next.trustedKeys.push({
              name: '本机签名密钥',
              publicKey: local.publicKey,
              fingerprint: local.fingerprint,
            });
        }
      } else if (request.action === 'trust') {
        const info = keyInfo(request.publicKey);
        if (next.trustedKeys.some((item) => item.fingerprint === info.fingerprint))
          throw new AppError('该签名公钥已受信任', 409);
        next.trustedKeys.push({
          name: request.name,
          publicKey: info.publicKey,
          fingerprint: info.fingerprint,
        });
      } else {
        if (!next.trustedKeys.some((item) => item.fingerprint === request.fingerprint))
          throw new AppError('受信任公钥不存在', 404);
        const local = next.privateKey ? this.localKey(next.privateKey) : null;
        if (next.requireTrustedOnImport && local?.fingerprint === request.fingerprint)
          throw new AppError('启用签名策略时不能移除本机公钥', 409);
        next.trustedKeys = next.trustedKeys.filter((item) => item.fingerprint !== request.fingerprint);
      }
      if (next.trustedKeys.length > 32) throw new AppError('最多信任 32 个签名公钥');
      await writeStore(this.file, stateSchema.parse(next));
      this.state = next;
      return this.view();
    });
    this.pending = work.catch(() => {});
    return work;
  }
}
