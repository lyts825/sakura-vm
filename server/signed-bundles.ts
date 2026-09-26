import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { z } from 'zod';
import { AppError } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

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
function payload(manifest: Record<string, unknown>) {
  return Buffer.from('SAKURA01:manifest-ed25519:v1\n' + canonical(manifest));
}
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
  constructor(private file: string) {}
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
  private localKey(privateKey: string) {
    try {
      const key = createPrivateKey(privateKey);
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
      return keyInfo(createPublicKey(key).export({ format: 'pem', type: 'spki' }).toString());
    } catch {
      throw new AppError('签名实例包本机私钥损坏');
    }
  }
  view() {
    const local = this.state.privateKey ? this.localKey(this.state.privateKey) : null;
    return signedBundleViewSchema.parse({
      revision: this.state.revision,
      requireTrustedOnImport: this.state.requireTrustedOnImport,
      localKey: local && { name: '本机签名密钥', publicKey: local.publicKey, fingerprint: local.fingerprint },
      trustedKeys: this.state.trustedKeys,
    });
  }
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
  authorizeExternal(signature?: BundleSignature) {
    if (!this.state.requireTrustedOnImport) return;
    if (!signature) throw new AppError('当前策略要求受信任签名的实例包', 403);
    const fingerprint = keyInfo(signature.publicKey).fingerprint;
    if (!this.state.trustedKeys.some((entry) => entry.fingerprint === fingerprint))
      throw new AppError('实例包签名公钥不受信任', 403);
  }
  withAuthorizedExternal<T>(signature: BundleSignature | undefined, publish: () => Promise<T>) {
    const work = this.pending.then(async () => {
      this.authorizeExternal(signature);
      return publish();
    });
    this.pending = work.catch(() => {});
    return work;
  }
  action(input: unknown) {
    const request = signedBundleActionSchema.parse(input);
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
