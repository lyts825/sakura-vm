import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-ssh-test-'));
process.env.SAKURA_DATA_DIR = root;
const { ProjectSsh, projectSshBinding, projectSshPaths, projectSshRecordSchema } =
  await import('../server/project-ssh.ts');
const { createSshKey } = await import('../server/seed.ts');
const { vmDir, AppError } = await import('../server/model.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { projectIdentitySchema, projectIdentityRunSchema } = await import('../server/project-identity.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.match(basename(owned), /^sakura-project-ssh-test-/);
  await rm(owned, { recursive: true, force: true });
});
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const projectId = '1122334455667788',
  p = projectSshPaths(projectId);
const basic = {
  version: 1 as const,
  projectId,
  runId: randomUUID(),
  binding: sha('project'),
  guestPort: 22022,
  environment: sha('environment'),
  hostPublicKey: 'ssh-ed25519 YWJjZA==',
};
const common = Object.fromEntries(
  ['command', 'sshd_config', 'authorized_keys', 'hostkey'].map((name) => [p.config + '/' + name, sha(name)]),
);
function account(project: { directory: string; networkIsolation?: string }) {
  const identityId = randomUUID();
  return projectIdentitySchema.parse({
    version: 1,
    phase: 'active',
    registryId: randomUUID(),
    identityId,
    projectId,
    revision: 1,
    account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    uid: 20000,
    gid: 20000,
    home: '/var/lib/sakura-project-homes/' + identityId,
    directory: project.directory,
    homeDevice: '1',
    homeInode: '2',
    directoryDevice: '1',
    directoryInode: '3',
    networkIsolation: project.networkIsolation || 'host',
  });
}

test('OpenRC receipts require their own launcher and service while legacy systemd receipts remain strict', () => {
  const legacy = { ...basic, files: { ...common, [p.unitPath]: sha('systemd') } };
  assert.equal(projectSshRecordSchema.safeParse(legacy).success, true);
  assert.equal(projectSshRecordSchema.safeParse({ ...legacy, manager: 'systemd' }).success, true);
  assert.equal(projectSshRecordSchema.safeParse({ ...legacy, manager: 'openrc' }).success, false);
  const openrc = {
    ...basic,
    manager: 'openrc',
    files: { ...common, [p.openrcPath]: sha('openrc'), [p.config + '/launch.py']: sha('launcher') },
  };
  assert.equal(projectSshRecordSchema.safeParse(openrc).success, true);
  assert.equal(projectSshRecordSchema.safeParse({ ...openrc, manager: undefined }).success, false);
  assert.equal(
    projectSshRecordSchema.safeParse({ ...openrc, files: { ...openrc.files, [p.unitPath]: sha('systemd') } })
      .success,
    false,
  );
  assert.equal(
    projectSshRecordSchema.safeParse({ ...openrc, projectId: '8877665544332211' }).success,
    false,
    'another project cannot reuse the receipt file set',
  );
});

for (const distro of ['alpine', 'debian'] as const) {
  test(`${distro} project SSH refuses a changed client key or host pin despite a valid guest report`, async () => {
    const id = randomUUID(),
      key = createSshKey();
    const project = {
      ...projectSchema.parse({
        directory: '/workspace/test',
        networkIsolation: 'private',
        environment: { SAKURA_SCOPE: 'test' },
      }),
      _workspace: projectId,
    };
    const folder = join(vmDir(id), 'project-ssh', projectId);
    const identity = account(project),
      bootId = randomUUID(),
      snapshotSha256 = sha('snapshot');
    const run = projectIdentityRunSchema.parse({
      version: 1,
      phase: 'active',
      mode: 'inherit-current',
      registryId: identity.registryId,
      identityId: identity.identityId,
      projectId,
      revision: 1,
      runId: basic.runId,
      bootId,
      build: 'a'.repeat(64),
      cgroupDevice: '1',
      cgroupInode: '4',
      networkDevice: '1',
      networkInode: '5',
      cgroupName: distro === 'alpine' ? 'openrc.sakura-ssh-' + projectId : 'system.slice/' + p.unit,
      namespace: 'sk-' + projectId,
    });
    await mkdir(folder, { recursive: true });
    const record = {
      ...basic,
      binding: projectSshBinding(project),
      environment: sha(JSON.stringify([['SAKURA_SCOPE', 'test']])),
      execution: { identity, bootId, build: run.build, snapshotSha256 },
      ...(distro === 'alpine' ? { manager: 'openrc' as const } : {}),
      files: {
        ...common,
        [p.config + '/session.json']: snapshotSha256,
        [p.config + '/authorized_keys']: sha(key.publicText.trim() + '\n'),
        ...(distro === 'alpine'
          ? { [p.openrcPath]: sha('openrc'), [p.config + '/launch.py']: sha('launcher') }
          : { [p.unitPath]: sha('systemd') }),
      },
    };
    await writeFile(join(folder, 'runtime.json'), JSON.stringify(record));
    await writeFile(join(folder, 'id_rsa'), key.privateText);
    await writeFile(join(folder, 'id_rsa.pub'), key.publicText + '\n');
    const knownHosts = `sakura-${id}-${projectId} ${basic.hostPublicKey}\n`;
    await writeFile(join(folder, 'known_hosts'), knownHosts);
    let guestCalls = 0,
      state = 'running';
    let scopeFailure: Error | undefined;
    const machines = Object.assign(new EventEmitter(), {
      get: () => ({ id, distro }),
      state: () => state,
      exec: async () => {
        guestCalls++;
        return {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            present: true,
            running: true,
            valid: true,
            processes: 2,
            reason: null,
            daemon: { pid: 100, startTicks: '200', bootId, cgroupName: run.cgroupName },
          }),
        };
      },
    }) as unknown as Machines;
    const spaces = {
      config: async () => project,
      resolvedConfig: async () => project,
      projects: {
        inScope: async (_id: string, _projectId: string, action: () => Promise<unknown>) => action(),
      },
    } as unknown as Workspaces;
    const service = new ProjectSsh(machines, spaces, {
      scopes: {
        beginSsh: async () => {
          throw new Error('status must not admit');
        },
        activateSsh: async () => {
          throw new Error('status must not admit');
        },
        sshRun: async () => {
          if (scopeFailure) throw scopeFailure;
          return { identity, run,
            owner: { kind: 'ssh', bootId, runId: run.runId, cgroupName: run.cgroupName },
            sha256: snapshotSha256 };
        },
        sshRuns: async () => [],
        recoverSshTicket: async () => {
          throw new Error('status must not recover cleanup authority');
        },
        closeAfterScopeStopped: async () => {},
      },
    });
    try {
      assert.equal((await service.status(id, project)).valid, true);
      for (const code of ['EGRESS_NNP_RESTART_REQUIRED', 'EGRESS_NNP_PENDING',
        'EGRESS_NNP_SERVICE_UNVERIFIED', 'EGRESS_NNP_PROCESS_CHANGED']) {
        scopeFailure = new AppError('account admission refused (' + code + ')', 409, 'PROJECT_IDENTITY_' + code);
        const refused = await service.status(id, project);
        assert.equal(refused.valid, false);
        assert.equal(refused.reason, scopeFailure.message,
          'an NNP admission failure must retain its actual reason instead of requesting an unrelated SSH rebuild');
        assert.equal(await service.endpoint(id, project), null, 'a detailed failure never authorizes a bridge');
      }
      scopeFailure = new AppError('changed original run', 409, 'PROJECT_IDENTITY_RUN_STALE');
      assert.match((await service.status(id, project)).reason || '', /完整账号票据/);
      scopeFailure = undefined;
      assert.equal((await service.status(id, project)).valid, true);
      await writeFile(join(folder, 'known_hosts'), 'unreviewed host pin\n');
      const changedPin = await service.status(id, project);
      assert.equal(changedPin.valid, false);
      assert.match(changedPin.reason || '', /客户端密钥或主机公钥/);
      await writeFile(join(folder, 'known_hosts'), knownHosts);
      await writeFile(join(folder, 'id_rsa'), createSshKey().privateText);
      assert.equal((await service.status(id, project)).valid, false);
      state = 'paused';
      const prior = guestCalls;
      assert.equal((await service.status(id, project)).valid, false);
      assert.equal(guestCalls, prior, 'paused instances never use a stale guest status to export a bridge');
    } finally {
      await service.close();
    }
  });
}

async function rollbackFixture(distro: 'alpine' | 'debian', mode: string) {
  const id = randomUUID(),
    instance = {},
    boot = randomUUID();
  const project = {
    ...projectSchema.parse({ directory: '/workspace/rollback', networkIsolation: 'private' }),
    _workspace: projectId,
  };
  const folder = join(vmDir(id), 'project-ssh', projectId);
  const commands: string[] = [];
  let checks = 0,
    stops = 0,
    bridgeStops = 0;
  let replacement: any, intent: any;
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, instance]]),
    get: () => ({ id, distro }),
    state: () => 'running',
    locked: async (_id: string, action: () => Promise<unknown>) => action(),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command === 'cat /proc/sys/kernel/random/boot_id') return { code: 0, stdout: boot, stderr: '' };
      if (command.startsWith('# SAKURA_PROJECT_SSH_STATUS'))
        return {
          code: 0,
          stdout: JSON.stringify({
            present: false,
            running: false,
            valid: false,
            processes: 0,
            reason: null,
          }),
          stderr: '',
        };
      if (command.includes('# SAKURA_GUEST_TASK_RUN'))
        return {
          code: 0,
          stdout: 'SAKURA_SSH_HOST_KEY=ssh-ed25519 YWJjZA==\nSAKURA_SSH_BOOT_ID=' + boot + '\n',
          stderr: '',
        };
      if (command.includes('s.bind(')) return { code: 0, stdout: '22022\n', stderr: '' };
      if (command.startsWith('sha256sum '))
        return { code: 0, stdout: sha('hostkey') + '  hostkey\n', stderr: '' };
      if (
        command.includes('systemctl start ' + p.unit) ||
        command.includes('rc-service ' + p.openrcUnit + ' start')
      ) {
        if (mode === 'new-bridge' || mode === 'new-host-record') {
          const original = JSON.parse(await readFile(join(folder, 'runtime.json'), 'utf8'));
          replacement = { port: 22023, record: { ...original, runId: randomUUID() }, project };
          (service as any).endpoints.set(id + ':' + projectId, replacement);
          if (mode === 'new-host-record')
            await writeFile(join(folder, 'runtime.json'), JSON.stringify(replacement.record));
        }
        return { code: 1, stdout: '', stderr: 'owned original startup failure' };
      }
      if (command.startsWith('# SAKURA_PROJECT_SSH_ROLLBACK_CHECK')) {
        ++checks;
        if ((mode === 'first-check-failure' && checks === 1) || mode === 'all-check-failures')
          throw new Error('owned rollback verification connection failed');
        if (mode === 'new-live') machines.live.set(id, {} as any);
        if (mode === 'changed-boot')
          return { code: 1, stdout: '', stderr: '客户机启动身份已改变；拒绝旧项目 SSH 回滚' };
        if (mode === 'changed-guest-run')
          return { code: 1, stdout: '', stderr: '项目 SSH 运行身份已改变；拒绝终止其他启动' };
        return { code: 0, stdout: 'SAKURA_PROJECT_SSH_OWNED\n', stderr: '' };
      }
      if (command.includes('sakura_rollback_owner=$(')) {
        ++stops;
        if ((mode === 'first-stop-failure' && stops === 1) || mode === 'all-stop-failures')
          throw new Error('owned rollback stop connection failed');
        if (mode === 'changed-before-stop') return { code: 1, stdout: '', stderr: '运行身份在停止前已改变' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  }) as unknown as Machines;
  const spaces = {
    resolvedConfig: async () => project,
    config: async () => project,
    projects: {
      current: () => projectId,
      inScope: async (_id: string, _projectId: string, action: () => Promise<unknown>) => action(),
    },
  } as unknown as Workspaces;
  const identity = account(project);
  const service = new ProjectSsh(machines, spaces, {
    identities: {
      sshSessionCommand: async () => '/usr/bin/python3 -I -S /fixed/controller.py metadata-only',
      publishSshSnapshot: async () => {},
    },
    scopes: {
      sshRuns: async () => (intent ? [intent] : []),
      recoverSshTicket: async () => null,
      closeAfterScopeStopped: async () => {
        intent = undefined;
      },
      beginSsh: async (_vm, _project, runId, owner, environment) => {
        const input = Buffer.from(JSON.stringify(environment));
        intent = {
          runId,
          owner,
          identity,
          sha256: createHash('sha256').update(input).digest('hex'),
          phase: 'intent',
          run: null,
        };
        return {
          identity,
          owner,
          snapshot: {
            runId,
            input,
            build: 'a'.repeat(64),
            command: '/fixed/controller metadata-only',
            sha256: createHash('sha256').update(input).digest('hex'),
          },
        };
      },
      activateSsh: async () => {
        throw new Error('failed start must not activate');
      },
      sshRun: async () => {
        throw new Error('failed start must not inspect');
      },
    },
  });
  (service as any).bridges.stop = async () => {
    ++bridgeStops;
  };
  return {
    service,
    id,
    folder,
    commands,
    counts: () => ({ checks, stops, bridgeStops }),
    replacement: () => replacement,
  };
}

for (const distro of ['alpine', 'debian'] as const) {
  for (const mode of ['first-check-failure', 'first-stop-failure']) {
    test(`${distro} project SSH retries ${mode} and retains the original startup error and record`, async () => {
      const f = await rollbackFixture(distro, mode);
      try {
        await assert.rejects(
          f.service.start(f.id),
          (error: any) =>
            error.code !== 'PROJECT_SSH_CLEANUP_FAILED' &&
            /owned original startup failure/.test(error.message),
        );
        const counts = f.counts();
        assert.equal(counts.checks, 2);
        assert.equal(counts.stops, mode === 'first-stop-failure' ? 2 : 1);
        assert.equal(counts.bridgeStops, mode === 'first-stop-failure' ? 2 : 1);
        const record = JSON.parse(await readFile(join(f.folder, 'runtime.json'), 'utf8'));
        assert.equal(projectSshRecordSchema.safeParse(record).success, true);
        for (const command of f.commands.filter((value) => value.includes('sakura_rollback_owner=$('))) {
          assert.ok(command.includes(record.runId));
          assert.ok(command.includes('/proc/sys/kernel/random/boot_id'));
          assert.ok(
            command.indexOf('binding.get') <
              command.indexOf(distro === 'alpine' ? 'with open(path' : 'systemctl stop'),
          );
        }
      } finally {
        await f.service.close();
      }
    });
  }
  for (const mode of [
    'all-check-failures',
    'all-stop-failures',
    'changed-boot',
    'changed-guest-run',
    'changed-before-stop',
    'new-live',
    'new-bridge',
    'new-host-record',
  ]) {
    test(`${distro} project SSH reports uncertain ${mode} without dropping its record or affecting a new bridge`, async () => {
      const f = await rollbackFixture(distro, mode);
      try {
        await assert.rejects(
          f.service.start(f.id),
          (error: any) =>
            error.code === 'PROJECT_SSH_CLEANUP_FAILED' &&
            /owned original startup failure/.test(error.message) &&
            /回滚清理未确认/.test(error.message) &&
            error.message.includes('runtime.json'),
        );
        const counts = f.counts();
        if (mode === 'all-stop-failures' || mode === 'changed-before-stop') assert.equal(counts.stops, 3);
        else {
          assert.equal(counts.stops, 0);
          assert.equal(counts.bridgeStops, 0);
        }
        if (mode === 'new-live') assert.equal(counts.checks, 1);
        else if (!mode.startsWith('new-')) assert.equal(counts.checks, 3);
        const record = JSON.parse(await readFile(join(f.folder, 'runtime.json'), 'utf8'));
        assert.equal(projectSshRecordSchema.safeParse(record).success, true);
        if (mode.startsWith('new-') && mode !== 'new-live')
          assert.equal((f.service as any).endpoints.get(f.id + ':' + projectId), f.replacement());
      } finally {
        await f.service.close();
      }
    });
  }
}

for (const stored of [true, false]) {
  test(`SSH stop recovers the full original native ticket before any service operation with ${stored ? 'a saved endpoint record' : 'only its durable intent'}`, async () => {
    const f = await sshCleanupFixture(stored);
    try {
      await f.service.stop(f.id);
      assert.deepEqual(f.events, [
        'recover-original',
        'verify-original',
        'close-bridge',
        'stop-original',
        'close-ticket',
      ]);
    } finally {
      await f.service.close();
    }
  });
}

test('SSH stop preserves the bridge and service when recovering an issued ticket fails or its build disagrees with the saved endpoint', async () => {
  for (const fault of ['query-failed', 'changed-build'] as const) {
    const f = await sshCleanupFixture(true, fault);
    try {
      await assert.rejects(f.service.stop(f.id), (error: any) =>
        fault === 'query-failed'
          ? error.message === 'owned native recovery transport failed'
          : error.code === 'PROJECT_SSH_CLEANUP_FAILED',
      );
      assert.deepEqual(f.events, ['recover-original']);
    } finally {
      await f.service.close();
    }
  }
});

async function sshCleanupFixture(stored: boolean, fault?: 'query-failed' | 'changed-build') {
  const id = randomUUID(),
    bootId = randomUUID(),
    runId = randomUUID(),
    instance = {},
    events: string[] = [];
  const project = {
    ...projectSchema.parse({ directory: '/workspace/ssh-stop', networkIsolation: 'private' }),
    _workspace: projectId,
  };
  const identity = account(project),
    snapshotSha256 = sha('owned-ssh-snapshot');
  const run = projectIdentityRunSchema.parse({
    version: 1,
    phase: 'active',
    mode: 'inherit-current',
    registryId: identity.registryId,
    identityId: identity.identityId,
    revision: identity.revision,
    projectId,
    runId,
    bootId,
    build: 'a'.repeat(64),
    cgroupName: 'openrc.sakura-ssh-' + projectId,
    cgroupDevice: '51',
    cgroupInode: '91579',
    networkDevice: '52',
    networkInode: '79159',
    namespace: 'sk-' + projectId,
  });
  const entry = {
    runId,
    owner: { kind: 'ssh' as const, bootId, runId, cgroupName: run.cgroupName },
    identity,
    sha256: snapshotSha256,
    phase: 'intent' as const,
    run: null,
  };
  if (stored) {
    const folder = join(vmDir(id), 'project-ssh', projectId);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'runtime.json'),
      JSON.stringify(
        projectSshRecordSchema.parse({
          ...basic,
          runId,
          binding: projectSshBinding(project),
          manager: 'openrc',
          files: {
            ...common,
            [p.config + '/session.json']: snapshotSha256,
            [p.openrcPath]: sha('openrc'),
            [p.config + '/launch.py']: sha('launcher'),
          },
          execution: { identity, bootId, build: run.build, snapshotSha256 },
        }),
      ),
    );
  }
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, instance]]),
    get: () => ({ id, distro: 'alpine' }),
    state: () => 'running',
    locked: async (_id: string, action: () => Promise<unknown>) => action(),
    exec: async (_id: string, command: string) => {
      if (command === 'cat /proc/sys/kernel/random/boot_id') return { code: 0, stdout: bootId, stderr: '' };
      if (
        command.startsWith('# SAKURA_PROJECT_SSH_ROLLBACK_CHECK') ||
        command.includes('sakura_rollback_owner=$(')
      ) {
        assert.ok(events.includes('recover-original'));
        assert.ok(command.includes(run.cgroupInode), 'the stop must pin the recovered inode');
        assert.ok(command.includes(run.cgroupDevice), 'the stop must pin the recovered device');
        assert.ok(command.indexOf('cgroupInode') < command.indexOf('binding.get'));
        events.push(
          command.startsWith('# SAKURA_PROJECT_SSH_ROLLBACK_CHECK') ? 'verify-original' : 'stop-original',
        );
        return { code: 0, stdout: command.startsWith('#') ? 'SAKURA_PROJECT_SSH_OWNED\n' : '', stderr: '' };
      }
      throw new Error('unexpected SSH cleanup command');
    },
  }) as unknown as Machines;
  const spaces = { config: async () => project } as unknown as Workspaces;
  const service = new ProjectSsh(machines, spaces, {
    scopes: {
      sshRuns: async () => [entry],
      recoverSshTicket: async () => {
        events.push('recover-original');
        if (fault === 'query-failed') throw new Error('owned native recovery transport failed');
        return {
          ...entry,
          run: fault === 'changed-build' ? { ...run, build: 'b'.repeat(64) } : run,
          phase: 'active' as const,
        };
      },
      closeAfterScopeStopped: async () => {
        assert.ok(events.includes('stop-original'));
        events.push('close-ticket');
      },
      beginSsh: async () => {
        throw new Error('cleanup must not admit');
      },
      activateSsh: async () => {
        throw new Error('cleanup must not activate');
      },
      sshRun: async () => {
        throw new Error('cleanup must not authorize a session');
      },
    },
  });
  (service as any).bridges.stop = async () => {
    events.push('close-bridge');
  };
  return { id, events, service };
}
