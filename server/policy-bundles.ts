import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync,
  sign, verify } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectPermissionDocument, type ProjectPermissions } from './project-permissions.ts';

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

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function payload(value: z.infer<typeof unsignedBundle>) {
  return Buffer.from('SAKURA01:project-policy-ed25519:v1\n' + canonical(value));
}
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

  constructor(private permissions: ProjectPermissions,
    private file = join(DATA, 'policy-bundles.json')) {}

  async init() {
    let created = false;
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

  private localKey(state = this.ready()) {
    try {
      const privateKey = createPrivateKey(state.privateKey);
      if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
      return publicKeyInfo(createPublicKey(privateKey)
        .export({ format: 'pem', type: 'spki' }).toString());
    } catch { throw new AppError('本机项目策略签名密钥损坏', 503); }
  }
  private ready() {
    if (!this.state) throw new AppError('项目策略签名服务尚未启动', 503);
    return this.state;
  }
  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('项目策略签名服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  keys() {
    const state = this.ready();
    const local = this.localKey(state);
    return { revision: state.revision, localKey: { name: '本机策略包密钥',
      fingerprint: local.fingerprint, publicKey: local.publicKey },
      trustedKeys: state.trustedKeys };
  }

  action(input: unknown) {
    const request = policyBundleKeyAction.parse(input);
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

  apply(input: unknown) {
    const request = policyBundleApply.parse(input);
    return this.serial(async () => {
      const { bundle, signer } = verified(request.bundle);
      if (!this.ready().trustedKeys.some((entry) => entry.fingerprint === signer.fingerprint))
        throw new AppError('项目策略签名公钥不受信任', 403);
      const policy = await this.permissions.configure(request.target.vmId,
        request.target.projectId, bundle.policy, request.expectedVersion);
      return { signer: signer.fingerprint, source: bundle.source, policy };
    });
  }

  async close() { this.closed = true; await this.pending; }
}
