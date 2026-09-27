import { expect, test, type Page } from '@playwright/test';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { SessionLock } from '../server/session-lock';
import { Webhooks } from '../server/webhooks';
import { LocalAssistant, assistantRequest } from '../server/local-assistant';
import { capabilityViews } from '../server/capability-definitions';
import { PLUGINS, PLUGIN_PACKS, emptySelection } from '../shared/plugins.ts';
import { apiDocument } from '../server/openapi.ts';
import { generateSdk } from '../server/sdk.ts';
import { graphqlInfo, GraphApi, querySnapshot } from '../server/graphql-api.ts';
import type { Machines } from '../server/machines.ts';
import { NativeIntegration } from '../server/native-integration.ts';
import { WebSocketServer, type WebSocket as NodeWebSocket } from 'ws';
import { GoldenImages } from '../server/golden-images.ts';
import { Jobs } from '../server/jobs.ts';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { Rescue } from '../server/rescue';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { BackupRecovery } from '../server/backup-recovery';
import { SignedBundles } from '../server/signed-bundles';

test('backup file recovery selects encrypted backups, clears passwords, downloads verified files and cancels on mobile', async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-recovery-browser-'));
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  const file = join(directory, 'backup.sakura');
  await writeFile(file, 'fixture');
  const backupId = randomUUID(),
    artifactId = randomUUID();
  const item = {
    id: backupId,
    createdAt: new Date().toISOString(),
    bytes: 123,
    checksum: 'a'.repeat(64),
    encrypted: true,
  };
  let hold = false,
    cleaned = 0;
  const machines = Object.assign(new EventEmitter(), {
    get: () => vm,
    requireUnlocked: () => {},
    requireStopped: () => {},
    withRescue: async (
      _id: string,
      signal: AbortSignal,
      phase: (value: string) => void,
      run: (id: string, signal: AbortSignal) => Promise<void>,
    ) => {
      phase('只读连接备份磁盘');
      try {
        if (hold) await delay(60000, undefined, { signal });
        return await run('temporary', signal);
      } finally {
        cleaned++;
      }
    },
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
  }) as unknown as Machines;
  const service = new BackupRecovery(
    machines,
    {
      withVerifiedFile: async (
        _id: string,
        backup: string,
        password: string,
        _signal: AbortSignal,
        work: (file: string) => Promise<void>,
      ) => {
        expect(backup).toBe(backupId);
        if (password !== 'browser-password') throw new Error('备份解密密码不正确');
        return work(file);
      },
    } as any,
    {
      withDisk: async (input: Readable, _signal: AbortSignal, work: (disk: string) => Promise<void>) => {
        for await (const _chunk of input) {
        }
        return work('temporary-disk');
      },
    } as any,
    new Jobs(),
    {
      prune: async () => {},
      collect: async (
        _id: string,
        _run: string,
        cwd: string,
        paths: string[],
        save: (value: unknown) => void,
      ) => {
        expect(cwd).toBe('/mnt/source');
        for (const path of paths)
          save({ id: artifactId, name: 'readme.txt', path, bytes: 8, sha256: 'a'.repeat(64) });
      },
      download: async () => ({
        id: artifactId,
        name: 'readme.txt',
        path: 'workspace/readme.txt',
        bytes: 8,
        sha256: 'a'.repeat(64),
        base64: Buffer.from('restored').toString('base64'),
      }),
    } as any,
  );
  try {
    await app(page, ['snapshots', 'transfers', 'backups', 'secrets'], true);
    await page.route('**/api/vms/*/backups', (route) =>
      route.fulfill({
        json: {
          policy: { enabled: false, intervalHours: 24, keep: 7, maxGiB: 32 },
          items: [item],
          bytes: 123,
          job: null,
          waitingForShutdown: false,
        },
      }),
    );
    await page.route('**/api/vms/*/backup-recovery**', async (route) => {
      const url = new URL(route.request().url());
      const json = url.pathname.endsWith('/artifact')
        ? await service.artifact(vm.id, url.searchParams.get('run')!, url.searchParams.get('artifact')!)
        : route.request().method() === 'GET'
          ? service.view(vm.id)
          : service.run(vm.id, route.request().postDataJSON());
      await route.fulfill({ json });
    });
    await page.route('**/api/jobs/*/cancel', async (route) => {
      service.jobs.cancel(vm.id);
      await service.jobs.wait(vm.id);
      await route.fulfill({ json: { ok: true } });
    });
    await page.getByRole('tab', { name: '快照', exact: true }).click();
    const panel = page.getByRole('region', { name: '备份文件恢复', exact: true });
    await panel.getByRole('combobox', { name: '恢复来源备份', exact: true }).selectOption(backupId);
    await panel
      .getByRole('textbox', { name: '要恢复的文件（每行一个相对根目录的路径）', exact: true })
      .fill('workspace/readme.txt');
    await panel.getByLabel('文件恢复解密密码', { exact: true }).fill('wrong-password');
    await panel.getByRole('button', { name: '提取备份文件', exact: true }).click();
    await expect(panel.getByText('备份解密密码不正确', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('文件恢复解密密码', { exact: true })).toHaveValue('');
    await panel.getByLabel('文件恢复解密密码', { exact: true }).fill('browser-password');
    await panel.getByRole('button', { name: '提取备份文件', exact: true }).click();
    await expect(panel.getByText('已完成', { exact: true })).toBeVisible();
    expect(JSON.stringify(service.view(vm.id))).not.toContain('browser-password');
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: /下载恢复文件 workspace\/readme.txt/ }).click();
    const saved = await download;
    expect((await readFile((await saved.path())!)).toString()).toBe('restored');
    await page.reload();
    await expect(panel.getByText('已完成', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    hold = true;
    await panel.getByRole('combobox', { name: '恢复来源备份', exact: true }).selectOption(backupId);
    await panel
      .getByRole('textbox', { name: '要恢复的文件（每行一个相对根目录的路径）', exact: true })
      .fill('workspace/' + 'long-name-'.repeat(25) + '.txt');
    await panel.getByLabel('文件恢复解密密码', { exact: true }).fill('browser-password');
    await panel.getByRole('button', { name: '提取备份文件', exact: true }).click();
    await expect(panel.getByRole('button', { name: '取消文件恢复', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '取消文件恢复', exact: true }).click();
    await expect(panel.getByText('已取消', { exact: true })).toBeVisible();
    expect(cleaned).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('read-only rescue runs reviewed commands, retains downloadable artifacts, refreshes history and cancels on mobile', async ({
  page,
}) => {
  let hold = false,
    cleaned = 0;
  const commands: string[] = [];
  const machines = {
    get: () => vm,
    requireUnlocked: () => {},
    requireStopped: () => {},
    isBusy: () => false,
    withRescue: async (
      _id: string,
      signal: AbortSignal,
      phase: (text: string) => void,
      run: (id: string, signal: AbortSignal) => Promise<void>,
    ) => {
      phase('启动临时救援系统');
      try {
        await run('rescue-test', signal);
      } finally {
        cleaned++;
      }
    },
    exec: async (
      _id: string,
      command: string,
      _timeout: number,
      signal: AbortSignal,
      log: (text: string) => void,
    ) => {
      if (command.startsWith('cd /workspace')) {
        commands.push(command);
        log('救援诊断已执行\n');
        if (hold) await delay(60000, undefined, { signal });
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const artifactId = randomUUID();
  const service = new Rescue(machines, new Jobs(), {
    prune: async () => {},
    collect: async (
      _id: string,
      _run: string,
      _cwd: string,
      paths: string[],
      saved: (item: unknown) => void,
    ) => {
      for (const path of paths) saved({ id: artifactId, name: path, path, bytes: 9, sha256: 'a'.repeat(64) });
    },
    download: async () => ({
      id: artifactId,
      name: 'report.txt',
      path: 'report.txt',
      bytes: 9,
      sha256: 'a'.repeat(64),
      base64: Buffer.from('recovered').toString('base64'),
    }),
  } as any);
  try {
    await app(page, ['snapshots', 'transfers'], true);
    await page.route('**/api/vms/*/rescue**', async (route) => {
      const url = new URL(route.request().url());
      try {
        const json = url.pathname.endsWith('/artifact')
          ? await service.artifact(vm.id, url.searchParams.get('run')!, url.searchParams.get('artifact')!)
          : route.request().method() === 'GET'
            ? service.view(vm.id)
            : service.run(vm.id, route.request().postDataJSON());
        await route.fulfill({ json });
      } catch (error) {
        await route.fulfill({ status: 400, json: { error: (error as Error).message } });
      }
    });
    await page.route('**/api/jobs/*/cancel', async (route) => {
      service.jobs.cancel(vm.id);
      await service.jobs.wait(vm.id);
      await route.fulfill({ json: { ok: true } });
    });
    await page.getByRole('tab', { name: '快照', exact: true }).click();
    const panel = page.getByRole('region', { name: '只读救援', exact: true });
    await panel
      .getByRole('textbox', { name: '检查命令', exact: true })
      .fill('cp /mnt/source/etc/os-release /workspace/report.txt');
    await panel.getByLabel('保存产物（每行一个相对路径）', { exact: true }).fill('report.txt');
    await panel.getByRole('button', { name: '启动只读救援', exact: true }).click();
    await expect(panel.getByText('已完成', { exact: true })).toBeVisible();
    expect(commands[0]).toContain('cp /mnt/source/etc/os-release /workspace/report.txt');
    const downloaded = page.waitForEvent('download');
    await panel.getByRole('button', { name: /下载 report.txt/ }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('report.txt');
    expect((await readFile((await file.path())!)).toString()).toBe('recovered');
    await page.reload();
    await expect(panel.getByText('已完成', { exact: true })).toBeVisible();
    hold = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByLabel('自动只读挂载源文件系统', { exact: true }).uncheck();
    await panel.getByRole('textbox', { name: '检查命令', exact: true }).fill('sleep 600');
    await panel.getByRole('button', { name: '启动只读救援', exact: true }).click();
    await expect(panel.getByRole('button', { name: '取消救援', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '取消救援', exact: true }).click();
    await expect(panel.getByText('已取消', { exact: true })).toBeVisible();
    expect(cleaned).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await service.close();
  }
});

test('golden image library saves templates, verifies, restores after refresh, creates instances and removes safely on mobile', async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-golden-browser-'));
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  const derived: any[] = [];
  const machines = {
    records: new Map([[vm.id, vm]]),
    get: () => vm,
    requireUnlocked: () => {},
    requireStopped: () => {},
  } as unknown as Machines;
  const library = new GoldenImages(
    machines,
    {
      export: async (_id: string, target: any, headers: () => void, signal: AbortSignal) => {
        headers();
        await pipeline(Readable.from(['golden-browser-content']), target, { signal });
      },
      import: async (name: string, source: any, _signal: AbortSignal, beforeAdopt: () => void) => {
        let bytes = '';
        for await (const chunk of source) bytes += chunk;
        expect(bytes).toBe('golden-browser-content');
        beforeAdopt();
        const created = { ...vm, id: randomUUID(), name };
        derived.push(created);
        return created;
      },
    } as any,
    directory,
    new Jobs(),
  );
  try {
    await app(page, ['snapshots', 'transfers', 'images'], true);
    await page.route('**/api/images', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/vms', (route) => route.fulfill({ json: [vm, ...derived] }));
    await page.route('**/api/golden-images', async (route) => {
      try {
        await route.fulfill({
          json:
            route.request().method() === 'GET'
              ? await library.view()
              : await library.action(route.request().postDataJSON()),
        });
      } catch (error) {
        await route.fulfill({ status: 400, json: { error: (error as Error).message } });
      }
    });
    await page.getByRole('tab', { name: '快照', exact: true }).click();
    const panel = page.getByRole('region', { name: '黄金镜像库', exact: true });
    await panel.getByLabel('模板名称', { exact: true }).fill('浏览器模板');
    await panel.getByLabel('模板备注', { exact: true }).fill('准备好的开发环境');
    await expect(panel.getByRole('button', { name: '保存黄金镜像', exact: true })).toBeDisabled();
    await panel.getByLabel('已检查源实例内容，确认可复制为模板', { exact: true }).check();
    await panel.getByRole('button', { name: '保存黄金镜像', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '浏览器模板', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '校验 浏览器模板' }).click();
    await expect(panel.getByRole('status')).toContainText('SHA-256 校验通过');
    await page.reload();
    await expect(panel.getByText('准备好的开发环境', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '镜像库', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '浏览器模板', exact: true })).toBeVisible();
    await panel.getByLabel('从模板创建的实例名称').fill('from-template');
    await panel.getByRole('button', { name: '从 浏览器模板 创建实例' }).click();
    await expect(panel.getByRole('status')).toContainText('from-template 已创建');
    expect(derived).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    page.once('dialog', (dialog) => dialog.dismiss());
    await panel.getByRole('button', { name: '删除模板 浏览器模板' }).click();
    expect((await library.view()).templates).toHaveLength(1);
    page.once('dialog', (dialog) => dialog.accept());
    await panel.getByRole('button', { name: '删除模板 浏览器模板' }).click();
    await expect(panel.getByText('尚未保存黄金镜像。', { exact: true })).toBeVisible();
    expect(derived).toHaveLength(1);
  } finally {
    await library.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('signed bundle policy manages trusted keys on snapshot and image pages at desktop and mobile widths', async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-signed-browser-'));
  const policy = new SignedBundles(join(directory, 'policy.json'));
  const foreign = new SignedBundles(join(directory, 'foreign.json'));
  await policy.init();
  await foreign.init();
  await foreign.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  try {
    await app(page, ['snapshots', 'transfers', 'images'], true);
    await page.route('**/api/images', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/signed-bundles', async (route) => {
      try {
        const result =
          route.request().method() === 'GET'
            ? policy.view()
            : await policy.action(route.request().postDataJSON());
        await route.fulfill({ json: result });
      } catch (error) {
        await route.fulfill({ status: 400, json: { error: (error as Error).message } });
      }
    });
    await page.getByRole('tab', { name: '快照', exact: true }).click();
    const panel = page.getByRole('heading', { name: '签名实例包' }).locator('..');
    await expect(panel.getByText('允许旧格式导入')).toBeVisible();
    await panel.getByRole('button', { name: '启用严格导入' }).click();
    await expect(panel.getByText('仅允许受信任签名导入')).toBeVisible();
    await expect(panel.getByRole('textbox', { name: '本机签名公钥' })).toContainText('BEGIN PUBLIC KEY');
    await panel.getByRole('textbox', { name: '受信任公钥名称' }).fill('另一台主机');
    await panel.getByRole('textbox', { name: '粘贴 Ed25519 公钥' }).fill(foreign.view().localKey!.publicKey);
    await panel.getByRole('button', { name: '信任公钥' }).click();
    await expect(panel.getByText('另一台主机')).toBeVisible();
    const foreignRow = panel.locator('.snapshot-list > div').filter({ hasText: '另一台主机' });
    await foreignRow.getByRole('button', { name: '移除' }).click();
    await expect(panel.getByText('另一台主机')).toHaveCount(0);
    await page.getByRole('button', { name: '镜像库', exact: true }).click();
    await expect(page.getByRole('heading', { name: '签名实例包' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('image library uploads a selected disk format with provisioning choices and shows integrity result', async ({ page }) => {
  await app(page, ['images']);
  await page.route('**/api/images', (route) => route.fulfill({ json: [] }));
  let submitted: URL | undefined;
  await page.route('**/api/image-import*', (route) => {
    submitted = new URL(route.request().url());
    expect(route.request().postDataBuffer()?.length).toBe(1024);
    expect(route.request().headers()['x-sakura-token']).toBe('test-token');
    return route.fulfill({ status: 201, json: {
      vm: { id: randomUUID(), name: 'from-vmdk' },
      source: { format: 'vmdk', bytes: 1024, sha256: 'a'.repeat(64), virtualBytes: 2 * 1024 ** 3 },
    } });
  });
  await page.getByRole('button', { name: '镜像库', exact: true }).click();
  const panel = page.getByRole('heading', { name: '导入其他镜像' }).locator('..');
  await panel.getByLabel('镜像导入实例名称').fill('from-vmdk');
  await panel.getByLabel('镜像文件格式').selectOption('vmdk');
  await panel.getByLabel('镜像源发行版').selectOption('debian');
  await panel.getByLabel('导入实例固件').selectOption('uefi');
  await panel.getByLabel('导入实例内存').fill('2048');
  await panel.getByLabel('导入镜像 SHA-256').fill('bad');
  await panel.locator('input[type=file]').setInputFiles({ name: 'disk.vmdk', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024) });
  await expect(page.getByRole('alert')).toContainText('SHA-256 必须为 64 位十六进制');
  expect(submitted).toBeUndefined();
  await panel.getByLabel('导入镜像 SHA-256').fill('a'.repeat(64));
  await panel.locator('input[type=file]').setInputFiles({ name: 'disk.vmdk', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1024) });
  await expect(page.getByRole('status')).toContainText('镜像已导入');
  expect(submitted?.searchParams.get('format')).toBe('vmdk');
  expect(submitted?.searchParams.get('distro')).toBe('debian');
  expect(submitted?.searchParams.get('firmware')).toBe('uefi');
  expect(submitted?.searchParams.get('memoryMiB')).toBe('2048');
  expect(submitted?.searchParams.get('sha256')).toBe('a'.repeat(64));
  await expect(panel).toContainText('a'.repeat(64));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('new Linux instance submits UEFI firmware selection with its resource configuration', async ({ page }) => {
  await app(page);
  let created: any;
  await page.route('**/api/vms', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] });
    created = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { ...vm, ...created, id: randomUUID(), status: 'stopped', poweredOn: false, snapshots: [] } });
  });
  await page.getByRole('button', { name: '创建发行版', exact: true }).click();
  await page.getByLabel('启动固件').selectOption('uefi');
  await page.getByLabel('创建后立即启动').uncheck();
  await page.getByRole('button', { name: '创建发行版', exact: true }).last().click();
  await expect.poll(() => created?.firmware).toBe('uefi');
  await expect(page.getByLabel('启动固件')).toHaveCount(0);
  expect(created.firmware).toBe('uefi');
});

test('clipboard policy remains enforced in memory when browser persistence is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sakura-clipboard-policies') throw new DOMException('Unavailable', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await app(page, [], true);
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  const panel = page.locator('.clipboard-policies');
  await panel.locator('summary').click();
  await panel.getByLabel('允许从宿主粘贴', { exact: true }).uncheck();
  await expect(panel.getByRole('status')).toContainText('当前标签页仍生效');
  await page.getByRole('button', { name: '工作空间', exact: true }).click();
  expect(
    await page.locator('.terminal-wrap').evaluate((element) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'not sent');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('sakura-clipboard-policies'))).toBeNull();
});

test('clipboard policies enforce per-app directions and instance overrides before terminal input, persist and reject corrupt state', async ({
  page,
}) => {
  const input: string[] = [];
  await page.routeWebSocket(/\/ws\/[^/]+\/terminal\?/, (socket) => {
    socket.send(JSON.stringify({ type: 'ready', data: true }));
    socket.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'input') input.push(msg.data);
    });
  });
  await app(page, [], true);
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  await page.reload();
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  const panel = page.locator('.clipboard-policies');
  await panel.locator('summary').click();
  await panel.getByLabel('允许从宿主粘贴', { exact: true }).uncheck();
  await panel.getByLabel('允许复制与剪切到宿主').uncheck();
  await page.getByRole('button', { name: '工作空间', exact: true }).click();
  const terminal = page.locator('.xterm-helper-textarea');
  const paste = () =>
    terminal.evaluate((element) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'CLIPBOARD_FIXTURE');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  await expect(terminal).toBeAttached();
  expect(await paste()).toBe(true);
  expect(input.join('')).not.toContain('CLIPBOARD_FIXTURE');
  await terminal.focus();
  await page.keyboard.type('typed');
  await expect.poll(() => input.join('')).toContain('typed');
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await panel.locator('summary').click();
  await panel.getByLabel('策略范围').selectOption(vm.id);
  await panel.getByLabel('为此实例单独设置').check();
  await panel.getByLabel('允许从宿主粘贴', { exact: true }).check();
  await panel.getByLabel('此应用始终检查敏感文本').check();
  await page.reload();
  await page.locator('.clipboard-policies summary').click();
  await panel.getByLabel('策略范围').selectOption(vm.id);
  await expect(panel.getByLabel('为此实例单独设置')).toBeChecked();
  await expect(panel.getByLabel('允许从宿主粘贴', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '工作空间', exact: true }).click();
  await paste();
  await expect.poll(() => input.join('')).toContain('CLIPBOARD_FIXTURE');
  const secret = 'ghp_' + 'z'.repeat(36);
  const blocked = await terminal.evaluate((element, secret) => {
    const data = new DataTransfer();
    data.setData('text/plain', secret);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, secret);
  expect(blocked).toBe(true);
  expect(input.join('')).not.toContain(secret);
  expect(await page.evaluate(() => localStorage.getItem('sakura-clipboard-policies'))).not.toContain(secret);
  await page.evaluate(() => localStorage.setItem('sakura-clipboard-policies', '{invalid'));
  await page.reload();
  expect(await paste()).toBe(true);
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.locator('.clipboard-policies summary').click();
  await expect(panel.getByRole('alert')).toContainText('策略损坏');
  await panel.getByRole('button', { name: '恢复全部剪贴板默认策略' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('real noVNC obeys clipboard policy and records, decodes, exports and persists desktop video', async ({
  page,
  context,
}) => {
  const sockets: NodeWebSocket[] = [],
    sent: string[] = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((done) => server.once('listening', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local port');
  await page.addInitScript((port) => {
    const Native = window.WebSocket;
    const Redirect = function (url: string | URL, protocols?: string | string[]) {
      return new Native(String(url).includes('/desktop?') ? `ws://127.0.0.1:${port}` : url, protocols);
    };
    Object.setPrototypeOf(Redirect, Native);
    Redirect.prototype = Native.prototype;
    window.WebSocket = Redirect as unknown as typeof WebSocket;
  }, address.port);
  server.on('connection', (socket) => {
    sockets.push(socket);
    let stage = 0;
    socket.on('message', (raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (stage === 0) {
        stage++;
        socket.send(Buffer.from([1, 1]));
      } else if (stage === 1) {
        stage++;
        socket.send(Buffer.alloc(4));
      } else if (stage === 2) {
        stage++;
        const init = Buffer.alloc(24);
        init.writeUInt16BE(64, 0);
        init.writeUInt16BE(64, 2);
        Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]).copy(init, 4);
        socket.send(init);
        const frame = Buffer.alloc(16 + 64 * 64 * 4);
        frame.writeUInt16BE(1, 2);
        frame.writeUInt16BE(64, 8);
        frame.writeUInt16BE(64, 10);
        for (let offset = 16; offset < frame.length; offset += 4) {
          frame[offset] = 40;
          frame[offset + 1] = 100;
          frame[offset + 2] = 180;
        }
        socket.send(frame);
      } else if (bytes[0] === 6 && bytes.length >= 8) sent.push(bytes.subarray(8).toString());
    });
    socket.send(Buffer.from('RFB 003.008\n'));
  });
  try {
    await app(page, ['desktop'], true);
    await page.route('**/api/vms', (route) =>
      route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
    );
    await page.route('**/api/vms/*/desktop*', (route) =>
      route.fulfill({ json: { status: 'ready', log: '' } }),
    );
    await page.route('**/api/vms/*/ime*', (route) => route.fulfill({ json: null }));
    await page.reload();
    await page.getByRole('tab', { name: '桌面', exact: true }).click();
    await page.getByRole('button', { name: '剪贴板', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    const incoming = page.getByRole('textbox', { name: 'Linux 剪贴板文本' });
    const serverClipboard = (text: string) => {
      const data = Buffer.from(text),
        header = Buffer.alloc(8);
      header[0] = 3;
      header.writeUInt32BE(data.length, 4);
      sockets.at(-1)!.send(Buffer.concat([header, data]));
    };
    serverClipboard('guest text');
    await expect(incoming).toHaveValue('guest text');
    await page.getByLabel('发送到 Linux 的文本').fill('host text');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => sent).toContain('host text');
    const settings = await context.newPage();
    await app(settings, [], true);
    await settings.getByRole('button', { name: '系统设置', exact: true }).click();
    const panel = settings.locator('.clipboard-policies');
    await panel.locator('summary').click();
    await panel.getByLabel('应用入口').selectOption('desktop');
    await panel.getByLabel('允许复制与剪切到宿主').uncheck();
    await expect(incoming).toHaveValue('');
    serverClipboard('must remain hidden');
    await expect(incoming).toHaveValue('');
    await panel.getByLabel('允许从宿主粘贴', { exact: true }).uncheck();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await expect.poll(() => sockets.length).toBe(2);
    await panel.getByLabel('允许复制与剪切到宿主').check();
    await panel.getByLabel('此应用始终检查敏感文本').check();
    await expect(page.getByLabel('桌面剪贴板桥接').getByText('桌面已连接', { exact: true })).toBeVisible();
    serverClipboard('ghp_' + 'z'.repeat(36));
    await expect(page.getByRole('alert')).toContainText('疑似访问令牌');
    await expect(incoming).toHaveValue('');
    expect(sent).not.toContain('');
    await settings.close();
    await page.bringToFront();
    await page.getByRole('button', { name: '录制与回放', exact: true }).click();
    const recording = page.getByRole('region', { name: '桌面录制', exact: true });
    await recording.getByLabel('录制名称').fill('desktop-fixture');
    await recording.getByRole('button', { name: '开始录制', exact: true }).click();
    await expect(recording.getByRole('status').filter({ hasText: '正在录制' })).toContainText('0:01');
    await recording.getByRole('button', { name: '暂停录制', exact: true }).click();
    await expect(recording.getByRole('status').filter({ hasText: '已暂停' })).toBeVisible();
    await recording.getByRole('button', { name: '继续录制', exact: true }).click();
    await recording.getByRole('button', { name: '停止录制', exact: true }).click();
    await expect(recording.getByRole('button', { name: '下载本次录制' })).toBeVisible();
    await expect
      .poll(() =>
        recording.locator('.recording-current video').evaluate((video: HTMLVideoElement) => ({
          width: video.videoWidth,
          error: video.error?.code || 0,
        })),
      )
      .toEqual({ width: 64, error: 0 });
    await recording.getByLabel('回放位置', { exact: true }).fill('0.5');
    await expect
      .poll(() =>
        recording
          .locator('.recording-current video')
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(0.4);
    const download = page.waitForEvent('download');
    await recording.getByRole('button', { name: '下载本次录制' }).click();
    const video = await download;
    const bytes = await readFile((await video.path())!);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
    expect(video.suggestedFilename()).toBe('sakura-desktop-fixture.webm');
    // A storage failure must leave the completed, downloadable capture intact.
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value, key) {
        if (this.name === 'content') {
          IDBObjectStore.prototype.add = original;
          throw new DOMException('quota', 'QuotaExceededError');
        }
        return original.call(this, value, key);
      };
    });
    await recording.getByRole('button', { name: '保存到录制库', exact: true }).click();
    await expect(recording.getByRole('alert')).toContainText('浏览器空间');
    await expect(recording.getByRole('button', { name: '下载本次录制' })).toBeVisible();
    await recording.getByRole('button', { name: '保存到录制库', exact: true }).click();
    await expect(recording.getByRole('button', { name: '已保存到录制库', exact: true })).toBeDisabled();
    await page.reload();
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '管理录制库' }).click();
    const library = page.getByRole('region', { name: '本浏览器录制库' });
    await library.getByRole('button', { name: '回放 desktop-fixture' }).click();
    await expect
      .poll(() => library.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBe(64);
    const savedDownload = page.waitForEvent('download');
    await library.getByRole('button', { name: '下载 desktop-fixture' }).click();
    expect(await readFile((await (await savedDownload).path())!)).toEqual(bytes);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    page.once('dialog', (dialog) => dialog.accept());
    await library.getByRole('button', { name: '删除 desktop-fixture' }).click();
    await expect(library.getByText('尚未保存录制。')).toBeVisible();
    await expect(library.locator('video')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: '工作空间', exact: true }).click();
    await page.getByRole('button', { name: vm.name, exact: true }).click();
    await page.getByRole('tab', { name: '桌面', exact: true }).click();
    await page.getByRole('button', { name: '录制与回放', exact: true }).click();
    await recording.getByRole('button', { name: '开始录制', exact: true }).click();
    await expect(recording.getByRole('button', { name: '停止录制', exact: true })).toBeEnabled();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await expect(recording.getByRole('button', { name: '停止录制', exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '你的机器，你的空间。' })).toBeVisible();
    await expect(library.getByText('尚未保存录制。')).toBeVisible();
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test('Windows integration settings save and remove real registration plans without replacing defaults, and fit mobile', async ({
  page,
}) => {
  await app(page);
  const directory = await mkdtemp(join(tmpdir(), 'sakura-native-browser-'));
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  const registrations: any[] = [];
  const native = new NativeIntegration(
    async () => [
      { vmId: vm.id, projectId: 'default', name: 'demo / 默认项目', host: directory, guest: '/workspace' },
    ],
    join(directory, 'native.json'),
    async (previous, next) => {
      registrations.push({ previous, next });
    },
  );
  await native.init();
  await page.route('**/api/native-integration*', async (route) => {
    try {
      await route.fulfill({
        json:
          route.request().method() === 'GET'
            ? await native.view()
            : await native.action(route.request().postDataJSON()),
      });
    } catch (e: any) {
      await route.fulfill({ status: e.status || 400, json: { error: e.message } });
    }
  });
  try {
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '管理 Windows 集成', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Windows 工作区集成' });
    await panel.getByLabel('添加“在 Sakura 工作区中打开”右键菜单').check();
    await panel.getByLabel('关联工作区').selectOption(`${vm.id}:default`);
    await panel.getByRole('button', { name: '添加扩展名关联' }).click();
    await panel.getByRole('button', { name: '保存 Windows 集成' }).click();
    await expect(panel.getByRole('status')).toHaveText('Windows 集成设置已保存');
    expect(registrations[0].next.some((entry: any) => entry.path === '.txt\\OpenWithProgids')).toBe(true);
    expect(registrations[0].next.some((entry: any) => entry.path === '.txt')).toBe(false);
    await page.reload();
    await page.getByRole('button', { name: '管理 Windows 集成', exact: true }).click();
    await expect(panel.getByLabel('添加“在 Sakura 工作区中打开”右键菜单')).toBeChecked();
    await expect(panel.getByRole('button', { name: '移除 .txt 关联' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'artifacts/native-integration-mobile.png', fullPage: true });
    await panel.getByRole('button', { name: '移除菜单与文件关联' }).click();
    await expect(panel.getByLabel('添加“在 Sakura 工作区中打开”右键菜单')).not.toBeChecked();
    await expect(panel.getByRole('button', { name: '移除 .txt 关联' })).toHaveCount(0);
    expect(registrations.at(-1).next).toEqual([]);
  } finally {
    await native.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Explorer handoffs preserve explicit project selection, open directories and files, and launch mapped host copies', async ({
  page,
}) => {
  await app(page, ['projects', 'files', 'sync'], true);
  const directory = await mkdtemp(join(tmpdir(), 'sakura-native-handoff-'));
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  const file = join(directory, 'hello.txt');
  await writeFile(file, 'hello from Linux');
  const projectId = 'aaaaaaaaaaaaaaaa',
    launches: any[] = [],
    reads: string[] = [];
  const native = new NativeIntegration(
    async () => [{ vmId: vm.id, projectId, name: '第二项目', host: directory, guest: '/workspace/second' }],
    join(directory, 'native.json'),
    async () => {},
    async (file, args) => {
      launches.push({ file, args });
    },
  );
  await native.init();
  await native.action({
    action: 'configure',
    version: 1,
    settings: { contextMenu: true, editor: 'notepad', associations: [] },
  });
  await page.route('**/api/native-integration*', async (route) => {
    try {
      await route.fulfill({
        json:
          route.request().method() === 'GET'
            ? await native.view()
            : await native.action(route.request().postDataJSON()),
      });
    } catch (e: any) {
      await route.fulfill({ status: e.status || 400, json: { error: e.message } });
    }
  });
  await page.route('**/api/vms', (route) =>
    route.fulfill({ json: [{ ...vm, status: 'running', poweredOn: true }] }),
  );
  await page.route('**/api/vms/*/projects*', (route) =>
    route.fulfill({
      json: {
        active: 'default',
        projects: [
          { id: 'default', name: '默认项目' },
          { id: projectId, name: '第二项目' },
        ],
      },
    }),
  );
  await page.route('**/api/vms/*/files?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/vms/*/history*', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/vms/*/file?*', (route) => {
    reads.push(route.request().url());
    return route.fulfill({ json: { content: 'hello from Linux', version: 'a'.repeat(64) } });
  });
  try {
    const folder: any = await native.action({ action: 'receive', path: directory });
    await page.goto('/#native=' + folder.ticket);
    await expect(page.getByLabel('Linux 文件路径', { exact: true })).toHaveValue('/workspace/second');
    const ticket: any = await native.action({ action: 'receive', path: file });
    await page.evaluate((ticket) => {
      location.hash = 'native=' + ticket;
    }, ticket.ticket);
    await expect(page.locator('.cm-content')).toContainText('hello from Linux');
    expect(reads.some((value) => new URL(value).searchParams.get('project') === projectId)).toBe(true);
    await page.getByRole('button', { name: '用宿主编辑器打开' }).click();
    await expect.poll(() => launches.length).toBe(1);
    expect(launches[0].args).toEqual([file]);
    expect(new URL(page.url()).hash).toBe('');
    await page.evaluate(() => {
      location.hash = 'native-error=' + encodeURIComponent('<script>bad()</script>');
    });
    await expect(page.getByRole('status').filter({ hasText: '<script>bad()</script>' })).toBeVisible();
  } finally {
    await native.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('local assistant requires a reviewed redacted preview, renders model text safely and exports an unexecuted command plan', async ({
  page,
}) => {
  await app(page);
  const directory = await mkdtemp(join(tmpdir(), 'sakura-assistant-browser-'));
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  const chats: any[] = [];
  const assistant = new LocalAssistant(join(directory, 'assistant.json'), async (url, init) => {
    if (String(url).endsWith('/api/tags'))
      return Response.json({
        models: [{ name: 'fixture:local', size: 1048576, details: { format: 'gguf' } }],
      });
    if (String(url).endsWith('/api/show'))
      return Response.json({
        details: { format: 'gguf' },
        model_info: { 'general.architecture': 'fixture' },
      });
    const body = JSON.parse(String(init?.body));
    chats.push(body);
    const content = body.format
      ? JSON.stringify({
          goal: '查看项目状态',
          assumptions: [],
          steps: [
            { purpose: '读取 Git 状态', command: 'git status --short', risk: 'read', verify: '检查退出状态' },
          ],
        })
      : '<script>window.MODEL_EXECUTED = true</script>\nUse an assertion.';
    return Response.json({ model: 'fixture:local', done: true, message: { role: 'assistant', content } });
  });
  await assistant.init();
  await page.route('**/api/assistant', async (route) => {
    try {
      if (route.request().method() === 'GET') return route.fulfill({ json: assistant.view() });
      const input = assistantRequest.parse(route.request().postDataJSON());
      const value =
        input.action === 'configure'
          ? await assistant.configure(input.version, input.settings)
          : input.action === 'models'
            ? await assistant.models()
            : input.action === 'preview'
              ? assistant.preview(input.input)
              : await assistant.generate(input.previewId);
      return route.fulfill({ json: value });
    } catch (error: any) {
      return route.fulfill({ status: error.status || 400, json: { error: error.message } });
    }
  });
  try {
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '打开本地助手', exact: true }).click();
    const panel = page.getByRole('region', { name: '本地 AI 编程助手' });
    await panel.getByLabel('启用本地模型连接').check();
    await panel.getByLabel('模型名称', { exact: true }).fill('fixture:local');
    await panel.getByRole('button', { name: '保存模型设置' }).click();
    await panel.getByRole('button', { name: '读取本地模型' }).click();
    await expect(panel.getByRole('status')).toContainText('1 个本地模型');
    await panel.getByLabel('助手任务').selectOption('tests');
    await panel.getByLabel('问题或目标').fill('Create a test');
    await panel
      .getByLabel('代码或上下文（可选）')
      .fill('const total = 3;\npassword = PRIVATE_BROWSER_SECRET');
    await panel.getByRole('button', { name: '预览发送内容' }).click();
    await expect(panel.getByLabel('脱敏发送内容')).toContainText('[REDACTED]');
    await expect(panel.getByLabel('脱敏发送内容')).not.toContainText('PRIVATE_BROWSER_SECRET');
    expect(chats).toHaveLength(0);
    await panel.getByLabel('问题或目标').fill('Create two tests');
    await expect(panel.getByRole('button', { name: '发送到本地模型' })).toHaveCount(0);
    await panel.getByRole('button', { name: '预览发送内容' }).click();
    await panel.getByRole('button', { name: '发送到本地模型' }).click();
    await expect(panel.getByLabel('模型返回内容')).toContainText('<script>');
    expect(await page.evaluate(() => (window as any).MODEL_EXECUTED)).toBeUndefined();
    expect(JSON.stringify(chats)).not.toContain('PRIVATE_BROWSER_SECRET');
    await panel.getByLabel('助手任务').selectOption('plan');
    await panel.getByRole('button', { name: '预览发送内容' }).click();
    await panel.getByRole('button', { name: '发送到本地模型' }).click();
    await expect(panel.getByRole('heading', { name: '命令计划 · 等待人工审阅' })).toBeVisible();
    await expect(panel.locator('.assistant-result')).toContainText('git status --short');
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: '下载本次结果' }).click();
    const output = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(output.executed).toBe(false);
    expect(output.requiresReview).toBe(true);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
      'PRIVATE_BROWSER_SECRET',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.reload();
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '打开本地助手', exact: true }).click();
    await expect(panel.getByLabel('代码或上下文（可选）')).toHaveValue('');
    await expect(panel.locator('.assistant-result')).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await assistant.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('webhook settings save real routes, show one-time secrets, deliver tests, preserve edits and cancel on disable', async ({
  page,
}) => {
  await app(page);
  const directory = await mkdtemp(join(tmpdir(), 'sakura-webhook-browser-'));
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  const received: string[] = [];
  const webhooks = new Webhooks(
    async () => [],
    join(directory, 'webhooks.json'),
    async (_url, init) => {
      received.push(String(init?.body));
      return new Response(null, { status: 204 });
    },
  );
  await webhooks.init(false);
  await page.route('**/api/webhooks', async (route) => {
    try {
      if (route.request().method() === 'GET') return route.fulfill({ json: webhooks.view() });
      const value = await webhooks.configure(route.request().postDataJSON());
      await webhooks.tick();
      return route.fulfill({
        json: { ...webhooks.view(), ...('secret' in value ? { secret: value.secret } : {}) },
      });
    } catch (error: any) {
      return route.fulfill({ status: error.status || 400, json: { error: error.message } });
    }
  });
  try {
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '管理事件通知', exact: true }).click();
    const panel = page.getByRole('region', { name: '事件与告警通知设置' });
    await panel.getByLabel('接收端名称', { exact: true }).fill('Production receiver');
    await panel.getByLabel('Webhook 接收地址').fill('https://receiver.example/events');
    await panel.getByLabel('匹配全部标签').fill('production, api');
    await panel.getByLabel('启用自动投递').check();
    await panel.getByLabel('备份', { exact: true }).check();
    await panel.getByRole('button', { name: '添加接收端', exact: true }).click();
    const receiver = panel.getByRole('article', { name: '接收端 Production receiver' });
    await expect(receiver).toContainText('production、api');
    const secret = await panel.getByLabel('本次签名密钥（仅显示一次）').inputValue();
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
      secret,
    );
    await receiver.getByRole('button', { name: '测试投递' }).click();
    await expect(panel.locator('.webhook-delivery')).toContainText('已送达');
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]).type).toBe('test');
    await receiver.getByRole('button', { name: '编辑接收端' }).click();
    await expect(panel.getByLabel('匹配全部标签')).toHaveValue('production, api');
    await panel.getByLabel('接收端名称', { exact: true }).fill('Draft survives polling');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(panel.getByLabel('接收端名称', { exact: true })).toHaveValue('Draft survives polling');
    await panel.getByLabel('启用自动投递').uncheck();
    await panel.getByRole('button', { name: '保存接收端' }).click();
    await expect(panel.getByRole('article', { name: '接收端 Draft survives polling' })).toContainText(
      '已停用',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.reload();
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '管理事件通知', exact: true }).click();
    await expect(panel.getByRole('article', { name: '接收端 Draft survives polling' })).toBeVisible();
    await expect(panel.getByLabel('本次签名密钥（仅显示一次）')).toHaveCount(0);
    await panel.getByRole('button', { name: '移除接收端' }).click();
    await expect(panel.getByRole('article')).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await webhooks.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('session locking removes private UI, idle polling does not renew access, and passwords stay out of browser storage', async ({
  page,
}) => {
  await app(page, [], true);
  const directory = await mkdtemp(join(tmpdir(), 'sakura-lock-browser-'));
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  let now = Date.now(),
    activities = 0;
  const lock = new SessionLock(undefined, join(directory, 'session.json'), () => now);
  await lock.init(false);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    try {
      if (path === '/api/session') return route.fulfill({ json: lock.view() });
      if (path === '/api/session/unlock')
        return route.fulfill({ json: await lock.unlock(route.request().postDataJSON()) });
      lock.requireUnlocked();
      if (path === '/api/session/settings')
        return route.fulfill({
          json:
            route.request().method() === 'GET'
              ? lock.view()
              : await lock.configure(route.request().postDataJSON()),
        });
      if (path === '/api/session/lock') return route.fulfill({ json: lock.lock() });
      if (path === '/api/session/activity') {
        activities++;
        return route.fulfill({ json: lock.activity() });
      }
      return route.fallback();
    } catch (error: any) {
      return route.fulfill({
        status: error.status || 400,
        json: { error: error.message, session: lock.view() },
      });
    }
  });
  const password = 'Browser test passphrase';
  try {
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '管理会话锁定', exact: true }).click();
    const settings = page.getByRole('region', { name: '会话自动锁定设置' });
    await settings.getByLabel('启用空闲自动锁定').check();
    await settings.getByLabel('空闲分钟数').fill('1');
    await settings.getByLabel('设置解锁密码', { exact: true }).fill(password);
    await settings.getByLabel('确认新解锁密码').fill(password);
    await settings.getByRole('button', { name: '保存锁定策略' }).click();
    await expect(settings.getByText('会话锁定策略已保存')).toBeVisible();
    await expect(settings.getByLabel('当前解锁密码')).toHaveValue('');
    await page.mouse.move(20, 20);
    await expect.poll(() => activities).toBeGreaterThan(0);
    const expiry = lock.view().expiresAt;
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
    now += 61000;
    await expect(page.getByRole('heading', { name: 'Sakura 已锁定' })).toBeVisible();
    expect(expiry).toBeDefined();
    await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '会话自动锁定设置' })).toHaveCount(0);
    await page.getByLabel('解锁密码', { exact: true }).fill('incorrect');
    await page.getByRole('button', { name: '解锁控制面' }).click();
    await expect(page.getByRole('alert')).toContainText('不正确');
    await expect(page.getByLabel('解锁密码', { exact: true })).toHaveValue('');
    await page.getByLabel('解锁密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '解锁控制面' }).click();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await page.getByRole('button', { name: '立即锁定控制面' }).click();
    await expect(page.getByRole('heading', { name: 'Sakura 已锁定' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sakura 已锁定' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
      password,
    );
    expect(page.url()).not.toContain(password);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await lock.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('GraphQL workbench executes real typed queries, reports validation errors and exports its schema', async ({
  page,
}) => {
  await app(page, ['metrics'], true);
  const graph = new GraphApi(async () =>
    querySnapshot(
      { records: new Map([[vm.id, vm]]), state: () => 'running' } as unknown as Machines,
      [],
      ['metrics'],
    ),
  );
  await page.route('**/api/graphql-schema', (route) => route.fulfill({ json: graphqlInfo() }));
  let requests = 0;
  await page.route('**/api/graphql', async (route) => {
    requests++;
    const result = await graph.query(route.request().postDataJSON());
    return route.fulfill({
      status: result.status,
      contentType: 'application/graphql-response+json',
      body: JSON.stringify(result.body),
    });
  });
  try {
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '打开 GraphQL 查询', exact: true }).click();
    const panel = page.getByRole('region', { name: 'GraphQL 查询面板' });
    await panel
      .getByLabel('GraphQL 查询文本')
      .fill('query Read($state:String!){ selected: vms(status:$state){ name status } }');
    await panel.getByLabel('GraphQL 查询变量').fill('{"state":"running"}');
    await panel.getByRole('button', { name: '执行 GraphQL 查询', exact: true }).click();
    await expect(panel.getByLabel('GraphQL 查询结果')).toContainText(vm.name);
    await panel.getByLabel('GraphQL 查询变量').fill('invalid');
    await panel.getByRole('button', { name: '执行 GraphQL 查询', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('有效 JSON');
    expect(requests).toBe(1);
    await panel.getByLabel('GraphQL 查询变量').fill('{}');
    await panel.getByLabel('GraphQL 查询文本').fill('{ unknownField }');
    await panel.getByRole('button', { name: '执行 GraphQL 查询', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('unknownField');
    await panel.getByLabel('GraphQL 查询文本').fill('query A { apiVersion } query B { host { totalVms } }');
    await panel.getByLabel('GraphQL 操作名称').fill('B');
    await panel.getByRole('button', { name: '执行 GraphQL 查询', exact: true }).click();
    await expect(panel.getByLabel('GraphQL 查询结果')).toContainText('"totalVms": 1');
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: '下载 GraphQL Schema' }).click();
    expect(await readFile((await (await download).path())!, 'utf8')).toContain('type VirtualMachine');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.reload();
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: '打开 GraphQL 查询', exact: true }).click();
    await expect(panel.getByLabel('GraphQL 查询文本')).toContainText('query Overview');
  } finally {
    await graph.close();
  }
});

test('log retention requires a fresh preview, preserves drafts and displays durable cleanup feedback', async ({
  page,
}) => {
  await app(page);
  const summary = {
    stores: 2,
    completedLogs: 3,
    completedBytes: 1500000,
    protectedLogs: 1,
    protectedBytes: 100,
    removeLogs: 0,
    removeBytes: 0,
    expiredLogs: 0,
    capacityLogs: 0,
    remainingBytes: 1500000,
  };
  let saved: any = { policy: { enabled: false, days: 30, maxMiB: 64 }, summary };
  const requests: any[] = [];
  let stale = true;
  await page.route('**/api/log-retention', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: saved });
    const input = route.request().postDataJSON();
    requests.push(input);
    if (input.action === 'preview')
      return route.fulfill({
        json: {
          ...summary,
          removeLogs: input.policy.enabled ? 2 : 0,
          removeBytes: 900000,
          remainingBytes: 600000,
          expiredLogs: 1,
          capacityLogs: 1,
          token: 'a'.repeat(64),
        },
      });
    if (stale) {
      stale = false;
      return route.fulfill({ status: 409, json: { error: '任务日志或策略已变化，请重新预览后保存' } });
    }
    saved = {
      policy: input.policy,
      summary: { ...summary, completedLogs: 1, completedBytes: 600000 },
      lastRun: { at: new Date().toISOString(), removedLogs: 2, removedBytes: 900000 },
    };
    return route.fulfill({ json: saved });
  });
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.getByRole('button', { name: '管理任务日志', exact: true }).click();
  const panel = page.getByRole('region', { name: '任务日志保留设置' });
  await panel.getByLabel('自动清理任务日志').check();
  await panel.getByLabel('日志保留天数').fill('7');
  await panel.getByLabel('任务日志容量（MiB）').fill('1');
  const save = panel.getByRole('button', { name: '保存策略并清理' });
  await expect(save).toBeDisabled();
  await panel.getByRole('button', { name: '预览日志清理' }).click();
  await expect(panel.getByRole('status')).toContainText('将清理 2 份日志');
  await panel.getByLabel('日志保留天数').fill('8');
  await expect(save).toBeDisabled();
  await panel.getByRole('button', { name: '预览日志清理' }).click();
  await save.click();
  await expect(panel.getByRole('alert')).toContainText('重新预览');
  await expect(panel.getByLabel('日志保留天数')).toHaveValue('8');
  await expect(save).toBeDisabled();
  await panel.getByRole('button', { name: '预览日志清理' }).click();
  await save.click();
  await expect(panel.getByRole('status')).toContainText('策略已保存并应用');
  expect(requests.at(-1)).toEqual({
    action: 'save',
    policy: { enabled: true, days: 8, maxMiB: 1 },
    token: 'a'.repeat(64),
  });
  await page.reload();
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.getByRole('button', { name: '管理任务日志', exact: true }).click();
  await expect(panel.getByLabel('日志保留天数')).toHaveValue('8');
  await panel.getByLabel('自动清理任务日志').uncheck();
  await panel.getByRole('button', { name: '预览日志清理' }).click();
  await panel.getByRole('button', { name: '保存停用策略' }).click();
  await expect(panel.getByRole('status')).toContainText('自动清理已停用');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('API explorer filters declared operations, sends safe reads and downloads a usable specification and SDK', async ({
  page,
}) => {
  await app(page, ['metrics'], true);
  const specification = apiDocument(['metrics'], 7337);
  await page.route('**/api/openapi', (route) => route.fulfill({ json: specification }));
  await page.route('**/api/sdk', (route) =>
    route.fulfill({
      json: { filename: 'sakura-client.mjs', mime: 'text/javascript', content: generateSdk(specification) },
    }),
  );
  let reads = 0;
  await page.route('**/api/monitor', (route) => {
    reads++;
    return route.fulfill({ json: { host: 'API_READ_OK' } });
  });
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.getByRole('button', { name: '打开 API 浏览器', exact: true }).click();
  const explorer = page.getByRole('region', { name: 'API 浏览器', exact: true });
  await expect(explorer.getByLabel('API 操作')).toHaveValue('core.monitor');
  await explorer.getByRole('button', { name: '执行只读查询' }).click();
  await expect(explorer.getByLabel('API 查询结果')).toContainText('API_READ_OK');
  expect(reads).toBe(1);
  await explorer.getByLabel('搜索 API 接口').fill('vms.start');
  await explorer.getByLabel('API 操作').selectOption('core.vms.start');
  await explorer.getByLabel('API vmId').fill(vm.id);
  await expect(explorer.getByRole('button', { name: '执行只读查询' })).toBeDisabled();
  await explorer.getByLabel('搜索 API 接口').fill('');
  await explorer.getByLabel('API 操作').selectOption('metrics.sample');
  await explorer.getByLabel('API vmId').fill('../escape');
  await explorer.getByRole('button', { name: '执行只读查询' }).click();
  await expect(explorer.getByRole('alert')).toContainText('路径参数 vmId 无效');
  const openapi = page.waitForEvent('download');
  await explorer.getByRole('button', { name: '下载 OpenAPI', exact: true }).click();
  const specFile = await openapi;
  expect(JSON.parse(await readFile((await specFile.path())!, 'utf8')).openapi).toBe('3.1.1');
  const client = page.waitForEvent('download');
  await explorer.getByRole('button', { name: '下载 JavaScript SDK' }).click();
  const sdkFile = await client;
  expect(sdkFile.suggestedFilename()).toBe('sakura-client.mjs');
  expect(await readFile((await sdkFile.path())!, 'utf8')).toContain('export class SakuraClient');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

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
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  const policy = page.locator('.clipboard-policies');
  await policy.locator('summary').click();
  await policy.getByLabel('应用入口').selectOption('files');
  await policy.getByLabel('允许剪贴板文件与图片').uncheck();
  await page.getByRole('button', { name: '工作空间', exact: true }).click();
  const prevented = await browser.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File(['blocked'], 'secret.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  expect(uploads.length).toBe(2);
  await browser
    .locator('input[type=file]')
    .setInputFiles({ name: 'manual.txt', mimeType: 'text/plain', buffer: Buffer.from('explicit upload') });
  await expect.poll(() => uploads.length).toBe(3);
  expect(uploads[2].path).toBe('/workspace/manual.txt');
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
              : path === '/api/golden-images'
                ? {
                    templates: [],
                    issues: [],
                    limits: { count: 16, bytes: 128 * 1024 ** 3, imageBytes: 32 * 1024 ** 3 },
                    job: null,
                  }
                : path === '/api/signed-bundles'
                  ? { revision: 0, requireTrustedOnImport: false, localKey: null, trustedKeys: [] }
                  : path.endsWith('/rescue') || path.endsWith('/backup-recovery')
                    ? { runs: [] }
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

test('hardware compatibility check displays probed devices and current configuration on mobile', async ({
  page,
}) => {
  await app(page, ['projects', 'platform'], true);
  await page.route('**/api/vms/*/next-features*', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          projectId: 'default',
          settings: {},
          records: {},
          executions: [],
          jobs: [],
          capabilities: [],
          features: [
            {
              id: 'hardware-compatibility',
              name: '硬件兼容矩阵',
              category: '虚拟硬件与固件',
              summary: '按宿主机能力生成矩阵',
              state: 'available',
            },
          ],
        },
      });
    expect(route.request().postDataJSON()).toEqual({ action: 'check', featureId: 'hardware-compatibility' });
    return route.fulfill({
      json: {
        ready: true,
        executed: false,
        checkedAt: new Date().toISOString(),
        qemuVersion: 'QEMU 11.1',
        host: { platform: 'win32', arch: 'x64' },
        probes: { devices: true, accelerators: true, machines: true },
        matrix: {
          devices: [
            {
              id: 'e1000',
              name: 'Intel e1000 网卡',
              available: false,
              evidence: 'QEMU -device help',
              reason: '未列出',
            },
          ],
          accelerators: [
            { id: 'whpx', name: 'WHPX 宿主加速器', available: true, evidence: '启动时暂停虚机探测' },
          ],
          machines: [{ id: 'q35', name: 'Q35 机器类型', available: true, evidence: 'QEMU -machine help' }],
        },
        current: {
          accelerator: 'whpx',
          networkCard: 'virtio-net-pci',
          selectedDevices: ['virtio-net-pci'],
          cpuTopology: null,
          memoryHotplug: null,
          compatible: true,
          issues: [],
        },
        limitation: '客户机驱动和应用行为未在此矩阵中验证。',
      },
    });
  });
  await page.reload();
  await page.getByRole('button', { name: '能力中心', exact: true }).click();
  const row = page.locator('.catalog-item').filter({ hasText: '硬件兼容矩阵' });
  await row.getByRole('button', { name: '检查' }).click();
  const matrix = page.getByRole('region', { name: '宿主硬件兼容矩阵' });
  await expect(matrix).toContainText('WHPX 宿主加速器');
  await expect(matrix).toContainText('Intel e1000 网卡');
  await expect(matrix).toContainText('配置与宿主探测相容');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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
      expect(input.storage).toBe('discard-on-stop');
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
          storage: input.storage,
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
  await page.getByRole('combobox', { name: '磁盘写入策略', exact: true }).selectOption('discard-on-stop');
  await expect(page.getByText('每次沙箱停止都会丢弃本次磁盘改动', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '创建沙箱', exact: true }).click();
  await expect(page.getByRole('heading', { name: '在 sandbox-demo 中执行' })).toBeVisible();
  await expect(page.getByText('临时 COW 工作区：此命令结束后丢弃磁盘改动', { exact: false })).toBeVisible();
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
