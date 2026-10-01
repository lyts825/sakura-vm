import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2 from 'ssh2';

assert.equal(process.argv.length, 4, 'Pass alpine|debian|ubuntu and a stopped owned guest-task fixture.');
const distro = process.argv[2];
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
const parent = await realpath(resolve('.data/network-remaining-test-temp'));
const root = await realpath(resolve(process.argv[3]));
assert.equal(dirname(root), parent);
assert.match(basename(root), /^sakura-guest-task-[A-Za-z0-9_-]+$/);
const prior = JSON.parse(await readFile(join(root, 'guest-task-cgroup-evidence.json'), 'utf8'));
assert.equal(prior.distro, distro);
assert.equal(prior.vmStopped, true);
assert.equal(prior.error, undefined);
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve(
  '.data/images/' +
    {
      alpine: 'alpine-3.23.qcow2',
      debian: 'debian-12.qcow2',
      ubuntu: 'ubuntu-24.04.qcow2',
    }[distro],
);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ProjectSsh, projectSshPaths } = await import('../server/project-ssh.ts');
const { vmDir } = await import('../server/model.ts');
const { quote } = await import('../server/files.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
assert.equal(machines.records.size, 1);
const vm = [...machines.records.values()][0];
assert.equal(vm.id, prior.vmId);
assert.equal(vm.name, 'guest-task-cgroup-smoke');
assert.equal(vm.distro, distro);
assert.equal(machines.state(vm.id), 'stopped');
const spaces = new Workspaces(machines),
  service = new ProjectSsh(machines, spaces);
const nativeExec = machines.exec.bind(machines);
const run = async (command: string, timeout = 30000) => {
  const result = await nativeExec(vm.id, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
};
const alive = async (pid: number) =>
  (await run(
    'python3 -I -S -c ' +
      quote(
        'try:print(open("/proc/' +
          pid +
          '/stat").read().rsplit(") ",1)[1].split()[0] not in ("Z","X"))\nexcept FileNotFoundError:print(False)',
      ),
  )) === 'True';
const waitFile = async (file: string) => {
  for (let attempt = 0; attempt < 80; ++attempt) {
    if ((await nativeExec(vm.id, 'test -f ' + quote(file), 5000)).code === 0) return;
    await delay(75);
  }
  throw new Error('Owned detached SSH child did not publish its PID');
};
const failConnection = async (command: string) => {
  const live = machines.live.get(vm.id)!,
    saved = live.sshPort;
  live.sshPort = await freePort();
  try {
    await assert.rejects(nativeExec(vm.id, command, 350), /ECONNREFUSED|refused|timed out/);
  } finally {
    live.sshPort = saved;
  }
};
const p = projectSshPaths('default'),
  recordPath = join(vmDir(vm.id), 'project-ssh/default/runtime.json');
const proof: any = {
  version: 1,
  vmId: vm.id,
  distro,
  fixture: root,
  sourceSha256: createHash('sha256')
    .update(await readFile(resolve('server/project-ssh.ts')))
    .digest('hex'),
  cases: [],
};
try {
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(300);
  }
  await spaces.save(vm.id, { directory: '/workspace/ssh-rollback', networkIsolation: 'private' });
  const project = await spaces.resolvedConfig(vm.id);
  console.log('Owned ' + distro + ' project SSH rollback fixture: ' + root);
  for (const mode of [
    'first-check-failure',
    'first-stop-failure',
    'all-check-failures',
    'changed-guest-run',
    'changed-before-stop',
  ]) {
    let started = false,
      checks = 0,
      stops = 0,
      pid = 0,
      record: any,
      originalBinding = '',
      mutated = false;
    const marker = '/workspace/ssh-rollback/child-' + randomUUID() + '.pid';
    const events: string[] = [];
    const changeBinding = async () => {
      originalBinding = await run('cat ' + quote(p.config + '/binding.json'));
      const changed = { ...JSON.parse(originalBinding), runId: randomUUID() };
      await run('printf %s ' + quote(JSON.stringify(changed)) + ' > ' + quote(p.config + '/binding.json'));
      mutated = true;
    };
    machines.exec = (async (id, command, timeout, signal, output, agent) => {
      if (
        !started &&
        (command.includes('systemctl start ' + p.unit) ||
          command.includes('rc-service ' + p.openrcUnit + ' start'))
      ) {
        const result = await nativeExec(id, command, timeout, signal, output, agent);
        assert.equal(result.code, 0, result.stderr);
        started = true;
        record = JSON.parse(await readFile(recordPath, 'utf8'));
        const endpoint = await service.endpoint(id, project);
        assert.ok(endpoint);
        const pin = ssh2.utils.parseKey(record.hostPublicKey);
        assert.ok(!(pin instanceof Error) && !Array.isArray(pin));
        const client = new ssh2.Client();
        const clientKey = await readFile(endpoint.identity);
        try {
          await new Promise<void>((resolve, reject) => {
            client.once('ready', resolve).once('error', reject);
            client.connect({
              host: '127.0.0.1',
              port: endpoint.port,
              username: 'root',
              privateKey: clientKey,
              readyTimeout: 10000,
              hostVerifier: (key: Buffer) => key.equals(pin.getPublicSSH()),
            });
          });
          const child =
            'import os,time\nopen(' +
            JSON.stringify(marker) +
            ',"w").write(str(os.getpid()))\nwhile True:time.sleep(1)';
          await new Promise<void>((resolve, reject) =>
            client.exec(
              'setsid python3 -I -S -c ' + quote(child) + ' </dev/null >/dev/null 2>&1 &',
              (error, stream) => {
                if (error) return reject(error);
                stream.resume();
                stream.stderr.resume();
                stream.once('error', reject);
                stream.once('close', (code: number) =>
                  code === 0 ? resolve() : reject(new Error('Owned project command exit ' + code)),
                );
              },
            ),
          );
        } finally {
          client.end();
        }
        await waitFile(marker);
        pid = Number(await run('cat ' + quote(marker)));
        assert.ok(Number.isSafeInteger(pid) && pid > 1);
        const cgroup = await run('cat /proc/' + pid + '/cgroup');
        assert.equal(cgroup, '0::' + (distro === 'alpine' ? p.openrcGroup : '/system.slice/' + p.unit));
        events.push('real-service-and-detached-child-started');
        if (mode === 'changed-guest-run') await changeBinding();
        throw new Error('Owned original SSH startup acknowledgement lost');
      }
      if (command.startsWith('# SAKURA_PROJECT_SSH_ROLLBACK_CHECK')) {
        ++checks;
        if ((mode === 'first-check-failure' && checks === 1) || mode === 'all-check-failures') {
          await failConnection(command);
          assert.equal(await alive(pid), true);
          events.push('real-verification-connection-failed-child-preserved');
          throw new Error('Owned actual rollback verification connection failed');
        }
      }
      if (command.includes('sakura_rollback_owner=$(')) {
        ++stops;
        if (mode === 'first-stop-failure' && stops === 1) {
          await failConnection(command);
          assert.equal(await alive(pid), true);
          events.push('real-stop-connection-failed-child-preserved');
          throw new Error('Owned actual rollback stop connection failed');
        }
        if (mode === 'changed-before-stop' && !mutated) await changeBinding();
      }
      return nativeExec(id, command, timeout, signal, output, agent);
    }) as typeof machines.exec;
    let failure: any;
    await assert.rejects(service.start(vm.id), (error: any) => {
      failure = error;
      return /Owned original SSH startup acknowledgement lost/.test(error.message);
    });
    assert.equal(started, true);
    const saved = JSON.parse(await readFile(recordPath, 'utf8'));
    assert.equal(saved.runId, record.runId);
    if (mode.startsWith('first-')) {
      assert.notEqual(failure.code, 'PROJECT_SSH_CLEANUP_FAILED');
      assert.equal(checks, 2);
      assert.equal(stops, mode === 'first-stop-failure' ? 2 : 1);
      assert.equal(await alive(pid), false);
      assert.equal((await service.status(vm.id, project)).running, false);
    } else {
      assert.equal(failure.code, 'PROJECT_SSH_CLEANUP_FAILED');
      assert.equal(failure.status, 503);
      assert.equal(checks, 3);
      assert.equal(stops, mode === 'changed-before-stop' ? 1 : 0);
      assert.equal(await alive(pid), true);
      assert.ok(failure.message.includes('runtime.json'));
      if (mutated)
        await run('printf %s ' + quote(originalBinding) + ' > ' + quote(p.config + '/binding.json'));
      machines.exec = nativeExec;
      await service.stop(vm.id);
      assert.equal(await alive(pid), false);
    }
    proof.cases.push({
      name: mode,
      runId: record.runId,
      child: pid,
      checks,
      stops,
      originalErrorRetained: true,
      runtimeRecordRetained: true,
      childEnded: mode.startsWith('first-'),
      refusedOrUnconfirmedChildPreserved: !mode.startsWith('first-'),
      manualStopAfterRefusalVerified: !mode.startsWith('first-'),
      events,
      error: failure.message,
    });
    console.log(
      'PASS ' + mode + ': real SSH lifecycle, detached child, rollback ownership and retained record.',
    );
    machines.exec = nativeExec;
  }
} catch (error) {
  proof.error = String(error);
  throw error;
} finally {
  machines.exec = nativeExec;
  await service.close();
  await spaces.close();
  await machines.close();
  proof.vmStopped = machines.state(vm.id) === 'stopped';
  proof.stoppedAt = new Date().toISOString();
  await writeFile(join(root, 'project-ssh-rollback-evidence.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log('Project SSH rollback proof:', join(root, 'project-ssh-rollback-evidence.json'));
}
