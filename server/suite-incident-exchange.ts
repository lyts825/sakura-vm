/** 人审派生材料的便携投影；本地完整原图继续持有许可和保护引用。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as I from '../shared/contracts/incident-desk.ts';
import * as R from '../shared/contracts/incident-reviews.ts';
import * as A from '../shared/contracts/incident-actions.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { IncidentCasesV1, IncidentEvidenceV1 } from './service-contracts/incident-desk.ts';
import type { IncidentReviewsV1 } from './service-contracts/incident-reviews.ts';
import { SuiteExchange, type SuiteExportProjection } from './suite-exchange.ts';
import { suiteMaterialsPort } from './suite-materials-port.ts';
import { suiteActor, suiteFail, suiteHash, suiteSha, type SuiteAuthorize } from './suite-store.ts';
import { projectIncidentPortable } from './suite-incident-portable.ts';
import { verifyIncidentBundle } from './incident-offline.ts';
const profile = 'incident-reviewed-v1';
const key = (r: S.SuiteRef) => `${r.domain}:${r.id}:${r.revision}`;
const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
const pin = (scope: S.SuiteScope, r: S.SuiteRef) => ({ ...scope, id: r.id, revision: r.revision });
const bindingSchema = z
  .object({
    profile: z.literal(profile),
    selected: z.array(S.suiteRef).min(1).max(20),
    guards: z
      .array(
        z
          .object({
            reference: S.suiteRef,
            permissionDigest: S.suiteDigest,
            policyRevision: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    grants: z
      .array(
        z
          .object({
            evidence: S.suiteRef,
            source: S.suiteRef,
            policyRevision: z.number().int().positive(),
            originalDigest: S.suiteDigest,
            rulesDigest: S.suiteDigest,
          })
          .strict(),
      )
      .min(1)
      .max(500),
    credentialDigest: S.suiteDigest,
    reviews: z
      .array(z.object({ review: S.suiteRef, latest: S.suiteRef }).strict())
      .min(1)
      .max(20),
  })
  .strict();
type Peers = Readonly<Record<string, S.SuiteRecordsV1>> & { readonly 'incident-reviews': IncidentReviewsV1 };
function projection(evidence: IncidentEvidenceV1, peers: Peers): SuiteExportProjection {
  const get = async (scope: S.SuiteScope, reference: S.SuiteRef) => {
    const peer = Object.hasOwn(peers, reference.domain) ? peers[reference.domain] : undefined;
    if (!peer) suiteFail('INCIDENT_PORTABLE_DOMAIN');
    const row = await peer.get(pin(scope, reference));
    if (row.state !== 'sealed' || row.origin !== 'local' || row.actor !== suiteActor())
      suiteFail('INCIDENT_PORTABLE_LOCAL_REQUIRED');
    return row;
  };
  const graph = async (scope: S.SuiteScope, selected: S.SuiteRef[]) => {
    const rows = new Map<string, S.SuiteRecord>(),
      active = new Set<string>();
    const visit = async (reference: S.SuiteRef) => {
      if (rows.has(key(reference))) return;
      if (active.has(key(reference)) || rows.size + active.size >= 1000) suiteFail('SUITE_BUNDLE_GRAPH');
      active.add(key(reference));
      const row = await get(scope, reference);
      for (const dependency of row.references) await visit(dependency);
      active.delete(key(reference));
      rows.set(key(reference), row);
    };
    for (const reference of selected) await visit(reference);
    return rows;
  };
  const prepare = async (scope: S.SuiteScope, selected: S.SuiteRef[]) => {
    z.array(S.suiteRef).min(1).max(20).parse(selected);
    if (new Set(selected.map(key)).size !== selected.length) suiteFail('INCIDENT_PORTABLE_DUPLICATE');
    const all = await graph(scope, selected),
      visible = new Map<string, S.SuiteRecord>(),
      grants: z.infer<typeof bindingSchema>['grants'] = [],
      reviews: z.infer<typeof bindingSchema>['reviews'] = [];
    for (const root of selected) {
      if (root.domain !== 'incident-reports')
        suiteFail('INCIDENT_PORTABLE_SEALED_REPORT', '请选择封存复盘报告');
      const report = R.incidentReport.parse(all.get(key(root))!.content);
      if (report.status !== 'sealed') suiteFail('INCIDENT_PORTABLE_SEALED_REPORT');
      const review = R.incidentReview.parse(all.get(key(report.review))?.content);
      if (review.decision !== 'accepted') suiteFail('INCIDENT_PORTABLE_REVIEW_REQUIRED');
      const latest = await peers['incident-reviews'].latestDecision({ ...scope, review: report.review });
      if (!latest.current || latest.decision !== 'accepted')
        suiteFail('INCIDENT_PORTABLE_REVIEW_WITHDRAWN', '此报告使用的审阅已被后续决定替代，请重新复盘');
      reviews.push({ review: report.review, latest: latest.latest });
    }
    const visit = async (reference: S.SuiteRef) => {
      if (visible.has(key(reference))) return;
      const row = all.get(key(reference)) ?? suiteFail('INCIDENT_PORTABLE_REFERENCE');
      if (row.kind === 'source') {
        if (row.domain !== 'incident-evidence' || !grants.some((g) => key(g.source) === key(reference)))
          suiteFail('INCIDENT_PORTABLE_SOURCE');
      } else if (row.domain === 'incident-evidence') {
        const value = I.incidentEvidence.parse(row.content),
          derived = value.derivation;
        if (!derived?.reviewed || !derived.reviewer || derived.reviewPolicyRevision === null)
          suiteFail('INCIDENT_PORTABLE_REDACTION_REQUIRED', '时间线与复盘须选择经过人审的脱敏副本');
        const status = await evidence.redactionStatus(pin(scope, reference)),
          policy = await evidence.policy(pin(scope, value.source));
        if (
          !status.effective ||
          !policy.allowRead ||
          !policy.allowExport ||
          policy.revision !== derived.reviewPolicyRevision
        )
          suiteFail('INCIDENT_PORTABLE_PERMISSION', '派生材料的当前人审或导出许可已失效');
        const source = all.get(key(value.source)) ?? suiteFail('INCIDENT_PORTABLE_SOURCE');
        if (!source.references.some((r) => key(r) === key(derived.original)))
          suiteFail('INCIDENT_PORTABLE_LINEAGE');
        const original = I.incidentEvidence.parse(all.get(key(derived.original))?.content);
        if (
          original.sourceDigest !== derived.originalDigest ||
          S.suiteMaterial.parse(source.content).digest !== value.sourceDigest
        )
          suiteFail('INCIDENT_SOURCE_DIGEST');
        grants.push({
          evidence: reference,
          source: value.source,
          policyRevision: policy.revision,
          originalDigest: derived.originalDigest,
          rulesDigest: derived.rulesDigest,
        });
        await visit(value.case);
        await visit(value.source);
      } else if (row.domain === 'incident-actions') {
        const value = A.incidentAction.parse(row.content);
        await visit(value.case);
      } else {
        for (const dependency of row.references) await visit(dependency);
      }
      visible.set(key(reference), row);
    };
    for (const root of selected) await visit(root);
    if (!grants.length) suiteFail('INCIDENT_PORTABLE_REDACTION_REQUIRED');
    const credentials = new Set<string>();
    for (const row of all.values()) {
      if (row.domain === 'incident-evidence' && row.kind !== 'source') {
        const value = I.incidentEvidence.safeParse(row.content);
        if (value.success && value.data.capture) credentials.add(value.data.capture.authTag);
      } else if (row.domain === 'incident-actions') {
        const value = A.incidentAction.safeParse(row.content);
        if (value.success && value.data.kind === 'delegated') {
          credentials.add(value.data.providerPlan.ticket.id);
          credentials.add(value.data.providerPlan.ticket.digest);
        }
      }
    }
    const binding = bindingSchema.parse({
      profile,
      selected,
      guards: [...all.values()]
        .map((row) => ({
          reference: ref(row),
          permissionDigest: row.authorizationDigest ?? suiteHash(row.policyRevision),
          policyRevision: row.policyRevision,
        }))
        .sort((a, b) => (key(a.reference) < key(b.reference) ? -1 : 1)),
      grants: grants.sort((a, b) => (key(a.evidence) < key(b.evidence) ? -1 : 1)),
      credentialDigest: suiteHash([...credentials].sort()),
      reviews,
    });
    return { all, visible: [...visible.values()], binding, credentials: [...credentials] };
  };
  const authorize = async (scope: S.SuiteScope, selected: S.SuiteRef[], binding: S.SuiteJson) => {
    const stored = bindingSchema.parse(binding),
      current = await prepare(scope, selected);
    if (suiteHash(stored) !== suiteHash(current.binding)) suiteFail('INCIDENT_PORTABLE_PERMISSION_CHANGED');
  };
  return {
    id: profile,
    authorize,
    async project(scope, selected) {
      const current = await prepare(scope, selected),
        materials: { reference: S.SuiteRef; text: string; format: 'text' | 'json' }[] = [];
      let materialBytes = 0;
      for (const row of current.visible.filter((row) => row.kind === 'source')) {
        const metadata = S.suiteMaterial.parse(row.content);
        materialBytes += metadata.bytes;
        if (materialBytes > 16 * 1024 ** 2) suiteFail('SUITE_BUNDLE_LIMIT', '派生字节超过 16 MiB', 413);
        const lease = await evidence.openRead({ ...pin(scope, ref(row)), purpose: 'export' }),
          parts: Buffer[] = [];
        try {
          if (!metadata.bytes) await evidence.readLease({ ...scope, id: lease.id, offset: 0, length: 1 });
          for (let offset = 0; offset < metadata.bytes;) {
            const chunk = await evidence.readLease({
              ...scope,
              id: lease.id,
              offset,
              length: Math.min(512 * 1024, metadata.bytes - offset),
            });
            const data = Buffer.from(chunk.data, 'base64');
            if (!data.length || chunk.offset !== offset + data.length) suiteFail('SUITE_MATERIAL_PROTOCOL');
            parts.push(data);
            offset = chunk.offset;
          }
        } finally {
          await evidence.closeRead({ ...scope, id: lease.id });
        }
        const data = Buffer.concat(parts);
        if (data.length !== metadata.bytes || suiteSha(data) !== metadata.digest)
          suiteFail('SUITE_MATERIAL_DIGEST');
        materials.push({
          reference: ref(row),
          text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data),
          format: z.enum(['text', 'json']).parse(metadata.format),
        });
      }
      const portable = projectIncidentPortable({
        rows: current.visible,
        materials,
        credentials: current.credentials,
      });
      await authorize(scope, selected, S.suiteJson.parse(current.binding));
      return {
        rows: portable.rows,
        materials: portable.materials.map((item) => ({
          reference: item.reference,
          data: Buffer.from(item.text, 'utf8'),
        })),
        binding: S.suiteJson.parse(current.binding),
        summary: {
          profile,
          selectedReports: selected.length,
          objects: portable.rows.length,
          materials: portable.materials.length,
          materialBytes,
          privateObjectsOmitted: current.all.size - current.visible.length,
          byteContentChanged: false,
          sourceTrust: 'unauthenticated',
          approvalsTransferred: false,
          scope: 'sealed-selected-reports',
        },
      };
    },
  };
}
/** 所有外来对象继续保存为不可执行的来源声明。 */
export const sanitizeIncidentImport = (
  _domain: string,
  _kind: S.SuiteRecord['kind'],
  value: S.SuiteJson,
): S.SuiteJson => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.format !== 'sakura-incident-portable/1'
  )
    suiteFail('INCIDENT_PORTABLE_IMPORT_FORMAT');
  return S.suiteJson.parse({
    ...value,
    sourceTrust: 'unauthenticated',
    approvalsTransferred: false,
    executionAllowed: false,
  });
};
export class IncidentExchange extends SuiteExchange {
  constructor(
    metadata: PluginMetadata,
    blobs: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    cases: IncidentCasesV1,
    evidence: IncidentEvidenceV1,
    peers: Peers,
  ) {
    super(
      'incident-exchange',
      metadata,
      blobs,
      uploads,
      auth,
      suiteMaterialsPort(cases, evidence),
      peers,
      'sakura-incident-desk/1',
      sanitizeIncidentImport,
      {
        sourceDomain: 'incident-evidence',
        receivedName: '接收的事件复盘声明',
        projection: projection(evidence, peers),
        verifyBundle: (data) => {
          verifyIncidentBundle(data);
        },
      },
    );
  }
}
