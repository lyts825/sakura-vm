import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const directory = await mkdtemp(join(tmpdir(), 'sakura-notebook-smoke-'));
const isolated = process.env.SAKURA_NOTEBOOK_PRIVATE === '1';
const distro = process.argv[2] || 'alpine';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { NotebookEnvironments } = await import('../server/notebook-environments.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
let notebooks = new NotebookEnvironments(machines, workspaces);
await notebooks.init();
try {
  const vm = await machines.create({ name: 'notebook-smoke', distro, memoryMiB: 2048,
    cpus: 2, diskGiB: 8, accelerator: 'auto' });
  await machines.start(vm.id);
  const deadline = Date.now() + 270_000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(200);
  }
  if (isolated) await workspaces.save(vm.id, { directory: '/workspace',
    template: 'python', networkIsolation: 'private' });
  for (const [provider, guestPort] of [['marimo', 2718], ['jupyter', 8888]] as const) {
    const hostPort = await freePort();
    const input = { mode: 'start', provider, guestPort, hostPort } as const;
    const result = await notebooks.run(vm.id, input, new AbortController().signal,
      (line) => process.stdout.write(line));
    assert.equal(result.session?.status, 'running');
    const link = await notebooks.link(vm.id);
    assert.equal(link.provider, provider);
    assert.match(link.url, new RegExp(`^http://127\\.0\\.0\\.1:${hostPort}/`));
    const response = await fetch(link.url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    await response.body?.cancel();
    assert.ok(response.status >= 200 && response.status < 400,
      `${provider} returned HTTP ${response.status}`);
    if (provider === 'marimo') {
      assert.ok(!response.headers.get('location')?.includes('/auth/login'),
        'tokenized Marimo link unexpectedly redirected to login');
      const anonymous = await fetch(`http://127.0.0.1:${hostPort}/`,
        { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      await anonymous.body?.cancel();
      assert.match(anonymous.headers.get('location') || '', /\/auth\/login/);
    } else {
      const anonymous = await fetch(`http://127.0.0.1:${hostPort}/api/status`,
        { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      await anonymous.body?.cancel();
      assert.ok(anonymous.status === 401 || anonymous.status === 403,
        `unauthenticated Jupyter status returned HTTP ${anonymous.status}`);
      const token = new URL(link.url).searchParams.get('token')!;
      const kernelResponse = await fetch(`http://127.0.0.1:${hostPort}/api/kernels`, {
        method: 'POST', headers: { authorization: `token ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'python3' }), signal: AbortSignal.timeout(15000) });
      assert.equal(kernelResponse.status, 201, await kernelResponse.clone().text());
      const kernel = await kernelResponse.json() as { id: string };
      const namespace = await machines.exec(vm.id, isolated
        ? 'ip netns exec sk-default readlink /proc/self/ns/net' : 'readlink /proc/self/ns/net', 10000);
      assert.equal(namespace.code, 0, namespace.stderr);
      const ws = new WebSocket(`ws://127.0.0.1:${hostPort}/api/kernels/${kernel.id}/channels?session_id=${randomUUID()}&token=${token}`);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('kernel WebSocket open timed out')), 20000);
          ws.once('open', () => { clearTimeout(timer); resolve(); });
          ws.once('error', (error) => { clearTimeout(timer); reject(error); });
        });
        const code = `import os, socket\nassert os.readlink('/proc/self/ns/net') == ${JSON.stringify(namespace.stdout.trim())}\n` +
          (isolated ? `s = socket.socket()\ntry:\n s.connect(('10.0.2.2', 80))\n raise AssertionError('private kernel reached shared guest network')\nexcept OSError:\n pass\nfinally:\n s.close()\n` : '') +
          `print('SAKURA_KERNEL_NAMESPACE_OK')`;
        const msgId = randomUUID();
        const executed = new Promise<void>((resolve, reject) => {
          let output = '';
          const timer = setTimeout(() => reject(new Error('kernel execution timed out')), 30000);
          ws.on('message', (data) => {
            const message = JSON.parse(data.toString()) as { parent_header?: { msg_id?: string },
              msg_type?: string, content?: { text?: string, status?: string, evalue?: string } };
            if (message.parent_header?.msg_id !== msgId) return;
            if (message.msg_type === 'stream') output += message.content?.text || '';
            if (message.msg_type === 'execute_reply') {
              clearTimeout(timer);
              if (message.content?.status !== 'ok' || !output.includes('SAKURA_KERNEL_NAMESPACE_OK'))
                reject(new Error(message.content?.evalue || 'kernel namespace verification failed'));
              else resolve();
            }
          });
          ws.once('error', (error) => { clearTimeout(timer); reject(error); });
        });
        ws.send(JSON.stringify({ header: { msg_id: msgId, username: 'sakura', session: randomUUID(),
          msg_type: 'execute_request', version: '5.3', date: new Date().toISOString() },
          parent_header: {}, metadata: {}, channel: 'shell', content: { code, silent: false,
            store_history: false, user_expressions: {}, allow_stdin: false, stop_on_error: true } }));
        await executed;
      } finally {
        ws.terminate();
        const deleted = await fetch(`http://127.0.0.1:${hostPort}/api/kernels/${kernel.id}`, {
          method: 'DELETE', headers: { authorization: `token ${token}` }, signal: AbortSignal.timeout(10000) });
        await deleted.body?.cancel();
        assert.equal(deleted.status, 204);
      }
    }
    if (isolated) {
      assert.equal(machines.get(vm.id).forwards.length, 0);
      const check = await machines.exec(vm.id,
        'test "$(ip -n sk-default -o link show | wc -l)" -eq 1 && ' +
        'test -z "$(ip -n sk-default -o -4 route show)" && ' +
        'test -z "$(ip -n sk-default -o -6 route show)" && ' +
        'test -n "$(ip netns pids sk-default)"', 10000);
      assert.equal(check.code, 0, check.stderr);
      await notebooks.close();
      notebooks = new NotebookEnvironments(machines, workspaces);
      await notebooks.init();
      assert.equal((await notebooks.view(vm.id, input)).session?.status, 'running');
      assert.equal((await notebooks.link(vm.id)).url, link.url);
    }
    console.log(`Real ${distro}/QEMU ${provider} installed, authenticated and reached through ${isolated ? 'private SSH bridge' : 'QEMU forward'} ${hostPort}.`);
    await notebooks.run(vm.id, { mode: 'stop' }, new AbortController().signal, () => {});
    assert.equal(machines.get(vm.id).forwards.length, 0);
  }
} finally {
  await notebooks.close();
  await workspaces.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
