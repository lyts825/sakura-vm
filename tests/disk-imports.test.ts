/**
 * 模块职责：回归验证模块，围绕 `disk-imports` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `disk-imports`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: checksum is checked before publication, and converted disk receives independent identity; OVA imports a single referenced disk and rejects duplicate or unsafe members.
 */
type GatewayFixtureHost = import('../server/features.ts').Features;
type GatewayFixtureBody = Parameters<GatewayFixtureHost['route']>[3];
const admittedRouteFixtures = new WeakMap<GatewayFixtureHost, {
  gateway: import('../server/operation-gateway.ts').OperationGateway;
  bodies: WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>;
}>();
/** Preserve the fixture's data-directory setup before loading the real operation admission modules. */
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: host: GatewayFixtureHost; req: import('node:http').IncomingMessage; res: import('node:http').ServerResponse; url: URL; body: GatewayFixtureBody。
 * 结果：返回分支计算值（`await fixture.gateway.dispatch(req, res, url) as boolean`），以 Promise 交付。
 * Result: Return the branch-computed value (`await fixture.gateway.dispatch(req, res, url) as boolean`) through a Promise.
 * 状态影响 / State effects: `fixture`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `admittedRouteFixtures.get`, `Promise.all`, `import`, `gateway.register`.
 */
async function routeThroughGateway(host: GatewayFixtureHost, req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse, url: URL, body: GatewayFixtureBody) {
  let fixture = admittedRouteFixtures.get(host);
  if (!fixture) {
    const [{ OperationGateway }, { operationEntries }] = await Promise.all([
      import('../server/operation-gateway.ts'), import('../server/operation-catalog.ts'),
    ]);
    const bodies = new WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>();
    const gateway = new OperationGateway({
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`host.enabled`）。
       * Result: Return the branch-computed value (`host.enabled`).
       */
      enabled: () => host.enabled,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: owner。
       * 结果：返回分支计算值（`owner === 'core' ? undefined : host.directory.get('official', owner)`）。
       * Result: Return the branch-computed value (`owner === 'core' ? undefined : host.directory.get('official', owner)`).
       * 协作入口 / Collaborators: `host.directory.get`.
       */
      instance: owner => owner === 'core' ? undefined : host.directory.get('official', owner),
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: _request; _url; _entry; _parameters; requireEnabled。
       * 结果：返回受控对象，公开字段包括 `check`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `check`; the actual branch determines its shape.
       * 协作入口 / Collaborators: `requireEnabled`.
       */
      bind: async (_request, _url, _entry, _parameters, requireEnabled) => {
        requireEnabled();
        return { /**
         * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
         * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`'owner'`），以 Promise 交付。
         * Result: Return the branch-computed value (`'owner'`) through a Promise.
         */
        check: async () => 'owner' };
      },
    });
    for (const entry of operationEntries)
      if (entry.declaration.method !== 'UPGRADE')
        gateway.register(entry, (request, response, target) => host.route(request, response, target, bodies.get(request)!));
    gateway.seal();
    fixture = { gateway, bodies };
    admittedRouteFixtures.set(host, fixture);
  }
  fixture.bodies.set(req, body);
  return await fixture.gateway.dispatch(req, res, url) as boolean;
}
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Machines } from '../server/machines.ts';
import { createSchema, type VMView } from '../shared/contracts/vm.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-disk-imports-'));
process.env.SAKURA_DATA_DIR = root;
const { DiskImports } = await import('../server/disk-imports.ts');
const { Features } = await import('../server/features.ts');
after(() => rm(root, { recursive: true, force: true }));

const GiB = 1024 ** 3;
const qcow = Buffer.alloc(104);
qcow.writeUInt32BE(0x514649fb);
qcow.writeUInt32BE(3, 4);
qcow.writeBigUInt64BE(2n * BigInt(GiB), 24);
const vmdk = Buffer.alloc(1024);
vmdk.write('KDMV');
let adopted = 0;
const machines = {
  engine: {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; args: string[]。
     * 结果：返回分支计算值（`JSON.stringify({ required: qcow.length }) / ''`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ required: qcow.length }) / ''`) through a Promise.
     * 协作入口 / Collaborators: `JSON.stringify`, `writeFile`, `args.at`.
     */
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'measure') return JSON.stringify({ required: qcow.length });
      if (args[0] === 'convert') {
        await writeFile(args.at(-1)!, qcow);
        return '';
      }
      return JSON.stringify(args[2] === 'qcow2'
        ? { format: 'qcow2', 'virtual-size': 2 * GiB }
        : { format: args[2], 'virtual-size': 2 * GiB, 'format-specific': { data: {
          'create-type': 'monolithicSparse', extents: [{ filename: args.at(-1) }],
        } } });
    },
  },
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: config: unknown; _disk: string; options: Parameters<Machines['importDisk']>[2]。
   * 结果：返回分支计算值（`({ ...createSchema.parse(config), id: `imported-${++adopted}`, createdAt: new Da…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...createSchema.parse(config), id: `imported-${++adopted}`, createdAt: new Da…`) through a Promise.
   * 协作入口 / Collaborators: `createSchema.parse`, `new Date(0).toISOString`.
   */
  importDisk: async (
    config: unknown,
    _disk: string,
    options: Parameters<Machines['importDisk']>[2],
  ): Promise<VMView> => ({
    ...createSchema.parse(config),
    id: `imported-${++adopted}`,
    createdAt: new Date(0).toISOString(),
    snapshots: [],
    bootstrapped: false,
    pendingResize: !!options?.pendingResize,
    status: 'stopped',
    poweredOn: false,
    diskBytes: qcow.length,
  }),
} as unknown as Machines;
const importer = new DiskImports(machines);
const input = { name: 'other-linux', format: 'raw', distro: 'alpine', memoryMiB: 512, cpus: 1 };

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: name: string; payload: Buffer。
 * 结果：返回分支计算值（`Buffer.concat([header, payload, Buffer.alloc((512 - payload.length % 512) % 512)…`）。
 * Result: Return the branch-computed value (`Buffer.concat([header, payload, Buffer.alloc((512 - payload.length % 512) % 512)…`).
 * 状态影响 / State effects: `checksum`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Buffer.alloc`, `header.write`, `payload.length.toString(8).padStart`, `payload.length.toString`.
 */
function tarEntry(name: string, payload: Buffer) {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(payload.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write('0', 156);
  header.write('ustar\0', 257);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, payload, Buffer.alloc((512 - payload.length % 512) % 512)]);
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: entries: [string, Buffer][]。
 * 结果：返回分支计算值（`Buffer.concat([ ...entries.map(([name, content]) => tarEntry(name, content)), Bu…`）。
 * Result: Return the branch-computed value (`Buffer.concat([ ...entries.map(([name, content]) => tarEntry(name, content)), Bu…`).
 * 协作入口 / Collaborators: `Buffer.concat`, `entries.map`, `Buffer.alloc`.
 */
const ova = (...entries: [string, Buffer][]) => Buffer.concat([
  ...entries.map(([name, content]) => tarEntry(name, content)), Buffer.alloc(1024),
]);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: checksum is checked before publication, and converted disk receives independent identity
 * 协作入口 / Collaborators: `Buffer.alloc`, `createHash('sha256').update(raw).digest`, `createHash('sha256').update`, `createHash`.
 * 检查边界 / Checked boundaries: `assert.rejects(importer.import({ ...input, sha256: '0'.repeat(64) }, Readable.from([raw])), /SHA-256/)`; `assert.equal(adopted, previous)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('checksum is checked before publication, and converted disk receives independent identity', async () => {
  const raw = Buffer.alloc(2048);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const previous = adopted;
  await assert.rejects(importer.import({ ...input, sha256: '0'.repeat(64) }, Readable.from([raw])), /SHA-256/);
  assert.equal(adopted, previous);
  const result = await importer.import({ ...input, sha256 }, Readable.from([raw]));
  assert.equal(result.vm.id, `imported-${previous + 1}`);
  assert.equal(result.source.sha256, sha256);
  assert.equal(result.source.virtualBytes, 2 * GiB);
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: OVA imports a single referenced disk and rejects duplicate or unsafe members
 * 协作入口 / Collaborators: `Buffer.from`, `ova`, `importer.import`, `Readable.from`.
 * 检查边界 / Checked boundaries: `assert.equal(result.source.member, 'disk.vmdk')`; `assert.rejects(importer.import({ ...input, format: 'ova' }, Readable.from([ova(['vm.ovf', ovf], ['a.vmdk', vmdk], ['b.vmdk', vmdk]…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('OVA imports a single referenced disk and rejects duplicate or unsafe members', async () => {
  const ovf = Buffer.from('<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1"><References><File href="disk.vmdk"/></References></Envelope>');
  const valid = ova(['vm.ovf', ovf], ['disk.vmdk', vmdk]);
  const result = await importer.import({ ...input, name: 'ova-linux', format: 'ova' }, Readable.from([valid]));
  assert.equal(result.source.member, 'disk.vmdk');
  const before = adopted;
  await assert.rejects(importer.import({ ...input, format: 'ova' }, Readable.from([ova(['vm.ovf', ovf], ['a.vmdk', vmdk], ['b.vmdk', vmdk])])), /多磁盘/);
  await assert.rejects(importer.import({ ...input, format: 'ova' }, Readable.from([ova(['vm.ovf', ovf], ['../disk.vmdk', vmdk])])), /路径无效/);
  assert.equal(adopted, before);
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: external dependencies and invalid format headers do not publish an instance
 * 协作入口 / Collaborators: `assert.rejects`, `importer.import`, `Readable.from`, `Buffer.alloc`.
 * 检查边界 / Checked boundaries: `assert.rejects(importer.import({ ...input, format: 'vmdk' }, Readable.from([Buffer.alloc(1024)])), /单文件稀疏 VMDK/)`; `assert.rejects(new DiskImports(dependent).import(input, Readable.from([Buffer.alloc(1024)])), /外部磁盘/)`.
 */
test('external dependencies and invalid format headers do not publish an instance', async () => {
  const before = adopted;
  await assert.rejects(importer.import({ ...input, format: 'vmdk' }, Readable.from([Buffer.alloc(1024)])), /单文件稀疏 VMDK/);
  const dependent = {
    engine: { /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`JSON.stringify({ format: 'raw', 'virtual-size': 2 * GiB, 'backing-filename': 'pa…`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ format: 'raw', 'virtual-size': 2 * GiB, 'backing-filename': 'pa…`) through a Promise.
     * 验证场景 / Scenario: external dependencies and invalid format headers do not publish an instance
     * 协作入口 / Collaborators: `JSON.stringify`.
     */
    run: async () => JSON.stringify({ format: 'raw', 'virtual-size': 2 * GiB, 'backing-filename': 'parent.raw' }) },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: external dependencies and invalid format headers do not publish an instance
     * 失败 / Failure: `new Error('unexpected publish')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    importDisk: async () => { throw new Error('unexpected publish'); },
  } as unknown as Machines;
  await assert.rejects(new DiskImports(dependent).import(input, Readable.from([Buffer.alloc(1024)])), /外部磁盘/);
  assert.equal(adopted, before);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a small cloud image is expanded to the distribution minimum before publication
 * 协作入口 / Collaborators: `new DiskImports(small).import`, `Readable.from`, `Buffer.alloc`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.source.virtualBytes, 128 * 1024 ** 2)`; `assert.ok(calls.some((args) => args[0] === 'resize' && args.at(-1) === '4G'))`.
 */
test('a small cloud image is expanded to the distribution minimum before publication', async () => {
  const calls: string[][] = [];
  let published: { config: any; options: any } | undefined;
  const small = {
    engine: { /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; args: string[]。
     * 结果：返回分支计算值（`JSON.stringify({ required: qcow.length }) / ''`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ required: qcow.length }) / ''`) through a Promise.
     * 验证场景 / Scenario: a small cloud image is expanded to the distribution minimum before publication
     * 协作入口 / Collaborators: `calls.push`, `JSON.stringify`, `writeFile`, `args.at`.
     */
    run: async (_tool: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'measure') return JSON.stringify({ required: qcow.length });
      if (args[0] === 'convert') { await writeFile(args.at(-1)!, qcow); return ''; }
      return JSON.stringify(args[2] === 'qcow2'
        ? { format: 'qcow2', 'virtual-size': 4 * GiB }
        : { format: 'raw', 'virtual-size': 128 * 1024 ** 2 });
    } },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: config: any; _disk: string; options: any。
     * 结果：返回受控对象，公开字段包括 `id`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id`; the actual branch determines its shape.
     * 验证场景 / Scenario: a small cloud image is expanded to the distribution minimum before publication
     * 状态影响 / State effects: `published`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    importDisk: async (config: any, _disk: string, options: any) => {
      published = { config, options };
      return { id: 'expanded' };
    },
  } as unknown as Machines;
  const result = await new DiskImports(small).import({
    ...input, name: 'small-ubuntu', distro: 'ubuntu', memoryMiB: 1024,
  }, Readable.from([Buffer.alloc(1024)]));
  assert.equal(result.source.virtualBytes, 128 * 1024 ** 2);
  assert.ok(calls.some((args) => args[0] === 'resize' && args.at(-1) === '4G'));
  assert.equal(published?.config.diskGiB, 4);
  assert.equal(published?.options.pendingResize, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the images plugin accepts a binary upload and returns its published instance
 * 协作入口 / Collaborators: `Features.create`, `Object.assign`, `Readable.from`, `Buffer.alloc`.
 * 检查边界 / Checked boundaries: `assert.equal(await routeThroughGateway(features, request, response, url, async () => undefined), true)`; `assert.equal(response.status, 201)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the images plugin accepts a binary upload and returns its published instance', async () => {
  const features = await Features.create(machines, ['images']);
  const request = Object.assign(Readable.from([Buffer.alloc(2048)]), {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' },
  }) as IncomingMessage;
  const response = Object.assign(new EventEmitter(), {
    writableFinished: false,
    status: 0,
    payload: undefined as any,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: status: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: the images plugin accepts a binary upload and returns its published instance
     * 状态影响 / State effects: `this.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    writeHead(status: number) { this.status = status; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: the images plugin accepts a binary upload and returns its published instance
     * 状态影响 / State effects: `this.payload`, `this.writableFinished`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `JSON.parse`.
     */
    end(value: string) { this.payload = JSON.parse(value); this.writableFinished = true; },
  }) as unknown as ServerResponse & { status: number; payload: any };
  try {
    const url = new URL('http://localhost/api/image-import?name=via-api&format=raw&distro=alpine&memoryMiB=512&cpus=1');
    assert.equal(await routeThroughGateway(features, request, response, url, async () => undefined), true);
    assert.equal(response.status, 201);
    assert.match(response.payload.vm.id, /^imported-/);
    assert.equal(response.payload.source.format, 'raw');
  } finally {
    await features.close();
  }
});
