import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-http-ingress-smoke-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-http-ingress-smoke-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { HttpIngress } = await import('../server/http-ingress.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const ingress = new HttpIngress(machines);
try {
  let forward = await freePort(),
    listener = await freePort();
  while (listener === forward) listener = await freePort();
  const vm = await machines.create({
    name: 'http-ingress-smoke',
    memoryMiB: 512,
    cpus: 2,
    diskGiB: 4,
    forwards: [{ name: 'web', host: forward, guest: 8080 }],
  });
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(200);
  }
  const web = await machines.exec(
    vm.id,
    "set -e\napk add --no-cache python3\nmkdir -p /workspace/web\nprintf 'Sakura ingress proof' > /workspace/web/index.html\nnohup python3 -m http.server 8080 --bind 0.0.0.0 --directory /workspace/web </dev/null >/tmp/sakura-http.log 2>&1 &",
    300000,
  );
  assert.equal(web.code, 0, web.stderr);
  let upstreamReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    upstreamReady = await fetch(`http://127.0.0.1:${forward}/`)
      .then((response) => response.status === 200)
      .catch(() => false);
    if (upstreamReady) break;
    await delay(250);
  }
  assert.equal(upstreamReady, true, '客户机 HTTP 服务没有通过 QEMU 端口转发就绪');
  await ingress.init();
  const view = await ingress.action({
    action: 'save',
    entry: {
      name: 'web',
      listenPort: listener,
      pathPrefix: '/app',
      vmId: vm.id,
      upstreamPort: forward,
      healthPath: '/',
      stripPrefix: true,
    },
  });
  assert.equal(view.entries.length, 1);
  const response = await fetch(`http://127.0.0.1:${listener}/app`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Sakura ingress proof');
  const checked = await ingress.action({ action: 'check', id: view.entries[0].id });
  assert.equal(checked.entries[0].health.status, 'healthy');
  await machines.stop(vm.id);
  assert.equal((await fetch(`http://127.0.0.1:${listener}/app`)).status, 503);
  console.log('Real QEMU NAT to HTTP ingress, health check and stopped-instance refusal passed.');
} finally {
  await ingress.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
