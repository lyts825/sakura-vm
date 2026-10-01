import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.argv[2] || 'alpine';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro), 'unsupported smoke distro');
const parent = resolve('.data/network-remaining-test-temp');
await mkdir(parent, { recursive: true });
process.env.TEMP = process.env.TMP = parent;
const reuse = process.argv[3];
const root = reuse ? await realpath(resolve(reuse)) : await mkdtemp(join(parent, 'sakura-guest-task-'));
assert.equal(dirname(await realpath(root)), await realpath(parent));
assert.match(basename(root), /^sakura-guest-task-[A-Za-z0-9_-]+$/);
const previous = reuse
  ? JSON.parse(await readFile(join(root, 'guest-task-cgroup-evidence.json'), 'utf8'))
  : undefined;
if (previous) assert.equal(previous.distro, distro);
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
const { guestTask, guestTaskControlPaths } = await import('../server/guest-task.ts');
const { quote } = await import('../server/files.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
if (reuse) {
  assert.equal(machines.records.size, 1);
  const saved = [...machines.records.values()][0];
  assert.equal(saved.id, previous.vmId);
  assert.equal(saved.name, 'guest-task-cgroup-smoke');
  assert.equal(saved.distro, distro);
  assert.equal(machines.state(saved.id), 'stopped');
}
const vm = reuse
  ? [...machines.records.values()][0]
  : await machines.create({
      name: 'guest-task-cgroup-smoke',
      distro: distro as 'alpine' | 'debian' | 'ubuntu',
      memoryMiB: 1024,
      cpus: 2,
      diskGiB: 4,
    });
const nativeExec = machines.exec.bind(machines);
const run = async (command: string, timeout = 10000) => {
  const result = await nativeExec(vm.id, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout;
};
const folder = '/run/sakura-guest-task-fixture-' + randomUUID();
const proof: any = {
  version: 2,
  vmId: vm.id,
  distro,
  fixture: root,
  sourceSha256: createHash('sha256')
    .update(await readFile(resolve('server/guest-task.ts')))
    .digest('hex'),
  cases: [],
};
const cgroupMembers = async (name: string) =>
  JSON.parse(
    await run(
      'python3 -I -S -c ' +
        quote(
          'import json,os\np="/sys/fs/cgroup/"+' +
            JSON.stringify(name) +
            '\nout=[]\n' +
            'if os.path.isdir(p):\n for directory,_,files in os.walk(p):\n' +
            '  if "cgroup.procs" in files:\n   for pid in open(directory+"/cgroup.procs").read().split():\n' +
            '    try:\n     fields=open("/proc/"+pid+"/stat").read().rsplit(") ",1)[1].split()\n' +
            '     if fields[0] not in ("Z","X"):out.append({"pid":int(pid),"pgid":int(fields[2]),"sid":int(fields[3]),"startTicks":fields[19]})\n' +
            '    except FileNotFoundError:pass\nprint(json.dumps(out))',
        ),
    ),
  ) as { pid: number; pgid: number; sid: number; startTicks: string }[];
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
  console.log('Owned ' + distro + ' fixture: ' + root);
  await run(
    distro === 'alpine'
      ? 'apk add --no-cache python3 util-linux'
      : 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y python3 busybox util-linux',
    240000,
  );
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
    readOnly?: boolean;
    failAll?: boolean;
    delayedAnchor?: boolean;
    replaceScope?: boolean;
    replacement?: { pid: number; inode: string };
  } = {};
  machines.exec = (async (id, command, timeout, signal, output, agent) => {
    if (command.startsWith('# SAKURA_GUEST_TASK_RUN\n')) {
      current.main = command;
      command = command.replace(
        '</dev/null >/dev/null 2>&1 &',
        '</dev/null >' + folder + '/anchor-debug.log 2>&1 &',
      );
      if (current.delayed) {
        assert.ok(command.includes('\nsetsid sh -c '), 'delayed launcher must replace the worker only');
        command = command.replace('\nsetsid sh -c ', '\n/bin/sh ' + folder + '/bin/setsid sh -c ');
      }
      if (current.delayedAnchor) {
        assert.ok(command.includes('\nsh -c '), 'delayed anchor must replace its launch');
        command = command.replace('\nsh -c ', '\n/bin/sh ' + folder + '/delayed-anchor ');
      }
      if (current.busybox) {
        command = command.replace(/(?<![\w/])sh -c /g, current.busybox + ' sh -c ');
        command = command.replace('/bin/sh -c ', current.busybox + ' sh -c ');
        const launcher = '\nsetsid ' + current.busybox + ' sh -c ';
        assert.ok(command.includes(launcher), 'BusyBox fork must replace the worker launcher');
        command = command.replace(launcher, '\nsetsid --fork ' + current.busybox + ' setsid ' + current.busybox + ' sh -c ');
      }
      if (current.readOnly)
        command =
          'unshare -m -- /bin/sh -c ' +
          quote(
            'mount --make-rprivate /; mount --bind /sys/fs/cgroup /sys/fs/cgroup; ' +
              'mount -o remount,bind,ro /sys/fs/cgroup; ' +
              command,
          );
    } else if (command.includes('sakura_owned_anchor')) {
      current.cleanup = command;
      events.push('scope-cleanup');
      if (current.failAll) throw new Error('Owned all cleanup control connections failed');
      if (current.replaceScope && !current.replacement) {
        const result = await nativeExec(id, command, timeout, signal, output, agent);
        assert.equal(result.code, 0, result.stderr);
        const path = '/sys/fs/cgroup/' + scopeFrom(),
          marker = folder + '/replacement.pid';
        await run(
          'mkdir ' +
            quote(path) +
            '\nsetsid python3 -I -S -c ' +
            quote(
              'import os,time\nopen(' +
                JSON.stringify(marker) +
                ',"w").write(str(os.getpid()))\nwhile True:time.sleep(1)',
            ) +
            ' </dev/null >/dev/null 2>&1 &',
        );
        await waitFile(marker);
        const pid = Number((await run('cat ' + quote(marker))).trim());
        await run('printf %s ' + quote(String(pid)) + ' > ' + quote(path + '/cgroup.procs'));
        current.replacement = { pid, inode: (await run('stat -c %i ' + quote(path))).trim() };
        throw new Error('Owned cleanup reply lost after an unrelated replacement scope was created');
      }
      if (current.failFirst && !current.firstFailed) {
        current.firstFailed = true;
        await badConnection(command);
        current.afterFailure = (await cgroupMembers(scopeFrom())).length;
        assert.ok(
          current.afterFailure > 0,
          'first failed control connection did not stop the actual worker group',
        );
        throw new Error('Owned first cleanup SSH connection failed');
      }
    } else if (command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')) {
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
  const receiptFrom = () => {
    const id = /sakura-task-([a-f0-9-]{36})/.exec(current.main!)![1];
    const receipt = guestTaskControlPaths(id).receipt;
    assert.ok(current.main!.includes(receipt));
    return receipt;
  };
  const scopeFrom = () => /sakura-task-[a-f0-9-]{36}/.exec(current.main!)![0];
  const cleanupStage = async (stage: string) => run('rm -rf -- ' + quote(stage));
  const retireReceipt = async (receipt: string) =>
    run(
      'rm -f ' +
        [
          receipt,
          receipt + '.tmp',
          receipt + '.scope',
          receipt + '.scope.tmp',
          receipt + '.refused',
          receipt + '.refused.tmp',
          receipt + '.status',
          receipt + '.status.tmp',
          receipt + '.cancel',
          receipt + '.stop',
          receipt + '.stop.tmp',
          receipt.slice(0, receipt.lastIndexOf('/')) + '/owner',
        ]
          .map(quote)
          .join(' ') + '\nrmdir ' + quote(receipt.slice(0, receipt.lastIndexOf('/'))),
    );

  const stage = folder + '/retry-stage';
  await run('mkdir -m 700 ' + quote(stage));
  const children =
    'import json,os,signal,time\nroot=' +
    JSON.stringify(stage) +
    '\n' +
    'signal.signal(signal.SIGTERM,signal.SIG_IGN)\n' +
    'for kind in ("setsid","double-fork"):\n' +
    ' pid=os.fork()\n if pid==0:\n  os.setsid()\n  if kind=="double-fork" and os.fork()!=0:os._exit(0)\n' +
    '  data={"pid":os.getpid(),"pgid":os.getpgrp(),"sid":os.getsid(0),"cgroup":open("/proc/self/cgroup").read().strip()}\n' +
    '  open(root+"/"+kind+".json","w").write(json.dumps(data))\n' +
    '  while True:\n   with open(root+"/"+kind+".heartbeat","a") as f:f.write("x")\n   time.sleep(.1)\n' +
    'while not all(os.path.exists(root+"/"+x+".json") for x in ("setsid","double-fork")):time.sleep(.05)\n' +
    'open(root+"/started","w").write("ready")\nwhile True:time.sleep(.1)';
  const timeoutChild =
    "trap '' TERM; printf '%s' \"$$\" > " + quote(stage + '/timeout.pid') + '; while :; do sleep 1; done';
  const detachedPayload =
    (distro === 'alpine' ? 'timeout 900 ' : 'timeout -s TERM 900 ') +
    '/bin/sh -c ' +
    quote(timeoutChild) +
    ' &\nexec python3 -I -S -c ' +
    quote(children);
  current = { failFirst: true };
  const controller = new AbortController(),
    logs: string[] = [];
  let callbackAttempts = 0,
    groupConfirmedBeforeStage = false;
  const operation = guestTask(
    machines,
    vm.id,
    detachedPayload,
    controller.signal,
    (s) => logs.push(s),
    12000,
    undefined,
    async () => {
      assert.equal((await cgroupMembers(scopeFrom())).length, 0);
      assert.equal((await nativeExec(vm.id, 'test -e ' + quote('/sys/fs/cgroup/' + scopeFrom()))).code, 1);
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
  await waitFile(stage + '/timeout.pid');
  const owned = (await run('cat ' + quote(receiptFrom()))).trim().split(/\s+/);
  const members = await cgroupMembers(scopeFrom());
  const childEvidence = await Promise.all(
    ['setsid', 'double-fork'].map(async (kind) => ({
      kind,
      ...JSON.parse(await run('cat ' + quote(stage + '/' + kind + '.json'))),
    })),
  );
  for (const child of childEvidence) {
    assert.notEqual(child.sid, Number(owned[2]));
    assert.equal(child.cgroup, '0::/' + scopeFrom());
    assert.ok(members.some((member) => member.pid === child.pid));
  }
  const timeoutPid = Number((await run('cat ' + quote(stage + '/timeout.pid'))).trim());
  const timeoutMember = members.find((member) => member.pid === timeoutPid)!;
  assert.ok(timeoutMember);
  if (distro !== 'alpine')
    assert.notEqual(timeoutMember.pgid, Number(owned[2]), 'GNU timeout must create an independent group');
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
  assert.equal((await cgroupMembers(owned[6])).length, 0);
  for (const member of members) assert.equal(await alive(member.pid), false);
  assert.equal((await nativeExec(vm.id, 'test -e ' + quote(receiptFrom()))).code, 1);
  assert.equal(await alive(unrelated), true);
  proof.cases.push({
    name: 'first-real-ssh-failure-timeout-setsid-double-fork',
    receipt: owned,
    members,
    childEvidence,
    timeoutMember,
    gnuTimeoutNewGroup: distro !== 'alpine',
    liveAfterFirstFailure: current.afterFailure,
    scopeEnded: true,
    stageRetryAttempts: callbackAttempts,
    stageAfterScopeRemoval: true,
    unrelatedPreserved: true,
    logs,
    events: [...events],
  });
  console.log(
    'PASS real first SSH failure, TERM/cgroup.kill, timeout/setsid/double-fork, stage retry and unrelated preservation.',
  );

  for (const fault of ['boot', 'inode', 'scope']) {
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
      scopeName = scopeFrom(),
      text = await run('cat ' + quote(receipt + '.scope')),
      fields = text.trim().split(/\s+/);
    if (fault === 'boot') fields[1] = '00000000-0000-0000-0000-000000000000';
    else if (fault === 'inode') fields[3] += '1';
    else fields[2] = 'sakura-task-' + randomUUID();
    await run('printf %s ' + quote(fields.join(' ') + '\n') + ' > ' + quote(receipt + '.scope'));
    abort.abort();
    await failed;
    assert.equal(callback, false);
    assert.equal(current.retire, undefined);
    assert.ok((await cgroupMembers(scopeName)).length > 0);
    assert.equal((await nativeExec(vm.id, 'test -e ' + quote(receipt))).code, 0);
    assert.equal(await alive(unrelated), true);
    await run('printf %s ' + quote(text) + ' > ' + quote(receipt + '.scope'));
    await run(current.cleanup!);
    assert.equal((await cgroupMembers(scopeName)).length, 0);
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
    '\nsleep 2\nexec setsid "$@"';
  await run(
    'printf %s ' +
      quote(
        '#!/bin/sh\nexec setsid /bin/sh -c ' + quote(delayedLauncher) + ' sakura-delayed-launcher "$@"\n',
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
    'printf %s ' +
      quote(
        "trap '' HUP INT TERM\nprintf begun > " +
          quote(folder + '/delayed-anchor-started') +
          '\nsleep 2\nexec /bin/sh "$@"\n',
      ) +
      ' > ' +
      quote(folder + '/delayed-anchor'),
  );
  current = { delayedAnchor: true };
  const preparedController = new AbortController();
  let preparedCallback = false;
  const prepared = guestTask(
    machines,
    vm.id,
    'printf bad > ' + quote(folder + '/prepared-project-started'),
    preparedController.signal,
    undefined,
    10000,
    undefined,
    async () => {
      preparedCallback = true;
    },
  );
  const preparedRejected = assert.rejects(prepared, /Linux 命令已取消/);
  await waitFile(folder + '/delayed-anchor-started');
  assert.equal((await nativeExec(vm.id, 'test -f ' + quote(receiptFrom() + '.scope'))).code, 0);
  assert.equal((await nativeExec(vm.id, 'test -f ' + quote(receiptFrom()))).code, 1);
  preparedController.abort();
  await preparedRejected;
  assert.equal(preparedCallback, true);
  assert.equal((await nativeExec(vm.id, 'test -e ' + quote(folder + '/prepared-project-started'))).code, 1);
  assert.equal((await cgroupMembers(scopeFrom())).length, 0);
  proof.cases.push({
    name: 'abort-after-prepared-before-ready',
    preparedOwnershipVerified: true,
    noProjectCodeRan: true,
    entireScopeEnded: true,
    stageOnlyAfterScopeRemoval: true,
  });
  console.log(
    'PASS prepared scope was cancelled before ready; no project instruction ran and verified cleanup completed.',
  );

  current = { replaceScope: true };
  let replacedCallback = false;
  await assert.rejects(
    guestTask(
      machines,
      vm.id,
      'exit 0',
      new AbortController().signal,
      undefined,
      10000,
      undefined,
      async () => {
        replacedCallback = true;
      },
    ),
    (error: any) => error.code === 'GUEST_TASK_CLEANUP_FAILED' && /inode/.test(error.message),
  );
  assert.equal(replacedCallback, false);
  assert.equal(current.retire, undefined);
  const replaced = current.replacement!;
  assert.equal(await alive(replaced.pid), true);
  const old = (await run('cat ' + quote(receiptFrom() + '.scope'))).trim().split(/\s+/);
  assert.notEqual(replaced.inode, old[3]);
  assert.equal(
    (await cgroupMembers(scopeFrom())).some((member) => member.pid === replaced.pid),
    true,
  );
  assert.equal(await alive(unrelated), true);
  const replacementPath = '/sys/fs/cgroup/' + scopeFrom();
  await run(
    'set -eu\ntest "$(stat -c %i ' +
      quote(replacementPath) +
      ')" = ' +
      quote(replaced.inode) +
      '\nprintf 1 > ' +
      quote(replacementPath + '/cgroup.kill'),
  );
  for (let attempt = 0; attempt < 20 && (await cgroupMembers(scopeFrom())).length; ++attempt)
    await delay(100);
  assert.equal((await cgroupMembers(scopeFrom())).length, 0);
  await run('rmdir ' + quote(replacementPath));
  await retireReceipt(receiptFrom());
  proof.cases.push({
    name: 'lost-reply-replacement-scope-preserved',
    oldInode: old[3],
    replacement: replaced,
    unrelatedReplacementPreserved: true,
    noStageCleanup: true,
    ownershipRetained: true,
  });
  console.log(
    'PASS real scope replacement after a lost cleanup reply rejected retries and preserved the new process.',
  );

  current = { readOnly: true };
  let refusedCallback = false;
  await assert.rejects(
    guestTask(
      machines,
      vm.id,
      'printf bad > ' + quote(folder + '/unsupported-started'),
      new AbortController().signal,
      undefined,
      10000,
      undefined,
      async () => {
        refusedCallback = true;
      },
    ),
    (error: any) => error.code === 'GUEST_TASK_SCOPE_UNAVAILABLE',
  );
  assert.equal((await nativeExec(vm.id, 'test -e ' + quote(folder + '/unsupported-started'))).code, 1);
  assert.equal(refusedCallback, true);
  assert.equal((await cgroupMembers(scopeFrom())).length, 0);
  proof.cases.push({
    name: 'read-only-cgroup-refuses-project-code',
    error: 'GUEST_TASK_SCOPE_UNAVAILABLE',
    noProjectCodeRan: true,
    refusedOwnershipVerified: true,
  });
  console.log('PASS actual read-only cgroup v2 refused the task before any project instruction.');
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

  if (distro !== 'alpine') {
    const unit = 'sakura-guest-task-owned-' + randomUUID() + '.service';
    const unitPath = '/etc/systemd/system/' + unit;
    const content =
      '[Unit]\nDescription=Owned guest task lifecycle fixture\n[Service]\nType=simple\nExecStart=/bin/sleep 600\n';
    await run('printf %s ' + quote(content) + ' > ' + quote(unitPath) + '\nsystemctl daemon-reload');
    try {
      current = {};
      const installed = await guestTask(
        machines,
        vm.id,
        'systemctl start ' + quote(unit) + '\nsystemctl is-active --quiet ' + quote(unit),
        new AbortController().signal,
        undefined,
        10000,
      );
      assert.equal(installed.code, 0, installed.stderr);
      const pid = Number((await run('systemctl show --value --property MainPID ' + quote(unit))).trim());
      assert.ok(Number.isSafeInteger(pid) && pid > 1);
      const actual = (await run('cat /proc/' + pid + '/cgroup')).trim();
      assert.equal(actual, '0::/system.slice/' + unit);
      assert.equal(await alive(pid), true);
      assert.equal((await cgroupMembers(scopeFrom())).length, 0);
      proof.cases.push({
        name: 'authorized-persistent-init-service',
        unit,
        pid,
        cgroup: actual,
        taskScopeEnded: true,
        separateServicePreserved: true,
      });
      console.log(
        'PASS authorized systemd service started through task CLI keeps its separate service scope.',
      );
    } finally {
      await run(
        'systemctl stop ' + quote(unit) + '\nrm -f -- ' + quote(unitPath) + '\nsystemctl daemon-reload',
      );
    }
  }

  current = { failAll: true };
  const failedMessages: string[] = [];
  let failedCallback = false;
  await assert.rejects(
    guestTask(
      machines,
      vm.id,
      'setsid /bin/sh -c ' +
        quote("trap '' TERM; while :; do sleep 1; done") +
        ' </dev/null >/dev/null 2>&1 &\nexit 0',
      new AbortController().signal,
      (s) => failedMessages.push(s),
      3000,
      undefined,
      async () => {
        failedCallback = true;
      },
    ),
    (error: any) => error.code === 'GUEST_TASK_CLEANUP_FAILED',
  );
  assert.equal(failedCallback, false);
  assert.ok((await cgroupMembers(scopeFrom())).length > 0);
  const deadlineStart = Date.now();
  while ((await cgroupMembers(scopeFrom())).length > 0 && Date.now() - deadlineStart < 40000)
    await delay(400);
  assert.equal(
    (await cgroupMembers(scopeFrom())).length,
    0,
    'deadline must stop detached descendants if all controls fail',
  );
  assert.equal((await nativeExec(vm.id, 'test -f ' + quote(receiptFrom()))).code, 0);
  assert.equal(await alive(unrelated), true);
  await run(current.cleanup!);
  await retireReceipt(receiptFrom());
  proof.cases.push({
    name: 'all-control-failures-finite-anchor',
    noUnverifiedCallback: true,
    deadlineEndedEntireScope: true,
    elapsedMs: Date.now() - deadlineStart,
    ownershipRetained: true,
    logs: failedMessages,
  });
  console.log(
    'PASS all cleanup connections failed explicitly; finite anchor still ended the entire owned scope.',
  );

  await run('kill -TERM ' + unrelated);
} catch (error) {
  proof.error = String(error);
  const diagnostic = await nativeExec(
    vm.id,
    'cat ' + quote(folder + '/anchor-debug.log') + '; cat /proc/self/mountinfo; cat /proc/self/cgroup',
    10000,
  ).catch(() => undefined);
  if (diagnostic) console.error('Owned task diagnostics:', diagnostic.stdout, diagnostic.stderr);
  throw error;
} finally {
  machines.exec = nativeExec;
  await machines.close();
  proof.stoppedAt = new Date().toISOString();
  proof.vmStopped = machines.state(vm.id) === 'stopped';
  const proofPath = join(root, reuse ? 'guest-task-cgroup-evidence-' + randomUUID() + '.json' : 'guest-task-cgroup-evidence.json');
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log('Guest-task proof:', proofPath);
  console.log('Stopped owned ' + distro + ' fixture:', root);
}
