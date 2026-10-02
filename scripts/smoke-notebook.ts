import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const parent = await realpath(tmpdir());
const directory = await mkdtemp(join(parent, 'sakura-notebook-smoke-'));
const projectDirectory = '/workspace/notebook-smoke';
const marker = 'notebook-smoke-' + randomUUID();
const isolated = process.env.SAKURA_NOTEBOOK_PRIVATE === '1';
const distro = process.argv[2] || 'alpine';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { NotebookEnvironments, notebookSessionSchema } = await import('../server/notebook-environments.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { ProjectIdentities } = await import('../server/project-identity.ts');
const { quote } = await import('../server/files.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
let notebooks = new NotebookEnvironments(machines, workspaces);
await notebooks.init();
let primaryFailure: unknown;
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
  await workspaces.save(vm.id, { directory: projectDirectory, template: 'python',
    networkIsolation: isolated ? 'private' : 'host', environment: { SAKURA_NOTEBOOK_SMOKE: marker } });
  const prepared = await machines.exec(vm.id, 'mkdir -p ' + quote(projectDirectory), 10000);
  assert.equal(prepared.code, 0, prepared.stderr);
  const migrations = new ProjectDirectoryMigrations(machines, workspaces);
  const preview = await migrations.preview(vm.id); assert.ok(preview.plan);
  assert.equal(preview.plan.proposal.directory, projectDirectory);
  const applied = await migrations.apply(vm.id, { action: 'apply', version: 1,
    planId: preview.plan.proposal.planId, sha256: preview.plan.sha256, reviewed: true });
  assert.equal(applied.plan?.state, 'applied'); assert.ok(applied.plan?.activatedIdentity);
  const identity = applied.plan.activatedIdentity, identities = new ProjectIdentities(machines);
  assert.notEqual(identity.uid, 0); assert.equal(identity.gid, identity.uid);
  assert.equal(identity.home, '/var/lib/sakura-project-homes/' + identity.identityId);
  for (const [provider, guestPort] of [['marimo', 2718], ['jupyter', 8888]] as const) {
    const hostPort = await freePort();
    const input = { mode: 'start', provider, guestPort, hostPort } as const;
    const result = await notebooks.run(vm.id, input, new AbortController().signal,
      (line) => process.stdout.write(line));
    assert.equal(result.session?.status, 'running');
    assert.equal(machines.get(vm.id).forwards.length, 0);
    const store = JSON.parse(await readFile(join(directory, 'notebook-environments.json'), 'utf8'));
    const owned = notebookSessionSchema.parse(store.sessions.find((row: { vmId: string; projectId: string }) =>
      row.vmId === vm.id && row.projectId === 'default'));
    const execution = owned.execution; assert.ok(execution?.run);
    assert.deepEqual(execution.identity, identity);
    assert.deepEqual(await identities.runReadonly(vm.id, identity, execution.record.runId), execution.run);
    const account = await machines.exec(vm.id, '/usr/bin/python3 -I -S -c ' + quote(
      'import json,os\nuid=' + identity.uid + '\ngroup=' + JSON.stringify(execution.run.cgroupName) +
      '\npids=[int(value) for value in open("/sys/fs/cgroup/"+group+"/cgroup.procs").read().split()]\n' +
      'assert pids\nassert any(all(int(value)==uid for value in next(line for line in open("/proc/"+str(pid)+"/status") if line.startswith("Uid:")).split()[1:]) for pid in pids)\nprint("NOTEBOOK_PROJECT_UID_OK")'), 10000);
    assert.equal(account.code, 0, account.stderr); assert.equal(account.stdout.trim(), 'NOTEBOOK_PROJECT_UID_OK');
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
        const code = `import os, socket\nassert os.getuid() == ${identity.uid} and os.getgid() == ${identity.gid}\nassert os.environ['HOME'] == ${JSON.stringify(identity.home)}\nassert os.environ['SAKURA_NOTEBOOK_SMOKE'] == ${JSON.stringify(marker)}\nassert os.getcwd() == ${JSON.stringify(projectDirectory)}\nassert os.readlink('/proc/self/ns/net') == ${JSON.stringify(namespace.stdout.trim())}\nassert open('/proc/self/cgroup').read().strip() == ${JSON.stringify('0::/' + execution.run.cgroupName)}\n` +
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
    }
    await notebooks.close();
    notebooks = new NotebookEnvironments(machines, workspaces);
    await notebooks.init();
    assert.equal((await notebooks.view(vm.id, input)).session?.status, 'running');
    assert.equal((await notebooks.link(vm.id)).url, link.url);
    console.log(`Real ${distro}/QEMU ${provider} project UID installed, authenticated and reached through ${isolated ? 'private' : 'host'} SSH loopback bridge ${hostPort}.`);
    await notebooks.run(vm.id, { mode: 'stop' }, new AbortController().signal, () => {});
    assert.equal(machines.get(vm.id).forwards.length, 0);
    const absent = await machines.exec(vm.id, 'test ! -e ' + quote('/sys/fs/cgroup/' + execution.run.cgroupName), 10000);
    assert.equal(absent.code, 0, absent.stderr);
    assert.deepEqual(await identities.runReadonly(vm.id, identity, execution.record.runId), { ...execution.run, phase: 'closed' });
  }
} catch (error) {
  primaryFailure = error; throw error;
} finally {
  const failures: unknown[] = [];
  for (const close of [() => notebooks.close(), () => workspaces.close(), () => machines.close()]) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError([...(primaryFailure ? [primaryFailure] : []), ...failures],
    'Notebook smoke cleanup failed; the owned test directory was retained');
  assert.equal(machines.live.size, 0);
  const owned = await realpath(directory);
  assert.equal(dirname(owned), parent); assert.match(basename(owned), /^sakura-notebook-smoke-/);
  // Retain a failed run's own artifacts for diagnosis. Only a fully successful
  // fresh test directory is removed after all VM and controller closes.
  if (!primaryFailure) await rm(owned, { recursive: true, force: true });
}
