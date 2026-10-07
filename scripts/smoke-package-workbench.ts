/** 烟雾验收：验证来宾包的已安装/搜索/更新列表解析以及审阅后的安装和移除。
 * Smoke acceptance for installed/search/update parsing and reviewed guest package install/removal. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { JobView } from '../server/jobs.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-package-workbench-smoke-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const suite = new FeatureSuite(machines, workspaces);
/** 启动给定实例，然后轮询正式状态至 running；只在源码限定的启动期限内等待，超时将抛错并附启动日志。
 * Start the specified VM, then poll production state until running within the source-defined startup deadline; timeout fails with boot logs. */
const boot = async (id: string) => {
  await machines.start(id);
  const deadline = Date.now() + 270_000;
  while (machines.state(id) !== 'running') {
    assert.equal(machines.state(id), 'starting', machines.logs.get(id));
    assert.ok(Date.now() < deadline, machines.logs.get(id));
    await delay(100);
  }
};
/** 经包工作台公开 action 提交输入，要求任务键并等待 done；任务错误作为验收失败传播。
 * Submit input through public package-workbench action, require a job key and await done, propagating job errors as verification failure. */
const run = async (id: string, input: unknown) => {
  const response = await suite.packageWorkbench.action(id, input) as { job: JobView };
  assert.ok(response.job.key);
  await suite.jobs.wait(response.job.key);
  const job = suite.jobs.view(response.job.key);
  assert.equal(job?.status, 'done', job?.error || job?.log);
};
try {
  const vm = await machines.create({ name: 'package-workbench-smoke', memoryMiB: 512 });
  await boot(vm.id);
  await run(vm.id, { operation: 'refresh-index' });
  const installed = await suite.packageWorkbench.query(vm.id,
    { mode: 'installed', query: 'openssh', page: 1, limit: 50 });
  assert.ok(installed.items.some((item) => item.name === 'openssh'));
  const search = await suite.packageWorkbench.query(vm.id,
    { mode: 'search', query: 'jq', page: 1, limit: 50 });
  assert.ok(search.items.some((item) => item.name === 'jq'));
  const updates = await suite.packageWorkbench.query(vm.id,
    { mode: 'updates', query: '', page: 1, limit: 50 });
  assert.ok(updates.items.some((item) => item.availableVersion));
  const allUpgrade = await suite.packageWorkbench.action(vm.id,
    { operation: 'preview', change: 'upgrade-all' }) as { plan: string };
  assert.match(allUpgrade.plan, /Upgrading|OK:/);
  console.log('Package workbench: installed, search, and available update lists parsed');
  const preview = await suite.packageWorkbench.action(vm.id,
    { operation: 'preview', change: 'install', name: 'jq' }) as { token: string; plan: string };
  assert.match(preview.plan, /Installing jq/);
  await run(vm.id, { operation: 'apply', token: preview.token });
  const added = await suite.packageWorkbench.query(vm.id,
    { mode: 'installed', query: 'jq', page: 1, limit: 50 });
  assert.ok(added.items.some((item) => item.name === 'jq'));
  const remove = await suite.packageWorkbench.action(vm.id,
    { operation: 'preview', change: 'remove', name: 'jq' }) as { token: string; plan: string };
  assert.match(remove.plan, /Purging jq/);
  await run(vm.id, { operation: 'apply', token: remove.token });
  const after = await suite.packageWorkbench.query(vm.id,
    { mode: 'installed', query: 'jq', page: 1, limit: 50 });
  assert.ok(!after.items.some((item) => item.name === 'jq'));
  console.log('Package workbench: reviewed install and removal changed the Alpine guest');
  await machines.stop(vm.id);
  const debian = await machines.create({ name: 'package-workbench-debian',
    distro: 'debian', memoryMiB: 1024 });
  await boot(debian.id);
  await run(debian.id, { operation: 'refresh-index' });
  const debianInstalled = await suite.packageWorkbench.query(debian.id,
    { mode: 'installed', query: 'openssh', page: 1, limit: 50 });
  assert.equal(debianInstalled.manager, 'apt');
  assert.ok(debianInstalled.items.some((item) => item.name.includes('openssh')));
  const debianSearch = await suite.packageWorkbench.query(debian.id,
    { mode: 'search', query: 'jq', page: 1, limit: 50 });
  assert.ok(debianSearch.items.some((item) => item.name === 'jq'));
  const debianUpdates = await suite.packageWorkbench.query(debian.id,
    { mode: 'updates', query: '', page: 1, limit: 50 });
  assert.equal(debianUpdates.manager, 'apt');
  const debianUpgrade = await suite.packageWorkbench.action(debian.id,
    { operation: 'preview', change: 'upgrade-all' }) as { plan: string };
  assert.match(debianUpgrade.plan, /upgraded/);
  console.log('Package workbench: Debian installed, search, and update views parsed');
} finally {
  await suite.close();
  await workspaces.close();
  await machines.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') ||
    resolve(directory).startsWith(resolve(tmpdir()) + '/'));
  await rm(directory, { recursive: true, force: true });
}
