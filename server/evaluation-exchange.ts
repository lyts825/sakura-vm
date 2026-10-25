/** 导出固定报告的最小凭据投影；接收对象保持不可执行的来源声明。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as E from '../shared/contracts/evaluation-studio.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteExchange, type SuiteExportProjection } from './suite-exchange.ts';
import { suiteActor, suiteHash, suiteSha, suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { evaluationPortable, evaluationSchemas, verifyEvaluationBundle } from './evaluation-offline.ts';
const key = (r: S.SuiteRef) => `${r.domain}:${r.id}:${r.revision}`;
const ref = (r: S.SuiteRecord): S.SuiteRef => ({ domain: r.domain, id: r.id, revision: r.revision });
const pin = (s: S.SuiteScope, r: S.SuiteRef) => ({ ...s, id: r.id, revision: r.revision });
const uuid = (s: string) => {
  const h = suiteSha(s);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
type Peers = Readonly<Record<string, S.SuiteRecordsV1>>;
function projection(datasets: S.SuiteMaterialsV1, peers: Peers): SuiteExportProjection {
  const prepare = async (s: S.SuiteScope, selected: S.SuiteRef[]) => {
    z.array(S.suiteRef).min(1).max(10).parse(selected);
    const rows = new Map<string, S.SuiteRecord>(),
      active = new Set<string>();
    const visit = async (r: S.SuiteRef) => {
      if (rows.has(key(r))) return;
      if (active.has(key(r)) || rows.size + active.size >= 1000) suiteFail('EVALUATION_PORTABLE_GRAPH');
      active.add(key(r));
      const peer = Object.hasOwn(peers, r.domain) ? peers[r.domain] : undefined;
      if (!peer) suiteFail('EVALUATION_PORTABLE_DOMAIN');
      const row = await peer.get(pin(s, r));
      if (row.state !== 'sealed' || row.origin !== 'local' || row.actor !== suiteActor())
        suiteFail('EVALUATION_PORTABLE_LOCAL');
      for (const dep of row.references) await visit(dep);
      active.delete(key(r));
      rows.set(key(r), row);
    };
    for (const r of selected) {
      if (r.domain !== 'evaluation-reports') suiteFail('EVALUATION_PORTABLE_REPORT');
      await visit(r);
      const report = E.evaluationReport.parse(rows.get(key(r))!.content),
        review = E.evaluationReview.parse(rows.get(key(report.review))?.content);
      if (review.decision !== 'accepted') suiteFail('EVALUATION_PORTABLE_REVIEW');
      let cursor = 0,
        head: S.SuiteRecord | undefined;
      for (;;) {
        const page = await peers['evaluation-reviews'].list({
          ...s,
          cursor,
          limit: 100,
          history: true,
          archived: true,
        });
        for (const item of page.items)
          if (item.id === report.review.id && (!head || head.sequence < item.sequence)) head = item;
        if (page.next === null) break;
        cursor = page.next;
      }
      if (!head || head.revision !== report.review.revision || head.state !== 'sealed')
        suiteFail('EVALUATION_PORTABLE_REVIEW_WITHDRAWN');
    }
    const policies = [];
    for (const row of rows.values())
      if (row.kind === 'source') {
        const policy = await datasets.policy(pin(s, ref(row)));
        if (!policy.allowRead || !policy.allowExport) suiteFail('EVALUATION_EXPORT_PERMISSION');
        policies.push({ reference: ref(row), policy });
      }
    const binding = S.suiteJson.parse({
      selected,
      guards: [...rows.values()].map((r) => ({
        ref: ref(r),
        policyRevision: r.policyRevision,
        digest: r.authorizationDigest ?? suiteHash(r.policyRevision),
      })),
      policies,
    });
    return { rows: [...rows.values()], binding };
  };
  const authorize = async (s: S.SuiteScope, selected: S.SuiteRef[], binding: S.SuiteJson) => {
    if (suiteHash((await prepare(s, selected)).binding) !== suiteHash(binding))
      suiteFail('EVALUATION_EXPORT_CHANGED');
  };
  return {
    id: 'evaluation-reviewed-v1',
    authorize,
    async project(s, selected) {
      const current = await prepare(s, selected),
        mapping = new Map<string, S.SuiteRef>(),
        rows: S.SuiteRecord[] = [],
        materials: { reference: S.SuiteRef; data: Uint8Array }[] = [];
      const actor = uuid('evaluation-portable-actor'),
        workspaceId = uuid('evaluation-portable-workspace');
      const replace = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(replace);
        if (value && typeof value === 'object') {
          const parsed = S.suiteRef.safeParse(value);
          if (parsed.success)
            return mapping.get(key(parsed.data)) ?? suiteFail('EVALUATION_PORTABLE_REFERENCE');
          return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
        }
        return value;
      };
      let bytes = 0;
      for (const original of current.rows) {
        let data: Buffer | undefined,
          claims: unknown = original.content;
        const id = uuid(key(original));
        if (original.kind === 'source') {
          const material = S.suiteMaterial.parse(original.content);
          bytes += material.bytes;
          if (bytes > 8 * 1024 ** 2) suiteFail('EVALUATION_EXPORT_BYTES');
          const lease = await datasets.openRead({ ...pin(s, ref(original)), purpose: 'export' }),
            parts: Buffer[] = [];
          try {
            if (!material.bytes) await datasets.readLease({ ...s, id: lease.id, offset: 0, length: 1 });
            for (let offset = 0; offset < material.bytes;) {
              const chunk = await datasets.readLease({
                  ...s,
                  id: lease.id,
                  offset,
                  length: Math.min(512 * 1024, material.bytes - offset),
                }),
                part = Buffer.from(chunk.data, 'base64');
              if (!part.length || chunk.offset !== offset + part.length)
                suiteFail('EVALUATION_MATERIAL_PROTOCOL');
              parts.push(part);
              offset = chunk.offset;
            }
          } finally {
            await datasets.closeRead({ ...s, id: lease.id });
          }
          data = Buffer.concat(parts);
          if (data.length !== material.bytes || suiteSha(data) !== material.digest)
            suiteFail('EVALUATION_MATERIAL_DIGEST');
          claims = { ...material, blobId: id };
        } else {
          claims = evaluationSchemas[original.domain].parse(claims);
          if (original.domain === 'evaluation-endpoints') {
            const e = E.evaluationEndpoint.parse(claims);
            claims = { ...e, secret: null, target: { ...e.target, secretVersion: null }, revoked: true };
          }
          if (original.domain === 'evaluation-runners') {
            const r = E.evaluationRun.parse(claims);
            claims = {
              ...r,
              planId: null,
              planDigest: null,
              items: r.items.map((i) => ({ ...i, callId: null })),
            };
          }
          if (original.domain === 'evaluation-scorers') {
            const c = E.evaluationScore.parse(claims);
            claims = { ...c, reviewer: c.reviewer ? actor : null, judgeReceipts: [], judgeIntents: [] };
          }
          if (original.domain === 'evaluation-reviews')
            claims = { ...E.evaluationReview.parse(claims), reviewer: actor };
        }
        const content = S.suiteJson.parse(
            original.kind === 'source'
              ? claims
              : {
                  format: 'sakura-evaluation-portable/1',
                  sourceTrust: 'unauthenticated',
                  approvalsTransferred: false,
                  executionAllowed: false,
                  sourceRecordDigest: original.revision,
                  claims: replace(claims),
                },
          ),
          references = original.references.map(
            (r) => mapping.get(key(r)) ?? suiteFail('EVALUATION_PORTABLE_REFERENCE'),
          ),
          base = { id, parent: null, sequence: 1, content, references },
          row = S.suiteRecord.parse({
            ...base,
            domain: original.domain,
            workspaceId,
            policyRevision: 1,
            actor,
            createdAt: original.createdAt,
            revision: suiteHash(base),
            name: original.name,
            state: 'sealed',
            kind: original.kind,
            origin: 'imported',
          });
        mapping.set(key(original), ref(row));
        rows.push(row);
        if (data) materials.push({ reference: ref(row), data });
      }
      await authorize(s, selected, current.binding);
      return {
        rows,
        materials,
        binding: current.binding,
        summary: {
          selectedReports: selected.length,
          objects: rows.length,
          bytes,
          sourceTrust: 'unauthenticated',
          approvalsTransferred: false,
          executionAllowed: false,
          credentialsTransferred: false,
        },
      };
    },
  };
}
export class EvaluationExchange extends SuiteExchange {
  constructor(
    m: PluginMetadata,
    b: PluginMetadata,
    u: PluginMetadata,
    a: SuiteAuthorize,
    root: S.SuiteMaterialsV1,
    peers: Peers,
  ) {
    super(
      'evaluation-exchange',
      m,
      b,
      u,
      a,
      root,
      peers,
      'sakura-model-evaluation/1',
      (_domain, _kind, value) => S.suiteJson.parse(evaluationPortable.parse(value)),
      {
        sourceDomain: 'evaluation-datasets',
        receivedName: '接收的模型评测来源声明',
        projection: projection(root, peers),
        verifyBundle: (data) => {
          verifyEvaluationBundle(data);
        },
      },
    );
  }
}
