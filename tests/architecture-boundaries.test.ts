import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { assertReleasedServiceCompatibility, createServiceCompatibilityProgram, readServiceReleaseBaselines,
  SERVICE_CONTRACT_ENTRY, SERVICE_RELEASE_DIRECTORY, serviceBaselineDigest, serviceCompatibilityErrors,
  type ServiceReleaseBaseline } from '../scripts/service-compatibility.ts';
import { freezeServiceRelease } from '../scripts/freeze-service-contracts.ts';
import { assertSystemServiceFactories, systemServiceFactoryErrors } from '../scripts/system-service-boundaries.ts';

const contractOptions: ts.CompilerOptions = { strict: true, noLib: true, types: [],
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
const contractEntry = resolve('server/service-contracts/compatibility-fixture.ts');
function compatibility(before: string, after: string, oldDto?: string, nextDto?: string) {
  const entry = 'server/service-contracts/compatibility-fixture.ts';
  const files = { [entry]: before, ...(oldDto ? { 'shared/compatibility-fixture.ts': oldDto } : {}) };
  const baseline = { release: 'fixture', commit: 'fixture', entry, files, digest: serviceBaselineDigest(files) };
  const overrides = new Map<string, string>([[contractEntry, after]]);
  if (nextDto) overrides.set(resolve('shared/compatibility-fixture.ts'), nextDto);
  const inputs = createServiceCompatibilityProgram(contractEntry, baseline, contractOptions, overrides);
  return serviceCompatibilityErrors(inputs.program, contractEntry, inputs.baselineEntry);
}

test('released service signatures reject parameter narrowing, required inputs and deleted optional DTO fields', () => {
  const before = 'export interface ApiV1 { run(input: { id: string; kind: "a" | "b"; note?: string }): { id: string; optional?: string }; }';
  assert.deepEqual(compatibility(before, before), []);
  assert.ok(compatibility(before, before.replace('"a" | "b"', '"a"')).some(error => /incompatible/.test(error)));
  assert.ok(compatibility(before, before.replace('note?:', 'note:')).some(error => /incompatible/.test(error)));
  assert.ok(compatibility(before, before.replace('optional?: string', 'added?: string')).some(error => /optional.*removed/.test(error)));
  assert.ok(compatibility(before, before.replace('{ id: string; optional?', '{ renamed: string; optional?')).some(error => /incompatible/.test(error)));
  assert.ok(compatibility(before, before.replace('{ id: string; optional?: string }', 'any')).some(error => /opaque/.test(error)));
  assert.deepEqual(compatibility(before, before.replace('"a" | "b"', 'string').replace('note?: string', 'note?: string; extra?: boolean')), []);
});

test('released service gate follows shared DTOs and enforces callback variance', () => {
  const before = 'import type { Dto } from "../../shared/compatibility-fixture.ts"; export interface ApiV1 { run(): Dto; }';
  const dto = 'export type Dto = { id: string; retained?: string };';
  assert.deepEqual(compatibility(before, before, dto, dto), []);
  assert.ok(compatibility(before, before, dto, dto.replace('retained?: string', 'added?: string')).some(error => /retained.*removed/.test(error)));
  const callbacks = 'export interface ApiV1 { run(callback: (value: "a" | "b") => void): void; }';
  assert.ok(compatibility(callbacks, callbacks.replace('"a" | "b"', 'string')).some(error => /incompatible/.test(error)));
});

test('every released baseline protects fields introduced after 2.1 and rejects missing or corrupt metadata', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-service-baselines-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  const directory = join(root, SERVICE_RELEASE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const entry = 'import type { Dto } from "../../shared/fixture.ts"; export interface ApiV1 { run(): Dto; }';
  const oldDto = 'export type Dto = { id: string };';
  const newDto = 'export type Dto = { id: string; introduced?: string };';
  const baseline = (release: string, dto: string): ServiceReleaseBaseline => {
    const files = { [SERVICE_CONTRACT_ENTRY]: entry, 'shared/fixture.ts': dto };
    return { release, commit: '1'.repeat(40), entry: SERVICE_CONTRACT_ENTRY, files, digest: serviceBaselineDigest(files) };
  };
  const earlier = baseline('2.1.0', oldDto), later = baseline('2.2.0', newDto);
  const write = (name: string, value: ServiceReleaseBaseline) => writeFile(join(directory, name), JSON.stringify(value));
  await write('2.1.0.json', earlier);
  const currentEntry = resolve(root, SERVICE_CONTRACT_ENTRY);
  const overrides = new Map([[currentEntry, entry], [resolve(root, 'shared/fixture.ts'), oldDto]]);
  await assertReleasedServiceCompatibility(currentEntry, contractOptions, { directory, overrides });
  await write('2.2.0.json', later);
  await assert.rejects(assertReleasedServiceCompatibility(currentEntry, contractOptions, { directory, overrides }),
    /compatibility violations \(2\.2\.0\):[\s\S]*introduced.*removed/);
  overrides.set(resolve(root, 'shared/fixture.ts'), newDto);
  await assertReleasedServiceCompatibility(currentEntry, contractOptions, { directory, overrides });
  await write('2.2.0.json', { ...later, release: '2.3.0' });
  await assert.rejects(readServiceReleaseBaselines(directory), /filename\/release mismatch/);
  await write('2.2.0.json', { ...later, digest: '0'.repeat(64) });
  await assert.rejects(readServiceReleaseBaselines(directory), /digest does not match/);
  const files = { 'shared/fixture.ts': newDto };
  await write('2.2.0.json', { ...later, files, digest: serviceBaselineDigest(files) });
  await assert.rejects(readServiceReleaseBaselines(directory), /Missing released service baseline entry/);
  await write('2.2.0.json', later);
  await rm(join(directory, '2.1.0.json'));
  await assert.rejects(readServiceReleaseBaselines(directory), /Missing released service baseline: 2\.1\.0/);
  await assert.rejects(readServiceReleaseBaselines(join(root, 'missing')), { code: 'ENOENT' });
});

test('explicit service freeze uses committed transitive type imports, refuses overwrite and checks previous releases', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-service-freeze-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  for (const path of [SERVICE_RELEASE_DIRECTORY, 'shared/nested']) await mkdir(join(root, path), { recursive: true });
  const entry = 'import type { Dto } from "../../shared/fixture.ts"; export interface ApiV1 { run(): Dto; }';
  const dto = 'export type Dto = import("./nested/details.ts").Details;';
  const original = 'export type Details = { id: string };';
  const extended = 'export type Details = { id: string; introduced?: string };';
  const files = { [SERVICE_CONTRACT_ENTRY]: entry, 'shared/fixture.ts': dto, 'shared/nested/details.ts': original };
  const oldBaseline: ServiceReleaseBaseline = { release: '2.1.0', commit: '1'.repeat(40), entry: SERVICE_CONTRACT_ENTRY,
    files, digest: serviceBaselineDigest(files) };
  const previousPath = join(root, SERVICE_RELEASE_DIRECTORY, '2.1.0.json');
  await writeFile(previousPath, JSON.stringify(oldBaseline));
  for (const [path, text] of Object.entries({ ...files, 'shared/nested/details.ts': extended })) await writeFile(join(root, path), text);
  await writeFile(join(root, 'package.json'), '{"version":"2.2.0","type":"module"}');
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    strict: true, noLib: true, types: [], module: 'ESNext', moduleResolution: 'Bundler', allowImportingTsExtensions: true, noEmit: true,
  } }));
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  const commit = () => {
    git('-c', 'core.autocrlf=false', 'add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'freeze fixture');
    return git('rev-parse', 'HEAD');
  };
  const revision = commit();
  await writeFile(join(root, SERVICE_CONTRACT_ENTRY), 'export interface DirtyV1 { changed(): never }');
  await writeFile(join(root, 'shared/nested/details.ts'), original);
  await writeFile(join(root, 'package.json'), '{"version":"9.9.9"}');
  const frozenCommand = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
    resolve('scripts/freeze-service-contracts.ts'), '--release', '2.2.0', '--commit', revision],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(frozenCommand.status, 0, frozenCommand.stderr);
  const destination = join(root, SERVICE_RELEASE_DIRECTORY, '2.2.0.json');
  assert.match(frozenCommand.stdout, /Frozen released service signatures:/);
  const frozen = JSON.parse(await readFile(destination, 'utf8')) as ServiceReleaseBaseline;
  assert.equal(frozen.commit, revision);
  assert.equal(frozen.release, '2.2.0');
  assert.equal(frozen.files[SERVICE_CONTRACT_ENTRY], entry);
  assert.equal(frozen.files['shared/fixture.ts'], dto);
  assert.equal(frozen.files['shared/nested/details.ts'], extended);
  assert.deepEqual(Object.keys(frozen.files).sort(), Object.keys(files).sort());
  assert.equal(frozen.digest, serviceBaselineDigest(frozen.files));
  const preserved = await readFile(destination, 'utf8');
  await assert.rejects(freezeServiceRelease('2.2.0', revision, root), { code: 'EEXIST' });
  await assert.rejects(freezeServiceRelease('2.3.0', revision, root), /Committed package version does not match/);
  await writeFile(join(root, SERVICE_CONTRACT_ENTRY), entry);
  await writeFile(join(root, 'package.json'), '{"version":"2.3.0","type":"module"}');
  const incompatible = commit();
  await assert.rejects(freezeServiceRelease('2.3.0', incompatible, root), /2\.2\.0[\s\S]*introduced.*removed/);
  await assert.rejects(readFile(join(root, SERVICE_RELEASE_DIRECTORY, '2.3.0.json')), { code: 'ENOENT' });
  await writeFile(join(root, 'shared/fixture.ts'), 'export type Dto = import("./missing.ts").Details;');
  const unresolved = commit();
  await assert.rejects(freezeServiceRelease('2.3.0', unresolved, root), /Committed service contract import cannot be resolved/);
  assert.equal(await readFile(destination, 'utf8'), preserved);
  assert.equal(await readFile(previousPath, 'utf8'), JSON.stringify(oldBaseline));
});

test('system implementation binding rejects narrowed methods while the released V1 declaration remains unchanged', () => {
  const declaration = 'export interface ExampleV1 { method(input: string): string; }';
  assert.deepEqual(compatibility(declaration, declaration), []);
  const check = (parameter: string) => {
    const file = resolve('server/service-contracts/v1.ts');
    const code = declaration + `
      type SystemServiceContracts = { Example: ExampleV1 };
      type SystemDefinition<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K]> = {
        id: K; requires: readonly string[];
        create(dependencies: {}): T;
        initialize(value: T, dependencies: {}): void;
        dispose(value: T | undefined, dependencies: {}): void;
      };
      declare class SystemServices {
        register<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K]>(definition: SystemDefinition<K, T>): void;
      }
      class Implementation { method(input: ${parameter}): string { return 'done'; } }
      const system = new SystemServices();
      system.register({ id: 'Example', requires: [], create: dependencies => new Implementation(),
        initialize: (value, dependencies) => {}, dispose: (value, dependencies) => {} });`;
    const host = ts.createCompilerHost(contractOptions);
    host.getSourceFile = path => resolve(path) === file ? ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true) : undefined;
    assertSystemServiceFactories([file], contractOptions, host);
  };
  assert.doesNotThrow(() => check('string'));
  assert.doesNotThrow(() => check('string | number'));
  assert.throws(() => check('"fixed"'), /Service implementation bindings failed:[\s\S]*Type 'string' is not assignable to type '"fixed"'/);
});

test('system factory gate rejects service handles hidden in aliases, containers and callbacks', () => {
  const preamble = 'interface ProviderV1 { ping(): number }\n' +
    'class SystemServices { start(definition: { requires: string[]; create(deps: { get(id: string): ProviderV1 }): unknown }): void {} }\n' +
    'const system = new SystemServices(); const provider: ProviderV1 = { ping: () => 1 };\n' +
    'const container = { nested: provider }; const hidden = () => provider.ping();\n';
  const check = (body: string) => {
    const file = resolve('server/system-factory-fixture.ts'), code = preamble + body;
    const host = ts.createCompilerHost(contractOptions);
    host.getSourceFile = path => resolve(path) === file ? ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true) : undefined;
    const program = ts.createProgram([file], contractOptions, host), source = program.getSourceFile(file)!;
    const contract = source.statements.find(ts.isInterfaceDeclaration)!;
    return systemServiceFactoryErrors(source, program.getTypeChecker(), [program.getTypeChecker().getTypeAtLocation(contract)]);
  };
  assert.deepEqual(check('system.start({ requires: ["provider"], create: deps => deps.get("provider").ping() });'), []);
  for (const capture of ['provider.ping()', 'container.nested.ping()', 'hidden()'])
    assert.ok(check('system.start({ requires: [], create: () => ' + capture + ' });').some(error => /captures a service/.test(error)), capture);
  assert.ok(check('system.start({ requires: [], "create": () => provider.ping() });').some(error => /captures a service/.test(error)));
  for (const bypass of [
    'system.start({ requires: [], create() { return provider.ping(); } });',
    'const create = () => provider.ping(); system.start({ requires: [], create });',
    'const callbacks = { create: () => provider.ping() }; system.start({ requires: [], ...callbacks });',
    'system.start({ requires: [], ["create"]: () => provider.ping() });',
    'const start = system.start; start({ requires: [], create: () => provider.ping() });',
    'const { start } = system; start({ requires: [], create: () => provider.ping() });',
    'system["start"]({ requires: [], create: () => provider.ping() });',
    'system.start({ requires: [], create: () => ({} as any) });',
  ]) assert.ok(check(bypass).length, bypass);
});

test('architecture gate rejects cycles and indirect browser dependencies while allowing type edges', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-architecture-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  for (const name of ['server', 'src', 'shared', 'plugins/example'])
    await mkdir(join(root, name), { recursive: true });
  const check = () => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
    resolve('scripts/check-architecture.ts')], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const write = (name: string, code: string) => writeFile(join(root, name), code);
  await write('server/a.ts', "import type { B } from './b.ts'; export type A = { b: B };");
  await write('server/b.ts', "import type { A } from './a.ts'; export type B = { a: A };");
  let result = check();
  assert.equal(result.status, 0, result.stderr);
  await write('server/a.ts', "import './b.ts';");
  await write('server/b.ts', "import './a.ts';");
  result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Circular value dependencies/);
  await write('server/b.ts', 'export const value = 1;');
  await write('plugins/example/client.tsx', "import './helper.ts';");
  await write('plugins/example/helper.ts', "import '../../server/b.ts';");
  result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /browser runtime dependency on server\/b.ts/);
  await write('plugins/example/helper.ts', "import 'node:fs';");
  result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /browser dependency on node:fs/);
});
