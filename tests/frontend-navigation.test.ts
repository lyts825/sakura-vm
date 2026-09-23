import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSelection } from '../src/keyboard-navigation.ts';
import { workspaceCommandDefinitions } from '../src/workspace-navigation.ts';

const vms = [
  { id: 'alpha-id', name: 'alpha', status: 'running' as const },
  { id: 'beta-id', name: 'beta', status: 'stopped' as const },
  { id: 'paused-id', name: 'paused', status: 'paused' as const },
];

test('command palette selection wraps and supports Home/End without a DOM', () => {
  assert.equal(nextSelection(0, 3, 'ArrowUp'), 2);
  assert.equal(nextSelection(2, 3, 'ArrowDown'), 0);
  assert.equal(nextSelection(1, 3, 'Home'), 0);
  assert.equal(nextSelection(1, 3, 'End'), 2);
  assert.equal(nextSelection(1, 3, 'PageDown'), null);
  assert.equal(nextSelection(0, 0, 'ArrowDown'), null);
});

test('workspace commands expose create, manage, switch, and running workspace actions', () => {
  const commands = workspaceCommandDefinitions({ vms, currentId: 'alpha-id' });
  const byKey = new Map(commands.map((command) => [command.key, command]));

  assert.equal(byKey.get('workspace:create')?.action, 'create');
  assert.deepEqual(byKey.get('workspace:manage')?.target, { page: 'library' });
  assert.equal(byKey.get('workspace:alpha-id:suspend')?.action, 'suspend');
  assert.equal(byKey.get('workspace:alpha-id:stop')?.action, 'stop');
  assert.equal(byKey.get('workspace:alpha-id:config')?.target?.tab, 'config');
  assert.equal(byKey.get('workspace:alpha-id:delete')?.disabled, true);
  assert.deepEqual(byKey.get('workspace:beta-id:switch')?.target, {
    id: 'beta-id',
    page: 'workspace',
  });
});

test('workspace commands follow lifecycle state and retain a discoverable disabled create command', () => {
  const commands = workspaceCommandDefinitions({
    vms,
    currentId: 'beta-id',
    canCreate: false,
    busy: true,
  });
  const byKey = new Map(commands.map((command) => [command.key, command]));

  assert.equal(byKey.get('workspace:create')?.disabled, true);
  assert.equal(byKey.get('workspace:beta-id:start')?.action, 'start');
  assert.equal(byKey.get('workspace:beta-id:start')?.disabled, true);
  assert.equal(byKey.has('workspace:beta-id:stop'), false);
  assert.equal(byKey.get('workspace:beta-id:delete')?.disabled, true);
  assert.equal(
    workspaceCommandDefinitions({ vms, currentId: 'paused-id' }).find(
      (command) => command.key === 'workspace:paused-id:delete',
    )?.disabled,
    true,
  );
  assert.equal(byKey.get('workspace:paused-id:switch')?.title, '切换到 paused');
});
