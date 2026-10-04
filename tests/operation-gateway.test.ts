import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../shared/errors.ts';
import { PLUGINS } from '../shared/plugins.ts';
import { OperationGateway, validateOperationInput, operationPreflightFailure } from '../server/operation-gateway.ts';
import { createOperationAuthority } from '../server/operation-authority.ts';
import { operationEntries } from '../server/operation-catalog.ts';
import { apiDocument } from '../server/openapi.ts';
import { captureOperationCheck } from '../server/operation-context.ts';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { resourceContext } from '../server/host-runtime/context.ts';
import { vmLifetime } from '../server/vm-lifetime.ts';
import type { Machines } from '../server/machines.ts';
import type { Principal } from '../server/access-control.ts';
import { hostRuntimeDiagnosticSchema, networkRuntimeDiagnosticSchema } from '../shared/contracts/operations.ts';
import { networkRuntime } from '../server/network/index.ts';
import { metadataQueueSnapshot } from '../server/metadata-queue.ts';
import { backupRecoverySchema } from '../shared/backup-recovery.ts';
import { ZodError } from 'zod';

const vmId = 'd2f574eb-44c5-40b8-a2ac-581b56cb4a12';
const otherProject = '1234567890abcdef';
const req = (method = 'GET', token = 'credential') => ({ method,
  headers: { 'x-sakura-token': token } }) as unknown as IncomingMessage;
const url = (path: string) => new URL(path, 'http://localhost:7337');

test('resolved admission and media rejections identify a handler that never executed, while business failures cannot inherit that marker', async () => {
  const entry = operationEntries.find(item => item.declaration.id === 'core.access.password')!;
  const original = new AppError('private credential details', 403, 'REVOKED');
  let allowed = false, executions = 0;
  const gateway = new OperationGateway({ enabled: () => [], bind: async () => ({ check: async () => {
    if (!allowed) throw original; return 'owner';
  } }) }, [entry]);
  gateway.register(entry, () => { executions++; throw original; }); gateway.seal();
  const request = req('POST'), response = {} as ServerResponse;
  await assert.rejects(gateway.dispatch(request, response, url(entry.declaration.path)), error => error === original);
  assert.equal(operationPreflightFailure(original), entry.declaration.id); assert.equal(executions, 0);
  allowed = true;
  await assert.rejects(gateway.dispatch(request, response, url(entry.declaration.path)), (error: any) => {
    assert.equal(error.code, 'UNSUPPORTED_MEDIA_TYPE');
    return operationPreflightFailure(error) === entry.declaration.id;
  });
  assert.equal(executions, 0);
  request.headers['content-type'] = 'application/json';
  await assert.rejects(gateway.dispatch(request, response, url(entry.declaration.path)), error => error === original);
  assert.equal(executions, 1); assert.equal(operationPreflightFailure(original), undefined);
});
function fixture(role: Principal['role'] = 'owner') {
  let allowed = true, locked = false, projectAllowed = true, active = 'default', approved = false;
  let roleNow = role;
  const principal = (): Principal => ({ id: 'actor', username: 'actor', role: roleNow, vmIds: [vmId], expiresAt: Date.now() + 60_000 });
  const live = { abort: new AbortController() } as any;
  const records = new Map([[vmId, {}]]);
  const machines = { records, live: new Map([[vmId, live]]),
    get(id: string) { if (!records.has(id)) throw new AppError('Missing VM', 404); return records.get(id); },
    requireUnlocked() {},
  } as unknown as Machines;
  const enabled = new Set(PLUGINS.map(plugin => plugin.id));
  const migration = { blocked: false };
  const list = async () => ({ active, projects: [{ id: 'default', name: 'default' }, { id: otherProject, name: 'other' }] });
  let extensionAllowed = true;
  const bind = createOperationAuthority({ machines, features: { enabled, migration } as any,
    access: { enabled: true, authorize(token: unknown) {
      if (!allowed || token !== 'credential') throw new AppError('Revoked', 401, 'REVOKED');
      return principal();
    } },
    session: { requireUnlocked() { if (locked) throw new AppError('Locked', 423); } },
    projectPermissions: {
      async require() { if (!projectAllowed) throw new AppError('Project permission revoked', 403, 'PROJECT_REVOKED'); },
      async requireCommitted() { if (!projectAllowed) throw new AppError('Project permission revoked', 403, 'PROJECT_REVOKED'); },
      requiresApproval: () => approved,
    },
    browserExtensions: { authorize() { if (!extensionAllowed) throw new AppError('Extension revoked', 403); return {} as any; } },
    equalToken: () => allowed,
    socketAuthorization: () => allowed ? principal() : null,
    projects: { list, readCommittedList: list },
  });
  return { gateway: new OperationGateway({ enabled: () => enabled, bind }), machines, live, enabled, migration,
    revoke: () => { allowed = false; }, lock: () => { locked = true; },
    revokeProject: () => { projectAllowed = false; }, switchProject: () => { active = otherProject; },
    requireApproval: () => { approved = true; }, role: (value: Principal['role']) => { roleNow = value; },
    revokeExtension: () => { extensionAllowed = false; } };
}

test('all actual declarations resolve exactly and HTTP documentation shares their authority', () => {
  const f = fixture(), spec = apiDocument(f.enabled, 7337);
  for (const { declaration } of operationEntries) {
    const path = declaration.path.replace(/\{([^}]+)\}/g, (_, name) => name === 'vmId' ? vmId : 'sample');
    assert.equal(f.gateway.resolve(declaration.method, path).entry.declaration.id, declaration.id);
    if (declaration.method !== 'UPGRADE') assert.deepEqual(
      spec.paths[declaration.path][declaration.method.toLowerCase()]['x-sakura-operation'],
      { ...declaration, enabled: true });
  }
  assert.throws(() => f.gateway.resolve('GET', '/api/vms/' + vmId + '/commands/undeclared'), { code: 'OPERATION_NOT_FOUND' });
  assert.throws(() => f.gateway.resolve('GET', '/api/vms/' + vmId + '/commands/%2f'), { code: 'OPERATION_NOT_FOUND' });
  assert.throws(() => f.gateway.resolve('POST', '/api/images'), { status: 405 });
  assert.throws(() => f.gateway.resolve('DELETE', '/api/vms/batch'), { status: 405 });
});

test('diagnostic contracts accept the real runtime resource association shapes', () => {
  const host = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const lease = host.register({ owner: 'test:diagnostic', kind: 'operation', label: 'scope' });
  hostRuntimeDiagnosticSchema.parse({ ...host.snapshot(), schedules: [], metadata: metadataQueueSnapshot() });
  networkRuntimeDiagnosticSchema.parse(networkRuntime.snapshot());
  lease.release(); host.close();
});

test('GET requires an explicit role and member projects must be named and currently authorized', async () => {
  const f = fixture('viewer');
  await assert.rejects(f.gateway.prepare(req(), url('/api/host-runtime')), { status: 403 });
  await f.gateway.prepare(req(), url('/api/access/view'));
  f.role('member');
  await assert.rejects(f.gateway.prepare(req(), url(`/api/vms/${vmId}/project`)), { status: 400 });
  const a = await f.gateway.prepare(req(), url(`/api/vms/${vmId}/project?project=default`));
  f.revokeProject();
  await assert.rejects(a.check(), { code: 'PROJECT_REVOKED' });
});

test('VM lifecycle queries accept the selected project hint without changing scope or role grants', async () => {
  const f = fixture();
  f.revokeProject();
  const path = `/api/vms/${vmId}/files?path=%2Fworkspace&project=default`;
  const admitted = await f.gateway.prepare(req(), url(path));
  assert.equal(admitted.declaration.projectScoped, false);
  assert.equal(admitted.declaration.projectBinding, 'none');
  await admitted.check();
  await f.gateway.prepare(req(), url(`/api/vms/${vmId}/files?path=&project=${otherProject}`));
  for (const query of ['path=%2Fworkspace&project=arbitrary', 'path=%2Fworkspace&project=default&unknown=1'])
    await assert.rejects(f.gateway.prepare(req(), url(`/api/vms/${vmId}/files?${query}`)), ZodError);
  await assert.rejects(f.gateway.prepare(req(), url('/api/network-profiles?project=default')), ZodError);
  f.role('member');
  await assert.rejects(f.gateway.prepare(req(), url(path)), { status: 403 });
});

test('resource queues recheck captured credentials, return their slot, and preserve control cleanup', async () => {
  const f = fixture(), runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const resource = { owner: 'test:gateway', kind: 'test', label: 'queued', cost: { jobs: 1 } };
  const held = await runtime.acquire(resource);
  const request = req(), admission = await f.gateway.prepare(request, url('/api/system'));
  const queued = admission.run(() => runtime.acquire(resource));
  const rejected = assert.rejects(queued, { code: 'REVOKED' });
  request.headers['x-sakura-token'] = 'replacement';
  f.revoke(); held.release(); await rejected;
  assert.equal(runtime.snapshot().resources.length, 0);
  await admission.run(async () => { (await runtime.acquire({ ...resource, lane: 'control' })).release(); });
  runtime.close();
});

test('disabled plugins retain 403 before VM lookup, after credential and session checks', async () => {
  for (const state of ['disabled', 'unauthenticated', 'locked'] as const) {
    const f = fixture(), request = req();
    f.enabled.delete('backups');
    f.machines.records.delete(vmId);
    if (state === 'unauthenticated') delete request.headers['x-sakura-token'];
    if (state === 'locked') f.lock();
    await assert.rejects(f.gateway.prepare(request, url(`/api/vms/${vmId}/backup-recovery`)), {
      status: state === 'disabled' ? 403 : state === 'unauthenticated' ? 401 : 423,
      ...(state === 'disabled' ? { message: '请在插件中心启用插件「backups」，并重启 Sakura 服务' } : {}),
    });
  }
});

test('queued plugin checks preserve credential and session priority when the plugin unloads', async () => {
  for (const state of ['disabled', 'revoked', 'locked'] as const) {
    const f = fixture(), runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
    const resource = { owner: 'test:plugin-authority', kind: 'test', label: 'queued', cost: { jobs: 1 } };
    const held = await runtime.acquire(resource);
    const admission = await f.gateway.prepare(req(), url(`/api/vms/${vmId}/backup-recovery`));
    const queued = admission.run(() => runtime.acquire(resource));
    const refused = assert.rejects(queued, {
      status: state === 'disabled' ? 403 : state === 'revoked' ? 401 : 423,
    });
    f.enabled.delete('backups');
    if (state === 'revoked') f.revoke();
    if (state === 'locked') f.lock();
    held.release();
    await refused;
    assert.equal(runtime.snapshot().resources.length, 0);
    runtime.close();
  }
});

test('typed plugin input validation precedes its domain lookup for a missing VM', async () => {
  const f = fixture(), target = `/api/vms/${vmId}/backup-recovery`;
  f.machines.records.delete(vmId);
  const dispatch = (input: unknown) => f.gateway.run(req('POST'), url(target), async () => {
    // Features.route validates this declared schema before invoking the domain operation.
    backupRecoverySchema.parse(await validateOperationInput(input));
    return f.machines.get(vmId);
  });
  await assert.rejects(dispatch({ backupId: vmId, paths: ['../outside'] }), (error) => error instanceof ZodError);
  await assert.rejects(dispatch({ backupId: vmId, paths: ['workspace/readme'] }), { status: 404 });
  await assert.rejects(f.gateway.run(req(), url(target), () => f.machines.get(vmId)), { status: 404 });
});

test('project scope is pinned at admission while lifecycle operations can advance their own VM', async () => {
  const f = fixture(), target = url(`/api/vms/${vmId}/commands`);
  const a = await f.gateway.prepare(req('POST'), target);
  f.switchProject(); await a.check();
  assert.equal(target.searchParams.get('project'), 'default');
  assert.equal(a.run(() => resourceContext()?.projectId), 'default');
  vmLifetime(vmId, f.live).advanceExecution();
  await assert.rejects(a.check(), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const start = await f.gateway.prepare(req('POST'), url(`/api/vms/${vmId}/start`));
  f.machines.live.set(vmId, { abort: new AbortController() } as any);
  await start.check();
  f.machines.records.delete(vmId); // Delete can still complete its metadata cleanup after the record goes away.
  await start.check();
});

test('body-dependent instance execution keeps its no-project protocol, project execution captures a project', async () => {
  const f = fixture(), target = url(`/api/vms/${vmId}/exec`);
  await f.gateway.run(req('POST'), target, () => validateOperationInput({ command: 'true', scope: 'instance' }));
  assert.equal(target.searchParams.has('project'), false);
  await f.gateway.run(req('POST'), target, () => validateOperationInput({ command: 'true' }));
  assert.equal(target.searchParams.get('project'), 'default');
  await assert.rejects(f.gateway.run(req('POST'), target, () => validateOperationInput({ command: 1 })));
});

test('plugin unload, maintenance, approval changes and session lock revoke queued operations', async () => {
  for (const change of ['unload', 'maintenance', 'approval', 'lock'] as const) {
    const f = fixture();
    const a = await f.gateway.prepare(req('PUT'), url(`/api/vms/${vmId}/project?project=default`));
    if (change === 'unload') f.enabled.delete('projects');
    if (change === 'maintenance') f.migration.blocked = true;
    if (change === 'approval') f.requireApproval();
    if (change === 'lock') f.lock();
    await assert.rejects(a.check());
  }
});

test('locked public unlock and callback adapters retain protocol handling, protected public routes reject', async () => {
  const f = fixture(); f.lock(); f.migration.blocked = true;
  for (const path of ['/api/session/unlock', '/api/session/unlock/passkey/options', '/api/session/unlock/passkey/verify', '/api/access/sso/saml/callback'])
    await f.gateway.prepare(req('POST'), url(path));
  await f.gateway.prepare(req(), url('/api/session'));
  await assert.rejects(f.gateway.prepare(req(), url('/api/bootstrap')), { status: 423 });
  await assert.rejects(f.gateway.prepare(req(), url('/api/downloads/ticket')), { status: 423 });
});

test('special extension and socket credentials remain live checks after stream admission', async () => {
  const f = fixture(), request = req();
  request.headers.origin = 'chrome-extension://' + 'a'.repeat(32);
  const extension = await f.gateway.prepare(request, url('/api/extension/inventory'));
  f.revokeExtension(); await assert.rejects(extension.check(), { status: 403 });
  const socket = await f.gateway.prepare(req(), url(`/ws/${vmId}/terminal?token=credential`), 'UPGRADE');
  const check = socket.run(() => captureOperationCheck());
  f.revoke(); await assert.rejects(check(), { status: 403 });
});
