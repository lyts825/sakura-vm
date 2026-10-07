/**
 * 模块职责：真实工作空间集成模块，围绕 `workspace` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Workspace integration for `workspace`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: compiled controller: VM lifecycle, plugin panels, restart recovery and retained sandbox artifacts.
 */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startTestController } from '../scripts/test-controller';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { page, }; testInfo。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: compiled controller: VM lifecycle, plugin panels, restart recovery and retained sandbox artifacts
 * 状态影响 / State effects: `failure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `startTestController`, `page.on`, `page.goto`, `page.getByRole('button', { name: '创建发行版', exact: true }).click`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('compiled controller: VM lifecycle, plugin panels, restart recovery and retained sandbox artifacts', async ({
  page,
}, testInfo) => {
  const backend = await startTestController();
  const errors: string[] = [];
  let failure: unknown;
  let directoryRefusal = '';
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/terminal?')) return;
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(payload.toString());
      if (message.type === 'error' && String(message.data).includes('DIRECTORY_MIGRATION_REQUIRED'))
        directoryRefusal = message.data;
    });
  });
  try {
    await page.goto(backend.origin);
    await page.getByRole('button', { name: '创建发行版', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('发行版名称').fill('browser-lifecycle');
    if (process.env.SAKURA_TEST_ACCELERATOR === 'tcg')
      await dialog.getByLabel('执行模式').selectOption('tcg');
    await dialog.getByRole('button', { name: '创建发行版', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const vm = (await backend.request('/vms')).find(
      (item: { name: string }) => item.name === 'browser-lifecycle',
    );
    await expect
      .poll(async () => (await backend.request(`/vms/${vm.id}`)).status, { timeout: 280000 })
      .toBe('running');
    // Let the original fixed-tool installation complete before starting a migration.
    await expect.poll(() => directoryRefusal, { timeout: 280000 }).toContain('DIRECTORY_MIGRATION_REQUIRED');
    // Close the initial refused terminal before reviewing the test-owned directory.
    await page.goto('about:blank');
    await backend.request(`/vms/${vm.id}/project`, 'PUT', { directory: '/workspace' }, 360000);
    const migration = await backend.request(
      `/vms/${vm.id}/project-directory-migration`,
      'POST',
      { action: 'preview', version: 1 },
      360000,
    );
    expect(migration.plan.proposal.directory).toBe('/workspace');
    expect(migration.plan.proposal.vmId).toBe(vm.id);
    expect(migration.plan.proposal.projectId).toBe('default');
    const applied = await backend.request(
      `/vms/${vm.id}/project-directory-migration`,
      'POST',
      {
        action: 'apply',
        version: 1,
        planId: migration.plan.proposal.planId,
        sha256: migration.plan.sha256,
        reviewed: true,
      },
      360000,
    );
    expect(applied.plan.state).toBe('applied');
    await page.goto(backend.origin);
    await expect(page.locator('.terminal-session')).toContainText('SSH 已连接', { timeout: 280000 });
    const executed = await backend.request(`/vms/${vm.id}/exec`, 'POST', {
      command: 'printf browser-real > /workspace/browser.txt; cat /workspace/browser.txt',
    });
    expect(executed.stdout).toBe('browser-real');
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await expect(page.getByText('browser.txt', { exact: true })).toBeVisible();
    await page.locator('.machine-actions').getByRole('button', { name: '停止', exact: true }).click();
    await expect
      .poll(async () => (await backend.request(`/vms/${vm.id}`)).poweredOn, { timeout: 30000 })
      .toBe(false);
    await page.getByRole('button', { name: '更多插件功能', exact: true }).click();
    await page.getByRole('menuitem', { name: '快照', exact: true }).click();
    await expect(page.getByRole('heading', { name: '快照与迁移' })).toBeVisible();
    await backend.restart();
    // The existing page must acquire the new credential without reloading.
    await expect
      .poll(
        async () => page.evaluate(async () => document.querySelector('.error-banner')?.textContent || ''),
        { timeout: 45000 },
      )
      .toBe('');
    await page.getByLabel('新快照名称').fill('after-restart');
    await page.getByRole('button', { name: '创建快照', exact: true }).click();
    await expect.poll(async () => (await backend.request(`/vms/${vm.id}`)).snapshots.length).toBe(1);
    await backend.request(`/vms/${vm.id}`, 'DELETE');

    await page.getByRole('button', { name: '沙箱工作台', exact: true }).click();
    await page.getByLabel('沙箱名称', { exact: true }).fill('browser-sandbox');
    await page.getByRole('button', { name: '创建沙箱', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Linux 命令', exact: true })
      .fill('printf sandbox-artifact > report.txt; printf sandbox-finished');
    await page.getByLabel('保存产物（可选，每行一个相对路径）').fill('report.txt');
    await page.getByRole('button', { name: '执行命令', exact: true }).click();
    await expect(page.locator('.job-block')).toContainText('已完成', { timeout: 310000 });
    await expect(page.getByLabel('执行命令', { exact: true })).toContainText('printf sandbox-artifact');
    const overview = await backend.request('/sandboxes');
    expect(overview.runs[0].execution.exitCode).toBe(0);
    expect(overview.runs[0].execution.artifacts).toHaveLength(1);
    expect(overview.sandboxes[0].poweredOn).toBe(false);
    page.once('dialog', (prompt) => void prompt.accept());
    await page.getByRole('button', { name: '销毁 browser-sandbox', exact: true }).click();
    await expect(page.getByRole('heading', { name: '还没有沙箱' })).toBeVisible();
    await backend.restart();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: /下载 report.txt/ }).click();
    expect(await readFile((await (await downloaded).path())!, 'utf8')).toBe('sandbox-artifact');
    const recordDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出执行记录' }).click();
    const record = JSON.parse(await readFile((await (await recordDownload).path())!, 'utf8'));
    expect(record.execution.outcome).toBe('success');
    expect(record.execution.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(await backend.request('/vms')).toEqual([]);
    expect(errors).toEqual([]);
  } catch (error) {
    failure = error;
  }
  try {
    await backend.close();
  } catch (cleanup) {
    failure = failure
      ? new AggregateError([failure, cleanup], 'Browser scenario and controller cleanup failed')
      : cleanup;
  }
  if (failure) {
    await testInfo.attach('controller.log', { body: backend.logs(), contentType: 'text/plain' });
    throw failure;
  }
});
