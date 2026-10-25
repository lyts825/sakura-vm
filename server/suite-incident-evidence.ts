/** 证据、派生字节和人工审阅由原证据插件持有。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as I from '../shared/contracts/incident-desk.ts';
import * as M from '../shared/contracts/incident-materials.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteMaterials } from './suite-materials.ts';
import {
  suiteActor,
  suiteBinding,
  suiteFail,
  suiteHash,
  suiteSha,
  type SuiteAuthorize,
  type SuiteState,
} from './suite-store.ts';
import { computeIncident, readSuiteText } from './suite-compute.ts';
import type { IncidentRedactionOutput } from './suite-incident-redaction.ts';
import type { IncidentCasesV1, IncidentEvidenceV1 } from './service-contracts/incident-desk.ts';
const scope = (input: S.SuiteScope) => ({ workspaceId: input.workspaceId });
const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
const json = (value: unknown) => S.suiteJson.parse(value);
export class IncidentEvidence extends SuiteMaterials implements IncidentEvidenceV1 {
  protected evidenceLimit = 500;
  constructor(
    metadata: PluginMetadata,
    uploads: PluginMetadata,
    authorize: SuiteAuthorize,
    private cases: IncidentCasesV1,
  ) {
    super(
      'incident-evidence',
      metadata,
      uploads,
      authorize,
      4 * 1024 ** 3,
      32 * 1024 ** 2,
      ['text', 'json'],
      cases,
    );
    this.peers = { 'incident-cases': cases };
  }
  protected override validateState(state: SuiteState, priorBytes = 0): void {
    super.validateState(state, priorBytes);
    const groups = new Map<string, Set<string>>();
    for (const row of state.rows) {
      if (
        row.kind !== 'result' ||
        row.origin !== 'local' ||
        !row.content ||
        typeof row.content !== 'object' ||
        Array.isArray(row.content) ||
        row.content.format !== 'sakura-incident-evidence/1'
      )
        continue;
      const key = row.workspaceId + ':' + row.actor,
        ids = groups.get(key) ?? new Set<string>();
      ids.add(row.id);
      groups.set(key, ids);
      if (ids.size > this.evidenceLimit) suiteFail('INCIDENT_EVIDENCE_LIMIT', '本机案例材料数量超过上限');
    }
  }
  async upload(raw: z.input<typeof I.incidentUpload>): Promise<S.SuiteRecord> {
    const input = I.incidentUpload.parse(raw);
    if (I.incidentCase.parse((await this.cases.scope(scope(input))).content).status !== 'open')
      suiteFail('INCIDENT_CASE_NOT_OPEN', '先重新打开案例再收集新材料');
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input.text))
      suiteFail('INCIDENT_UNICODE', '文本包含无效 Unicode');
    const data = Buffer.from(input.text, 'utf8');
    if (data.length > 1024 ** 2) suiteFail('INCIDENT_TEXT_LIMIT', '控制请求中的文本最多 1 MiB');
    const source = await this.textSource(
      scope(input),
      input.name,
      input.text,
      input.format,
      input.allowExport,
      [],
    );
    return this.attach({ ...scope(input), source: ref(source), sourceAt: input.sourceAt });
  }
  private async textSource(
    s: S.SuiteScope,
    name: string,
    text: string,
    format: 'text' | 'json',
    allowExport: boolean,
    lineage: S.SuiteRef[],
  ) {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))
      suiteFail('INCIDENT_UNICODE');
    const data = Buffer.from(text, 'utf8');
    if (data.length > 32 * 1024 ** 2) suiteFail('INCIDENT_TEXT_LIMIT');
    const ticket = await this.beginDerivedUpload(
      { ...s, name, format, bytes: data.length, digest: suiteSha(data), allowExport },
      lineage,
    );
    for (let offset = 0; offset < data.length; offset += 512 * 1024)
      await this.appendUpload({
        ...s,
        id: ticket.id,
        offset,
        data: data.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.finishUpload({ ...s, id: ticket.id });
  }
  async observe(raw: z.input<typeof M.incidentObservationInput>) {
    const input = M.incidentObservationInput.parse(raw),
      s = scope(input);
    const c = await this.cases.scope(s);
    if (I.incidentCase.parse(c.content).status !== 'open') suiteFail('INCIDENT_CASE_NOT_OPEN');
    if (Buffer.byteLength(input.text) > 1024 ** 2) suiteFail('INCIDENT_TEXT_LIMIT');
    const source = await this.textSource(s, input.name, input.text, 'text', false, []);
    return this.put(
      {
        ...s,
        name: input.name,
        references: [ref(c), ref(source)],
        content: json(
          I.incidentEvidence.parse({
            format: 'sakura-incident-evidence/1',
            case: ref(c),
            source: ref(source),
            sourceDigest: S.suiteMaterial.parse(source.content).digest,
            sourceAt: input.observedAt,
            observedAt: source.createdAt,
            method: 'manual',
            externalStatement: true,
            derivation: null,
          }),
        ),
      },
      'result',
      true,
    );
  }
  async redact(raw: z.infer<typeof I.incidentRedact>) {
    const input = I.incidentRedact.parse(raw),
      s = scope(input);
    if (input.evidence.domain !== this.domain) suiteFail('INCIDENT_EVIDENCE_DOMAIN');
    const c = await this.cases.scope(s),
      original = await this.pin({ ...s, id: input.evidence.id, revision: input.evidence.revision });
    if (I.incidentCase.parse(c.content).status !== 'open')
      suiteFail('INCIDENT_CASE_NOT_OPEN');
    const value = I.incidentEvidence.parse(original.content);
    if (value.case.id !== c.id) suiteFail('INCIDENT_CASE_MISMATCH');
    const material = await this.get({ ...s, id: value.source.id, revision: value.source.revision });
    if (S.suiteMaterial.parse(material.content).digest !== value.sourceDigest)
      suiteFail('INCIDENT_SOURCE_DIGEST');
    const output = await computeIncident<IncidentRedactionOutput>(this.domain, 'redact', async () => ({
      ...(await readSuiteText(this, s, value.source)),
      rules: input.rules,
    }));
    const format = z.enum(['text', 'json']).parse(S.suiteMaterial.parse(material.content).format);
    const source = await this.textSource(
      s,
      original.name.slice(0, 100).replace(/[\uD800-\uDBFF]$/u, '') + ' · 脱敏副本',
      output.text,
      format,
      false,
      [input.evidence],
    );
    return this.put(
      {
        ...s,
        name: source.name,
        references: [ref(c), ref(source), input.evidence],
        content: json(
          I.incidentEvidence.parse({
            ...value,
            case: ref(c),
            source: ref(source),
            sourceDigest: S.suiteMaterial.parse(source.content).digest,
            observedAt: source.createdAt,
            derivation: {
              original: input.evidence,
              originalDigest: value.sourceDigest,
              rulesDigest: suiteHash(input.rules),
              reviewed: false,
              reviewer: null,
              reviewPolicyRevision: null,
              reviewReason: '',
              replacements: output.replacements,
              warnings: output.warnings,
            },
          }),
        ),
      },
      'result',
      true,
    );
  }
  async planRedactionReview(raw: z.infer<typeof M.incidentRedactionReviewInput>) {
    const input = M.incidentRedactionReviewInput.parse(raw),
      s = scope(input);
    if (input.evidence.domain !== this.domain) suiteFail('INCIDENT_EVIDENCE_DOMAIN');
    const record = await this.pin({ ...s, id: input.evidence.id, revision: input.evidence.revision }),
      value = I.incidentEvidence.parse(record.content);
    if (!value.derivation) suiteFail('INCIDENT_REDACTION_REQUIRED');
    const source = await this.get({ ...s, id: value.source.id, revision: value.source.revision });
    if (
      !source.references.some((reference) => suiteHash(reference) === suiteHash(value.derivation!.original))
    )
      suiteFail('INCIDENT_REDACTION_LINEAGE');
    const policy = await this.policy({ ...s, id: source.id, revision: source.revision });
    const policyPlan = await this.planPolicy({
      ...s,
      id: source.id,
      revision: source.revision,
      expectedPolicyRevision: policy.revision,
      allowRead: true,
      allowExport: input.decision === 'approve',
    });
    return this.plan(
      s,
      'redaction-review',
      json({ input, policyPlan, nextPolicyRevision: policy.revision + 1 }),
      [input.evidence, value.source, value.derivation.original],
    );
  }
  async reviewRedaction(raw: S.SuiteApproval) {
    const approval = S.suiteApproval.parse(raw),
      s = scope(approval),
      known = await this.inspectPlan({ ...s, planId: approval.planId });
    if (
      known.action === 'redaction-review' &&
      known.digest === approval.digest &&
      known.binding === suiteBinding() &&
      known.state === 'completed' &&
      known.result
    )
      return this.get({ ...s, id: known.result.id, revision: known.result.revision });
    const plan = await this.consume(approval, 'redaction-review');
    const { input, policyPlan, nextPolicyRevision } = z
      .object({
        input: M.incidentRedactionReviewInput,
        policyPlan: S.suitePlan,
        nextPolicyRevision: z.number().int().positive(),
      })
      .strict()
      .parse(plan.input);
    const record = await this.pin({ ...s, id: input.evidence.id, revision: input.evidence.revision }),
      value = I.incidentEvidence.parse(record.content);
    if (!value.derivation) suiteFail('INCIDENT_REDACTION_REQUIRED');
    // 先保存审阅；只有随后原许可提交成功、修订也一致，才具有导出效力。
    const result = await this.put(
      {
        ...s,
        id: record.id,
        expectedRevision: record.revision,
        name: record.name,
        references: record.references,
        content: json({
          ...value,
          derivation: {
            ...value.derivation,
            reviewed: input.decision === 'approve',
            reviewer: suiteActor(),
            reviewReason: input.reason,
            reviewPolicyRevision: input.decision === 'approve' ? nextPolicyRevision : null,
          },
        }),
      },
      'result',
      true,
    );
    await this.applyPolicy({ ...s, planId: policyPlan.id, digest: policyPlan.digest });
    await this.complete(plan, result);
    return result;
  }
  async redactionStatus(raw: S.SuitePin) {
    const input = S.suitePin.parse(raw),
      record = await this.pin(input),
      value = I.incidentEvidence.parse(record.content);
    if (!value.derivation) return { reviewed: false, exportGranted: false, effective: false };
    const policy = await this.policy({
      ...scope(input),
      id: value.source.id,
      revision: value.source.revision,
    });
    return {
      reviewed: value.derivation.reviewed,
      exportGranted: policy.allowExport,
      effective:
        value.derivation.reviewed &&
        policy.allowRead &&
        policy.allowExport &&
        policy.revision === value.derivation.reviewPolicyRevision,
    };
  }
  async attach(raw: z.input<typeof I.incidentAttach>): Promise<S.SuiteRecord> {
    const input = I.incidentAttach.parse(raw),
      s = scope(input);
    if (input.source.domain !== this.domain) suiteFail('INCIDENT_EVIDENCE_SOURCE');
    const c = await this.cases.scope(s),
      value = I.incidentCase.parse(c.content);
    if (value.status !== 'open') suiteFail('INCIDENT_CASE_NOT_OPEN', '先重新打开案例再收集新材料');
    const source = await this.fixed(s, input.source),
      material = S.suiteMaterial.parse(source.content);
    if (source.kind !== 'source' || !['text', 'json'].includes(material.format))
      suiteFail('INCIDENT_EVIDENCE_SOURCE');
    const evidenceIds = new Set(
      (await this.readState()).rows
        .filter(
          (row) =>
            row.workspaceId === s.workspaceId &&
            row.actor === suiteActor() &&
            row.origin === 'local' &&
            row.kind === 'result' &&
            row.content &&
            typeof row.content === 'object' &&
            !Array.isArray(row.content) &&
            row.content.format === 'sakura-incident-evidence/1',
        )
        .map((row) => row.id),
    );
    if (evidenceIds.size >= this.evidenceLimit)
      suiteFail('INCIDENT_EVIDENCE_LIMIT', '本机案例材料数量已达上限');
    return this.put(
      {
        ...s,
        name: input.label ?? source.name,
        references: [ref(c), input.source],
        content: json(
          I.incidentEvidence.parse({
            format: 'sakura-incident-evidence/1',
            case: ref(c),
            source: input.source,
            sourceDigest: material.digest,
            sourceAt: input.sourceAt,
            observedAt: source.createdAt,
            method: 'upload',
            externalStatement: true,
            derivation: null,
          }),
        ),
      },
      'result',
      true,
    );
  }
  async pin(raw: S.SuitePin): Promise<S.SuiteRecord> {
    const input = S.suitePin.parse(raw),
      row = await this.get(input);
    if (row.state !== 'sealed' || row.kind !== 'result' || row.origin !== 'local')
      suiteFail('INCIDENT_EVIDENCE_REQUIRED');
    I.incidentEvidence.parse(row.content);
    return row;
  }
}
