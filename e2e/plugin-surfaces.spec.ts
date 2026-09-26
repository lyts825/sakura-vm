import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { capabilityViews } from '../server/capability-definitions';
import { PLUGINS, PLUGIN_PACKS, emptySelection } from '../shared/plugins.ts';

test('offline monitor reopens without a network, excludes credentials and clears only its own cache', async ({
  page,
  context,
}) => {
  await app(page);
  const sample = {
    version: 1,
    capturedAt: new Date().toISOString(),
    host: 'monitor-test-host',
    totalVms: 1,
    totalJobs: 1,
    vms: [
      {
        id: 'test-vm',
        name: 'offline-linux',
        status: 'running',
        cpus: 2,
        memoryMiB: 512,
        privateKey: 'MUST_NOT_CACHE_VM_KEY',
      },
    ],
    jobs: [
      {
        id: 'job',
        vmId: 'test-vm',
        scope: 'backups',
        action: 'create',
        status: 'done',
        startedAt: new Date().toISOString(),
        log: 'MUST_NOT_CACHE_JOB_LOG',
      },
    ],
  };
  await page.route('**/api/monitor', (route) => route.fulfill({ json: sample }));
  await page.goto('/monitor/index.html');
  await expect(page.locator('#vms')).toContainText('offline-linux');
  await expect(page.locator('#jobs')).toContainText('backups / create');
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await page.getByRole('button', { name: '启用离线缓存' }).click();
  await expect(page.locator('#cache-state')).toContainText('离线缓存已启用');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const response = await (
          await caches.open('sakura-monitor-snapshots-v1')
        ).match(new URL('./snapshot.json', location.href).href);
        return response?.text();
      }),
    )
    .toContain('offline-linux');
  const contents = await page.evaluate(async () => {
    const values = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith('/api/')) throw new Error('API response was cached');
        const response = await cache.match(request);
        if (response) values.push(await response.text());
      }
    }
    return values.join('\n') + JSON.stringify(localStorage);
  });
  expect(contents).not.toContain('test-token');
  expect(contents).not.toContain('MUST_NOT_CACHE_VM_KEY');
  expect(contents).not.toContain('MUST_NOT_CACHE_JOB_LOG');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.unroute('**/api/monitor');
  await page.unroute('**/api/**');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#connection')).toContainText('缓存快照');
  await expect(page.locator('#vms')).toContainText('offline-linux');
  await expect(page.locator('#sample-time')).toContainText('采样于');
  sample.vms[0].status = 'stopped';
  sample.capturedAt = new Date().toISOString();
  await page.route('**/api/bootstrap', (route) => route.fulfill({ json: { token: 'fresh-private-token' } }));
  await page.route('**/api/monitor', (route) => route.fulfill({ json: sample }));
  await context.setOffline(false);
  await page.getByRole('button', { name: '立即刷新' }).click();
  await expect(page.locator('#vms')).toContainText('已停止');
  await page.evaluate(() => caches.open('unrelated-cache'));
  await page.getByRole('button', { name: '清除离线数据' }).click();
  await expect(page.locator('#cache-state')).toHaveText('离线缓存未启用');
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['unrelated-cache']);
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length))
    .toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('monitor cache failure rolls back consent and registration instead of claiming offline readiness', async ({
  page,
}) => {
  await app(page);
  await page.route('**/api/monitor', (route) =>
    route.fulfill({
      json: {
        version: 1,
        capturedAt: new Date().toISOString(),
        host: 'test',
        totalVms: 0,
        totalJobs: 0,
        vms: [],
        jobs: [],
      },
    }),
  );
  await page.goto('/monitor/index.html');
  await expect(page.locator('#connection')).toContainText('已连接');
  await page.evaluate(() => {
    Cache.prototype.put = async () => {
      throw new DOMException('storage denied', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: '启用离线缓存' }).click();
  await expect(page.getByRole('alert')).toContainText('storage denied');
  await expect(page.locator('#cache-state')).toHaveText('离线缓存未启用');
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('accessibility mode audits actual DOM, locates failures and exports no HTML or input values', async ({
  page,
}) => {
  await app(page);
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.id = 'audit-fixture';
    fixture.setAttribute('aria-label', 'Audit fixture');
    fixture.style.cssText =
      'position:fixed;top:90px;left:10px;width:140px;background:white;padding:12px;z-index:60';
    fixture.innerHTML =
      '<button id="audit-broken-button" style="width:80px;height:32px"></button><p style="color:#eeeeee;background:white;font-size:16px">Contrast sample</p><img style="width:20px;height:20px" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><input type="password" value="do-not-export-this-value">';
    document.body.append(fixture);
  });
  await page.getByRole('button', { name: '无障碍检查模式', exact: true }).click();
  const panel = page.getByRole('region', { name: '无障碍检查面板', exact: true });
  await panel.getByRole('button', { name: '检查当前页面', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('检查完成');
  await expect(panel.locator('[data-audit-rule="color-contrast"]').first()).toBeVisible();
  await expect(panel.locator('[data-audit-rule="image-alt"]').first()).toBeVisible();
  const rule = panel.locator('[data-audit-rule="button-name"]').first();
  await rule.locator('summary').click();
  await rule
    .getByRole('button', { name: /定位.*button/ })
    .first()
    .click();
  await expect(page.locator('#audit-broken-button')).toHaveAttribute('data-sakura-audit-target', 'true');
  await panel.getByLabel('突出显示键盘焦点').check();
  await page.locator('#audit-broken-button').focus();
  await page.keyboard.press('Tab');
  await expect(panel.locator('summary').filter({ hasText: '焦点轨迹' })).not.toHaveText(
    '焦点轨迹（最近 0 次）',
  );
  const saved = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出无障碍报告' }).click();
  const file = await saved;
  const report = await readFile((await file.path())!, 'utf8');
  expect(report).toContain('button-name');
  expect(report).not.toContain('do-not-export-this-value');
  expect(report).not.toContain('"html"');
  expect(report).not.toContain('"target"');
  await page.evaluate(() => document.getElementById('audit-fixture')?.remove());
  await panel.getByRole('button', { name: '检查当前页面', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('检查完成');
  await expect(panel.locator('[data-audit-rule="button-name"]')).toHaveCount(0);
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await expect(panel.getByRole('button', { name: '导出无障碍报告' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await panel.getByRole('button', { name: '关闭检查模式' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-sakura-audit-focus');
  await expect(page.getByRole('button', { name: '无障碍检查模式', exact: true })).toBeFocused();
});

test('custom shortcuts reject conflicts, persist project overrides and leave text and terminal input alone', async ({
  page,
}) => {
  await app(page, ['projects', 'command-palette'], true);
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  const editor = page.getByRole('region', { name: '快捷键编辑器' });
  await editor.getByLabel('切换主题快捷键', { exact: true }).fill('Mod+K');
  await editor.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('快捷键冲突');
  await editor.getByLabel('命令面板快捷键', { exact: true }).fill('Mod+Shift+K');
  await editor.getByLabel('切换主题快捷键', { exact: true }).fill('Mod+Shift+M');
  await editor.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await expect(editor.getByRole('status')).toHaveText('快捷键已保存');
  await page.keyboard.press('Control+Shift+M');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await editor.getByLabel('快捷键配置范围').selectOption('project');
  await editor.getByLabel('覆盖切换主题快捷键', { exact: true }).check();
  await editor.getByLabel('切换主题快捷键', { exact: true }).fill('Mod+Shift+Y');
  await editor.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await page.keyboard.press('Control+Shift+M');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await page.keyboard.press('Control+Shift+Y');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await editor.getByLabel('切换主题快捷键', { exact: true }).focus();
  await page.keyboard.press('Control+Shift+Y');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await page.evaluate(() => {
    const terminal = document.createElement('div');
    terminal.className = 'xterm';
    terminal.tabIndex = 0;
    document.body.append(terminal);
    terminal.focus();
  });
  await page.keyboard.press('Control+Shift+Y');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await page.reload();
  await editor.getByLabel('快捷键配置范围').selectOption('project');
  await expect(editor.getByLabel('切换主题快捷键', { exact: true })).toHaveValue('Mod+Shift+Y');
  await editor.getByRole('heading', { name: '快捷键编辑器', exact: true }).click();
  await page.keyboard.press('Control+Shift+K');
  await expect(page.locator('dialog.command-palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await editor.getByRole('button', { name: '恢复全局快捷键', exact: true }).click();
  await page.keyboard.press('Control+Shift+M');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('power policy saves while the guest is stopped and displays the actual scheduling decision', async ({
  page,
}) => {
  await app(page, ['projects', 'extensions'], true);
  let submitted: any,
    jobs: any[] = [];
  await page.route('**/api/vms/*/extended-features*', (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      jobs = [
        {
          id: 'power-policy',
          action: 'extended:power-aware-schedule',
          status: 'done',
          log: '',
          startedAt: new Date().toISOString(),
          result: { bytes: 100, sha256: 'a'.repeat(64) },
        },
      ];
      return route.fulfill({ json: jobs[0] });
    }
    return route.fulfill({
      json: {
        projectId: 'default',
        settings: {},
        jobs,
        executions: [],
        features: [],
        operations: [],
        capabilities: capabilityViews('extended'),
      },
    });
  });
  await page.route('**/api/jobs/power-policy/result*', (route) =>
    route.fulfill({
      json: {
        jobId: 'power-policy',
        result: {
          sample: { batteryPercent: 25 },
          decision: { allowStart: false, stop: false, reason: '电池电量低于自动开机阈值' },
        },
      },
    }),
  );
  await page.getByRole('button', { name: '能力中心', exact: true }).click();
  await page.getByLabel('extended 功能操作').selectOption('power-aware-schedule');
  const options = {
    mode: 'save',
    policy: { enabled: true, allowBatteryStarts: true, minimumBatteryPercent: 30, stopBelowPercent: 0 },
  };
  await page.getByLabel('extended 功能参数').fill(JSON.stringify(options));
  await page.getByRole('button', { name: '提交宿主电源感知调度' }).click();
  await expect.poll(() => submitted).toEqual({ action: 'run', featureId: 'power-aware-schedule', options });
  await expect(page.getByText('电源调度：电池电量低于自动开机阈值', { exact: true })).toBeVisible();
  await expect(page.getByText('电池电量：25%', { exact: true })).toBeVisible();
});

test('schema forms submit typed parameters and download a persisted report independently of logs', async ({
  page,
}) => {
  await app(page, ['projects', 'platform'], true);
  let submitted: any,
    jobs: any[] = [];
  await page.route('**/api/vms/*/next-features*', (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      jobs = [
        {
          id: 'large-report',
          action: 'next:slo-dashboard',
          status: 'done',
          log: 'truncated log',
          startedAt: new Date().toISOString(),
          result: { bytes: 100, sha256: 'a'.repeat(64) },
        },
      ];
      return route.fulfill({ json: jobs[0] });
    }
    return route.fulfill({
      json: {
        projectId: 'default',
        settings: {},
        records: {},
        executions: [],
        jobs,
        capabilities: capabilityViews('next'),
        features: [],
      },
    });
  });
  await page.route('**/api/jobs/large-report/result*', (route) =>
    route.fulfill({
      json: {
        jobId: 'large-report',
        result: {
          basis: 'completed-tasks',
          actualPercent: 90,
          samples: 10,
          failed: 1,
          remainingFailures: 0,
          download: { filename: 'report.json', mime: 'application/json', content: '{"complete":true}' },
        },
      },
    }),
  );
  await page.getByRole('button', { name: '能力中心', exact: true }).click();
  await page.getByLabel('next 功能操作').selectOption('slo-dashboard');
  await page.getByText('填写参数表单', { exact: true }).click();
  await page.getByLabel('targetPercent *', { exact: true }).fill('90');
  await page.getByLabel('hours *', { exact: true }).fill('48');
  await page.getByRole('button', { name: '提交任务 SLO 仪表盘' }).click();
  await expect
    .poll(() => submitted)
    .toEqual({ action: 'run', featureId: 'slo-dashboard', options: { targetPercent: 90, hours: 48 } });
  await expect(page.getByText('成功率：90.00%')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 report.json' }).click();
  expect((await downloaded).suggestedFilename()).toBe('report.json');
});

test('host disk health remains usable while the guest is stopped and keeps unknown counters distinct from zero', async ({
  page,
}) => {
  await app(page, ['projects', 'platform'], true);
  let jobs: any[] = [];
  await page.route('**/api/vms/*/next-features*', (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON().featureId).toBe('host-disk-health');
      jobs = [
        {
          id: 'disk-health',
          action: 'next:host-disk-health',
          status: 'done',
          log: '',
          startedAt: new Date().toISOString(),
          result: { bytes: 100, sha256: 'a'.repeat(64) },
        },
      ];
      return route.fulfill({ json: jobs[0] });
    }
    return route.fulfill({
      json: {
        projectId: 'default',
        settings: {},
        records: {},
        executions: [],
        jobs,
        capabilities: capabilityViews('next'),
        features: [],
      },
    });
  });
  await page.route('**/api/jobs/disk-health/result*', (route) =>
    route.fulfill({
      json: {
        jobId: 'disk-health',
        result: {
          provider: 'Windows Storage',
          status: 'unknown',
          directory: 'D:\\Sakura\\.data',
          volume: { health: 'Healthy' },
          capacity: { availableBytes: 50 * 1024 ** 3, freePercent: 50 },
          findings: [{ severity: 'unknown', disk: 1, message: '可靠性计数器不可用：设备未提供' }],
          disks: [
            {
              number: 1,
              name: 'disk one',
              bus: 'NVMe',
              health: 'Healthy',
              operational: ['Online'],
              counters: null,
            },
            {
              number: 2,
              name: 'disk two',
              bus: 'SATA',
              health: 'Healthy',
              operational: ['Online'],
              counters: {
                temperatureC: 35,
                wearPercent: 0,
                powerOnHours: 1,
                readErrorsUncorrected: 0,
                writeErrorsUncorrected: 0,
              },
            },
          ],
          download: {
            filename: 'sakura-disk-health.json',
            mime: 'application/json',
            content: '{"status":"unknown"}',
          },
        },
      },
    }),
  );
  await page.getByRole('button', { name: '能力中心', exact: true }).click();
  await page.getByLabel('next 功能操作').selectOption('host-disk-health');
  await page.getByRole('button', { name: '提交主机数据磁盘健康报告' }).click();
  await expect(page.getByRole('heading', { name: '健康数据不完整' })).toBeVisible();
  await expect(page.getByText('不可纠正读错误：未知', { exact: true })).toBeVisible();
  await expect(page.getByText('不可纠正读错误：0', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 sakura-disk-health.json' }).click();
  expect((await download).suggestedFilename()).toBe('sakura-disk-health.json');
});

test('file previews render CSV as text and terminal layouts restore after reloading', async ({ page }) => {
  await app(page, ['files', 'transfers', 'terminal-workspace'], true);
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  await page.route('**/api/vms/*/files?*', (route) =>
    route.fulfill({
      json: [{ name: 'table.csv', size: 100, directory: false, symlink: false, modified: 0 }],
    }),
  );
  await page.route('**/api/vms/*/history*', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/vms/*/file-preview?*', (route) =>
    route.fulfill({
      json: {
        kind: 'table',
        name: 'table.csv',
        rows: [
          ['name', 'value'],
          ['<script>alert(1)</script>', '=1+1'],
        ],
        truncated: false,
      },
    }),
  );
  await page.reload();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '预览 table.csv' }).click();
  const preview = page.getByRole('dialog', { name: '预览 /workspace/table.csv' });
  await expect(preview.getByRole('cell', { name: '<script>alert(1)</script>', exact: true })).toBeVisible();
  await expect(preview.getByRole('cell', { name: '=1+1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭预览' }).click();
  await page.getByRole('tab', { name: '终端', exact: true }).click();
  await page.getByRole('button', { name: '新建终端' }).click();
  await page.getByRole('button', { name: '分屏', exact: true }).click();
  await page.getByText('终端布局预设', { exact: true }).click();
  await page.getByLabel('布局名称').fill('开发与日志');
  await page.getByRole('button', { name: '保存当前布局' }).click();
  await page.reload();
  await page.getByRole('tab', { name: '终端', exact: true }).click();
  await page.getByText('终端布局预设', { exact: true }).click();
  await expect(page.getByText('开发与日志 · 2 个终端 · 分屏')).toBeVisible();
  await page.getByRole('button', { name: '应用布局', exact: true }).click();
  await expect(page.getByRole('tablist', { name: '终端会话' }).getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.terminal-panes')).toHaveClass(/split/);
});

test('file conflict editor combines independent changes and saves against the latest version', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'sakura-drafts:11111111-1111-4111-8111-111111111111',
      JSON.stringify([
        {
          id: 'draft',
          path: '/workspace/file.txt',
          baseContent: 'one\ntwo\nthree\n',
          content: 'ONE\ntwo\nthree\n',
          version: 'old-version',
        },
      ]),
    ),
  );
  await app(page, ['files', 'transfers'], true);
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  await page.route('**/api/vms/*/history*', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/vms/*/files?*', (route) => route.fulfill({ json: [] }));
  let saved: any;
  await page.route('**/api/vms/*/file', (route) => {
    const input = route.request().postDataJSON();
    if (input.expectedVersion !== 'new-version')
      return route.fulfill({ status: 409, json: { error: '文件已变化' } });
    saved = input;
    return route.fulfill({ json: { version: 'saved-version' } });
  });
  await page.route('**/api/vms/*/file?*', (route) =>
    route.fulfill({ json: { content: 'one\ntwo\nTHREE\n', version: 'new-version' } }),
  );
  await page.reload();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await page.getByRole('button', { name: '三方合并', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '共同版本', exact: true })).toHaveValue('one\ntwo\nthree\n');
  await page.getByRole('button', { name: '应用合并结果' }).click();
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await expect
    .poll(() => saved)
    .toEqual({
      path: '/workspace/file.txt',
      content: 'ONE\ntwo\nTHREE\n',
      overwrite: true,
      expectedVersion: 'new-version',
    });
});

test('pasting clipboard images uploads uniquely named files without reading the clipboard in the background', async ({
  page,
}) => {
  await app(page, ['files', 'transfers'], true);
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  await page.route('**/api/vms/*/history*', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/vms/*/files?*', (route) => route.fulfill({ json: [] }));
  const uploads: { path: string; content: string }[] = [];
  await page.route('**/api/vms/*/transfer?*', (route) => {
    uploads.push({
      path: new URL(route.request().url()).searchParams.get('path')!,
      content: route.request().postDataBuffer()!.toString(),
    });
    return route.fulfill({ json: { bytes: 12 } });
  });
  await page.reload();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const browser = page.getByRole('region', { name: 'Linux 文件浏览器' });
  for (let index = 0; index < 2; index++) {
    await browser.evaluate((element) => {
      const data = new DataTransfer();
      data.items.add(new File(['image content'], 'image.png', { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect.poll(() => uploads.length).toBe(index + 1);
    await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled();
  }
  expect(uploads[0].path).toMatch(/^\/workspace\/clipboard-.*\.png$/);
  expect(uploads[0].path).not.toBe(uploads[1].path);
  expect(uploads[0].content).toBe('image content');
});

test('sync controls save timezone and bandwidth and support offline enqueue and cancellation', async ({
  page,
}) => {
  await app(page, ['projects', 'sync'], true);
  let saved: any = { host: 'D:\\sync', guest: '/workspace/shared', auto: false },
    queue: any = null;
  await page.route('**/api/vms/*/sync*', (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith('/sync-queue')) {
      queue =
        request.method() === 'POST'
          ? { id: 'q', attempts: 0, nextAttemptAt: 0, requestedAt: new Date().toISOString() }
          : null;
      return route.fulfill({ json: { queue } });
    }
    if (request.method() === 'PUT') {
      saved = request.postDataJSON();
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: { projectId: 'default', config: saved, queue, job: null } });
  });
  await page.reload();
  await page.getByRole('tab', { name: '同步', exact: true }).click();
  await page.getByLabel('限定后台同步时间窗').check();
  await page.getByLabel('时区', { exact: true }).fill('Asia/Shanghai');
  await page.getByLabel('开始时间', { exact: true }).fill('22:00');
  await page.getByLabel('结束时间', { exact: true }).fill('02:00');
  await page.getByLabel('同步传输限速', { exact: false }).fill('2');
  await page.getByLabel('识别内容未变化的文件重命名').check();
  await page.getByLabel('同步前保存可校验的回滚点').check();
  await page.getByLabel('优先使用文件变化事件触发同步').check();
  await page.getByText('按路径设置同步方向与 Linux 权限', { exact: true }).click();
  await page.getByRole('button', { name: '添加路径规则', exact: true }).click();
  await page.getByLabel('路径规则 1', { exact: true }).fill('private/**');
  await page.getByLabel('同步方向 1', { exact: true }).selectOption('readonly');
  await page.getByLabel('Linux 权限 1', { exact: false }).fill('600');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect.poll(() => saved.bandwidthMiBps).toBe(2);
  expect(saved.window).toMatchObject({ timeZone: 'Asia/Shanghai', start: '22:00', end: '02:00' });
  expect(saved).toMatchObject({
    detectRenames: true,
    rollback: true,
    watch: true,
    policies: [{ pattern: 'private/**', direction: 'readonly', guestMode: '600' }],
  });
  await page.getByRole('button', { name: '排队同步', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消排队', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消排队', exact: true }).click();
  await expect.poll(() => queue).toBeNull();
});

test('sync rollback requires explicit confirmation and only offers the newest outstanding checkpoint', async ({
  page,
}) => {
  await app(page, ['projects', 'sync'], true);
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  const checkpoints = [
    { id: 'new', createdAt: new Date().toISOString(), status: 'done', changes: 2, bytes: 10 },
    { id: 'old', createdAt: new Date(Date.now() - 1000).toISOString(), status: 'done', changes: 1, bytes: 5 },
  ];
  let requested: any;
  await page.route('**/api/vms/*/sync*', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/sync-rollback')) {
      requested = route.request().postDataJSON();
      checkpoints[0].status = 'rolled-back';
      return route.fulfill({ json: { status: 'done' } });
    }
    return route.fulfill({
      json: {
        projectId: 'default',
        config: { host: 'D:\\sync', guest: '/workspace/shared', auto: true },
        history: checkpoints,
        watching: { host: 'watching', guest: 'polling', reason: 'Linux 未安装 inotify-tools，保留轮询' },
      },
    });
  });
  await page.reload();
  await page.getByRole('tab', { name: '同步', exact: true }).click();
  await expect(page.getByText(/Linux 未安装 inotify-tools/)).toBeVisible();
  await page.getByText('同步回滚点（2）', { exact: true }).click();
  await expect(page.getByRole('button', { name: '回滚此轮同步', exact: true })).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '回滚此轮同步', exact: true }).click();
  expect(requested).toBeUndefined();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '回滚此轮同步', exact: true }).click();
  await expect.poll(() => requested).toEqual({ checkpoint: 'new' });
  await expect(page.getByText(/已回滚/)).toBeVisible();
});

const vm = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'example',
  memoryMiB: 512,
  cpus: 2,
  diskGiB: 8,
  diskBytes: 8 * 1024 ** 3,
  accelerator: 'auto',
  distro: 'alpine',
  template: 'none',
  forwards: [],
  createdAt: new Date().toISOString(),
  snapshots: [],
  status: 'stopped',
  poweredOn: false,
};

test('clipboard protection blocks sensitive selections and editor payloads locally, preserves cuts and persists settings', async ({
  page,
}) => {
  await app(page);
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.getByLabel('阻止复制疑似密钥和令牌').check();
  await page.reload();
  await expect(page.getByLabel('阻止复制疑似密钥和令牌')).toBeChecked();
  const sensitive = 'ghp_' + 'x'.repeat(36);
  const result = await page.evaluate((text) => {
    const input = document.createElement('textarea');
    document.body.append(input);
    input.value = text;
    input.focus();
    input.select();
    const cut = new ClipboardEvent('cut', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(cut);
    const cutBlocked = cut.defaultPrevented,
      preserved = input.value;
    input.value = 'ordinary project note';
    input.select();
    const copy = new ClipboardEvent('copy', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(copy);
    const ordinaryAllowed = !copy.defaultPrevented;
    input.value = '';
    input.select();
    input.addEventListener(
      'copy',
      (event) => {
        event.clipboardData!.setData('text/plain', text);
        event.clipboardData!.setData('text/html', '<b>' + text + '</b>');
        event.preventDefault();
      },
      { once: true },
    );
    const payload = new ClipboardEvent('copy', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(payload);
    input.remove();
    return { cutBlocked, preserved, ordinaryAllowed, formats: Array.from(payload.clipboardData!.types) };
  }, sensitive);
  expect(result).toEqual({ cutBlocked: true, preserved: sensitive, ordinaryAllowed: true, formats: [] });
  await expect(page.getByRole('status').filter({ hasText: '剪贴板传递已阻止' })).toBeVisible();
  await expect(page.getByText(sensitive, { exact: true })).not.toBeVisible();
  await page.getByLabel('阻止复制疑似密钥和令牌').uncheck();
  const allowed = await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return !event.defaultPrevented && data.getData('text/plain') === text;
  }, sensitive);
  expect(allowed).toBe(true);
});

test('secret rotation controls show age and save only policy metadata', async ({ page }) => {
  await app(page, ['secrets'], true);
  const item: any = {
    name: 'api-token',
    lastChangedAt: '2026-01-01T00:00:00.000Z',
    ageDays: 25,
    dueAt: '2026-01-31T00:00:00.000Z',
    daysRemaining: 5,
    status: 'due-soon',
    policy: { enabled: true, maxAgeDays: 30, remindBeforeDays: 7 },
  };
  let submitted: any;
  await page.route('**/api/vms/*/secrets*', (route) =>
    route.fulfill({ json: { items: [{ name: item.name, updatedAt: item.lastChangedAt }] } }),
  );
  await page.route('**/api/vms/*/secret-rotation*', (route) => {
    if (route.request().method() === 'PATCH') {
      submitted = route.request().postDataJSON();
      item.policy = submitted.policy;
    }
    return route.fulfill({ json: { items: [item] } });
  });
  await page.reload();
  await page.getByRole('tab', { name: '开发', exact: true }).click();
  await page.getByText('即将到期 · 已使用 25 天', { exact: true }).click();
  await page.getByLabel('轮换周期（天）').fill('60');
  await page.getByLabel('提前提醒（天）').fill('10');
  await page.getByRole('button', { name: '保存轮换策略' }).click();
  await expect
    .poll(() => submitted)
    .toEqual({ name: 'api-token', policy: { enabled: true, maxAgeDays: 60, remindBeforeDays: 10 } });
  await page.reload();
  await page.getByRole('tab', { name: '开发', exact: true }).click();
  await page.getByText('即将到期 · 已使用 25 天', { exact: true }).click();
  await expect(page.getByLabel('轮换周期（天）')).toHaveValue('60');
});

test('network profiles preserve DNS and NAT form edits, then preview, apply and restore', async ({
  page,
}) => {
  await app(page, ['network'], true);
  const config = {
    dnsServers: [],
    httpProxy: '',
    httpsProxy: '',
    noProxy: 'localhost,127.0.0.1,::1',
    npmRegistry: '',
    pipIndex: '',
    apkMirror: '',
    aptMirror: '',
    aptSecurityMirror: '',
  };
  let profiles: any[] = [],
    state: any = { config, changes: [], job: null },
    submitted: any;
  let forwards: any[] = [];
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, forwards, status: 'running', poweredOn: true }] }),
  );
  await page.route('**/api/network-profiles*', (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      const value = route.request().postDataJSON();
      profiles = [{ ...value, id: vm.id, updatedAt: new Date().toISOString() }];
      return route.fulfill({ json: profiles[0] });
    }
    if (method === 'DELETE') profiles = [];
    return route.fulfill({ json: profiles });
  });
  await page.route('**/api/vms/*/network*', (route) => {
    if (route.request().method() === 'POST') {
      const value = route.request().postDataJSON();
      submitted = value;
      const change = { path: '/etc/resolv.conf', before: 'nameserver 10.0.2.3', after: 'nameserver 1.1.1.1' };
      if (value.action === 'preview')
        return route.fulfill({
          json: {
            config: value.config,
            changes: [change],
            forwards: { before: [], after: value.config.forwards },
            token: 'reviewed',
          },
        });
      if (value.action === 'apply') {
        expect(value.token).toBe('reviewed');
        forwards = value.config.forwards;
        state = {
          config: value.config,
          changes: [change],
          forwards: { before: [], after: forwards },
          appliedAt: new Date().toISOString(),
        };
      }
      if (value.action === 'restore') {
        forwards = [];
        state = { config, changes: [], job: null };
      }
    }
    return route.fulfill({ json: state });
  });
  await page.reload();
  await page.getByRole('tab', { name: '开发', exact: true }).click();
  await page.getByLabel('DNS 地址（逗号分隔，留空沿用系统设置）').fill('1.1.1.1, 8.8.8.8');
  await page.getByRole('button', { name: '添加映射到档案' }).click();
  await page.getByLabel('Windows 端口', { exact: true }).fill('8090');
  await page.getByLabel('Linux 端口', { exact: true }).fill('3000');
  await page.getByLabel('档案名称', { exact: true }).fill('开发网络');
  await page.getByRole('button', { name: '保存档案', exact: true }).click();
  await expect.poll(() => profiles[0]?.config.dnsServers).toEqual(['1.1.1.1', '8.8.8.8']);
  await expect(page.getByLabel('加载已保存的档案')).toHaveValue(vm.id);
  await page.getByRole('button', { name: '预览修改' }).click();
  await expect(page.getByText('即将修改 1 个文件')).toBeVisible();
  await page.getByRole('button', { name: '应用以上修改' }).click();
  await expect.poll(() => submitted?.action).toBe('apply');
  await expect(page.getByText('配置已应用', { exact: true })).toBeVisible();
  expect(forwards[0]).toMatchObject({ host: 8090, guest: 3000 });
  await page.reload();
  await page.getByRole('tab', { name: '开发', exact: true }).click();
  await expect(page.getByLabel('DNS 地址（逗号分隔，留空沿用系统设置）')).toHaveValue('1.1.1.1, 8.8.8.8');
  await page.getByRole('button', { name: '恢复原配置' }).click();
  await expect(page.getByText('配置已应用', { exact: true })).not.toBeVisible();
  expect(forwards).toEqual([]);
  await page.getByLabel('加载已保存的档案').selectOption(vm.id);
  await expect(page.getByLabel('Windows 端口', { exact: true })).toHaveValue('8090');
  await page.getByRole('button', { name: '删除档案', exact: true }).click();
  await expect.poll(() => profiles.length).toBe(0);
});

test('backup policies enable block deduplication and show how each backup is stored', async ({ page }) => {
  await app(page, ['snapshots', 'backups', 'transfers', 'secrets'], true);
  let policy: any = { enabled: false, intervalHours: 24, keep: 7, maxGiB: 32 };
  await page.route('**/api/vms/*/backups*', (route) => {
    if (route.request().method() === 'PUT') policy = route.request().postDataJSON();
    return route.fulfill({
      json: {
        policy,
        bytes: 4096,
        items: [
          {
            id: 'backup',
            storage: 'blocks',
            bytes: 4096,
            createdAt: new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
          },
        ],
      },
    });
  });
  await page.reload();
  await page.getByRole('tab', { name: '快照', exact: true }).click();
  await page.getByLabel('本机备份使用全局内容块去重').check();
  await page.getByRole('button', { name: '保存策略', exact: true }).click();
  await expect.poll(() => policy.deduplicate).toBe(true);
  await expect(page.getByText(/内容块去重 ·/)).toBeVisible();
});

test('disk maintenance saves a schedule and only offers TRIM while running', async ({ page }) => {
  await app(page, ['maintenance'], true);
  let policy: any = { enabled: false, mode: 'both', compress: true, intervalHours: 168 },
    requested: any;
  await page.route('**/api/storage', (route) =>
    route.fulfill({
      json: {
        total: 10000,
        available: 5000,
        backupBytes: 0,
        images: [],
        machines: [],
        warning: '',
      },
    }),
  );
  await page.route('**/api/vms/*/diagnostics', (route) =>
    route.fulfill({ json: { report: null, job: null } }),
  );
  await page.route('**/api/vms/*/disk-maintenance', (route) => {
    if (route.request().method() === 'PUT') policy = route.request().postDataJSON();
    if (route.request().method() === 'POST') requested = route.request().postDataJSON();
    return route.fulfill({ json: { policy, attempts: {}, successes: {}, maintenance: false } });
  });
  await page.reload();
  await page.getByRole('tab', { name: '维护', exact: true }).click();
  await expect(page.getByRole('button', { name: '立即执行 TRIM', exact: true })).toBeDisabled();
  await page.getByLabel('启用定期磁盘维护').check();
  await page.getByLabel('磁盘维护间隔（小时）').fill('24');
  await page.getByLabel('自动维护操作').selectOption('compact');
  await page.getByRole('button', { name: '保存磁盘维护策略', exact: true }).click();
  await expect
    .poll(() => policy)
    .toEqual({ enabled: true, mode: 'compact', compress: true, intervalHours: 24 });
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  await page.reload();
  await page.getByRole('tab', { name: '维护', exact: true }).click();
  await expect(page.getByRole('button', { name: '整理未使用空间', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '立即执行 TRIM', exact: true }).click();
  await expect.poll(() => requested).toEqual({ mode: 'trim' });
});

test('resource history exports samples and the notification center acknowledges persisted events', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).notifications = [];
    (window as any).Notification = class {
      static permission = 'default';
      static async requestPermission() {
        this.permission = 'granted';
        return 'granted';
      }
      constructor(title: string, options: unknown) {
        (window as any).notifications.push({ title, options });
      }
    };
  });
  await app(page, ['projects', 'automation', 'automation-scheduler'], true);
  const events = [
    {
      id: 'backup-alert',
      kind: 'backup',
      message: '备份任务失败：创建备份',
      createdAt: new Date().toISOString(),
      acknowledged: false,
    },
  ];
  let acknowledged: string | undefined;
  await page.route('**/api/vms/*/advanced*', (route) => {
    if (route.request().method() === 'POST') {
      acknowledged = route.request().postDataJSON().id;
      events.find((event) => event.id === acknowledged)!.acknowledged = true;
    }
    return route.fulfill({
      json: {
        settings: {
          schedule: { enabled: false, idleMinutes: 0, idleAction: 'stop' },
          alerts: {
            enabled: true,
            cpuPercent: 90,
            memoryPercent: 90,
            diskPercent: 90,
            cooldownMinutes: 30,
            taskFailures: true,
            serviceFailures: true,
          },
        },
        features: [],
        presets: {},
        events,
        history: [
          {
            sampledAt: new Date().toISOString(),
            cpuPercent: 25,
            memoryUsed: 512,
            memoryTotal: 1024,
            diskUsed: 2048,
            diskTotal: 4096,
            networkReceiveBytesPerSecond: 1024,
            networkTransmitBytesPerSecond: 2048,
          },
        ],
      },
    });
  });
  await page.getByRole('button', { name: '能力中心', exact: true }).click();
  await page.getByLabel('趋势指标').selectOption('receive');
  await expect(page.getByRole('img', { name: '网络接收速率历史趋势' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出指标 CSV', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('sakura-metrics.csv');
  const center = page.getByRole('region', { name: '通知中心', exact: true });
  await center.getByRole('button', { name: '启用浏览器告警通知', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).notifications.length)).toBe(0);
  await center.getByRole('button', { name: '确认告警：备份任务失败：创建备份', exact: true }).click();
  await expect.poll(() => acknowledged).toBe('backup-alert');
  await expect(center.getByText('没有符合条件的告警。')).toBeVisible();
  await center.getByLabel('仅显示未确认告警').uncheck();
  await expect(center.getByText('已确认', { exact: true })).toBeVisible();
  events.unshift({
    id: 'new-alert',
    kind: 'backup',
    message: '新的备份任务失败',
    createdAt: new Date().toISOString(),
    acknowledged: false,
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).notifications.length), { timeout: 10000 })
    .toBe(1);
});

async function app(page: Page, active: string[] = [], withVm = false) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === '/api/bootstrap'
        ? { token: 'test-token' }
        : path === '/api/vms'
          ? withVm
            ? [vm]
            : []
          : path === '/api/system'
            ? {
                plugins: active,
                version: 'test',
                engine: 'test',
                posixloom: 'test',
                nativeHost: true,
                hostname: 'localhost',
                platform: 'test',
                hostCpus: 4,
                hostMemoryMiB: 4096,
                freeMemoryMiB: 2048,
                controllerMemoryMiB: 256,
                imageReady: true,
                imageBytes: 1,
              }
            : path === '/api/plugins'
              ? {
                  selection: emptySelection(),
                  active,
                  planned: active,
                  reasons: {},
                  migrations: [],
                  restartRequired: false,
                  errors: {},
                  lifecycle: {},
                  plugins: PLUGINS,
                  packs: PLUGIN_PACKS,
                }
              : path.endsWith('/projects')
                ? { active: 'default', projects: [{ id: 'default', name: '默认项目' }] }
                : path.endsWith('/commands')
                  ? { projectId: 'default', presets: [], job: null }
                  : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/');
}

test('the empty install shows the core and the current plugin catalog', async ({ page }) => {
  await app(page);
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button')).toHaveCount(3);
  await page.getByRole('button', { name: '插件中心' }).click();
  await expect(page.locator('.plugin-summary')).toContainText(/0\s*个插件运行中/);
  await expect(page.locator('.plugin-card')).toHaveCount(PLUGINS.length);
  await page
    .getByRole('group', { name: '插件浏览方式' })
    .getByRole('button', { name: /整合包/ })
    .click();
  await expect(page.locator('.plugin-card')).toHaveCount(PLUGIN_PACKS.length);
});

test('metrics and commands load their own client entries when selected', async ({ page }) => {
  await app(page, ['projects', 'metrics', 'commands'], true);
  await expect(page.getByRole('tab', { name: '配置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更多插件功能' }).click();
  await page.getByRole('menuitem', { name: '资源', exact: true }).click();
  await expect(page.getByRole('heading', { name: '实时资源' })).toBeVisible();
  await page.getByRole('tab', { name: '开发', exact: true }).click();
  await page.getByRole('button', { name: '收藏命令' }).click();
  await expect(page.getByRole('heading', { name: '收藏新命令' })).toBeVisible();
});

test('capability center edits operation parameters, disables planned runs and explicitly unlocks', async ({
  page,
}) => {
  await app(page, ['projects', 'extensions', 'platform'], true);
  let submitted: any,
    locked = false;
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  await page.route('**/api/vms/*/lockdown*', (route) => {
    if (route.request().method() === 'POST') locked = route.request().postDataJSON().locked;
    return route.fulfill({ json: { locked } });
  });
  await page.route('**/api/vms/*/extended-features*', (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { status: 'running' } });
    }
    return route.fulfill({
      json: {
        projectId: 'default',
        settings: {},
        jobs: [],
        executions: [],
        operations: [
          {
            id: 'hash-manifest',
            feature: 'hash-manifest',
            name: '文件证据清单',
            example: { path: '.' },
            note: 'SHA-256',
            writes: false,
          },
        ],
        features: [
          { id: 'hash-manifest', name: '文件哈希清单', summary: '计算清单', state: 'available' },
          { id: 'disk-encryption', name: '虚拟磁盘加密', summary: '尚未实现', state: 'planned' },
        ],
      },
    });
  });
  await page.route('**/api/vms/*/next-features*', (route) =>
    route.fulfill({
      json: {
        projectId: 'default',
        settings: {},
        jobs: [],
        records: {},
        executions: [],
        features: [
          {
            id: 'desktop-recording',
            name: '桌面录制',
            category: '桌面',
            summary: '尚未实现',
            state: 'planned',
          },
        ],
      },
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: '能力中心', exact: true }).click();
  await expect(page.getByRole('heading', { name: '能力中心', exact: true })).toBeVisible();
  await page.getByLabel('扩展工程操作').selectOption('hash-manifest');
  await expect(page.getByLabel('工程操作参数')).toContainText('"path": "."');
  await page.getByLabel('工程操作参数').fill('{"path":"src","output":"manifest.json"}');
  await page.getByRole('button', { name: '提交操作', exact: true }).click();
  await expect
    .poll(() => submitted)
    .toEqual({
      action: 'operation',
      operation: 'hash-manifest',
      parameters: { path: 'src', output: 'manifest.json' },
    });
  await expect(
    page
      .locator('.catalog-item')
      .filter({ hasText: '虚拟磁盘加密' })
      .getByRole('button', { name: '运行', exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator('.catalog-item')
      .filter({ hasText: '桌面录制' })
      .getByRole('button', { name: '运行', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '停止并锁定实例' }).click();
  await expect(page.getByRole('button', { name: '解除应急锁定' })).toBeEnabled();
  expect(locked).toBe(true);
  await page.getByRole('button', { name: '解除应急锁定' }).click();
  await expect(page.getByRole('button', { name: '停止并锁定实例' })).toBeEnabled();
  expect(locked).toBe(false);
});

test('sandbox workbench creates isolated environments, executes, cancels and preserves logs after destruction', async ({
  page,
}) => {
  await app(page, ['sandbox']);
  let sandboxes: any[] = [],
    runs: any[] = [];
  await page.route('**/api/sandboxes', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      expect(input.network).toBe('isolated');
      expect(input.onExpire).toBe('delete');
      expect(input.lifetimeMinutes).toBe(60);
      const created = {
        ...vm,
        ...input,
        name: input.name,
        expired: false,
        sandbox: {
          network: input.network,
          onExpire: input.onExpire,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };
      sandboxes.push(created);
      await route.fulfill({ status: 201, json: created });
    } else await route.fulfill({ json: { sandboxes, runs } });
  });
  await page.route('**/api/vms/*/sandbox**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/run')) {
      expect(request.postDataJSON().command).toBe('printf sandbox-output');
      runs = [
        {
          id: 'test-job',
          vmId: vm.id,
          status: 'running',
          title: 'sandbox-demo · 沙箱命令',
          log: 'sandbox-output',
          startedAt: new Date().toISOString(),
        },
      ];
      sandboxes[0].status = 'running';
      sandboxes[0].poweredOn = true;
      await route.fulfill({ status: 202, json: runs[0] });
    } else {
      if (request.method() === 'DELETE') sandboxes = [];
      else {
        expect(request.postDataJSON().action).toBe('stop');
        sandboxes[0].status = 'stopped';
        sandboxes[0].poweredOn = false;
        runs[0].status = 'cancelled';
      }
      await route.fulfill({ json: { ok: true } });
    }
  });
  await page.getByRole('button', { name: '沙箱工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有沙箱' })).toBeVisible();
  await page.getByLabel('沙箱名称', { exact: true }).fill('sandbox-demo');
  await page.getByRole('button', { name: '创建沙箱', exact: true }).click();
  await expect(page.getByRole('heading', { name: '在 sandbox-demo 中执行' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Linux 命令', exact: true }).fill('printf sandbox-output');
  await page.getByRole('button', { name: '执行命令', exact: true }).click();
  await expect(page.getByLabel('操作日志')).toContainText('sandbox-output');
  await expect(page.getByRole('button', { name: '执行命令', exact: true })).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/sandbox-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '取消执行', exact: true }).click();
  await expect(page.locator('.job-block')).toContainText('已取消');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '销毁 sandbox-demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有沙箱' })).toBeVisible();
  await expect(page.getByLabel('操作日志')).toContainText('sandbox-output');
});

test('sandbox page fits a phone and reports creation errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app(page, ['sandbox']);
  await page.route('**/api/sandboxes', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 503, json: { error: '镜像尚未准备好' } });
    else await route.fulfill({ json: { sandboxes: [], runs: [] } });
  });
  await page.getByRole('button', { name: '沙箱工作台', exact: true }).click();
  await page.getByLabel('沙箱名称', { exact: true }).fill('sandbox-demo');
  await page.getByRole('button', { name: '创建沙箱', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('镜像尚未准备好');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('navigation', { name: '主导航' }).locator('button').first()).toHaveCSS(
    'white-space',
    'nowrap',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/sandbox-mobile.png', fullPage: true });
});

test('retained execution details fit mobile screens with long commands and artifact names', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app(page, ['sandbox']);
  const command = `printf ${'long-output-'.repeat(24)} > result.txt`;
  const name = 'execution-report-'.repeat(6) + '.txt';
  await page.route('**/api/sandboxes', (route) =>
    route.fulfill({
      json: {
        sandboxes: [],
        runs: [
          {
            id: 'retained-run',
            vmId: vm.id,
            status: 'done',
            title: '沙箱命令',
            log: 'done',
            startedAt: new Date().toISOString(),
            execution: {
              command,
              cwd: '/workspace/' + 'long-path/'.repeat(8),
              timeoutSeconds: 300,
              requestedArtifacts: [name],
              outcome: 'success',
              exitCode: 0,
              timings: { bootMs: 3000, commandMs: 120, artifactsMs: 20, shutdownMs: 100, totalMs: 3240 },
              artifacts: [{ id: 'artifact', name, path: name, bytes: 10, sha256: 'a'.repeat(64) }],
            },
          },
        ],
      },
    }),
  );
  await page.getByRole('button', { name: '沙箱工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有沙箱' })).toBeVisible();
  await expect(page.getByLabel('执行命令', { exact: true })).toHaveText(command);
  await expect(page.getByRole('button', { name: '导出执行记录' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: new RegExp(`下载 ${name.replaceAll('.', '\\.')}`) }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/sandbox-record-mobile.png', fullPage: true });
});
