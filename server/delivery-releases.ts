/** 本地版本、通道和隔离交接；包内容本身不授予任何执行授权。 Local releases, CAS channels and quarantined handoff without executable authority. */
import { deliveryInputSchema } from '../shared/contracts/delivery-storage.ts';
import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  deliveryCandidateSchema,
  deliveryManifestSchema,
  deliveryDigestSchema,
  type DeliveryScope,
  type DeliveryCandidate,
} from '../shared/contracts/delivery-common.ts';
import {
  deliveryReleaseSchema,
  deliveryImportSchema,
  deliveryTrustKeySchema,
  deliveryEvidenceSchema,
  type DeliveryRelease,
  type DeliveryImport,
  type DeliveryTrustKey,
} from '../shared/contracts/delivery-quality.ts';
import type { DeliveryArtifactsV1, DeliveryInputsV1 } from './service-contracts/delivery-storage.ts';
import type { DeliveryRunnersV1, DeliveryPreviewsV1 } from './service-contracts/delivery-execution.ts';
import type { DeliveryReports } from './delivery-reports.ts';
import type { DeliveryGates } from './delivery-gates.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { DeliveryQualityStore, qualityHash } from './delivery-quality-store.ts';
import { deliveryCandidateDigest } from './delivery-candidate.ts';
import {
  writeDeliveryZip,
  readDeliveryZip,
  memoryZipEntry,
  artifactZipEntry,
  zipEntryBytes,
  zipEntryHash,
  importZipEntry,
  type DeliveryZipEntry,
} from './delivery-zip-stream.ts';
const channelSchema = z
  .object({
    name: z.enum(['candidate', 'stable']),
    revision: z.number().int().nonnegative(),
    releaseId: z.uuid().nullable(),
    history: z.array(z.object({ releaseId: z.uuid().nullable(), at: z.iso.datetime() })),
  })
  .strict();
const signatureSchema = z
  .object({ keyId: z.string().max(80), publisher: z.string().max(200), signature: z.string().max(256) })
  .strict();
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidates: z.array(deliveryCandidateSchema),
    releases: z.array(deliveryReleaseSchema),
    imports: z.array(deliveryImportSchema),
    keys: z.array(deliveryTrustKeySchema),
    trustRevision: z.number().int().nonnegative(),
    channels: z.array(channelSchema),
    signatures: z.record(z.string(), signatureSchema),
  })
  .strict();
const packageSchema = z
  .object({
    format: z.literal('sakura-delivery'),
    formatVersion: z.literal(1),
    purpose: z.literal('sakura-delivery'),
    releaseCoreDigest: deliveryDigestSchema,
    entries: z
      .array(
        z.object({ path: z.string(), sha256: deliveryDigestSchema, bytes: z.number().int().nonnegative() }),
      )
      .max(10000),
    signature: signatureSchema.optional(),
    publicKey: z.string().max(8192).optional(),
  })
  .strict();
/** 以 scope/reference 定位签名秘密，对 message 返回身份和 Base64 签名；提供者负责授权和秘密访问。 Resolve a signing secret by scope/reference and return identity plus a Base64 signature for message; the provider owns authorization and secret access. */
export type DeliverySigner = (
  scope: DeliveryScope,
  reference: string,
  message: Buffer,
) => Promise<{
  keyId: string;
  publisher: string;
  signature: string;
}>;
/** 从 release 选出稳定核心字段供摘要使用，不包含本地状态及包附件。 Select release core fields for hashing, excluding local lifecycle state and package attachments. */
function releaseCore(release: DeliveryRelease) {
  return {
    namespace: release.namespace,
    version: release.version,
    candidate: release.candidate,
    decision: release.decision,
    notes: release.notes,
    origin: release.origin,
    createdAt: release.createdAt,
  };
}
/** 将 manifest 的用途、核心、条目和公钥身份编码为签名字节，不读秘密。 Encode manifest purpose, core, entries and public-key identity as signing bytes without reading secrets. */
function signatureMessage(manifest: z.infer<typeof packageSchema>) {
  return Buffer.from(
    JSON.stringify({
      purpose: 'sakura-delivery',
      formatVersion: 1,
      releaseCoreDigest: manifest.releaseCoreDigest,
      manifestDigest: qualityHash(manifest.entries),
      keyId: manifest.signature?.keyId,
      publisher: manifest.signature?.publisher,
      publicKey: manifest.publicKey,
    }),
  );
}
export class DeliveryReleases {
  private store: DeliveryQualityStore<z.infer<typeof stateSchema>>;
  /** 绑定领域服务、受管 metadata/authorize 和可选 signer；不在构造时读写或签名。 Bind domain services, managed metadata/authorization and optional signer without constructor I/O or signing. */
  constructor(
    private artifacts: DeliveryArtifactsV1,
    private inputs: DeliveryInputsV1,
    private runners: DeliveryRunnersV1,
    private reports: Pick<DeliveryReports, 'get'>,
    private gates: Pick<DeliveryGates, 'assertCurrent'>,
    private previews: DeliveryPreviewsV1,
    metadata: PluginMetadata,
    private authorize: (scope: DeliveryScope) => void | Promise<void>,
    private signer?: DeliverySigner,
  ) {
    this.store = new DeliveryQualityStore(
      metadata,
      () => ({
        schemaVersion: 1,
        candidates: [],
        releases: [],
        imports: [],
        keys: [],
        trustRevision: 0,
        channels: [],
        signatures: {},
      }),
      authorize,
      (value) => stateSchema.parse(value),
    );
  }
  /** 返回 scope 的已校验版本、候选、隔离区和信任状态。 Return validated releases, candidates, quarantine and trust state for scope. */
  async view(scope: DeliveryScope) {
    return stateSchema.parse(await this.store.read(scope));
  }
  /** 返回 scope/id 对应的本机或已接受候选；隔离候选不可经此接口取得。 Return a local or accepted candidate for scope/id, excluding quarantined candidates. */
  async candidate(scope: DeliveryScope, id: string) {
    const state = await this.view(scope),
      candidate =
        state.candidates.find((c) => c.id === id) ??
        state.imports.find((i) => i.candidate.id === id && i.status === 'accepted')?.candidate;
    if (!candidate) throw new AppError('候选不存在或尚在隔离区', 404);
    return candidate;
  }
  /** 从 input 的服务端输入、运行和制品引用创建候选，保存后授予精确摘要的执行引用并返回候选。 Create a candidate from input's server-side snapshot/run/artifact references; persist before granting its exact-digest execution reference. */
  async createCandidate(
    scope: DeliveryScope,
    input: {
      inputId: string;
      runId: string;
      manifestId: string;
    },
  ) {
    const [snapshot, run, manifest] = await Promise.all([
      this.inputs.get(scope, input.inputId),
      this.runners.get(scope, input.runId),
      this.artifacts.get(scope, input.manifestId),
    ]);
    if (
      run.mode !== 'build' ||
      run.inputId !== snapshot.id ||
      run.inputDigest !== snapshot.digest ||
      run.state !== 'finished' ||
      !run.outputManifestIds.includes(manifest.id)
    )
      throw new AppError('候选输入、运行及制品不一致', 409);
    await this.artifacts.verify(scope, manifest.id);
    const raw = {
      id: randomUUID(),
      scope,
      inputId: snapshot.id,
      inputDigest: snapshot.digest,
      runId: run.id,
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      environment: snapshot.definition.environment,
      startup: snapshot.definition.startup,
      createdAt: new Date().toISOString(),
    };
    const candidate = deliveryCandidateSchema.parse({ ...raw, digest: deliveryCandidateDigest(raw) });
    await this.artifacts.retain(scope, manifest.id, 'candidate:' + candidate.id);
    await this.store.mutate(scope, (state) => {
      stateSchema.parse(state);
      state.candidates.push(candidate);
    });
    await this.artifacts.retain(scope, manifest.id, 'candidate:' + candidate.digest);
    return candidate;
  }
  /** required 为真时核验 scope 内 candidate 的新鲜健康预览及清理状态，否则直接返回；无写入。 When required, validate fresh preview and cleanup evidence for candidate in scope; otherwise return without writes. */
  private async previewEvidence(scope: DeliveryScope, candidate: DeliveryCandidate, required: boolean) {
    if (!required) return;
    const entries = (await this.previews.list(scope)).filter(
      (p) =>
        p.candidateDigest === candidate.digest &&
        p.manifestDigest === candidate.manifestDigest &&
        p.startupDigest === qualityHash(candidate.startup),
    );
    const current = entries.at(-1);
    if (
      !current ||
      !current.healthAt ||
      Date.parse(current.healthAt) < Date.now() - 5 * 60000 ||
      !(
        (current.state === 'healthy' && Date.parse(current.expiresAt) > Date.now()) ||
        (current.state === 'stopped' && current.cleanup === 'verified')
      )
    )
      throw new AppError('缺少最近五分钟内有效预览证据，或预览清理未确认', 409);
  }
  /** 按 input 绑定候选、当前判定和版本，复核运行/信任后保留制品并返回登记；重复相同核心幂等。 Bind input candidate, current decision and version; recheck execution/trust, retain artifacts and return registration, idempotently for identical cores. */
  async register(
    scope: DeliveryScope,
    input: {
      candidateId: string;
      decisionId: string;
      namespace: string;
      version: string;
      notes: string;
    },
  ) {
    const candidate = await this.candidate(scope, input.candidateId),
      { decision, policy } = await this.gates.assertCurrent(scope, input.decisionId, candidate.digest);
    await this.artifacts.verify(scope, candidate.manifestId);
    await this.previewEvidence(scope, candidate, policy.requirePreview);
    const run = decision.runId ? await this.runners.get(scope, decision.runId) : undefined;
    if (!run || run.state !== 'finished' || run.result !== 'success' || run.cleanup !== 'verified')
      throw new AppError('本次运行或清理尚未确认', 409);
    const raw = {
      id: randomUUID(),
      scope,
      namespace: input.namespace,
      version: input.version,
      candidate,
      decision,
      notes: input.notes,
      status: 'registered' as const,
      createdAt: new Date().toISOString(),
      origin: policy.kind === 'build' ? ('local-build' as const) : ('local-acceptance' as const),
    };
    const release = deliveryReleaseSchema.parse({ ...raw, releaseCoreDigest: '0'.repeat(64) });
    release.releaseCoreDigest = qualityHash(releaseCore(release));
    return this.store.mutate(scope, async (state) => {
      stateSchema.parse(state);
      const prior = state.releases.find(
        (r) => r.namespace === release.namespace && r.version === release.version,
      );
      if (prior) {
        if (
          prior.candidate.digest !== candidate.digest ||
          prior.notes !== input.notes ||
          prior.decision.digest !== decision.digest
        )
          throw new AppError('版本号已绑定不同核心内容', 409);
        return prior;
      }
      if (policy.requireTrusted && !(await this.currentTrust(scope, candidate, state)))
        throw new AppError('当前规则要求有效可信来源签名', 409);
      await this.artifacts.retain(scope, candidate.manifestId, 'release:' + release.id);
      state.releases.push(release);
      return release;
    });
  }
  /** 依据 state 的本机导入记录和当前公钥返回 candidate 是否仍可信；重新读取来源包。 Return whether candidate remains trusted under state import records and current keys, rereading its source package. */
  private async currentTrust(
    scope: DeliveryScope,
    candidate: DeliveryCandidate,
    state: z.infer<typeof stateSchema>,
  ) {
    const imported = state.imports.find((i) => i.candidate.id === candidate.id);
    if (!imported) return false;
    return this.importTrust(scope, imported, state).then((trust) => trust === 'trusted');
  }
  /** 按 input.expectedRevision 更新 scope 通道并追加历史；晋级时复核判定、制品、运行及信任，返回新通道。 Update the scoped channel using input.expectedRevision and append history; recheck evidence, artifacts, execution and trust before promotion. */
  async channel(
    scope: DeliveryScope,
    input: {
      name: 'candidate' | 'stable';
      expectedRevision: number;
      releaseId: string | null;
    },
  ) {
    return this.store.mutate(scope, async (state) => {
      stateSchema.parse(state);
      let channel = state.channels.find((c) => c.name === input.name);
      if (!channel) {
        channel = { name: input.name, revision: 0, releaseId: null, history: [] };
        state.channels.push(channel);
      }
      if (channel.revision !== input.expectedRevision) throw new AppError('通道已被更新，请刷新后重试', 409);
      if (input.releaseId) {
        const release = state.releases.find((r) => r.id === input.releaseId);
        if (!release || release.status !== 'registered') throw new AppError('版本不存在或已撤回归档', 409);
        const { decision, policy } = await this.gates.assertCurrent(
          scope,
          release.decision.id,
          release.candidate.digest,
        );
        if (input.name === 'stable' && decision.status !== 'passed')
          throw new AppError('正式通道拒绝豁免判定', 409);
        const run = decision.runId ? await this.runners.get(scope, decision.runId) : undefined;
        if (
          !run ||
          run.result !== 'success' ||
          run.state !== 'finished' ||
          run.cleanup !== 'verified' ||
          run.exitCode !== 0
        )
          throw new AppError('晋级前运行或清理状态已失效', 409);
        if (input.name === 'stable' && release.origin === 'local-build') {
          if (
            !release.candidate.inputId ||
            (await this.inputs.get(scope, release.candidate.inputId)).mode !== 'commit'
          )
            throw new AppError('正式通道默认要求固定提交输入', 409);
        }
        await this.artifacts.verify(scope, release.candidate.manifestId);
        await this.previewEvidence(scope, release.candidate, policy.requirePreview);
        if (
          policy.requireTrusted &&
          !(await this.currentTrust(scope, release.candidate, state)) &&
          !this.trustedSignature(state.signatures[release.id], state)
        )
          throw new AppError('签名未知、已撤销或尚未签名', 409);
      }
      channel.releaseId = input.releaseId;
      channel.revision++;
      channel.history.push({ releaseId: input.releaseId, at: new Date().toISOString() });
      return channel;
    });
  }
  /** 将 input.id 撤回或归档并保存原因，拒绝仍被通道指向的版本；保留制品引用并返回版本。 Withdraw/archive input.id with a reason, rejecting channel targets; retain artifact references and return the release. */
  async changeStatus(
    scope: DeliveryScope,
    input: {
      id: string;
      status: 'withdrawn' | 'archived';
      reason: string;
    },
  ) {
    if (input.reason.trim().length < 5) throw new AppError('请填写撤回或归档原因', 400);
    return this.store.mutate(scope, async (state) => {
      stateSchema.parse(state);
      const release = state.releases.find((r) => r.id === input.id);
      if (!release) throw new AppError('版本不存在', 404);
      if (state.channels.some((c) => c.releaseId === release.id))
        throw new AppError('请先移除指向此版本的通道', 409);
      release.status = input.status;
      release.reason = input.reason.slice(0, 2000);
      return release;
    });
  }
  /** 按 input.expectedRevision 登记或撤销 Ed25519 公钥，返回新信任版本和公钥；已有标识不可替换。 Register or revoke an Ed25519 key using input.expectedRevision and return updated trust revision/keys; existing identities cannot be replaced. */
  async trust(
    scope: DeliveryScope,
    input: {
      expectedRevision: number;
      id: string;
      publisher?: string;
      publicKey?: string;
      revoke?: boolean;
    },
  ) {
    return this.store.mutate(scope, (state) => {
      stateSchema.parse(state);
      if (state.trustRevision !== input.expectedRevision) throw new AppError('信任配置已变化', 409);
      const prior = state.keys.find((k) => k.id === input.id);
      if (input.revoke) {
        if (!prior) throw new AppError('交付公钥不存在', 404);
        prior.revoked = true;
      } else {
        if (prior) throw new AppError('公钥标识不可替换，请登记新标识', 409);
        const key = createPublicKey(input.publicKey ?? '');
        if (key.asymmetricKeyType !== 'ed25519') throw new AppError('仅支持 Ed25519 交付公钥', 400);
        state.keys.push(
          deliveryTrustKeySchema.parse({
            id: input.id,
            publisher: input.publisher,
            publicKey: key.export({ type: 'spki', format: 'pem' }).toString(),
            fingerprint: qualityHash(key.export({ type: 'spki', format: 'der' })),
            revoked: false,
          }),
        );
      }
      state.trustRevision++;
      return { revision: state.trustRevision, keys: state.keys };
    });
  }
  /** 根据 state 的当前身份与撤销标记返回已验证 signature 是否受信，不重新签名。 Check whether a previously verified signature remains trusted under current state identity/revocation flags without signing. */
  private trustedSignature(
    signature: z.infer<typeof signatureSchema> | undefined,
    state: z.infer<typeof stateSchema>,
  ) {
    return (
      !!signature &&
      state.keys.some((k) => k.id === signature.keyId && k.publisher === signature.publisher && !k.revoked)
    );
  }
  /** 核验 manifest 签名并按 keys 分类信任；未知公钥也必须通过数学验签，无效签名抛错。 Verify manifest signature and classify trust against keys; even unknown keys must verify cryptographically or throw. */
  private packageTrust(manifest: z.infer<typeof packageSchema>, keys: DeliveryTrustKey[]) {
    if (!manifest.signature) {
      if (manifest.publicKey) throw new AppError('无签名包不能携带孤立公钥', 400);
      return 'unsigned' as const;
    }
    if (!manifest.publicKey) throw new AppError('签名缺少校验公钥', 400);
    const embedded = createPublicKey(manifest.publicKey);
    if (
      embedded.asymmetricKeyType !== 'ed25519' ||
      !verifySignature(
        null,
        signatureMessage(manifest),
        embedded,
        Buffer.from(manifest.signature.signature, 'base64'),
      )
    )
      throw new AppError('交付签名无效', 400);
    const key = keys.find(
      (k) => k.id === manifest.signature!.keyId && k.publisher === manifest.signature!.publisher,
    );
    if (!key) return 'unknown' as const;
    if (key.fingerprint !== qualityHash(embedded.export({ type: 'spki', format: 'der' })))
      throw new AppError('签名公钥与登记身份冲突', 400);
    return key.revoked ? ('revoked' as const) : ('trusted' as const);
  }
  /**
   * 将 input 指定版本、原始证据和可选源码导出为封存 ZIP；返回包摘要、核心摘要和签名状态。
   * Export input's release, raw evidence and optional source as a sealed ZIP; return package/core digests and signature status.
   * 设计 / Design：临时保留制品后分块读取和写入；核心摘要独立于附件，结束时释放临时引用。
   * Retain artifacts temporarily before chunked I/O; keep the core digest independent of attachments and release temporary references on exit.
   */
  async export(
    scope: DeliveryScope,
    input: {
      id: string;
      includeSource: boolean;
      signingKeyRef?: string;
    },
  ) {
    const state = await this.view(scope),
      release = state.releases.find((r) => r.id === input.id);
    if (!release || release.status !== 'registered') throw new AppError('仅可导出已登记版本', 409);
    const manifest = await this.artifacts.get(scope, release.candidate.manifestId);
    await this.artifacts.verify(scope, manifest.id);
    const entries = new Map<string, DeliveryZipEntry>(),
      reference = 'export:' + randomUUID();
    await this.artifacts.retain(scope, manifest.id, reference);
    try {
      entries.set('release.json', memoryZipEntry('release.json', Buffer.from(JSON.stringify(release))));
      entries.set('artifacts.json', memoryZipEntry('artifacts.json', Buffer.from(JSON.stringify(manifest))));
      for (const file of manifest.files)
        entries.set(
          'artifacts/' + file.path,
          artifactZipEntry(this.artifacts, scope, 'artifacts/' + file.path, file),
        );
      const evidence = await Promise.all(
        release.decision.evidenceIds.map((id) => this.reports.get(scope, id)),
      );
      entries.set('evidence.json', memoryZipEntry('evidence.json', Buffer.from(JSON.stringify(evidence))));
      for (const item of evidence) {
        const source = await this.artifacts.get(scope, item.manifestId),
          file = source.files.find((f) => f.path === item.path);
        if (!file || file.sha256 !== item.rawDigest) throw new AppError('报告原始证据缺失', 409);
        entries.set(
          'reports/' + item.id,
          artifactZipEntry(this.artifacts, scope, 'reports/' + item.id, file),
        );
      }
      if (input.includeSource) {
        if (!release.candidate.inputId) throw new AppError('本地没有此版本的源码附件', 409);
        const snapshot = await this.inputs.get(scope, release.candidate.inputId),
          source = await this.artifacts.get(scope, snapshot.manifestId);
        await this.artifacts.verify(scope, source.id);
        entries.set('input.json', memoryZipEntry('input.json', Buffer.from(JSON.stringify(snapshot))));
        entries.set('source.json', memoryZipEntry('source.json', Buffer.from(JSON.stringify(source))));
        for (const file of source.files)
          entries.set(
            'source/' + file.path,
            artifactZipEntry(this.artifacts, scope, 'source/' + file.path, file),
          );
      }
      const envelope: z.infer<typeof packageSchema> = {
        format: 'sakura-delivery',
        formatVersion: 1,
        purpose: 'sakura-delivery',
        releaseCoreDigest: release.releaseCoreDigest,
        entries: await Promise.all(
          [...entries.values()].map(async (entry) => ({
            path: entry.path,
            sha256: await zipEntryHash(entry),
            bytes: entry.bytes,
          })),
        ),
      };
      if (input.signingKeyRef) {
        if (!this.signer) throw new AppError('签名需要已启用并授权的秘密提供者', 503);
        const key = state.keys.find((k) => k.id === input.signingKeyRef && !k.revoked);
        if (!key) throw new AppError('请先登记与秘密引用同标识的有效交付公钥', 409);
        envelope.publicKey = key.publicKey;
        envelope.signature = { keyId: key.id, publisher: key.publisher, signature: '' };
        const signature = signatureSchema.parse(
          await this.signer(scope, input.signingKeyRef, signatureMessage(envelope)),
        );
        if (signature.keyId !== key.id || signature.publisher !== key.publisher)
          throw new AppError('签名提供者身份不匹配', 409);
        envelope.signature = signature;
        if (this.packageTrust(envelope, state.keys) !== 'trusted')
          throw new AppError('签名公钥尚未登记为有效交付公钥', 409);
      }
      entries.set('delivery.json', memoryZipEntry('delivery.json', Buffer.from(JSON.stringify(envelope))));
      const file = await writeDeliveryZip(this.artifacts, scope, release.version + '.sakura-delivery.zip', [
        ...entries.values(),
      ]);
      const output = await this.artifacts.seal(scope, {
        label: '交付包 ' + release.version,
        kind: 'output',
        files: [file],
      });
      await this.artifacts.retain(scope, output.id, 'exported-release:' + release.id);
      if (envelope.signature)
        await this.store.mutate(scope, (current) => {
          stateSchema.parse(current);
          if (this.packageTrust(envelope, current.keys) !== 'trusted')
            throw new AppError('签名公钥在导出期间已撤销', 409);
          current.signatures[release.id] = envelope.signature!;
        });
      return {
        manifest: output,
        packageDigest: file.sha256,
        releaseCoreDigest: release.releaseCoreDigest,
        signed: !!envelope.signature,
      };
    } finally {
      await this.artifacts.release(scope, manifest.id, reference);
    }
  }
  /** 分块校验 scope/manifestId 的 ZIP、摘要及证据关联，返回惰性条目和解析元数据；不发布导入记录。 Validate ZIP structure, hashes and evidence links for scope/manifestId; return lazy entries and metadata without publishing an import. */
  private async readPackage(scope: DeliveryScope, manifestId: string) {
    const manifest = await this.artifacts.get(scope, manifestId);
    if (manifest.files.length !== 1) throw new AppError('导入必须选择单个交付 ZIP', 400);
    await this.artifacts.verify(scope, manifestId);
    const packageDigest = manifest.files[0].sha256,
      entries = await readDeliveryZip(this.artifacts, scope, manifest.files[0]);
    const envelope = packageSchema.parse(
      JSON.parse((await zipEntryBytes(entries.get('delivery.json'), 4 * 1024 * 1024)).toString('utf8')),
    );
    if (
      envelope.entries.length !== entries.size - 1 ||
      new Set(envelope.entries.map((e) => e.path)).size !== envelope.entries.length
    )
      throw new AppError('交付包条目不一致', 400);
    for (const item of envelope.entries) {
      const content = entries.get(item.path);
      if (
        item.path === 'delivery.json' ||
        !content ||
        content.bytes !== item.bytes ||
        (await zipEntryHash(content)) !== item.sha256
      )
        throw new AppError('交付条目摘要不匹配', 400);
    }
    const json = async (path: string) =>
      JSON.parse((await zipEntryBytes(entries.get(path), 8 * 1024 * 1024)).toString('utf8'));
    const release = deliveryReleaseSchema.parse(await json('release.json')),
      artifacts = deliveryManifestSchema.parse(await json('artifacts.json')),
      evidence = z
        .array(deliveryEvidenceSchema)
        .max(100)
        .parse(await json('evidence.json'));
    if (
      qualityHash(releaseCore(release)) !== release.releaseCoreDigest ||
      release.releaseCoreDigest !== envelope.releaseCoreDigest ||
      release.candidate.manifestDigest !== artifacts.digest ||
      qualityHash(artifacts.files) !== artifacts.digest ||
      deliveryCandidateDigest(release.candidate) !== release.candidate.digest
    )
      throw new AppError('交付核心或候选摘要不匹配', 400);
    for (const file of artifacts.files) {
      const content = entries.get('artifacts/' + file.path);
      if (!content || content.bytes !== file.bytes || (await zipEntryHash(content)) !== file.sha256)
        throw new AppError('制品清单摘要不匹配', 400);
    }
    for (const report of evidence) {
      const content = entries.get('reports/' + report.id),
        { digest, ...raw } = report;
      if (
        qualityHash(raw) !== digest ||
        report.candidateDigest !== release.candidate.digest ||
        !content ||
        (await zipEntryHash(content)) !== report.rawDigest
      )
        throw new AppError('报告证据摘要不匹配', 400);
    }
    if (
      evidence.length !== release.decision.evidenceIds.length ||
      evidence.some(
        (e) => release.decision.evidenceDigests[release.decision.evidenceIds.indexOf(e.id)] !== e.digest,
      )
    )
      throw new AppError('判定报告身份不一致', 400);
    const allowed = new Set([
      'delivery.json',
      'release.json',
      'artifacts.json',
      'evidence.json',
      ...artifacts.files.map((file) => 'artifacts/' + file.path),
      ...evidence.map((item) => 'reports/' + item.id),
    ]);
    if (entries.has('source.json')) {
      const source = deliveryManifestSchema.parse(await json('source.json')),
        input = deliveryInputSchema.parse(await json('input.json'));
      const content = {
        scope: input.scope,
        manifestId: input.manifestId,
        manifestDigest: input.manifestDigest,
        definition: input.definition,
        projectVersion: input.projectVersion,
        mode: input.mode,
        ...(input.commit ? { commit: input.commit } : {}),
        environmentEvidence: input.environmentEvidence,
      };
      if (
        qualityHash(source.files) !== source.digest ||
        input.manifestDigest !== source.digest ||
        input.manifestId !== source.id ||
        qualityHash(content) !== input.digest ||
        input.digest !== release.candidate.inputDigest
      )
        throw new AppError('源码附件与固定输入不匹配', 400);
      allowed.add('source.json');
      allowed.add('input.json');
      for (const file of source.files) {
        const path = 'source/' + file.path,
          entry = entries.get(path);
        if (!entry || entry.bytes !== file.bytes || (await zipEntryHash(entry)) !== file.sha256)
          throw new AppError('源码附件摘要不匹配', 400);
        allowed.add(path);
      }
    }
    if ([...entries.keys()].some((path) => !allowed.has(path)))
      throw new AppError('交付包含未声明的格式条目', 400);
    return { packageDigest, entries, envelope, release, artifacts };
  }
  /**
   * 校验 input.manifestId 后以本机新标识保存隔离记录和制品引用，返回记录；同包导入幂等。
   * Validate input.manifestId, persist quarantine with fresh local IDs and artifact references, then return it; identical packages are idempotent.
   * 设计 / Design：全部格式及证据验证完成后才写入；外部标识只作来源信息，隔离状态不授予执行引用。
   * Complete format/evidence validation before writes; external IDs remain provenance and quarantine grants no execution reference.
   */
  async importPackage(
    scope: DeliveryScope,
    input: {
      manifestId: string;
    },
  ) {
    const parsed = await this.readPackage(scope, input.manifestId),
      packageDigest = parsed.packageDigest;
    return this.store.mutate(scope, async (state) => {
      stateSchema.parse(state);
      const prior = state.imports.find((i) => i.packageDigest === packageDigest);
      if (prior) return prior;
      if (
        state.imports.some(
          (i) =>
            i.namespace === parsed.release.namespace &&
            i.version === parsed.release.version &&
            i.releaseCoreDigest !== parsed.release.releaseCoreDigest,
        )
      )
        throw new AppError('相同来源版本包含不同交付核心', 409);
      const trust = this.packageTrust(parsed.envelope, state.keys),
        files = [];
      for (const file of parsed.artifacts.files)
        files.push(
          await importZipEntry(
            this.artifacts,
            scope,
            parsed.entries.get('artifacts/' + file.path)!,
            file.path,
            file.mode,
          ),
        );
      const manifest = await this.artifacts.seal(scope, {
        label: '隔离导入 ' + parsed.release.version,
        kind: 'import',
        files,
      });
      const raw = {
        id: randomUUID(),
        scope,
        inputDigest: parsed.release.candidate.inputDigest,
        manifestId: manifest.id,
        manifestDigest: manifest.digest,
        environment: parsed.release.candidate.environment,
        startup: parsed.release.candidate.startup,
        origin: {
          namespace: parsed.release.namespace,
          version: parsed.release.version,
          releaseCoreDigest: parsed.release.releaseCoreDigest,
        },
        createdAt: new Date().toISOString(),
      };
      const candidate = deliveryCandidateSchema.parse({ ...raw, digest: deliveryCandidateDigest(raw) }),
        record = deliveryImportSchema.parse({
          id: randomUUID(),
          scope,
          packageDigest,
          releaseCoreDigest: parsed.release.releaseCoreDigest,
          namespace: parsed.release.namespace,
          version: parsed.release.version,
          status: 'quarantined',
          trust,
          candidate,
          sourceCandidateId: parsed.release.candidate.id,
          sourceRunId: parsed.release.candidate.runId,
          manifestId: input.manifestId,
          createdAt: new Date().toISOString(),
        });
      await this.artifacts.retain(scope, manifest.id, 'import:' + record.id);
      await this.artifacts.retain(scope, input.manifestId, 'import-package:' + record.id);
      state.imports.push(record);
      return record;
    });
  }
  /** 重读 record 的原包并核对摘要，按 state 当前公钥返回信任分类；不改变接受状态。 Reread record's package, verify its digest and return trust under state keys without changing acceptance. */
  private async importTrust(
    scope: DeliveryScope,
    record: DeliveryImport,
    state: z.infer<typeof stateSchema>,
  ) {
    const parsed = await this.readPackage(scope, record.manifestId);
    if (parsed.packageDigest !== record.packageDigest) throw new AppError('隔离包已改变', 409);
    return this.packageTrust(parsed.envelope, state.keys);
  }
  /** 复核 input 审阅、命名空间和信任，先保存接受记录再授予精确候选执行引用；引用写入失败可重试。 Recheck input review, namespace and trust; persist acceptance before granting the exact candidate execution reference, allowing retries after reference failure. */
  async acceptImport(
    scope: DeliveryScope,
    input: {
      id: string;
      namespace: string;
      allowUntrusted: boolean;
      reviewed: true;
    },
  ) {
    const accepted = await this.store.mutate(scope, async (state) => {
      stateSchema.parse(state);
      const record = state.imports.find((i) => i.id === input.id);
      if (!record) throw new AppError('隔离导入不存在', 404);
      if (!input.reviewed || input.namespace !== record.namespace)
        throw new AppError('请明确审阅并绑定来源命名空间', 409);
      const trust = await this.importTrust(scope, record, state);
      if (trust !== 'trusted' && !input.allowUntrusted)
        throw new AppError('来源未受信任，需明确允许无信任接收', 409);
      record.trust = trust;
      record.status = 'accepted';
      return record;
    });
    await this.artifacts.retain(
      scope,
      accepted.candidate.manifestId,
      'accepted-import:' + accepted.candidate.digest,
    );
    return accepted;
  }
}
