/**
 * 模块职责：回归验证模块，围绕 `security-vulnerabilities` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `security-vulnerabilities`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: scanner maps installed binaries to distribution source packages and versions; OSV result is matched to each source package and rejects partial responses.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseAlpinePackages, parseDpkgPackages, queryVulnerabilities, scanGuestVulnerabilities,
  securityEcosystem,
} from '../server/security-vulnerabilities.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scanner maps installed binaries to distribution source packages and versions
 * 协作入口 / Collaborators: `assert.equal`, `securityEcosystem`, `assert.deepEqual`, `parseAlpinePackages`.
 * 检查边界 / Checked boundaries: `assert.equal(securityEcosystem('alpine', 'ID=alpine\nVERSION_ID=3.23.4\n'), 'Alpine:v3.23')`; `assert.equal(securityEcosystem('debian', 'ID=debian\nVERSION_ID="12"\n'), 'Debian:12')`.
 */
test('scanner maps installed binaries to distribution source packages and versions', () => {
  assert.equal(securityEcosystem('alpine', 'ID=alpine\nVERSION_ID=3.23.4\n'), 'Alpine:v3.23');
  assert.equal(securityEcosystem('debian', 'ID=debian\nVERSION_ID="12"\n'), 'Debian:12');
  assert.equal(securityEcosystem('ubuntu', 'ID=ubuntu\nVERSION_ID="24.04"\n'), 'Ubuntu:24.04:LTS');
  assert.deepEqual(parseAlpinePackages('curl\t8.15.0-r0\nlibcurl\t8.15.0-r0\n'), [
    { name: 'curl', version: '8.15.0-r0' },
    { name: 'libcurl', version: '8.15.0-r0' },
  ]);
  assert.deepEqual(parseDpkgPackages([
    'ii \tlibssl3\t3.0.17-1\topenssl\t3.0.17-1',
    'ii \topenssl\t3.0.17-1\topenssl\t3.0.17-1',
    'rc \toldpkg\t1.0\toldpkg\t1.0',
  ].join('\n')), [{ name: 'openssl', version: '3.0.17-1' }]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: OSV result is matched to each source package and rejects partial responses
 * 协作入口 / Collaborators: `queryVulnerabilities`, `assert.equal`, `assert.deepEqual`, `packages.map`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'complete')`; `assert.equal(result.packagesChecked, 2)`.
 */
test('OSV result is matched to each source package and rejects partial responses', async () => {
  const packages = [{ name: 'curl', version: '8.15.0-r0' },
    { name: 'openssl', version: '3.0.17-r0' }];
  const requests: unknown[] = [];
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _url: string; init: RequestInit。
   * 结果：返回分支计算值（`new Response(JSON.stringify({ results: [ { vulns: [{ id: 'ALPINE-CVE-2026-80231'…`），以 Promise 交付。
   * Result: Return the branch-computed value (`new Response(JSON.stringify({ results: [ { vulns: [{ id: 'ALPINE-CVE-2026-80231'…`) through a Promise.
   * 验证场景 / Scenario: OSV result is matched to each source package and rejects partial responses
   * 协作入口 / Collaborators: `requests.push`, `JSON.parse`, `String`, `JSON.stringify`.
   */
  const fetcher = async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ results: [
      { vulns: [{ id: 'ALPINE-CVE-2026-80231' }] },
      { vulns: [{ id: 'ALPINE-CVE-2026-80231' }, { id: 'ALPINE-CVE-2026-42766' }] },
    ] }), { status: 200 });
  };
  const result = await queryVulnerabilities('Alpine:v3.23', packages, undefined, fetcher);
  assert.equal(result.status, 'complete');
  assert.equal(result.packagesChecked, 2);
  assert.equal(result.affectedPackages, 2);
  assert.equal(result.vulnerabilityCount, 2);
  assert.deepEqual(result.matches[0], { ...packages[0], ids: ['ALPINE-CVE-2026-80231'] });
  assert.deepEqual(requests[0], { queries: packages.map(({ name, version }) => ({
    package: { ecosystem: 'Alpine:v3.23', name }, version,
  })) });
  await assert.rejects(() => queryVulnerabilities('Alpine:v3.23', packages, undefined,
    async () => new Response(JSON.stringify({ results: [{}] }), { status: 200 })),
  /结果数量与查询不一致/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: OSV pagination queries only packages that have another page
 * 协作入口 / Collaborators: `queryVulnerabilities`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(requests.length, 2)`; `assert.equal(requests[1].queries.length, 1)`.
 */
test('OSV pagination queries only packages that have another page', async () => {
  const requests: Array<{ queries: Array<{ page_token?: string }> }> = [];
  const result = await queryVulnerabilities('Debian:12', [
    { name: 'openssl', version: '3.0.17-1' }, { name: 'curl', version: '8.0.1-2' },
  ], undefined, async (_url, init) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ results: requests.length === 1 ? [
      { vulns: [{ id: 'DEBIAN-CVE-2026-1' }], next_page_token: 'next' },
      { vulns: [] },
    ] : [
      { vulns: [{ id: 'DEBIAN-CVE-2026-2' }] },
    ] }), { status: 200 });
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].queries.length, 1);
  assert.equal(requests[1].queries[0].page_token, 'next');
  assert.deepEqual(result.matches[0].ids, ['DEBIAN-CVE-2026-1', 'DEBIAN-CVE-2026-2']);
  assert.equal(result.vulnerabilityCount, 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed vulnerability lookup keeps inventory coverage and reports unknown status
 * 协作入口 / Collaborators: `scanGuestVulnerabilities`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'unavailable')`; `assert.equal(result.packagesChecked, 1)`.
 */
test('failed vulnerability lookup keeps inventory coverage and reports unknown status', async () => {
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
     * 验证场景 / Scenario: failed vulnerability lookup keeps inventory coverage and reports unknown status
     */
    get: () => ({ distro: 'alpine' }),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回分支计算值（`({ code: 0, stderr: '', stdout: command.includes('/etc/os-release') ? 'VERSION_I…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stderr: '', stdout: command.includes('/etc/os-release') ? 'VERSION_I…`) through a Promise.
     * 验证场景 / Scenario: failed vulnerability lookup keeps inventory coverage and reports unknown status
     * 协作入口 / Collaborators: `command.includes`.
     */
    exec: async (_id: string, command: string) => ({ code: 0, stderr: '',
      stdout: command.includes('/etc/os-release') ? 'VERSION_ID=3.23.4\n' : 'curl\t8.0-r0\n' }),
  };
  const result = await scanGuestVulnerabilities(machines as never, 'vm', undefined,
    async () => new Response('unavailable', { status: 503 }));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.packagesChecked, 1);
  assert.equal(result.ecosystem, 'Alpine:v3.23');
  assert.match(result.error || '', /503/);
});
