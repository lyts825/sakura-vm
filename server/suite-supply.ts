/** 供应审查各对象由独立插件实例持有，通过注入的版本服务取得材料。 */
import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { FilesV2 } from './service-contracts/files-v2.ts';
import { captureRequestSchema } from '../shared/contracts/files-capture.ts';
import * as S from '../shared/contracts/suite-common.ts';
import * as A from '../shared/contracts/supply-audit.ts';
import {
  SuiteStore,
  suiteActor,
  suiteHash,
  suiteSha,
  suiteCanonical,
  suiteFail,
  type SuiteAuthorize,
} from './suite-store.ts';
import { SuiteMaterials } from './suite-materials.ts';
import { computeSupply, readSuiteText } from './suite-compute.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import type { SupplyPoliciesV1, SupplyReviewsV1 } from './service-contracts/supply-audit.ts';

type Port = S.SuiteRecordsV1;
export type SupplyPorts = Readonly<Record<string, Port>>;
const scope = (input: S.SuiteScope) => ({ workspaceId: input.workspaceId });
const reference = (row: S.SuiteRecord): S.SuiteRef => ({
  domain: row.domain,
  id: row.id,
  revision: row.revision,
});
const pin = (s: S.SuiteScope, r: S.SuiteRef) => ({ ...s, id: r.id, revision: r.revision });
const json = (value: unknown): S.SuiteJson => S.suiteJson.parse(value);
const select = <K extends 'inventory' | 'dataset' | 'review'>(
  raw: unknown,
  key: K,
): S.SuiteScope & Record<K, S.SuiteRef> =>
  S.suiteScope
    .extend({ [key]: S.suiteRef })
    .strict()
    .parse(raw) as unknown as S.SuiteScope & Record<K, S.SuiteRef>;

export class SupplySources extends SuiteMaterials {
  constructor(
    meta: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    private files?: FilesV2,
  ) {
    super('supply-sources', meta, uploads, auth, 2 * 1024 ** 3, 64 * 1024 ** 2, ['text', 'json', 'csv']);
  }
  async upload(raw: z.input<typeof A.supplyUploadText>) {
    const input = A.supplyUploadText.parse(raw),
      bytes = Buffer.from(input.text, 'utf8');
    const upload = await this.beginUpload({
      ...scope(input),
      name: input.name,
      format: input.format,
      bytes: bytes.length,
      digest: suiteSha(bytes),
      allowExport: input.allowExport,
    });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await this.appendUpload({
        ...scope(input),
        id: upload.id,
        offset,
        data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.finishUpload({ ...scope(input), id: upload.id });
  }
  async pin(input: S.SuitePin) {
    const row = await this.get(input);
    if (row.state !== 'sealed') suiteFail('SUITE_INPUT_NOT_SEALED');
    return row;
  }
  async planCapture(raw: unknown) {
    const input = S.suiteScope
      .extend({ request: captureRequestSchema, allowExport: z.boolean().default(false) })
      .strict()
      .parse(raw);
    if (!this.files) suiteFail('SUITE_CAPTURE_UNAVAILABLE', '请启用文件插件或直接上传材料');
    const result = await this.files.planCapture({
      ...input.request,
      maxBytes: Math.min(input.request.maxBytes, 32 * 1024 ** 2),
    });
    return this.plan(
      scope(input),
      'capture',
      json({ token: result.token, files: result.files, allowExport: input.allowExport }),
      [],
    );
  }
  async capture(raw: S.SuiteApproval) {
    if (!this.files) suiteFail('SUITE_CAPTURE_UNAVAILABLE');
    const plan = await this.consume(raw, 'capture');
    if (plan.state === 'completed') suiteFail('SUITE_PLAN_CONSUMED', '捕获已完成，请查询本空间材料');
    const content = z
      .object({
        token: S.suiteId,
        files: z.array(
          z.object({ path: z.string(), sha256: S.suiteDigest, bytes: z.number().int().min(0) }).strict(),
        ),
        allowExport: z.boolean(),
      })
      .strict()
      .parse(plan.input);
    const receipt = await this.files.capture({ planToken: content.token }),
      results: S.SuiteRecord[] = [];
    try {
      for (const file of receipt.files) {
        if (
          !content.files.some(
            (p) => p.path === file.path && p.bytes === file.bytes && p.sha256 === file.sha256,
          )
        )
          suiteFail('SUITE_CAPTURE_CHANGED');
        const format = file.path.endsWith('.json') ? 'json' : file.path.endsWith('.csv') ? 'csv' : 'text';
        const upload = await this.beginUpload({
          workspaceId: plan.workspaceId,
          name: file.path,
          format,
          bytes: file.bytes,
          digest: file.sha256,
          allowExport: content.allowExport,
        });
        for (let offset = 0; offset < file.bytes;) {
          const part = await this.files.readCaptured(
            receipt.token,
            file.path,
            offset,
            Math.min(512 * 1024, file.bytes - offset),
          );
          const data = Buffer.from(part.data, 'base64');
          if (!data.length) suiteFail('SUITE_SHORT_READ');
          await this.appendUpload({ workspaceId: plan.workspaceId, id: upload.id, offset, data: part.data });
          offset += data.length;
        }
        results.push(await this.finishUpload({ workspaceId: plan.workspaceId, id: upload.id }));
      }
    } finally {
      await this.files.releaseCapture(receipt.token);
    }
    if (results.length) await this.complete(plan, results[0]);
    return results;
  }
}

export class SupplyInventory extends SuiteStore {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private sources: S.SuiteMaterialsV1,
  ) {
    super('supply-inventory', meta, auth, sources, { 'supply-sources': sources });
  }
  async parse(raw: z.infer<typeof A.supplyInput>) {
    const input = A.supplyInput.parse(raw),
      material = await this.fixed(scope(input), input.source);
    if (input.source.domain !== 'supply-sources') suiteFail('SUPPLY_SOURCE_REQUIRED');
    const result = await computeSupply('supply-inventory', 'inventory', () =>
      readSuiteText(this.sources, scope(input), input.source),
    );
    return this.put(
      {
        ...scope(input),
        name: material.name + ' · 组件清单',
        content: json(result),
        references: [input.source],
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof A.supplyCompare>) {
    const input = A.supplyCompare.parse(raw);
    const before = A.supplyInventory.parse((await this.fixed(scope(input), input.before)).content),
      after = A.supplyInventory.parse((await this.fixed(scope(input), input.after)).content);
    const previous = new Map(before.components.map((c) => [c.key, c])),
      next = new Map(after.components.map((c) => [c.key, c]));
    return this.put(
      {
        ...scope(input),
        name: '固定依赖差异',
        references: [input.before, input.after],
        content: json({
          added: after.components.filter((c) => !previous.has(c.key)),
          removed: before.components.filter((c) => !next.has(c.key)),
          beforeComplete: before.complete,
          afterComplete: after.complete,
          sourceCoverageChanged: suiteHash(before.warnings) !== suiteHash(after.warnings),
        }),
      },
      'result',
      true,
    );
  }
}
export class SupplyAdvisories extends SuiteStore {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private sources: S.SuiteMaterialsV1,
    inventory: Port,
  ) {
    super('supply-advisories', meta, auth, sources, {
      'supply-sources': sources,
      'supply-inventory': inventory,
    });
  }
  async importDataset(raw: z.infer<typeof A.supplyInput>) {
    const input = A.supplyInput.parse(raw);
    await this.fixed(scope(input), input.source);
    const dataset = A.supplyAdvisoryDataset.parse(
      await computeSupply('supply-advisories', 'dataset', () =>
        readSuiteText(this.sources, scope(input), input.source, 64 * 1024 ** 2),
      ),
    );
    return this.put(
      { ...scope(input), name: '固定公告快照', references: [input.source], content: json(dataset) },
      'result',
      true,
    );
  }
  async match(raw: z.infer<typeof A.supplyMatch>) {
    const input = A.supplyMatch.parse(raw);
    const inventory = await this.fixed(scope(input), input.inventory),
      dataset = await this.fixed(scope(input), input.dataset);
    const result = await computeSupply('supply-advisories', 'advisories', async () =>
      json({ inventory: inventory.content, dataset: dataset.content }),
    );
    return this.put(
      {
        ...scope(input),
        name: '公告匹配',
        references: [input.inventory, input.dataset],
        content: json(result),
      },
      'result',
      true,
    );
  }
  async freshness(raw: unknown) {
    const input = select(raw, 'dataset'),
      record = await this.fixed(scope(input), S.suiteRef.parse(input.dataset));
    const dataset = A.supplyAdvisoryDataset.parse(record.content);
    return {
      collectedAt: dataset.collectedAt,
      ageSeconds: Math.max(0, (Date.now() - Date.parse(dataset.collectedAt)) / 1000),
      sourceAuthenticated: false,
    };
  }
}
export class SupplyLicenses extends SuiteStore {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, sources: S.SuiteMaterialsV1, inventory: Port) {
    super('supply-licenses', meta, auth, sources, {
      'supply-sources': sources,
      'supply-inventory': inventory,
    });
  }
  async classify(raw: unknown) {
    const input = select(raw, 'inventory'),
      ref = S.suiteRef.parse(input.inventory),
      inventory = await this.fixed(scope(input), ref);
    const result = await computeSupply('supply-licenses', 'licenses', async () => inventory.content);
    return this.put(
      { ...scope(input), name: '许可证声明检查', references: [ref], content: json(result) },
      'result',
      true,
    );
  }
  async reviewExpression(raw: unknown) {
    const input = S.suiteScope
      .extend({
        inventory: S.suiteRef,
        expression: z.string().min(1).max(512),
        note: z.string().min(1).max(4000),
        acceptedForUse: z.boolean(),
      })
      .strict()
      .parse(raw);
    const inventory = A.supplyInventory.parse((await this.fixed(scope(input), input.inventory)).content);
    if (!inventory.components.some((c) => c.license === input.expression))
      suiteFail('SUPPLY_LICENSE_NOT_DECLARED');
    return this.put(
      {
        ...scope(input),
        name: '许可证用途人工意见',
        references: [input.inventory],
        content: json({
          expression: input.expression,
          note: input.note,
          acceptedForUse: input.acceptedForUse,
          actor: suiteActor(),
          legalConclusion: false,
        }),
      },
      'review',
      true,
    );
  }
}
export class SupplyProvenance extends SuiteStore {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private sources: S.SuiteMaterialsV1,
    inventory: Port,
  ) {
    super(
      'supply-provenance',
      meta,
      auth,
      sources,
      { 'supply-sources': sources, 'supply-inventory': inventory },
      A.supplyTrust,
    );
  }
  private normalizeTrust(content: S.SuiteJson, imported = false): S.SuiteJson {
    const trust = A.supplyTrust.parse(content),
      ids = new Set<string>();
    for (const publisher of trust.publishers) {
      if (ids.has(publisher.id)) suiteFail('SUPPLY_PUBLISHER_DUPLICATE');
      ids.add(publisher.id);
      const pem = publisher.publicKey.trim();
      if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----$/.test(pem))
        suiteFail('SUPPLY_PUBLIC_KEY_REQUIRED', '只接受 SPKI 公钥，不能保存私钥');
      try {
        const key = createPublicKey({ key: pem, format: 'pem', type: 'spki' });
        if (key.asymmetricKeyType !== 'ed25519') suiteFail('SUPPLY_SIGNATURE_ALGORITHM');
        publisher.publicKey = key.export({ type: 'spki', format: 'pem' }).toString();
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'SUPPLY_SIGNATURE_ALGORITHM')
          throw error;
        suiteFail('SUPPLY_PUBLIC_KEY_INVALID', '公钥格式无效');
      }
      if (imported) publisher.trusted = false;
    }
    return trust;
  }
  override async save(raw: S.SuiteSave) {
    if (!raw || !S.isSuiteJsonBounded(raw.content)) suiteFail('SUITE_CONTENT_LIMIT', '内容结构超出限制', 413);
    const input = S.suiteSave.parse(raw);
    return super.save({ ...input, content: this.normalizeTrust(input.content) });
  }
  override async importRecord(raw: Parameters<S.SuiteRecordsV1['importRecord']>[0]) {
    if (!raw || !S.isSuiteJsonBounded(raw.content))
      suiteFail('SUITE_CONTENT_LIMIT', '导入内容结构超出限制', 413);
    return super.importRecord({
      ...raw,
      content: raw.kind === 'definition' ? this.normalizeTrust(raw.content, true) : raw.content,
    });
  }
  async inspect(raw: unknown) {
    const input = select(raw, 'inventory'),
      ref = S.suiteRef.parse(input.inventory);
    A.supplyInventory.parse((await this.fixed(scope(input), ref)).content);
    return this.put(
      {
        ...scope(input),
        name: '来源证明检查',
        references: [ref],
        content: json({
          signatureValid: false,
          publisherTrusted: false,
          publisher: '',
          inventoryRevision: ref.revision,
          installedBytesVerified: false,
          reason: '没有提供已验证的来源证明',
        }),
      },
      'result',
      true,
    );
  }
  async verify(raw: z.infer<typeof A.supplyProvenanceInput>) {
    const input = A.supplyProvenanceInput.parse(raw);
    A.supplyInventory.parse((await this.fixed(scope(input), input.inventory)).content);
    const trust = A.supplyTrust.parse((await this.fixed(scope(input), input.trust)).content);
    await this.fixed(scope(input), input.proof);
    const proof = z
      .object({
        format: z.literal('sakura-supply-provenance/1'),
        publisher: z.string(),
        inventoryRevision: S.suiteDigest,
        signature: z.string().min(1).max(512),
      })
      .strict()
      .parse(
        parseSuiteJson(
          (await readSuiteText(this.sources, scope(input), input.proof, 1024 ** 2)).text,
          1024 ** 2,
        ),
      );
    if (proof.inventoryRevision !== input.inventory.revision) suiteFail('SUPPLY_PROOF_INPUT_CHANGED');
    const publisher = trust.publishers.find((p) => p.id === proof.publisher);
    let valid = false;
    if (publisher) {
      const publicKey = createPublicKey(publisher.publicKey);
      if (publicKey.asymmetricKeyType !== 'ed25519') suiteFail('SUPPLY_SIGNATURE_ALGORITHM');
      const signature = Buffer.from(proof.signature, 'base64');
      if (signature.toString('base64') !== proof.signature || signature.length !== 64)
        suiteFail('SUPPLY_SIGNATURE_FORMAT');
      valid = verify(
        null,
        Buffer.from(
          suiteCanonical({
            format: proof.format,
            publisher: proof.publisher,
            inventoryRevision: proof.inventoryRevision,
          }),
        ),
        publicKey,
        signature,
      );
    }
    return this.put(
      {
        ...scope(input),
        name: '来源签名核验',
        references: [input.inventory, input.proof, input.trust],
        content: json({
          signatureValid: valid,
          publisherTrusted: !!publisher?.trusted && valid,
          publisher: proof.publisher,
          inventoryRevision: proof.inventoryRevision,
          installedBytesVerified: false,
          reason: valid ? '签名仅认证该清单声明；未读取实际安装的软件字节' : '发布者缺席或签名无效',
        }),
      },
      'result',
      true,
    );
  }
}
export class SupplyPolicies extends SuiteStore {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, sources: S.SuiteMaterialsV1, peers: SupplyPorts) {
    super('supply-policies', meta, auth, sources, peers, A.supplyPolicy);
  }
  async evaluate(raw: z.infer<typeof A.supplyEvaluate>) {
    const input = A.supplyEvaluate.parse(raw),
      s = scope(input);
    const inventoryRecord = await this.fixed(s, input.inventory),
      matchingRecord = await this.fixed(s, input.matching),
      licenseRecord = await this.fixed(s, input.licenses),
      provenanceRecord = await this.fixed(s, input.provenance);
    const inventory = A.supplyInventory.parse(inventoryRecord.content),
      matching = A.supplyMatching.parse(matchingRecord.content),
      licenses = A.supplyLicenseResult.parse(licenseRecord.content),
      provenance = A.supplyProvenanceResult.parse(provenanceRecord.content);
    for (const record of [matchingRecord, licenseRecord, provenanceRecord])
      if (
        !record.references.some(
          (r) =>
            r.domain === input.inventory.domain &&
            r.id === input.inventory.id &&
            r.revision === input.inventory.revision,
        )
      )
        suiteFail('SUPPLY_EVIDENCE_MISMATCH');
    const policy = A.supplyPolicy.parse((await this.fixed(s, input.policy)).content);
    const componentKeys = new Set(inventory.components.map((c) => c.key));
    if (
      matching.evaluatedComponents !== inventory.components.length ||
      provenance.inventoryRevision !== input.inventory.revision ||
      licenses.components.length !== inventory.components.length ||
      new Set(licenses.components.map((c) => c.component)).size !== licenses.components.length ||
      licenses.components.some((c) => !componentKeys.has(c.component))
    )
      suiteFail('SUPPLY_EVIDENCE_MISMATCH');
    const severity = ['unknown', 'low', 'medium', 'high', 'critical'],
      findings: z.infer<typeof A.supplyFinding>[] = [];
    const add = (
      category: z.infer<typeof A.supplyFinding>['category'],
      component: string | null,
      message: string,
      sourceId: string,
      level: z.infer<typeof A.supplyFinding>['severity'] = 'unknown',
      status: 'blocked' | 'review' = policy.unknown === 'block' ? 'blocked' : 'review',
    ) => {
      findings.push({
        id: suiteHash([category, component, sourceId]),
        category,
        component,
        message,
        sourceId,
        severity: level,
        status,
      });
    };
    if (!inventory.complete)
      add('coverage', null, inventory.warnings.join('\n').slice(0, 4000), 'inventory-incomplete');
    if (Date.now() - Date.parse(matching.dataset.collectedAt) > policy.maxAgeDays * 86400000)
      add('freshness', null, '公告快照超过策略时效', 'dataset-expired');
    for (const match of matching.matches) {
      if (!componentKeys.has(match.component)) suiteFail('SUPPLY_EVIDENCE_MISMATCH');
      if (
        match.status === 'affected' &&
        (match.severity === 'unknown' || severity.indexOf(match.severity) >= severity.indexOf(policy.blockAt))
      )
        add('advisory', match.component, match.reason, match.advisory, match.severity, 'blocked');
      else if (match.status === 'unknown') add('coverage', match.component, match.reason, match.advisory);
    }
    for (const item of licenses.components)
      if (item.status !== 'declared' || !policy.allowedLicenses.includes(item.expression))
        add(
          'license',
          item.component,
          '许可证声明需要人工审阅或不在允许集合',
          item.expression || 'missing-license',
        );
    if (policy.requireTrustedProvenance && !provenance.publisherTrusted)
      add('provenance', null, provenance.reason, 'untrusted-provenance', 'unknown', 'blocked');
    const content = A.supplyEvaluation.parse({
      findings,
      policy,
      evaluatedAt: new Date().toISOString(),
      inventory: input.inventory,
      matching: input.matching,
      licenses: input.licenses,
      provenance: input.provenance,
      policyReference: input.policy,
      result: findings.some((f) => f.status === 'blocked')
        ? 'failed'
        : findings.length
          ? 'inconclusive'
          : 'passed',
      disclaimer: '结论仅适用于固定清单、公告和策略，不证明不存在漏洞、满足法律要求或实际安装字节可信。',
    });
    return this.put(
      {
        ...s,
        name: '供应审查策略结果',
        content: json(content),
        references: [input.inventory, input.matching, input.licenses, input.provenance, input.policy],
      },
      'result',
      true,
    );
  }
  async explain(raw: z.infer<typeof A.supplyExplanation>) {
    const p = A.supplyExplanation.parse(raw);
    return this.fixed(scope(p), p.reference);
  }
}
export class SupplyReviews extends SuiteStore {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, sources: S.SuiteMaterialsV1, policies: Port) {
    super('supply-reviews', meta, auth, sources, { 'supply-sources': sources, 'supply-policies': policies });
  }
  async open(raw: z.infer<typeof A.supplyReviewOpen>) {
    const input = A.supplyReviewOpen.parse(raw);
    A.supplyEvaluation.parse((await this.fixed(scope(input), input.evaluation)).content);
    return this.put(
      {
        ...scope(input),
        name: '供应审阅',
        references: [input.evaluation],
        content: json({
          evaluation: input.evaluation,
          status: 'open',
          note: '',
          exceptions: [],
          reviewer: '',
          reviewedAt: null,
        }),
      },
      'review',
      true,
    );
  }
  async decide(raw: z.infer<typeof A.supplyReviewDecision>) {
    const input = A.supplyReviewDecision.parse(raw),
      previous = await this.fixed(scope(input), input.review),
      review = A.supplyReview.parse(previous.content);
    if (review.status !== 'open') suiteFail('SUPPLY_REVIEW_ALREADY_DECIDED');
    const evaluation = A.supplyEvaluation.parse((await this.fixed(scope(input), review.evaluation)).content);
    const ids = new Set(input.exceptions.map((e) => e.findingId));
    if (
      ids.size !== input.exceptions.length ||
      input.exceptions.some(
        (e) =>
          !evaluation.findings.some((f) => f.id === e.findingId) ||
          Date.parse(e.expiresAt) <= Date.now() ||
          Date.parse(e.expiresAt) > Date.now() + 30 * 86400000,
      )
    )
      suiteFail('SUPPLY_EXCEPTION_INVALID');
    if (input.decision === 'accept' && evaluation.findings.some((f) => f.status !== 'info' && !ids.has(f.id)))
      suiteFail('SUPPLY_FINDINGS_UNRESOLVED');
    return this.put(
      {
        ...scope(input),
        id: previous.id,
        expectedRevision: previous.revision,
        name: previous.name,
        references: [review.evaluation, input.review],
        content: json({
          ...review,
          status: input.decision === 'accept' ? 'accepted' : 'rejected',
          note: input.note,
          exceptions: input.exceptions,
          reviewer: suiteActor(),
          reviewedAt: new Date().toISOString(),
        }),
      },
      'review',
      true,
    );
  }
  async recheck(raw: unknown) {
    const p = select(raw, 'review'),
      row = await this.fixed(scope(p), S.suiteRef.parse(p.review)),
      review = A.supplyReview.parse(row.content);
    const evaluation = A.supplyEvaluation.parse((await this.fixed(scope(p), review.evaluation)).content);
    const expired = review.exceptions
      .filter((e) => Date.parse(e.expiresAt) <= Date.now())
      .map((e) => e.findingId);
    const matching = A.supplyMatching.parse(
      (
        await (this.peers['supply-policies'] as Port & Pick<SupplyPoliciesV1, 'explain'>).explain({
          ...scope(p),
          reference: evaluation.matching,
        })
      ).content,
    );
    const snapshotExpired =
      Date.now() - Date.parse(matching.dataset.collectedAt) > evaluation.policy.maxAgeDays * 86400000;
    const freshnessWaived = evaluation.findings.some(
      (f) => f.category === 'freshness' && review.exceptions.some((e) => e.findingId === f.id),
    );
    const valid =
      review.status === 'accepted' &&
      !expired.length &&
      (!snapshotExpired || freshnessWaived) &&
      Date.now() - Date.parse(evaluation.evaluatedAt) <= evaluation.policy.maxAgeDays * 86400000;
    return { valid, expired, reviewer: review.reviewer, singleOwnerReview: true };
  }
}

export class SupplyReports extends SuiteStore {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, sources: S.SuiteMaterialsV1, peers: SupplyPorts) {
    super('supply-reports', meta, auth, sources, peers);
  }
  // 公共的 seal 同时保留固定对象封存能力，报告必须引用完整的评估和人工审阅。
  override async seal(raw: S.SuitePin | z.infer<typeof A.supplySeal>): Promise<S.SuiteRecord> {
    if ('id' in raw) return super.seal(S.suitePin.parse(raw));
    const p = A.supplySeal.parse(raw),
      s = scope(p);
    const evaluation = A.supplyEvaluation.parse((await this.fixed(s, p.evaluation)).content);
    const review = A.supplyReview.parse((await this.fixed(s, p.review)).content);
    if (
      suiteCanonical(review.evaluation) !== suiteCanonical(p.evaluation) ||
      review.status !== 'accepted' ||
      review.exceptions.some((e) => Date.parse(e.expiresAt) <= Date.now())
    )
      suiteFail('SUPPLY_REVIEW_REQUIRED');
    if (Date.now() - Date.parse(evaluation.evaluatedAt) > evaluation.policy.maxAgeDays * 86400000)
      suiteFail('SUPPLY_EVALUATION_EXPIRED');
    if (
      !(
        await (this.peers['supply-reviews'] as Port & Pick<SupplyReviewsV1, 'recheck'>).recheck({
          ...s,
          review: p.review,
        })
      ).valid
    )
      suiteFail('SUPPLY_EVALUATION_EXPIRED', '公告时效或用途例外已经变化，需要重新评估');
    const approved = new Set(review.exceptions.map((e) => e.findingId));
    if (evaluation.findings.some((f) => f.status !== 'info' && !approved.has(f.id)))
      suiteFail('SUPPLY_FINDINGS_UNRESOLVED');
    return this.put(
      {
        ...s,
        name: '软件供应审查档案',
        references: [p.evaluation, p.review],
        content: json({
          format: 'sakura-supply-report/1',
          evaluation,
          review,
          acceptedForUse: true,
          evaluationResult: evaluation.result,
          sealedAt: new Date().toISOString(),
          currentValidityMustBeRechecked: true,
          installedBytesVerified: false,
          sourceAuthenticated: false,
        }),
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof A.supplyCompare>) {
    const p = A.supplyCompare.parse(raw),
      before = await this.fixed(scope(p), p.before),
      after = await this.fixed(scope(p), p.after);
    const report = z
      .object({ format: z.literal('sakura-supply-report/1'), evaluation: A.supplyEvaluation })
      .passthrough();
    const a = report.parse(before.content).evaluation,
      b = report.parse(after.content).evaluation;
    const previous = new Set(a.findings.map((f) => f.id)),
      next = new Set(b.findings.map((f) => f.id));
    return this.put(
      {
        ...scope(p),
        name: '供应审查档案差异',
        references: [p.before, p.after],
        content: json({
          added: b.findings.filter((f) => !previous.has(f.id)),
          removed: a.findings.filter((f) => !next.has(f.id)),
          policyChanged: suiteHash(a.policy) !== suiteHash(b.policy),
          inputChanged: suiteCanonical(a.inventory) !== suiteCanonical(b.inventory),
          beforeResult: a.result,
          afterResult: b.result,
        }),
      },
      'result',
      true,
    );
  }
}

type WorkbenchDependencies = {
  sources: S.SuiteMaterialsV1 & Pick<SupplySources, 'upload'>;
  inventory: Port & Pick<SupplyInventory, 'parse'>;
  advisories: Port & Pick<SupplyAdvisories, 'importDataset' | 'match'>;
  licenses: Port & Pick<SupplyLicenses, 'classify'>;
  provenance: Port & Pick<SupplyProvenance, 'inspect'>;
  policies: Port & Pick<SupplyPolicies, 'evaluate'>;
  reviews: Port & Pick<SupplyReviews, 'open'>;
  reports: Port;
  exchange: Port;
};
export class SupplyWorkbench extends SuiteStore {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private deps: WorkbenchDependencies,
  ) {
    super(
      'supply-workbench',
      meta,
      auth,
      deps.sources,
      Object.fromEntries(Object.entries(deps).map(([name, value]) => ['supply-' + name, value])),
    );
  }
  async templates() {
    await this.access();
    return [
      { id: 'npm-lock', name: '前端锁文件审查', description: '固定组件、合成公告、许可证及人工例外' },
      { id: 'python-lock', name: 'Python 固定依赖', description: '精确版本与哈希；不支持的匹配明确保留未知' },
      { id: 'advisory-update', name: '公告更新比较', description: '相同锁文件在两个公告快照下重新评估' },
    ];
  }
  async createExample(raw: unknown) {
    const input = z
      .object({ name: S.suiteName, template: z.enum(['npm-lock', 'python-lock', 'advisory-update']) })
      .strict()
      .parse(raw);
    const workspace = await this.deps.sources.createWorkspace({ name: input.name }),
      s = { workspaceId: workspace.id };
    const sourceText =
      input.template === 'python-lock'
        ? 'demo==1.0.0 --hash=sha256:' + '0'.repeat(64)
        : JSON.stringify({
            lockfileVersion: 3,
            packages: {
              '': { dependencies: { demo: '1.0.0' } },
              'node_modules/demo': {
                version: '1.0.0',
                resolved: 'https://example.invalid/demo.tgz',
                integrity: 'sha512-' + Buffer.alloc(64).toString('base64'),
                license: 'MIT',
              },
            },
          });
    const source = await this.deps.sources.upload({
      ...s,
      name: '合成依赖清单',
      text: sourceText,
      format: input.template === 'python-lock' ? 'text' : 'json',
      allowExport: true,
    });
    const now = new Date().toISOString(),
      records = [
        {
          id: 'SYNTHETIC-1',
          ecosystem: input.template === 'python-lock' ? 'python' : 'npm',
          name: 'demo',
          ranges: [{ introduced: '0', fixed: '2.0.0' }],
          severity: 'high',
          issuedAt: now,
          modifiedAt: now,
          withdrawn: false,
          summary: '仅用于虚构样例的审查问题',
        },
      ];
    const dataset = {
      format: 'sakura-advisories/1',
      collectedAt: now,
      source: 'synthetic-fixture',
      records: input.template === 'advisory-update' ? [] : records,
    };
    const advisorySource = await this.deps.sources.upload({
      ...s,
      name: '合成公告快照',
      text: JSON.stringify(dataset),
      format: 'json',
      allowExport: true,
    });
    const updated =
      input.template === 'advisory-update'
        ? await this.deps.sources.upload({
            ...s,
            name: '更新的合成公告快照',
            text: JSON.stringify({ ...dataset, records }),
            format: 'json',
            allowExport: true,
          })
        : null;
    const policy = await this.deps.policies.save({
      ...s,
      name: '合成样例策略',
      content: {
        name: '明确审阅与例外',
        blockAt: 'high',
        maxAgeDays: 30,
        unknown: 'block',
        allowedLicenses: ['MIT'],
        requireTrustedProvenance: false,
      },
      references: [],
    });
    await this.deps.policies.seal(pin(s, reference(policy)));
    const example = await this.put(
      {
        ...s,
        name: input.name,
        content: json({
          template: input.template,
          source: reference(source),
          advisorySource: reference(advisorySource),
          updatedAdvisorySource: updated ? reference(updated) : null,
          policy: reference(policy),
          synthetic: true,
        }),
        references: [
          reference(source),
          reference(advisorySource),
          reference(policy),
          ...(updated ? [reference(updated)] : []),
        ],
      },
      'definition',
      true,
    );
    return { workspace, example };
  }
  async runChecks(raw: unknown) {
    const input = S.suiteScope
        .extend({ source: S.suiteRef, advisorySource: S.suiteRef, policy: S.suiteRef })
        .strict()
        .parse(raw),
      s = scope(input);
    await this.access(s);
    const inventory = await this.deps.inventory.parse({ ...s, source: input.source });
    const dataset = await this.deps.advisories.importDataset({ ...s, source: input.advisorySource });
    const matching = await this.deps.advisories.match({
      ...s,
      inventory: reference(inventory),
      dataset: reference(dataset),
    });
    const licenses = await this.deps.licenses.classify({ ...s, inventory: reference(inventory) });
    const provenance = await this.deps.provenance.inspect({ ...s, inventory: reference(inventory) });
    const evaluation = await this.deps.policies.evaluate({
      ...s,
      inventory: reference(inventory),
      matching: reference(matching),
      licenses: reference(licenses),
      provenance: reference(provenance),
      policy: input.policy,
    });
    const review = await this.deps.reviews.open({ ...s, evaluation: reference(evaluation) });
    const records = [inventory, dataset, matching, licenses, provenance, evaluation, review];
    const run = await this.put(
      {
        ...s,
        name: '供应审查步骤记录',
        content: json({
          evaluation: reference(evaluation),
          review: reference(review),
          results: records.map(reference),
          requiresManualReview: true,
        }),
        references: records.map(reference),
      },
      'result',
      true,
    );
    return { run, evaluation, review };
  }
  async view(raw: unknown) {
    const input = z.object({ workspaceId: S.suiteId.optional() }).strict().parse(raw);
    const workspaces = await this.deps.sources.listWorkspaces();
    if (!input.workspaceId) return { workspaces, workspace: null, capacity: null, domains: [] };
    const s = { workspaceId: input.workspaceId },
      workspace = await this.deps.sources.workspace(s);
    const domains: { id: string; records: S.SuiteRecord[]; error: string | null }[] = [];
    for (const [id, service] of Object.entries(this.peers)) {
      try {
        domains.push({ id, records: (await service.list({ ...s, limit: 10 })).items, error: null });
      } catch (error) {
        domains.push({ id, records: [], error: error instanceof Error ? error.message : '领域读取失败' });
      }
    }
    return { workspaces, workspace, capacity: await this.deps.sources.capacity(s), domains };
  }
}
