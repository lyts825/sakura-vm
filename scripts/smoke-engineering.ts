import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-engineering-vm-'));
await mkdir(join(directory, 'images'), { recursive: true });
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const features = await Features.create(machines, ['extensions', 'platform', 'git', 'commands']);
let id: string | undefined;
try {
  const vm = await machines.create({
    name: 'engineering-smoke',
    memoryMiB: 1024,
    diskGiB: 4,
    accelerator: process.env.SAKURA_TEST_ACCELERATOR || 'auto',
  });
  id = vm.id;
  console.log('Booting isolated engineering VM');
  await machines.start(id);
  const deadline = Date.now() + 300000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
  console.log('Installing guest test tools');
  const install = await machines.exec(
    id,
    'apk add --no-cache python3 git coreutils iproute2 acl openssl nodejs npm && mkdir -p /workspace/regression/server /workspace/regression/tests /workspace/app',
    600000,
  );
  assert.equal(install.code, 0, install.stderr);
  for (const file of [
    'server/engineering-runner.py',
    'tests/engineering_runner_test.py',
    'tests/capability_runner_test.py',
  ])
    await machines.writeGuestFile(
      id,
      '/workspace/regression/' + file,
      await readFile(resolve(file), 'utf8'),
      false,
    );
  console.log('Running guest executor regression suite');
  const suite = await machines.exec(
    id,
    'cd /workspace/regression && python3 tests/engineering_runner_test.py && python3 tests/capability_runner_test.py',
    180000,
  );
  console.log(suite.stdout + suite.stderr);
  assert.equal(suite.code, 0, suite.stderr);
  await features.workspaces.save(id, {
    directory: '/workspace/app',
    environment: { MODE: 'dev', FLAG: 'true' },
  });
  await machines.writeGuestFile(
    id,
    '/workspace/app/package.json',
    '{"name":"fixture","scripts":{"test":"true"}}',
    false,
  );
  await machines.writeGuestFile(id, '/workspace/app/file.txt', 'hello', false);
  const operate = async (
    operation: string,
    parameters: Record<string, unknown>,
    expected: 'done' | 'error' = 'done',
  ) => {
    const job: any = await features.extended.action(id!, { action: 'operation', operation, parameters });
    await features.extended.jobs.wait(job.key);
    const result = features.extended.jobs.view(job.key)!;
    assert.equal(result.status, expected, operation + '\n' + result.log + '\n' + result.error);
    console.log(operation + ': ' + result.status);
    return JSON.parse(result.log.trim());
  };
  assert.equal((await operate('hash-manifest', { path: '.', output: 'manifest.json' })).entries.length, 2);
  assert.equal((await operate('task-import', { save: true })).saved, 1);
  assert.equal((await features.commands.list(id)).length, 1);
  await operate('env-schema', { rules: { MODE: { choices: ['dev'] }, FLAG: { type: 'boolean' } } });
  await operate('env-schema', { rules: { MODE: { choices: ['production'] } } }, 'error');
  await operate(
    'release-gates',
    {
      checks: [
        { name: 'fail', command: 'exit 7' },
        { name: 'later', command: 'true' },
      ],
    },
    'error',
  );
  await operate('process-history', {});
  await operate('disk-io-metrics', {});
  await operate('network-metrics', {});
  await operate('posix-acl', { mode: 'read', path: 'file.txt' });
  await operate('static-routes', { mode: 'list' });
  await operate('guest-clock-policy', { mode: 'inspect' });
  await operate('command-risk', { command: 'rm -rf build' });
  console.log('Checking commit gate and process cancellation');
  const gitSetup = await machines.exec(
    id,
    'cd /workspace/app && git init && git config user.name Test && git config user.email test@example.invalid && git add package.json && git commit -m initial',
    30000,
  );
  assert.equal(gitSetup.code, 0, gitSetup.stderr);
  console.log('Checking worktree project switching');
  const { CapabilityActions } = await import('../server/capability-actions.ts');
  const capabilities = new CapabilityActions(machines, features.workspaces);
  const capabilitySignal = new AbortController().signal;
  const created = await capabilities.run(
    id,
    'git-worktrees',
    { mode: 'create', path: '.worktrees/topic', branch: 'feature/topic' },
    capabilitySignal,
  );
  assert.equal(created.code, 0, JSON.stringify(created));
  const opened = await capabilities.run(
    id,
    'git-worktrees',
    { mode: 'open', directory: '/workspace/app/.worktrees/topic', projectName: 'Topic' },
    capabilitySignal,
  );
  assert.equal(opened.code, 0, JSON.stringify(opened));
  assert.equal((await features.workspaces.projects.list(id)).active, (opened as any).projectId);
  const selected = await features.workspaces.projects.with(id, (opened as any).projectId, () =>
    features.workspaces.config(id!),
  );
  assert.equal(selected.directory, '/workspace/app/.worktrees/topic');
  await assert.rejects(
    capabilities.run(
      id,
      'git-worktrees',
      { mode: 'remove', directory: selected.directory },
      capabilitySignal,
    ),
    /项目引用/,
  );
  await features.workspaces.projects.update(id, 'default');
  const secret = 'AKIA' + 'A'.repeat(16);
  await machines.writeGuestFile(id, '/workspace/app/credentials.txt', secret, false);
  await machines.exec(id, 'cd /workspace/app && git add credentials.txt');
  const commit: any = await features.git.run(id, { action: 'commit', message: 'blocked' });
  await features.git.jobs.wait(commit.key);
  const commitResult = features.git.jobs.view(commit.key)!;
  assert.equal(commitResult.status, 'error');
  assert.ok(!commitResult.log.includes(secret));
  const cancelled: any = await features.extended.action(id, {
    action: 'operation',
    operation: 'runbooks',
    parameters: {
      steps: [
        {
          name: 'wait',
          command: 'echo $$ > /workspace/app/child.pid; sleep 30; touch /workspace/app/escaped',
          timeout: 60,
        },
      ],
    },
  });
  const until = Date.now() + 15000;
  while ((await machines.exec(id, 'test -f /workspace/app/child.pid')).code !== 0) {
    if (Date.now() > until) throw new Error('cancellable child did not start');
    await delay(100);
  }
  features.extended.jobs.cancel(cancelled.key);
  await features.extended.jobs.wait(cancelled.key);
  assert.equal(features.extended.jobs.view(cancelled.key)?.status, 'cancelled');
  const checkChild = await machines.exec(
    id,
    'p=$(cat /workspace/app/child.pid); ! kill -0 "$p" 2>/dev/null && test ! -e /workspace/app/escaped',
  );
  assert.equal(checkChild.code, 0, 'cancelled engineering child escaped');
  const check: any = await features.next.action(id, { action: 'check', featureId: 'incident-lockdown' });
  assert.equal(check.locked, false);
  await machines.setIncidentLockdown(id, true);
  assert.equal(machines.live.has(id), false);
  await assert.rejects(machines.start(id), /应急锁定/);
  await machines.setIncidentLockdown(id, false);
  console.log('Engineering VM validation passed');
} finally {
  await features.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-engineering-vm-'));
  await rm(directory, { recursive: true, force: true });
}
