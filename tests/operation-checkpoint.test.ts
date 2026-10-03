import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Principal } from '../server/access-control.ts';

test('full committed permission checkpoints never reacquire a held metadata writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-operation-checkpoint-'));
  process.env.SAKURA_DATA_DIR = directory;
  const { ProjectPermissions } = await import('../server/project-permissions.ts');
  const { Workspaces } = await import('../server/workspaces.ts');
  const { projectSchema } = await import('../server/project-config.ts');
  const { writeStore } = await import('../server/local-store.ts');
  const { serializedMetadata } = await import('../server/metadata-queue.ts');
  const { vmDir } = await import('../server/paths.ts');
  const vmId = 'd2f574eb-44c5-40b8-a2ac-581b56cb4a12', other = '1234567890abcdef';
  const principal: Principal = { id: '5b880585-3986-4ed7-a6da-f5e54e2d615d', username: 'member',
    role: 'member', vmIds: [], expiresAt: Date.now() + 60_000 };
  const machines = Object.assign(new EventEmitter(), { records: new Map([[vmId, { name: 'test' }]]),
    live: new Map(), get: () => ({ name: 'test', template: 'none' }), state: () => 'stopped' }) as unknown as Machines;
  const workspaces = new Workspaces(machines);
  const file = join(directory, 'permissions.json');
  const permissions = new ProjectPermissions({ users: () => [principal] } as any, machines, workspaces, file);
  try {
    await mkdir(vmDir(vmId), { recursive: true });
    await writeStore(join(vmDir(vmId), 'projects.json'), { active: 'default', projects: [
      { id: 'default', name: 'Default' }, { id: other, name: 'Other' },
    ] });
    await writeStore(join(vmDir(vmId), 'project.json'), projectSchema.parse({ directory: '/work/default' }));
    await writeStore(join(vmDir(vmId), `project-${other}.json`), projectSchema.parse({ directory: '/work/other' }));
    await permissions.init();
    await permissions.configure(vmId, 'default', { roles: [{ id: 'reader', name: 'Read', permissions: ['read'] }],
      grants: [{ accountId: principal.id, roleId: 'reader' }] });
    await permissions.require(principal, vmId, 'default', 'read');
    const checkpoint = serializedMetadata(join(vmDir(vmId), 'projects.json'), true, () =>
      serializedMetadata(join(vmDir(vmId), 'project.json'), true, async () => {
        await permissions.requireCommitted(principal, vmId, 'default', 'read');
        await assert.rejects(permissions.requireCommitted(principal, vmId, 'default', 'write'), { status: 403 });
      }));
    await checkpoint;
    // Read committed config still checks every project's directory isolation, not just cached role bits.
    await writeStore(join(vmDir(vmId), `project-${other}.json`), projectSchema.parse({ directory: '/work/default/nested' }));
    await assert.rejects(permissions.requireCommitted(principal, vmId, 'default', 'read'), /重叠/);
    await writeStore(join(vmDir(vmId), `project-${other}.json`), projectSchema.parse({ directory: '/work/other' }));
    await permissions.configure(vmId, 'default', { roles: [{ id: 'reader', name: 'Read', permissions: ['read'] }], grants: [] });
    await assert.rejects(permissions.requireCommitted(principal, vmId, 'default', 'read'), { status: 403 });
  } finally {
    await permissions.close(); await workspaces.close();
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('sakura-operation-checkpoint-'));
    await rm(directory, { recursive: true, force: true });
  }
});
