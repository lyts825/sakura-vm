import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Project, Workspaces as WorkspacesType } from '../server/workspaces.ts';
import type { ProjectDesktopRecord } from '../server/project-service-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-desktop-uid-model-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
const { ProjectDesktops } = await import('../server/desktop-project.ts');
const { ProjectDesktopScope } = await import('../server/project-service-scope.ts');
const { DesktopBindings, projectDesktopBindingSchema } = await import('../server/desktop-binding.ts');
const { desktopProjectCommand, desktopAdapterSource } = await import('../server/desktop-project-control.ts');
const { desktopUidCommand, desktopProjectPrepare, desktopProjectEnvironment, desktopProjectImePrepare, desktopProjectImeCommand } = await import('../server/desktop-guest.ts');
const { projectIdentityPayload } = await import('../server/project-identity.ts');
const { assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
const { vmDir, AppError } = await import('../server/model.ts');
const { defaultDesktopPreferences } = await import('../server/desktop-preferences.ts');
const { scopeIdentityFixture } = await import('./project-scope-identity-fixture.ts');
after(() => rm(root, { recursive: true, force: true }));
const extractRequest = (command: string) => {
  const line = command.split('\n').find(line => line.startsWith('# SAKURA_PROJECT_SERVICE_REQUEST='));
  return line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null;
};

export async function fixture(t: TestContext, mode = '') {
  const id = randomUUID(), boot = randomUUID(), live = { status: 'running', startedAt: 'desktop-model-live' };
  const machineLocks = new Machines({} as any), owner = { record: null as ProjectDesktopRecord | null, inode: null as string | null };
  const state = { boot, stopFailures: 0, guardFailure: false, cleanupFailure: false, probeFailure: false,
    endpointDrift: false, stopCalls: 0, killed: 0, neighbor: true, detached: false, installed: true,
    preparations: 0, beforePrepare: undefined as ((signal?: AbortSignal) => Promise<void>) | undefined, entered: [] as string[], commands: [] as string[], probes: 0, onProbe: undefined as (() => Promise<void>) | undefined,
    onCommit: undefined as (() => void) | undefined, beforeResolve: undefined as (() => Promise<void>) | undefined };
  const records = new Map<string, ProjectDesktopRecord>();
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { id, distro: 'alpine', memoryMiB: 2048, snapshots: [] }]]),
    live: new Map([[id, live]]), get: () => ({ id, distro: 'alpine', memoryMiB: 2048, snapshots: [] }),
    state: () => machines.live.get(id)?.status || 'stopped', closing: false, requireUnlocked() {},
    locked: machineLocks.locked.bind(machineLocks),
    exec: async (_id: string, command: string, _timeout?: number, signal?: AbortSignal) => {
      signal?.throwIfAborted(); state.commands.push(command);
      const request = extractRequest(command);
      if (!request) {
        if (command.startsWith('# SAKURA_GUEST_TASK_RUN') && command.includes('apk add')) {
          ++state.preparations; await state.beforePrepare?.(signal); state.installed = true;
          return { code: 0, stdout: '', stderr: '' };
        }
        if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS')) return { code: 0, stdout: 'absent', stderr: '' };
        if (command.startsWith('if [ ! -f /etc/sakura/desktop-version ]')) return { code: 0, stdout: 'stopped', stderr: '' };
        if (command.includes('sakura-desktop-project-version')) return { code: state.installed ? 0 : 1, stdout: '', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      }
      assert.equal(request.namespace, 'desktop');
      assert.match(request.guest, /^\/run\/sakura-project-desktop\/(default|[a-f0-9]{16})$/);
      const reply = (status: string, record: ProjectDesktopRecord | null) => ({ code: 0,
        stdout: JSON.stringify({ status, bootId: state.boot, record }), stderr: '' });
      if (request.op === 'probe-reboot') return { code: owner.record && owner.record.bootId !== state.boot ? 73 : 0,
        stdout: JSON.stringify({ bootId: state.boot, retired: state.boot !== request.record.bootId }), stderr: '' };
      if (request.op === 'status') {
        if (owner.record && owner.inode !== owner.record.inode) return { code: 73, stdout: '', stderr: 'exact cgroup inode replaced' };
        return reply(owner.record?.phase || 'absent', owner.record);
      }
      const intent = request.record as ProjectDesktopRecord;
      const process = new ProjectDesktopScope(machines as unknown as MachinesType, id,
        { template: 'none', directory: '/workspace/alpha', repository: '', setup: '', command: '', _workspace: intent.projectId });
      if (request.op === 'prepare') {
        const saved = JSON.parse(await readFile(process.receipt(), 'utf8'));
        assert.equal(saved.phase, 'intent'); assert.equal(saved.runId, intent.runId);
        owner.record = { ...intent, phase: 'prepared', inode: '223344' }; owner.inode = owner.record.inode;
        records.set(intent.runId, owner.record);
        if (mode === 'prepare-ack-lost') throw new Error('native-independent prepare ACK lost');
        return reply('prepared', owner.record);
      }
      if (request.op === 'start') {
        assert.equal(owner.record?.runId, intent.runId);
        owner.record = { ...owner.record!, sessionId: '$1', paneId: '%1', panePid: 3456, paneStartTicks: '78901' };
        records.set(intent.runId, owner.record);
        if (mode === 'pane-ack-lost') throw new Error('pane ACK lost');
        return reply('prepared', owner.record);
      }
      if (request.op === 'commit') {
        fixtureProject._workspace = intent.projectId;
        const saved = JSON.parse(await readFile(process.receipt(), 'utf8'));
        assert.equal(saved.panePid, owner.record!.panePid); assert.equal(saved.inode, owner.record!.inode);
        owner.record = { ...owner.record!, phase: 'running' }; records.set(intent.runId, owner.record);
        state.detached = true; state.onCommit?.();
        if (mode === 'commit-ack-lost') throw new Error('commit ACK lost after issuance');
        return reply('running', owner.record);
      }
      assert.equal(request.op, 'stop'); ++state.stopCalls;
      if (state.stopFailures-- > 0) throw new Error('independent exact cleanup connection lost');
      if (owner.record && (owner.record.runId !== intent.runId || owner.inode !== owner.record.inode ||
          intent.inode !== null && intent.inode !== owner.record.inode))
        return { code: 73, stdout: '', stderr: 'replacement domain refused' };
      const stopped = { ...(owner.record || intent), phase: 'stopped' as const };
      if (state.detached) { ++state.killed; state.detached = false; }
      records.set(intent.runId, stopped); owner.record = stopped; owner.inode = stopped.inode;
      if (mode === 'stop-ack-lost' && state.stopCalls === 1) throw new Error('full group gone; stop ACK lost');
      return reply('stopped', stopped);
    },
  }) as unknown as MachinesType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines, { secrets: { resolve: async () => ({ TOKEN: 'desktop-secret-雪' }) } as any });
  const alpha = (await workspaces.projects.create(id, '原项目', async () => {
    await workspaces.save(id, { directory: '/workspace/alpha', networkIsolation: 'private', secrets: { TOKEN: 'key' },
      environment: { HOME: '/root', DISPLAY: ':99', BASH_ENV: 'desktop-hook-$(id)' } });
  })).active;
  const beta = (await workspaces.projects.create(id, '邻居项目', async () => {
    await workspaces.save(id, { directory: '/workspace/beta', networkIsolation: 'host' });
  })).active;
  const config = await workspaces.projects.with(id, alpha, () => workspaces.config(id));
  assert.equal(Object.getOwnPropertyDescriptor(config, '_workspace')!.enumerable, false);
  const fixtureProject = { ...config };
  Object.defineProperty(fixtureProject, '_workspace', { value: alpha, enumerable: false, writable: true });
  const identity = scopeIdentityFixture(machines, fixtureProject, () => state.boot, runId => records.get(runId) || null);
  const endpoint = { plasmaPid: 1234, plasmaCreated: '5678', vncPid: 4321, vncCreated: '8765', runtimeDevice: '12',
    runtimeInode: '1234', xauthDevice: '12', xauthInode: '2345', xauthSha256: 'b'.repeat(64), readyDevice: '12', readyInode: '3456' };
  const ensureIdentity = identity.ensure;
  identity.ensure = async (...args) => {
    const value = await ensureIdentity(...args);
    if (value.projectId === beta) { value.uid = 20002; value.gid = 20002; }
    return value;
  };
  const bindings = new DesktopBindings(machines);
  const options: NonNullable<ConstructorParameters<typeof ProjectDesktops>[2]> = { build: async () => 'a'.repeat(64), readyTimeoutMs: 2000,
    control: async (_machines, _id, op, proof) => {
      state.entered.push(op);
      assert.ok([alpha, beta].includes(proof.identity.projectId)); assert.equal(proof.identity.uid, proof.identity.projectId === alpha ? 20001 : 20002);
      assert.equal(proof.runtime, '/run/sakura-desktop-uid/' + proof.identity.uid + '/' + proof.record.runId);
      assert.ok(Buffer.byteLength(proof.runtime + '/wayland-0') < 108);
      assert.ok(!JSON.stringify(proof).includes('desktop-secret'));
      if (op === 'guard') { assert.equal(proof.run, null); if (state.guardFailure) throw new AppError('guard partial publication', 409, 'DESKTOP_SCOPE_CHANGED'); }
      if (op === 'probe') {
        ++state.probes; await state.onProbe?.();
        if (state.probeFailure || state.endpointDrift) throw new AppError('original Plasma/cookie changed', 409, 'DESKTOP_SCOPE_CHANGED');
        assert.ok(proof.run); assert.equal(proof.run.cgroupInode, proof.record.inode);
        assert.equal(proof.run.bootId, proof.record.bootId); assert.equal(proof.run.cgroupName, proof.record.scopeName);
        assert.deepEqual(proof.run, identity.tickets.get(proof.record.runId));
        if (proof.endpoint) assert.deepEqual(proof.endpoint, endpoint);
        return { endpoint };
      }
      if (op === 'unguard') {
        if (state.cleanupFailure) throw new AppError('guard retirement uncertain', 503, 'DESKTOP_CLEANUP_FAILED');
        assert.ok(!state.detached); assert.ok(!identity.tickets.get(proof.record.runId) || identity.tickets.get(proof.record.runId)!.phase === 'closed');
      }
      return { guarded: op !== 'unguard' };
    } } satisfies ConstructorParameters<typeof ProjectDesktops>[2];
  const manager = new ProjectDesktops(machines, workspaces, options);
  const pins = { projectId: alpha, live: live as unknown as NonNullable<ReturnType<MachinesType['live']['get']>> };
  const start = (controller = new AbortController(), input?: any, action: 'start' | 'configure' | 'install' | 'ime' = 'start') =>
    manager.start(id, action, input, pins, controller.signal, () => {}, () => {});
  const originalResolve = workspaces.resolveProject.bind(workspaces);
  workspaces.resolveProject = async (...args) => { await state.beforeResolve?.(); return originalResolve(...args); };
  t.after(async () => { await workspaces.close(); });
  return { id, boot, live, alpha, beta, owner, state, records, machines, workspaces, config, identity, endpoint, bindings, manager, options, pins, start };
}

export { projectVersion, ProjectDesktops, ProjectDesktopScope, DesktopBindings, projectDesktopBindingSchema, desktopProjectCommand, desktopAdapterSource, desktopUidCommand, desktopProjectPrepare, desktopProjectEnvironment, desktopProjectImePrepare, desktopProjectImeCommand, projectIdentityPayload, assertProjectTerminalsStopped, vmDir, AppError, defaultDesktopPreferences };
