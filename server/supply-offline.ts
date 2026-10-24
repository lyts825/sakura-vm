/** 独立运行包的纯计算核验入口，不载入宿主、账号、磁盘服务或网络。 */
import { createHash } from 'node:crypto';
import { decodeSuiteBundle } from '../scripts/suite-bundle.mjs';
import * as S from '../shared/contracts/suite-common.ts';
import * as A from '../shared/contracts/supply-audit.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import {
  parseSupplyInventory,
  matchSupplyAdvisories,
  classifySupplyLicenses,
  importSupplyDataset,
} from './suite-supply-analysis.ts';
const canonical = (v: unknown): string =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? '[' + v.map(canonical).join(',') + ']'
      : '{' +
        Object.entries(v)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
          .join(',') +
        '}';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const key = (r: S.SuiteRef) => `${r.domain}:${r.id}:${r.revision}`;
const domains = new Set([
  'supply-sources',
  'supply-inventory',
  'supply-advisories',
  'supply-licenses',
  'supply-provenance',
  'supply-policies',
  'supply-reviews',
  'supply-reports',
]);
export function verifySupplyBundle(bytes: Uint8Array) {
  const decoded = decodeSuiteBundle(bytes, 'sakura-supply-audit/1'),
    rows: S.SuiteRecord[] = [],
    materials = new Map<string, Buffer>(),
    used = new Set<string>();
  for (const entry of decoded.entries.filter((e) => e.path.startsWith('objects/'))) {
    if (entry.data.length > 8 * 1024 ** 2) throw new Error('SUPPLY_VERIFY_OBJECT_LIMIT');
    const value: unknown = parseSuiteJson(
      new TextDecoder('utf-8', { fatal: true }).decode(entry.data),
      8 * 1024 ** 2,
    );
    if (!S.isSuiteJsonBounded(value)) throw new Error('SUPPLY_VERIFY_OBJECT_LIMIT');
    const row = S.suiteRecord.parse(value);
    if (
      !domains.has(row.domain) ||
      row.state !== 'sealed' ||
      entry.path !== `objects/${row.domain}/${row.id}-${row.revision}.json`
    )
      throw new Error('SUPPLY_VERIFY_OBJECT');
    if (
      sha(
        canonical({
          id: row.id,
          parent: row.parent,
          sequence: row.sequence,
          content: row.content,
          references: row.references,
        }),
      ) !== row.revision
    )
      throw new Error('SUPPLY_VERIFY_REVISION');
    rows.push(row);
    used.add(entry.path);
    if (row.kind === 'source') {
      if (row.domain !== 'supply-sources') throw new Error('SUPPLY_VERIFY_SOURCE_DOMAIN');
      const m = S.suiteMaterial.parse(row.content),
        path = `materials/${row.id}-${row.revision}.bin`,
        data = decoded.entries.find((e) => e.path === path)?.data;
      if (!data || data.length !== m.bytes || sha(data) !== m.digest)
        throw new Error('SUPPLY_VERIFY_MATERIAL');
      materials.set(key(row), data);
      used.add(path);
    }
  }
  if (!rows.length || rows.length > 1000 || used.size !== decoded.entries.length)
    throw new Error('SUPPLY_VERIFY_GRAPH');
  const index = new Map(rows.map((r) => [key(r), r]));
  if (index.size !== rows.length) throw new Error('SUPPLY_VERIFY_DUPLICATE');
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (row: S.SuiteRecord) => {
    const id = key(row);
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error('SUPPLY_VERIFY_CYCLE');
    visiting.add(id);
    for (const ref of row.references) {
      const target = index.get(key(ref));
      if (!target) throw new Error('SUPPLY_VERIFY_DANGLING');
      visit(target);
    }
    visiting.delete(id);
    done.add(id);
  };
  rows.forEach(visit);
  const recomputed: { reference: S.SuiteRef; check: string; equal: boolean }[] = [];
  const check = (row: S.SuiteRecord, name: string, result: unknown) => {
    const equal = sha(canonical(result)) === sha(canonical(row.content));
    recomputed.push({
      reference: { domain: row.domain, id: row.id, revision: row.revision },
      check: name,
      equal,
    });
    if (!equal) throw new Error('SUPPLY_VERIFY_RECOMPUTATION_MISMATCH:' + key(row));
  };
  for (const row of rows.filter((r) => r.kind === 'result')) {
    if (row.domain === 'supply-inventory' && A.supplyInventory.safeParse(row.content).success) {
      const source = row.references.map((r) => index.get(key(r))!).find((r) => r.kind === 'source');
      if (!source) throw new Error('SUPPLY_VERIFY_INVENTORY_SOURCE');
      check(
        row,
        'inventory-parser/1',
        parseSupplyInventory({
          text: new TextDecoder('utf-8', { fatal: true }).decode(materials.get(key(source))!),
          format: S.suiteMaterial.parse(source.content).format,
        }),
      );
    } else if (row.domain === 'supply-advisories' && A.supplyAdvisoryDataset.safeParse(row.content).success) {
      const source = row.references.map((r) => index.get(key(r))!).find((r) => r.kind === 'source');
      if (!source) throw new Error('SUPPLY_VERIFY_DATASET_SOURCE');
      check(
        row,
        'advisory-dataset/1',
        importSupplyDataset(new TextDecoder('utf-8', { fatal: true }).decode(materials.get(key(source))!)),
      );
    } else if (row.domain === 'supply-advisories' && A.supplyMatching.safeParse(row.content).success) {
      const inputs = row.references.map((r) => index.get(key(r))!),
        inventory = inputs.find((r) => A.supplyInventory.safeParse(r.content).success),
        dataset = inputs.find((r) => A.supplyAdvisoryDataset.safeParse(r.content).success);
      if (!inventory || !dataset) throw new Error('SUPPLY_VERIFY_MATCH_INPUT');
      check(
        row,
        'advisory-match/1',
        matchSupplyAdvisories({ inventory: inventory.content, dataset: dataset.content }),
      );
    } else if (row.domain === 'supply-licenses' && A.supplyLicenseResult.safeParse(row.content).success) {
      const inventory = row.references
        .map((r) => index.get(key(r))!)
        .find((r) => A.supplyInventory.safeParse(r.content).success);
      if (!inventory) throw new Error('SUPPLY_VERIFY_LICENSE_INPUT');
      check(row, 'license-declaration/1', classifySupplyLicenses(inventory.content));
    }
  }
  return {
    format: 'sakura-supply-audit/1',
    byteIntegrity: 'verified',
    sourceAuthentication: 'unauthenticated',
    objects: rows.length,
    materials: materials.size,
    manifestDigest: decoded.manifest.digest,
    recomputed,
    notRecomputed: [
      '人工审阅与用途例外',
      '当前公告时效与撤回状态',
      '当前来源信任及已安装字节',
      '业务门槛与报告结论',
    ],
  };
}
