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
const { vmDir } = await import('../server/model.ts');
const { projectSchema } = await import('../server/workspaces.ts');
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
    await mkdir(folder, { recursive: true });
    const record = {
      ...basic,
      binding: projectSshBinding(project),
      environment: sha(JSON.stringify([['SAKURA_SCOPE', 'test']])),
      ...(distro === 'alpine' ? { manager: 'openrc' as const } : {}),
      files: {
        ...common,
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
    const service = new ProjectSsh(machines, spaces);
    try {
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
  let replacement: any;
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, instance]]),
    get: () => ({ id, distro }),
    state: () => 'running',
    locked: async (_id: string, action: () => Promise<unknown>) => action(),
    exec: async (_id: string, command: string) => {
      commands.push(command);
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
      if (command.startsWith('setsid sh -c'))
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
  const service = new ProjectSsh(machines, spaces);
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
