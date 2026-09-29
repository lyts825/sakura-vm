import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { request as httpRequest, createServer as createHttpServer } from 'node:http';

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
    if (expected.includes('backups')) {
      const absent = randomUUID();
      assert.equal(specification.paths['/api/vms/{vmId}/backup-recovery'].post['x-sakura-enabled'], true);
      await assert.rejects(
        sdk.call('backups.recovery-view', { path: { vmId: absent } }),
        (error) => error.status === 404,
      );
      await assert.rejects(
        sdk.call('backups.recovery-run', {
          path: { vmId: absent },
          body: { backupId: randomUUID(), paths: ['../outside'] },
        }),
        (error) => error.status === 400,
      );
      await assert.rejects(
        sdk.call('backups.recovery-run', {
          path: { vmId: absent },
          body: { backupId: randomUUID(), paths: ['workspace/readme'] },
        }),
        (error) => error.status === 404,
      );
    } else {
      assert.equal(
        (await fetch(origin + '/api/vms/' + randomUUID() + '/backup-recovery', { headers })).status,
        403,
      );
    }
    if (expected.includes('snapshots')) {
      const absent = randomUUID();
      assert.equal(specification.paths['/api/vms/{vmId}/rescue'].post['x-sakura-enabled'], true);
      assert.equal(specification.paths['/api/vms/{vmId}/snapshot-diff'].post['x-sakura-enabled'], true);
      await assert.rejects(
        sdk.call('snapshots.snapshot-diff-view', { path: { vmId: absent } }),
        (error) => error.status === 404,
      );
      await assert.rejects(
        sdk.call('snapshots.snapshot-diff-run', {
          path: { vmId: absent },
          body: { from: randomUUID(), partition: -1 },
        }),
        (error) => error.status === 400,
      );
      await assert.rejects(
        sdk.call('snapshots.snapshot-diff-run', {
          path: { vmId: absent },
          body: { from: randomUUID() },
        }),
        (error) => error.status === 404,
      );
      await assert.rejects(
        sdk.call('snapshots.rescue-view', { path: { vmId: absent } }),
        (error) => error.status === 404,
      );
      await assert.rejects(
        sdk.call('snapshots.rescue-run', {
          path: { vmId: absent },
          body: { command: 'blkid', partition: -1 },
        }),
        (error) => error.status === 400,
      );
      await assert.rejects(
        sdk.call('snapshots.rescue-run', { path: { vmId: absent }, body: { command: 'blkid' } }),
        (error) => error.status === 404,
      );
      assert.deepEqual((await sdk.call('snapshots.golden-list')).templates, []);
      const id = randomUUID(),
        folder = join(data, 'golden-images', id),
        bytes = Buffer.from('Production template integrity fixture');
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'template.sakura'), bytes);
      await writeFile(
        join(folder, 'manifest.json'),
        JSON.stringify({
          version: 1,
          id,
          name: 'Production fixture',
          note: '',
          createdAt: new Date().toISOString(),
          sourceId: randomUUID(),
          sourceName: 'fixture',
          distro: 'alpine',
          diskGiB: 2,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      assert.equal((await sdk.call('snapshots.golden-list')).templates[0].id, id);
      assert.equal(
        (await sdk.call('snapshots.golden-action', { body: { action: 'verify', id } })).kind,
        'verified',
      );
      await assert.rejects(
        sdk.call('snapshots.golden-action', {
          body: { action: 'instantiate', id, name: 'invalid-template' },
        }),
      );
      assert.deepEqual(await sdk.call('core.vms.list'), []);
      assert.equal(
        (await sdk.call('snapshots.golden-action', { body: { action: 'delete', id } })).kind,
        'deleted',
      );
      assert.deepEqual((await sdk.call('snapshots.golden-list')).templates, []);
      console.log(
        'Production golden-image routes list, verify, reject malformed instances, and delete through the generated SDK.',
      );
    } else {
      assert.equal((await fetch(origin + '/api/golden-images', { headers })).status, 403);
      assert.equal((await fetch(origin + '/api/vms/' + randomUUID() + '/rescue', { headers })).status, 403);
      assert.equal(
        (await fetch(origin + '/api/vms/' + randomUUID() + '/snapshot-diff', { headers })).status,
        403,
      );
    }
    assert.equal((await sdk.call('core.monitor')).version, 1);
    assert.equal(
      (
        await fetch(origin + '/api/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"query":"{ apiVersion }"}',
        })
      ).status,
      401,
    );
    const graphSchema = await sdk.call('core.graphql.schema');
    assert.ok(graphSchema.sdl.includes('type Query'));
    const graphResult = await sdk.call('core.graphql.query', {
      body: {
        query:
          'query Inventory($n:Int!){ apiVersion host { totalVms } vms(limit:$n){ id } plugins { id enabled } }',
        variables: { n: 10 },
      },
    });
    assert.equal(graphResult.data.apiVersion, '1');
    assert.equal(graphResult.data.host.totalVms, 0);
    assert.deepEqual(graphResult.data.vms, []);
    assert.deepEqual(
      graphResult.data.plugins
        .filter((plugin) => plugin.enabled)
        .map((plugin) => plugin.id)
        .sort(),
      [...expected].sort(),
    );
    await assert.rejects(
      sdk.call('core.graphql.query', { body: { query: '{ forbiddenField }' } }),
      /forbiddenField/,
    );
    assert.equal((await fetch(origin + '/api/graphql', { headers })).status, 405);
    const oversizedGraph = await fetch(origin + '/api/graphql', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ apiVersion }', variables: { oversized: 'x'.repeat(65536) } }),
    });
    assert.equal(oversizedGraph.status, 413);
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
        const context = await browser.newContext();
        const singleAppPage = await context.newPage();
        const singleAppResponse = await singleAppPage.goto(origin + '/single-app.html');
        assert.equal(singleAppResponse.status(), 200);
        assert.match(singleAppResponse.headers()['content-security-policy'], /script-src 'self';/);
        await singleAppPage.getByRole('status')
          .filter({ hasText: '请从 Sakura 桌面页重新打开应用窗口' }).waitFor();
        await singleAppPage.close();
        console.log('Standalone single-app window loads under the production CSP.');
        const page = await context.newPage();
        const document = await page.goto(origin);
        assert.match(document.headers()['content-security-policy'], /script-src 'self';/);
        await page.getByRole('button', { name: '无障碍检查模式', exact: true }).click();
        const panel = page.getByRole('region', { name: '无障碍检查面板', exact: true });
        await panel.getByRole('button', { name: '检查当前页面', exact: true }).click();
        await panel.getByRole('status').filter({ hasText: '检查完成' }).waitFor({ timeout: 30_000 });
        assert.equal(await panel.getByRole('alert').count(), 0);
        console.log('Accessibility audit runs under the production CSP without unsafe-eval.');
        assert.match(document.headers()['content-security-policy'], /media-src 'self' blob:;/);
        const videoCheck = await page.evaluate(async () => {
          const canvas = window.document.createElement('canvas');
          canvas.width = canvas.height = 64;
          const paint = canvas.getContext('2d');
          paint.fillStyle = '#ab385b';
          paint.fillRect(0, 0, 64, 64);
          const stream = canvas.captureStream(15),
            recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
          const draw = setInterval(() => paint.fillRect(0, 0, 64, 64), 50);
          let url, video;
          try {
            const blob = await new Promise((resolve, reject) => {
              const parts = [],
                timeout = setTimeout(() => reject(new Error('Encoder timeout')), 5000);
              recorder.ondataavailable = (event) => {
                if (event.data.size) parts.push(event.data);
              };
              recorder.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Encoder failed'));
              };
              recorder.onstop = () => {
                clearTimeout(timeout);
                resolve(new Blob(parts, { type: recorder.mimeType }));
              };
              recorder.start();
              setTimeout(() => recorder.stop(), 300);
            });
            video = window.document.createElement('video');
            video.muted = true;
            video.preload = 'auto';
            url = URL.createObjectURL(blob);
            const decoded = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Video decode timeout')), 5000);
              video.onloadeddata = () => {
                clearTimeout(timeout);
                resolve(video.videoWidth);
              };
              video.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('CSP or decoder rejected video'));
              };
            });
            video.src = url;
            window.document.body.append(video);
            return { bytes: blob.size, width: await decoded };
          } finally {
            clearInterval(draw);
            if (recorder.state !== 'inactive') recorder.stop();
            for (const track of stream.getTracks()) track.stop();
            video?.remove();
            if (url) URL.revokeObjectURL(url);
          }
        });
        assert.equal(videoCheck.width, 64);
        assert.ok(videoCheck.bytes > 0);
        console.log('Canvas recordings encode and decode WebM under the production media CSP.');
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
        await page.context().setOffline(false);
        await page.goto(origin);
        await page.getByRole('button', { name: '系统设置', exact: true }).click();
        await page.getByRole('button', { name: '管理会话锁定', exact: true }).click();
        const settings = page.getByRole('region', { name: '会话自动锁定设置' });
        await settings.getByLabel('启用空闲自动锁定').check();
        await settings.getByLabel('设置解锁密码', { exact: true }).fill('production-lock-test-password');
        await settings.getByLabel('确认新解锁密码').fill('production-lock-test-password');
        await settings.getByRole('button', { name: '保存锁定策略' }).click();
        await settings.getByText('会话锁定策略已保存').waitFor();
        const second = await page.context().newPage();
        await second.goto(origin);
        await second.getByRole('button', { name: '立即锁定控制面' }).waitFor();
        await page.getByRole('button', { name: '立即锁定控制面' }).click();
        await second.getByRole('heading', { name: 'Sakura 已锁定' }).waitFor();
        await page.getByRole('heading', { name: 'Sakura 已锁定' }).waitFor();
        assert.equal(await second.getByRole('navigation', { name: '主导航' }).count(), 0);
        await page.getByLabel('解锁密码', { exact: true }).fill('production-lock-test-password');
        await page.getByRole('button', { name: '解锁控制面' }).click();
        await second.getByRole('button', { name: '立即锁定控制面' }).waitFor();
        console.log('Session locking removes private UI and synchronizes unlock across real browser tabs.');
      } finally {
        await browser.close();
      }
    }
    await sdk.authenticate();
    const password = 'production-lock-test-password';
    const configured = await sdk.call('core.session.configure', {
      body: {
        enabled: true,
        idleMinutes: 1,
        password,
        ...(!expected.length ? {} : { newPassword: password }),
      },
    });
    assert.equal(configured.enabled, true);
    const beforeLock = await fetch(origin + '/api/bootstrap').then((response) => response.json());
    const eventSocket = new WebSocket(
      origin.replace('http:', 'ws:') + '/ws/events?token=' + beforeLock.token,
      { handshakeTimeout: 3000 },
    );
    await new Promise((done, fail) => eventSocket.once('open', done).once('error', fail));
    const disconnected = new Promise((done, fail) => {
      eventSocket.once('close', done);
      eventSocket.once('error', fail);
    });
    // A request waiting for its JSON body must not execute after a lock, even with a once-valid token.
    const partial = httpRequest(origin + '/api/vms', {
      method: 'POST',
      headers: {
        'x-sakura-token': beforeLock.token,
        'content-type': 'application/json',
        'content-length': '64',
      },
    });
    const cutOff = new Promise((done, fail) => {
      partial.once('error', done);
      partial.once('response', (response) => {
        response.resume();
        fail(new Error('An incomplete protected request unexpectedly completed'));
      });
      partial.setTimeout(5000, () => {
        partial.destroy();
        fail(new Error('Locked request was not disconnected'));
      });
    });
    partial.write('{"name":');
    await delay(100);
    assert.equal((await sdk.call('core.session.lock', { body: {} })).locked, true);
    await Promise.all([disconnected, cutOff]);
    for (const path of [
      '/bootstrap',
      '/vms',
      '/monitor',
      '/downloads/unknown',
      '/graphql-schema',
      '/webhooks',
      '/assistant',
      '/native-integration',
    ]) {
      const response = await fetch(origin + '/api' + path, {
        headers: { 'x-sakura-token': beforeLock.token },
      });
      assert.equal(response.status, 423, path);
      assert.equal((await response.json()).code, 'SESSION_LOCKED');
    }
    assert.equal(
      (await fetch(origin + '/api/session', { headers: { origin: 'https://example.invalid' } })).status,
      403,
    );
    assert.equal((await sdk.call('core.session.status')).locked, true);
    await assert.rejects(
      sdk.call('core.vms.list'),
      (error) => error.status === 423 && error.code === 'SESSION_LOCKED',
    );
    await assert.rejects(
      new SakuraClient().call('core.vms.list'),
      (error) => error.status === 423 && error.code === 'SESSION_LOCKED',
    );
    const denied = new WebSocket(origin.replace('http:', 'ws:') + '/ws/events?token=' + beforeLock.token, {
      handshakeTimeout: 3000,
    });
    denied.on('error', () => {});
    const handshake = await new Promise((done, fail) => {
      denied.once('unexpected-response', (_request, response) => {
        response.resume();
        done(response.statusCode);
        denied.terminate();
      });
      denied.once('open', () => {
        denied.close();
        fail(new Error('Locked WebSocket connected'));
      });
      denied.once('error', fail);
    });
    assert.equal(handshake, 423);
    const cli = spawn(process.execPath, ['scripts/cli.mjs', 'list'], {
      cwd: root,
      env: { ...process.env, SAKURA_PORT: String(port) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let cliError = '';
    cli.stdout.resume();
    cli.stderr.on('data', (chunk) => {
      cliError += chunk;
    });
    const cliExit = await new Promise((done) => cli.once('exit', done));
    assert.equal(cliExit, 1);
    assert.match(cliError, /锁定/);
    await assert.rejects(
      sdk.call('core.session.unlock', { body: { password: 'incorrect' } }),
      (error) => error.status === 403,
    );
    assert.equal((await sdk.call('core.session.unlock', { body: { password } })).locked, false);
    const afterLock = await fetch(origin + '/api/bootstrap').then((response) => response.json());
    assert.notEqual(afterLock.token, beforeLock.token);
    assert.equal(
      (await fetch(origin + '/api/vms', { headers: { 'x-sakura-token': beforeLock.token } })).status,
      401,
    );
    assert.deepEqual(await sdk.call('core.vms.list'), []);
    assert.equal(
      (await sdk.call('core.session.configure', { body: { enabled: false, idleMinutes: 1, password } }))
        .enabled,
      false,
    );
    assert.ok(!(await readFile(join(data, 'session-lock.json'), 'utf8')).includes(password));
    assert.ok(!JSON.stringify(await sdk.call('core.audit')).includes(password));
    assert.equal((await fetch(origin + '/api/webhooks')).status, 401);
    assert.equal((await fetch(origin + '/api/assistant')).status, 401);
    assert.equal((await sdk.call('core.assistant.get')).settings.enabled, false);
    assert.deepEqual((await sdk.call('core.webhooks.get')).subscriptions, []);
    assert.equal((await fetch(origin + '/api/native-integration')).status, 401);
    const native = await sdk.call('core.native.get');
    assert.equal(native.settings.contextMenu, false);
    assert.deepEqual(native.settings.associations, []);
    assert.deepEqual(native.mappings, []);
    await assert.rejects(
      sdk.call('core.native.action', { body: { action: 'receive', path: root } }),
      /未启用|仅支持 Windows/,
    );
    if (!expected.length) {
      const deliveries = [];
      const receiver = createHttpServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        deliveries.push({ headers: req.headers, body });
        res.writeHead(204).end();
      });
      await new Promise((done) => receiver.listen(0, '127.0.0.1', done));
      try {
        const saved = await sdk.call('core.webhooks.change', {
          body: {
            action: 'save',
            subscription: {
              name: 'Production smoke',
              url: `http://127.0.0.1:${receiver.address().port}/events`,
              enabled: false,
              types: ['alert.raised'],
            },
          },
        });
        const subscription = saved.subscriptions[0];
        assert.ok(saved.secret);
        await sdk.call('core.webhooks.change', {
          body: { action: 'test', id: subscription.id, version: subscription.version },
        });
        const deadline = Date.now() + 15000;
        let history;
        while (Date.now() < deadline) {
          history = await sdk.call('core.webhooks.get');
          if (history.deliveries[0]?.status === 'delivered') break;
          await delay(200);
        }
        assert.equal(history.deliveries[0]?.status, 'delivered');
        assert.equal(deliveries.length, 1);
        assert.equal(JSON.parse(deliveries[0].body).type, 'test');
        const signature = createHmac('sha256', Buffer.from(saved.secret, 'hex'))
          .update(`${deliveries[0].headers['x-sakura-timestamp']}.${deliveries[0].body}`)
          .digest('hex');
        assert.equal(deliveries[0].headers['x-sakura-signature'], 'sha256=' + signature);
        assert.ok(!JSON.stringify(history).includes(saved.secret));
        await sdk.call('core.webhooks.change', {
          body: { action: 'remove', id: subscription.id, version: subscription.version },
        });
        console.log('Production webhook worker delivers a signed event to an actual HTTP receiver.');
      } finally {
        await new Promise((done) => receiver.close(done));
      }
      const modelCalls = [];
      const modelServer = createHttpServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        modelCalls.push({ path: req.url, body: raw ? JSON.parse(raw) : undefined });
        const body =
          req.url === '/api/show'
            ? { details: { format: 'gguf' }, model_info: { 'general.architecture': 'fixture' } }
            : req.url === '/api/tags'
              ? { models: [{ name: 'fixture:local', size: 100, details: { format: 'gguf' } }] }
              : {
                  model: 'fixture:local',
                  done: true,
                  message: {
                    role: 'assistant',
                    content: 'Protocol fixture response, not a model inference.',
                  },
                };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      });
      await new Promise((done) => modelServer.listen(0, '127.0.0.1', done));
      try {
        const settings = {
          enabled: true,
          endpoint: `http://127.0.0.1:${modelServer.address().port}`,
          model: 'fixture:local',
          timeoutSeconds: 10,
          maxTokens: 1024,
        };
        await sdk.call('core.assistant.action', { body: { action: 'configure', version: 1, settings } });
        assert.equal(
          (await sdk.call('core.assistant.action', { body: { action: 'models' } })).models[0].name,
          'fixture:local',
        );
        const preview = await sdk.call('core.assistant.action', {
          body: {
            action: 'preview',
            input: {
              mode: 'fix',
              instruction: 'Suggest a correction',
              context: 'password = PRIVATE_MODEL_CONTEXT',
            },
          },
        });
        assert.ok(!preview.content.includes('PRIVATE_MODEL_CONTEXT'));
        assert.equal(modelCalls.length, 1);
        const result = await sdk.call('core.assistant.action', {
          body: { action: 'generate', previewId: preview.id },
        });
        assert.equal(result.model, 'fixture:local');
        assert.ok(!JSON.stringify(modelCalls).includes('PRIVATE_MODEL_CONTEXT'));
        assert.ok(!JSON.stringify(await sdk.call('core.audit')).includes('PRIVATE_MODEL_CONTEXT'));
        const stored = await readFile(join(data, 'local-assistant.json'), 'utf8');
        assert.ok(!stored.includes('PRIVATE_MODEL_CONTEXT'));
        assert.ok(!stored.includes(result.content));
        await sdk.call('core.assistant.action', {
          body: { action: 'configure', version: 2, settings: { ...settings, enabled: false } },
        });
        console.log(
          'Production local assistant validates the model protocol and sends only previewed, redacted context.',
        );
      } finally {
        await new Promise((done) => modelServer.close(done));
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
await probe(['backups'], ['transfers', 'snapshots', 'secrets', 'backups']);
