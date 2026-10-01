import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Machines } from '../server/machines.ts';
import { ProjectMainScope, ProjectServiceScopes, type ProjectMainRecord, type ProjectServiceRecord } from '../server/project-service-scope.ts';
import { projectSchema, Workspaces } from '../server/workspaces.ts';
import { writeStore } from '../server/local-store.ts';
import { scopeIdentityFixture } from './project-scope-identity-fixture.ts';

export function scopeRequest(command: string) {
  const line = command.split('\n').find(value => /^# SAKURA_PROJECT_(MAIN|SERVICE)_REQUEST=/.test(value));
  if (!line) return null;
  return { kind: line.startsWith('# SAKURA_PROJECT_MAIN_') ? 'main' : 'service',
    ...JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) };
}
export async function mainFixture(mode = 'normal') {
  const id = randomUUID(), bootId = randomUUID(), controller = new AbortController();
  const project = projectSchema.parse({ directory: '/workspace', command: 'sleep 600', networkIsolation: 'private',
    environment: { TOKEN: 'owned-main-private-token' }, secrets: { TOKEN: 'main-token' } });
  const state = { main: null as ProjectMainRecord | null, services: new Map<string, ProjectServiceRecord>(),
    machine: 'running', stopAttempts: 0, stopped: 0, commits: 0, prepared: 0, sequence: 0, namespaceRemovals: 0,
    currentBoot: bootId, rebootProbes: 0, rebootBlock: '', rebootProbeFailures: 0 };
  const events: { kind: string; op: string; record?: unknown }[] = [], commands: string[] = [];
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, {}]]), records: new Map([[id, { id, distro: 'alpine' }]]),
    get: () => ({ id, distro: 'alpine' }), state: () => state.machine,
    locked: async (_id: string, action: () => Promise<unknown>) => action(),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      const input = scopeRequest(command);
      if (!input) {
        if (command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
          return { code: 0, stdout: mode === 'legacy' ? 'unmanaged' : 'absent', stderr: '' };
        if (command.startsWith('# SAKURA_PROJECT_RUNTIME_LOG'))
          return { code: 0, stdout: 'owned main application log owned-main-private-token', stderr: '' };
        if (command.startsWith('if ip netns exec') && command.includes('ip netns del')) ++state.namespaceRemovals;
        return { code: 0, stdout: '', stderr: '' };
      }
      const { kind, op } = input;
      events.push({ kind, op, record: input.record });
      const record = () => kind === 'main' ? state.main : state.services.get(input.name) || null;
      const save = (value: ProjectMainRecord | ProjectServiceRecord) => {
        if (value.version === 2) state.main = value;
        else state.services.set(value.name, value);
      };
      const reply = (status: string, value = record()) => ({ code: 0, stdout: JSON.stringify({ status, bootId, record: value }), stderr: '' });
      if (op === 'probe-reboot') {
        ++state.rebootProbes;
        if (state.rebootProbes <= state.rebootProbeFailures) throw new Error('owned-main-private-token reboot connection failed');
        if (state.currentBoot !== input.record.bootId && (state.main || state.rebootBlock))
          return { code: 73, stdout: '', stderr: state.rebootBlock || 'new guest owner exists' };
        return { code: 0, stdout: JSON.stringify({ bootId: state.currentBoot, retired: state.currentBoot !== input.record.bootId }), stderr: '' };
      }
      if (op === 'status') {
        if (kind === 'main' && mode === 'legacy') return reply('unmanaged', null);
        if (kind === 'main' && mode === 'unconfirmed') return { code: 73, stdout: '', stderr: 'owned-main-private-token ownership mismatch' };
        if (kind === 'main' && mode === 'malformed-status') return reply('running', null);
        return reply(record()?.phase === 'running' && kind === 'main' && mode === 'exited' ? 'exited' : record()?.phase || 'absent');
      }
      if (op === 'prepare') {
        const scope = kind === 'main' ? new ProjectMainScope(machines as unknown as Machines, id, project)
          : new ProjectServiceScopes(machines as unknown as Machines, id, project);
        const file = kind === 'main' ? (scope as ProjectMainScope).receipt()
          : (scope as ProjectServiceScopes).receipt(input.name);
        const host = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(host.runId, input.record.runId);
        assert.equal(host.phase, 'intent');
        assert.equal(JSON.stringify(host).includes('owned-main-private-token'), false);
        if (kind === 'main') { assert.equal(host.kind, 'main'); assert.equal('name' in host, false); }
        if (kind === 'main' && mode === 'unavailable')
          return { code: 73, stdout: '', stderr: 'SAKURA_PROJECT_MAIN_SCOPE_UNAVAILABLE: readonly cgroup' };
        const prepared = { ...input.record, phase: 'prepared', inode: '1000' + ++state.sequence };
        save(prepared); ++state.prepared;
        if (kind === 'main' && mode === 'prepare-ack-lost') throw new Error('owned-main-private-token prepare reply lost');
        return reply('prepared', prepared);
      }
      if (op === 'start') {
        const pane = { ...record()!, sessionId: '$' + state.sequence, paneId: '%' + state.sequence,
          panePid: 100 + state.sequence, paneStartTicks: '999' + state.sequence };
        save(pane);
        if (kind === 'main' && mode === 'pane-ack-lost') throw new Error('owned-main-private-token pane reply lost');
        return reply('prepared', pane);
      }
      if (op === 'commit') {
        const file = kind === 'main' ? new ProjectMainScope(machines as unknown as Machines, id, project).receipt()
          : new ProjectServiceScopes(machines as unknown as Machines, id, project).receipt(input.name);
        const host = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(host.inode, record()!.inode); assert.equal(host.panePid, record()!.panePid); assert.equal(host.phase, 'prepared');
        const committed = { ...record()!, phase: 'running' as const };
        save(committed); ++state.commits;
        if (kind === 'main' && mode === 'commit-ack-lost') throw new Error('owned-main-private-token commit reply lost');
        if (kind === 'main' && (mode === 'cancel-after-commit' || mode === 'cancel-cleanup-failed')) controller.abort(new Error('owned cancellation'));
        return reply('running', committed);
      }
      assert.equal(op, 'stop'); ++state.stopAttempts;
      if (kind === 'main' && (mode === 'all-stop-failures' || mode === 'cancel-cleanup-failed' ||
        (mode === 'first-stop-failure' && state.stopAttempts === 1))) throw new Error('owned-main-private-token cleanup connection failed');
      if (kind === 'main' && mode === 'replace-live') {
        machines.live.set(id, {} as NonNullable<ReturnType<Machines['live']['get']>>);
        throw new Error('owned live replacement');
      }
      const actual = record();
      if (actual) {
        for (const key of ['runId', 'bootId', 'scopeName', 'binding'])
          if (actual[key as keyof typeof actual] !== input.record[key]) return { code: 73, stdout: '', stderr: 'owned guest run identity mismatch' };
        for (const key of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'])
          if (input.record[key] !== null && actual[key as keyof typeof actual] !== input.record[key])
            return { code: 73, stdout: '', stderr: 'owned guest pane identity mismatch' };
      }
      const stopped = { ...(actual || input.record), phase: 'stopped' as const };
      save(stopped); ++state.stopped;
      if (kind === 'main' && mode === 'stop-ack-lost' && state.stopAttempts === 1) throw new Error('owned stopped receipt ACK lost');
      return reply('stopped', stopped);
    },
  }) as unknown as Machines;
  const identity = scopeIdentityFixture(machines, project, () => state.currentBoot,
    runId => state.main?.runId === runId ? state.main : [...state.services.values()].find(item => item.runId === runId) || null);
  const scope = new ProjectMainScope(machines, id, project);
  const spaces = new Workspaces(machines, { secrets: { resolve: async () => ({ TOKEN: 'owned-main-private-token' }) } as any });
  await writeStore(spaces.projects.file(id), project);
  return { id, bootId, project, machines, scope, spaces, state, events, commands, controller, identity,
    startMain: async () => {
      const intent = scope.intent(state.currentBoot);
      await scope.persistIntent(intent);
      return scope.start(intent, await identity.payload(id, intent), controller.signal);
    },
    startService: async (services: ProjectServiceScopes, record: ProjectServiceRecord) => {
      await services.persistIntent(record);
      return services.start(record, await identity.payload(id, record, { command: 'sleep 600' }), controller.signal);
    },
    saveConfig: async (value: unknown) => writeStore(spaces.projects.file(id), value) };
}
