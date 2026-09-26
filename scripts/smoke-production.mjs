import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
async function probe(selected, expected) {
  const data = await mkdtemp(join(tmpdir(), 'sakura-production-'));
  if (!resolve(data).startsWith(resolve(tmpdir()) + sep)) throw new Error('临时数据目录越界');
  await mkdir(join(data, 'jobs'));
  const logRecord = {
    id: randomUUID(),
    key: 'retention-smoke',
    scope: 'commands',
    status: 'done',
    startedAt: '2020-01-01T00:00:00.000Z',
    finishedAt: '2020-01-01T00:01:00.000Z',
    log: 'EXPIRED_TASK_LOG',
    title: 'Retention smoke task',
  };
  await writeFile(join(data, 'jobs', 'commands.json'), JSON.stringify([logRecord]));
  if (selected.length)
    await writeFile(
      join(data, 'plugins.json'),
      JSON.stringify({ schemaVersion: 3, plugins: selected, packs: [] }),
    );
  const listener = createServer();
  await new Promise((done, fail) => listener.listen(0, '127.0.0.1', done).once('error', fail));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const server = spawn(process.execPath, ['.sakura-server/index.js'], {
    cwd: root,
    env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise((done) => {
    server.once('exit', done);
    server.once('error', done);
  });
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  server.on('error', (error) => (output += error.message));
  const origin = `http://127.0.0.1:${port}`;
  try {
    let bootstrap;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null || server.signalCode !== null)
        throw new Error(`编译版服务提前退出：${output}`);
      try {
        const response = await fetch(`${origin}/api/bootstrap`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          bootstrap = await response.json();
          break;
        }
      } catch {}
      await delay(200);
    }
    assert.ok(bootstrap?.token, `编译版服务未启动：${output}`);
    const headers = { 'x-sakura-token': bootstrap.token };
    const specification = await fetch(origin + '/api/openapi', { headers }).then((response) =>
      response.json(),
    );
    assert.equal(specification.openapi, '3.1.1');
    assert.equal(
      specification.paths['/api/vms/{vmId}/metrics'].get['x-sakura-enabled'],
      expected.includes('metrics'),
    );
    const sdkFile = await fetch(origin + '/api/sdk', { headers }).then((response) => response.json());
    assert.ok(!sdkFile.content.includes(bootstrap.token));
    const { SakuraClient } = await import(
      'data:text/javascript;base64,' + Buffer.from(sdkFile.content).toString('base64')
    );
    const sdk = new SakuraClient();
    assert.deepEqual(await sdk.call('core.vms.list'), []);
    assert.equal((await sdk.call('core.monitor')).version, 1);
    assert.equal((await fetch(origin + '/api/log-retention')).status, 401);
    const retentionPolicy = { enabled: true, days: 7, maxMiB: 1 };
    const retentionPreview = await sdk.call('core.log-retention.change', {
      body: { action: 'preview', policy: retentionPolicy },
    });
    assert.equal(retentionPreview.removeLogs, expected.includes('commands') ? 1 : 0);
    const retained = await sdk.call('core.log-retention.change', {
      body: { action: 'save', policy: retentionPolicy, token: retentionPreview.token },
    });
    assert.equal(retained.policy.enabled, true);
    const storedLog = JSON.parse(await readFile(join(data, 'jobs', 'commands.json'), 'utf8'))[0];
    assert.equal(storedLog.log, expected.includes('commands') ? '' : 'EXPIRED_TASK_LOG');
    assert.equal(storedLog.title, logRecord.title);
    assert.equal(
      (await sdk.call('core.log-retention.get')).lastRun.removedLogs,
      expected.includes('commands') ? 1 : 0,
    );
    const [system, plugins, html] = await Promise.all([
      fetch(`${origin}/api/system`, { headers }).then((response) => response.json()),
      fetch(`${origin}/api/plugins`, { headers }).then((response) => response.json()),
      fetch(origin).then((response) => response.text()),
    ]);
    assert.deepEqual([...system.plugins].sort(), [...expected].sort());
    assert.deepEqual([...plugins.active].sort(), [...expected].sort());
    assert.deepEqual(plugins.errors, {});
    const monitor = await fetch(origin + '/api/monitor', { headers });
    assert.equal(monitor.status, 200);
    const monitoring = await monitor.json();
    assert.equal(monitoring.version, 1);
    assert.deepEqual(monitoring.vms, []);
    assert.equal((await fetch(origin + '/api/monitor')).status, 401);
    assert.equal((await fetch(origin + '/api/monitor', { method: 'POST', headers })).status, 405);
    const manifest = await fetch(origin + '/monitor/manifest.webmanifest');
    assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
    assert.equal((await manifest.json()).scope, '/monitor/');
    const worker = await fetch(origin + '/monitor/sw.js');
    assert.equal(worker.headers.get('cache-control'), 'no-cache');
    assert.ok(!(await worker.text()).includes('__MONITOR_REVISION__'));
    assert.equal(plugins.plugins.length, 32);
    const auditBefore = await fetch(origin + '/api/audit', { headers }).then((response) => response.json());
    assert.equal(auditBefore.valid, true);
    const rejected = await fetch(origin + '/api/audit-smoke', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'AUDIT_BODY_MUST_NOT_APPEAR' }),
    });
    assert.equal(rejected.status, 404);
    const auditAfter = await fetch(origin + '/api/audit', { headers }).then((response) => response.json());
    assert.equal(auditAfter.valid, true);
    assert.ok(auditAfter.sequence >= auditBefore.sequence + 2);
    const requestEvents = auditAfter.records.filter((entry) => entry.event.name === 'POST /api/audit-smoke');
    assert.equal(requestEvents.length, 2);
    assert.equal(requestEvents[1].event.status, 404);
    assert.equal(requestEvents[0].event.traceId, requestEvents[1].event.traceId);
    assert.ok(!JSON.stringify(auditAfter).includes('AUDIT_BODY_MUST_NOT_APPEAR'));
    const sandboxResponse = await fetch(origin + '/api/sandboxes', { headers });
    assert.equal(sandboxResponse.status, expected.includes('sandbox') ? 200 : 403);
    if (expected.includes('sandbox')) {
      assert.deepEqual(await sandboxResponse.json(), { sandboxes: [], runs: [] });
      const invalid = await fetch(origin + '/api/sandboxes', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ name: '../invalid', forwards: [{ host: 8080, guest: 80 }] }),
      });
      assert.equal(invalid.status, 400);
    }
    assert.match(html, /<div id="root"><\/div>/);
    if (!expected.length) {
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        const document = await page.goto(origin);
        assert.match(document.headers()['content-security-policy'], /script-src 'self';/);
        await page.getByRole('button', { name: '无障碍检查模式', exact: true }).click();
        const panel = page.getByRole('region', { name: '无障碍检查面板', exact: true });
        await panel.getByRole('button', { name: '检查当前页面', exact: true }).click();
        await panel.getByRole('status').filter({ hasText: '检查完成' }).waitFor({ timeout: 30_000 });
        assert.equal(await panel.getByRole('alert').count(), 0);
        console.log('Accessibility audit runs under the production CSP without unsafe-eval.');
        await page.goto(origin + '/monitor/index.html');
        await page.locator('#connection').filter({ hasText: '已连接' }).waitFor();
        await page.getByRole('button', { name: '启用离线缓存' }).click();
        await page.locator('#cache-state').filter({ hasText: '离线缓存已启用' }).waitFor();
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await page.context().setOffline(true);
        await page.reload();
        await page.locator('#connection').filter({ hasText: '缓存快照' }).waitFor();
        assert.match(await page.locator('#sample-time').textContent(), /采样于/);
        await page.getByRole('button', { name: '清除离线数据' }).click();
        await page.waitForFunction(async () => (await caches.keys()).length === 0);
        console.log('Read-only monitoring survives an offline reload under the production CSP.');
      } finally {
        await browser.close();
      }
    }
    console.log(`Compiled server passed: ${expected.length} active plugins, static UI.`);
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
    await Promise.race([exited, delay(10_000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    await rm(data, { recursive: true, force: true });
  }
}

await probe([], []);
await probe(['metrics'], ['metrics']);
await probe(['commands'], ['projects', 'commands']);
await probe(['commands', 'metrics'], ['projects', 'commands', 'metrics']);
await probe(['sandbox'], ['sandbox']);
