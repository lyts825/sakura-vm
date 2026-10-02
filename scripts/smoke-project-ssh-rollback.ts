import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2 from 'ssh2';
import { z } from 'zod';
import type { ProjectIdentityRun } from '../server/project-identity.ts';

const supported = ['first-check-failure', 'first-stop-failure', 'all-check-failures'] as const;
const unsupported: Record<string, string> = {
  'changed-guest-run': 'Binding mutation is no longer an ownership refusal: the original full ticket can stop its cgroup.',
  'changed-before-stop': 'Binding mutation is no longer an ownership refusal: the original full ticket can stop its cgroup.',
  'replaced-original-cgroup': 'Not implemented: needs a fixture that preserves the original child/inode and restores only that exact owned domain.',
  'replaced-before-stop': 'Not implemented: needs an exact inode replacement fixture between verification and stop; no ambiguous binding-based kill is allowed.',
};
assert.ok(
  process.argv.length === 4 || (process.argv.length === 6 && process.argv[4] === '--case'),
  'Pass <alpine|debian|ubuntu> <stopped owned guest-task fixture> [--case <name>].',
);
const distro = process.argv[2];
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
const selected = process.argv[5];
if (selected && Object.hasOwn(unsupported, selected)) throw new Error(selected + ': ' + unsupported[selected]);
assert.ok(!selected || supported.some((name) => name === selected), 'Unknown rollback case: ' + selected);
const modes = supported.filter((name) => !selected || name === selected);
const invocation = randomUUID();
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
    { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro],
);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ProjectSsh, projectSshPaths, projectSshRecordSchema } = await import('../server/project-ssh.ts');
const { ProjectIdentities } = await import('../server/project-identity.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { ProjectNetworkBridges } = await import('../server/project-network-bridges.ts');
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
const spaces = new Workspaces(machines);
const identities = new ProjectIdentities(machines);
const scopes = new ProjectRunScopes(machines, { identities });
const migrations = new ProjectDirectoryMigrations(machines, spaces, { scopes });
const service = new ProjectSsh(machines, spaces, { identities, scopes });
const nativeExec = machines.exec.bind(machines);
const nativePrepare = identities.prepareSsh.bind(identities);
const nativeRecover = scopes.recoverSshTicket.bind(scopes);
const run = async (command: string, timeout = 30000) => {
  const result = await nativeExec(vm.id, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
};
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const childSchema = z.object({
  pid: z.number().int().min(2), startTicks: decimal, bootId: z.uuid(),
  uid: z.number().int().min(20000).max(59999), gid: z.number().int(),
  home: z.string(), user: z.string(), logname: z.string(), directory: z.string(),
  sessionId: z.number().int().min(2), networkDevice: decimal, networkInode: decimal,
  cgroupName: z.string(), cgroupDevice: decimal, cgroupInode: decimal,
}).strict();
type OwnedChild = z.infer<typeof childSchema>;
const alive = async (child: OwnedChild) => (await run('python3 -I -S -c ' + quote([
  'import json,os',
  'wanted=json.loads(' + JSON.stringify(JSON.stringify(child)) + ')',
  'assert open("/proc/sys/kernel/random/boot_id").read().strip()==wanted["bootId"], "Owned child boot changed"',
  'base="/proc/"+str(wanted["pid"])',
  'try:',
  ' fields=open(base+"/stat").read().rsplit(") ",1)[1].split()',
  ' if fields[19]!=wanted["startTicks"] or fields[0] in ("Z","X"): print(False)',
  ' else:',
  '  status={row.split(":",1)[0]:row.split(":",1)[1].strip() for row in open(base+"/status") if ":" in row}',
  '  assert [int(n) for n in status["Uid"].split()]==[wanted["uid"]]*4, "Owned child UID changed"',
  '  assert [int(n) for n in status["Gid"].split()]==[wanted["gid"]]*4, "Owned child GID changed"',
  '  assert open(base+"/cgroup").read().strip()=="0::/"+wanted["cgroupName"], "Owned child domain changed"',
  '  group=os.stat("/sys/fs/cgroup/"+wanted["cgroupName"],follow_symlinks=False)',
  '  network=os.stat(base+"/ns/net")',
  '  assert (str(group.st_dev),str(group.st_ino))==(wanted["cgroupDevice"],wanted["cgroupInode"]), "Owned child domain inode changed"',
  '  assert (str(network.st_dev),str(network.st_ino))==(wanted["networkDevice"],wanted["networkInode"]), "Owned child network changed"',
  '  assert os.getsid(wanted["pid"])==wanted["sessionId"], "Owned child session changed"',
  '  print(True)',
  'except (FileNotFoundError,ProcessLookupError): print(False)',
].join('\n')))) === 'True';
const waitFile = async (file: string) => {
  for (let attempt = 0; attempt < 80; ++attempt) {
    if ((await nativeExec(vm.id, 'test -f ' + quote(file), 5000)).code === 0) return;
    await delay(75);
  }
  throw new Error('Owned detached UID child did not publish its receipt');
};
const failConnection = async (command: string) => {
  const live = machines.live.get(vm.id)!;
  const saved = live.sshPort;
  live.sshPort = await freePort();
  assert.notEqual(live.sshPort, saved);
  try {
    await assert.rejects(nativeExec(vm.id, command, 350), /ECONNREFUSED|refused|timed out/i);
  } finally {
    live.sshPort = saved;
  }
};
const p = projectSshPaths('default');
const folder = join(vmDir(vm.id), 'project-ssh', 'default');
const recordPath = join(folder, 'runtime.json');
const proofPath = join(root, 'project-ssh-rollback-evidence-' + invocation + '.json');
const sourceFiles = [
  'scripts/smoke-project-ssh-rollback.ts', 'server/project-ssh.ts', 'server/project-identity.ts',
  'server/project-run-scope.ts', 'server/project-directory-migration.ts',
  'server/project-network-bridges.ts', 'server/workspaces.ts', 'server/machines.ts',
  'native/project-identity/protocol.h', 'native/project-identity/launcher.c',
  'native/project-identity/controller.py',
];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) =>
  [file, createHash('sha256').update(await readFile(resolve(file))).digest('hex')] as const)));
const proof = {
  version: 2, invocation, vmId: vm.id, distro, fixture: root,
  startedAt: new Date().toISOString(), stoppedAt: '', vmStopped: false, passed: false,
  sourceSha256, sourceContract: 'Selected host lifecycle sources, native identity sources, and this harness.',
  plannedCases: modes, unsupportedCases: unsupported,
  migration: null as null | Record<string, unknown>,
  cases: [] as Array<Record<string, unknown>>, error: undefined as string | undefined,
  cleanupErrors: [] as string[],
};
let testBridge: InstanceType<typeof ProjectNetworkBridges> | undefined;
try {
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(300);
  }
  assert.equal(spaces.projects.current(vm.id), 'default');
  const directory = '/srv/projects/ssh-rollback-' + invocation;
  await run('set -eu\nmkdir -p /srv/projects\nmkdir ' + quote(directory));
  await spaces.save(vm.id, { directory, networkIsolation: 'private', template: 'none' });
  const preview = await migrations.preview(vm.id);
  assert.ok(preview.plan);
  const applied = await migrations.apply(vm.id, {
    action: 'apply', version: 1, planId: preview.plan.proposal.planId,
    sha256: preview.plan.sha256, reviewed: true,
  });
  assert.equal(applied.plan?.state, 'applied');
  const identity = applied.plan!.activatedIdentity!;
  assert.ok(identity);
  assert.equal(identity.phase, 'active');
  assert.equal(identity.projectId, 'default');
  assert.equal(identity.directory, directory);
  assert.equal(identity.networkIsolation, 'private');
  const project = await spaces.resolvedConfig(vm.id);
  proof.migration = { planId: preview.plan.proposal.planId, sha256: preview.plan.sha256, identity };
  console.log('Owned ' + distro + ' project SSH rollback fixture: ' + root);
  for (const mode of modes) {
    let issued = false, checks = 0, stops = 0, bridgeValidations = 0;
    let original: ProjectIdentityRun | undefined;
    let record: ReturnType<typeof projectSshRecordSchema.parse> | undefined;
    let child: OwnedChild | undefined;
    const recovered: ProjectIdentityRun[] = [];
    const events: string[] = [];
    const marker = directory + '/child-' + randomUUID() + '.json';
    const lostAck = new Error('Owned original SSH native issuance acknowledgement lost');
    scopes.recoverSshTicket = async (id, projectId, runId, signal) => {
      const ticket = await nativeRecover(id, projectId, runId, signal);
      assert.ok(issued && original && ticket?.run, 'Rollback must recover the issued native ticket');
      assert.equal(id, vm.id);
      assert.equal(projectId, identity.projectId);
      assert.equal(runId, original.runId);
      assert.deepEqual(ticket.run, original);
      const host = (await scopes.sshRuns(id, projectId)).find((entry) => entry.runId === runId);
      assert.equal(host?.phase, 'active');
      assert.deepEqual(host?.run, original);
      recovered.push(structuredClone(ticket.run));
      events.push('original-full-native-ticket-recovered-and-host-pinned');
      return ticket;
    };
    identities.prepareSsh = async (id, requestedIdentity, options, signal) => {
      assert.equal(issued, false, 'This case must inject exactly one native issuance ACK loss');
      assert.equal(id, vm.id);
      assert.deepEqual(requestedIdentity, identity);
      const ticket = await nativePrepare(id, requestedIdentity, options, signal);
      original = Object.freeze(structuredClone(ticket));
      issued = true;
      const intent = (await scopes.sshRuns(id, identity.projectId)).find((entry) => entry.runId === options.runId);
      assert.equal(intent?.phase, 'intent');
      assert.equal(intent?.run, null, 'The host must not yet have acknowledged native issuance');
      assert.deepEqual(intent?.identity, identity);
      assert.equal(intent?.sha256, options.snapshotSha256);
      assert.deepEqual(await identities.runReadonly(id, identity, ticket.runId, signal), ticket);
      await assert.rejects(scopes.sshRun(id, identity.projectId, ticket.runId, signal),
        (error: any) => error.code === 'PROJECT_IDENTITY_RUN_STALE');
      record = projectSshRecordSchema.parse(JSON.parse(await readFile(recordPath, 'utf8')));
      assert.equal(record.runId, ticket.runId);
      assert.deepEqual(record.execution?.identity, identity);
      assert.equal(record.execution?.build, ticket.build);
      assert.equal(record.execution?.bootId, ticket.bootId);
      assert.equal(record.execution?.snapshotSha256, options.snapshotSha256);
      assert.equal(ticket.cgroupName, distro === 'alpine' ? p.openrcGroup.slice(1) : 'system.slice/' + p.unit);
      events.push('real-native-issuance-completed-with-host-intent-run-null');

      // This bridge belongs only to the harness. It authorizes this exact
      // issued ticket without promoting the unacknowledged host intent.
      testBridge = new ProjectNetworkBridges(machines, async (bridgeId, bridgeProject, bridgeSignal) => {
        assert.equal(bridgeId, id);
        assert.equal(bridgeProject._workspace || 'default', ticket.projectId);
        assert.equal(bridgeProject.directory, identity.directory);
        assert.equal(bridgeProject.networkIsolation, 'private');
        assert.deepEqual(await identities.runReadonly(id, identity, ticket.runId, bridgeSignal), ticket);
        ++bridgeValidations;
      });
      const port = await freePort();
      const pin = ssh2.utils.parseKey(record.hostPublicKey);
      assert.ok(!(pin instanceof Error) && !Array.isArray(pin));
      const client = new ssh2.Client();
      const clientKey = await readFile(join(folder, 'id_rsa'));
      try {
        await testBridge.open(id, project, record.guestPort, port, signal);
        await new Promise<void>((resolve, reject) => {
          client.once('ready', resolve).once('error', reject);
          client.connect({
            host: '127.0.0.1', port, username: 'root', privateKey: clientKey, readyTimeout: 10000,
            hostVerifier: (key: Buffer) => key.equals(pin.getPublicSSH()),
          });
        });
        const childSource = [
          'import json,os,time',
          'group=open("/proc/self/cgroup").read().strip()',
          'assert group.startswith("0::/") and "\\n" not in group',
          'name=group[4:]',
          'cg=os.stat("/sys/fs/cgroup/"+name,follow_symlinks=False)',
          'net=os.stat("/proc/self/ns/net")',
          'fields=open("/proc/self/stat").read().rsplit(") ",1)[1].split()',
          'receipt={"pid":os.getpid(),"startTicks":fields[19],"bootId":open("/proc/sys/kernel/random/boot_id").read().strip(),',
          ' "uid":os.getuid(),"gid":os.getgid(),"home":os.environ["HOME"],"user":os.environ["USER"],"logname":os.environ["LOGNAME"],',
          ' "directory":os.getcwd(),"sessionId":os.getsid(0),"networkDevice":str(net.st_dev),"networkInode":str(net.st_ino),',
          ' "cgroupName":name,"cgroupDevice":str(cg.st_dev),"cgroupInode":str(cg.st_ino)}',
          'with open(' + JSON.stringify(marker) + ',"x",encoding="utf-8") as output:',
          ' json.dump(receipt,output);output.flush();os.fsync(output.fileno())',
          'while True: time.sleep(1)',
        ].join('\n');
        const spawn = 'import subprocess\nsubprocess.Popen(["/usr/bin/python3","-I","-S","-c",' +
          JSON.stringify(childSource) + '],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,close_fds=True)';
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Owned SSH child command timed out')), 30000);
          timer.unref();
          const finish = (error?: Error) => {
            clearTimeout(timer);
            error ? reject(error) : resolve();
          };
          client.exec('/usr/bin/python3 -I -S -c ' + quote(spawn), (error, stream) => {
            if (error) return finish(error);
            stream.resume();
            stream.stderr.resume();
            stream.once('error', finish);
            stream.once('close', (code: number) => finish(code === 0 ? undefined : new Error('Owned project command exit ' + code)));
            stream.end();
          });
        });
        await waitFile(marker);
        child = childSchema.parse(JSON.parse(await run('cat ' + quote(marker))));
        assert.equal(child.uid, identity.uid);
        assert.equal(child.gid, identity.gid);
        assert.equal(child.home, identity.home);
        assert.equal(child.user, identity.account);
        assert.equal(child.logname, identity.account);
        assert.equal(child.directory, identity.directory);
        assert.equal(child.sessionId, child.pid);
        for (const key of ['bootId', 'networkDevice', 'networkInode', 'cgroupName', 'cgroupDevice', 'cgroupInode'] as const)
          assert.equal(child[key], ticket[key]);
        assert.equal(await alive(child), true);
        assert.ok(bridgeValidations >= 2, 'The test bridge must validate opening and the actual SSH connection');
        events.push('real-project-uid-detached-child-pinned-to-original-cgroup-and-network');
      } finally {
        client.destroy();
        await testBridge.close();
        testBridge = undefined;
      }
      assert.equal(await alive(child!), true, 'The detached child must survive closing the test bridge');
      const stillIntent = (await scopes.sshRuns(id, identity.projectId)).find((entry) => entry.runId === ticket.runId);
      assert.equal(stillIntent?.phase, 'intent');
      assert.equal(stillIntent?.run, null);
      events.push('test-bridge-closed-original-host-intent-still-unacknowledged');
      throw lostAck;
    };
    machines.exec = (async (id, command, timeout, signal, output, agent) => {
      if (issued && command.startsWith('# SAKURA_PROJECT_SSH_ROLLBACK_CHECK')) {
        ++checks;
        assert.ok(original && child);
        assert.ok(recovered.length >= checks, 'A full ticket must be recovered before selecting rollback ownership');
        if ((mode === 'first-check-failure' && checks === 1) || mode === 'all-check-failures') {
          await failConnection(command);
          assert.equal(await alive(child), true);
          events.push('real-verification-connection-failed-original-uid-child-preserved');
          throw new Error('Owned actual rollback verification connection failed');
        }
      }
      if (issued && command.includes('sakura_rollback_owner=$(')) {
        ++stops;
        assert.ok(original && child && recovered.length);
        if (mode === 'first-stop-failure' && stops === 1) {
          await failConnection(command);
          assert.equal(await alive(child), true);
          events.push('real-stop-connection-failed-original-uid-child-preserved');
          throw new Error('Owned actual rollback stop connection failed');
        }
      }
      return nativeExec(id, command, timeout, signal, output, agent);
    }) as typeof machines.exec;
    let failure: any;
    await assert.rejects(service.start(vm.id), (error: any) => {
      failure = error;
      return error.message.includes(lostAck.message);
    });
    assert.ok(issued && original && record && child);
    const saved = projectSshRecordSchema.parse(JSON.parse(await readFile(recordPath, 'utf8')));
    assert.deepEqual(saved, record);
    let childEndedByRollback = false;
    if (mode !== 'all-check-failures') {
      assert.equal(failure, lostAck, 'Successful rollback must retain the original native ACK loss');
      assert.equal(checks, 2);
      assert.equal(stops, mode === 'first-stop-failure' ? 2 : 1);
      assert.equal(await alive(child), false);
      assert.equal((await service.status(vm.id, project)).running, false);
      childEndedByRollback = true;
    } else {
      assert.equal(failure.code, 'PROJECT_SSH_CLEANUP_FAILED');
      assert.equal(failure.status, 503);
      assert.equal(checks, 3);
      assert.equal(stops, 0);
      assert.equal(await alive(child), true);
      assert.ok(failure.message.includes('runtime.json'));
      const retained: { phase: string; run: ProjectIdentityRun | null } | undefined =
        (await scopes.sshRuns(vm.id, identity.projectId)).find((entry) => entry.runId === original!.runId);
      assert.equal(retained?.phase, 'active');
      assert.deepEqual(retained?.run, original);
      machines.exec = nativeExec;
      await service.stop(vm.id);
      assert.equal(await alive(child), false);
      events.push('manual-stop-verified-original-full-ticket-after-unconfirmed-cleanup');
    }
    assert.deepEqual(await identities.run(vm.id, identity, original.runId), { ...original, phase: 'closed' });
    assert.equal((await scopes.sshRuns(vm.id, identity.projectId)).length, 0);
    await run('set -eu\ntest ! -e ' + quote('/sys/fs/cgroup/' + original.cgroupName) +
      '\ntest ! -e ' + quote('/run/sakura-project-identities/ssh/' + original.runId + '.json'));
    proof.cases.push({
      name: mode, runId: record.runId, originalRun: original, child,
      checks, stops, bridgeValidations, fullTicketRecoveries: recovered.length,
      nativeIssuedWhileHostIntentRunNull: true, originalErrorRetained: true,
      runtimeRecordRetained: true, childEndedByRollback,
      unconfirmedOriginalChildPreserved: mode === 'all-check-failures',
      manualStopAfterUnconfirmedCleanupVerified: mode === 'all-check-failures',
      finalChildEnded: true, originalCgroupAbsent: true, sshReceiptRetired: true,
      nativeRunClosed: true, hostRunClosed: true, events, error: failure.message,
    });
    console.log('PASS ' + mode + ': native ACK loss, UID child, recovered full ticket and real rollback connections.');
    machines.exec = nativeExec;
    identities.prepareSsh = nativePrepare;
    scopes.recoverSshTicket = nativeRecover;
  }
} catch (error) {
  proof.error = String(error);
  throw error;
} finally {
  machines.exec = nativeExec;
  identities.prepareSsh = nativePrepare;
  scopes.recoverSshTicket = nativeRecover;
  for (const close of [() => testBridge?.close(), () => service.close(), () => spaces.close(), () => machines.close()]) {
    try { await close(); } catch (error) { proof.cleanupErrors.push(String(error)); }
  }
  proof.vmStopped = machines.state(vm.id) === 'stopped';
  if (!proof.vmStopped) proof.cleanupErrors.push('Owned fixture VM stop was not confirmed');
  for (const [file, checksum] of Object.entries(sourceSha256)) {
    try {
      assert.equal(createHash('sha256').update(await readFile(resolve(file))).digest('hex'), checksum, 'Source changed: ' + file);
    } catch (error) { proof.cleanupErrors.push(String(error)); }
  }
  proof.stoppedAt = new Date().toISOString();
  proof.passed = !proof.error && proof.cleanupErrors.length === 0 && proof.cases.length === modes.length;
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Project SSH rollback proof:', proofPath);
  if (!proof.error && proof.cleanupErrors.length) throw new Error('Rollback harness finalization failed: ' + proof.cleanupErrors.join('; '));
}
