/** 数据库交接只携带历史声明，移除计划票据、VM 身份与执行权限。 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as D from '../shared/contracts/database-evolution.ts';
import { offlineHash, offlineKey } from './suite-offline.ts';
export const databasePortable = z
  .object({
    format: z.literal('sakura-database-portable/1'),
    sourceTrust: z.literal('unauthenticated'),
    executionAllowed: z.literal(false),
    approvalsTransferred: z.literal(false),
    sourceObjectDigest: S.suiteDigest,
    claims: S.suiteJson,
  })
  .strict();
export const databaseFixtureClaim = z
  .object({
    format: z.literal('sakura-database-fixture-claim/1'),
    source: S.suiteRef,
    changes: S.suiteRef.nullable(),
    parentFixture: S.suiteRef.nullable(),
    mode: D.databaseFixture.shape.mode,
    state: z.string().max(30),
    outcome: z.string().max(30),
    cleanup: z.string().max(30),
    tools: z.record(z.string().max(100), z.string().max(200)),
    result: D.databaseWorkerResult.nullable(),
  })
  .strict();
export const databasePortableDomains = [
  'sources',
  'schemas',
  'changes',
  'fixtures',
  'runners',
  'checks',
  'rehearsals',
  'reports',
].map((n) => 'database-' + n);
const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
function uuid(value: string) {
  const b = createHash('sha256')
    .update('database-portable/1:' + value)
    .digest()
    .subarray(0, 16);
  b[6] = (b[6] & 15) | 128;
  b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function claims(row: S.SuiteRecord): S.SuiteJson {
  const f = D.databaseFixture.safeParse(row.content);
  if (f.success) {
    const v = f.data,
      result = v.result ? structuredClone(v.result) : null;
    for (const snapshot of [result?.baseline, result?.after])
      if (snapshot) snapshot.databaseIdentity = 'source-' + offlineHash(snapshot.databaseIdentity);
    return S.suiteJson.parse({
      format: 'sakura-database-fixture-claim/1',
      source: v.source,
      changes: v.changes,
      parentFixture: v.parentFixture,
      mode: v.mode,
      state: v.session?.state ?? 'unknown',
      outcome: v.session?.outcome ?? 'inconclusive',
      cleanup: v.session?.cleanup ?? 'unknown',
      tools: v.session?.tools ?? {},
      result,
    });
  }
  const check = D.databaseCheck.safeParse(row.content);
  if (check.success) return S.suiteJson.parse({ ...check.data, sourceClaimOnly: true });
  const report = D.databaseReport.safeParse(row.content);
  if (report.success) {
    const { sealedBy, sourceTrust, ...rest } = report.data;
    return S.suiteJson.parse({
      ...rest,
      sealedByClaim: uuid(sealedBy),
      sourceTrust: 'unauthenticated',
      assessment: { ...rest.assessment, sourceClaimOnly: true },
    });
  }
  return row.content;
}
export function projectDatabasePortable(
  rows: S.SuiteRecord[],
  materials: { reference: S.SuiteRef; data: Uint8Array }[],
) {
  const index = new Map(rows.map((r) => [offlineKey(r), r])),
    done = new Map<string, S.SuiteRecord>(),
    active = new Set<string>();
  const rewrite = (value: S.SuiteJson): S.SuiteJson => {
    const reference = S.suiteRef.safeParse(value);
    if (reference.success) return S.suiteJson.parse(ref(visit(reference.data)));
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
    return value;
  };
  const visit = (reference: S.SuiteRef): S.SuiteRecord => {
    const key = offlineKey(reference),
      prior = done.get(key);
    if (prior) return prior;
    const row = index.get(key);
    if (!row || active.has(key)) throw new Error('DATABASE_PORTABLE_GRAPH');
    active.add(key);
    const references = row.references.map((r) => ref(visit(r))),
      id = uuid(key);
    let content: S.SuiteJson;
    if (row.kind === 'source') {
      const material = S.suiteMaterial.parse(row.content);
      content = { ...material, blobId: uuid('blob:' + key), allowRead: true, allowExport: false };
    } else
      content = S.suiteJson.parse(
        databasePortable.parse({
          format: 'sakura-database-portable/1',
          sourceTrust: 'unauthenticated',
          executionAllowed: false,
          approvalsTransferred: false,
          sourceObjectDigest: offlineHash(row.content),
          claims: rewrite(claims(row)),
        }),
      );
    const result = S.suiteRecord.parse({
      ...row,
      id,
      workspaceId: uuid(row.workspaceId),
      actor: uuid(row.actor),
      name: row.name,
      sequence: 1,
      parent: null,
      origin: 'imported',
      policyRevision: 1,
      authorizationDigest: undefined,
      content,
      references,
      revision: offlineHash({ id, parent: null, sequence: 1, content, references }),
    });
    active.delete(key);
    done.set(key, result);
    return result;
  };
  rows.forEach((row) => visit(ref(row)));
  return {
    rows: [...done.values()],
    materials: materials.map((m) => ({ reference: ref(visit(m.reference)), data: m.data })),
  };
}
