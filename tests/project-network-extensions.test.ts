import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema } from '../server/workspaces.ts';
import { RuntimeVersions } from '../server/runtime-versions.ts';
import { Toolchains } from '../server/toolchains.ts';
import { Ide } from '../server/ide.ts';

test('private project probes stay in its namespace and SSH has no shared fallback before project setup', async () => {
  const project = projectSchema.parse({ directory: '/workspace/private', networkIsolation: 'private' });
  const commands: string[] = [];
  const machines = {
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('SAKURA_PROJECT_SSH_STATUS'))
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
      return { code: 0, stdout: 'v1.2.3\nSAKURA_PYTHON\nPython 3.11.0\n', stderr: '' };
    },
    get: () => ({ name: 'test-vm', distro: 'debian' }),
    state: () => 'running',
    records: new Map(),
    on: () => {},
    off: () => {},
  } as unknown as Machines;
  const workspaces = {
    config: async () => project,
    save: async () => project,
    onConfigChange: () => () => {},
    projects: {
      key: () => 'project-key',
      inScope: (_id: string, _project: string, action: () => unknown) => action(),
    },
  } as unknown as Workspaces;
  const runtimes = new RuntimeVersions(machines, workspaces);
  const tools = new Toolchains(machines, workspaces);
  const ide = new Ide(machines, workspaces, tmpdir());
  try {
    assert.equal((await runtimes.inspect('vm', project)).node, '1.2.3');
    await runtimes.select('vm', { node: '1.2.3' });
    await tools.view('vm');
    assert.equal(commands.length, 3);
    for (const command of commands) {
      assert.match(command, /ip netns exec sk-default true/);
      assert.match(command, /ip netns exec sk-default sh -lc/);
    }
    const view = await ide.view('vm');
    assert.equal(view.supported, true);
    assert.ok('projectScoped' in view && view.projectScoped);
    assert.ok('runtime' in view && !view.runtime?.valid);
    assert.equal(view.command, '');
    assert.equal(view.url, '');
    assert.ok('sshCommand' in view && view.sshCommand === '');
  } finally {
    await Promise.all([runtimes.close(), tools.close(), ide.close()]);
  }
});
