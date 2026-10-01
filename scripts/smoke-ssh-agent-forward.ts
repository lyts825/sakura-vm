import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Windows host required');
const directory = await mkdtemp(join(tmpdir(), 'sakura-ssh-agent-vm-'));
process.env.SAKURA_DATA_DIR = directory;
const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro]);
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const pipe = '\\\\.\\pipe\\sakura-ssh-agent-' + process.pid + '-' + randomBytes(4).toString('hex');
process.env.SSH_AUTH_SOCK = pipe;
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { checkSshAgentForward, runSshAgentForward } = await import('../server/ssh-agent-forward.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Secrets } = await import('../server/secrets.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const secrets = new Secrets(machines), workspaces = new Workspaces(machines, { secrets });
const u32 = (value: number) => {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value);
  return output;
};
const sshString = (value: Buffer | string) => {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([u32(content.length), content]);
};
const publicBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(randomBytes(32))]);
let queries = 0;
const agent = createServer((socket) => {
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
      const length = pending.readUInt32BE(0);
      const request = pending.subarray(4, 4 + length);
      pending = pending.subarray(4 + length);
      if (request[0] !== 11) { socket.destroy(new Error('Unexpected agent request')); return; }
      queries++;
      const response = Buffer.concat([Buffer.from([12]), u32(1),
        sshString(publicBlob), sshString('sakura-test')]);
      socket.write(Buffer.concat([u32(response.length), response]));
    }
  });
});
await new Promise<void>((done) => agent.listen(pipe, done));
try {
  const vm = await machines.create({ name: 'ssh-agent-smoke', distro, memoryMiB: 1024,
    cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const tool = await machines.exec(vm.id,
    'command -v ssh-add >/dev/null || { if command -v apk >/dev/null; then apk add --no-cache openssh-client; else apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-client; fi; }', 180000);
  assert.equal(tool.code, 0, tool.stdout + tool.stderr);
  if (distro === 'alpine') {
    const cgroups = await machines.exec(vm.id,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /sbin/rc-service cgroups start', 30000);
    assert.equal(cgroups.code, 0, cgroups.stderr);
  }
  const privateMode = process.env.SAKURA_AGENT_PRIVATE === '1';
  await workspaces.save(vm.id, { directory: '/workspace/agent-project',
    networkIsolation: privateMode ? 'private' : 'host', environment: { SAKURA_AGENT_MARKER: 'project' } });
  const created = await machines.exec(vm.id,
    'set -eu\ntest ! -e /workspace/agent-project\nmkdir -m 0700 /workspace/agent-project', 10000);
  assert.equal(created.code, 0, created.stderr);
  // Only this script's newly created VM and directory are reviewed and migrated.
  const migrations = new ProjectDirectoryMigrations(machines, workspaces);
  const preview = await migrations.preview(vm.id);
  assert.ok(preview.plan);
  await migrations.apply(vm.id, { action: 'apply', version: 1, reviewed: true,
    planId: preview.plan.proposal.planId, sha256: preview.plan.sha256 });
  const before = await machines.exec(vm.id, 'test -z "${SSH_AUTH_SOCK:-}"');
  assert.equal(before.code, 0, before.stdout + before.stderr);
  const checked = await checkSshAgentForward(machines, vm.id);
  assert.equal(checked.ready, true, checked.reason);
  await assert.rejects(runSshAgentForward(machines, vm.id,
    { command: 'ssh-add -L', confirmed: false }));
  const forwarded = await runSshAgentForward(machines, vm.id,
    { command: 'ssh-add -L', confirmed: true, timeoutSeconds: 30 });
  assert.equal(forwarded.code, 0, forwarded.stdout + forwarded.stderr);
  assert.match(forwarded.stdout, /ssh-ed25519/);
  assert.ok(queries > 0);
  await secrets.save(vm.id, { name: 'agent-key', value: 'agent-forward-test-private' });
  await workspaces.save(vm.id, { directory: '/workspace/agent-project', networkIsolation: privateMode ? 'private' : 'host',
    environment: { SAKURA_AGENT_MARKER: 'project', SSH_AUTH_SOCK: '/tmp/incorrect-agent' }, secrets: { SAKURA_AGENT_SECRET: 'agent-key' } });
  const hostNamespace = (await machines.exec(vm.id, 'readlink /proc/self/ns/net')).stdout.trim();
  const scoped = await runSshAgentForward(machines, vm.id, { command:
    'readlink /proc/self/ns/net; pwd; printf "%s\\n" "$SAKURA_AGENT_MARKER" "$SAKURA_AGENT_SECRET"; ssh-add -L', confirmed: true }, undefined, workspaces);
  const namespace = privateMode ? (await machines.exec(vm.id, 'ip netns exec sk-default readlink /proc/self/ns/net')).stdout.trim() : hostNamespace;
  assert.equal(scoped.networkIsolation, privateMode ? 'private' : 'host');
  assert.equal(scoped.projectId, 'default');
  assert.ok(scoped.stdout.startsWith(`${namespace}\n/workspace/agent-project\nproject\n[私密配置已隐藏]\n`), scoped.stdout);
  assert.match(scoped.stdout, /ssh-ed25519/);
  if (privateMode) {
    assert.notEqual(namespace, hostNamespace);
    assert.equal((await machines.exec(vm.id, 'ip -n sk-default route add blackhole 203.0.113.0/24')).code, 0);
    await assert.rejects(runSshAgentForward(machines, vm.id, { command: 'touch /workspace/agent-leak', confirmed: true }, undefined, workspaces), /网络路由/);
    assert.equal((await machines.exec(vm.id, 'test ! -e /workspace/agent-leak; ip -n sk-default route del blackhole 203.0.113.0/24')).code, 0);
  }
  const cancelled = new AbortController();
  const pending = runSshAgentForward(machines, vm.id,
    { command: 'echo $$ > /workspace/agent-project/cancel.pid; sleep 600 & echo $! >> /workspace/agent-project/cancel.pid; wait', confirmed: true, timeoutSeconds: 30 },
    cancelled.signal, workspaces);
  const rejected = assert.rejects(pending, /取消|aborted/i);
  let pids = '';
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      pids = await machines.readGuestFile(vm.id, '/workspace/agent-project/cancel.pid').catch(() => '');
      if (/^\d+\n\d+\n$/.test(pids)) break; await delay(100);
    }
    assert.match(pids, /^\d+\n\d+\n$/);
    await assert.rejects(workspaces.save(vm.id, { directory: '/workspace/changed' }),
      /另一项操作|请先结束|请先关闭|未核销/);
  } finally { cancelled.abort(); await rejected; }
  let cleanup;
  for (let attempt = 0; attempt < 50; attempt++) {
    cleanup = await machines.exec(vm.id,
      `for pid in ${pids.trim().split('\n').join(' ')}; do if kill -0 "$pid" 2>/dev/null; then cat /proc/"$pid"/stat; exit 1; fi; done`);
    if (cleanup.code === 0) break; await delay(100);
  }
  assert.equal(cleanup!.code, 0, cleanup!.stdout + cleanup!.stderr);
  const after = await machines.exec(vm.id, 'test -z "${SSH_AUTH_SOCK:-}"');
  assert.equal(after.code, 0, after.stdout + after.stderr);
  console.log(`Real ${distro} SSH forwarding verified project scope, secret redaction, reserved socket, route rejection and cancellation cleanup (${privateMode ? 'private' : 'host'}).`);
} finally {
  await workspaces.close();
  await machines.close();
  await new Promise<void>((done) => agent.close(() => done()));
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-ssh-agent-vm-'));
  await rm(directory, { recursive: true, force: true });
}
