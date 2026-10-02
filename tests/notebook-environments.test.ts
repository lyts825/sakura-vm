import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NotebookEnvironments, notebookListenerCommand, notebookSessionSchema, notebookToolsScript } from '../server/notebook-environments.ts';
import { notebookInstalledCommand, notebookInstallExecution, notebookWheelhouseCommand, notebookWheelLeaseSchema,
  notebookWheelRequest, type NotebookWheelLease } from '../server/notebook-wheelhouse.ts';
import { ProjectNotebookScope, projectNotebookRecordSchema, projectNotebookScopePaths, projectNotebookScopeCommand,
  projectServiceScopePaths, projectBrowserIdeScopePaths, type ProjectNotebookRecord } from '../server/project-service-scope.ts';
import { projectIdentityPayload, projectIdentitySchema, type ProjectIdentityRun } from '../server/project-identity.ts';
import { projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import type { Machines } from '../server/machines.ts';
import { AppError, DATA, createSchema, vmDir } from '../server/model.ts';

const signal = new AbortController().signal;
const decodeSource = (command: string) => command.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", "'");
const commandRequest = (command: string) => {
  const source = decodeSource(command), data = source.match(/request=json.loads\(([^\n]+)\)/)?.[1];
  assert.ok(data); return JSON.parse(JSON.parse(data));
};
const leaseFor = (request: { leaseId: string; bootId: string; provider: 'jupyter' | 'marimo' }): NotebookWheelLease =>
  notebookWheelLeaseSchema.parse({ version: 1, ...request, path: '/var/cache/sakura/notebook-wheels/' + request.leaseId,
    device: '12', inode: '99', manifestSha256: 'a'.repeat(64),
    files: ['pip-25.0-py3-none-any.whl', 'notebook_dep-1.0-py3-none-any.whl'].map((name, index) =>
      ({ name, device: '12', inode: String(100 + index), sha256: 'b'.repeat(64), bytes: 123 })) });
const copyProject = (project: Project) => Object.defineProperty(structuredClone(project), '_workspace', {
  value: project._workspace, enumerable: false,
});
async function fixture(t: { after: (work: () => Promise<unknown>) => void }, networkIsolation: 'host' | 'private' = 'host', projectId = 'default') {
  await mkdir(DATA, { recursive: true });
  const directory = await mkdtemp(join(DATA, 'notebook-uid-unit-')), vmId = randomUUID();
  const removeOwned = async (path: string) => { assert.ok(resolve(path).startsWith(resolve(DATA) + sep)); await rm(path, { recursive: true, force: true }); };
  t.after(() => removeOwned(directory)); t.after(() => removeOwned(vmDir(vmId)));
  let bootId = randomUUID(); const originalBoot = bootId, registryId = randomUUID(), identityId = randomUUID();
  const identity = projectIdentitySchema.parse({ version: 1, phase: 'active', projectId, registryId, identityId,
    revision: 1, uid: 20001, gid: 20001, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '12', homeInode: '20',
    directory: '/srv/notebooks/雪 quote\' project', directoryDevice: '12', directoryInode: '21', networkIsolation });
  const project: Project = { directory: identity.directory, networkIsolation, template: 'none',
    repository: '', setup: 'private-hook;$(id)', command: '',
    environment: { PATH: '/private/bin', PYTHONPATH: '/private/python', PIP_CONFIG_FILE: '/private/pip.conf',
      BASH_ENV: '/private/init', LD_PRELOAD: '/private/lib', TOKEN: 'notebook-private-雪' }, secrets: { RESOLVED: 'api-token' } };
  Object.defineProperty(project, '_workspace', { value: projectId === 'default' ? undefined : projectId, enumerable: false });
  const projectScope = new AsyncLocalStorage<string>();
  const vm = { ...createSchema.parse({ name: 'notebook-uid-unit', distro: 'ubuntu' }), id: vmId, createdAt: new Date().toISOString(), snapshots: [] };
  let machineState = 'running', currentProject = projectId, live: object = {}, installed = true, listener = true;
  let bridge = false, migration = false, startFailure = false, cleanupFailure = false, nativeFailure = false, inheritedFailure = false;
  let installFailure = false, wheelCleanupFailure = false, malformedWheelCleanup = false, wrongLease = false, activeLease = false;
  let prepareFailure: (() => void) | undefined, downloadHook: (() => void) | undefined, listenerGate: (() => Promise<void>) | undefined;
  let configHook: (() => void | Promise<void>) | undefined, bootHook: (() => void | Promise<void>) | undefined;
  let resolvedScope: string | undefined, configScope: string | undefined, currentScope: string | undefined;
  let scopeRecord: ProjectNotebookRecord | null = null, ticket: ProjectIdentityRun | null = null, transportSha: string | null = null;
  const events: string[] = [], rootCommands: string[] = [], frames: Buffer[] = [], projectScripts: string[] = [], rootLaunchCommands: string[] = [];
  const file = join(directory, 'notebooks.json');
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[vmId, live]]), get: () => vm, state: () => machineState,
    locked: async (_key: string, work: () => Promise<unknown>) => work(), requireUnlocked() {}, reserveHostPorts() {},
    exec: async (_vm: string, command: string) => {
      rootCommands.push(command);
      if (command.endsWith('/bin/cat /proc/sys/kernel/random/boot_id')) {
        const original = bootId; await bootHook?.(); return { code: 0, stdout: original, stderr: '' };
      }
      if (command.startsWith('# SAKURA_NOTEBOOK_INSTALLED')) return { code: 0, stdout: JSON.stringify({ installed }), stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }, setForwards: async () => assert.fail('Notebook UID services must use validated loopback bridges'),
  }) as unknown as Machines;
  const workspaces = { projects: { current: () => currentScope || projectScope.getStore() || currentProject,
    inScope: async (_vm: string, selected: string, work: () => Promise<unknown>) => {
      assert.equal(selected, projectId); return projectScope.run(selected, work);
    } },
    config: async () => {
      const value = copyProject(project); await configHook?.();
      return configScope === undefined ? value : Object.defineProperty(structuredClone(value), '_workspace', { value: configScope, enumerable: false });
    }, resolveProject: async (_vm: string, captured: Project) => {
      assert.equal(captured._workspace || 'default', projectId, 'raw captured scope must survive a non-enumerable clone');
      assert.equal(projectScope.getStore(), projectId);
      return Object.defineProperty({ ...structuredClone(captured), environment: { ...captured.environment, RESOLVED: 'resolved-secret-value' } },
        '_workspace', { value: resolvedScope ?? captured._workspace, enumerable: false });
    } } as unknown as Workspaces;
  const terminals = { async prepare(_vm: string, selected: string | null | undefined, _session?: string | null,
    _readonly?: boolean, incoming?: AbortSignal, _expected?: string, options?: { mode?: 'task' }) {
    events.push('lease-prepare'); assert.equal(selected, projectId); assert.equal(options?.mode, 'task');
    activeLease = true; prepareFailure?.();
    return { projectId: selected!, command: '', networkIsolation, signal: incoming!, terminalId: undefined,
      captured: { project: copyProject(project), configVersion: projectVersion(project), live: machines.live.get(vmId)! },
      async release() { activeLease = false; events.push('lease-release'); } };
  } };
  const processScope = {
    async status(_signal?: AbortSignal, sha?: string) {
      events.push('scope-status'); if (sha !== undefined && sha !== transportSha) throw changedDigest();
      return { status: !scopeRecord ? 'absent' as const : scopeRecord.phase === 'stopped' ? 'stopped' as const : 'running' as const,
        record: scopeRecord && structuredClone(scopeRecord), bootId };
    },
    newIntent(binding: string, boot: string) { const runId = randomUUID(); return projectNotebookRecordSchema.parse({ version: 1,
      projectId, name: 'notebook', session: 'sakura-notebook-' + projectId, runId, bootId: boot,
      scopeName: 'sakura-service-' + runId, inode: null, binding, phase: 'intent', sessionId: null, paneId: null, panePid: null, paneStartTicks: null }); },
    async persistIntent(record: ProjectNotebookRecord) { assert.equal(activeLease, true); events.push('outer-intent'); assert.equal(record.phase, 'intent'); },
    async start(record: ProjectNotebookRecord, payload: { command: string; input: Buffer; sha256: string }) {
      events.push('scope-start'); assert.equal(activeLease, true);
      const session = JSON.parse(await readFile(file, 'utf8')).sessions[0];
      assert.equal(session.status, 'starting'); assert.equal(session.execution.run, null); assert.deepEqual(session.execution.record, record);
      assert.equal(session.execution.sha256, createHash('sha256').update(payload.input).digest('hex'));
      assert.equal(session.execution.configSha256, projectVersion(project));
      transportSha = payload.sha256; frames.push(Buffer.from(payload.input)); rootLaunchCommands.push(payload.command);
      scopeRecord = { ...record, phase: 'running', inode: '900', sessionId: '$1', paneId: '%2', panePid: 555, paneStartTicks: '1111' };
      ticket = { version: 1, phase: 'active', mode: 'inherit-current', projectId, registryId, identityId, revision: 1,
        runId: record.runId, bootId: record.bootId, build: 'a'.repeat(64), cgroupName: record.scopeName,
        cgroupDevice: '29', cgroupInode: '900', networkDevice: '4', networkInode: '500', namespace: networkIsolation === 'private' ? 'sk-' + projectId : '' };
      if (startFailure) throw new Error('Notebook commit acknowledgement lost'); return structuredClone(scopeRecord);
    },
    async stop(record: ProjectNotebookRecord) {
      events.push('scope-stop'); if (cleanupFailure) throw new Error('whole original cgroup still populated');
      if (scopeRecord) assert.equal(record.runId, scopeRecord.runId);
      if (record.bootId !== bootId) events.push('reboot-retirement-without-native-stop');
      else { events.push('whole-domain-removed'); events.push('native-ticket-closed'); }
      if (scopeRecord) scopeRecord.phase = 'stopped';
    },
  };
  const scopes = {
    async identity(_vm: string, captured: Project) { assert.equal(activeLease, true); assert.equal(captured._workspace || 'default', projectId); events.push('identity');
      if (migration) throw new AppError('明确迁移原项目目录', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED'); return structuredClone(identity); },
    async inherited(_vm: string, captured: Project, execution: { command: string; environment?: Record<string, string> }, owner: { kind: string; runId: string; bootId: string }) {
      assert.equal(activeLease, true); events.push('identity-intent'); assert.equal(owner.kind, 'service'); assert.equal(owner.bootId, originalBoot);
      assert.equal(captured._workspace || 'default', projectId);
      assert.equal(captured.environment?.RESOLVED, 'resolved-secret-value'); assert.ok(events.includes('outer-intent'));
      const payload = projectIdentityPayload(execution), session = JSON.parse(await readFile(file, 'utf8')).sessions[0];
      assert.equal(session.execution.record.runId, owner.runId); assert.equal(session.execution.sha256, payload.sha256);
      if (inheritedFailure) throw new Error('native intent acknowledgement lost');
      return { identity: structuredClone(identity), runId: owner.runId, ...payload, command: '/fixed/controller --run ' + owner.runId + ' --payload ' + payload.sha256 };
    },
    async active() { events.push('activate-native'); if (nativeFailure) throw new Error('native run acknowledgement lost'); return ticket?.phase === 'active'; },
    async readonlyActive() { events.push('readonly-native'); return ticket?.phase === 'active'; },
  };
  const identities = { async runReadonly() { events.push('readonly-full-ticket'); return structuredClone(ticket!); } };
  const bridges = { async open(_vm: string, _project: Project, _guest: number, _host: number, _abort?: AbortSignal, allowShared?: boolean) {
    assert.equal(allowShared, true); events.push('bridge-open'); bridge = true;
  }, async stop() { events.push('bridge-stop'); bridge = false; }, async close() { bridge = false; } };
  const adminTask = (async (_machines: Machines, _vm: string, command: string) => {
    assert.equal(activeLease, true); rootCommands.push(command); events.push(command.startsWith('# SAKURA_NOTEBOOK_WHEELS') ?
      command.startsWith('# SAKURA_NOTEBOOK_WHEELS_DOWNLOAD') ? 'root-wheel-download' : 'root-wheel-cleanup' : 'root-system-tools');
    if (command.startsWith('# SAKURA_NOTEBOOK_WHEELS_DOWNLOAD')) {
      downloadHook?.(); const request = commandRequest(command);
      const lease = leaseFor(request); if (wrongLease) lease.bootId = randomUUID();
      return { code: 0, stdout: JSON.stringify(lease), stderr: '' };
    }
    if (command.startsWith('# SAKURA_NOTEBOOK_WHEELS_CLEANUP')) {
      if (wheelCleanupFailure) return { code: 1, stdout: '', stderr: 'wheel cleanup refused' };
      if (malformedWheelCleanup) return { code: 0, stdout: 'not-json cleanup acknowledgement', stderr: '' };
      return { code: 0, stdout: JSON.stringify({ cleaned: true, leaseId: commandRequest(command).leaseId }), stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  }) as typeof import('../server/guest-task.ts').guestTask;
  const runTask = (async (_machines: Machines, _vm: string, captured: Project, execution: { command: string; environment?: Record<string, string> },
    _signal: AbortSignal, _log: unknown, _timeout: unknown, _agent: unknown, _cleanup: unknown, expected: { expectedLive: object; expectedBootId: string }) => {
    assert.equal(activeLease, true); assert.equal(expected.expectedLive, live); assert.equal(expected.expectedBootId, originalBoot);
    assert.equal(captured._workspace || 'default', projectId);
    assert.equal(captured.environment?.RESOLVED, 'resolved-secret-value'); assert.deepEqual(execution.environment, captured.environment);
    events.push('uid-offline-install'); projectScripts.push(execution.command); frames.push(projectIdentityPayload(execution).input);
    if (installFailure) throw new AppError('UID cleanup unconfirmed resolved-secret-value', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    installed = true; events.push('uid-whole-task-domain-closed'); return { code: 0, stdout: '', stderr: '' };
  }) as typeof import('../server/project-run-scope.ts').projectIdentityTask;
  const options = { scopes, identities, terminals, processScope: () => processScope, bridges, adminTask, runTask,
    listener: async () => { events.push('uid-listener'); if (listenerGate) await listenerGate(); return listener; } };
  const probe = async () => { events.push('http-probe'); return bridge && listener; };
  const create = async () => { const service = new NotebookEnvironments(machines, workspaces, file, probe, options); await service.init(); t.after(() => service.close()); return service; };
  const service = await create();
  return { service, create, vmId, vm, file, identity, project, projectId, machines, rootCommands, rootLaunchCommands, projectScripts, frames, events,
    viewStore: async () => { try { return JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, sessions: [], environments: [] }; throw error; } },
    ticket: () => ticket!, scopeRecord: () => scopeRecord!,
    setInstalled: (value: boolean) => installed = value, setListener: (value: boolean) => listener = value,
    setState: (value: string) => machineState = value, setMigration: () => migration = true,
    failStart: () => startFailure = true, failCleanup: (value = true) => cleanupFailure = value,
    failNative: () => nativeFailure = true, failInherited: () => inheritedFailure = true,
    failInstall: () => installFailure = true, failWheelCleanup: () => wheelCleanupFailure = true,
    malformedWheelCleanup: () => malformedWheelCleanup = true,
    wrongLease: () => wrongLease = true, onDownload: (hook: () => void) => downloadHook = hook,
    onPrepare: (hook: () => void) => prepareFailure = hook, gateListener: (gate?: () => Promise<void>) => listenerGate = gate,
    onConfig: (hook?: () => void | Promise<void>) => configHook = hook,
    onBoot: (hook?: () => void | Promise<void>) => bootHook = hook,
    resolveScope: (value: string) => resolvedScope = value, configScope: (value: string) => configScope = value,
    currentScope: (value: string) => currentScope = value,
    newLive: () => { live = {}; machines.live.set(vmId, live as never); }, reboot: () => { bootId = randomUUID(); },
    setCurrent: (value: string) => currentProject = value, isBridged: () => bridge, leaseActive: () => activeLease };
}
const changedDigest = () => new AppError('Notebook 原正文摘要不符', 409, 'NOTEBOOK_SCOPE_CHANGED');

for (const provider of ['jupyter', 'marimo'] as const)
test(`named ${provider}: non-enumerable original scope survives preparation, UID installation and protected service execution`, async t => {
  const f = await fixture(t, 'private', '0123456789abcdef'); f.setInstalled(false);
  assert.equal(Object.getOwnPropertyDescriptor(f.project, '_workspace')?.enumerable, false);
  assert.equal(structuredClone(f.project)._workspace, undefined);
  const result = await f.service.run(f.vmId, { mode: 'start', provider, hostPort: 18888 }, signal, () => {});
  assert.equal(result.session?.status, 'running');
  const session = (await f.viewStore()).sessions[0];
  assert.equal(session.projectId, f.projectId); assert.equal(session.execution.identity.projectId, f.projectId);
  assert.equal(session.execution.record.projectId, f.projectId); assert.equal(session.execution.run.namespace, 'sk-' + f.projectId);
  assert.equal(session.execution.configSha256, projectVersion(f.project));
  assert.ok(f.events.includes('uid-offline-install')); assert.ok(f.events.includes('identity-intent'));
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
});

for (const stage of ['resolve', 'config'] as const)
test(`matching serialized config with wrong ${stage} scope cannot issue identity, download or execute project code`, async t => {
  const f = await fixture(t, 'private', '0123456789abcdef'); f.setInstalled(false);
  const other = Object.defineProperty(structuredClone(f.project), '_workspace', { value: 'fedcba9876543210', enumerable: false });
  assert.equal(projectVersion(other), projectVersion(f.project)); assert.notEqual(other._workspace, f.project._workspace);
  if (stage === 'resolve') f.resolveScope(other._workspace!); else f.configScope(other._workspace!);
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.code === 'NOTEBOOK_SCOPE_CHANGED');
  for (const event of ['identity', 'root-system-tools', 'root-wheel-download', 'uid-offline-install', 'identity-intent'])
    assert.equal(f.events.includes(event), false);
  assert.equal(f.leaseActive(), false);
});

for (const mutation of ['live', 'scope', 'paused'] as const)
test(`an asynchronous config reply cannot admit a captured task after original ${mutation} changes`, async t => {
  const f = await fixture(t, 'host', '0123456789abcdef'); f.setInstalled(false);
  f.onConfig(async () => {
    await Promise.resolve();
    if (mutation === 'live') f.newLive(); else if (mutation === 'scope') f.currentScope('fedcba9876543210'); else f.setState('paused');
  });
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/);
  for (const event of ['identity', 'root-system-tools', 'root-wheel-download', 'uid-offline-install']) assert.equal(f.events.includes(event), false);
  assert.equal(f.leaseActive(), false);
});

test('boot reply cannot admit a replaced live instance even when its boot UUID is unchanged', async t => {
  const f = await fixture(t); f.setInstalled(false); let observations = 0;
  f.onBoot(async () => { await Promise.resolve(); if (++observations === 2) f.newLive(); });
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/);
  assert.equal(f.events.includes('identity'), false); assert.equal(f.events.includes('root-system-tools'), false); assert.equal(f.leaseActive(), false);
});

test('administrator system dependency body executes with only the fixed root environment', () => {
  for (const distro of ['alpine', 'ubuntu']) {
    const command = notebookToolsScript(distro, randomUUID());
    assert.ok(command.startsWith('exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PIP_CONFIG_FILE=/dev/null /bin/sh -ec '));
    assert.ok(command.includes('cd /')); assert.equal(command.includes('PYTHONPATH'), false);
    assert.equal(command.includes('private-hook'), false); assert.equal(command.includes('source '), false);
    assert.ok(command.includes('/usr/bin/python3 -I -m pip'));
  }
});

for (const provider of ['jupyter', 'marimo'] as const) for (const network of ['host', 'private'] as const)
test(`${provider}/${network}: original UID service, home, protected token and full ticket use a validated loopback bridge`, async t => {
  const f = await fixture(t, network); const result = await f.service.run(f.vmId, { mode: 'start', provider, hostPort: 18888 }, signal, () => {});
  assert.ok('session' in result); assert.equal(result.session?.status, 'running'); const session = (await f.viewStore()).sessions[0], frame = f.frames[0];
  const script = frame.subarray(32, 32 + frame.readUInt32LE(24)).toString();
  assert.ok(script.includes('127.0.0.1')); assert.ok(script.includes('$HOME/.local/share/sakura-notebooks'));
  assert.equal(script.includes('--allow-root'), false); assert.equal(script.includes('0.0.0.0'), false); assert.equal(script.includes('/root'), false);
  assert.ok(frame.includes(Buffer.from(session.token))); assert.ok(frame.includes(Buffer.from('resolved-secret-value')));
  for (const command of [...f.rootCommands, ...f.rootLaunchCommands]) {
    assert.equal(command.includes(session.token), false); assert.equal(command.includes('resolved-secret-value'), false);
    assert.equal(command.includes('notebook-private-雪'), false);
  }
  assert.deepEqual(session.execution.identity, f.identity); assert.deepEqual(session.execution.run, f.ticket());
  assert.deepEqual(session.execution.record, f.scopeRecord()); assert.deepEqual(f.vm.forwards, []);
  assert.ok(f.events.indexOf('lease-prepare') < f.events.indexOf('identity-intent'));
  assert.ok(f.events.indexOf('readonly-full-ticket') < f.events.indexOf('bridge-open'));
  assert.ok(f.events.indexOf('uid-listener') < f.events.indexOf('http-probe')); assert.equal(f.leaseActive(), false);
  const link = await f.service.link(f.vmId); assert.ok(link.url.includes(session.token));
  assert.equal(JSON.stringify(result).includes(session.token), false); assert.equal(JSON.stringify(await f.service.view(f.vmId)).includes(session.token), false);
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
  assert.ok(f.events.indexOf('whole-domain-removed') < f.events.indexOf('native-ticket-closed'));
  assert.deepEqual((await f.viewStore()).sessions, []);
});

test('venv and strict offline wheel install execute only within captured UID task, with an original protected wheel lease', async t => {
  const f = await fixture(t, 'private'); f.setInstalled(false);
  await f.service.run(f.vmId, { mode: 'install', provider: 'jupyter' }, signal, () => {});
  const root = f.rootCommands.filter(command => !command.startsWith('# SAKURA_NOTEBOOK_INSTALLED'));
  for (const command of root) for (const value of [f.project.directory, '/private/bin', '/private/pip.conf', 'private-hook', 'resolved-secret-value'])
    assert.equal(command.includes(value), false, value);
  const download = root.find(command => command.startsWith('# SAKURA_NOTEBOOK_WHEELS_DOWNLOAD'))!;
  assert.ok(download.includes('https://pypi.org/simple')); assert.ok(download.includes('PIP_CONFIG_FILE=/dev/null'));
  assert.ok(decodeSource(download).includes("'/usr/bin/python3','-I','-m','pip','--isolated','download'"));
  assert.ok(download.includes('--only-binary=:all:')); assert.ok(download.includes('subprocess.DEVNULL'));
  const task = f.projectScripts[0]; assert.ok(task.includes('venv --without-pip'));
  assert.ok(task.includes('--no-index')); assert.ok(task.includes('--only-binary=:all:')); assert.ok(task.includes('--no-cache-dir'));
  const decodedTask = task.replaceAll("'\\''", "'");
  assert.ok(decodedTask.includes("lease['manifestSha256']")); assert.ok(decodedTask.includes("expected['sha256']")); assert.ok(task.includes('O_NOFOLLOW'));
  assert.ok(f.events.indexOf('uid-whole-task-domain-closed') < f.events.indexOf('root-wheel-cleanup'));
  assert.equal((await f.viewStore()).environments[0].identity.uid, f.identity.uid); assert.equal(f.leaseActive(), false);
});

test('explicit legacy directory migration refusal occurs before shared download or any UID execution', async t => {
  const f = await fixture(t); f.setMigration(); f.setInstalled(false);
  await assert.rejects(f.service.run(f.vmId, { mode: 'start' }, signal, () => {}), /明确迁移/);
  assert.equal(f.events.includes('root-system-tools'), false); assert.equal(f.events.includes('root-wheel-download'), false);
  assert.equal(f.events.includes('identity-intent'), false); assert.equal(f.events.includes('uid-offline-install'), false); assert.equal(f.leaseActive(), false);
});

for (const mutation of ['config', 'live', 'boot'] as const) test(`captured ${mutation} change during administrator download refuses UID installation and releases its lease`, async t => {
  const f = await fixture(t); f.setInstalled(false);
  f.onDownload(() => { if (mutation === 'config') f.project.environment!.TOKEN = 'changed'; else if (mutation === 'live') f.newLive(); else f.reboot(); });
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/);
  assert.equal(f.events.includes('uid-offline-install'), false); assert.equal(f.events.includes('root-wheel-cleanup'), false);
  assert.equal(f.leaseActive(), false);
});

test('wrong downloaded boot lease cannot enter UID code', async t => {
  const f = await fixture(t); f.setInstalled(false); f.wrongLease();
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/);
  assert.equal(f.events.includes('uid-offline-install'), false);
});

test('uncertain original UID task cleanup preserves wheel cache and redacts the project secret', async t => {
  const f = await fixture(t); f.setInstalled(false); f.failInstall();
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && !error.message.includes('resolved-secret-value'));
  assert.equal(f.events.includes('root-wheel-cleanup'), false); assert.equal((await f.viewStore()).environments.length, 0);
  assert.equal(f.leaseActive(), false);
});

test('wheel cache cleanup failure never reports an installed environment', async t => {
  const f = await fixture(t); f.setInstalled(false); f.failWheelCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.code === 'NOTEBOOK_PREPARE_CLEANUP_FAILED');
  assert.equal((await f.viewStore()).environments.length, 0);
});

test('garbage cleanup acknowledgement is an explicit 503 and preserves the complete original cache lease for review', async t => {
  const f = await fixture(t); f.setInstalled(false); f.malformedWheelCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.status === 503 && error.code === 'NOTEBOOK_PREPARE_CLEANUP_FAILED');
  const request = commandRequest(f.rootCommands.find(command => command.startsWith('# SAKURA_NOTEBOOK_WHEELS_DOWNLOAD'))!);
  const file = join(vmDir(f.vmId), 'project-notebooks', f.projectId, 'wheelhouses', request.leaseId + '.json');
  const metadata = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(metadata.phase, 'review'); assert.deepEqual(metadata.lease, leaseFor(request));
  assert.equal((await f.viewStore()).environments.length, 0); assert.equal(f.leaseActive(), false);
});

test('readonly reload and link do not advance host receipts, issue preparation, or install anything', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  await f.service.close(); const before = await readFile(f.file), reopened = await f.create(); f.events.length = 0;
  assert.equal((await reopened.view(f.vmId)).session?.status, 'running'); await reopened.link(f.vmId);
  assert.deepEqual(await readFile(f.file), before);
  for (const event of ['lease-prepare', 'identity', 'outer-intent', 'identity-intent', 'activate-native', 'root-system-tools']) assert.equal(f.events.includes(event), false);
});

test('healthy HTTP cannot replace original native inode, boot, run or build', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  const original = { ...f.ticket() };
  for (const substitution of [{ cgroupInode: '901' }, { bootId: randomUUID() }, { runId: randomUUID() }, { build: 'b'.repeat(64) }]) {
    Object.assign(f.ticket(), original, substitution); f.events.length = 0; const before = await readFile(f.file);
    await assert.rejects(f.service.link(f.vmId), /原项目/); assert.equal(f.isBridged(), false);
    assert.equal(f.events.includes('http-probe'), false); assert.deepEqual(await readFile(f.file), before);
  }
});

test('an HTTP listener with the wrong ownership cannot reopen a bridge', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}); f.setListener(false);
  f.events.length = 0; await assert.rejects(f.service.link(f.vmId), /原项目/); assert.equal(f.events.includes('http-probe'), false);
  const source = decodeSource(notebookListenerCommand((await f.viewStore()).sessions[0]));
  for (const needle of ["status.get('Uid'", "status.get('Gid'", 'before[19]==after[19]', 'socket:[', "request['cgroupInode']", '0100007F:']) assert.ok(source.includes(needle));
});

test('changed captured environment or directory refuses readonly access while original-owner stop remains possible', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  f.project.environment!.TOKEN = 'changed'; await assert.rejects(f.service.link(f.vmId), /原项目/);
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}); assert.deepEqual((await f.viewStore()).sessions, []);
});

for (const failure of ['start', 'inherited', 'native'] as const) test(`lost ${failure} acknowledgement preserves original cleanup ownership until full-domain retry succeeds`, async t => {
  const f = await fixture(t); f.failCleanup(); if (failure === 'start') f.failStart(); else if (failure === 'inherited') f.failInherited(); else f.failNative();
  await assert.rejects(f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.code === 'NOTEBOOK_CLEANUP_FAILED' && error.status === 503 && error.message.includes('acknowledgement lost'));
  const record = (await f.viewStore()).sessions[0]; assert.equal(record.status, 'review'); assert.equal(record.execution.run, null);
  const reopened = await f.create(), before = await readFile(f.file); f.events.length = 0;
  await assert.rejects(reopened.link(f.vmId)); assert.deepEqual(await readFile(f.file), before); assert.equal(f.events.includes('bridge-open'), false);
  f.failCleanup(false); await reopened.run(f.vmId, { mode: 'stop' }, signal, () => {}); assert.deepEqual((await f.viewStore()).sessions, []);
});

test('failed whole-domain stop retains complete original record and permanently closes its entrance until explicit retry', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  const original = (await f.viewStore()).sessions[0].execution; f.failCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}), /完整运行域清理未确认/);
  const saved = (await f.viewStore()).sessions[0]; assert.deepEqual(saved.execution, original); assert.equal(saved.status, 'review');
  await assert.rejects(f.service.link(f.vmId)); assert.equal(f.isBridged(), false); f.failCleanup(false);
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
});

test('cold reboot readonly rejects the original full run and explicit stop never sends native stop into the new boot', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}); f.reboot();
  const before = await readFile(f.file); await assert.rejects(f.service.link(f.vmId)); assert.deepEqual(await readFile(f.file), before);
  f.events.length = 0; await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
  assert.ok(f.events.includes('reboot-retirement-without-native-stop')); assert.equal(f.events.includes('native-ticket-closed'), false);
  assert.deepEqual((await f.viewStore()).sessions, []);
});

test('paused VM cannot discard an original Notebook execution', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  const before = await readFile(f.file); f.setState('paused'); await assert.rejects(f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}), /启动或恢复/);
  assert.deepEqual(await readFile(f.file), before);
});

test('legacy root record remains unchanged for review and never gets tmux-name cleanup authority', async t => {
  const f = await fixture(t), old = { vmId: f.vmId, projectId: 'default', provider: 'jupyter', directory: f.project.directory,
    guestPort: 8888, hostPort: 18888, token: 'a'.repeat(64), createdForward: true, networkIsolation: 'host', status: 'starting', startedAt: new Date().toISOString() };
  await f.service.close(); await writeFile(f.file, JSON.stringify({ version: 1, sessions: [old] }));
  const before = await readFile(f.file), reopened = await f.create();
  assert.equal((await reopened.view(f.vmId)).session?.needsReview, true); assert.equal((await reopened.view(f.vmId)).session?.status, 'review');
  await assert.rejects(reopened.link(f.vmId), /旧 Notebook/); await assert.rejects(reopened.run(f.vmId, { mode: 'stop' }, signal, () => {}), /旧 Notebook/);
  assert.deepEqual(await readFile(f.file), before); assert.equal(f.events.includes('scope-stop'), false);
  assert.equal(f.rootCommands.some(command => command.includes('tmux kill-session')), false);
});

test('a stopped stale status cannot reopen the old Notebook bridge', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  let release!: () => void, reached = false; const gate = new Promise<void>(done => release = done);
  f.gateListener(async () => { reached = true; await gate; }); const view = f.service.view(f.vmId);
  for (let i = 0; i < 100 && !reached; i++) await new Promise(done => setTimeout(done, 5)); assert.equal(reached, true);
  const stopping = f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}); release(); await stopping; await view;
  assert.equal(f.isBridged(), false); assert.equal((await f.service.view(f.vmId)).session, null);
});

test('malformed immutable Notebook receipt cannot be made healthy by HTTP', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}); await f.service.close();
  const store = await f.viewStore(); store.sessions[0].execution.run = null; await writeFile(f.file, JSON.stringify(store));
  const before = await readFile(f.file); await assert.rejects(f.create()); assert.deepEqual(await readFile(f.file), before);
  store.sessions[0].execution.run = f.ticket(); store.sessions[0].execution.sha256 = 'b'.repeat(64); await writeFile(f.file, JSON.stringify(store));
  const reopened = await f.create(); await assert.rejects(reopened.link(f.vmId), /原正文摘要/);
});

test('Notebook namespace, runtime receipt and service UUID never reserve user service names or Browser namespaces', async t => {
  const f = await fixture(t), paths = projectNotebookScopePaths(f.project);
  assert.equal(paths.guest, '/run/sakura-notebook/default'); assert.equal(paths.session, 'sakura-notebook-default');
  assert.notEqual(paths.guest, projectServiceScopePaths(f.project, 'notebook').guest);
  assert.notEqual(paths.session, projectServiceScopePaths(f.project, 'notebook').session);
  assert.notEqual(paths.guest, projectBrowserIdeScopePaths(f.project).guest);
  const scope = new ProjectNotebookScope(f.machines, f.vmId, f.project), intent = scope.newIntent('a'.repeat(64), randomUUID());
  assert.equal(scope.receipt(), join(vmDir(f.vmId), 'project-notebooks/default/runtime.json'));
  assert.equal(intent.scopeName, 'sakura-service-' + intent.runId); assert.equal(intent.name, 'notebook');
  assert.throws(() => projectNotebookRecordSchema.parse({ ...intent, session: 'sakura-service-notebook' }));
  assert.throws(() => notebookSessionSchema.parse({ vmId: f.vmId, projectId: 'default', provider: 'jupyter', directory: f.project.directory,
    guestPort: 8888, hostPort: 18888, token: 'a'.repeat(64), createdForward: true, status: 'running', startedAt: new Date().toISOString(),
    execution: { identity: f.identity, record: intent, run: null, sha256: 'a'.repeat(64), configSha256: projectVersion(f.project) } }));
});

test('root helpers parse as isolated Python and wheel file regex accepts wheels but refuses paths and code suffixes', async t => {
  const f = await fixture(t), lease = leaseFor(notebookWheelRequest(randomUUID(), 'jupyter'));
  const intent = new ProjectNotebookScope(f.machines, f.vmId, f.project).newIntent('a'.repeat(64), randomUUID());
  const input = projectIdentityPayload({ command: 'echo owned', environment: { TOKEN: 'private' } });
  const commands = [notebookWheelhouseCommand('download', { leaseId: lease.leaseId, bootId: lease.bootId, provider: lease.provider }),
    notebookWheelhouseCommand('cleanup', lease), notebookInstalledCommand(f.identity, 'jupyter'),
    projectNotebookScopeCommand(f.project, 'start', intent, { ...input, runId: intent.runId, command: '/fixed/native/controller' })];
  for (const command of commands) {
    const source = command.startsWith('# SAKURA_PROJECT_SERVICE') ? command.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", "'") : decodeSource(command);
    const parsed = spawnSync('python', ['-I', '-S', '-c', 'import ast,sys;ast.parse(sys.stdin.read())'], { input: source, encoding: 'utf8', windowsHide: true });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
  const downloaded = decodeSource(commands[0]), check = `import ast,json,re,sys\nroot=ast.parse(sys.stdin.read())\n` +
    `patterns=list({node.args[0].value for node in ast.walk(root) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='fullmatch' and isinstance(node.args[0],ast.Constant) and node.args[0].value.endswith('whl')})\n` +
    `assert len(patterns)==1\nassert re.fullmatch(patterns[0],'pip-25.0-py3-none-any.whl')\n` +
    `assert not re.fullmatch(patterns[0],'../pip.whl')\nassert not re.fullmatch(patterns[0],'evil.py')\n`;
  const regex = spawnSync('python', ['-I', '-S', '-c', check], { input: downloaded, encoding: 'utf8', windowsHide: true });
  assert.equal(regex.status, 0, regex.stderr);
  const code = notebookInstallExecution(f.identity, lease); assert.ok(code.includes('runpy')); assert.ok(code.includes('--without-pip'));
  const tools = notebookToolsScript('ubuntu', lease.bootId); assert.ok(tools.includes('cd /')); assert.equal(tools.includes(f.project.directory), false);
});

test('untrusted wheel lease paths, duplicate entries and oversized cache metadata are refused before generating Root commands', () => {
  const lease = leaseFor(notebookWheelRequest(randomUUID(), 'marimo'));
  for (const changed of [{ path: '/root' }, { files: [...lease.files, lease.files[0]] }, { files: [{ ...lease.files[0], name: '../evil.whl' }] },
    { device: '1'.repeat(21) }, { inode: '1'.repeat(21) },
    { files: [{ ...lease.files[0], bytes: 1024 * 1024 * 1024 }] }]) assert.throws(() => notebookWheelhouseCommand('cleanup', { ...lease, ...changed }));
  assert.throws(() => notebookInstallExecution({} as never, { ...lease, files: lease.files.filter(file => !file.name.startsWith('pip-')) }));
});

test('actual Python wheel verifier and cache retirement reject substituted ownership, content and late directory replacements', () => {
  const request = notebookWheelRequest(randomUUID(), 'jupyter'), source = decodeSource(notebookWheelhouseCommand('download', request));
  const cleanup = decodeSource(notebookWheelhouseCommand('cleanup', leaseFor(request)));
  const program = `import ast,copy,hashlib,json,stat,sys,types
bundle=json.loads(sys.stdin.read());tree=ast.parse(bundle['verify']);nodes=[]
for node in tree.body:
 if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='request' for target in node.targets):break
 nodes.append(node)
namespace={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'wheel-verifier','exec'),namespace)
path='/var/cache/sakura/notebook-wheels/00000000-0000-0000-0000-000000000001'
files=[{'name':'pip-25.0-py3-none-any.whl','sha256':hashlib.sha256(b'wheelbytes').hexdigest(),'bytes':10,'device':'1','inode':'21'}]
lease={'version':1,'leaseId':path.rsplit('/',1)[1],'bootId':'00000000-0000-0000-0000-000000000002','provider':'jupyter','path':path,'device':'1','inode':'20','files':files}
manifest=json.dumps(lease,sort_keys=True,separators=(',',':')).encode();lease['manifestSha256']=hashlib.sha256(manifest).hexdigest()
class Files:
 O_RDONLY=0;O_DIRECTORY=1;O_NOFOLLOW=2;O_NONBLOCK=4;O_CLOEXEC=8
 def __init__(self):
  self.next=1;self.fds={};self.positions={};self.entries={};self.late=None
  for index,folder in enumerate(['/','/var','/var/cache','/var/cache/sakura','/var/cache/sakura/notebook-wheels',path]):self.entries[folder]={'mode':stat.S_IFDIR|0o555,'inode':20 if folder==path else index+1,'uid':0,'data':b''}
  self.entries[path+'/pip-25.0-py3-none-any.whl']={'mode':stat.S_IFREG|0o444,'inode':21,'uid':0,'data':b'wheelbytes'}
  self.entries[path+'/.manifest.json']={'mode':stat.S_IFREG|0o444,'inode':22,'uid':0,'data':manifest}
 def open(self,name,flags,dir_fd=None):
  file=(self.fds[dir_fd].rstrip('/')+'/'+name) if dir_fd is not None else name
  if file not in self.entries:raise FileNotFoundError(file)
  entry=self.entries[file]
  if flags&self.O_NOFOLLOW and stat.S_ISLNK(entry['mode']):raise OSError('symlink')
  fd=self.next;self.next+=1;self.fds[fd]=file;self.positions[fd]=0;return fd
 def close(self,fd):del self.fds[fd];del self.positions[fd]
 def fstat(self,fd):
  entry=self.entries[self.fds[fd]];return types.SimpleNamespace(st_uid=entry['uid'],st_gid=0,st_mode=entry['mode'],st_nlink=1,st_dev=1,st_ino=entry['inode'],st_size=len(entry['data']),st_mtime_ns=1,st_ctime_ns=1)
 def read(self,fd,count):
  entry=self.entries[self.fds[fd]];start=self.positions[fd];self.positions[fd]+=count;return entry['data'][start:start+count]
 def listdir(self,fd):
  prefix=self.fds[fd]+'/';return [key[len(prefix):] for key in self.entries if key.startswith(prefix) and '/' not in key[len(prefix):]]
 def fchmod(self,fd,mode):self.entries[self.fds[fd]]['mode']=(self.entries[self.fds[fd]]['mode']&0o170000)|mode
 def fsync(self,fd):assert fd in self.fds
 def stat(self,name,dir_fd=None,follow_symlinks=False):
  fd=self.open(name,self.O_NOFOLLOW,dir_fd=dir_fd)
  try:return self.fstat(fd)
  finally:self.close(fd)
 def unlink(self,name,dir_fd):
  file=self.fds[dir_fd]+'/'+name;del self.entries[file]
  if name=='.manifest.json' and self.late=='inode':self.entries[path]['inode']=99
  if name=='.manifest.json' and self.late=='extra':self.entries[path+'/late.whl']={'mode':stat.S_IFREG|0o444,'inode':99,'uid':0,'data':b'late'}
 def rmdir(self,name,dir_fd):
  folder=self.fds[dir_fd]+'/'+name
  if any(key.startswith(folder+'/') for key in self.entries):raise OSError('not empty')
  del self.entries[folder]
  if self.late=='reappeared':self.entries[folder]={'mode':stat.S_IFDIR|0o555,'inode':99,'uid':0,'data':b''}
def check(change=None):
 model=Files()
 if change:change(model)
 namespace['os']=model
 try:
  fd=namespace['verified'](copy.deepcopy(lease));model.close(fd);return True
 except (ValueError,OSError):return False
assert check()
compact={key:value for key,value in lease.items() if key!='files'};saved=lease;lease=compact;assert check();lease=saved
for change in [lambda model:model.entries[path+'/pip-25.0-py3-none-any.whl'].update(data=b'badcontent'),lambda model:model.entries[path+'/pip-25.0-py3-none-any.whl'].update(inode=99),lambda model:model.entries[path].update(uid=20001),lambda model:model.entries[path].update(inode=99),lambda model:model.entries[path+'/.manifest.json'].update(data=manifest+b' '),lambda model:model.entries.update({path+'/evil.py':{'mode':stat.S_IFREG|0o444,'inode':30,'uid':0,'data':b'bad'}}),lambda model:model.entries[path+'/pip-25.0-py3-none-any.whl'].update(mode=stat.S_IFLNK|0o777)]:assert not check(change)
retirement=next(node.orelse for node in ast.parse(bundle['cleanup']).body if isinstance(node,ast.If) and isinstance(node.test,ast.Compare) and isinstance(node.test.left,ast.Name) and node.test.left.id=='operation')
retirement=compile(ast.Module(body=retirement,type_ignores=[]),'wheel-retirement','exec')
for change in [None,'inode','extra','reappeared']:
 model=Files();model.late=change;receipts=[]
 namespace['os']=model;namespace['request']={key:value for key,value in lease.items() if key!='files'};namespace['print']=receipts.append
 try:exec(retirement,namespace)
 except (ValueError,OSError):assert change is not None and not receipts
 else:assert change is None and path not in model.entries and json.loads(receipts[0])=={'cleaned':True,'leaseId':lease['leaseId']}
 assert not model.fds
print('1 original wheelhouse accepted; 7 ownership/content substitutions refused; 1 exact retirement and 3 late replacements checked')
`;
  const result = spawnSync('python', ['-I', '-S', '-c', program], { input: JSON.stringify({ verify: source, cleanup }), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes('7 ownership/content substitutions refused'));
  assert.ok(result.stdout.includes('1 exact retirement and 3 late replacements checked'));
});

test('starting full receipt reload remains review without opening a listener or advancing host state', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}); await f.service.close();
  const store = await f.viewStore(); store.sessions[0].status = 'starting'; await writeFile(f.file, JSON.stringify(store));
  const before = await readFile(f.file), reopened = await f.create(); f.events.length = 0;
  assert.equal((await reopened.view(f.vmId)).session?.needsReview, true); await assert.rejects(reopened.link(f.vmId));
  assert.deepEqual(await readFile(f.file), before); assert.equal(f.events.includes('bridge-open'), false); assert.equal(f.events.includes('http-probe'), false);
  await reopened.run(f.vmId, { mode: 'stop' }, signal, () => {});
});

test('real Notebook scope status pins saved transport metadata and rejects an immutable digest substitution', async t => {
  const f = await fixture(t), scope = new ProjectNotebookScope(f.machines, f.vmId, f.project), bootId = randomUUID();
  const intent = scope.newIntent('a'.repeat(64), bootId), record = { ...intent, inode: '900', phase: 'running', sessionId: '$1', paneId: '%2', panePid: 555, paneStartTicks: '1111' };
  await mkdir(join(scope.receipt(), '..'), { recursive: true }); await writeFile(scope.receipt(), JSON.stringify(record));
  const input = projectIdentityPayload({ command: 'sleep 900' });
  await writeFile(join(scope.receipt(), '..', 'transport-' + intent.runId + '.json'), JSON.stringify({ version: 1, record,
    sha256: input.sha256, bytes: input.input.length, commandSha256: 'b'.repeat(64) }));
  const originalExec = f.machines.exec;
  f.machines.exec = async (_vm, command) => { assert.ok(command.includes('/run/sakura-notebook'));
    return { code: 0, stdout: JSON.stringify({ status: 'running', bootId, record }), stderr: '' }; };
  const before = await readFile(scope.receipt()); assert.equal((await scope.status(signal, input.sha256)).status, 'running');
  await assert.rejects(scope.status(signal, 'f'.repeat(64)), /受保护正文/); assert.deepEqual(await readFile(scope.receipt()), before);
  f.machines.exec = originalExec;
});

test('maximum wheel metadata remains a compact, protected ABI1 frame rather than a Root command', async t => {
  const f = await fixture(t), lease = leaseFor(notebookWheelRequest(randomUUID(), 'jupyter'));
  lease.files = [lease.files[0], ...Array.from({ length: 511 }, (_, index) => ({ ...lease.files[1],
    name: 'notebook_dependency_' + index + '-1.0-py3-none-any.whl', inode: String(300 + index) }))];
  const command = notebookInstallExecution(f.identity, lease), frame = projectIdentityPayload({ command, environment: { TOKEN: 'private' } });
  assert.ok(frame.input.length < 16384); assert.equal(command.includes('notebook_dependency_500'), false);
  assert.ok(command.includes(lease.manifestSha256));
  const download = decodeSource(notebookWheelhouseCommand('download', { leaseId: lease.leaseId, bootId: lease.bootId, provider: lease.provider }));
  assert.ok(download.includes('os.fchmod(manifest,0o444)'), 'UID read access must survive the administrator umask');
});

test('512 maximum length wheel names never expand the administrator cleanup argv or lose the pinned manifest file set', async t => {
  const f = await fixture(t), lease = leaseFor(notebookWheelRequest(randomUUID(), 'marimo'));
  lease.device = '9'.repeat(20); lease.inode = '9'.repeat(20);
  lease.files = [lease.files[0], ...Array.from({ length: 511 }, (_, index) => ({ ...lease.files[1],
    name: 'wheel_' + String(index).padStart(3, '0') + '_'.repeat(232) + '.whl', inode: String(300 + index) }))];
  const small = notebookWheelhouseCommand('cleanup', { ...lease, files: leaseFor({ leaseId: lease.leaseId, bootId: lease.bootId, provider: lease.provider }).files });
  const command = notebookWheelhouseCommand('cleanup', lease), source = decodeSource(command), request = commandRequest(command);
  assert.equal(Buffer.byteLength(command), Buffer.byteLength(small)); assert.ok(Buffer.byteLength(command) < 16384);
  assert.ok(source.includes('fd,manifest=verified(request,True)')); assert.ok(source.includes("for item in manifest['files']:os.unlink"));
  assert.equal('files' in request, false); assert.equal(request.manifestSha256, lease.manifestSha256);
  assert.ok(source.includes("os.rmdir(request['leaseId'],dir_fd=parent)")); assert.ok(source.includes('else:refuse()'));
  const frame = projectIdentityPayload({ command: notebookInstallExecution(f.identity, lease) });
  assert.ok(frame.input.length < 16384); assert.equal(frame.input.includes(Buffer.from(lease.files[511].name)), false);
});
