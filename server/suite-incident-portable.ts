/** 脱敏交接的纯投影；仅保留外来历史声明，实际材料字节保持原样。 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import * as S from '../shared/contracts/suite-common.ts';
import * as I from '../shared/contracts/incident-desk.ts';
import * as A from '../shared/contracts/incident-actions.ts';
import * as R from '../shared/contracts/incident-reviews.ts';
import { cleanupResultSchema } from '../shared/contracts/cleanup-plan.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import { canonicalBundle, SUITE_BUNDLE_LIMIT } from '../scripts/suite-bundle.mjs';

const profile = 'sakura-incident-portable/1';
const sourceDomain = 'incident-evidence';
const objectLimit = 8 * 1024 ** 2;
const credential = z
  .string()
  .refine((value) => /^[a-f0-9]{64}$/i.test(value) || S.suiteId.safeParse(value).success);
export const incidentPortableContent = z
  .object({
    format: z.literal('sakura-incident-portable/1'),
    sourceTrust: z.literal('unauthenticated'),
    approvalsTransferred: z.literal(false),
    analysisTrust: z.literal('source-claim-only'),
    sourceRecordDigest: S.suiteDigest,
    sourceObjectDigest: S.suiteDigest,
    claims: S.suiteJson,
  })
  .strict();
export const incidentPortableInput = z
  .object({
    rows: z.array(S.suiteRecord).min(1).max(1000),
    materials: z
      .array(
        z
          .object({
            reference: S.suiteRef,
            text: z.string().max(SUITE_BUNDLE_LIMIT),
            format: z.enum(['text', 'json']),
          })
          .strict(),
      )
      .max(1000),
    credentials: z.array(credential).max(4096),
  })
  .strict();
export type IncidentPortableInput = z.input<typeof incidentPortableInput>;
export type IncidentPortableOutput = {
  rows: S.SuiteRecord[];
  materials: { reference: S.SuiteRef; text: string }[];
};

const key = (reference: S.SuiteRef) => `${reference.domain}:${reference.id}:${reference.revision}`;
const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown) => sha(canonicalBundle(value));
function fail(code: string, message = '便携投影包含不支持或不完整的引用'): never {
  throw new AppError(message, 409, 'INCIDENT_PORTABLE_' + code);
}
function uuid(value: string) {
  const bytes = createHash('sha256')
    .update(profile + ':' + value)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const text = bytes.toString('hex');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
const wellFormed = (value: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const resultSummary = z
  .object({
    runId: S.suiteId,
    state: z.enum([
      'queued',
      'preparing',
      'baselining',
      'armed',
      'injecting',
      'observing',
      'recovering',
      'verifying',
      'containing',
      'cleaning',
      'completed',
      'reconcile-required',
    ]),
    containment: z.enum(['confirmed', 'pending', 'unknown']),
    cleanup: z.enum(['confirmed', 'pending', 'unknown']),
    outcome: z.enum(['passed', 'failed', 'cancelled', 'inconclusive']),
    resultDigest: S.suiteDigest,
    source: z.literal('original-provider'),
  })
  .strict();

/** 只识别本项目的原生凭据形状；未知秘密仍须人工全文审阅。 */
function credentialGuard(credentials: readonly string[]) {
  const known = [...new Set(credentials.map(value => value.toLowerCase()))];
  const text = (value: string) => {
    if (!wellFormed(value)) fail('UNICODE', '便携文本包含无效 Unicode');
    const normalized = value.toLowerCase();
    if (known.some((secret) => normalized.includes(secret)))
      fail('CREDENTIAL', '已审阅内容仍含原凭据，请重新脱敏和审阅');
  };
  const parsedStrings = new Set<string>();
  const object = (value: S.SuiteJson, depth = 0): void => {
    if (depth > 32) fail('DEPTH');
    if (typeof value === 'string') {
      text(value);
      const candidate = value.replace(/^\uFEFF/, '').trim();
      if (/^[\[{]/.test(candidate) && !parsedStrings.has(value)) {
        parsedStrings.add(value);
        let parsed: S.SuiteJson | undefined;
        try {
          parsed = parseSuiteJson(candidate, SUITE_BUNDLE_LIMIT);
        } catch {
          /* 普通叙述不要求是 JSON。 */
        }
        if (parsed !== undefined) object(parsed, depth + 1);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) object(child, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (
      value.consumer === 'official:incident-evidence' &&
      ['official:metrics', 'official:service-health'].includes(String(value.provider)) &&
      typeof value.authTag === 'string' &&
      /^[a-f0-9]{64}$/i.test(value.authTag)
    )
      fail('NATIVE_CREDENTIAL', '材料仍含原生采集凭据，请先生成已移除凭据的脱敏副本');
    if (
      ['maintenance-cleanup', 'resilience-reconcile'].includes(String(value.adapter)) &&
      S.suiteId.safeParse(value.id).success &&
      typeof value.digest === 'string' &&
      /^[a-f0-9]{64}$/i.test(value.digest)
    )
      fail('NATIVE_CREDENTIAL', '材料仍含原生动作票据，请先重新脱敏和审阅');
    for (const [name, child] of Object.entries(value)) {
      text(name);
      object(child, depth + 1);
    }
  };
  const material = (value: string, format: 'text' | 'json') => {
    text(value);
    const input = value.replace(/^\uFEFF/, '');
    let parsed: S.SuiteJson | undefined;
    try {
      parsed = parseSuiteJson(input, SUITE_BUNDLE_LIMIT);
    } catch {
      /* 再检查 JSONL 和独立的 JSON 日志行。 */
    }
    if (parsed !== undefined) {
      object(parsed);
      return;
    }
    let candidates = 0;
    for (const match of input.matchAll(/[^\r\n]+/g)) {
      const line = match[0].trim();
      if (!line) continue;
      if (format === 'text' && !/^[\[{]/.test(line)) continue;
      if (++candidates > 100000) fail('LIMIT');
      let item: S.SuiteJson | undefined;
      try {
        item = parseSuiteJson(line, SUITE_BUNDLE_LIMIT);
      } catch {
        if (format === 'json') fail('JSON', 'JSON 材料无法完整核对，请重新生成脱敏副本');
      }
      if (item !== undefined) object(item);
    }
  };
  return { object, material };
}

/** 离线核验只识别原生结构，无法替代发送方的已知凭据扫描和人工审阅。 */
export function assertIncidentPortableCredentials(value: S.SuiteJson) {
  credentialGuard([]).object(value);
}
export function assertIncidentPortableMaterial(text: string, format: 'text' | 'json') {
  credentialGuard([]).material(text, format);
}

function allowedEdges(row: S.SuiteRecord): S.SuiteRef[] {
  if (row.kind === 'source') return [];
  if (row.domain === sourceDomain) {
    const value = I.incidentEvidence.parse(row.content);
    return [value.case, value.source];
  }
  if (row.domain === 'incident-actions') return [A.incidentAction.parse(row.content).case];
  return row.references;
}

function claims(row: S.SuiteRecord): S.SuiteJson {
  if (row.domain === 'incident-cases') {
    const value = I.incidentCase.parse(row.content);
    return S.suiteJson.parse({
      impact: value.impact,
      severity: value.severity,
      affected: value.affected,
      status: value.status,
      resolution: value.resolution,
      reopenReason: value.reopenReason,
      unresolved: value.unresolved,
      declaredByClaim: value.declaredBy,
    });
  }
  if (row.domain === sourceDomain) {
    const value = I.incidentEvidence.parse(row.content);
    if (!value.derivation?.reviewed || !value.derivation.reviewer || !value.derivation.reviewPolicyRevision)
      fail('REVIEW_REQUIRED', '默认交接只接受已经明确审阅的派生材料');
    return S.suiteJson.parse({
      case: value.case,
      source: value.source,
      sourceDigest: value.sourceDigest,
      sourceAt: value.sourceAt,
      observedAt: value.observedAt,
      claimedMethod: value.method,
      externalStatement: true,
      redaction: {
        originalDigest: value.derivation.originalDigest,
        rulesDigest: value.derivation.rulesDigest,
        reviewedDeclaration: true,
        reviewerClaim: value.derivation.reviewer,
        reason: value.derivation.reviewReason,
        policyRevisionClaim: value.derivation.reviewPolicyRevision,
        replacements: value.derivation.replacements,
        warnings: value.derivation.warnings,
      },
    });
  }
  if (row.domain === 'incident-actions') {
    const value = A.incidentAction.parse(row.content);
    if (value.kind === 'manual')
      return S.suiteJson.parse({
        kind: 'manual-history',
        case: value.case,
        statement: value.statement,
        declaredByClaim: value.declaredBy,
        systemExecution: false,
      });
    let result: S.SuiteJson = null;
    if (value.receipt && hash(value.receipt.plan) !== hash(value.providerPlan)) fail('ACTION_PROOF');
    if (value.receipt?.status === 'returned') {
      if (value.providerPlan.input.adapter === 'maintenance-cleanup') {
        const parsed = cleanupResultSchema.parse(value.receipt.result);
        if (parsed.provider !== value.providerPlan.input.provider) fail('ACTION_PROOF');
        result = parsed;
      } else if (value.providerPlan.input.adapter === 'resilience-reconcile') {
        const parsed = resultSummary.parse(value.receipt.result);
        if (parsed.runId !== value.providerPlan.input.runId) fail('ACTION_PROOF');
        result = {
          state: parsed.state,
          containment: parsed.containment,
          cleanup: parsed.cleanup,
          outcome: parsed.outcome,
        };
      } else fail('ACTION_PROOF');
    }
    return S.suiteJson.parse({
      kind: 'delegated-history',
      case: value.case,
      phaseClaim: value.phase,
      adapterClaim: value.providerPlan.input.adapter,
      providerClaim: value.providerPlan.provider,
      providerStatusClaim: value.receipt?.status ?? null,
      resultClaim: result,
      submittedByClaim: value.submittedBy,
      executionTrust: 'source-claim-only',
    });
  }
  if (row.domain === 'incident-timeline') return S.suiteJson.parse(I.incidentTimeline.parse(row.content));
  if (row.domain === 'incident-hypotheses') return S.suiteJson.parse(I.incidentHypothesis.parse(row.content));
  if (row.domain === 'incident-runbooks') {
    const value = I.incidentRunbook.parse(row.content);
    return S.suiteJson.parse({
      case: value.case,
      steps: value.steps.map((step) =>
        step.kind === 'delegated'
          ? {
              id: step.id,
              kind: 'delegated-declaration',
              label: step.label,
              adapterClaim: step.target.adapter,
            }
          : step,
      ),
      executionTransferred: false,
    });
  }
  if (row.domain === 'incident-reviews') {
    const value = R.incidentReview.parse(row.content);
    if (value.decision !== 'accepted' || !value.assessment.exportReady) fail('REVIEW_REQUIRED');
    return S.suiteJson.parse(value);
  }
  if (row.domain === 'incident-reports') {
    const value = R.incidentReport.parse(row.content);
    if (value.status !== 'sealed' || !value.facts.exportReady) fail('REVIEW_REQUIRED');
    return S.suiteJson.parse(value);
  }
  return fail('DOMAIN');
}

/** 父层必须先核对实际许可和审阅；此函数不替代原提供者的权威检查。 */
export function projectIncidentPortable(raw: IncidentPortableInput): IncidentPortableOutput {
  const input = incidentPortableInput.parse(raw),
    guard = credentialGuard(input.credentials);
  const original = new Map<string, S.SuiteRecord>(),
    bodies = new Map<string, (typeof input.materials)[number]>();
  if (
    new Set(input.rows.map((row) => row.workspaceId)).size !== 1 ||
    new Set(input.rows.map((row) => row.actor)).size !== 1
  )
    fail('SCOPE');
  for (const row of input.rows) {
    if (row.state !== 'sealed' || row.origin !== 'local') fail('LOCAL_REQUIRED');
    if (
      row.kind !== (row.domain === 'incident-reviews' ? 'review' : 'result') &&
      !(row.domain === sourceDomain && row.kind === 'source')
    )
      fail('KIND');
    if (Buffer.byteLength(canonicalBundle(row)) > objectLimit) fail('LIMIT');
    if (
      row.revision !==
      hash({
        id: row.id,
        parent: row.parent,
        sequence: row.sequence,
        content: row.content,
        references: row.references,
      })
    )
      fail('REVISION');
    if (original.has(key(row))) fail('DUPLICATE');
    original.set(key(row), row);
  }
  for (const body of input.materials) {
    if (bodies.has(key(body.reference))) fail('DUPLICATE');
    const row = original.get(key(body.reference));
    if (!row || row.kind !== 'source' || row.domain !== sourceDomain) fail('MATERIAL');
    const metadata = S.suiteMaterial.parse(row.content);
    if (metadata.bytes > objectLimit) fail('LIMIT');
    const bytes = Buffer.from(body.text, 'utf8');
    if (metadata.format !== body.format || metadata.bytes !== bytes.length || metadata.digest !== sha(bytes))
      fail('MATERIAL');
    guard.material(body.text, body.format);
    bodies.set(key(body.reference), body);
  }
  const eligible = new Map<string, Set<string>>();
  for (const row of input.rows.filter((row) => row.domain === sourceDomain && row.kind !== 'source')) {
    const value = I.incidentEvidence.parse(row.content),
      source = original.get(key(value.source));
    if (
      !value.derivation?.reviewed ||
      !value.derivation.reviewer ||
      !source ||
      source.kind !== 'source' ||
      value.derivation.reviewPolicyRevision !== source.policyRevision ||
      S.suiteMaterial.parse(source.content).digest !== value.sourceDigest
    )
      fail('REVIEW_REQUIRED');
    const holders = eligible.get(key(value.source)) ?? new Set<string>();
    holders.add(key(value.derivation.original));
    eligible.set(key(value.source), holders);
    const expected = new Set([key(value.case), key(value.source), key(value.derivation.original)]);
    if (row.references.some((reference) => !expected.has(key(reference)))) fail('PRIVATE_REFERENCE');
  }
  const ids = new Map<string, S.SuiteRef>(),
    rows: S.SuiteRecord[] = [],
    materials: IncidentPortableOutput['materials'] = [];
  const rewrite = (value: S.SuiteJson): S.SuiteJson => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).sort().join(',') === 'domain,id,revision') {
      const reference = S.suiteRef.safeParse(value);
      if (reference.success) return ids.get(key(reference.data)) ?? fail('PRIVATE_REFERENCE');
    }
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, rewrite(child)]));
  };
  let size = 0;
  for (const row of input.rows) {
    let content: S.SuiteJson;
    const edges = allowedEdges(row),
      references = edges.map((reference) => ids.get(key(reference)) ?? fail('ORDER'));
    if (row.kind === 'source') {
      const holders = eligible.get(key(row));
      if (
        row.domain !== sourceDomain ||
        !bodies.has(key(row)) ||
        !holders?.size ||
        holders.size !== new Set(row.references.map(key)).size ||
        row.references.some((reference) => !holders.has(key(reference)))
      )
        fail('MATERIAL_LINEAGE');
      content = S.suiteJson.parse({
        ...S.suiteMaterial.parse(row.content),
        blobId: uuid('blob:' + key(row)),
        allowRead: true,
        allowExport: false,
      });
    } else
      content = {
        format: profile,
        sourceTrust: 'unauthenticated',
        approvalsTransferred: false,
        analysisTrust: 'source-claim-only',
        sourceRecordDigest: hash(ref(row)),
        sourceObjectDigest: hash({ domain: row.domain, id: row.id }),
        claims: rewrite(claims(row)),
      };
    const base = { id: uuid('record:' + key(row)), parent: null, sequence: 1, content, references };
    const projected = S.suiteRecord.parse({
      ...base,
      revision: hash(base),
      domain: row.domain,
      workspaceId: uuid('workspace:' + row.workspaceId),
      actor: uuid('actor'),
      createdAt: row.createdAt,
      name: row.name,
      state: 'sealed',
      kind: row.kind,
      origin: 'imported',
      policyRevision: 1,
    });
    guard.object(S.suiteJson.parse(projected));
    const bytes = Buffer.byteLength(canonicalBundle(projected));
    if (bytes > objectLimit) fail('LIMIT');
    size += bytes + 1024 + (row.kind === 'source' ? S.suiteMaterial.parse(row.content).bytes : 0);
    if (size > SUITE_BUNDLE_LIMIT - 128 * 1024) fail('LIMIT');
    rows.push(projected);
    ids.set(key(row), ref(projected));
    if (row.kind === 'source')
      materials.push({ reference: ref(projected), text: bodies.get(key(row))!.text });
  }
  if (materials.length !== input.materials.length) fail('MATERIAL');
  return { rows, materials };
}
