import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { singleAppFixture } from './single-app-fixture.ts';
import { appIdentity, appCleanupScript } from '../server/single-app-sandbox.ts';
import { projectSchema } from '../server/workspaces.ts';

test('single-app transport retains its original native project/run instead of a caller-selected port or project', async () => {
  const f = await singleAppFixture();
  try {
    const first = await f.apps.start(f.id, { program: 'xterm', args: ['literal $(echo bad)'] });
    const other = await f.workspaces.projects.inScope(f.id, '1234567890abcdef', () => f.apps.start(f.id, { program: 'xterm' }));
    assert.equal(first.networkIsolation, 'private'); assert.equal(other.networkIsolation, 'host');
    assert.equal(other.projectId, '1234567890abcdef');
    const command = await f.apps.connectionCommand(f.id, first.id, first.port);
    assert.match(command, new RegExp('controller.py stream ' + first.id + ' [a-f0-9]{64}$'));
    assert.ok(!command.includes(first.password)); assert.ok(!command.includes('$(echo bad)'));
    assert.doesNotMatch(command, /\bnc\b|\bsu\b|tmux/);
    await assert.rejects(f.apps.connectionCommand(f.id, first.id, other.port), /端口不匹配/);
    assert.ok(first.applicationOwner!.uid < 20000); assert.ok(first.projectOwner!.uid >= 20000);
    assert.notEqual(first.applicationOwner!.uid, first.projectOwner!.uid);
    assert.ok(!('identity' in first) && !('run' in first));
    const launch = f.actions.find(action => action.action === 'start')!;
    assert.deepEqual(launch.environment, { LITERAL: '$(never-run)' });
    assert.deepEqual(launch.origin!.args, ['literal $(echo bad)']);
  } finally { await f.close(); }
});

test('active independent native runs guard their own project config and stop preserves account data', async () => {
  const f = await singleAppFixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' });
    await f.workspaces.projects.inScope(f.id, '1234567890abcdef', () => f.workspaces.save(f.id, { directory: '/other', networkIsolation: 'private' }));
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用/);
    await f.apps.stop(f.id, session.id);
    await f.workspaces.save(f.id, { networkIsolation: 'host' });
    const stopped = f.actions.find(action => action.action === 'stop')!;
    assert.equal(stopped.origin!.run.runId, session.id); assert.equal(stopped.origin!.run.mode, 'independent');
    assert.equal((await f.apps.list(f.id))[0].status, 'stopped'); assert.equal(f.releaseCount(), 1);
    assert.ok(f.commands.every(command => !command.includes('mkdir -p /private') && !command.includes('rm -rf')));
    await f.apps.close(); await f.workspaces.save(f.id, { networkIsolation: 'host' });
  } finally { await f.close(); }
});

test('pause and clipboard tightening close bridges, keep original receipts and deny reconnection', async () => {
  const f = await singleAppFixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' }); let disconnected = 0;
    f.apps.onSessionInvalidated(f.id, session.id, () => disconnected++);
    f.live.status = 'paused'; f.machines.emit('change'); assert.equal(disconnected, 1);
    await assert.rejects(f.apps.port(f.id, session.id)); await assert.rejects(f.apps.stop(f.id, session.id), /先恢复实例/);
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用/);
    f.live.status = 'running'; f.machines.emit('change'); assert.equal(await f.apps.port(f.id, session.id), session.port);
    f.apps.onSessionInvalidated(f.id, session.id, () => disconnected++);
    await f.apps.saveClipboardPolicy(f.id, 'xterm', { copy: false, paste: true }); assert.equal(disconnected, 2);
    await assert.rejects(f.apps.connectionCommand(f.id, session.id, session.port), /规则已收紧/);
    assert.equal((await f.apps.list(f.id))[0].status, 'relaunch-required');
  } finally { await f.close(); }
});

test('missing migrated directory never creates a native run or Root project directory', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.missingDirectory = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /显式准备/);
    assert.deepEqual(f.actions, []); assert.equal((await f.apps.list(f.id)).length, 0);
    assert.ok(f.commands.every(command => !command.includes('mkdir')));
  } finally { await f.close(); }
});

test('legacy UID helper remains portable for explicit desktop compatibility, never accepts Root', () => {
  assert.ok(appIdentity(randomUUID()).user.length <= 32);
  for (const uid of [0, -1, NaN]) assert.throws(() => appCleanupScript(randomUUID(), uid));
  assert.equal(projectSchema.parse({}).directory, '/workspace');
});

test('shutdown serializes each VM and accurately stops every original native run once', async () => {
  const f = await singleAppFixture();
  try {
    const first = await f.apps.start(f.id, { program: 'xterm' }), second = await f.apps.start(f.id, { program: 'xterm' });
    await f.apps.close();
    assert.deepEqual(f.actions.filter(action => action.action === 'stop').map(action => action.id), [first.id, second.id]);
    assert.equal(f.releaseCount(), 2);
  } finally { await f.close(); }
});
