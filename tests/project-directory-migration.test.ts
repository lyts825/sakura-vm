import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema } from '../server/workspaces.ts';
import { projectIdentitySchema, projectIdentityAssetNames } from '../server/project-identity.ts';
import { AppError } from '../server/model.ts';
import { ProjectTerminals, assertProjectTerminalsStopped } from '../server/project-terminals.ts';
import {
  ProjectDirectoryMigrations,
  migrationDirectoryAllowed,
  migrationPlanDigest,
  directoryMigrationPlanSchema,
  directoryMigrationApplySchema,
  assertNoPendingProjectDirectoryMigration,
} from '../server/project-directory-migration.ts';

const parent = resolve('.data/project-directory-migration-unit-tests');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'sakura-directory-migration-'));
const source = join(root, 'sources');
await mkdir(source);
const aggregate = createHash('sha256'),
  files: { name: string; size: number; sha256: string }[] = [];
for (const name of projectIdentityAssetNames) {
  const data = await readFile(resolve('native/project-identity', name));
  aggregate.update(name).update(data);
  await writeFile(join(source, name), data);
  files.push({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const build = aggregate.digest('hex');
await writeFile(join(source, 'manifest.json'), JSON.stringify({ version: 1, build, files }));
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(parent));
  assert.match(basename(owned), /^sakura-directory-migration-/);
  await rm(owned, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(root, 'host-')),
    vmId = randomUUID(),
    identityId = randomUUID();
  let project = projectSchema.parse({ directory: '/srv/projects/alpha', networkIsolation: 'private' });
  const configFile = join(directory, 'project.json');
  await writeFile(configFile, JSON.stringify(project));
  let identity = projectIdentitySchema.parse({
    version: 1,
    phase: 'intent',
    registryId: randomUUID(),
    projectId: 'default',
    identityId,
    revision: 1,
    uid: 20000,
    gid: 20000,
    account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    home: '/var/lib/sakura-project-homes/' + identityId,
    homeDevice: '2049',
    homeInode: '800',
    directory: project.directory,
    directoryDevice: '2049',
    directoryInode: '900',
    networkIsolation: 'private',
  });
  const commands: string[] = [],
    requests: any[] = [],
    events: string[] = [];
  let reserved = 0,
    uploads = 0,
    busy = false,
    stale = false,
    hostGuard = false,
    lost = false,
    lostConfirm = false,
    guestPlan: any = null;
  let otherDirectory: string | null = null,
    latch: unknown = null;
  const live = { status: 'running' },
    running = new Map([[vmId, live]]);
  const reply = (result: unknown) => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result }) });
  const machines = {
    get: () => ({ id: vmId, distro: 'debian' }),
    state: () => 'running',
    live: running,
    locked: async (key: string, action: () => Promise<unknown>) => {
      events.push('lock:' + key);
      return action();
    },
    writeGuestFile: async () => {
      ++uploads;
    },
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return { code: 0, stderr: '', stdout: busy ? 'unmanaged\n' : 'absent\n' };
      if (command.includes("/controller.py' '"))
        return reply({ version: 1, build, registryId: identity.registryId, bootId: randomUUID() });
      if (command.includes('project-directory-migrations'))
        return { code: 0, stderr: '', stdout: JSON.stringify(latch) };
      return { code: 0, stderr: '', stdout: '' };
    },
    execInput: async (_id: string, command: string, bytes: Buffer) => {
      commands.push(command);
      const request = JSON.parse(bytes.toString());
      requests.push(request);
      assert.equal(request.build, build);
      assert.ok(command.includes('os.O_NOFOLLOW'));
      assert.equal(request.identity.uid, identity.uid);
      assert.equal(request.controllerSha256, files[2].sha256);
      if (request.action === 'preview') {
        const entry = {
          path: '.',
          kind: 'directory',
          device: '2049',
          inode: '900',
          mountId: '25',
          filesystemId: '82',
          uid: 0,
          gid: 0,
          mode: 0o700,
          links: 2,
          size: 4096,
          mtimeNs: '10',
          ctimeNs: '11',
          sha256: null,
          targetMode: 0o700,
        };
        const proposal = {
          version: 1,
          planId: randomUUID(),
          createdAt: new Date().toISOString(),
          vmId,
          projectId: 'default',
          bootId: randomUUID(),
          identity: { ...identity },
          directory: project.directory,
          networkIsolation: 'private',
          configSha256: request.configSha256,
          projectsSha256: request.projectsSha256,
          policy: 'private-owner-v1',
          entries: [entry],
          summary: { files: 0, directories: 1, bytes: 0 },
        };
        guestPlan = {
          version: 1,
          proposal,
          sha256: migrationPlanDigest(proposal),
          state: 'preview',
          completed: [],
          attempt: null,
          lastError: null,
          activatedIdentity: null,
        };
        if (stale) {
          guestPlan.proposal.identity.uid = guestPlan.proposal.identity.gid = 20001;
          guestPlan.sha256 = migrationPlanDigest(guestPlan.proposal);
        }
      } else if (request.action === 'apply') {
        guestPlan.state = 'directory-applied';
        guestPlan.completed = ['.'];
        if (lost) {
          lost = false;
          throw new Error('Owned apply ACK lost.');
        }
      } else if (request.action === 'confirm') {
        guestPlan.state = 'applied';
        guestPlan.activatedIdentity = { ...identity };
        if (lostConfirm) {
          lostConfirm = false;
          throw Object.assign(new Error('Owned final confirm ACK lost.'), {
            migrationDetail: { code: 'CONTROL_UNCONFIRMED', plan: structuredClone(guestPlan) },
          });
        }
      }
      return reply(guestPlan);
    },
  };
  const workspaces = {
    jobs: { list: () => [] },
    beforeConfigChange: () => () => {},
    config: async () => project,
    projects: {
      current: () => 'default',
      file: () => configFile,
      list: async () => ({
        projects: [{ id: 'default' }, ...(otherDirectory ? [{ id: 'aaaaaaaaaaaaaaaa' }] : [])],
      }),
      inScope: async (_vm: string, id: string, action: () => Promise<unknown>) =>
        id === 'default' ? action() : projectSchema.parse({ directory: otherDirectory! }),
      with: async (_vm: string, _id: string, action: () => Promise<unknown>) => action(),
    },
  };
  const scopes = {
    withLock: async (_id: string, projectId: string, action: (access: any) => Promise<unknown>) => {
      assert.ok(events.some((value) => value === 'lock:' + vmId));
      events.push('identity-lock:' + projectId);
      return action({
        recoverStoppedTasks: async () => {
          events.push('recover-stopped-tasks');
        },
        guard: async () => {
          events.push('host-run-guard');
          if (hostGuard) throw new AppError('Owned active journal.', 409, 'PROJECT_IDENTITY_RUNS_MUST_STOP');
        },
        reserve: async () => {
          events.push('reserve-fixed-account');
          ++reserved;
          return identity;
        },
        identity: async () => {
          identity = { ...identity, phase: 'active' };
          return identity;
        },
      });
    },
  };
  const service = new ProjectDirectoryMigrations(
    machines as unknown as Machines,
    workspaces as unknown as Workspaces,
    { scopes: scopes as any, sourceDirectory: source, rootDirectory: directory },
  );
  return {
    service,
    machines,
    workspaces,
    vmId,
    commands,
    requests,
    events,
    counts: () => ({ reserved, uploads }),
    removeSavedConfig: async () => {
      await rm(configFile);
    },
    set: (value: string) => {
      busy = value === 'busy';
      stale = value === 'stale';
      hostGuard = value === 'host-guard';
      lost = value === 'lost';
      lostConfirm = value === 'lost-confirm';
    },
    changeConfig: () => {
      project = { ...project, command: 'new-command' };
    },
    overlap: () => {
      otherDirectory = '/srv/projects';
    },
    setLatch: (value: unknown) => {
      latch = value;
    },
  };
}
test('allowlist excludes root, system folders, parent traversals and ambiguous paths', () => {
  for (const directory of [
    '/root',
    '/root/project',
    '/',
    '/srv',
    '/opt/projects',
    '/workspace/a/../b',
    '/workspace/a//b',
    '/workspace/a\0b',
  ])
    assert.equal(migrationDirectoryAllowed(directory), false, directory);
  for (const directory of ['/workspace', '/workspace/a', '/srv/projects/a', '/opt/projects/a'])
    assert.equal(migrationDirectoryAllowed(directory), true, directory);
});
test('GET only reads saved host view, with no account reservation, source install or SSH', async () => {
  const f = await fixture();
  const view = await f.service.view(f.vmId);
  assert.equal(view.plan, null);
  assert.equal(f.commands.length, 0);
  assert.deepEqual(f.counts(), { reserved: 0, uploads: 0 });
});
test('unsaved project preview refuses before account reservation and SSH', async () => {
  const f = await fixture();
  await f.removeSavedConfig();
  await assert.rejects(f.service.preview(f.vmId), { code: 'PROJECT_DIRECTORY_CONFIG_NOT_SAVED' });
  assert.deepEqual(f.counts(), { reserved: 0, uploads: 0 });
  assert.equal(f.commands.length, 0);
});
test('POST preview pins complete identity and bounded inert data under VM then identity locks', async () => {
  const f = await fixture();
  const view = await f.service.preview(f.vmId);
  assert.equal(view.plan?.state, 'preview');
  assert.equal(f.counts().reserved, 1);
  assert.deepEqual(f.events.slice(0, 2), ['lock:' + f.vmId, 'identity-lock:default']);
  assert.deepEqual(f.events.slice(2, 5), [
    'reserve-fixed-account',
    'recover-stopped-tasks',
    'host-run-guard',
  ]);
  assert.equal(f.requests[0].identity.phase, 'intent');
  assert.equal(f.requests[0].action, 'preview');
  assert.equal(f.requests[0].projects.length, 1);
  assert.equal(view.plan?.proposal.summary.directories, 1);
});
test('apply requires exact version, explicit review and same cached proposal before reservation', async () => {
  const f = await fixture();
  const view = await f.service.preview(f.vmId),
    plan = view.plan!;
  const apply = {
    action: 'apply',
    version: 1,
    planId: plan.proposal.planId,
    sha256: plan.sha256,
    reviewed: true,
  };
  assert.equal(directoryMigrationApplySchema.safeParse({ ...apply, reviewed: false }).success, false);
  assert.equal(directoryMigrationApplySchema.safeParse({ ...apply, version: 2 }).success, false);
  assert.equal(directoryMigrationApplySchema.safeParse({ ...apply, directory: '/root' }).success, false);
  await assert.rejects(f.service.apply(f.vmId, { ...apply, planId: randomUUID() }), {
    code: 'PROJECT_DIRECTORY_PLAN_CHANGED',
  });
  assert.equal(f.counts().reserved, 1);
  f.changeConfig();
  await assert.rejects(f.service.apply(f.vmId, apply), { code: 'PROJECT_DIRECTORY_PLAN_CHANGED' });
  assert.equal(f.counts().reserved, 1);
});
test('active legacy main and open host run journal prevent permission helper entry', async () => {
  for (const mode of ['busy', 'host-guard']) {
    const f = await fixture();
    f.set(mode);
    await assert.rejects(f.service.preview(f.vmId), /Owned active journal|全部后代/);
    assert.equal(f.counts().reserved, mode === 'host-guard' ? 1 : 0);
    assert.equal(f.requests.length, 0);
  }
});
test('overlapping saved project is actionable and never reaches permission helper', async () => {
  const f = await fixture();
  f.overlap();
  await assert.rejects(f.service.preview(f.vmId), /独立目录/);
  assert.equal(f.requests.length, 0);
});
test('a valid-looking guest reply cannot choose a different UID/GID from pinned account', async () => {
  const f = await fixture();
  f.set('stale');
  await assert.rejects(f.service.preview(f.vmId), { code: 'PROJECT_DIRECTORY_CONTROL_FAILED' });
  assert.equal((await f.service.view(f.vmId)).plan, null);
});
test('apply finalizes full directory receipt only after active identity and rechecked confirm', async () => {
  const f = await fixture(),
    preview = await f.service.preview(f.vmId),
    plan = preview.plan!;
  const result = await f.service.apply(f.vmId, {
    action: 'apply',
    version: 1,
    planId: plan.proposal.planId,
    sha256: plan.sha256,
    reviewed: true,
  });
  assert.equal(result.plan?.state, 'applied');
  assert.equal(result.plan?.activatedIdentity?.phase, 'active');
  assert.deepEqual(
    f.requests.map((value) => value.action),
    ['preview', 'apply', 'confirm'],
  );
  assert.equal(result.plan?.sha256, plan.sha256);
  assert.equal(
    directoryMigrationPlanSchema.safeParse({ ...result.plan, sha256: '0'.repeat(64) }).success,
    false,
  );
});
test('lost apply ACK preserves original plan and permits explicit same-plan recovery', async () => {
  const f = await fixture(),
    preview = await f.service.preview(f.vmId),
    plan = preview.plan!;
  const input = {
    action: 'apply',
    version: 1,
    planId: plan.proposal.planId,
    sha256: plan.sha256,
    reviewed: true,
  };
  f.set('lost');
  await assert.rejects(f.service.apply(f.vmId, input), /ACK lost/);
  const failed = await f.service.view(f.vmId);
  assert.equal(failed.plan?.sha256, plan.sha256);
  assert.ok(failed.lastFailure);
  const retried = await f.service.apply(f.vmId, input);
  assert.equal(retried.plan?.state, 'applied');
});
test('lost final confirm remains visibly unconfirmed and supports explicit same-plan retry', async () => {
  const f = await fixture(),
    plan = (await f.service.preview(f.vmId)).plan!;
  const input = {
    action: 'apply',
    version: 1,
    planId: plan.proposal.planId,
    sha256: plan.sha256,
    reviewed: true,
  };
  f.set('lost-confirm');
  await assert.rejects(f.service.apply(f.vmId, input), /Owned final confirm ACK lost/);
  const failed = await f.service.view(f.vmId);
  assert.equal(failed.plan?.sha256, plan.sha256);
  assert.equal(failed.plan?.state, 'applied');
  assert.ok(failed.lastFailure);
  const recovered = await f.service.apply(f.vmId, input);
  assert.equal(recovered.plan?.state, 'applied');
  assert.equal(recovered.lastFailure, null);
});
test('prepared task lease blocks preview and apply before any account or guest work', async () => {
  const f = await fixture(),
    plan = (await f.service.preview(f.vmId)).plan!,
    terminals = new ProjectTerminals(
      f.machines as unknown as Machines,
      f.workspaces as unknown as Workspaces,
    ),
    peer = new ProjectTerminals(f.machines as unknown as Machines, f.workspaces as unknown as Workspaces),
    abort = new AbortController();
  let lease: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
  try {
    lease = await terminals.prepare(f.vmId, 'default', null, false, abort.signal, undefined, { mode: 'task' });
    const before = { counts: f.counts(), commands: f.commands.length, requests: f.requests.length };
    await peer.close();
    assert.throws(() => assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'default'), {
      code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP',
    });
    assert.doesNotThrow(() =>
      assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'aaaaaaaaaaaaaaaa'),
    );
    await assert.rejects(f.service.preview(f.vmId), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    await assert.rejects(
      f.service.apply(f.vmId, {
        action: 'apply',
        version: 1,
        planId: plan.proposal.planId,
        sha256: plan.sha256,
        reviewed: true,
      }),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' },
    );
    assert.deepEqual(
      { counts: f.counts(), commands: f.commands.length, requests: f.requests.length },
      before,
    );
    abort.abort();
    await lease.release();
    assert.doesNotThrow(() =>
      assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'default'),
    );
    const result = await f.service.apply(f.vmId, {
      action: 'apply',
      version: 1,
      planId: plan.proposal.planId,
      sha256: plan.sha256,
      reviewed: true,
    });
    assert.equal(result.plan?.state, 'applied');
  } finally {
    abort.abort();
    await lease?.release();
    await terminals.close();
    await peer.close();
  }
});
test('all pending latch phases block normal and readonly terminal preparation before root tools', async () => {
  const f = await fixture(),
    plan = (await f.service.preview(f.vmId)).plan!,
    terminals = new ProjectTerminals(
      f.machines as unknown as Machines,
      f.workspaces as unknown as Workspaces,
    );
  try {
    for (const phase of ['applying', 'failed', 'directory-applied']) {
      f.setLatch({
        version: 1,
        projectId: 'default',
        planId: plan.proposal.planId,
        sha256: plan.sha256,
        phase,
        identity: plan.proposal.identity,
      });
      const before = f.commands.length;
      await assert.rejects(terminals.prepare(f.vmId, 'default', null), {
        code: 'PROJECT_DIRECTORY_MIGRATION_PENDING',
      });
      await assert.rejects(terminals.prepare(f.vmId, 'default', 'owned', true, undefined, randomUUID()), {
        code: 'PROJECT_DIRECTORY_MIGRATION_PENDING',
      });
      assert.equal(f.commands.length, before + 2);
      for (const command of f.commands.slice(before)) {
        assert.ok(command.includes('project-directory-migrations'));
        assert.doesNotMatch(command, /apk add|apt-get|mkdir -p|tmux new|ip netns/);
      }
      assert.doesNotThrow(() =>
        assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'default'),
      );
    }
  } finally {
    await terminals.close();
  }
});
test('early latch guard fails closed on unknown/malformed state and blocks pending phases', async () => {
  const f = await fixture(),
    preview = await f.service.preview(f.vmId),
    plan = preview.plan!;
  for (const phase of ['applying', 'failed', 'directory-applied', 'unknown']) {
    const latch = {
      version: 1,
      projectId: 'default',
      planId: plan.proposal.planId,
      sha256: plan.sha256,
      phase,
      identity: plan.proposal.identity,
    };
    const transport = { exec: async () => ({ code: 0, stderr: '', stdout: JSON.stringify(latch) }) };
    await assert.rejects(
      assertNoPendingProjectDirectoryMigration(transport, f.vmId, 'default'),
      phase === 'unknown'
        ? { code: 'PROJECT_DIRECTORY_LATCH_CHANGED' }
        : { code: 'PROJECT_DIRECTORY_MIGRATION_PENDING' },
    );
  }
  await assertNoPendingProjectDirectoryMigration(
    { exec: async () => ({ code: 0, stderr: '', stdout: 'null' }) },
    f.vmId,
    'default',
  );
  await assert.rejects(
    assertNoPendingProjectDirectoryMigration(
      { exec: async () => ({ code: 1, stderr: '', stdout: '' }) },
      f.vmId,
      'default',
    ),
    { code: 'PROJECT_DIRECTORY_LATCH_CHANGED' },
  );
});
