import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(
  process.argv.length,
  3,
  'Pass the stopped owned fixture directory created by test:project-auth-cache.',
);
const parent = await realpath(resolve('.data/dependency-auth-test-temp'));
const root = await realpath(resolve(process.argv[2]));
assert.equal(dirname(root), parent);
assert.match(basename(root), /^sakura-auth-cache-[A-Za-z0-9_-]+$/);
const authEvidence = JSON.parse(await readFile(join(root, 'authenticated-prefetch-evidence.json'), 'utf8'));
assert.equal(authEvidence.distro, 'debian');
assert.equal(typeof authEvidence.vmId, 'string');
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/debian-12.qcow2');
process.env.TEMP = process.env.TMP = resolve('.data/native-clipboard-test-temp');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { guestTask } = await import('../server/guest-task.ts');
const { quote } = await import('../server/files.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
assert.equal(machines.records.size, 1);
const vm = [...machines.records.values()][0];
assert.equal(vm.name, 'auth-cache-smoke');
assert.equal(vm.distro, 'debian');
assert.equal(vm.id, authEvidence.vmId);
assert.equal(machines.state(vm.id), 'stopped');
const nativeExec = machines.exec.bind(machines);
const run = async (command: string, timeout = 10000) => {
  const result = await nativeExec(vm.id, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout;
};
const folder = '/run/sakura-guest-task-fixture-' + randomUUID();
const proof: any = { version: 1, vmId: vm.id, fixture: root, cases: [] };
const groupMembers = async (leader: number) =>
  JSON.parse(
    await run(
      'python3 -I -S -c ' +
        quote(
          "import glob,json\nout=[]\nfor file in glob.glob('/proc/[0-9]*/stat'):\n try:\n  fields=open(file).read().rsplit(')',1)[1].split()\n  if fields[2]==fields[3]==" +
            JSON.stringify(String(leader)) +
            " and fields[0] not in ('Z','X'):out.append({'pid':int(file.split('/')[2]),'startTicks':fields[19]})\n except FileNotFoundError:pass\nprint(json.dumps(out))",
        ),
    ),
  ) as { pid: number; startTicks: string }[];
const alive = async (pid: number) =>
  (
    await run(
      'python3 -I -S -c ' +
        quote(
          "import os\ntry:print(open('/proc/" +
            pid +
            "/stat').read().rsplit(')',1)[1].split()[0] not in ('Z','X'))\nexcept FileNotFoundError:print(False)",
        ),
    )
  ).trim() === 'True';
const waitFile = async (file: string) => {
  for (let attempt = 0; attempt < 100; ++attempt) {
    if ((await nativeExec(vm.id, 'test -f ' + quote(file), 5000)).code === 0) return;
    await delay(50);
  }
  throw new Error('Owned task fixture file not created: ' + file);
};
const badConnection = async (command: string) => {
  const live = machines.live.get(vm.id)!;
  const saved = live.sshPort;
  live.sshPort = await freePort();
  try {
    await assert.rejects(nativeExec(vm.id, command, 350), /timed out|ECONNREFUSED|refused/);
  } finally {
    live.sshPort = saved;
  }
};
let unrelated = 0;
try {
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(300);
  }
  console.log('Started stopped owned Debian auth fixture for guest-task cleanup validation.');
  await run('umask 077; mkdir -p ' + quote(folder));
  const unusualName = 'owned\n) par(';
  await run(
    'setsid python3 -I -S -c ' +
      quote(
        'import ctypes,os,time\nctypes.CDLL(None).prctl(15,' +
          JSON.stringify(unusualName) +
          '.encode(),0,0,0)\nopen(' +
          JSON.stringify(folder + '/unrelated.pid') +
          ",'w').write(str(os.getpid()))\nwhile True:time.sleep(1)",
      ) +
      ' </dev/null >/dev/null 2>&1 &',
  );
  await waitFile(folder + '/unrelated.pid');
  unrelated = Number((await run('cat ' + quote(folder + '/unrelated.pid'))).trim());
  const actualName = await run(
    'python3 -I -S -c ' +
      quote("import json;print(json.dumps(open('/proc/" + unrelated + "/comm').read().rstrip('\\n')))"),
  );
  assert.equal(JSON.parse(actualName), unusualName);
  proof.unrelated = { pid: unrelated, comm: unusualName };
  const events: string[] = [];
  let current: {
    main?: string;
    cleanup?: string;
    retire?: string;
    failFirst?: boolean;
    firstFailed?: boolean;
    afterFailure?: number;
    delayed?: boolean;
    busybox?: string;
  } = {};
  machines.exec = (async (id, command, timeout, signal, output, agent) => {
    if (command.startsWith('setsid sh -c')) {
      current.main = command;
      command = command.replace(
        '</dev/null >/dev/null 2>&1 &',
        '</dev/null >' + folder + '/anchor-debug.log 2>&1 &',
      );
      if (current.delayed) command = command.replace(/^setsid/, '/bin/sh ' + folder + '/bin/setsid');
      if (current.busybox) {
        command = command.replaceAll('sh -c ', current.busybox + ' sh -c ');
        command = command.replace(/^setsid /, '/usr/bin/setsid --fork ' + current.busybox + ' setsid ');
      }
    } else if (command.includes('sakura_owned_anchor')) {
      current.cleanup = command;
      events.push('group-cleanup');
      if (current.failFirst && !current.firstFailed) {
        current.firstFailed = true;
        await badConnection(command);
        const receipt = /\/tmp\/\.sakura-job-[a-f0-9-]{36}\.pid/.exec(current.main!)![0];
        const fields = (await run('cat ' + quote(receipt))).trim().split(/\s+/);
        current.afterFailure = (await groupMembers(Number(fields[2]))).length;
        assert.ok(
          current.afterFailure > 0,
          'first failed control connection did not stop the actual worker group',
        );
        throw new Error('Owned first cleanup SSH connection failed');
      }
    } else if (command.startsWith('rm -f')) {
      current.retire = command;
      events.push('receipt-retirement');
    }
    return nativeExec(id, command, timeout, signal, output, agent);
  }) as typeof machines.exec;
  const payload = (stage: string) =>
    "trap '' TERM\nprintf started > " +
    quote(stage + '/started') +
    '\nwhile :; do printf x >> ' +
    quote(stage + '/heartbeat') +
    '; sleep 0.1; done';
  const receiptFrom = () => /\/tmp\/\.sakura-job-[a-f0-9-]{36}\.pid/.exec(current.main!)![0];
  const cleanupStage = async (stage: string) =>
    run('rm -f ' + quote(stage + '/started') + ' ' + quote(stage + '/heartbeat') + '; rmdir ' + quote(stage));
  const retireReceipt = async (receipt: string) =>
    run(
      'rm -f ' +
        [
          receipt,
          receipt + '.tmp',
          receipt + '.status',
          receipt + '.status.tmp',
          receipt + '.cancel',
          receipt + '.stop',
          receipt + '.stop.tmp',
        ]
          .map(quote)
          .join(' '),
    );

  const stage = folder + '/retry-stage';
  await run('mkdir -m 700 ' + quote(stage));
  current = { failFirst: true };
  const controller = new AbortController(),
    logs: string[] = [];
  let callbackAttempts = 0,
    groupConfirmedBeforeStage = false;
  const operation = guestTask(
    machines,
    vm.id,
    payload(stage),
    controller.signal,
    (s) => logs.push(s),
    12000,
    undefined,
    async () => {
      const fields = (await run('cat ' + quote(receiptFrom()))).trim().split(/\s+/);
      assert.equal((await groupMembers(Number(fields[2]))).length, 0);
      groupConfirmedBeforeStage = true;
      events.push('stage-cleanup');
      if (++callbackAttempts === 1) {
        await badConnection('true');
        assert.equal((await nativeExec(vm.id, 'test -d ' + quote(stage))).code, 0);
        throw new Error('Owned first stage cleanup SSH connection failed');
      }
      await cleanupStage(stage);
    },
  );
  const rejected = assert.rejects(operation, /Linux 命令已取消/);
  await waitFile(stage + '/started');
  const owned = (await run('cat ' + quote(receiptFrom()))).trim().split(/\s+/);
  controller.abort();
  try {
    await rejected;
  } catch (error) {
    console.error('Owned anchor diagnostics:', await run('cat ' + quote(folder + '/anchor-debug.log')));
    throw error;
  }
  assert.equal(current.firstFailed, true);
  assert.equal(callbackAttempts, 2);
  assert.equal(groupConfirmedBeforeStage, true);
  assert.equal((await groupMembers(Number(owned[2]))).length, 0);
  assert.equal((await nativeExec(vm.id, 'test -e ' + quote(receiptFrom()))).code, 1);
  assert.equal(await alive(unrelated), true);
  proof.cases.push({
    name: 'first-real-ssh-failure-and-term-kill',
    receipt: owned,
    liveAfterFirstFailure: current.afterFailure,
    groupEnded: true,
    stageRetryAttempts: callbackAttempts,
    stageAfterGroup: true,
    unrelatedPreserved: true,
    logs,
    events: [...events],
  });
  console.log(
    'PASS real first cleanup SSH failure, TERM/KILL escalation, callback SSH retry, group proof, unrelated newline comm and receipt retirement.',
  );

  for (const fault of ['boot', 'startTicks']) {
    const badStage = folder + '/' + fault;
    await run('mkdir -m 700 ' + quote(badStage));
    current = {};
    const abort = new AbortController(),
      messages: string[] = [];
    let callback = false;
    const task = guestTask(
      machines,
      vm.id,
      payload(badStage),
      abort.signal,
      (s) => messages.push(s),
      12000,
      undefined,
      async () => {
        callback = true;
      },
    );
    const failed = assert.rejects(task, (error: any) => error.code === 'GUEST_TASK_CLEANUP_FAILED');
    await waitFile(badStage + '/started');
    const receipt = receiptFrom(),
      text = await run('cat ' + quote(receipt)),
      fields = text.trim().split(/\s+/);
    if (fault === 'boot') fields[1] = '00000000-0000-0000-0000-000000000000';
    else fields[5] = fields[5] + '1';
    await run('printf %s ' + quote(fields.join(' ') + '\n') + ' > ' + quote(receipt));
    abort.abort();
    await failed;
    assert.equal(callback, false);
    assert.equal(current.retire, undefined);
    assert.ok((await groupMembers(Number(fields[2]))).length > 0);
    assert.equal((await nativeExec(vm.id, 'test -e ' + quote(receipt))).code, 0);
    assert.equal(await alive(unrelated), true);
    await run('printf %s ' + quote(text) + ' > ' + quote(receipt));
    await run(current.cleanup!);
    assert.equal((await groupMembers(Number(fields[2]))).length, 0);
    await cleanupStage(badStage);
    await retireReceipt(receipt);
    proof.cases.push({
      name: fault + '-identity-rejection',
      noStageCleanup: true,
      noRetirement: true,
      ownedAndUnrelatedNotKilled: true,
      receiptRetained: true,
      restoredOwnedIdentityCleanupVerified: true,
      logs: messages,
    });
    console.log(
      'PASS ' +
        fault +
        ' identity mismatch refused signaling and retained ownership; restored owned identity cleanup verified.',
    );
  }

  await run('mkdir -m 700 ' + quote(folder + '/bin'));
  const delayedLauncher =
    "trap '' HUP INT TERM\nprintf begun > " +
    quote(folder + '/delayed-launcher-started') +
    '\nsleep 2\nexec /usr/bin/setsid "$@"';
  await run(
    'printf %s ' +
      quote(
        '#!/bin/sh\nexec /usr/bin/setsid /bin/sh -c ' +
          quote(delayedLauncher) +
          ' sakura-delayed-launcher "$@"\n',
      ) +
      ' > ' +
      quote(folder + '/bin/setsid') +
      '; chmod 700 ' +
      quote(folder + '/bin/setsid'),
  );
  current = { delayed: true };
  const lateController = new AbortController();
  let lateCallback = false;
  const late = guestTask(
    machines,
    vm.id,
    'printf bad > ' + quote(folder + '/late-started'),
    lateController.signal,
    undefined,
    6000,
    undefined,
    async () => {
      lateCallback = true;
    },
  );
  const lateRejected = assert.rejects(late, (error: any) => error.code === 'GUEST_TASK_CLEANUP_FAILED');
  await waitFile(folder + '/delayed-launcher-started');
  lateController.abort();
  await lateRejected;
  await delay(2200);
  assert.equal((await nativeExec(vm.id, 'test -e ' + quote(folder + '/late-started'))).code, 1);
  assert.equal((await run('cat ' + quote(receiptFrom() + '.status'))).trim(), '125');
  assert.equal(lateCallback, false);
  await retireReceipt(receiptFrom());
  proof.cases.push({
    name: 'abort-before-worker-receipt',
    noProjectCodeRan: true,
    noUnverifiedStageCleanup: true,
    delayedWorkerCancelled: true,
  });
  console.log('PASS cancellation marker blocked a worker delayed until after receipt-free cleanup began.');

  await run(
    'if ! command -v busybox >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get update >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y busybox >/dev/null; fi',
    120000,
  );
  const busybox = (await run('command -v busybox')).trim();
  assert.match(busybox, /^\/(?:usr\/)?bin\/busybox$/);
  current = { busybox };
  let statusCallback = false;
  const status = await guestTask(
    machines,
    vm.id,
    'printf BusyBox-owned; readlink /proc/$$/exe; exit 23',
    new AbortController().signal,
    undefined,
    10000,
    undefined,
    async () => {
      statusCallback = true;
    },
  );
  assert.equal(status.code, 23);
  assert.match(status.stdout, /BusyBox-owned/);
  assert.match(status.stdout, /\/busybox/);
  assert.equal(statusCallback, true);
  assert.equal(await alive(unrelated), true);
  proof.cases.push({
    name: 'busybox-forked-setsid-status',
    shell: 'busybox-ash',
    code: status.code,
    workerStatusPreserved: true,
    afterCleanup: true,
  });
  console.log('PASS actual BusyBox setsid fork preserved worker exit 23 and completed verified cleanup.');

  await run('kill -TERM ' + unrelated);
  proof.stoppedAt = new Date().toISOString();
  await writeFile(join(root, 'guest-task-cleanup-evidence.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log('Guest-task proof:', join(root, 'guest-task-cleanup-evidence.json'));
} finally {
  machines.exec = nativeExec;
  await machines.close();
  console.log('Stopped owned Debian fixture:', root);
}
