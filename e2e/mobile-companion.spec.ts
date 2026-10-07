/**
 * 模块职责：浏览器回归模块，围绕 `mobile-companion` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Browser regression for `mobile-companion`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: paired phone sees only authorized status and alerts over the HTTPS listener.
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostPeers } from '../server/host-peers.ts';
import { MobileCompanion } from '../server/mobile-companion.ts';
import type { AccessControl } from '../server/access-control.ts';

test.use({ ignoreHTTPSErrors: true });

/**
 * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
 * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`address.port`），以 Promise 交付。
 * Result: Return the branch-computed value (`address.port`) through a Promise.
 * 失败 / Failure: `new Error('No port')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `createServer`, `probe.address`.
 */
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: paired phone sees only authorized status and alerts over the HTTPS listener
 * 失败 / Failure: `new Error('No code')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `freePort`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('paired phone sees only authorized status and alerts over the HTTPS listener', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-mobile-browser-'));
  const port = await freePort();
  const file = join(directory, 'host.json');
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64', cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFr…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64', cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFr…`) through a Promise.
   * 验证场景 / Scenario: paired phone sees only authorized status and alerts over the HTTPS listener
   */
  const source = async () => ({
    platform: 'win32',
    arch: 'x64',
    cpus: 4,
    memoryTotal: 8 * 1024 ** 3,
    memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0],
    vmCount: 2,
    runningVms: 1,
  });
  const configured = new HostPeers(source, file, 'Sakura');
  await configured.init(false);
  await configured.configure({
    operation: 'listener',
    listener: {
      enabled: true,
      host: '127.0.0.1',
      port,
    },
  });
  await configured.close();
  const host = new HostPeers(source, file, 'Sakura', undefined, undefined, undefined, () => ({
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: request; response。
     * 结果：返回分支计算值（`mobile.handle(request, response)`）。
     * Result: Return the branch-computed value (`mobile.handle(request, response)`).
     * 验证场景 / Scenario: paired phone sees only authorized status and alerts over the HTTPS listener
     * 协作入口 / Collaborators: `mobile.handle`.
     */
    mobileHandler: (request, response) => mobile.handle(request, response),
  }));
  await host.init(true);
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const vmId = '00000000-0000-4000-8000-000000000002';
  const access = { enabled: true, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: paired phone sees only authorized status and alerts over the HTTPS listener
   */
  users: () => [{ id: ownerId, role: 'owner' }] } as unknown as AccessControl;
  const mobile = new MobileCompanion(
    access,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ vms: [ { id: vmId, name: '手机可见实例', status: 'running' }, { id: '00000000-0000-…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ vms: [ { id: vmId, name: '手机可见实例', status: 'running' }, { id: '00000000-0000-…`) through a Promise.
     * 验证场景 / Scenario: paired phone sees only authorized status and alerts over the HTTPS listener
     * 协作入口 / Collaborators: `new Date().toISOString`.
     */
    async () => ({
      vms: [
        { id: vmId, name: '手机可见实例', status: 'running' },
        { id: '00000000-0000-4000-8000-000000000003', name: '机密实例', status: 'stopped' },
      ],
      alerts: [
        {
          id: 'alert-1',
          vmId,
          kind: 'cpu',
          message: '不应发送到手机的告警详情',
          createdAt: new Date().toISOString(),
          acknowledged: false,
        },
      ],
    }),
    undefined,
    join(directory, 'mobile.json'),
  );
  await mobile.init();
  try {
    const result = await mobile.action(ownerId, {
      operation: 'pair',
      policy: { enabled: true, vmIds: [vmId], kinds: ['cpu'] },
    });
    if (!('code' in result) || typeof result.code !== 'string') throw new Error('No code');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`https://127.0.0.1:${port}/mobile/`);
    await expect(page.getByRole('heading', { name: '连接这台 Sakura' })).toBeVisible();
    await page.getByLabel('设备名称').fill('测试手机');
    await page.getByLabel('配对码').fill(result.code);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await expect(page.locator('#vms').getByText('手机可见实例')).toBeVisible();
    await expect(page.locator('#alerts').getByText('cpu')).toBeVisible();
    await expect(page.getByText('机密实例')).toHaveCount(0);
    await expect(page.getByText('不应发送到手机的告警详情')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    const deviceId = mobile.view(ownerId).devices[0].id;
    await mobile.action(ownerId, { operation: 'revoke', id: deviceId });
    await page.getByRole('button', { name: '刷新' }).click();
    await expect(page.getByRole('heading', { name: '连接这台 Sakura' })).toBeVisible();
  } finally {
    await mobile.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
