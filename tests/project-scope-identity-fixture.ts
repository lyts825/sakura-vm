import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { ProjectIdentities, projectIdentityPayload, type ProjectIdentity, type ProjectIdentityRun,
  type ProjectIdentityExecution, type ProjectIdentityNetwork, type ProjectIdentityNetworkLease,
  type ProjectIdentityNetworkRelease } from '../server/project-identity.ts';
import { ProjectRunScopes } from '../server/project-run-scope.ts';
import type { Project } from '../server/workspaces.ts';
import type { ProjectMainRecord, ProjectServiceRecord } from '../server/project-service-scope.ts';

type Record = ProjectMainRecord | ProjectServiceRecord;
type Context = ReturnType<typeof scopeIdentityFixture>;
const contexts = new WeakMap<object, Context>();
const context = (core: object) => {
  const value = contexts.get((core as { machines: object }).machines);
  assert.ok(value, 'identity test core must be registered for this transport');
  return value;
};
for (const method of ['ensure', 'inspect', 'rebind', 'inheritedInput', 'run', 'runReadonly', 'stop', 'network', 'beginNetworkRelease', 'releaseNetwork'] as const)
  mock.method(ProjectIdentities.prototype, method, function(this: ProjectIdentities, ...args: any[]) {
    return (context(this)[method] as (...values: any[]) => unknown)(...args);
  });

/** Only the guest core is simulated. Host journals and binary payload encoding stay real. */
export function scopeIdentityFixture(machines: Machines, project: Project, boot: () => string,
  record: (runId: string) => Record | null, probe?: (execution: ProjectIdentityExecution) => number) {
  const identities = new Map<string, ProjectIdentity>(), tickets = new Map<string, ProjectIdentityRun>();
  const networks = new Map<string, ProjectIdentityNetwork>(), networkLeases = new Map<string, ProjectIdentityNetworkLease>(),
    releasedNetworks = new Map<string, ProjectIdentityNetworkRelease>();
  const taskScopes = new Set<string>(), payloads = new Map<string, Buffer>(), inputs: Buffer[] = [];
  const state = { stopFailures: 0, readonlyCalls: 0, ensureCalls: 0, stopCalls: 0,
    networkBeginCalls: 0, networkReleaseCalls: 0, networkReleaseFailures: 0 };
  const existingExec = machines.exec.bind(machines);
  const activate = (runId: string, kind: 'main' | 'service' | 'task', inode: string) => {
    if (tickets.has(runId)) return;
    const identity = identities.get(project._workspace || 'default')!;
    assert.ok(identity);
    if (identity.networkIsolation === 'private' && (!networks.has(identity.projectId) || networks.get(identity.projectId)!.bootId !== boot()))
      networks.set(identity.projectId, { version: 1, registryId: identity.registryId, identityId: identity.identityId,
        projectId: identity.projectId, revision: identity.revision, bootId: boot(), namespace: 'sk-' + identity.projectId,
        networkDevice: '4', networkInode: '5', generation: randomUUID() });
    tickets.set(runId, { version: 1, phase: 'active', mode: 'inherit-current', registryId: identity.registryId,
      identityId: identity.identityId, projectId: identity.projectId, runId, revision: identity.revision,
      bootId: boot(), build: 'a'.repeat(64), networkDevice: '4', networkInode: '5', cgroupDevice: '6',
      cgroupInode: inode, cgroupName: `sakura-${kind}-${runId}`,
      namespace: identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '' });
  };
  machines.exec = async (id, command, ...rest) => {
    const scopeLine = command.split('\n').find(line => /^# SAKURA_PROJECT_(MAIN|SERVICE)_REQUEST=/.test(line));
    const request = scopeLine ? JSON.parse(Buffer.from(scopeLine.split('=')[1], 'base64').toString()) : null;
    if (request) {
      try { return await existingExec(id, command, ...rest); }
      finally {
        const value = request.record && record(request.record.runId);
        if (request.op === 'commit' && value?.phase === 'running')
          activate(value.runId, value.version === 2 ? 'main' : 'service', value.inode!);
      }
    }
    if (command.includes('assert not os.path.lexists') && command.includes('absent') && /sakura-(main|service|task)-[a-f0-9-]{36}/.test(command)) {
      const found = command.match(/sakura-(main|service|task)-([a-f0-9-]{36})/);
      assert.ok(found);
      const value = record(found[2]);
      const absent = !taskScopes.has(found[2]) && (!value || value.phase === 'stopped' || value.bootId !== boot());
      return absent ? { code: 0, stdout: JSON.stringify({ bootId: boot(), absent: true }), stderr: '' }
        : { code: 73, stdout: '', stderr: 'owned scope remains present' };
    }
    if (command.trim().endsWith('/proc/sys/kernel/random/boot_id'))
      return { code: 0, stdout: boot(), stderr: '' };
    if (command.includes('/var/lib/sakura/project-directory-migrations/') && command.includes('latch.json'))
      return { code: 0, stdout: 'null', stderr: '' };
    if (command.includes('/run/netns/sk-') && command.includes('assert not os.path.lexists'))
      return { code: 0, stdout: JSON.stringify({ bootId: boot(), absent: true }), stderr: '' };
    const task = command.match(/sakura-task-([a-f0-9-]{36})/);
    if (task && command.includes('cgroup.kill')) taskScopes.delete(task[1]);
    return existingExec(id, command, ...rest);
  };
  machines.execInput = async (id, command, input, ...rest) => {
    inputs.push(Buffer.from(input));
    assert.ok(!command.includes('owned-main-private-token'));
    const requestLine = command.split('\n').find(line => /^# SAKURA_PROJECT_(MAIN|SERVICE)_REQUEST=/.test(line));
    if (requestLine) {
      const request = JSON.parse(Buffer.from(requestLine.split('=')[1], 'base64').toString());
      assert.equal(request.op, 'start');
      assert.deepEqual(input, payloads.get(request.record.runId));
      return machines.exec(id, command, ...rest);
    }
    const task = command.match(/\.sakura-job-([a-f0-9-]{36})\.pid/);
    assert.ok(task, 'protected task must retain the exact outer scope run ID');
    assert.deepEqual(input, payloads.get(task[1]));
    taskScopes.add(task[1]); activate(task[1], 'task', '23456');
    const length = input.readUInt32LE(24), script = input.subarray(32, 32 + length).toString();
    return { code: probe?.({ command: script }) || 0, stdout: '', stderr: '' };
  };
  const fixture = {
    state, tickets, payloads, inputs, activate, networks, networkLeases, releasedNetworks,
    ensure: async (_id: string, binding: { projectId: string; directory: string; networkIsolation: 'host' | 'private' }) => {
      ++state.ensureCalls;
      let identity = identities.get(binding.projectId);
      if (!identity) {
        const identityId = randomUUID();
        identity = { version: 1, phase: 'active', registryId: randomUUID(), projectId: binding.projectId,
          identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20001, gid: 20001,
          home: '/var/lib/sakura-project-homes/' + identityId, directory: binding.directory,
          directoryDevice: '1', directoryInode: '2', homeDevice: '1', homeInode: '3', networkIsolation: binding.networkIsolation };
        identities.set(binding.projectId, identity);
      }
      return identity;
    },
    inspect: async (_id: string, projectId: string) => identities.get(projectId) || null,
    rebind: async (_id: string, identity: ProjectIdentity, binding: object) => {
      const updated = { ...identity, ...binding, revision: identity.revision + 1 };
      identities.set(identity.projectId, updated); networks.delete(identity.projectId); return updated;
    },
    inheritedInput: async (_identity: ProjectIdentity, execution: ProjectIdentityExecution, options: { runId: string }) => {
      const payload = projectIdentityPayload(execution); payloads.set(options.runId, payload.input);
      return { ...payload, runId: options.runId,
        command: `/usr/bin/env -i /owned-identity-controller ${options.runId} ${payload.sha256}` };
    },
    run: async (_id: string, _identity: ProjectIdentity, runId: string) => {
      const ticket = tickets.get(runId);
      if (!ticket) throw new AppError('owned ticket absent', 409, 'PROJECT_IDENTITY_RECORD_ABSENT');
      return { ...ticket };
    },
    runReadonly: async (_id: string, identity: ProjectIdentity, runId: string) => {
      ++state.readonlyCalls; return fixture.run(_id, identity, runId);
    },
    stop: async (_id: string, _identity: ProjectIdentity, ticket: ProjectIdentityRun) => {
      ++state.stopCalls;
      if (state.stopFailures-- > 0) throw new AppError('owned ticket cleanup connection failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      assert.ok(!taskScopes.has(ticket.runId));
      const value = record(ticket.runId);
      assert.ok(!value || value.phase === 'stopped' || value.bootId !== boot());
      const closed = { ...ticket, phase: 'closed' as const }; tickets.set(ticket.runId, closed); return closed;
    },
    network: async (_id: string, identity: ProjectIdentity) => networks.get(identity.projectId) || null,
    beginNetworkRelease: async (_id: string, identity: ProjectIdentity, options: { releaseId: string; bootId: string }) => {
      ++state.networkBeginCalls; assert.equal(options.bootId, boot());
      const prior = networkLeases.get(options.releaseId);
      if (prior) return prior;
      const network = networks.get(identity.projectId);
      if (!network || network.bootId !== boot()) return null;
      assert.equal(network.identityId, identity.identityId); assert.equal(network.revision, identity.revision);
      const lease: ProjectIdentityNetworkLease = { version: 1, phase: 'pending', releaseId: options.releaseId, network };
      networkLeases.set(options.releaseId, lease); return lease;
    },
    releaseNetwork: async (_id: string, identity: ProjectIdentity, lease: ProjectIdentityNetworkLease) => {
      ++state.networkReleaseCalls;
      if (state.networkReleaseFailures-- > 0) throw new AppError('owned-main-private-token network reply lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      const prior = releasedNetworks.get(lease.releaseId);
      if (prior) { assert.deepEqual(prior.network, lease.network); return prior; }
      assert.deepEqual(networkLeases.get(lease.releaseId), lease);
      assert.deepEqual(networks.get(identity.projectId), lease.network);
      for (const ticket of tickets.values()) if (ticket.projectId === identity.projectId && ticket.bootId === boot()) assert.equal(ticket.phase, 'closed');
      const released: ProjectIdentityNetworkRelease = { version: 1, phase: 'released', releaseId: lease.releaseId, network: lease.network };
      releasedNetworks.set(lease.releaseId, released); networks.delete(identity.projectId); return released;
    },
    payload: (id: string, intent: Record, execution: ProjectIdentityExecution = { command: project.command, environment: project.environment }) =>
      new ProjectRunScopes(machines).inherited(id, project, execution,
        { kind: intent.version === 2 ? 'main' : 'service', runId: intent.runId, bootId: intent.bootId }),
  };
  contexts.set(machines, fixture); return fixture;
}
