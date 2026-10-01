import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
