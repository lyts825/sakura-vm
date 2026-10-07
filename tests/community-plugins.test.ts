/**
 * 模块职责：回归验证模块，围绕 `community-plugins` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `community-plugins`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: signed marketplace installs, runs, rejects tampering and unloads an isolated plugin; isolated plugin validation requires bounded memory and no host imports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { CommunityPlugins, signedPluginPayload, validatePluginWasm } from '../server/community-plugins.ts';
import { computeRuntime } from '../server/compute-runtime.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: number: number。
 * 结果：返回分支计算值（`bytes`）。
 * Result: Return the branch-computed value (`bytes`).
 * 状态影响 / State effects: `number`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `bytes.push`.
 */
const leb = (number: number) => {
  const bytes: number[] = [];
  do {
    const byte = number & 127;
    number >>>= 7;
    bytes.push(number ? byte | 128 : byte);
  } while (number);
  return bytes;
};
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: id: number; bytes: number[]。
 * 结果：返回列表形式的受控数据，供调用者遍历或比较。
 * Result: Return controlled data as a list for iteration or comparison.
 * 协作入口 / Collaborators: `leb`.
 */
const section = (id: number, bytes: number[]) => [id, ...leb(bytes.length), ...bytes];
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: value: string。
 * 结果：返回列表形式的受控数据，供调用者遍历或比较。
 * Result: Return controlled data as a list for iteration or comparison.
 * 协作入口 / Collaborators: `Buffer.from`, `leb`.
 */
const name = (value: string) => {
  const bytes = [...Buffer.from(value)];
  return [...leb(bytes.length), ...bytes];
};
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: maxPages = 1。
 * 结果：返回分支计算值（`Buffer.from([ 0, 97, 115, 109, 1, 0, 0, 0, ...section(1, [2, 0x60, 1, 0x7f, 1, 0…`）。
 * Result: Return the branch-computed value (`Buffer.from([ 0, 97, 115, 109, 1, 0, 0, 0, ...section(1, [2, 0x60, 1, 0x7f, 1, 0…`).
 * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `Buffer.alloc`, `output.writeUInt32LE`.
 */
function wasm(maxPages = 1) {
  const result = Buffer.from(JSON.stringify({ ok: true }));
  const output = Buffer.alloc(result.length + 4);
  output.writeUInt32LE(result.length, 0);
  result.copy(output, 4);
  const alloc = [0, 0x41, 32, 0x0b];
  const run = [0, 0x41, 0, 0x0b];
  return Buffer.from([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...section(1, [2, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 1, 0x7f]),
    ...section(3, [2, 0, 1]),
    ...section(5, [1, 1, 1, ...leb(maxPages)]),
    ...section(7, [3, ...name('memory'), 2, 0, ...name('alloc'), 0, 0, ...name('run'), 0, 1]),
    ...section(10, [2, ...leb(alloc.length), ...alloc, ...leb(run.length), ...run]),
    ...section(11, [1, 0, 0x41, 0, 0x0b, ...leb(output.length), ...output]),
  ]);
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: signed marketplace installs, runs, rejects tampering and unloads an isolated plugin
 * 状态影响 / State effects: `listing`, `computeRuntime.recover`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))`; `assert.deepEqual( await service.action({ operation: 'run', pluginId: base.id, input: { hello: 'world' } }), { pluginId: base.id, v…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('signed marketplace installs, runs, rejects tampering and unloads an isolated plugin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-community-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  const file = join(root, 'state.json'),
    directory = join(root, 'wasm');
  const bytes = wasm();
  const pair = generateKeyPairSync('ed25519');
  const pem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const fingerprint = createHash('sha256')
    .update(pair.publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex');
  const base = {
    schemaVersion: 1 as const,
    id: 'example-plugin',
    name: '示例插件',
    description: '返回固定 JSON，用于验证隔离执行链路。',
    version: '1.0.0',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    publisher: fingerprint,
    extensions: {
      routes: [{ id: 'inspect', name: 'Inspect' }],
      panels: [
        {
          id: 'summary',
          title: 'Summary',
          description: 'Inspect JSON',
          routeId: 'inspect',
          fields: [{ key: 'text', label: 'Text', type: 'text' as const, required: true }],
        },
      ],
    },
  };
  const entry = {
    ...base,
    signature: sign(null, signedPluginPayload(base), pair.privateKey).toString('base64'),
    wasmUrl: './example.wasm',
  };
  let listing = { schemaVersion: 1, plugins: [entry] };
  const sourceUrl = 'https://plugins.example/catalog.json';
  const service = new CommunityPlugins(file, directory, async (url) =>
    url === sourceUrl ? Buffer.from(JSON.stringify(listing)) : bytes,
  );
  try {
    await service.init();
    await service.action({ operation: 'trust', name: '示例发布者', publicKey: pem });
    await service.action({ operation: 'add-source', name: '示例目录', url: sourceUrl });
    const source = service.view().sources[0];
    await service.action({ operation: 'refresh', id: source.id });
    await service.action({ operation: 'install', sourceId: source.id, pluginId: base.id });
    assert.deepEqual(
      await service.action({ operation: 'run', pluginId: base.id, input: { hello: 'world' } }),
      { pluginId: base.id, version: '1.0.0', result: { ok: true } },
    );
    assert.deepEqual(await service.invokeRoute(base.id, 'inspect', { text: 'hello' }), {
      pluginId: base.id,
      version: '1.0.0',
      result: { ok: true },
    });
    await assert.rejects(service.invokeRoute(base.id, 'unknown', {}), /未声明/);
    const restored = new CommunityPlugins(file, directory);
    await restored.init();
    assert.deepEqual(await restored.action({ operation: 'run', pluginId: base.id, input: null }), {
      pluginId: base.id,
      version: '1.0.0',
      result: { ok: true },
    });
    await restored.close();
    await assert.rejects(service.action({ operation: 'untrust', fingerprint }), /先卸载/);

    listing = { schemaVersion: 1, plugins: [{ ...entry, name: '被篡改的名称' }] };
    await service.action({ operation: 'refresh', id: source.id });
    await assert.rejects(
      service.action({ operation: 'install', sourceId: source.id, pluginId: base.id }),
      /签名验证失败/,
    );
    assert.equal(service.view().installed[0].name, base.name);

    listing = {
      schemaVersion: 1,
      plugins: [
        {
          ...entry,
          extensions: {
            ...entry.extensions,
            panels: [{ ...entry.extensions.panels[0], title: 'Tampered panel' }],
          },
        },
      ],
    };
    await service.action({ operation: 'refresh', id: source.id });
    await assert.rejects(
      service.action({ operation: 'install', sourceId: source.id, pluginId: base.id }),
      /签名验证失败/,
    );

    await writeFile(
      join(directory, `${base.id}-${base.version}-${base.sha256}.wasm`),
      Buffer.from('tampered'),
    );
    await assert.rejects(service.action({ operation: 'run', pluginId: base.id, input: {} }), /SHA-256/);
    const damaged = new CommunityPlugins(file, directory);
    await damaged.init();
    assert.match(damaged.view().problems[base.id], /文件损坏/);
    await damaged.close();
    const recovery = computeRuntime.recover;
    computeRuntime.recover = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: signed marketplace installs, runs, rejects tampering and unloads an isolated plugin
     * 失败 / Failure: `new Error('original worker cleanup unconfirmed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => {
      throw new Error('original worker cleanup unconfirmed');
    };
    try {
      await assert.rejects(service.action({ operation: 'uninstall', pluginId: base.id }), /unconfirmed/);
      assert.equal(service.view().installed[0].phase, 'cleanup-pending');
      assert.equal(
        service.view().runtime.instances.find((item) => item.identity === 'community:' + base.id)?.phase,
        'cleanup-pending',
      );
      await assert.rejects(service.action({ operation: 'run', pluginId: base.id, input: {} }), {
        code: 'PLUGIN_REVOKED',
      });
      await assert.rejects(service.action({ operation: 'install', sourceId: source.id, pluginId: base.id }), {
        code: 'PLUGIN_CLEANUP_PENDING',
      });
      assert.equal(JSON.parse(await readFile(file, 'utf8')).installed[0].sha256, base.sha256);
    } finally {
      computeRuntime.recover = recovery;
    }
    await service.action({ operation: 'uninstall', pluginId: base.id });
    await assert.rejects(service.action({ operation: 'run', pluginId: base.id, input: {} }), /未安装/);
    await service.action({ operation: 'untrust', fingerprint });
    assert.equal(service.view().publishers.length, 0);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: isolated plugin validation requires bounded memory and no host imports
 * 协作入口 / Collaborators: `validatePluginWasm`, `wasm`, `assert.rejects`, `Buffer.from`.
 * 检查边界 / Checked boundaries: `assert.rejects(validatePluginWasm(wasm(257)), /16 MiB/)`; `assert.rejects(validatePluginWasm(Buffer.from('not wasm')), /WebAssembly v1/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('isolated plugin validation requires bounded memory and no host imports', async () => {
  await validatePluginWasm(wasm());
  await assert.rejects(validatePluginWasm(wasm(257)), /16 MiB/);
  await assert.rejects(validatePluginWasm(Buffer.from('not wasm')), /WebAssembly v1/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: event subscriptions trigger signed WASM once for new metadata-only events
 * 状态影响 / State effects: `now`, `persisted.observed[resumedId]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))`; `assert.equal(service.view().deliveries.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('event subscriptions trigger signed WASM once for new metadata-only events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-community-events-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  const file = join(root, 'state.json'),
    directory = join(root, 'wasm');
  const bytes = wasm();
  const pair = generateKeyPairSync('ed25519');
  const pem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const fingerprint = createHash('sha256')
    .update(pair.publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex');
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const base = {
    schemaVersion: 1 as const,
    id: 'event-plugin',
    name: 'Event',
    description: 'Event computation',
    version: '1.0.0',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    publisher: fingerprint,
  };
  const entry = {
    ...base,
    signature: sign(null, signedPluginPayload(base), pair.privateKey).toString('base64'),
    wasmUrl: './event.wasm',
  };
  const catalog = Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: [entry] }));
  const service = new CommunityPlugins(
    file,
    directory,
    async (url) => (url.endsWith('catalog.json') ? catalog : bytes),
    () => now,
    undefined,
    { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`events`），以 Promise 交付。
     * Result: Return the branch-computed value (`events`) through a Promise.
     * 验证场景 / Scenario: event subscriptions trigger signed WASM once for new metadata-only events
     */
    events: async () => events, schedule: false },
  );
  const events: Array<{
    id: string;
    type: 'job.finished';
    occurredAt: string;
    status: 'done';
    tags: string[];
  }> = [];
  try {
    await service.init();
    await service.action({ operation: 'trust', name: 'Publisher', publicKey: pem });
    await service.action({
      operation: 'add-source',
      name: 'Source',
      url: 'https://plugins.example/catalog.json',
    });
    const sourceId = service.view().sources[0].id;
    await service.action({ operation: 'refresh', id: sourceId });
    await service.action({ operation: 'install', sourceId, pluginId: base.id });

    await service.action({
      operation: 'subscribe',
      pluginId: base.id,
      types: ['job.finished'],
      enabled: true,
    });
    events.push({
      id: 'a'.repeat(64),
      type: 'job.finished',
      occurredAt: '2025-12-31T23:59:59.000Z',
      status: 'done',
      tags: [],
    });
    await service.tick();
    assert.equal(service.view().deliveries.length, 0);
    now += 1000;
    events.push({
      id: 'b'.repeat(64),
      type: 'job.finished',
      occurredAt: new Date(now).toISOString(),
      status: 'done',
      tags: [],
    });
    await service.tick();
    assert.equal(service.view().deliveries.length, 1);
    assert.equal(service.view().deliveries[0].status, 'done');
    assert.equal(service.view().deliveries[0].resultPreview, '{"ok":true}');
    await service.tick();
    assert.equal(service.view().deliveries.length, 1);
    await service.action({
      operation: 'subscribe',
      pluginId: base.id,
      types: ['job.finished'],
      enabled: false,
    });
    now += 1000;
    events.push({
      id: 'd'.repeat(64),
      type: 'job.finished',
      occurredAt: new Date(now).toISOString(),
      status: 'done',
      tags: [],
    });
    await service.tick();
    assert.equal(service.view().deliveries.length, 1);
    await service.action({
      operation: 'subscribe',
      pluginId: base.id,
      types: ['job.finished'],
      enabled: true,
    });
    await service.tick();
    assert.equal(service.view().deliveries.length, 1);
    await service.close();
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    const resumedEvent = {
      id: 'c'.repeat(64),
      type: 'job.finished',
      occurredAt: new Date(now).toISOString(),
      status: 'done',
      tags: [],
    };
    const resumedId = createHash('sha256').update(`${base.id}:${resumedEvent.id}`).digest('hex');
    persisted.deliveries.push({ id: resumedId, pluginId: base.id, event: resumedEvent, status: 'pending' });
    persisted.observed[resumedId] = now;
    await writeFile(file, JSON.stringify(persisted));
    const restored = new CommunityPlugins(file, directory, undefined, () => now, undefined, {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`events`），以 Promise 交付。
       * Result: Return the branch-computed value (`events`) through a Promise.
       * 验证场景 / Scenario: event subscriptions trigger signed WASM once for new metadata-only events
       */
      events: async () => events,
      schedule: false,
    });
    await restored.init();

    now += 50 * 3600000;
    await restored.tick();
    assert.equal(restored.view().deliveries.length, 2);
    assert.equal(restored.view().deliveries[0].status, 'done');
    await restored.action({ operation: 'schedule', pluginId: base.id, intervalMinutes: 1, enabled: true });
    now += 60_001;
    await restored.tick();
    assert.equal(restored.view().deliveries.length, 3);
    assert.equal(restored.view().deliveries[0].event.type, 'plugin.timer');
    assert.equal(restored.view().deliveries[0].status, 'done');
    await restored.tick();
    assert.equal(restored.view().deliveries.length, 3);
    const roundtrip = new CommunityPlugins(file, directory);
    await roundtrip.init();
    assert.equal(roundtrip.view().deliveries[0].event.type, 'plugin.timer');
    await roundtrip.close();
    await restored.action({ operation: 'unschedule', pluginId: base.id });
    assert.equal(restored.view().schedules.length, 0);
    await restored.action({ operation: 'uninstall', pluginId: base.id });
    assert.equal(restored.view().subscriptions.length, 0);
    await restored.close();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
