import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PassThrough, type Duplex } from 'node:stream';
import { AppError, DATA } from '../server/model.ts';
import { projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import { projectIdentityPayload, projectIdentitySchema, projectIdentityRunSchema,
  type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';
import { projectReverseTunnelRecordSchema, type ProjectReverseTunnelRecord } from '../server/project-service-scope.ts';
import type { Machines } from '../server/machines.ts';
import type { ReverseTunnelOptions } from '../server/reverse-tunnels.ts';

export async function reverseTunnelIdentityOptions(t: { after: (action: () => Promise<unknown>) => void },
  machines: Machines, workspaces: Workspaces) {
  await mkdir(DATA, { recursive: true }); const directory = await mkdtemp(join(DATA, 'reverse-tunnel-unit-'));
  t.after(async () => { const owned = await realpath(directory);
    assert.equal(dirname(owned), await realpath(DATA)); assert.match(basename(owned), /^reverse-tunnel-unit-/);
    await rm(owned, { recursive: true, force: true }); });
  const file = join(directory, 'tunnels.json'), registryId = randomUUID();
  const records = new Map<string, ProjectReverseTunnelRecord>(), tickets = new Map<string, ProjectIdentityRun>(),
    identities = new Map<string, ProjectIdentity>(), hashes = new Map<string, string>(), members = new Map<string, Set<number>>();
  const held = new Map<string, number>(), events: string[] = [], executions: { project: Project; command: string; environment?: Record<string, string> }[] = [],
    frames: Buffer[] = [], rootLaunches: string[] = [], proofCalls: string[] = [], bridges: Parameters<NonNullable<ReverseTunnelOptions['bridge']>>[] = [];
  const state = { bootId: randomUUID(), cleanupFailures: 0, releaseFailures: 0, closeFailures: 0,
    starts: 0, preparations: 0, releases: 0, closes: 0, resolutions: 0, probeCode: 0, probeStderr: '',
    identityFailure: false, activeFailure: false, listenerChanged: false, missingListener: false, coldBootBlocked: false,
    taskHook: undefined as (() => Promise<void>) | undefined,
    proofHook: undefined as (() => Promise<void>) | undefined,
    bridgeHook: undefined as (() => Promise<void>) | undefined };
  const binding = (project: Project) => project._workspace || 'default';
  const clone = (project: Project) => Object.defineProperty(structuredClone(project), '_workspace',
    { value: project._workspace, enumerable: false });
  const assertHeld = (project: Project) => assert.ok(held.get(binding(project)), 'original preparation must remain held');
  const identity = (project: Project) => {
    const key = binding(project); let account = identities.get(key);
    if (!account) { const identityId = randomUUID(), uid = 21000 + identities.size;
      account = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId, identityId, projectId: key,
        revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid, gid: uid,
        home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory,
        homeDevice: '12', homeInode: String(uid + 1), directoryDevice: '12', directoryInode: String(uid + 2),
        networkIsolation: project.networkIsolation || 'host' }); identities.set(key, account); }
    assert.equal(account.directory, project.directory); assert.equal(account.networkIsolation, project.networkIsolation || 'host'); return account;
  };
  const options: ReverseTunnelOptions = {
    file,
    createPreparation: () => {
      let selected = '', released = false; ++state.preparations;
      return {
        prepare: async (id, scope, session, readOnly, signal, _terminalId, mode) => {
          assert.equal(session, null); assert.equal(readOnly, false);
          assert.ok(mode?.mode === 'task' && (!mode.verifyOnly || mode.verifyOnly === true));
          assert.equal(typeof scope, 'string'); if (typeof scope !== 'string') throw new Error('missing explicit project');
          signal?.throwIfAborted(); selected = scope; const project = clone(await workspaces.config(id)), live = machines.live.get(id)!;
          assert.equal(binding(project), scope); held.set(scope, (held.get(scope) || 0) + 1); events.push(scope + ':prepare');
          return { command: 'unused root terminal command', projectId: scope, terminalId: undefined, networkIsolation: project.networkIsolation || 'host',
            signal: signal!, captured: { project, configVersion: projectVersion(project), live }, release: async () => {
              if (state.releaseFailures > 0) { --state.releaseFailures; throw new Error('network lease release failed'); }
              if (released) return; released = true; held.set(scope, held.get(scope)! - 1); ++state.releases; events.push(scope + ':release'); } };
        },
        close: async () => { if (state.closeFailures > 0) { --state.closeFailures; throw new Error('preparation close failed'); }
          assert.equal(released || !selected, true); ++state.closes; events.push(selected + ':close'); },
      };
    },
    runTask: async (...args) => {
      const [transport, id, project, execution, signal, _log, timeout, _agent, _cleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(timeout, 10000); assert.equal(pins?.expectedLive, machines.live.get(id));
      assertHeld(project); signal.throwIfAborted(); projectIdentityPayload(execution);
      executions.push({ project: clone(project), ...execution }); events.push(binding(project) + ':uid-probe');
      const guest = machines as unknown as { commands?: string[]; hanging?: boolean };
      guest.commands?.push(execution.command); if (guest.hanging) await delay(60000, undefined, { signal });
      await state.taskHook?.(); signal.throwIfAborted(); events.push(binding(project) + ':task-full-domain-stopped');
      return { code: state.probeCode, stdout: '', stderr: state.probeStderr };
    },
    scopes: {
      identity: async (_id, project, signal) => { signal?.throwIfAborted(); assertHeld(project);
        if (state.identityFailure) throw new AppError('explicit project directory migration required', 409, 'PROJECT_DIRECTORY_MIGRATION_REQUIRED');
        events.push(binding(project) + ':identity'); return identity(project); },
      inherited: async (_id, project, execution, owner, signal) => {
        signal?.throwIfAborted(); assertHeld(project); assert.equal(owner.kind, 'service');
        const account = identity(project), payload = projectIdentityPayload(execution); frames.push(payload.input);
        executions.push({ project: clone(project), ...execution }); events.push(binding(project) + ':native-intent');
        const command = 'fixed-native-entry --run ' + owner.runId; rootLaunches.push(command);
        return { ...payload, command, runId: owner.runId, identity: account };
      },
      active: async (_id, _projectId, runId, signal) => { signal?.throwIfAborted(); return !state.activeFailure && tickets.get(runId)?.phase === 'active'; },
      readonlyActive: async (_id, projectId, runId, signal) => { signal?.throwIfAborted(); proofCalls.push(projectId + ':' + runId);
        return tickets.get(runId)?.phase === 'active' && tickets.get(runId)?.projectId === projectId; },
    },
    identities: { runReadonly: async (_id, account, runId, signal) => { signal?.throwIfAborted(); const run = tickets.get(runId);
      if (!run || run.projectId !== account.projectId || run.bootId !== state.bootId) throw new AppError('old native ticket changed', 409);
      return structuredClone(run); } },
    processScope: (_id, project, duration) => {
      const key = binding(project); let expiration: string | undefined;
      return {
        status: async (signal, expectedHash) => { signal?.throwIfAborted(); await state.proofHook?.(); const record = records.get(key) || null;
          if (expectedHash && (!record || hashes.get(record.runId) !== expectedHash)) throw new AppError('transport changed', 409);
          return { status: !record ? 'absent' : record.phase === 'running' ? 'running' : record.phase === 'stopped' ? 'stopped' : 'prepared',
            bootId: state.bootId, record: record && structuredClone(record) }; },
        newIntent: (binding, bootId) => { const runId = randomUUID(); return projectReverseTunnelRecordSchema.parse({ version: 1,
          name: 'reverse-tunnel', projectId: key, session: 'sakura-reverse-tunnel-' + key, runId, bootId,
          scopeName: 'sakura-service-' + runId, binding, phase: 'intent', inode: null,
          sessionId: null, paneId: null, panePid: null, paneStartTicks: null }); },
        persistIntent: async record => { const row = (JSON.parse(await readFile(file, 'utf8')).sessions as any[]).find(row => row.projectId === key);
          assert.deepEqual(row.execution.record, record); assert.equal(row.execution.run, null); assert.equal(row.phase, 'starting');
          records.set(key, record); events.push(key + ':outer-intent'); },
        start: async (intent, payload, signal) => {
          signal.throwIfAborted(); assertHeld(project); ++state.starts;
          const account = identity(project), record: ProjectReverseTunnelRecord = { ...intent, phase: 'running', inode: '900',
            sessionId: '$10', paneId: '%22', panePid: 1234, paneStartTicks: '987' };
          records.set(key, record); hashes.set(record.runId, payload.sha256); members.set(record.runId, new Set([1234, 5555, 5556]));
          tickets.set(record.runId, projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-current',
            registryId, identityId: account.identityId, projectId: key, runId: record.runId, revision: 1,
            bootId: state.bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '500',
            cgroupDevice: '29', cgroupInode: record.inode, cgroupName: record.scopeName,
            namespace: account.networkIsolation === 'private' ? 'sk-' + key : '' }));
          assert.ok(duration); expiration = new Date(Date.now() + duration! * 1000).toISOString();
          events.push(key + ':broker-start'); return record;
        },
        stop: async original => {
          events.push(key + ':stop-attempt');
          if (state.cleanupFailures > 0) { --state.cleanupFailures; throw new AppError('original full domain still populated', 503, 'SERVICE_CLEANUP_FAILED'); }
          if (original.bootId !== state.bootId && state.coldBootBlocked) throw new AppError('new boot owns reused service label', 503, 'SERVICE_CLEANUP_FAILED');
          const known = records.get(key);
          if (known) { assert.equal(known.runId, original.runId); assert.equal(known.binding, original.binding);
            for (const field of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
              if (original[field] !== null && known[field] !== null) assert.equal(known[field], original[field]); }
          members.delete(original.runId); events.push(key + ':full-domain-absent');
          const run = tickets.get(original.runId); if (run) tickets.set(run.runId, { ...run, phase: 'closed' });
          events.push(key + ':native-ticket-retired'); records.set(key, { ...(known || original), phase: 'stopped' });
        },
        expiresAt: () => expiration,
      };
    },
    listener: async (account, run, signal) => { signal?.throwIfAborted(); if (state.missingListener) return null;
      return { port: 23000 + account.uid - 21000, pid: state.listenerChanged ? 9999 : 1234, startTicks: '987', socketInode: '888' }; },
    bridge: async (...args) => { bridges.push(args); args[4].throwIfAborted(); await args[5](); await state.bridgeHook?.();
      const guest = machines as unknown as { openGuestTcpStream?: (id: string, port: number, signal: AbortSignal, project: Project) => Promise<Duplex> };
      const account = args[2].identity, project = Object.defineProperty({ directory: account.directory,
        template: 'none', repository: '', setup: '', command: '', networkIsolation: account.networkIsolation }, '_workspace',
        { value: account.projectId === 'default' ? undefined : account.projectId, enumerable: false }) as Project;
      return guest.openGuestTcpStream ? guest.openGuestTcpStream(args[1], args[2].listener.port, args[4], project) : new PassThrough(); },
  };
  return { options, file, records, tickets, identities, hashes, members, held, events, frames, rootLaunches, executions,
    proofCalls, bridges, state, read: async () => JSON.parse(await readFile(file, 'utf8')) };
}
