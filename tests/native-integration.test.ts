/**
 * 模块职责：回归验证模块，围绕 `native-integration` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `native-integration`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: Windows registration quotes executable paths, preserves trailing root separators and never sets extension defaults; native settings persist a repair journal before registry changes and recover after restart.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import {
  NativeIntegration,
  nativeRegistration,
  checkedHostPath,
  nativeRequest,
} from '../server/native-integration.ts';
import { windowsRegistry, systemExecutable, type RegistryEntry } from '../server/windows-shell.ts';
import type { NativeMapping, NativeSettings } from '../shared/native-integration.ts';
// @ts-ignore: the helper is deliberately dependency-free JavaScript for released installs.
import { parseNativeArguments, requestNativeOpen } from '../scripts/native-open.mjs';

const vmId = '11111111-1111-4111-8111-111111111111';
const settings: NativeSettings = {
  contextMenu: true,
  editor: 'notepad',
  associations: [{ extension: '.txt', vmId, projectId: 'default' }],
};
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: any; adapter: (a: RegistryEntry[], b: RegistryEntry[]) => Promise<void>。
 * 结果：返回受控对象，公开字段包括 `service, dir, file, host, mapping, launches, registry, runtime, setMappings`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, dir, file, host, mapping, launches, registry, runtime, setMappings`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: any, adapter?: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: a: RegistryEntry[]; b: RegistryEntry[]。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(a: RegistryEntry[], b: RegistryEntry[]) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sakura-native-'));
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const host = join(dir, '项目 & $()');
  await mkdir(host);
  await writeFile(join(host, 'hello & 中文.txt'), 'hello');
  const mapping: NativeMapping = { vmId, projectId: 'default', name: 'demo', host, guest: '/workspace/中文' };
  let mappings = [mapping];
  const launches: any[] = [],
    registry: any[] = [];
  const runtime = {
    supported: true,
    node: process.execPath,
    helper: resolve('scripts/native-open.mjs'),
    port: 7337,
  };
  const file = join(dir, 'native.json');
  let now = Date.now();
  const service = new NativeIntegration(
    async () => mappings,
    file,
    adapter ||
      (async (a, b) => {
        registry.push([a, b]);
      }),
    async (file, args) => {
      launches.push({ file, args });
    },
    runtime,
    undefined,
    () => now,
  );
  t.after(() => service.close());
  await service.init();
  return {
    service,
    dir,
    file,
    host,
    mapping,
    launches,
    registry,
    runtime,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: NativeMapping[]。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `mappings`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setMappings: (value: NativeMapping[]) => {
      mappings = value;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    advance: () => {
      now += 300001;
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows registration quotes executable paths, preserves trailing root separators and never sets extension defaults
 * 协作入口 / Collaborators: `nativeRegistration`, `assert.equal`, `entries.filter`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(entries.filter((e) => e.path.endsWith('command')).length, 4)`; `assert.ok(entries.some((e) => e.value.endsWith('--shell-path "%V|"')))`.
 */
test('Windows registration quotes executable paths, preserves trailing root separators and never sets extension defaults', () => {
  const entries = nativeRegistration(
    '0123456789abcdef',
    settings,
    'C:\\Program Files\\node.exe',
    'D:\\项目\\native-open.mjs',
    7337,
  );
  assert.equal(entries.filter((e) => e.path.endsWith('command')).length, 4);
  assert.ok(entries.some((e) => e.value.endsWith('--shell-path "%V|"')));
  assert.ok(entries.every((e) => !e.path.includes('UserChoice')));
  assert.ok(
    entries.filter((e) => e.path.startsWith('.txt')).every((e) => e.name.startsWith('Sakura.Workspace.')),
  );
  assert.equal(
    entries.find((e) => e.path.endsWith('txt\\shell\\open\\command'))?.value,
    '"C:\\Program Files\\node.exe" "D:\\项目\\native-open.mjs" --port 7337 --extension .txt --shell-path "%1|"',
  );
  assert.throws(
    () => nativeRegistration('0123456789abcdef', settings, 'C:\\%1\\node.exe', 'D:\\helper.mjs', 7337),
    /百分号/,
  );
  assert.equal(
    nativeRequest.safeParse({
      action: 'configure',
      version: 1,
      settings: { ...settings, associations: [...settings.associations, ...settings.associations] },
    }).success,
    false,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native settings persist a repair journal before registry changes and recover after restart
 * 状态影响 / State effects: `fail`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.service.action`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.action({ action: 'configure', version: 1, settings }), /registry failed/)`; `assert.equal(stored.version, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('native settings persist a repair journal before registry changes and recover after restart', async (t) => {
  let fail = true;
  const f = await fixture(t, async () => {
    if (fail) throw new Error('registry failed');
  });
  await assert.rejects(f.service.action({ action: 'configure', version: 1, settings }), /registry failed/);
  const stored = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(stored.version, 2);
  assert.ok(stored.pending.entries.length > 0);
  assert.equal((await f.service.view()).pending, true);
  await assert.rejects(f.service.action({ action: 'configure', version: 1, settings }), /已改变/);
  await assert.rejects(f.service.action({ action: 'configure', version: 2, settings }), /先修复/);
  fail = false;
  const restarted = new NativeIntegration(
    async () => [f.mapping],
    f.file,
    async (previous, next) => {
      assert.equal(previous.length, 0);
      assert.deepEqual(next, stored.pending.entries);
    },
    undefined,
    f.runtime,
  );
  t.after(() => restarted.close());
  await restarted.init();
  await restarted.action({ action: 'repair', version: 2 });
  assert.equal((await restarted.view()).pending, false);
  assert.deepEqual((await restarted.view()).settings, settings);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).pending, undefined);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Explorer handoff maps nested paths and explicit file associations to the right project, with expiring revocable tickets
 * 协作入口 / Collaborators: `fixture`, `f.service.action`, `join`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.match(opened.url, /^http:\/\/127\.0\.0\.1:7337\/#native=/)`; `assert.equal(opened.url.includes('中文'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Explorer handoff maps nested paths and explicit file associations to the right project, with expiring revocable tickets', async (t) => {
  const f = await fixture(t);
  await f.service.action({ action: 'configure', version: 1, settings });
  const opened: any = await f.service.action({
    action: 'receive',
    path: join(f.host, 'hello & 中文.txt'),
    extension: '.txt',
  });
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:7337\/#native=/);
  assert.equal(opened.url.includes('中文'), false);
  assert.deepEqual(await f.service.action({ action: 'resolve', ticket: opened.ticket }), {
    vmId,
    projectId: 'default',
    path: '/workspace/中文/hello & 中文.txt',
    directory: false,
  });
  const directory: any = await f.service.action({ action: 'receive', path: f.host });
  assert.equal(
    ((await f.service.action({ action: 'resolve', ticket: directory.ticket })) as any).directory,
    true,
  );
  f.setMappings([{ ...f.mapping, guest: '/other' }]);
  await assert.rejects(f.service.action({ action: 'resolve', ticket: opened.ticket }), /已改变/);
  f.setMappings([f.mapping]);
  f.advance();
  await assert.rejects(f.service.action({ action: 'resolve', ticket: opened.ticket }), /已过期/);
  const other: any = await f.service.action({ action: 'receive', path: f.host });
  f.service.revoke();
  await assert.rejects(f.service.action({ action: 'resolve', ticket: other.ticket }), /已过期/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unregistered entry points, ambiguous roots, wrong extensions and paths outside a workspace are rejected
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.service.action`, `f.setMappings`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.action({ action: 'receive', path: f.host }), /未启用/)`; `assert.rejects(f.service.action({ action: 'receive', path: f.dir }), /不在/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('unregistered entry points, ambiguous roots, wrong extensions and paths outside a workspace are rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.action({ action: 'receive', path: f.host }), /未启用/);
  await f.service.action({ action: 'configure', version: 1, settings });
  await assert.rejects(f.service.action({ action: 'receive', path: f.dir }), /不在/);
  await assert.rejects(f.service.action({ action: 'receive', path: f.host, extension: '.txt' }), /类型/);
  f.setMappings([f.mapping, { ...f.mapping, projectId: 'aaaaaaaaaaaaaaaa' }]);
  await assert.rejects(f.service.action({ action: 'receive', path: f.host }), /多个项目/);
  const picked: any = await f.service.action({
    action: 'receive',
    path: join(f.host, 'hello & 中文.txt'),
    extension: '.txt',
  });
  assert.equal(
    ((await f.service.action({ action: 'resolve', ticket: picked.ticket })) as any).projectId,
    'default',
  );
  await f.service.action({
    action: 'configure',
    version: 2,
    settings: { ...settings, contextMenu: false, associations: [] },
  });
  assert.deepEqual(f.registry.at(-1)[1], []);
  await assert.rejects(f.service.action({ action: 'receive', path: f.host }), /未启用/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host opens launch only fixed programs with separate literal arguments and revalidate path containment
 * 协作入口 / Collaborators: `fixture`, `f.service.action`, `assert.equal`, `systemExecutable`.
 * 检查边界 / Checked boundaries: `assert.equal(f.launches[0].file, systemExecutable('notepad.exe'))`; `assert.deepEqual(f.launches[0].args, [join(f.host, 'hello & 中文.txt')])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('host opens launch only fixed programs with separate literal arguments and revalidate path containment', async (t) => {
  const f = await fixture(t);
  const request = {
    action: 'open',
    vmId,
    projectId: 'default',
    path: '/workspace/中文/hello & 中文.txt',
    target: 'editor',
  };
  await f.service.action(request);
  assert.equal(f.launches[0].file, systemExecutable('notepad.exe'));
  assert.deepEqual(f.launches[0].args, [join(f.host, 'hello & 中文.txt')]);
  await f.service.action({ ...request, target: 'explorer' });
  assert.deepEqual(f.launches[1].args, ['/select,', join(f.host, 'hello & 中文.txt')]);
  await assert.rejects(f.service.action({ ...request, path: '/workspace/中文/../secret.txt' }), /不在/);
  await assert.rejects(f.service.action({ ...request, path: '/workspace/中文/hello:stream' }), /不在/);
  await assert.rejects(f.service.action({ ...request, path: '/workspace/中文/missing.txt' }), /尚不存在/);
  await assert.rejects(f.service.action({ ...request, path: '/workspace/中文' }), /记事本只能/);
  assert.equal(f.launches.length, 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native file checking rejects junction escapes, hard links, ambiguous names and foreign roots
 * 协作入口 / Collaborators: `fixture`, `join`, `mkdir`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(checkedHostPath(f.host, join(f.host, 'escape', 'secret.txt')), /联接/)`; `assert.rejects(checkedHostPath(f.host, join(f.host, 'hard.txt')), /链接/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('native file checking rejects junction escapes, hard links, ambiguous names and foreign roots', async (t) => {
  const f = await fixture(t);
  const outside = join(f.dir, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(outside, join(f.host, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(checkedHostPath(f.host, join(f.host, 'escape', 'secret.txt')), /联接/);
  await link(join(outside, 'secret.txt'), join(f.host, 'hard.txt'));
  await assert.rejects(checkedHostPath(f.host, join(f.host, 'hard.txt')), /链接/);
  await assert.rejects(checkedHostPath(f.host, join(outside, 'secret.txt')), /不在/);
  await assert.rejects(checkedHostPath(f.host, join(f.host, 'name.')), /不支持/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: revocation during async resolution and incident guards prevent native launches
 * 协作入口 / Collaborators: `fixture`, `service.action`, `service.revoke`, `unblock`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /失效/)`; `assert.rejects( locked.action({ action: 'open', vmId, projectId: 'default', path: '/workspace/中文/hello & 中文.txt', target: 'editor'…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('revocation during async resolution and incident guards prevent native launches', async (t) => {
  const f = await fixture(t);
  let unblock!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const service = new NativeIntegration(
    async () => {
      await gate;
      return [f.mapping];
    },
    f.file,
    async () => {},
    async () => assert.fail('must not launch'),
    f.runtime,
  );
  const pending = service.action({
    action: 'open',
    vmId,
    projectId: 'default',
    path: '/workspace/中文/hello & 中文.txt',
    target: 'editor',
  });
  service.revoke();
  unblock();
  await assert.rejects(pending, /失效/);
  await service.close();
  const locked = new NativeIntegration(
    async () => [f.mapping],
    f.file,
    async () => {},
    async () => assert.fail('must not launch'),
    f.runtime,
    (id) => {
      if (id) throw new Error('incident locked');
    },
  );
  await assert.rejects(
    locked.action({
      action: 'open',
      vmId,
      projectId: 'default',
      path: '/workspace/中文/hello & 中文.txt',
      target: 'editor',
    }),
    /incident locked/,
  );
  await locked.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Explorer helper authenticates on the fixed loopback port and treats filenames as data
 * 协作入口 / Collaborators: `resolve`, `assert.deepEqual`, `parseNativeArguments`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(parseNativeArguments(['--port', '7337', '--shell-path', `${path}|`]), { port: 7337, path, extension: undefined, p…`; `assert.throws(() => parseNativeArguments(['--port', '80', '--', path]))`.
 */
test('Explorer helper authenticates on the fixed loopback port and treats filenames as data', async () => {
  const path = resolve('scripts/native-open.mjs');
  assert.deepEqual(parseNativeArguments(['--port', '7337', '--shell-path', `${path}|`]), {
    port: 7337,
    path,
    extension: undefined,
    print: false,
  });
  assert.throws(() => parseNativeArguments(['--port', '80', '--', path]));
  assert.throws(() => parseNativeArguments(['--', path, '--evil']));
  const sent: any[] = [];
  const ticket = randomUUID();
  const url = await requestNativeOpen(
    { path, port: 7337, extension: '.txt' },
    async (url: string, init: any) => {
      sent.push({ url, init });
      return Response.json(
        sent.length === 1 ? { token: 'a'.repeat(64) } : { ticket, url: 'https://untrusted.example/' },
      );
    },
  );
  assert.equal(url, `http://127.0.0.1:7337/#native=${ticket}`);
  assert.equal(sent[1].init.headers['X-Sakura-Token'], 'a'.repeat(64));
  assert.deepEqual(JSON.parse(sent[1].init.body), { action: 'receive', path, extension: '.txt' });
  await assert.rejects(
    requestNativeOpen({ path, port: 7337 }, async () => Response.json({ error: 'locked' }, { status: 423 })),
    /locked/,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows registry adapter round-trips Unicode values, refuses foreign changes and preserves foreign keys
 * 协作入口 / Collaborators: `randomUUID`, `windowsRegistry`, `promisify`, `adapter`.
 * 检查边界 / Checked boundaries: `assert.equal(JSON.parse(data), initial[0].value)`; `assert.rejects(adapter(initial, []), /其他程序修改/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(
  'Windows registry adapter round-trips Unicode values, refuses foreign changes and preserves foreign keys',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = `Software\\Sakura\\IntegrationTests\\${randomUUID()}`;
    const adapter = windowsRegistry(root);
    const execute = promisify(execFile);
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: source: string。
     * 结果：返回分支计算值（`( await execute( systemExecutable('powershell.exe'), [ '-NoProfile', '-NonIntera…`），以 Promise 交付。
     * Result: Return the branch-computed value (`( await execute( systemExecutable('powershell.exe'), [ '-NoProfile', '-NonIntera…`) through a Promise.
     * 验证场景 / Scenario: Windows registry adapter round-trips Unicode values, refuses foreign changes and preserves foreign keys
     * 协作入口 / Collaborators: `( await execute( systemExecutable('powershell.exe'), [ '-NoProfile', '-NonI…`, `execute`, `systemExecutable`, `Buffer.from(source, 'utf16le').toString`.
     */
    const ps = async (source: string) =>
      (
        await execute(
          systemExecutable('powershell.exe'),
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(source, 'utf16le').toString('base64'),
          ],
          { windowsHide: true },
        )
      ).stdout.trim();
    const key = `${root}\\Sakura.Workspace.test`,
      path = 'Sakura.Workspace.test';
    const initial = [{ path, name: '', value: '中文 & $() "literal"' }];
    try {
      await adapter([], initial);
      const data = await ps(
        `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}'); try { $k.GetValue('') | ConvertTo-Json -Compress } finally { $k.Dispose() }`,
      );
      assert.equal(JSON.parse(data), initial[0].value);
      await ps(
        `$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${key}'); try { $k.SetValue('Foreign', 'keep'); $k.SetValue('', 'changed') } finally { $k.Dispose() }`,
      );
      await assert.rejects(adapter(initial, []), /其他程序修改/);
      await ps(
        `$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${key}'); try { $k.SetValue('', 'owned') } finally { $k.Dispose() }`,
      );
      await adapter([{ ...initial[0], value: 'owned' }], []);
      assert.equal(
        await ps(
          `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}'); try { $k.GetValue('Foreign') } finally { $k.Dispose() }`,
        ),
        'keep',
      );
    } finally {
      assert.match(root, /^Software\\Sakura\\IntegrationTests\\[a-f0-9-]{36}$/);
      await ps(`[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${root}', $false)`);
    }
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the released Explorer helper performs an authenticated HTTP handoff as a real Windows process
 * 协作入口 / Collaborators: `fixture`, `f.service.action`, `createServer`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.match(stdout.trim(), new RegExp(`^http://127\\.0\\.0\\.1:${port}/#native=[a-f0-9-]{36}$`))`; `assert.equal( ((await f.service.action({ action: 'resolve', ticket })) as any).path, '/workspace/中文/hello & 中文.txt', )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('the released Explorer helper performs an authenticated HTTP handoff as a real Windows process', async (t) => {
  const f = await fixture(t);
  await f.service.action({ action: 'configure', version: 1, settings });
  const server = createServer(/**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: req; res。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: the released Explorer helper performs an authenticated HTTP handoff as a real Windows process
   * 状态影响 / State effects: `body`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `res.setHeader`, `res.end`, `JSON.stringify`, `'a'.repeat`.
   * 检查边界 / Checked boundaries: `assert.equal(req.headers['x-sakura-token'], 'a'.repeat(64))`.
   */
  async (req, res) => {
    try {
      if (req.url === '/api/bootstrap') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ token: 'a'.repeat(64) }));
        return;
      }
      assert.equal(req.headers['x-sakura-token'], 'a'.repeat(64));
      let body = '';
      for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(await f.service.action(JSON.parse(body))));
    } catch (error: any) {
      res
        .writeHead(error.status || 400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const port = (server.address() as any).port;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      resolve('scripts/native-open.mjs'),
      '--port',
      String(port),
      '--print-url',
      '--extension',
      '.txt',
      '--shell-path',
      `${join(f.host, 'hello & 中文.txt')}|`,
    ],
    { windowsHide: true },
  );
  assert.match(stdout.trim(), new RegExp(`^http://127\\.0\\.0\\.1:${port}/#native=[a-f0-9-]{36}$`));
  const ticket = stdout.trim().split('=')[1];
  assert.equal(
    ((await f.service.action({ action: 'resolve', ticket })) as any).path,
    '/workspace/中文/hello & 中文.txt',
  );
});
