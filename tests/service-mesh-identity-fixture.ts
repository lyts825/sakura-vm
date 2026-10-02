import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Machines, type Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import { Workspaces, projectVersion, type Project } from '../server/workspaces.ts';
import { ServiceMesh, type ServiceMeshOptions } from '../server/service-mesh.ts';
import { AppError, DATA, vmDir } from '../server/model.ts';
import { projectIdentityPayload, projectIdentitySchema, projectIdentityRunSchema, type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';
import { projectMeshRecordSchema, type ProjectMeshRecord } from '../server/project-service-scope.ts';
import { meshConfigSchema, type MeshConfig } from '../server/service-mesh-identity.ts';

export async function meshIdentityFixture() {
  const id = randomUUID(), registryId = randomUUID(), locks = new Machines({} as Engine), file = join(DATA, id + '.mesh.json');
  const records = new Map<string, ProjectMeshRecord>(), tickets = new Map<string, ProjectIdentityRun>(),
    identities = new Map<string, ProjectIdentity>(), hashes = new Map<string, string>(), configs = new Map<string, MeshConfig>(),
    members = new Map<string, Set<number>>(), held = new Map<string, number>(),
    finiteMembers = new Map<string, Set<number>>(), finiteTickets = new Map<string, { identity: ProjectIdentity;
      owner: { kind: 'task'; runId: string; bootId: string }; sha256: string; phase: 'intent' | 'active' | 'closed'; run: ProjectIdentityRun | null }>(),
    running = new Map<string, { binding: string; runId: string; valid: boolean; orphan: boolean }>();
  const executions: { project: Project; command: string; environment?: Record<string, string>; timeout?: number }[] = [],
    frames: Buffer[] = [], rootLaunches: string[] = [], commands: string[] = [], events: string[] = [];
  const state = { guest: 'running', bootId: randomUUID(), envoy: true, python: true, tmux: true, enabled: true, usable: true,
    directoryPresent: true, namespacePresent: true, cleanupFailures: 0, releaseFailures: 0, closeFailures: 0,
    configFailures: 0, configCleanupFailures: 0, launchAckFailures: 0, starts: 0, preparations: 0, releases: 0, closes: 0,
    resolutions: 0, taskCalls: 0, taskCleanupFailures: 0, taskFailOnCall: 0, taskOutput: '', taskStderr: '',
    migrationRequired: false, missingListener: false, listenerChanged: false, configChanged: false, nativeChanged: false,
    coldBootBlocked: false, unknownScope: false, legacyRunning: new Set<string>(),
    prepareHook: undefined as (() => void | Promise<void>) | undefined,
    taskHook: undefined as (() => Promise<void>) | undefined,
    resolutionHook: undefined as (() => Promise<void>) | undefined,
    proofHook: undefined as (() => Promise<void>) | undefined,
    launchHook: undefined as (() => void | Promise<void>) | undefined,
    stopHook: undefined as (() => void | Promise<void>) | undefined,
    publishHook: undefined as (() => void | Promise<void>) | undefined };
  const scopeId = (project: Project) => project._workspace || 'default';
  const clone = (project: Project) => Object.defineProperty(structuredClone(project), '_workspace', { value: project._workspace, enumerable: false });
  const assertHeld = (project: Project) => assert.ok(held.get(scopeId(project)), 'preparation must remain owned through the original operation');
  const identity = (project: Project) => {
    const key = scopeId(project); let account = identities.get(key);
    if (!account || account.directory !== project.directory || account.networkIsolation !== (project.networkIsolation || 'host')) {
      const identityId = randomUUID(), uid = 23000 + identities.size;
      account = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId, identityId, projectId: key, revision: 1,
        account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid, gid: uid,
        home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory,
        homeDevice: '12', homeInode: String(uid + 1), directoryDevice: '12', directoryInode: String(uid + 2),
        networkIsolation: project.networkIsolation || 'host' }); identities.set(key, account);
    }
    return account;
  };
  const binary = { path: '/usr/bin/envoy', device: '12', inode: '701', size: 9999, mtimeNs: '123000' };
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]), live: new Map([[id, {}]]),
    get: () => ({ id, template: 'none', distro: 'alpine' }), state: () => state.guest,
    locked: locks.locked.bind(locks), requireUnlocked: locks.requireUnlocked.bind(locks),
    exec: async (_id: string, command: string) => { commands.push(command);
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS')) return { code: 0, stdout: 'absent\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' }; },
    execInput: async (_id: string, command: string) => { commands.push(command);
      throw new Error('unexpected Root process execution outside the injected static metadata boundary'); },
  }) as unknown as MachineType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines), actualResolve = workspaces.resolveProject.bind(workspaces);
  workspaces.resolveProject = async (...args) => { ++state.resolutions; await state.resolutionHook?.(); return actualResolve(...args); };
  const read = async () => JSON.parse(await readFile(file, 'utf8'));
  const options: ServiceMeshOptions = {
    createPreparation: () => {
      let selected = '', released = false; ++state.preparations;
      return {
        prepare: async (vmId, projectId, session, readOnly, signal, _terminal, mode) => {
          assert.equal(vmId, id); assert.equal(typeof projectId, 'string'); assert.equal(session, null); assert.equal(readOnly, false);
          assert.deepEqual(mode, { mode: 'task' }); signal?.throwIfAborted();
          selected = projectId!; const project = clone(await workspaces.config(id));
          assert.equal(scopeId(project), selected); held.set(selected, (held.get(selected) || 0) + 1);
          events.push(selected + ':prepare');
          await state.prepareHook?.();
          return { command: 'unused Root shell', projectId: selected, terminalId: undefined, networkIsolation: project.networkIsolation || 'host',
            signal: signal!, captured: { project, configVersion: projectVersion(project), live: machines.live.get(id)! },
            release: async () => {
              if (state.releaseFailures > 0) { --state.releaseFailures; throw new Error('original preparation release failed'); }
              if (released) return; released = true; held.set(selected, held.get(selected)! - 1);
              ++state.releases; events.push(selected + ':release');
            } };
        },
        close: async () => {
          if (state.closeFailures > 0) { --state.closeFailures; throw new Error('original preparation close failed'); }
          assert.equal(released || !selected, true); ++state.closes; events.push(selected + ':close');
        },
      };
    },
    runTask: async (...args) => {
      const [transport, vmId, project, execution, signal, _log, timeout, _agent, _cleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(vmId, id); assert.equal(pins?.expectedLive, machines.live.get(id));
      assert.equal(pins?.expectedBootId, state.bootId, 'each finite task must pin the original boot before execution');
      assertHeld(project); signal.throwIfAborted(); assert.ok(timeout === 10000 || timeout === 180000);
      const payload = projectIdentityPayload(execution), runId = randomUUID();
      const account = identity(project), owner = { kind: 'task' as const, runId, bootId: state.bootId };
      await pins?.beforeIntent?.({ identity: account, owner, sha256: payload.sha256 });
      finiteTickets.set(runId, { identity: account, owner, sha256: payload.sha256, phase: 'active', run: null });
      finiteMembers.set(runId, new Set([9876, 9877])); executions.push({ project: clone(project), ...execution, timeout });
      ++state.taskCalls; events.push(scopeId(project) + ':uid-task');
      let failure: unknown;
      try { await state.taskHook?.(); signal.throwIfAborted(); } catch (error) { failure = error; }
      if (state.taskCleanupFailures > 0 || state.taskCalls === state.taskFailOnCall) { if (state.taskCleanupFailures) --state.taskCleanupFailures;
        throw new AppError('finite task original domain still populated', 503, 'GUEST_TASK_CLEANUP_FAILED'); }
      finiteMembers.delete(runId);
      events.push(scopeId(project) + ':task-full-domain-absent');
      if (failure !== undefined) throw failure;
      return { code: state.usable ? 0 : 127,
        stdout: state.taskOutput || (execution.command.includes('--version') ? 'envoy version: fixture\n' : ''),
        stderr: state.usable ? '' : state.taskStderr || 'incompatible Envoy' };
    },
    scopes: {
      identity: async (_vmId, project, signal) => {
        signal?.throwIfAborted(); assertHeld(project);
        if (state.migrationRequired) throw new AppError('explicit project directory migration required', 409, 'PROJECT_DIRECTORY_MIGRATION_REQUIRED');
        events.push(scopeId(project) + ':identity'); return identity(project);
      },
      inherited: async (_vmId, project, execution, owner, signal) => {
        signal?.throwIfAborted(); assertHeld(project); assert.equal(owner.kind, 'service');
        const payload = projectIdentityPayload(execution), account = identity(project);
        const row = (await read()).runs.find((value: any) => value.projectId === scopeId(project));
        assert.equal(row.execution.sha256, payload.sha256, 'full body digest must be durable before SDK/native launch');
        assert.equal(row.execution.run, null); frames.push(payload.input); executions.push({ project: clone(project), ...execution });
        const command = 'fixed-native-entry --run ' + owner.runId; rootLaunches.push(command);
        events.push(scopeId(project) + ':native-intent');
        return { ...payload, command, runId: owner.runId, identity: account };
      },
      active: async (_id, _projectId, runId, signal) => { signal?.throwIfAborted(); return tickets.get(runId)?.phase === 'active'; },
      readonlyActive: async (_id, projectId, runId, signal) => {
        signal?.throwIfAborted(); const ticket = tickets.get(runId);
        return ticket?.phase === 'active' && ticket.projectId === projectId && ticket.bootId === state.bootId;
      },
      closeAfterScopeStopped: async (_id, projectId, runId) => {
        if (finiteMembers.has(runId)) throw new AppError('original finite task full domain has descendants', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        const ticket = finiteTickets.get(runId); assert.ok(ticket); ticket.phase = 'closed';
        events.push(projectId + ':task-native-ticket-retired');
      },
      taskRun: async (_id, projectId, runId) => {
        const ticket = finiteTickets.get(runId); if (!ticket) return null;
        assert.equal(ticket.identity.projectId, projectId); return structuredClone(ticket);
      },
    },
    identities: {
      runReadonly: async (_id, account, runId, signal) => {
        signal?.throwIfAborted(); const ticket = tickets.get(runId);
        if (!ticket || ticket.identityId !== account.identityId || ticket.bootId !== state.bootId) throw new AppError('native ticket changed', 409);
        return state.nativeChanged ? { ...ticket, cgroupInode: '999999' } : structuredClone(ticket);
      },
    },
    processScope: (_id, project) => {
      const key = scopeId(project);
      return {
        status: async (signal, expectedHash) => {
          signal?.throwIfAborted(); await state.proofHook?.();
          const record = records.get(key) || null;
          if (expectedHash && (!record || hashes.get(record.runId) !== expectedHash)) throw new AppError('immutable transport changed', 409);
          return { status: state.unknownScope ? 'unmanaged' : !record ? 'absent' : record.bootId !== state.bootId ? 'unconfirmed' :
            record.phase === 'running' ? 'running' : record.phase === 'stopped' ? 'stopped' : 'prepared',
          bootId: state.bootId, record: record && structuredClone(record) };
        },
        newIntent: (binding, bootId) => {
          const runId = randomUUID();
          return projectMeshRecordSchema.parse({ version: 1, projectId: key, name: 'mesh', session: 'sakura-mesh-uid-' + key,
            runId, bootId, scopeName: 'sakura-service-' + runId, binding, phase: 'intent',
            inode: null, sessionId: null, paneId: null, panePid: null, paneStartTicks: null });
        },
        persistIntent: async intent => {
          const row = (await read()).runs.find((value: any) => value.projectId === key);
          assert.deepEqual(row.execution.record, intent); assert.equal(row.config, null); assertHeld(project);
          records.set(key, intent); events.push(key + ':outer-intent');
        },
        start: async (intent, payload, signal) => {
          signal.throwIfAborted(); assertHeld(project); ++state.starts;
          const account = identity(project), record: ProjectMeshRecord = { ...intent, phase: 'running', inode: '901',
            sessionId: '$11', paneId: '%25', panePid: 1234, paneStartTicks: '989' };
          records.set(key, record); hashes.set(record.runId, payload.sha256);
          members.set(record.runId, new Set([1234, 5555, 5556]));
          tickets.set(record.runId, projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-current',
            registryId, identityId: account.identityId, projectId: key, runId: record.runId, revision: account.revision,
            bootId: state.bootId, build: 'b'.repeat(64), networkDevice: '4', networkInode: '502', cgroupDevice: '29',
            cgroupInode: record.inode, cgroupName: record.scopeName, namespace: account.networkIsolation === 'private' ? 'sk-' + key : '' }));
          running.set(key, { binding: intent.binding, runId: intent.runId, valid: true, orphan: false });
          events.push(key + ':envoy-start'); await state.launchHook?.();
          if (state.launchAckFailures > 0) { --state.launchAckFailures; throw new Error('Root launch ACK lost after UID process entered full domain'); }
          return record;
        },
        stop: async original => {
          events.push(key + ':stop-attempt'); await state.stopHook?.();
          if (state.cleanupFailures > 0) { --state.cleanupFailures;
            throw new AppError('original full domain still populated', 503, 'SERVICE_CLEANUP_FAILED'); }
          if (original.bootId !== state.bootId && state.coldBootBlocked)
            throw new AppError('new boot owns reused tmux label', 503, 'SERVICE_CLEANUP_FAILED');
          const known = records.get(key);
          if (known) { assert.equal(known.runId, original.runId); assert.equal(known.binding, original.binding);
            for (const field of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
              if (original[field] !== null && known[field] !== null) assert.equal(known[field], original[field]); }
          members.delete(original.runId); running.delete(key); events.push(key + ':full-domain-absent');
          const ticket = tickets.get(original.runId); if (ticket) tickets.set(ticket.runId, { ...ticket, phase: 'closed' });
          events.push(key + ':native-ticket-retired'); records.set(key, { ...(known || original), phase: 'stopped' });
        },
      };
    },
    hostStatus: async (_id, project, signal) => { signal?.throwIfAborted();
      return { bootId: state.bootId, pythonInstalled: state.python, tmuxInstalled: state.tmux, envoy: state.envoy ? binary : null,
        directoryPresent: state.directoryPresent, namespacePresent: state.namespacePresent,
        legacyRunning: state.legacyRunning.has(scopeId(project)),
        legacyProcesses: state.legacyRunning.has(scopeId(project)) ? [7777] : [], legacyConfigPresent: state.legacyRunning.has(scopeId(project)) }; },
    configControl: async (_id, op, plan, proof, source, signal) => {
      signal?.throwIfAborted();
      if (op === 'publish') {
        const row = (await read()).runs.find((value: any) => value.projectId === plan.projectId);
        assert.deepEqual(row.plan, plan); assertHeld(identityProject(row));
        assert.ok(source && Buffer.byteLength(source) === plan.bytes);
        assert.ok(!configs.has(plan.runId)); events.push(plan.projectId + ':config-intent');
        const config = meshConfigSchema.parse({ version: 1, path: plan.path, device: '12', inode: '705',
          sha256: plan.sha256, bytes: plan.bytes, gid: plan.gid });
        configs.set(plan.runId, config); await state.publishHook?.();
        if (state.configFailures > 0) { --state.configFailures; throw new Error('configuration publish ACK lost'); }
        return { present: true, config };
      }
      if (op === 'cleanup') {
        assert.ok(!members.has(plan.runId), 'configuration must outlive the complete original process domain');
        if (state.configCleanupFailures > 0) { --state.configCleanupFailures; throw new Error('original config cleanup failed'); }
        const config = configs.get(plan.runId); if (config && proof) assert.deepEqual(config, proof);
        configs.delete(plan.runId); events.push(plan.projectId + ':config-retired'); return { cleaned: true };
      }
      const config = configs.get(plan.runId);
      return { present: !!config, config: config && state.configChanged ? { ...config, inode: '99998' } : config || null };
    },
    listener: async (_id, account, run, signal) => {
      signal?.throwIfAborted(); if (state.missingListener) return null;
      const row = (await read()).runs.find((value: any) => value.execution.record.runId === run.runId);
      assert.equal(row.projectId, account.projectId);
      return { port: row.policy.listenPort, pid: state.listenerChanged ? 9999 : 1234, startTicks: '989', socketInode: '889' };
    },
    processProbe: async (row, run, listener, signal) => {
      signal?.throwIfAborted(); const process = running.get(row.projectId);
      assert.deepEqual(configs.get(run.runId), row.config); assert.equal(listener.pid, 1234);
      if (!process?.valid || process.orphan || process.runId !== run.runId || listener.port !== row.policy.listenPort)
        throw new AppError('original Envoy executable/listener/cwd binding changed', 409);
      events.push(row.projectId + ':envoy-kernel-proof');
    },
  };
  function identityProject(row: any) {
    return Object.defineProperty({ directory: row.directory, template: 'none', repository: '', setup: '', command: '',
      networkIsolation: row.networkIsolation }, '_workspace', { value: row.projectId === 'default' ? undefined : row.projectId, enumerable: false }) as Project;
  }
  const create = () => new ServiceMesh(machines, workspaces, file, async () => state.enabled, options);
  let mesh = create(); await mesh.init();
  return { id, machines, workspaces, file, options, state, records, tickets, identities, hashes, configs, members, finiteMembers, finiteTickets, held, running,
    frames, executions, commands, events, rootLaunches, read, binary,
    get mesh() { return mesh; },
    restart: async () => { await mesh.close(); mesh = create(); await mesh.init(); },
    close: async () => { state.cleanupFailures = state.configCleanupFailures = state.releaseFailures = state.closeFailures = 0;
      state.coldBootBlocked = false; finiteMembers.clear(); await mesh.close(); await workspaces.close(); },
  };
}
