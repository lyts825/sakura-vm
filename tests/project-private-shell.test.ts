import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSchema } from '../server/workspaces.ts';
import { projectPrivateShellCommand } from '../server/project-network-isolation.ts';

test('private project shell selects the validated project namespace and rejects shared networking', () => {
  const project = projectSchema.parse({ directory: '/workspace/team work',
    networkIsolation: 'private' });
  const command = projectPrivateShellCommand(project);
  assert.match(command, /ip netns exec sk-default true/);
  assert.match(command, /test "\$\(ip -n sk-default -o -4 route show \| wc -l\)" -eq 0/);
  assert.match(command, /cd '\/workspace\/team work'/);
  assert.match(command, /exec ip netns exec sk-default sh -l$/);
  const second = Object.assign({}, project, { _workspace: '0123456789abcdef' });
  assert.match(projectPrivateShellCommand(second), /exec ip netns exec sk-0123456789abcdef sh -l$/);
  assert.throws(() => projectPrivateShellCommand({ ...project, networkIsolation: 'host' }),
    /未启用私有网络/);
  assert.throws(() => projectPrivateShellCommand({ ...project, _workspace: 'malformed' }),
    /项目 ID 无效/);
});
