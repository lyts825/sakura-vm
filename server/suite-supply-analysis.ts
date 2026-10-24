/** 无 I/O 的固定依赖解析与公告匹配，只在有界计算线程或显式校验中使用。 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import * as A from '../shared/contracts/supply-audit.ts';
import { AppError } from '../shared/errors.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const supplyComponentKey = (
  component: Pick<
    z.infer<typeof A.supplyComponent>,
    'ecosystem' | 'name' | 'version' | 'source' | 'integrity' | 'location'
  >,
) =>
  hash([
    component.ecosystem,
    component.name,
    component.version,
    component.source,
    component.integrity,
    component.location,
  ]);
function fail(code: string): never {
  throw new AppError(code, 400, code);
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SUPPLY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
};
const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : '');
export function parseSupplyInventory(input: {
  text: string;
  format: string;
}): z.infer<typeof A.supplyInventory> {
  if (Buffer.byteLength(input.text) > 32 * 1024 ** 2) fail('SUPPLY_INPUT_LIMIT');
  if (input.format === 'text') {
    const components: z.infer<typeof A.supplyComponent>[] = [],
      names = new Set<string>();
    for (const line of input.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match =
        /^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9][A-Za-z0-9.+_-]*)\s+--hash=sha256:([a-fA-F0-9]{64})$/.exec(
          trimmed,
        );
      if (!match) fail('SUPPLY_REQUIREMENTS_UNSUPPORTED');
      const name = match[1].toLowerCase().replace(/[-_.]+/g, '-'),
        version = match[2],
        integrity = 'sha256:' + match[3].toLowerCase();
      const key = supplyComponentKey({
        ecosystem: 'python',
        name,
        version,
        source: 'declared-lock',
        integrity,
        location: name,
      });
      if (names.has(name)) fail('SUPPLY_DUPLICATE_COMPONENT');
      names.add(name);
      components.push({
        key,
        ecosystem: 'python',
        name,
        version,
        source: 'declared-lock',
        integrity,
        license: '',
        direct: true,
        location: name,
      });
      if (components.length > 50000) fail('SUPPLY_COMPONENT_LIMIT');
    }
    if (!components.length) fail('SUPPLY_EMPTY_INVENTORY');
    return A.supplyInventory.parse({
      parser: 'python-hashed/1',
      components,
      edges: [],
      warnings: ['Python 清单未声明依赖图与许可证，相关覆盖未知'],
      complete: false,
    });
  }
  if (input.format !== 'json') fail('SUPPLY_FORMAT_UNSUPPORTED');
  const parsed = object(parseSuiteJson(input.text, 32 * 1024 ** 2));
  if (parsed.format === 'sakura-components/1') {
    const schema = z
      .object({
        format: z.literal('sakura-components/1'),
        components: z.array(A.supplyComponent).min(1).max(50000),
      })
      .strict();
    const components = schema.parse(parsed).components;
    if (components.some((component) => component.key !== supplyComponentKey(component)))
      fail('SUPPLY_COMPONENT_IDENTITY');
    if (new Set(components.map((c) => c.key)).size !== components.length) fail('SUPPLY_DUPLICATE_COMPONENT');
    return A.supplyInventory.parse({
      parser: 'components/1',
      components,
      edges: [],
      warnings: ['清单属于来源声明，未核验实际安装字节'],
      complete: false,
    });
  }
  if (parsed.lockfileVersion !== 2 && parsed.lockfileVersion !== 3) fail('SUPPLY_LOCK_VERSION_UNSUPPORTED');
  const packages = object(parsed.packages),
    locations = Object.entries(packages);
  if (locations.length > 50001) fail('SUPPLY_COMPONENT_LIMIT');
  const components: z.infer<typeof A.supplyComponent>[] = [],
    byLocation = new Map<string, string>(),
    definitions = new Map<string, Record<string, unknown>>();
  const warnings: string[] = [];
  const root = object(packages[''] ?? {}),
    rootDeps = {
      ...object(root.dependencies ?? {}),
      ...object(root.devDependencies ?? {}),
      ...object(root.optionalDependencies ?? {}),
    };
  for (const [location, raw] of locations) {
    if (!location) continue;
    if (
      location.length > 1024 ||
      location.includes('\\') ||
      location.split('/').some((s) => !s || s === '.' || s === '..')
    )
      fail('SUPPLY_LOCK_LOCATION');
    const item = object(raw),
      name = text(item.name, 240) || location.split('node_modules/').at(-1)!;
    if (!/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name)) fail('SUPPLY_COMPONENT_NAME');
    const version = text(item.version, 120),
      source = text(item.resolved, 2048),
      integrity = text(item.integrity, 1024),
      license = text(item.license, 512);
    if (!version || item.link) {
      warnings.push(`${location}: 无精确版本或为链接组件`);
      continue;
    }
    const key = hash(['npm', name, version, source, integrity, location]);
    components.push({
      key,
      ecosystem: 'npm',
      name,
      version,
      source,
      integrity,
      license,
      direct: Object.hasOwn(rootDeps, name) && location === 'node_modules/' + name,
      location,
    });
    byLocation.set(location, key);
    definitions.set(location, item);
    const sri = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
    const digestBytes = sri ? Buffer.from(sri[2], 'base64') : null;
    const sizes: Record<string, number> = { sha256: 32, sha384: 48, sha512: 64 };
    if (
      !sri ||
      !digestBytes ||
      digestBytes.length !== sizes[sri[1]] ||
      digestBytes.toString('base64') !== sri[2]
    )
      warnings.push(`${location}: 内容摘要缺失或格式不受支持`);
    if (!source) warnings.push(`${location}: 缺少固定来源声明`);
    if (item.name && item.name !== location.split('node_modules/').at(-1))
      warnings.push(`${location}: 名称与安装位置不同，须核对别名`);
    if (item.peerDependencies && Object.keys(object(item.peerDependencies)).length)
      warnings.push(`${location}: peer 关系未纳入本版依赖图`);
  }
  if (!components.length) fail('SUPPLY_EMPTY_INVENTORY');
  const edges: z.infer<typeof A.supplyInventory>['edges'] = [];
  for (const component of components) {
    const deps = {
      ...object(definitions.get(component.location)?.dependencies ?? {}),
      ...object(definitions.get(component.location)?.optionalDependencies ?? {}),
    };
    for (const name of Object.keys(deps)) {
      let path = component.location,
        target: string | undefined;
      for (;;) {
        target = byLocation.get(path + '/node_modules/' + name);
        if (target) break;
        const cut = path.lastIndexOf('/node_modules/');
        if (cut < 0) {
          target = byLocation.get('node_modules/' + name);
          break;
        }
        path = path.slice(0, cut);
      }
      edges.push({ from: component.key, name, to: target ?? null });
      if (!target) warnings.push(`${component.location}: 依赖 ${name} 未解析`);
      if (edges.length > 250000) fail('SUPPLY_EDGE_LIMIT');
    }
  }
  return A.supplyInventory.parse({
    parser: 'npm-lock/' + parsed.lockfileVersion,
    components,
    edges,
    warnings: warnings.slice(0, 10000),
    complete: !warnings.length,
  });
}
export function importSupplyDataset(text: string): z.infer<typeof A.supplyAdvisoryDataset> {
  const dataset = A.supplyAdvisoryDataset.parse(parseSuiteJson(text));
  if (
    new Set(dataset.records.map((r) => r.id)).size !== dataset.records.length ||
    !Number.isFinite(Date.parse(dataset.collectedAt)) ||
    Date.parse(dataset.collectedAt) > Date.now() + 60000 ||
    dataset.records.some(
      (r) =>
        !Number.isFinite(Date.parse(r.issuedAt)) ||
        !Number.isFinite(Date.parse(r.modifiedAt)) ||
        Date.parse(r.issuedAt) > Date.parse(r.modifiedAt) ||
        Date.parse(r.modifiedAt) > Date.parse(dataset.collectedAt) + 60000,
    )
  )
    fail('SUPPLY_DATASET_INVALID');
  return dataset;
}
type Version = { parts: number[]; prerelease: string[] };
function semver(raw: string): Version | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(raw);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  for (const group of [match[4], match[5]])
    if (group && !group.split('.').every((s) => s.length && /^[0-9A-Za-z-]+$/.test(s))) return null;
  if (match[4]?.split('.').some((s) => /^\d+$/.test(s) && s.length > 1 && s.startsWith('0'))) return null;
  return { parts, prerelease: match[4]?.split('.') ?? [] };
}
function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] < b.parts[i] ? -1 : 1;
  if (!a.prerelease.length || !b.prerelease.length)
    return a.prerelease.length === b.prerelease.length ? 0 : !a.prerelease.length ? 1 : -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i],
      y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const nx = BigInt(x),
        ny = BigInt(y);
      return nx < ny ? -1 : 1;
    }
    if (/^\d+$/.test(x) !== /^\d+$/.test(y)) return /^\d+$/.test(x) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
export function matchSupplyAdvisories(raw: { inventory: unknown; dataset: unknown }) {
  const inventory = A.supplyInventory.parse(raw.inventory),
    dataset = A.supplyAdvisoryDataset.parse(raw.dataset);
  if (new Set(dataset.records.map((r) => r.id)).size !== dataset.records.length)
    fail('SUPPLY_DUPLICATE_ADVISORY');
  const indexed = new Map<string, z.infer<typeof A.supplyAdvisory>[]>();
  for (const record of dataset.records) {
    const key = record.ecosystem + ':' + record.name;
    indexed.set(key, [...(indexed.get(key) ?? []), record]);
  }
  const matches: {
    component: string;
    advisory: string;
    severity: string;
    status: 'affected' | 'unknown' | 'withdrawn';
    reason: string;
  }[] = [];
  for (const component of inventory.components) {
    for (const advisory of indexed.get(component.ecosystem + ':' + component.name) ?? []) {
      if (advisory.withdrawn) {
        matches.push({
          component: component.key,
          advisory: advisory.id,
          severity: advisory.severity,
          status: 'withdrawn',
          reason: '公告已撤回',
        });
        continue;
      }
      const value = semver(component.version);
      let affected = false,
        unknown = !value;
      for (const range of advisory.ranges) {
        const introduced =
            range.introduced === '0' ? { parts: [0, 0, 0], prerelease: [] } : semver(range.introduced),
          fixed = range.fixed === null ? null : semver(range.fixed);
        if (!value || !introduced || (range.fixed !== null && !fixed) || component.ecosystem !== 'npm') {
          unknown = true;
          continue;
        }
        if (fixed && range.introduced !== '0' && compare(introduced, fixed) >= 0) {
          unknown = true;
          continue;
        }
        if (
          (range.introduced === '0' || compare(value, introduced) >= 0) &&
          (!fixed || compare(value, fixed) < 0)
        )
          affected = true;
      }
      if (affected || unknown)
        matches.push({
          component: component.key,
          advisory: advisory.id,
          severity: advisory.severity,
          status: affected ? 'affected' : 'unknown',
          reason: affected ? '版本落入支持的公告区间' : '版本或生态规则不受支持',
        });
      if (matches.length > 100000) fail('SUPPLY_MATCH_LIMIT');
    }
  }
  return {
    dataset: { collectedAt: dataset.collectedAt, source: dataset.source, records: dataset.records.length },
    matches,
    evaluatedComponents: inventory.components.length,
    installedBytesVerified: false,
    sourceAuthenticated: false,
  };
}
export function classifySupplyLicenses(raw: unknown) {
  const inventory = A.supplyInventory.parse(raw);
  const recognized = new Set([
    'MIT',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    'MPL-2.0',
    'GPL-2.0-only',
    'GPL-3.0-only',
    'LGPL-2.1-only',
    'Unlicense',
  ]);
  return {
    declarationsOnly: true,
    legalConclusion: false,
    components: inventory.components.map((c) => {
      const tokens = c.license.match(/[A-Za-z0-9.+-]+|[()]/g) ?? [];
      const reconstructed = tokens.join(''),
        original = c.license.replace(/\s/g, '');
      const ids = tokens.filter((t) => !['AND', 'OR', 'WITH', '(', ')'].includes(t));
      let expectingOperand = true,
        depth = 0,
        grammar = true;
      for (const token of tokens) {
        if (expectingOperand) {
          if (token === '(') depth++;
          else if (recognized.has(token)) expectingOperand = false;
          else grammar = false;
        } else if (token === ')') {
          if (--depth < 0) grammar = false;
        } else if (token === 'AND' || token === 'OR') expectingOperand = true;
        else grammar = false;
      }
      return {
        component: c.key,
        expression: c.license,
        identifiers: ids,
        status:
          reconstructed === original &&
          ids.length &&
          ids.every((id) => recognized.has(id)) &&
          grammar &&
          depth === 0 &&
          !expectingOperand
            ? 'declared'
            : 'review-required',
        textVerified: false,
      };
    }),
  };
}
