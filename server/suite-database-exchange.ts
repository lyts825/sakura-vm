/** 原图许可在导出、读取和下载时重新核对；便携图不含活跃执行票据。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DatabaseSourcesV1 } from './service-contracts/database-evolution.ts';
import { SuiteExchange, type SuiteExportProjection } from './suite-exchange.ts';
import { suiteActor, suiteFail, suiteHash, suiteSha, type SuiteAuthorize } from './suite-store.ts';
import {
  projectDatabasePortable,
  databasePortable,
  databasePortableDomains,
} from './suite-database-portable.ts';
import { verifyDatabaseBundle } from './database-offline.ts';
const key = (r: S.SuiteRef) => `${r.domain}:${r.id}:${r.revision}`;
const pin = (s: S.SuiteScope, r: S.SuiteRef) => ({ ...s, id: r.id, revision: r.revision });
const guards = z
  .array(
    z
      .object({
        reference: S.suiteRef,
        policyRevision: z.number().int().positive(),
        authorizationDigest: S.suiteDigest,
        sourcePolicy: z
          .object({ allowRead: z.boolean(), allowExport: z.boolean(), revision: z.number().int() })
          .strict()
          .nullable(),
      })
      .strict(),
  )
  .max(1000);
function projection(
  sources: DatabaseSourcesV1,
  peers: Readonly<Record<string, S.SuiteRecordsV1>>,
): SuiteExportProjection {
  const collect = async (s: S.SuiteScope, selected: S.SuiteRef[]) => {
    if (!selected.length || selected.some((r) => r.domain !== 'database-reports'))
      suiteFail('DATABASE_EXPORT_REPORT', '请选择封存的本地报告');
    const rows = new Map<string, S.SuiteRecord>(),
      active = new Set<string>();
    const visit = async (r: S.SuiteRef) => {
      if (rows.has(key(r))) return;
      if (active.has(key(r)) || rows.size + active.size >= 1000) suiteFail('DATABASE_EXPORT_GRAPH');
      active.add(key(r));
      if (!databasePortableDomains.includes(r.domain)) suiteFail('DATABASE_EXPORT_DOMAIN');
      const port = peers[r.domain];
      if (!port) suiteFail('DATABASE_EXPORT_DOMAIN');
      const row = await port.get(pin(s, r));
      if (row.origin !== 'local' || row.state !== 'sealed' || row.actor !== suiteActor())
        suiteFail('DATABASE_EXPORT_LOCAL');
      for (const dependency of row.references) await visit(dependency);
      active.delete(key(r));
      rows.set(key(r), row);
    };
    for (const r of selected) await visit(r);
    const binding: z.infer<typeof guards> = [];
    for (const row of rows.values()) {
      const reference = { domain: row.domain, id: row.id, revision: row.revision },
        sourcePolicy = row.kind === 'source' ? await sources.policy(pin(s, reference)) : null;
      if (sourcePolicy && (!sourcePolicy.allowRead || !sourcePolicy.allowExport))
        suiteFail('DATABASE_EXPORT_POLICY', '先明确批准原始数据材料的导出许可');
      binding.push({
        reference,
        policyRevision: row.policyRevision,
        authorizationDigest: row.authorizationDigest ?? suiteFail('DATABASE_EXPORT_PERMISSION'),
        sourcePolicy,
      });
    }
    return { rows: [...rows.values()], binding };
  };
  const authorize = async (s: S.SuiteScope, selected: S.SuiteRef[], binding: S.SuiteJson) => {
    const prior = guards.parse(binding),
      now = await collect(s, selected);
    if (suiteHash(now.binding) !== suiteHash(prior)) suiteFail('DATABASE_EXPORT_CHANGED');
  };
  return {
    id: 'database-historical-v1',
    authorize,
    async project(s, selected) {
      const current = await collect(s, selected),
        materials: { reference: S.SuiteRef; data: Uint8Array }[] = [];
      let total = 0;
      for (const row of current.rows) {
        if (row.kind !== 'source') continue;
        const material = S.suiteMaterial.parse(row.content),
          reference = { domain: row.domain, id: row.id, revision: row.revision },
          parts: Buffer[] = [];
        if ((total += material.bytes) > 16 * 1024 ** 2) suiteFail('DATABASE_EXPORT_BYTES');
        let offset = 0;
        do {
          const chunk = await sources.readSource({
              ...pin(s, reference),
              offset,
              length: Math.max(1, Math.min(512 * 1024, material.bytes - offset)),
              purpose: 'export',
            }),
            bytes = Buffer.from(chunk.data, 'base64');
          if (chunk.offset !== offset + bytes.length || (!bytes.length && !chunk.eof))
            suiteFail('DATABASE_EXPORT_PROTOCOL');
          parts.push(bytes);
          offset = chunk.offset;
          if (chunk.eof) break;
        } while (offset < material.bytes);
        const bytes = Buffer.concat(parts);
        if (bytes.length !== material.bytes || suiteSha(bytes) !== material.digest)
          suiteFail('DATABASE_EXPORT_DIGEST');
        materials.push({ reference, data: bytes });
      }
      await authorize(s, selected, S.suiteJson.parse(current.binding));
      const result = projectDatabasePortable(current.rows, materials);
      return {
        ...result,
        binding: S.suiteJson.parse(current.binding),
        summary: {
          objects: result.rows.length,
          materialBytes: total,
          sourceTrust: 'unauthenticated',
          executionAllowed: false,
          approvalsTransferred: false,
          restoreKind: 'canonical-logical-baseline',
        },
      };
    },
  };
}
export class DatabaseExchange extends SuiteExchange {
  constructor(
    meta: PluginMetadata,
    blobs: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    sources: DatabaseSourcesV1,
    peers: Readonly<Record<string, S.SuiteRecordsV1>>,
  ) {
    super(
      'database-exchange',
      meta,
      blobs,
      uploads,
      auth,
      sources,
      peers,
      'sakura-database-evolution/1',
      (_domain, _kind, value) => S.suiteJson.parse(databasePortable.parse(value)),
      {
        sourceDomain: 'database-sources',
        receivedName: '接收的数据库演练声明',
        projection: projection(sources, peers),
        verifyBundle: (data) => {
          verifyDatabaseBundle(data);
        },
      },
    );
  }
}
