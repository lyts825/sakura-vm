import { expect, test, type Page } from '@playwright/test';
import { capabilityViews } from '../server/capability-definitions';
import { PLUGINS, PLUGIN_PACKS, emptySelection } from '../shared/plugins.ts';

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
