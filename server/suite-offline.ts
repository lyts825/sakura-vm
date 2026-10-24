/** 离线封套的字节、修订与对象图核验；没有宿主和网络入口。 */
import { createHash } from 'node:crypto';
import { decodeSuiteBundle, canonicalBundle } from '../scripts/suite-bundle.mjs';
import * as S from '../shared/contracts/suite-common.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
export const offlineSha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const offlineHash = (value: unknown) => offlineSha(canonicalBundle(value));
export const offlineKey = (reference: S.SuiteRef) =>
  `${reference.domain}:${reference.id}:${reference.revision}`;
export function verifySuiteGraph(
  bytes: Uint8Array,
  format: string,
  allowedDomains: readonly string[],
  sourceDomain: string,
) {
  const decoded = decodeSuiteBundle(bytes, format),
    allowed = new Set(allowedDomains),
    used = new Set<string>();
  const rows: S.SuiteRecord[] = [],
    materials = new Map<string, Buffer>();
  for (const entry of decoded.entries.filter((entry) => entry.path.startsWith('objects/'))) {
    if (entry.data.length > 8 * 1024 ** 2) throw new Error('SUITE_VERIFY_OBJECT_LIMIT');
    const value: unknown = parseSuiteJson(
      new TextDecoder('utf-8', { fatal: true }).decode(entry.data),
      8 * 1024 ** 2,
    );
    if (!S.isSuiteJsonBounded(value)) throw new Error('SUITE_VERIFY_OBJECT_LIMIT');
    const row = S.suiteRecord.parse(value);
    if (
      !allowed.has(row.domain) ||
      row.state !== 'sealed' ||
      entry.path !== `objects/${row.domain}/${row.id}-${row.revision}.json`
    )
      throw new Error('SUITE_VERIFY_OBJECT');
    if (
      offlineHash({
        id: row.id,
        parent: row.parent,
        sequence: row.sequence,
        content: row.content,
        references: row.references,
      }) !== row.revision
    )
      throw new Error('SUITE_VERIFY_REVISION');
    rows.push(row);
    used.add(entry.path);
    if (row.kind === 'source') {
      if (row.domain !== sourceDomain) throw new Error('SUITE_VERIFY_SOURCE_DOMAIN');
      const material = S.suiteMaterial.parse(row.content),
        path = `materials/${row.id}-${row.revision}.bin`,
        data = decoded.entries.find((entry) => entry.path === path)?.data;
      if (!data || data.length !== material.bytes || offlineSha(data) !== material.digest)
        throw new Error('SUITE_VERIFY_MATERIAL');
      materials.set(offlineKey(row), data);
      used.add(path);
    }
  }
  if (
    !rows.length ||
    rows.length > 1000 ||
    used.size !== decoded.entries.length ||
    new Set(rows.map((r) => r.workspaceId)).size !== 1
  )
    throw new Error('SUITE_VERIFY_GRAPH');
  const index = new Map(rows.map((row) => [offlineKey(row), row]));
  if (index.size !== rows.length) throw new Error('SUITE_VERIFY_DUPLICATE');
  const active = new Set<string>(),
    done = new Set<string>();
  const visit = (row: S.SuiteRecord) => {
    const key = offlineKey(row);
    if (done.has(key)) return;
    if (active.has(key)) throw new Error('SUITE_VERIFY_CYCLE');
    active.add(key);
    for (const reference of row.references) {
      const target = index.get(offlineKey(reference));
      if (!target) throw new Error('SUITE_VERIFY_DANGLING');
      visit(target);
    }
    active.delete(key);
    done.add(key);
  };
  rows.forEach(visit);
  const get = (reference: S.SuiteRef, owner?: S.SuiteRecord) => {
    const row = index.get(offlineKey(S.suiteRef.parse(reference)));
    if (!row || (owner && !owner.references.some((ref) => offlineKey(ref) === offlineKey(reference))))
      throw new Error('SUITE_VERIFY_INPUT_REFERENCE');
    return row;
  };
  return { rows, index, materials, manifestDigest: decoded.manifest.digest, get };
}
