import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserIde, browserIdeListenerCommand, browserIdeSessionSchema } from '../server/browser-ide.ts';
import { projectBrowserIdeRecordSchema, projectBrowserIdeScopePaths, projectBrowserIdeScopeCommand,
  projectServiceScopePaths, type ProjectBrowserIdeRecord } from '../server/project-service-scope.ts';
import { projectIdentityPayload, projectIdentitySchema, type ProjectIdentityRun } from '../server/project-identity.ts';
import { DATA, AppError, createSchema } from '../server/model.ts';
import { spawnSync } from 'node:child_process';
import type { Machines } from '../server/machines.ts';
import type { Project, Workspaces } from '../server/workspaces.ts';

const signal = new AbortController().signal;
const controllerSource = (command: string) => command.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", "'");
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }, networkIsolation: 'host' | 'private' = 'host') {
  await mkdir(DATA, { recursive: true });
  const directory = await mkdtemp(join(DATA, 'browser-ide-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vmId = randomUUID(), identityId = randomUUID(), registryId = randomUUID(), bootId = randomUUID();
  const identity = projectIdentitySchema.parse({ version: 1, phase: 'active', projectId: 'default', identityId, registryId,
    revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '12', homeInode: '21',
    directory: '/srv/project', directoryDevice: '12', directoryInode: '22', networkIsolation });
  const vm = { ...createSchema.parse({ name: 'browser-uid-fixture', distro: 'debian' }), id: vmId, snapshots: [], createdAt: new Date().toISOString() };
  let currentProject = 'default', guestState = 'running', migration = false, listener = true, installed = true;
  let scopeRecord: ProjectBrowserIdeRecord | null = null, ticket: ProjectIdentityRun | null = null, transportHash: string | null = null;
  let startFailure = false, cleanupFailure = false, activeFailure = false, inheritedFailure = false, proofDelay: (() => Promise<void>) | undefined;
  const live = {}, commands: string[] = [], events: string[] = [], frames: Buffer[] = [], rootLaunchCommands: string[] = [];
  const file = join(directory, 'browser-ide.json');
  const project = { _workspace: 'default', directory: identity.directory, networkIsolation, template: 'none', repository: '', setup: '', command: '',
    environment: { TOKEN: 'private-browser-token-雪', BASH_ENV: 'private-browser-init;$(id)', LD_PRELOAD: 'private-browser-lib' } } as Project;
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[vmId, live]]), get: () => vm, state: () => guestState, requireUnlocked() {}, reserveHostPorts() {},
    locked: async (_id: string, work: () => Promise<unknown>) => work(),
    exec: async (_id: string, command: string) => { commands.push(command);
      if (command.startsWith('test -x')) return { code: installed ? 0 : 1, stdout: '', stderr: '' };
      if (command.includes('sha256sum -c -')) installed = true;
      return { code: 0, stdout: '', stderr: '' }; },
    setForwards: async () => { assert.fail('UID browser IDE always owns a loopback bridge, never a QEMU forward'); },
  }) as unknown as Machines;
  const workspaces = { projects: { current: () => currentProject }, config: async () => project,
    resolvedConfig: async () => project } as unknown as Workspaces;
  const processScope = {
    async status(_signal?: AbortSignal, expectedSha256?: string) { events.push('scope-status'); if (proofDelay) await proofDelay();
      if (expectedSha256 !== undefined && transportHash !== expectedSha256) throw new AppError('正文摘要与原记录不符', 409, 'BROWSER_IDE_SCOPE_CHANGED');
      return { status: scopeRecord ? scopeRecord.phase === 'running' ? 'running' as const : scopeRecord.phase === 'stopped' ? 'stopped' as const : 'prepared' as const : 'absent' as const,
        record: scopeRecord && structuredClone(scopeRecord), bootId }; },
    newIntent(binding: string, currentBoot: string) { const runId = randomUUID(); return projectBrowserIdeRecordSchema.parse({ version: 1, name: 'browser-ide',
      projectId: 'default', session: 'sakura-browser-ide-default', runId, bootId: currentBoot,
      scopeName: 'sakura-service-' + runId, inode: null, binding, phase: 'intent', sessionId: null, paneId: null, panePid: null, paneStartTicks: null }); },
    async persistIntent(record: ProjectBrowserIdeRecord) { events.push('outer-intent'); assert.equal(record.phase, 'intent'); },
    async start(record: ProjectBrowserIdeRecord, payload: { input: Buffer; command: string }) {
      events.push('scope-start'); const session = JSON.parse(await readFile(file, 'utf8')).sessions[0];
      assert.equal(session.status, 'starting'); assert.equal(session.execution.run, null);
      assert.deepEqual(session.execution.record, record, 'full browser intent predates the first project execution');
      assert.equal(session.execution.sha256, createHash('sha256').update(payload.input).digest('hex'));
      transportHash = session.execution.sha256;
      frames.push(Buffer.from(payload.input)); rootLaunchCommands.push(payload.command);
      scopeRecord = { ...record, phase: 'running', inode: '900', sessionId: '$10', paneId: '%22', panePid: 1234, paneStartTicks: '987' };
      ticket = { version: 1, phase: 'active', mode: 'inherit-current', projectId: 'default', identityId, registryId,
        revision: 1, runId: record.runId, bootId, build: 'a'.repeat(64), cgroupName: record.scopeName,
        cgroupDevice: '29', cgroupInode: '900', networkDevice: '4', networkInode: '500', namespace: networkIsolation === 'private' ? 'sk-default' : '' };
      if (startFailure) throw new Error('scope commit acknowledgement lost');
      return structuredClone(scopeRecord);
    },
    async stop(record: ProjectBrowserIdeRecord) {
      events.push('scope-stop'); if (cleanupFailure) throw new AppError('original group still populated', 503, 'SERVICE_CLEANUP_FAILED');
      if (scopeRecord) assert.equal(record.runId, scopeRecord.runId, 'cleanup must retain the original run, even if startup acknowledgement was lost');
      events.push('whole-domain-removed'); if (scopeRecord) scopeRecord.phase = 'stopped';
      events.push('native-ticket-closed'); if (ticket) ticket.phase = 'closed';
    },
  };
  const scopes = {
    async identity() { events.push('identity'); if (migration) throw new AppError('明确迁移项目目录后确认', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED'); return identity; },
    async inherited(_vm: string, _project: Project, execution: { command: string; environment?: Record<string, string> }, owner: { kind: string; runId: string; bootId: string }) {
      events.push('identity-intent'); assert.equal(owner.kind, 'service'); assert.equal(owner.bootId, bootId);
      assert.ok(events.includes('outer-intent')); const { input, sha256 } = projectIdentityPayload(execution);
      const pending = JSON.parse(await readFile(file, 'utf8')).sessions[0];
      assert.equal(pending.execution.record.runId, owner.runId);
      assert.equal(pending.execution.sha256, sha256, 'BrowserIde must persist its own recoverable intent before the lower native intent');
      if (inheritedFailure) throw new Error('identity intent acknowledgement lost');
      return { identity, runId: owner.runId, input, sha256, command: '/fixed/native/controller --run ' + owner.runId + ' --payload ' + sha256 };
    },
    async active() { events.push('capture-native-run'); if (activeFailure) throw new Error('native receipt response lost'); return ticket?.phase === 'active'; },
    async readonlyActive() { events.push('readonly-native'); return ticket?.phase === 'active'; },
  };
  const identities = { async runReadonly() { return structuredClone(ticket!); } };
  let bridge = false;
  const bridges = { async open(_vm: string, _project: Project, _guest: number, _host: number, _signal?: AbortSignal, allowShared?: boolean) {
    assert.equal(allowShared, true); events.push('bridge-open'); bridge = true;
  }, async stop() { events.push('bridge-stop'); bridge = false; }, async close() { bridge = false; } };
  const probe = async () => { events.push('http-probe'); return bridge && listener; };
  const options = { scopes, identities, processScope: () => processScope, bridges, listener: async () => { events.push('uid-listener'); return listener; } };
  const create = async () => { const service = new BrowserIde(machines, workspaces, file, probe, options); await service.init(); t.after(() => service.close()); return service; };
  const service = await create();
  return { service, create, vmId, vm, file, project, identity, machines, events, commands, frames, rootLaunchCommands,
    viewStore: async () => JSON.parse(await readFile(file, 'utf8')),
    ticket: () => ticket!, scopeRecord: () => scopeRecord!,
    setGuestState: (value: string) => { guestState = value; }, setProject: (value: string) => { currentProject = value; },
    setMigration: () => { migration = true; }, setListener: (value: boolean) => { listener = value; },
    failStart: () => { startFailure = true; }, failCleanup: (value = true) => { cleanupFailure = value; },
    failActive: () => { activeFailure = true; }, failInherited: () => { inheritedFailure = true; }, delayProof: (value?: () => Promise<void>) => { proofDelay = value; },
    setInstalled: (value: boolean) => { installed = value; }, isBridged: () => bridge };
}

for (const network of ['host', 'private'] as const) test(`${network}: UID browser IDE uses protected stdin, native home, durable original domain and a validated loopback bridge`, async t => {
  const f = await fixture(t, network);
  const response = await f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {});
  assert.equal(response.session?.status, 'running');
  const session = (await f.viewStore()).sessions[0], input = f.frames[0], script = input.subarray(32, 32 + input.readUInt32LE(24)).toString();
  assert.ok(script.includes('"$HOME/.local/share/sakura-browser-ide"')); assert.ok(script.includes('--bind-addr 127.0.0.1:8080'));
  assert.equal(script.includes('/root'), false); assert.equal(script.includes('0.0.0.0'), false);
  assert.ok(input.includes(Buffer.from('private-browser-token-雪'))); assert.ok(input.includes(Buffer.from(session.password)));
  assert.ok(f.rootLaunchCommands.every(command => !command.includes(session.password) && !command.includes('private-browser-')));
  assert.equal(JSON.stringify(response).includes(session.password), false); assert.equal(JSON.stringify(await f.service.view(f.vmId)).includes(session.password), false);
  assert.deepEqual(f.vm.forwards, []); assert.deepEqual(session.execution.identity, f.identity);
  assert.deepEqual(session.execution.run, f.ticket()); assert.deepEqual(session.execution.record, f.scopeRecord());
  assert.ok(f.events.indexOf('identity-intent') < f.events.indexOf('scope-start'));
  assert.ok(f.events.indexOf('readonly-native') < f.events.indexOf('bridge-open'));
  assert.ok(f.events.indexOf('uid-listener') < f.events.indexOf('http-probe'));
  assert.equal((await f.service.link(f.vmId)).password, session.password);
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
  assert.ok(f.events.indexOf('whole-domain-removed') < f.events.indexOf('native-ticket-closed'));
  assert.deepEqual((await f.viewStore()).sessions, []);
});

test('root-owned project data requires explicit directory migration before BrowserIde writes a runtime intent or launches code', async t => {
  const f = await fixture(t); f.setMigration();
  await assert.rejects(f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {}), /明确迁移/);
  assert.equal(f.events.includes('outer-intent'), false); assert.equal(f.events.includes('scope-start'), false);
  assert.equal(f.commands.some(command => command.includes('mkdir -p') && command.includes('/srv/project')), false);
});

test('reload restores only the original full ticket and refuses a native inode, build or boot substitution despite healthy HTTP', async t => {
  const f = await fixture(t);
  await f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {});
  await f.service.close(); const reopened = await f.create(); f.events.length = 0;
  assert.equal((await reopened.view(f.vmId)).session?.status, 'running');
  assert.equal(f.events.includes('identity-intent'), false); assert.equal(f.events.includes('capture-native-run'), false);
  const original = { ...f.ticket() };
  for (const changed of [{ cgroupInode: '999' }, { bootId: randomUUID() }, { build: 'b'.repeat(64) }]) {
    Object.assign(f.ticket(), original, changed); f.events.length = 0;
    await assert.rejects(reopened.link(f.vmId), /原账号/);
    assert.equal(f.events.includes('http-probe'), false); assert.equal(f.isBridged(), false);
  }
  Object.assign(f.ticket(), original);
});

test('a UID listener from another domain cannot be accepted just because the shared guest port serves healthz', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {});
  f.setListener(false); f.events.length = 0;
  await assert.rejects(f.service.link(f.vmId), /原账号/);
  assert.equal(f.events.includes('http-probe'), false); assert.equal(f.isBridged(), false);
  const session = (await f.viewStore()).sessions[0], command = controllerSource(browserIdeListenerCommand(session));
  assert.ok(command.includes("status.get('Uid'")); assert.ok(command.includes("status.get('Gid'"));
  assert.ok(command.includes("before[19]==after[19]")); assert.ok(command.includes("request['cgroupInode']"));
  assert.ok(command.includes('socket:[')); assert.ok(!command.includes(session.password));
});

test('reload rejects a changed BrowserIde payload digest before opening HTTP or reading a password entrance', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {});
  await f.service.close(); const changed = await f.viewStore(); changed.sessions[0].execution.sha256 = 'b'.repeat(64);
  await writeFile(f.file, JSON.stringify(changed)); const reopened = await f.create(); f.events.length = 0;
  await assert.rejects(reopened.link(f.vmId), /正文摘要/);
  assert.equal(f.events.includes('bridge-open'), false); assert.equal(f.events.includes('http-probe'), false);
});

test('startup acknowledgement loss plus failed domain cleanup preserves intent and reports both failures for retry', async t => {
  const f = await fixture(t); f.failStart(); f.failCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {}),
    (error: unknown) => error instanceof AppError && error.status === 503 && error.code === 'BROWSER_IDE_CLEANUP_FAILED' &&
      error.message.includes('acknowledgement lost') && error.message.includes('still populated'));
  const stored = (await f.viewStore()).sessions[0];
  assert.equal(stored.status, 'review'); assert.equal(stored.execution.run, null);
  assert.equal(stored.execution.record.runId, f.scopeRecord().runId);
  const reopened = await f.create(); f.failCleanup(false);
  await reopened.run(f.vmId, { mode: 'stop' }, signal, () => {});
  assert.deepEqual((await f.viewStore()).sessions, []);
});

test('native ticket acknowledgement loss closes the complete already-started original scope before dropping the browser record', async t => {
  const f = await fixture(t); f.failActive();
  await assert.rejects(f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {}), /receipt response lost/);
  assert.ok(f.events.includes('whole-domain-removed')); assert.ok(f.events.includes('native-ticket-closed'));
  assert.deepEqual((await f.viewStore()).sessions, []);
});

test('identity intent acknowledgement loss keeps a BrowserIde cleanup entry before any daemon can be launched', async t => {
  const f = await fixture(t); f.failInherited(); f.failCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {}),
    (error: unknown) => error instanceof AppError && error.code === 'BROWSER_IDE_CLEANUP_FAILED' &&
      error.message.includes('identity intent acknowledgement lost'));
  const pending = (await f.viewStore()).sessions[0];
  assert.equal(pending.status, 'review'); assert.equal(pending.execution.record.phase, 'intent');
  assert.equal(pending.execution.run, null); assert.equal(f.events.includes('scope-start'), false);
  f.failCleanup(false); const reopened = await f.create();
  await reopened.run(f.vmId, { mode: 'stop' }, signal, () => {});
  assert.deepEqual((await f.viewStore()).sessions, []);
});

test('failed explicit stop preserves a durable stop intent and cannot reopen its surviving HTTP listener', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {});
  f.failCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}), /still populated/);
  assert.equal((await f.viewStore()).sessions[0].status, 'review'); assert.equal(f.isBridged(), false);
  f.events.length = 0; await assert.rejects(f.service.link(f.vmId), /原账号/);
  assert.equal(f.events.includes('bridge-open'), false); assert.equal(f.events.includes('http-probe'), false);
  const reopened = await f.create(); f.failCleanup(false);
  await reopened.run(f.vmId, { mode: 'stop' }, signal, () => {});
  assert.deepEqual((await f.viewStore()).sessions, []);
});

test('a delayed status read cannot restore a bridge after explicit stop completed', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {});
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { entered = resolve; });
  f.delayProof(async () => { entered(); await gate; });
  const viewing = f.service.view(f.vmId); await seen;
  // Proof starts before stop is queued; it must observe the removed host record
  // before opening any entrance, even if its old guest report says running.
  const stopping = f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}); release();
  await stopping; await viewing; f.delayProof();
  assert.equal(f.isBridged(), false); assert.deepEqual((await f.viewStore()).sessions, []);
});

test('old root BrowserIde records stay review-only and cannot acquire a new UID bridge or a guessed tmux cleanup', async t => {
  const f = await fixture(t);
  await writeFile(f.file, JSON.stringify({ version: 1, sessions: [{ vmId: f.vmId, projectId: 'default', directory: f.project.directory,
    guestPort: 8080, hostPort: 18080, password: 'a'.repeat(64), createdForward: true, networkIsolation: 'host', status: 'running',
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }] }));
  const reopened = await f.create(), before = await readFile(f.file, 'utf8');
  assert.equal((await reopened.view(f.vmId)).session?.needsReview, true);
  await assert.rejects(reopened.link(f.vmId), /原 root 会话/);
  await assert.rejects(reopened.run(f.vmId, { mode: 'stop' }, signal, () => {}), /原 root 会话/);
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.events.includes('scope-stop'), false);
});

test('BrowserIde scope namespace cannot collide with a user service named browser-ide and frame contents never enter root argv', () => {
  const project = { _workspace: 'default', directory: '/srv/project', networkIsolation: 'host' } as Project;
  assert.notEqual(projectBrowserIdeScopePaths(project).guest, projectServiceScopePaths(project, 'browser-ide').guest);
  assert.notEqual(projectBrowserIdeScopePaths(project).session, projectServiceScopePaths(project, 'browser-ide').session);
  const runId = randomUUID(), record = projectBrowserIdeRecordSchema.parse({ version: 1, name: 'browser-ide', projectId: 'default',
    session: 'sakura-browser-ide-default', runId, bootId: randomUUID(), scopeName: 'sakura-service-' + runId,
    binding: 'a'.repeat(64), inode: '900', phase: 'prepared', sessionId: '$10', paneId: '%22', panePid: 1234, paneStartTicks: '987' });
  const { input } = projectIdentityPayload({ command: 'printf private-browser-body', environment: { TOKEN: 'private-browser-secret' } });
  const command = projectBrowserIdeScopeCommand(project, 'start', record,
    { runId, input, sha256: createHash('sha256').update(input).digest('hex'), command: '/fixed/native/controller --run ' + runId });
  assert.ok(command.includes('/run/sakura-browser-ide')); assert.ok(!command.includes('private-browser-'));
  const commit = projectBrowserIdeScopeCommand(project, 'commit', record, undefined, Math.floor(Date.now() / 1000) + 30);
  assert.ok(commit.includes('watchdogScript')); assert.ok(commit.includes('def watchdog()'));
  assert.ok(commit.includes('descriptor=scope_descriptor(record)')); assert.ok(commit.includes('time.monotonic()'));
  assert.ok(commit.length < 125000, 'the complete static controller argv remains below Linux per-argument budget');
  assert.equal(browserIdeSessionSchema.safeParse({ vmId: randomUUID(), projectId: 'default', directory: '/srv/project', guestPort: 8080,
    hostPort: 18080, password: 'a'.repeat(64), createdForward: false, status: 'running', networkIsolation: 'host',
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(),
    execution: { identity: {}, record, run: null, sha256: 'a'.repeat(64) } }).success, false);
});

test('the shared verified package installation stays an administrator operation and never loads project data or secrets', async t => {
  const f = await fixture(t); f.setInstalled(false);
  await f.service.run(f.vmId, { mode: 'install' }, signal, () => {});
  const command = f.commands.find(value => value.includes('sha256sum -c -'))!;
  assert.ok(command); assert.ok(command.indexOf('sha256sum -c -') < command.indexOf('tar -xzf'));
  assert.equal(command.includes(f.project.directory), false); assert.equal(command.includes('private-browser-'), false);
  assert.equal(f.events.includes('identity'), false); assert.equal(f.events.includes('scope-start'), false);
});

test('generated root listener, pane and watchdog Python parse, and deadline guard refuses changed owners before stop', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18080 }, signal, () => {});
  const record = f.scopeRecord(), session = (await f.viewStore()).sessions[0];
  const { input, sha256 } = projectIdentityPayload({ command: 'true' });
  const start = controllerSource(projectBrowserIdeScopeCommand(f.project, 'start', { ...record, phase: 'prepared' },
    { input, sha256, runId: record.runId, command: '/fixed/native/controller --run ' + record.runId }));
  const commit = controllerSource(projectBrowserIdeScopeCommand(f.project, 'commit', { ...record, phase: 'prepared' }, undefined,
    Math.floor(Date.now() / 1000) + 60, { version: 1, sha256, bytes: input.length }));
  const embedded = (source: string) => JSON.parse(JSON.parse(source.split('\n')[1].slice('request=json.loads('.length, -1)));
  assert.deepEqual(embedded(embedded(commit).watchdogScript).transport, { version: 1, sha256, bytes: input.length },
    'the standalone guard must retain the protected frame digest and size required by scope.stop clean_input');
  const directory = join(DATA, 'syntax-' + randomUUID()); await mkdir(directory); t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, source] of Object.entries({ listener: controllerSource(browserIdeListenerCommand(session)), start, commit,
    pane: embedded(start).paneScript, watchdog: embedded(commit).watchdogScript })) await writeFile(join(directory, name + '.py'), source as string);
  const harness = `import ast,pathlib,sys,types,copy
root=pathlib.Path(sys.argv[1])
for source in root.glob('*.py'): ast.parse(source.read_text(encoding='utf-8'))
tree=ast.parse((root/'watchdog.py').read_text(encoding='utf-8'))
function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='watchdog')
code=compile(ast.Module(body=[function],type_ignores=[]),'<watchdog-test>','exec')
for scenario in ['deadline','replaced-run','changed-inode','stopped']:
 events=[]; elapsed=[0]
 expected={'runId':'original','inode':'7','bootId':'old-boot','scopeName':'sakura-service-original','paneStartTicks':'9'}
 def read_owner():
  value=dict(expected,phase='running')
  if elapsed[0]>0 and scenario=='replaced-run': value['runId']='different'
  if elapsed[0]>0 and scenario=='changed-inode': value['inode']='8'
  if elapsed[0]>0 and scenario=='stopped': value['phase']='stopped'
  return value
 def expect_owner(record):
  if any(record[key]!=expected[key] for key in expected): raise RuntimeError('original owner changed')
 def sleep(seconds): elapsed[0]+=seconds
 clock=types.SimpleNamespace(time=lambda:1000+elapsed[0],monotonic=lambda:elapsed[0],sleep=sleep)
 fakeos=types.SimpleNamespace(close=lambda fd:events.append(('close',fd)))
 flock=types.SimpleNamespace(LOCK_EX=2,LOCK_UN=8,flock=lambda fd,kind:None)
 namespace={'request':{'record':expected,'namespace':'browser-ide','deadline':1010},'time':clock,'fcntl':flock,'lock':3,
  'os':fakeos,'read_owner':read_owner,'expect_owner':expect_owner,'scope_descriptor':lambda record:14,
  'refuse':lambda message:(_ for _ in ()).throw(RuntimeError(message)),'stop':lambda:events.append(('stop',elapsed[0]))}
 exec(code,namespace)
 try: namespace['watchdog']()
 except RuntimeError:
  assert scenario=='changed-inode'
 stops=[event for event in events if event[0]=='stop']
 assert bool(stops)==(scenario=='deadline'),(scenario,events)
 if stops: assert stops[0][1]>=10
 assert events[-1]==('close',14),(scenario,events)
print('generated Python parsed; original-domain deadline guard scenarios passed')
`;
  const helper = join(directory, 'check.py'); await writeFile(helper, harness);
  const result = spawnSync('python', ['-I', '-S', helper, directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes('guard scenarios passed'));
});
