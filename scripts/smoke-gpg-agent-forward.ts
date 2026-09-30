import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Windows host required');
const directory = await mkdtemp(join(tmpdir(), 'sakura-gpg-forward-'));
process.env.SAKURA_DATA_DIR = directory;
const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro]);
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const pipe = '\\\\.\\pipe\\sakura-gpg-extra-' + process.pid + '-' + randomBytes(4).toString('hex');
process.env.SAKURA_GPG_EXTRA_SOCKET = pipe;
let requests = 0;
const agent = createServer((socket) => {
  socket.write('OK Sakura test extra socket\n');
  socket.on('data', (data) => {
    if (data.toString().includes('GETINFO version')) {
      requests++;
      socket.write('D 2.4.9-test\nOK\n');
    }
  });
});
await new Promise<void>((done) => agent.listen(pipe, done));
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { checkGpgAgentForward, runGpgAgentForward } =
  await import('../server/gpg-agent-forward.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Secrets } = await import('../server/secrets.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const secrets = new Secrets(machines), workspaces = new Workspaces(machines, { secrets });
try {
  const vm = await machines.create({ name: 'gpg-agent-smoke', distro, memoryMiB: 1024,
    cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const packages = await machines.exec(vm.id,
    'command -v gpg >/dev/null && command -v python3 >/dev/null || ' +
      '{ for attempt in 1 2 3; do if command -v apk >/dev/null; then apk add --no-cache gnupg python3 && exit 0; else apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y gnupg python3 && exit 0; fi; sleep 2; done; exit 1; }',
    180000);
  assert.equal(packages.code, 0, packages.stdout + packages.stderr);
  const restricted = await machines.exec(vm.id,
    "cp /etc/ssh/sshd_config /etc/ssh/.sakura-agent-test-original; " +
    "{ printf 'AllowTcpForwarding no\\nAllowStreamLocalForwarding no\\n'; cat /etc/ssh/.sakura-agent-test-original; } > /etc/ssh/sshd_config; " +
    "sshd -t || exit 1; nohup sh -c 'sleep 0.3; if command -v rc-service >/dev/null; then rc-service sshd restart; else systemctl reload ssh; fi' >/tmp/sakura-agent-sshd.log 2>&1 </dev/null &");
  assert.equal(restricted.code, 0, restricted.stdout + restricted.stderr);
  await delay(1500);
  const checked = await checkGpgAgentForward(machines, vm.id);
  assert.equal(checked.hostReady, true, checked.reason);
  assert.equal(checked.guestReady, true, checked.reason);
  assert.equal(checked.forwardingReady, false);
  await assert.rejects(runGpgAgentForward(machines, vm.id,
    { command: 'true', confirmed: true }), /AllowTcpForwarding/);
  const adjusted = await machines.exec(vm.id,
    "{ printf 'AllowTcpForwarding remote\\nAllowStreamLocalForwarding remote\\n'; cat /etc/ssh/.sakura-agent-test-original; } > /etc/ssh/sshd_config; " +
    "sshd -t || exit 1; nohup sh -c 'sleep 0.3; if command -v rc-service >/dev/null; then rc-service sshd restart; else systemctl reload ssh; fi' >/tmp/sakura-agent-sshd.log 2>&1 </dev/null &");
  assert.equal(adjusted.code, 0, adjusted.stdout + adjusted.stderr);
  await delay(1500);
  assert.equal((await checkGpgAgentForward(machines, vm.id)).ready, true);
  const privateMode = process.env.SAKURA_AGENT_PRIVATE === '1';
  await secrets.save(vm.id, { name: 'agent-key', value: 'agent-forward-test-private' });
  await workspaces.save(vm.id, { directory: '/workspace/agent-project', networkIsolation: privateMode ? 'private' : 'host',
    environment: { SAKURA_AGENT_MARKER: 'project', GNUPGHOME: '/tmp/incorrect-gpg' }, secrets: { SAKURA_AGENT_SECRET: 'agent-key' } });
  const hostNamespace = (await machines.exec(vm.id, 'readlink /proc/self/ns/net')).stdout.trim();
  const command = 'readlink /proc/self/ns/net; pwd; printf "%s\\n" "$SAKURA_AGENT_MARKER" "$SAKURA_AGENT_SECRET"; ' +
    'python3 -c \'import os,socket; s=socket.socket(socket.AF_UNIX); ' +
    's.connect(os.environ["GNUPGHOME"]+"/S.gpg-agent"); ' +
    'print(s.recv(256).decode().strip()); ' +
    's.sendall(b"GETINFO version\\n"); print(s.recv(256).decode().strip()); s.close()\'';
  await assert.rejects(runGpgAgentForward(machines, vm.id,
    { command, confirmed: false }), /Invalid input|literal|confirmed/i);
  let forwarded;
  try {
    forwarded = await runGpgAgentForward(machines, vm.id,
      { command, confirmed: true, timeoutSeconds: 30 }, undefined, workspaces);
  } catch (error) {
    const logs = await machines.exec(vm.id,
      "logread 2>/dev/null | tail -35; ls -la /tmp/sakura-gpg-* 2>/dev/null || true");
    console.log('Guest forwarding failure:', logs.stdout, logs.stderr);
    throw error;
  }
  assert.equal(forwarded.code, 0, forwarded.stderr);
  assert.match(forwarded.stdout, /2\.4\.9-test/);
  assert.ok(requests > 0);
  const namespace = privateMode ? (await machines.exec(vm.id, 'ip netns exec sk-default readlink /proc/self/ns/net')).stdout.trim() : hostNamespace;
  assert.equal(forwarded.networkIsolation, privateMode ? 'private' : 'host');
  assert.equal(forwarded.projectId, 'default');
  assert.ok(forwarded.stdout.startsWith(`${namespace}\n/workspace/agent-project\nproject\n[私密配置已隐藏]\n`), forwarded.stdout);
  if (privateMode) {
    assert.notEqual(namespace, hostNamespace);
    assert.equal((await machines.exec(vm.id, 'ip -n sk-default route add blackhole 203.0.113.0/24')).code, 0);
    await assert.rejects(runGpgAgentForward(machines, vm.id, { command: 'touch /workspace/agent-leak', confirmed: true }, undefined, workspaces), /网络路由/);
    assert.equal((await machines.exec(vm.id, 'test ! -e /workspace/agent-leak; ip -n sk-default route del blackhole 203.0.113.0/24')).code, 0);
  }
  const after = await machines.exec(vm.id,
    "find /tmp -maxdepth 1 -name 'sakura-gpg-*' -print");
  assert.equal(after.code, 0, after.stderr);
  assert.equal(after.stdout.trim(), '');
  const failed = await runGpgAgentForward(machines, vm.id,
    { command: 'exit 7', confirmed: true }, undefined, workspaces);
  assert.equal(failed.code, 7);
  assert.equal((await machines.exec(vm.id,
    "find /tmp -maxdepth 1 -name 'sakura-gpg-*' -print")).stdout.trim(), '');
  const cancelled = new AbortController();
  const pending = runGpgAgentForward(machines, vm.id,
    { command: 'echo $$ > /workspace/agent-project/cancel.pid; sleep 600 & echo $! >> /workspace/agent-project/cancel.pid; wait', confirmed: true, timeoutSeconds: 30 },
    cancelled.signal, workspaces);
  const rejected = assert.rejects(pending, /取消|aborted|closed/i);
  let pids = '';
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      pids = await machines.readGuestFile(vm.id, '/workspace/agent-project/cancel.pid').catch(() => '');
      if (/^\d+\n\d+\n$/.test(pids)) break; await delay(100);
    }
    assert.match(pids, /^\d+\n\d+\n$/);
    await assert.rejects(workspaces.save(vm.id, { directory: '/workspace/changed' }), /另一项操作/);
  } finally { cancelled.abort(); await rejected; }
  let cleanup;
  for (let attempt = 0; attempt < 50; attempt++) {
    cleanup = await machines.exec(vm.id,
      `for pid in ${pids.trim().split('\n').join(' ')}; do if kill -0 "$pid" 2>/dev/null; then cat /proc/"$pid"/stat; exit 1; fi; done`);
    if (cleanup.code === 0) break; await delay(100);
  }
  assert.equal(cleanup!.code, 0, cleanup!.stdout + cleanup!.stderr);
  const cleaned = await machines.exec(vm.id,
    "find /tmp -maxdepth 1 -name 'sakura-gpg-*' -print");
  assert.equal(cleaned.stdout.trim(), '');
  console.log(`Real ${distro} GPG forwarding verified the private extra socket, project scope, secret redaction, reserved home, route rejection and cancellation cleanup (${privateMode ? 'private' : 'host'}).`);
} finally {
  await workspaces.close();
  await machines.close();
  await new Promise<void>((done) => agent.close(() => done()));
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-gpg-forward-'));
  await rm(directory, { recursive: true, force: true });
}
