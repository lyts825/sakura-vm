/**
 * 模块职责：回归验证模块，围绕 `network-profiles` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-profiles`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: network archives persist reusable DNS and NAT settings and validate names and addresses; interrupted DNS and NAT apply survives restart and restores only unchanged files and port rules.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Engine } from '../server/runtime';

const root = await mkdtemp(join(tmpdir(), 'sakura-network-test-'));
process.env.SAKURA_DATA_DIR = root;
const { NetworkProfiles, networkSchema } = await import('../server/network-profiles.ts');
const { Machines } = await import('../server/machines.ts');
const { createSchema } = await import('../server/model.ts');
const { textVersion } = await import('../server/files.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-network-test-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: distro: 'alpine' | 'debian' | 'ubuntu' = 'alpine'。
 * 结果：返回受控对象，公开字段包括 `id, machines, record, files, network`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, machines, record, files, network`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.sftp`, `machines.readGuestFile`, `machines.writeGuestFile`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `createSchema.parse`, `new Date().toISOString`, `machines.records.set`.
 */
function fixture(distro: 'alpine' | 'debian' | 'ubuntu' = 'alpine') {
  const id = randomUUID(),
    machines = new Machines({} as Engine, fakeVmNetwork);
  const record = {
    ...createSchema.parse({ name: 'network-test', distro, forwards: [{ host: 8080, guest: 80 }] }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  };
  machines.records.set(id, record);
  const files = new Map([
    ['/etc/profile.d/sakura-network.sh', '# original environment\n'],
    ['/etc/network/interfaces', 'auto eth0\niface eth0 inet static\n  address 10.0.2.15/24\n'],
    ['/etc/resolv.conf', 'search development.local\noptions timeout:2\nnameserver 10.0.2.3\n'],
    ['/etc/systemd/resolved.conf.d/90-sakura.conf', '# original resolver\n'],
    ['/etc/apt/apt.conf.d/90sakura-proxy', '// original proxy\n'],
  ]);
  machines.sftp = (/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _id: string; work: Function。
   * 结果：返回分支计算值（`work({ lstat: (path: string, done: Function) => files.has(path) ? done(null, { i…`），以 Promise 交付。
   * Result: Return the branch-computed value (`work({ lstat: (path: string, done: Function) => files.has(path) ? done(null, { i…`) through a Promise.
   * 协作入口 / Collaborators: `work`.
   */
  async (_id: string, work: Function) =>
    work({
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: path: string; done: Function。
       * 结果：返回分支计算值（`files.has(path) ? done(null, { isFile: () => true }) : done({ code: 2 })`）。
       * Result: Return the branch-computed value (`files.has(path) ? done(null, { isFile: () => true }) : done({ code: 2 })`).
       * 协作入口 / Collaborators: `files.has`, `done`.
       */
      lstat: (path: string, done: Function) =>
        files.has(path) ? done(null, { /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回布尔判定，供用例选择路径或核对受控条件。
         * Result: Return a boolean decision for path selection or controlled-condition assertions.
         */
        isFile: () => true }) : done({ code: 2 }),
    })) as InstanceType<typeof Machines>['sftp'];
  machines.readGuestFile = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id; path。
   * 结果：返回分支计算值（`files.get(path)!`），以 Promise 交付。
   * Result: Return the branch-computed value (`files.get(path)!`) through a Promise.
   * 协作入口 / Collaborators: `files.get`.
   */
  async (_id, path) => files.get(path)!;
  machines.writeGuestFile = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _id; path; content; overwrite; version。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `assert.equal`, `files.has`, `textVersion`, `files.get`.
   * 检查边界 / Checked boundaries: `assert.equal(overwrite, files.has(path))`; `assert.equal(version, textVersion(files.get(path)!))`.
   */
  async (_id, path, content, overwrite, version) => {
    assert.equal(overwrite, files.has(path));
    if (version) assert.equal(version, textVersion(files.get(path)!));
    files.set(path, content);
  };
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 0, stdout: '', stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: '', stderr: '' })`) through a Promise.
   */
  async () => ({ code: 0, stdout: '', stderr: '' });
  return { id, machines, record, files, network: new NetworkProfiles(machines) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network archives persist reusable DNS and NAT settings and validate names and addresses
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `networkSchema.safeParse`, `network.saveProfile`.
 * 检查边界 / Checked boundaries: `assert.equal(networkSchema.safeParse(config).success, false)`; `assert.deepEqual((await reloaded.profiles())[0], saved)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('network archives persist reusable DNS and NAT settings and validate names and addresses', async () => {
  const { network, machines } = fixture();
  try {
    for (const config of [
      { dnsServers: ['8.8.8.8;reboot'] },
      { dnsServers: ['1.1.1.1', '1.1.1.1'] },
      { dnsDomains: ['corp.example'], dnsServers: ['8.8.8.8;reboot'] },
      { dnsDomains: ['corp.example;reboot'] },
      { dnsDomains: ['corp.example', 'corp.example'] },
      { dnsDomains: ['corp.local'] },
      { dnsDomains: ['app.sakura.localhost'] },
      { dnssec: 'maybe' },
      {
        forwards: [
          { host: 8080, guest: 80 },
          { host: 8080, guest: 81 },
        ],
      },
    ])
      assert.equal(networkSchema.safeParse(config).success, false);
    const saved = await network.saveProfile({
      name: 'Office',
      config: { dnsServers: ['::1'], forwards: [{ host: 8081, guest: 80 }] },
    });
    const reloaded = new NetworkProfiles(machines);
    try {
      assert.deepEqual((await reloaded.profiles())[0], saved);
      await assert.rejects(reloaded.saveProfile({ name: 'office', config: {} }), /名称已存在/);
      await reloaded.saveProfile({ id: saved.id, name: 'Office 2', config: saved.config });
      assert.equal((await reloaded.profiles()).length, 1);
      await reloaded.removeProfile(saved.id);
      assert.deepEqual(await reloaded.profiles(), []);
    } finally {
      await reloaded.close();
    }
  } finally {
    await network.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: interrupted DNS and NAT apply survives restart and restores only unchanged files and port rules
 * 状态影响 / State effects: `record.forwards`, `machines.writeGuestFile`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `structuredClone`, `network.preview`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(network.apply(id, preview.config, preview.token), /重新预览/)`; `assert.rejects(network.apply(id, preview.config, preview.token), /SSH disconnect/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('interrupted DNS and NAT apply survives restart and restores only unchanged files and port rules', async () => {
  const { network, machines, record, files, id } = fixture();
  const original = new Map(files),
    originalForwards = structuredClone(record.forwards);
  try {
    const preview = await network.preview(id, {
      dnsServers: ['1.1.1.1'],
      forwards: [{ host: 8090, guest: 22 }],
    });
    record.forwards = [{ host: 8091, guest: 80 }];
    await assert.rejects(network.apply(id, preview.config, preview.token), /重新预览/);
    record.forwards = originalForwards;
    const write = machines.writeGuestFile.bind(machines);
    machines.writeGuestFile = /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`write(...args)`），以 Promise 交付。
     * Result: Return the branch-computed value (`write(...args)`) through a Promise.
     * 验证场景 / Scenario: interrupted DNS and NAT apply survives restart and restores only unchanged files and port rules
     * 失败 / Failure: `new Error('simulated SSH disconnect')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `args[1].includes`, `write`.
     */
    async (...args) => {
      if (args[1].includes('profile.d')) throw new Error('simulated SSH disconnect');
      return write(...args);
    };
    await assert.rejects(network.apply(id, preview.config, preview.token), /SSH disconnect/);
    assert.deepEqual(record.forwards, preview.forwards!.after);
    assert.match(files.get('/etc/resolv.conf')!, /1\.1\.1\.1/);
    assert.match(files.get('/etc/resolv.conf')!, /search development.local\noptions timeout:2/);
    await network.close();
    const restarted = new NetworkProfiles(machines);
    try {
      assert.equal((await restarted.state(id)).appliedAt, undefined);
      machines.writeGuestFile = write;
      record.forwards = [{ host: 8099, guest: 443 }];
      await assert.rejects(restarted.restore(id), /端口映射被外部修改/);
      assert.match(files.get('/etc/resolv.conf')!, /1\.1\.1\.1/);
      record.forwards = preview.forwards!.after;
      await restarted.restore(id);
      assert.deepEqual(files, original);
      assert.deepEqual(record.forwards, originalForwards);
      assert.equal((await restarted.state(id)).forwards, undefined);
    } finally {
      await restarted.close();
    }
  } finally {
    await network.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resolved profiles reload and verify DNS, and failed reloads remain recoverable
 * 状态影响 / State effects: `machines.exec`, `broken`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `network.preview`, `assert.rejects`, `network.apply`.
 * 检查边界 / Checked boundaries: `assert.rejects(network.apply(id, preview.config, preview.token), /重新加载 DNS 失败/)`; `assert.equal((await network.state(id)).dnsBackend, 'resolved')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('resolved profiles reload and verify DNS, and failed reloads remain recoverable', async () => {
  const { network, machines, files, id } = fixture('ubuntu');
  let broken = false,
    reloads = 0;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: resolved profiles reload and verify DNS, and failed reloads remain recoverable
   * 协作入口 / Collaborators: `command.includes`.
   */
  async (_id, command) => {
    if (command.includes('readlink'))
      return { code: 0, stdout: '/run/systemd/resolve/stub-resolv.conf\n', stderr: '' };
    if (command.includes('restart systemd-resolved')) {
      reloads++;
      return { code: broken ? 1 : 0, stdout: 'Global: 1.1.1.1\nLink 2 (eth0): 10.0.2.3', stderr: '' };
    }
    if (command.includes('resolvectl domain'))
      return { code: 0, stdout: 'Global: ~.\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  try {
    const preview = await network.preview(id, { dnsServers: ['1.1.1.1'] });
    broken = true;
    await assert.rejects(network.apply(id, preview.config, preview.token), /重新加载 DNS 失败/);
    assert.equal((await network.state(id)).dnsBackend, 'resolved');
    await assert.rejects(network.restore(id), /重新加载 DNS 失败/);
    assert.equal((await network.state(id)).changes.length, 0);
    assert.equal(files.get('/etc/systemd/resolved.conf.d/90-sakura.conf'), '# original resolver\n');
    broken = false;
    await network.restore(id);
    const next = await network.preview(id, preview.config);
    await network.apply(id, next.config, next.token);
    assert.ok((await network.state(id)).appliedAt);
    await network.restore(id);
    assert.equal(reloads, 5);
  } finally {
    await network.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private domains and DNSSEC are applied and verified on systemd-resolved, then restored
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `files.get`, `network.preview`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(preview.config.dnsDomains, ['corp.example', 'services.example'])`; `assert.match(preview.changes.find((item) => item.path.endsWith('90-sakura.conf'))!.after, /DNS=10\.0\.2\.3\nDomains=\nDomains=~cor…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('private domains and DNSSEC are applied and verified on systemd-resolved, then restored', async () => {
  const { network, machines, files, id } = fixture('ubuntu');
  const original = files.get('/etc/systemd/resolved.conf.d/90-sakura.conf');
  const commands: string[] = [];
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: private domains and DNSSEC are applied and verified on systemd-resolved, then restored
   * 协作入口 / Collaborators: `commands.push`, `command.includes`.
   */
  async (_id, command) => {
    commands.push(command);
    if (command.includes('readlink'))
      return { code: 0, stdout: '/run/systemd/resolve/stub-resolv.conf\n', stderr: '' };
    if (command.includes('resolvectl domain'))
      return { code: 0, stdout: 'Global: ~corp.example ~services.example\n', stderr: '' };
    if (command.includes('resolvectl dnssec'))
      return { code: 0, stdout: 'Global: yes\n', stderr: '' };
    return { code: 0, stdout: 'Global: 10.0.2.3\n', stderr: '' };
  };
  try {
    const config = {
      dnsServers: ['10.0.2.3'],
      dnsDomains: ['CORP.EXAMPLE', 'services.example'],
      dnssec: 'yes',
    };
    const preview = await network.preview(id, config);
    assert.deepEqual(preview.config.dnsDomains, ['corp.example', 'services.example']);
    assert.match(preview.changes.find((item) => item.path.endsWith('90-sakura.conf'))!.after,
      /DNS=10\.0\.2\.3\nDomains=\nDomains=~corp\.example ~services\.example\nDNSSEC=yes/);
    await network.apply(id, preview.config, preview.token);
    assert.ok((await network.state(id)).appliedAt);
    assert.ok(commands.some((command) => command.includes('resolvectl domain')));
    assert.ok(commands.some((command) => command.includes('resolvectl dnssec')));
    await network.restore(id);
    assert.equal(files.get('/etc/systemd/resolved.conf.d/90-sakura.conf'), original);
  } finally {
    await network.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private DNS rejects unsupported guests and detects unapplied routing
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `alpine.network.preview`, `alpine.network.close`.
 * 检查边界 / Checked boundaries: `assert.rejects( alpine.network.preview(alpine.id, { dnsServers: ['10.0.2.3'], dnsDomains: ['corp.example'] }), /需要 systemd-resolve…`; `assert.rejects(alpine.network.preview(alpine.id, { dnsServers: ['10.0.2.3'], dnssec: 'yes', }), /需要 systemd-resolved/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('private DNS rejects unsupported guests and detects unapplied routing', async () => {
  const alpine = fixture('alpine');
  try {
    await assert.rejects(
      alpine.network.preview(alpine.id, { dnsServers: ['10.0.2.3'], dnsDomains: ['corp.example'] }),
      /需要 systemd-resolved/,
    );
    await assert.rejects(alpine.network.preview(alpine.id, {
      dnsServers: ['10.0.2.3'], dnssec: 'yes',
    }), /需要 systemd-resolved/);
  } finally {
    await alpine.network.close();
  }
  const { network, machines, id } = fixture('ubuntu');
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: private DNS rejects unsupported guests and detects unapplied routing
   * 协作入口 / Collaborators: `command.includes`.
   */
  async (_id, command) => {
    if (command.includes('readlink'))
      return { code: 0, stdout: '/run/systemd/resolve/stub-resolv.conf\n', stderr: '' };
    if (command.includes('resolvectl domain'))
      return { code: 0, stdout: 'Global: ~.\n', stderr: '' };
    return { code: 0, stdout: 'Global: 10.0.2.3\n', stderr: '' };
  };
  try {
    await assert.rejects(network.preview(id, { dnsDomains: ['corp.example'] }), /需要指定 DNS 服务器/);
    await assert.rejects(network.preview(id, { dnssec: 'yes' }), /需要同时指定 DNS 服务器/);
    const preview = await network.preview(id, {
      dnsServers: ['10.0.2.3'], dnsDomains: ['corp.example'],
    });
    await assert.rejects(network.apply(id, preview.config, preview.token), /没有使用所选域名路由/);
    assert.equal((await network.state(id)).dnsBackend, 'resolved');
  } finally {
    await network.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: uplink resolv.conf changes to the validating stub and restores its original link
 * 状态影响 / State effects: `machines.exec`, `link`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `network.preview`, `assert.deepEqual`, `network.apply`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(preview.resolverLink, { before: original, after: '/run/systemd/resolve/stub-resolv.conf', })`; `assert.equal(link, '/run/systemd/resolve/stub-resolv.conf')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('uplink resolv.conf changes to the validating stub and restores its original link', async () => {
  const { network, machines, id, files } = fixture('debian');
  const original = '../run/systemd/resolve/resolv.conf';
  let link = original, switches = 0;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: uplink resolv.conf changes to the validating stub and restores its original link
   * 状态影响 / State effects: `link`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `command.includes`.
   */
  async (_id, command) => {
    if (command.includes('mv -Tf')) {
      link = ++switches === 1 ? '/run/systemd/resolve/stub-resolv.conf' : original;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (command === 'readlink /etc/resolv.conf')
      return { code: 0, stdout: link + '\n', stderr: '' };
    if (command.includes('readlink -f'))
      return { code: 0, stdout: '/run/systemd/resolve/resolv.conf\n', stderr: '' };
    if (command.includes('resolvectl domain'))
      return { code: 0, stdout: 'Global: ~corp.example\n', stderr: '' };
    if (command.includes('resolvectl dnssec'))
      return { code: 0, stdout: 'Global: yes\n', stderr: '' };
    return { code: 0, stdout: 'Global: 10.0.2.3\n', stderr: '' };
  };
  try {
    const preview = await network.preview(id, {
      dnsServers: ['10.0.2.3'], dnsDomains: ['corp.example'], dnssec: 'yes',
    });
    assert.deepEqual(preview.resolverLink, {
      before: original, after: '/run/systemd/resolve/stub-resolv.conf',
    });
    await network.apply(id, preview.config, preview.token);
    assert.equal(link, '/run/systemd/resolve/stub-resolv.conf');
    link = '/run/other-resolver.conf';
    await assert.rejects(network.restore(id), /解析器链接被外部修改/);
    assert.match(files.get('/etc/systemd/resolved.conf.d/90-sakura.conf')!, /DNSSEC=yes/);
    link = '/run/systemd/resolve/stub-resolv.conf';
    await network.restore(id);
    assert.equal(link, original);
    assert.equal(switches, 2);
    assert.equal((await network.state(id)).resolverLink, undefined);
  } finally {
    await network.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: port rules reject stale expectations and roll back in-memory configuration when persistence fails
 * 状态影响 / State effects: `(machines as any).save`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `machines.setForwards`, `structuredClone`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.setForwards(id, [], []), /端口映射已变化/)`; `assert.rejects(machines.setForwards(id, [], before), /disk full/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('port rules reject stale expectations and roll back in-memory configuration when persistence fails', async () => {
  const { machines, record, id, network } = fixture();
  try {
    await assert.rejects(machines.setForwards(id, [], []), /端口映射已变化/);
    const before = structuredClone(record.forwards);
    (machines as any).save = /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: port rules reject stale expectations and roll back in-memory configuration when persistence fails
     * 失败 / Failure: `new Error('disk full')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => {
      throw new Error('disk full');
    };
    await assert.rejects(machines.setForwards(id, [], before), /disk full/);
    assert.deepEqual(record.forwards, before);
  } finally {
    await network.close();
  }
});
