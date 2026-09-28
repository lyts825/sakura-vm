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
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const pipe = '\\\\.\\pipe\\sakura-ssh-agent-' + process.pid + '-' + randomBytes(4).toString('hex');
process.env.SSH_AUTH_SOCK = pipe;
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { checkSshAgentForward, runSshAgentForward } = await import('../server/ssh-agent-forward.ts');
const machines = new Machines(await createRuntime());
await machines.init();
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
  const vm = await machines.create({ name: 'ssh-agent-smoke', memoryMiB: 512,
    cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const tool = await machines.exec(vm.id,
    'command -v ssh-add >/dev/null || apk add --no-cache openssh-client', 180000);
  assert.equal(tool.code, 0, tool.stdout + tool.stderr);
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
  const cancelled = new AbortController();
  const pending = runSshAgentForward(machines, vm.id,
    { command: 'sleep 10; ssh-add -L', confirmed: true, timeoutSeconds: 30 },
    cancelled.signal);
  await delay(200);
  cancelled.abort();
  await assert.rejects(pending, /取消|aborted/i);
  const after = await machines.exec(vm.id, 'test -z "${SSH_AUTH_SOCK:-}"');
  assert.equal(after.code, 0, after.stdout + after.stderr);
  console.log('Real Alpine SSH command saw only the explicitly forwarded test agent.');
} finally {
  await machines.close();
  await new Promise<void>((done) => agent.close(() => done()));
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-ssh-agent-vm-'));
  await rm(directory, { recursive: true, force: true });
}
