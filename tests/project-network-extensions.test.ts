import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { RuntimeVersions } from '../server/runtime-versions.ts';
import { runtimeEnvironment } from '../server/runtime-config.ts';
import { randomUUID } from 'node:crypto';
import { Toolchains } from '../server/toolchains.ts';
import { Ide } from '../server/ide.ts';

test('private project probes stay in its namespace and SSH has no shared fallback before project setup', async () => {
  const project = projectSchema.parse({ directory: '/workspace/private', networkIsolation: 'private' });
  const commands: string[] = [];
  const identityProjects: typeof project[] = [];
  const machines = {
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('SAKURA_RUNTIME_INSTALL')) return { code: 0, stderr: '', stdout: JSON.stringify({
        version: 1, ok: true, result: { version: 1, tool: 'node', architecture: 'x86_64', requestedVersion: '1.2.3', phase: 'ready',
          installId: randomUUID(), directoryDevice: '1', directoryInode: '2', executableDevice: '1',
          executableInode: '3', executableSha256: 'a'.repeat(64) },
      }) };
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
    live: new Map([['vm', { status: 'running' }]]),
    locked: async (_id: string, action: () => Promise<unknown>) => action(),
    records: new Map(),
    on: () => {},
    off: () => {},
  } as unknown as Machines;
  const workspaces = {
    config: async () => project,
    resolveProject: async (_id: string, candidate: typeof project) => ({ ...candidate,
      environment: runtimeEnvironment(candidate.runtimes, candidate.environment?.PATH) }),
    save: async () => project,
    onConfigChange: () => () => {},
    projects: {
      key: () => 'project-key',
      current: () => 'default',
      inScope: (_id: string, _project: string, action: () => unknown) => action(),
    },
  } as unknown as Workspaces;
  const runtimes = new RuntimeVersions(machines, workspaces, { runTask: async (_machines, _id, candidate) => {
    identityProjects.push(candidate);
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, bootId: randomUUID(),
      declared: {}, actual: { node: '1.2.3', python: '3.11.0' } }) };
  } });
  const tools = new Toolchains(machines, workspaces, {
    createPreparation: () => ({ prepare: async (_id, scope, _session, _readOnly, signal, _terminalId, mode) => {
      assert.deepEqual(mode, { mode: 'task' });
      return { command: '', projectId: scope!, networkIsolation: 'private', terminalId: undefined, signal: signal!,
        captured: { project, configVersion: projectVersion(project), live: machines.live.get('vm')! }, release: () => {} };
    }, close: async () => {} }),
    runTask: async (_machines, _id, candidate, execution, _signal, _log, timeout, _agent, _cleanup, pins) => {
      identityProjects.push(candidate);
      assert.equal(timeout, 20000);
      assert.equal(pins?.expectedLive, machines.live.get('vm'));
      assert.ok(!execution.command.includes('ip netns exec'));
      assert.match(execution.command, /test ! -e 'package.json'/);
      return { code: 0, stderr: '', stdout: '\nSAKURA_TOOL_node\nv1.2.3\nSAKURA_REQUIRED_node\nyes\n' };
    },
  });
  const ide = new Ide(machines, workspaces, tmpdir());
  try {
    assert.equal((await runtimes.inspect('vm', project)).node, '1.2.3');
    await runtimes.select('vm', { node: '1.2.3' });
    assert.equal((await tools.view('vm')).tools.find(tool => tool.id === 'node')?.required, true);
    assert.equal(identityProjects.length, 3);
    for (const candidate of identityProjects) assert.equal(candidate.networkIsolation, 'private');
    assert.equal(commands.length, 1);
    // Root only verifies the fixed runtime install receipt. Toolchain versions
    // and project markers now use the same project UID task boundary.
    assert.match(commands[0], /SAKURA_RUNTIME_INSTALL/);
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
