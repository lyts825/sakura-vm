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
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
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
const machines = new Machines(await createRuntime());
await machines.init();
try {
  const vm = await machines.create({ name: 'gpg-agent-smoke', memoryMiB: 512,
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
      'for attempt in 1 2 3; do apk add --no-cache gnupg python3 && exit 0; sleep 2; done; exit 1',
    180000);
  assert.equal(packages.code, 0, packages.stdout + packages.stderr);
  const checked = await checkGpgAgentForward(machines, vm.id);
  assert.equal(checked.hostReady, true, checked.reason);
  assert.equal(checked.guestReady, true, checked.reason);
  assert.equal(checked.forwardingReady, false);
  await assert.rejects(runGpgAgentForward(machines, vm.id,
    { command: 'true', confirmed: true }), /AllowTcpForwarding/);
  const adjusted = await machines.exec(vm.id,
    "sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding remote/' /etc/ssh/sshd_config; " +
      "rc-service sshd restart; sshd -T | grep -q '^allowtcpforwarding remote$'");
  assert.equal(adjusted.code, 0, adjusted.stdout + adjusted.stderr);
  assert.equal((await checkGpgAgentForward(machines, vm.id)).ready, true);
  const command = 'python3 -c \'import os,socket; s=socket.socket(socket.AF_UNIX); ' +
    's.connect(os.environ["GNUPGHOME"]+"/S.gpg-agent"); ' +
    'print(s.recv(256).decode().strip()); ' +
    's.sendall(b"GETINFO version\\n"); print(s.recv(256).decode().strip()); s.close()\'';
  await assert.rejects(runGpgAgentForward(machines, vm.id,
    { command, confirmed: false }), /Invalid input|literal|confirmed/i);
  let forwarded;
  try {
    forwarded = await runGpgAgentForward(machines, vm.id,
      { command, confirmed: true, timeoutSeconds: 30 });
  } catch (error) {
    const logs = await machines.exec(vm.id,
      "logread 2>/dev/null | tail -35; ls -la /tmp/sakura-gpg-* 2>/dev/null || true");
    console.log('Guest forwarding failure:', logs.stdout, logs.stderr);
    throw error;
  }
  assert.equal(forwarded.code, 0, forwarded.stderr);
  assert.match(forwarded.stdout, /2\.4\.9-test/);
  assert.ok(requests > 0);
  const after = await machines.exec(vm.id,
    "find /tmp -maxdepth 1 -name 'sakura-gpg-*' -print");
  assert.equal(after.code, 0, after.stderr);
  assert.equal(after.stdout.trim(), '');
  const failed = await runGpgAgentForward(machines, vm.id,
    { command: 'exit 7', confirmed: true });
  assert.equal(failed.code, 7);
  assert.equal((await machines.exec(vm.id,
    "find /tmp -maxdepth 1 -name 'sakura-gpg-*' -print")).stdout.trim(), '');
  const cancelled = new AbortController();
  const pending = runGpgAgentForward(machines, vm.id,
    { command: 'sleep 10; ' + command, confirmed: true, timeoutSeconds: 30 },
    cancelled.signal);
  await delay(500);
  cancelled.abort();
  await assert.rejects(pending, /取消|aborted|closed/i);
  const cleaned = await machines.exec(vm.id,
    "find /tmp -maxdepth 1 -name 'sakura-gpg-*' -print");
  assert.equal(cleaned.stdout.trim(), '');
  console.log('Real Alpine SSH streamlocal bridge exposed the mock extra socket only for one command.');
} finally {
  await machines.close();
  await new Promise<void>((done) => agent.close(() => done()));
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-gpg-forward-'));
  await rm(directory, { recursive: true, force: true });
}
