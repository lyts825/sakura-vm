import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const parent = await realpath(tmpdir());
const directory = await mkdtemp(join(parent, 'sakura-seccomp-vm-'));
process.env.SAKURA_DATA_DIR = directory;
const distro = process.argv[2] || (process.env.SAKURA_SYSCALL_DISTRO === 'ubuntu' ? 'ubuntu' :
  process.env.SAKURA_SYSCALL_DEBIAN_ONLY === '1' ? 'debian' : 'alpine');
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro]);
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { checkSyscallProfile, runSyscallProfile } = await import('../server/syscall-profile.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Secrets } = await import('../server/secrets.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const secrets = new Secrets(machines), workspaces = new Workspaces(machines, { secrets });
const migrations = new ProjectDirectoryMigrations(machines, workspaces);
let primaryFailure: unknown;
try {
  const vm = await machines.create({ name: `seccomp-${distro}-smoke`, distro,
    memoryMiB: 1024, cpus: 2, diskGiB: 4 });
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
  await workspaces.save(vm.id, { directory: '/workspace/seccomp-host' });
  const created = await machines.exec(vm.id, 'mkdir -p /workspace/seccomp-host /workspace/limited');
  assert.equal(created.code, 0, created.stderr);
  const authorize = (projectId: string) => workspaces.projects.inScope(vm.id, projectId, async () => {
    const preview = await migrations.preview(vm.id); assert.ok(preview.plan);
    const applied = await migrations.apply(vm.id, { action: 'apply', version: 1, reviewed: true,
      planId: preview.plan.proposal.planId, sha256: preview.plan.sha256 });
    assert.equal(applied.plan?.state, 'applied'); assert.ok(applied.plan?.activatedIdentity);
    return applied.plan.activatedIdentity;
  });
  const hostIdentity = await authorize('default'); assert.notEqual(hostIdentity.uid, 0);
  await assert.rejects(runSyscallProfile(machines, vm.id,
    { mode: 'run', command: 'true' }), /confirmed=true/);
  const allowed = await runSyscallProfile(machines, vm.id, {
    mode: 'run', profile: 'restricted', command: 'python3', confirmed: true,
    args: ['-c', 'import socket; s=socket.socket(); s.close(); print("socket allowed")'],
  });
  assert.ok('stdout' in allowed && 'stderr' in allowed);
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.match(allowed.stdout || '', /socket allowed/);
  const denied = await runSyscallProfile(machines, vm.id, {
    mode: 'run', profile: 'networkless', command: 'python3', confirmed: true,
    args: ['-c', 'import socket; socket.socket()'],
  });
  assert.ok('stderr' in denied);
  assert.notEqual(denied.code, 0);
  assert.match(denied.stderr || '', /Operation not permitted/);
  const inherited = await runSyscallProfile(machines, vm.id, {
    mode: 'run', profile: 'networkless', command: 'sh', confirmed: true,
    args: ['-c', 'grep -E "^(Seccomp|NoNewPrivs):" /proc/self/status'],
  });
  assert.ok('stdout' in inherited && 'stderr' in inherited);
  assert.equal(inherited.code, 0, inherited.stderr);
  assert.match(inherited.stdout || '', /Seccomp:\s*2/);
  assert.match(inherited.stdout || '', /NoNewPrivs:\s*1/);
  const index = await workspaces.projects.create(vm.id, 'Seccomp private', async () => {
    await workspaces.save(vm.id, { directory: '/workspace/limited', networkIsolation: 'private',
      environment: { SAKURA_SECCOMP_MARKER: 'project' } });
  });
  const privateIdentity = await authorize(index.active); assert.notEqual(privateIdentity.uid, hostIdentity.uid);
  const fallback = await runSyscallProfile(machines, vm.id, {
    mode: 'run', command: '/bin/pwd', confirmed: true,
  });
  assert.equal(fallback.code, 0, 'stderr' in fallback ? fallback.stderr : JSON.stringify(fallback));
  assert.equal('projectId' in fallback && fallback.projectId, index.active);
  assert.equal('stdout' in fallback && fallback.stdout, '/workspace/limited\n');
  await secrets.save(vm.id, { name: 'seccomp-key', value: 'seccomp-smoke-private-value' });
  await workspaces.projects.with(vm.id, index.active, () => workspaces.save(vm.id, {
    directory: '/workspace/limited', networkIsolation: 'private',
    environment: { SAKURA_SECCOMP_MARKER: 'project', PATH: '/workspace/seccomp-tools:/usr/bin:/bin',
      PYTHONPATH: '/workspace/seccomp-tools' },
    secrets: { SAKURA_SECCOMP_SECRET: 'seccomp-key' },
  }));
  assert.equal((await machines.exec(vm.id, 'mkdir -p /workspace/seccomp-tools')).code, 0);
  await machines.writeGuestFile(vm.id, '/workspace/seccomp-tools/python3',
    '#!/bin/sh\ntouch /workspace/seccomp-helper-replaced\nexit 98\n');
  await machines.writeGuestFile(vm.id, '/workspace/seccomp-tools/seccomp.py',
    'open("/workspace/seccomp-module-replaced", "w").close()\nraise RuntimeError("unexpected project module")\n');
  assert.equal((await machines.exec(vm.id, 'chmod 755 /workspace/seccomp-tools/python3')).code, 0);
  const execute = (input: unknown, signal?: AbortSignal) => workspaces.projects.with(vm.id, index.active,
    () => runSyscallProfile(machines, vm.id, input, signal, workspaces));
  const account = await execute({ mode: 'run', command: '/usr/bin/python3', confirmed: true,
    args: ['-c', 'import json,os\nprint(json.dumps({"uid":os.getuid(),"gid":os.getgid(),"home":os.environ["HOME"],"cwd":os.getcwd(),"cgroup":open("/proc/self/cgroup").read().strip()}))'] });
  assert.equal(account.code, 0, JSON.stringify(account)); assert.ok('stdout' in account);
  const accountState = JSON.parse(account.stdout);
  assert.equal(accountState.uid, privateIdentity.uid); assert.equal(accountState.gid, privateIdentity.gid);
  assert.equal(accountState.home, privateIdentity.home); assert.equal(accountState.cwd, privateIdentity.directory);
  assert.match(accountState.cgroup, /^0::\/sakura-task-[a-f0-9-]{36}$/);
  const hostNamespace = (await machines.exec(vm.id, 'readlink /proc/self/ns/net')).stdout.trim();
  const namespace = (await machines.exec(vm.id, `ip netns exec sk-${index.active} readlink /proc/self/ns/net`)).stdout.trim();
  assert.notEqual(namespace, hostNamespace);
  const scoped = await execute({ mode: 'run', command: '/bin/sh', confirmed: true, args: ['-c',
    'readlink /proc/self/ns/net; pwd; printf "%s\\n" "$SAKURA_SECCOMP_MARKER" "$SAKURA_SECCOMP_SECRET"; printf "%s\\n" "$SAKURA_SECCOMP_SECRET" >&2; grep -E "^(Seccomp|NoNewPrivs):" /proc/self/status'] });
  assert.equal(scoped.code, 0, 'stderr' in scoped ? scoped.stderr : JSON.stringify(scoped));
  assert.equal('projectId' in scoped && scoped.projectId, index.active);
  assert.equal('networkIsolation' in scoped && scoped.networkIsolation, 'private');
  assert.ok('stdout' in scoped && scoped.stdout.startsWith(`${namespace}\n/workspace/limited\nproject\n[私密配置已隐藏]\n`), JSON.stringify(scoped));
  assert.match('stdout' in scoped ? scoped.stdout : '', /Seccomp:\s*2/);
  assert.match('stdout' in scoped ? scoped.stdout : '', /NoNewPrivs:\s*1/);
  assert.equal('stderr' in scoped && scoped.stderr, '[私密配置已隐藏]\n');
  const literal = "hello'; touch /workspace/seccomp-escaped; echo '";
  const quoted = await execute({ mode: 'run', command: '/usr/bin/printf', args: ['%s', literal], confirmed: true });
  assert.equal(quoted.code, 0, JSON.stringify(quoted));
  assert.equal('stdout' in quoted && quoted.stdout, literal);
  assert.equal((await machines.exec(vm.id, 'test ! -e /workspace/seccomp-escaped && test ! -e /workspace/seccomp-helper-replaced && test ! -e /workspace/seccomp-module-replaced')).code, 0);
  const privateDenied = await execute({ mode: 'run', profile: 'networkless', command: '/usr/bin/python3',
    args: ['-c', 'import socket; socket.socket()'], confirmed: true });
  assert.notEqual(privateDenied.code, 0);
  assert.match('stderr' in privateDenied ? privateDenied.stderr : '', /Operation not permitted/);
  assert.equal((await machines.exec(vm.id, `ip -n sk-${index.active} route add blackhole 203.0.113.0/24`)).code, 0);
  await assert.rejects(execute({ mode: 'run', command: '/usr/bin/touch', args: ['/workspace/seccomp-route-leak'], confirmed: true }), /网络路由/);
  assert.equal((await machines.exec(vm.id, `test ! -e /workspace/seccomp-route-leak; ip -n sk-${index.active} route del blackhole 203.0.113.0/24`)).code, 0);
  const processCommand = (file: string) =>
    `printf '%s\\n' "$$" "$PPID" > ${file}; sleep 600 & echo $! >> ${file}; wait`;
  const waitForCleanup = async (pids: string, label: string) => {
    assert.match(pids, /^\d+\n(?:\d+\n)*$/);
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await machines.exec(vm.id,
        `for pid in ${pids.trim().split('\n').join(' ')}; do if kill -0 "$pid" 2>/dev/null; then cat /proc/"$pid"/stat; exit 1; fi; done`);
      if (result.code === 0) break;
      await delay(100);
    }
    assert.equal(result!.code, 0, label + ': ' + result!.stdout + result!.stderr);
  };
  const timeout = await execute({ mode: 'run', command: '/bin/sh',
    args: ['-c', processCommand('/workspace/limited/timeout.pid')], confirmed: true, timeoutSeconds: 1 });
  assert.equal(timeout.code, 124, JSON.stringify(timeout));
  assert.equal('timedOut' in timeout && timeout.timedOut, true);
  await waitForCleanup(await machines.readGuestFile(vm.id, '/workspace/limited/timeout.pid'), 'timeout');
  const background = await execute({ mode: 'run', command: '/bin/sh',
    args: ['-c', 'sleep 600 & echo $! > /workspace/limited/background.pid'], confirmed: true });
  assert.equal(background.code, 0, JSON.stringify(background));
  await waitForCleanup(await machines.readGuestFile(vm.id, '/workspace/limited/background.pid'), 'background child');
  const abort = new AbortController();
  const pending = execute({ mode: 'run', command: '/bin/sh',
    args: ['-c', processCommand('/workspace/limited/cancel.pid')], confirmed: true }, abort.signal);
  const rejected = assert.rejects(pending, /取消|aborted/i);
  let pids = '';
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      pids = await machines.readGuestFile(vm.id, '/workspace/limited/cancel.pid').catch(() => '');
      if (/^\d+\n\d+\n\d+\n$/.test(pids)) break; await delay(100);
    }
    assert.match(pids, /^\d+\n\d+\n\d+\n$/);
    await assert.rejects(workspaces.projects.with(vm.id, index.active,
      () => workspaces.save(vm.id, { directory: '/workspace/changed' })), /另一项操作|请先结束此项目的终端或命令/);
  } finally { abort.abort(); await rejected; }
  await waitForCleanup(pids, 'cancellation');
  const code = await execute({ mode: 'run', command: '/bin/sh', args: ['-c', 'exit 23'], confirmed: true });
  assert.equal(code.code, 23);
  const terminated = await execute({ mode: 'run', command: '/bin/sh', args: ['-c', 'kill -TERM $$'], confirmed: true });
  assert.equal(terminated.code, 143);
  console.log(`Real ${distro} seccomp verified project UID/GID/home/task scope, inherited policies, project configuration, secrets, literal arguments, reserved runner, route rejection, exit status and process cleanup after timeout, background exit and cancellation.`);
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  const failures: unknown[] = [];
  try { await workspaces.close(); } catch (error) { failures.push(error); }
  try { await machines.close(); } catch (error) { failures.push(error); }
  if (!primaryFailure && !failures.length) {
    assert.equal(machines.live.size, 0);
    const exact = await realpath(directory);
    assert.equal(exact, directory); assert.equal(dirname(exact), parent);
    assert.ok(basename(exact).startsWith('sakura-seccomp-vm-'));
    await rm(exact, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } else {
    console.error('Retained seccomp smoke data:', directory);
  }
  if (failures.length) throw new AggregateError([...(primaryFailure ? [primaryFailure] : []), ...failures], 'seccomp smoke cleanup unconfirmed');
}
