/** 为固定报告生成无执行权限的来源声明图；每次下载仍复核原材料许可。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import { suiteActor, suiteHash, suiteSha, suiteFail } from './suite-store.ts';
import type { SuiteExportProjection } from './suite-exchange.ts';
export const portableKey = (r: S.SuiteRef) => `${r.domain}:${r.id}:${r.revision}`;
const ref = (r: S.SuiteRecord): S.SuiteRef => ({ domain: r.domain, id: r.id, revision: r.revision });
const pin = (s: S.SuiteScope, r: S.SuiteRef) => ({ ...s, id: r.id, revision: r.revision });
const uuid = (s: string) => {
  const h = suiteSha(s);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export function suitePortableProjection(options: {
  id: string;
  reportDomain: string;
  sourceDomain: string;
  sources: S.SuiteMaterialsV1;
  peers: Readonly<Record<string, S.SuiteRecordsV1>>;
  claims: (row: S.SuiteRecord, anonymousActor: string) => S.SuiteJson;
  validate: (rows: ReadonlyMap<string, S.SuiteRecord>, selected: S.SuiteRef[]) => void | Promise<void>;
}): SuiteExportProjection {
  const prepare = async (scope: S.SuiteScope, selected: S.SuiteRef[]) => {
    z.array(S.suiteRef).min(1).max(10).parse(selected);
    const rows = new Map<string, S.SuiteRecord>(),
      active = new Set<string>();
    const visit = async (reference: S.SuiteRef) => {
      const key = portableKey(reference);
      if (rows.has(key)) return;
      if (active.has(key) || rows.size + active.size >= 1000) suiteFail('SUITE_PORTABLE_GRAPH');
      active.add(key);
      const peer = Object.hasOwn(options.peers, reference.domain)
        ? options.peers[reference.domain]
        : undefined;
      if (!peer) suiteFail('SUITE_PORTABLE_DOMAIN');
      const row = await peer.get(pin(scope, reference));
      if (row.state !== 'sealed' || row.origin !== 'local' || row.actor !== suiteActor())
        suiteFail('SUITE_PORTABLE_LOCAL_REQUIRED');
      for (const dependency of row.references) await visit(dependency);
      active.delete(key);
      rows.set(key, row);
    };
    for (const reference of selected) {
      if (reference.domain !== options.reportDomain) suiteFail('SUITE_PORTABLE_REPORT_REQUIRED');
      await visit(reference);
    }
    await options.validate(rows, selected);
    const policies = [];
    for (const row of rows.values())
      if (row.kind === 'source') {
        if (row.domain !== options.sourceDomain) suiteFail('SUITE_PORTABLE_SOURCE_DOMAIN');
        const policy = await options.sources.policy(pin(scope, ref(row)));
        if (!policy.allowRead || !policy.allowExport) suiteFail('SUITE_PORTABLE_EXPORT_PERMISSION');
        policies.push({ reference: ref(row), policy });
      }
    const binding = S.suiteJson.parse({
      selected,
      guards: [...rows.values()].map((row) => ({
        reference: ref(row),
        policyRevision: row.policyRevision,
        digest: row.authorizationDigest ?? suiteHash(row.policyRevision),
      })),
      policies,
    });
    return { rows, binding };
  };
  const authorize = async (scope: S.SuiteScope, selected: S.SuiteRef[], binding: S.SuiteJson) => {
    if (suiteHash((await prepare(scope, selected)).binding) !== suiteHash(binding))
      suiteFail('SUITE_PORTABLE_CHANGED');
  };
  return {
    id: options.id,
    authorize,
    async project(scope, selected) {
      const current = await prepare(scope, selected),
        mapping = new Map<string, S.SuiteRef>(),
        rows: S.SuiteRecord[] = [],
        materials: { reference: S.SuiteRef; data: Uint8Array }[] = [],
        actor = uuid(options.id + ':actor'),
        workspaceId = uuid(options.id + ':workspace');
      let bytes = 0;
      const rewrite = (value: S.SuiteJson): S.SuiteJson => {
        if (Array.isArray(value)) return value.map(rewrite);
        if (value && typeof value === 'object') {
          const parsed = S.suiteRef.safeParse(value);
          if (parsed.success)
            return S.suiteJson.parse(
              mapping.get(portableKey(parsed.data)) ?? suiteFail('SUITE_PORTABLE_REFERENCE'),
            );
          return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, rewrite(child)]));
        }
        return value;
      };
      for (const original of current.rows.values()) {
        const id = uuid(options.id + ':' + portableKey(original));
        let content: S.SuiteJson, data: Buffer | undefined;
        if (original.kind === 'source') {
          const material = S.suiteMaterial.parse(original.content);
          bytes += material.bytes;
          if (bytes > 12 * 1024 ** 2) suiteFail('SUITE_PORTABLE_BYTES');
          const lease = await options.sources.openRead({ ...pin(scope, ref(original)), purpose: 'export' }),
            parts: Buffer[] = [];
          try {
            if (!material.bytes)
              await options.sources.readLease({ ...scope, id: lease.id, offset: 0, length: 1 });
            for (let offset = 0; offset < material.bytes;) {
              const chunk = await options.sources.readLease({
                  ...scope,
                  id: lease.id,
                  offset,
                  length: Math.min(512 * 1024, material.bytes - offset),
                }),
                part = Buffer.from(chunk.data, 'base64');
              if (!part.length || chunk.offset !== offset + part.length)
                suiteFail('SUITE_PORTABLE_MATERIAL_PROTOCOL');
              parts.push(part);
              offset = chunk.offset;
            }
          } finally {
            await options.sources.closeRead({ ...scope, id: lease.id });
          }
          data = Buffer.concat(parts);
          if (data.length !== material.bytes || suiteSha(data) !== material.digest)
            suiteFail('SUITE_PORTABLE_MATERIAL_DIGEST');
          content = S.suiteJson.parse({ ...material, blobId: id });
        } else
          content = S.suiteJson.parse(
            suitePortableClaim.parse({
              format: 'sakura-suite-portable-claim/1',
              sourceTrust: 'unauthenticated',
              approvalsTransferred: false,
              executionAllowed: false,
              sourceRecordDigest: original.revision,
              claims: rewrite(options.claims(original, actor)),
            }),
          );
        const references = original.references.map(
            (r) => mapping.get(portableKey(r)) ?? suiteFail('SUITE_PORTABLE_REFERENCE'),
          ),
          base = { id, parent: null, sequence: 1, content, references };
        const row = S.suiteRecord.parse({
          ...base,
          domain: original.domain,
          workspaceId,
          actor,
          createdAt: original.createdAt,
          policyRevision: 1,
          revision: suiteHash(base),
          name: original.name,
          state: 'sealed',
          kind: original.kind,
          origin: 'imported',
        });
        mapping.set(portableKey(original), ref(row));
        rows.push(row);
        if (data) materials.push({ reference: ref(row), data });
      }
      await authorize(scope, selected, current.binding);
      return {
        rows,
        materials,
        binding: current.binding,
        summary: {
          reports: selected.length,
          objects: rows.length,
          bytes,
          sourceTrust: 'unauthenticated',
          executionAllowed: false,
          approvalsTransferred: false,
        },
      };
    },
  };
}
