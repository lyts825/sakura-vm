import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Machines } from '../../server/machines.ts';
import { projectSchema, projectVersion, type Project, type Workspaces } from '../../server/workspaces.ts';
import type { ProjectTerminals } from '../../server/project-terminals.ts';
import { projectIdentityPayload } from '../../server/project-identity.ts';
import type { SyscallProjectTaskOptions } from '../../server/syscall-project-task.ts';
import { runSyscallProfile } from '../../server/syscall-profile.ts';

export const syscallVmId = '11111111-1111-4111-8111-111111111111';
export const syscallProjectId = '0123456789abcdef';
export const copySyscallProject = (project: Project, scope = project._workspace) =>
  Object.defineProperty(structuredClone(project), '_workspace', { value: scope, enumerable: false });

export function syscallIdentityFixture(networkIsolation: 'host' | 'private' = 'private') {
  const context = new AsyncLocalStorage<string>(), live = {}, abort = new AbortController();
  let outside = syscallProjectId, forced: string | undefined, state = 'running';
  let leaseOpen = false, releases = 0, closes = 0, resolves = 0;
  const project = copySyscallProject(projectSchema.parse({ directory: '/workspace/limited', networkIsolation,
    environment: { MODE: 'original', PATH: '/workspace/tools' }, secrets: { TOKEN: 'seccomp-key' } }), syscallProjectId);
  const rootCommands: string[] = [], events: string[] = [];
  const launches: Parameters<NonNullable<SyscallProjectTaskOptions['runProjectTask']>>[] = [];
  const machines = {
    live: new Map([[syscallVmId, live]]), state: () => state, get: () => ({ distro: 'alpine' }),
    requireUnlocked: () => {}, locked: async (_id: string, action: () => unknown) => action(),
    exec: async (_id: string, command: string) => {
      rootCommands.push(command); events.push('admin-status'); return { code: 0, stdout: '', stderr: '' };
    },
    execInput: async () => { throw new Error('Unexpected direct root input command'); },
    writeGuestFile: async () => { throw new Error('Unexpected administrator project file write'); },
  } as unknown as Machines;
  const workspaces = {
    projects: {
      current: () => forced || context.getStore() || outside,
      inScope: (_id: string, scope: string, action: () => unknown) => context.run(scope, action),
      with: async (_id: string, scope: string, action: () => unknown) => context.run(scope, action),
    },
    config: async () => copySyscallProject(project),
    resolvedConfig: async () => { throw new Error('Selected config must not be reread'); },
    resolveProject: async (_id: string, captured: Project) => {
      ++resolves; assert.equal(captured._workspace, syscallProjectId);
      assert.equal(projectVersion(captured), projectVersion(project));
      return copySyscallProject({ ...captured, environment: { ...captured.environment, TOKEN: 'seccomp-private-value' } }, captured._workspace);
    },
  } as unknown as Workspaces;
  const manager: Pick<ProjectTerminals, 'prepare' | 'close'> = {
    prepare: async (_id, scope, session, readOnly, signal, _terminalId, mode) => {
      assert.equal(scope, syscallProjectId); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(mode, { mode: 'task' }); signal?.throwIfAborted(); leaseOpen = true; events.push('prepare');
      return { command: 'unused', projectId: syscallProjectId, networkIsolation, terminalId: undefined,
        signal: signal!, captured: { project: copySyscallProject(project), configVersion: projectVersion(project), live: live as any },
        release: () => { leaseOpen = false; ++releases; events.push('release'); } };
    },
    close: async () => { ++closes; events.push('close'); assert.equal(leaseOpen, false); },
  };
  const options: SyscallProjectTaskOptions = {
    createPreparation: () => manager,
    runProjectTask: async (...args) => {
      const [transport, vmId, captured, execution, signal, log, timeout, agentPath, afterCleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(vmId, syscallVmId); assert.equal(captured._workspace, syscallProjectId);
      assert.ok(leaseOpen); assert.equal(projectVersion(captured), projectVersion(project));
      assert.equal(signal.aborted, false); assert.ok(timeout! >= 16000 && timeout! <= 315000);
      assert.equal(pins?.expectedLive, live); assert.equal(log, undefined); assert.equal(agentPath, undefined); assert.equal(afterCleanup, undefined);
      projectIdentityPayload(execution); launches.push(args); events.push('uid-start');
      events.push('domain-stopped'); events.push('native-closed');
      return { code: 7, stdout: 'seccomp-private-value output', stderr: 'seccomp-private-value' };
    },
  };
  const run = (input: unknown = { mode: 'run', command: 'printf', args: ['UID_TEST_MARKER'], confirmed: true }, signal = abort.signal) =>
    runSyscallProfile(machines, syscallVmId, input, signal, workspaces, options);
  return { machines, workspaces, manager, options, run, project, live, abort, rootCommands, launches, events,
    leaseOpen: () => leaseOpen, releases: () => releases, closes: () => closes, resolves: () => resolves,
    switchOutside: () => { outside = 'fedcba9876543210'; }, forceScope: () => { forced = 'fedcba9876543210'; },
    setState: (value: string) => { state = value; } };
}
