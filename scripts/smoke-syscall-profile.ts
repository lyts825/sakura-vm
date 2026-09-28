import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-seccomp-vm-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { checkSyscallProfile, runSyscallProfile } = await import('../server/syscall-profile.ts');
const machines = new Machines(await createRuntime());
await machines.init();
try {
  const distro = process.env.SAKURA_SYSCALL_DISTRO === 'ubuntu' ? 'ubuntu' :
    process.env.SAKURA_SYSCALL_DEBIAN_ONLY === '1' ? 'debian' : 'alpine';
  const vm = await machines.create({ name: `seccomp-${distro}-smoke`, distro,
    memoryMiB: distro === 'alpine' ? 1024 : 2048, cpus: 2, diskGiB: 4,
    accelerator: distro === 'alpine' ? 'tcg' : 'auto' });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const before = await checkSyscallProfile(machines, vm.id);
  assert.equal(before.ready, false);
  const installed = await runSyscallProfile(machines, vm.id, { mode: 'install' });
  assert.equal(installed.ready, true, JSON.stringify(installed));
  const status = await checkSyscallProfile(machines, vm.id);
  assert.equal(status.ready, true, status.reason);
  await assert.rejects(runSyscallProfile(machines, vm.id,
    { mode: 'run', command: 'true' }), /confirmed=true/);
  const allowed = await runSyscallProfile(machines, vm.id, {
    mode: 'run', profile: 'restricted', command: 'python3', confirmed: true,
    args: ['-c', 'import socket; s=socket.socket(); s.close(); print("socket allowed")'],
  });
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.match(allowed.stdout || '', /socket allowed/);
  const denied = await runSyscallProfile(machines, vm.id, {
    mode: 'run', profile: 'networkless', command: 'python3', confirmed: true,
    args: ['-c', 'import socket; socket.socket()'],
  });
  assert.notEqual(denied.code, 0);
  assert.match(denied.stderr || '', /Operation not permitted/);
  const inherited = await runSyscallProfile(machines, vm.id, {
    mode: 'run', profile: 'networkless', command: 'sh', confirmed: true,
    args: ['-c', 'grep -E "^(Seccomp|NoNewPrivs):" /proc/self/status'],
  });
  assert.equal(inherited.code, 0, inherited.stderr);
  assert.match(inherited.stdout || '', /Seccomp:\s*2/);
  assert.match(inherited.stdout || '', /NoNewPrivs:\s*1/);
  const timeout = await runSyscallProfile(machines, vm.id, {
    mode: 'run', command: 'sleep', args: ['10'], confirmed: true,
    timeoutSeconds: 1,
  });
  assert.equal(timeout.code, 124, timeout.stderr);
  console.log(`${distro} seccomp filter and inherited network denial verified.`);
} finally {
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-seccomp-vm-'));
  await rm(directory, { recursive: true, force: true });
}
