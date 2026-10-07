/**
 * 模块职责：回归验证模块，围绕 `guest-dns` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `guest-dns`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: DNS diagnostic parses resolver evidence without claiming DNSSEC validation; DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Engine } from '../server/runtime.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { parseGuestDns } from '../server/guest-dns.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-guest-dns-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { NextFeatures, nextFeatureCatalog } = await import('../server/next-features.ts');
const { createSchema } = await import('../server/model.ts');
const baseResult = z.object({ ready: z.boolean(), executed: z.boolean() }).passthrough();

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^sakura-guest-dns-test-/);
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DNS diagnostic parses resolver evidence without claiming DNSSEC validation
 * 协作入口 / Collaborators: `assert.deepEqual`, `parseGuestDns`, `[ 'SOURCE=/run/systemd/resolve/stub-resolv.conf', 'NAMESERVER=127.0.0.53', …`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(parseGuestDns([ 'SOURCE=/run/systemd/resolve/stub-resolv.conf', 'NAMESERVER=127.0.0.53', 'NAMESERVER=fd00::1', 'D…`.
 */
test('DNS diagnostic parses resolver evidence without claiming DNSSEC validation', () => {
  assert.deepEqual(parseGuestDns([
    'SOURCE=/run/systemd/resolve/stub-resolv.conf',
    'NAMESERVER=127.0.0.53',
    'NAMESERVER=fd00::1',
    'DOMAIN=internal.example',
    'ROUTE_DOMAIN=~corp.example',
    'TOOL=resolvectl',
    'TOOL=delv',
    'DNSSEC_STATE=Global: allow-downgrade',
  ].join('\n')), {
    source: '/run/systemd/resolve/stub-resolv.conf',
    nameservers: ['127.0.0.53', 'fd00::1'],
    searchDomains: ['internal.example'],
    routingDomains: ['~corp.example'],
    dnssecTools: ['resolvectl', 'delv'],
    dnssecState: 'Global: allow-downgrade',
    dnssecValidation: 'not-verified',
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.equal`, `nextFeatureCatalog.find`, `randomUUID`, `machines.records.set`.
 * 检查边界 / Checked boundaries: `assert.equal(nextFeatureCatalog.find(([name]) => name === 'private-dns-dnssec')?.[5], 'available')`; `assert.equal(stopped.ready, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration', async () => {
  assert.equal(nextFeatureCatalog.find(([name]) => name === 'private-dns-dnssec')?.[5], 'available');
  const machines = new Machines({} as Engine, fakeVmNetwork), id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'dns-test' }), id,
    createdAt: new Date().toISOString(), snapshots: [],
  });
  const workspaces = {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     * 验证场景 / Scenario: DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration
     */
    beforeConfigChange: () => () => {},
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     * 验证场景 / Scenario: DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration
     */
    current: () => 'default', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: vmId: string。
     * 结果：返回分支计算值（`vmId`）。
     * Result: Return the branch-computed value (`vmId`).
     * 验证场景 / Scenario: DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration
     */
    key: (vmId: string) => vmId },
  } as unknown as Workspaces;
  const features = new NextFeatures(machines, workspaces);
  try {
    const stopped = baseResult.parse(await features.action(id, { action: 'check', featureId: 'private-dns-dnssec' }));
    assert.equal(stopped.ready, false);
    machines.live.set(id, { status: 'running' } as any);
    const commands: string[] = [];
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id; command。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration
     * 协作入口 / Collaborators: `commands.push`.
     */
    async (_id, command) => {
      commands.push(command);
      return {
        code: 0,
        stdout: 'SOURCE=/etc/resolv.conf\nNAMESERVER=192.168.1.1\nTOOL=dig\n',
        stderr: 'secret stderr must not be reported',
      };
    };
    const checked = baseResult.extend({
      nameservers: z.array(z.string()),
      dnssecValidation: z.literal('not-verified'),
    }).parse(await features.action(id, { action: 'check', featureId: 'private-dns-dnssec' }));
    assert.equal(checked.ready, true);
    assert.equal(checked.executed, false);
    assert.deepEqual(checked.nameservers, ['192.168.1.1']);
    assert.equal(checked.dnssecValidation, 'not-verified');
    assert.equal(commands.length, 1);
    assert.match(commands[0], /\/etc\/resolv\.conf/);
    assert.doesNotMatch(JSON.stringify(checked), /secret stderr/);
    const started = z.object({ id: z.string() }).parse(
      await features.action(id, { action: 'run', featureId: 'private-dns-dnssec' }),
    );
    await features.jobs.wait(`${id}:private-dns-dnssec`);
    assert.equal(features.jobs.get(started.id)?.status, 'done');
    const result = await features.jobs.result(started.id);
    assert.equal(result.executed, true);
    assert.deepEqual(result.dnssecTools, ['dig']);
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 2, stdout: '', stderr: 'private failure' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 2, stdout: '', stderr: 'private failure' })`) through a Promise.
     * 验证场景 / Scenario: DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration
     */
    async () => ({ code: 2, stdout: '', stderr: 'private failure' });
    const failed = baseResult.extend({ exitCode: z.number() }).parse(
      await features.action(id, { action: 'check', featureId: 'private-dns-dnssec' }),
    );
    assert.equal(failed.ready, false);
    assert.equal(failed.exitCode, 2);
    assert.doesNotMatch(JSON.stringify(failed), /private failure/);
  } finally {
    await features.close();
  }
});
