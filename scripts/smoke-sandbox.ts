import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'sakura-sandbox-smoke-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Sandboxes } = await import('../server/sandboxes.ts');
const engine = await createRuntime();
const machines = new Machines(engine);
const sandboxes = new Sandboxes(machines);
let connections = 0;
const host = createServer((socket) => {
  connections++;
  socket.end('HOST\n');
});
host.listen(0, '127.0.0.1');
await once(host, 'listening');
const hostPort = (host.address() as { port: number }).port;
await machines.init();
const lines: string[] = [];
const record = (message: string) => {
  lines.push(message);
  console.log(message);
};
try {
  const accelerator = process.env.SAKURA_TEST_ACCELERATOR === 'tcg' ? 'tcg' : 'auto';
  const vm = await sandboxes.create({ name: 'sandbox-smoke', lifetimeMinutes: 5, accelerator });
  const id = vm.id;
  record('Created isolated sandbox: ' + id);
  const checks = [
    'set -eu',
    'uname -s',
    'test "$(id -u)" = 0',
    'command -v timeout; command -v nc; command -v nslookup',
    'if timeout 3 nc -w 2 10.0.2.2 ' + hostPort + ' </dev/null; then echo HOST_REACHABLE; exit 1; fi',
    'if timeout 3 nc -w 2 1.1.1.1 443 </dev/null; then echo INTERNET_REACHABLE; exit 1; fi',
    'if timeout 3 nslookup example.com 10.0.2.3; then echo DNS_REACHABLE; exit 1; fi',
    'sleep 3600 >/tmp/sandbox-child.log 2>&1 &',
    'printf persisted > /workspace/sandbox-marker',
    'echo ISOLATION_OK',
  ].join('\n');
  const run = sandboxes.run(id, { command: checks, timeoutSeconds: 30, artifacts: ['sandbox-marker'] });
  await sandboxes.jobs.wait(id);
  record(run.log);
  assert.equal(run.status, 'done', run.error + '\n' + (machines.logs.get(id) || ''));
  assert.match(run.log, /ISOLATION_OK/);
  assert.equal(connections, 0, 'The isolated guest must not reach the host listener');
  assert.equal(machines.live.has(id), false, 'Completion must stop detached processes with the VM');
  assert.equal(run.execution?.exitCode, 0);
  assert.ok(run.execution?.timings.totalMs! >= 0);
  assert.equal(run.execution?.artifacts.length, 1);
  record('Real QEMU: SSH, host/internet/DNS isolation and whole-VM shutdown passed.');
  const nat = await sandboxes.create({
    name: 'sandbox-nat-smoke',
    network: 'nat',
    lifetimeMinutes: 5,
    accelerator,
  });
  const online = sandboxes.run(nat.id, {
    command: 'nc -w 3 10.0.2.2 ' + hostPort,
    timeoutSeconds: 10,
  });
  await sandboxes.jobs.wait(nat.id);
  assert.equal(online.status, 'done', online.error);
  assert.match(online.log, /\nHOST\n/);
  assert.equal(connections, 1, 'The same host listener is reachable with explicit NAT access');
  await sandboxes.control(nat.id, 'destroy');
  record('Real QEMU: explicit NAT access reached the host listener (positive control).');
  const timeout = sandboxes.run(id, {
    command:
      'test "$(cat /workspace/sandbox-marker)" = persisted || exit 8; echo TIMEOUT_STARTED; sleep 3600',
    timeoutSeconds: 1,
  });
  await sandboxes.jobs.wait(id);
  assert.equal(timeout.status, 'error');
  assert.match(timeout.error || '', /超时/);
  assert.equal(machines.live.has(id), false);
  record('Real QEMU: command deadline terminated the guest.');
  const cancel = sandboxes.run(id, { command: 'echo CANCEL_STARTED; sleep 3600' });
  const deadline = Date.now() + 270_000;
  // The command is also present in the audit header; wait for its output line.
  while (!cancel.log.includes('\nCANCEL_STARTED\n') && cancel.status === 'running') {
    assert.ok(Date.now() < deadline, 'Cancellation test did not execute');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(cancel.status, 'running', cancel.error);
  await sandboxes.control(id, 'stop');
  assert.equal(cancel.status, 'cancelled');
  assert.equal(machines.live.has(id), false);
  record('Real QEMU: cancellation terminated the guest.');
  await machines.start(id);
  machines.get(id).sandbox!.expiresAt = new Date(Date.now() - 1).toISOString();
  await machines.expireSandboxes();
  assert.equal(machines.live.has(id), false);
  assert.equal(machines.records.has(id), false);
  assert.equal(sandboxes.jobs.list().length, 4);
  const artifact = await sandboxes.artifact(run.id!, run.execution!.artifacts[0].id);
  assert.equal(Buffer.from(artifact.base64, 'base64').toString(), 'persisted');
  record('Real QEMU: structured execution metadata and exported artifacts survive disk destruction.');
  record('Real QEMU: expiration removed the disk and preserved all four execution records.');
} finally {
  await sandboxes.close();
  await machines.close();
  await new Promise<void>((resolve) => host.close(() => resolve()));
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/sandbox-smoke.log', lines.join('\n') + '\n');
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-sandbox-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
