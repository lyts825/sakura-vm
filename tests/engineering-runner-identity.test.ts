import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { ExtendedFeatures } from '../server/extended-features.ts';
import { Jobs } from '../server/jobs.ts';
import { CapabilityActions } from '../server/capability-actions.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { runEngineeringOperation, engineeringInvocation, engineeringLimits, engineeringSource,
  requireSuccessfulResult, type EngineeringRunOptions } from '../server/engineering-runner.ts';

const id = '11111111-1111-4111-8111-111111111111', projectId = '0123456789abcdef';
const moduleSource = 'import json,os,sys\nr=json.load(sys.stdin)\nprint(json.dumps({"code":0,"operation":r["operation"],"request":r,"token":os.environ.get("TOKEN")}))';
const pythonSource = (command: string) => {
  const prefix = 'exec /usr/bin/python3 -I -S -c ';
  assert.ok(command.startsWith(prefix));
  const quoted = command.slice(prefix.length);
  assert.ok(quoted.startsWith("'") && quoted.endsWith("'"));
  return quoted.slice(1, -1).replaceAll("'\\''", "'");
};
const unpackRequest = (command: string) => {
  const python = pythonSource(command);
  const match = python.match(/^request=unpack\(("[A-Za-z0-9+/=]+"),/m);
  assert.ok(match);
  return JSON.parse(inflateSync(Buffer.from(JSON.parse(match[1]), 'base64')).toString('utf8'));
};
const localPython = (code: string, input?: Buffer) => spawnSync(process.env.SAKURA_TEST_PYTHON || 'python',
  ['-I', '-S', '-c', code], { input, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
function fixture(operation = 'hash-manifest') {
  const context = new AsyncLocalStorage<string>();
  let override: string | undefined, leaseOpen = false, releases = 0;
  const live = { status: 'running' };
  const config = projectSchema.parse({ directory: '/srv/projects/original', template: 'none',
    networkIsolation: 'private', environment: { MODE: 'original' }, secrets: { TOKEN: 'fixture-token' } });
  Object.defineProperty(config, '_workspace', { value: projectId, enumerable: false });
  const cloneConfig = () => Object.defineProperty(structuredClone(config), '_workspace',
    { value: projectId, enumerable: false });
  const payloads: any[] = [], administrative: any[] = [], saves: any[] = [], events: string[] = [];
  const machines = {
    live: new Map([[id, live]]), state: () => 'running', get: () => ({ distro: 'alpine' }),
    requireUnlocked: () => {},
    exec: async () => { throw new Error('Direct root exec is forbidden in this model'); },
    writeGuestFile: async () => { throw new Error('Root helper publication is forbidden'); },
  } as unknown as Machines;
  const workspaces = {
    projects: {
      current: () => override || context.getStore() || projectId,
      key: () => id + ':' + (override || context.getStore() || projectId),
      inScope: (_id: string, scope: string, action: () => unknown) => context.run(scope, action),
    },
    config: async () => cloneConfig(),
    resolvedConfig: async () => { throw new Error('A second selected-project read is forbidden'); },
    resolveProject: async (_id: string, captured: typeof config) => {
      assert.equal(projectVersion(captured), projectVersion(config));
      return { ...captured, environment: { ...captured.environment, TOKEN: 'fixture-private-token' } };
    },
  } as unknown as Workspaces;
  const options: EngineeringRunOptions = {
    source: async () => moduleSource,
    terminals: { prepare: async (_id, scope, session, readOnly, signal, _terminalId, mode) => {
      assert.equal(scope, projectId); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(mode, { mode: 'task' }); leaseOpen = true;
      return { command: 'unused', projectId, networkIsolation: 'private', signal: signal!, terminalId: undefined,
        captured: { project: cloneConfig(), configVersion: projectVersion(config), live: live as any },
        release: () => { leaseOpen = false; ++releases; events.push('release'); } };
    } },
    runProjectTask: async (_machines, _id, captured, execution, signal, _log, timeout, _agent, _cleanup, pins) => {
      assert.ok(leaseOpen); assert.equal(captured.directory, config.directory);
      assert.equal(captured._workspace, projectId);
      assert.equal(pins?.expectedLive, live); assert.equal(signal.aborted, false); assert.ok(timeout! >= 120000);
      projectIdentityPayload(execution); payloads.push({ captured, execution }); events.push('uid-task');
      return { code: 0, stdout: JSON.stringify(operation === 'task-import'
        ? { code: 0, tasks: [{ name: 'test', command: 'npm test' }] }
        : { code: 0, operation, stdout: 'fixture-private-token' }), stderr: '' };
    },
    runAdministrativeTask: async (_machines, _id, command, _signal, _log, _timeout, _agent, _cleanup, transport) => {
      assert.ok(leaseOpen); administrative.push({ command, input: transport?.input });
      return { code: 0, stdout: JSON.stringify({ code: 0, operation }), stderr: '' };
    },
    presets: { list: async () => { assert.ok(leaseOpen); return []; }, save: async (_id, input) => {
      assert.ok(leaseOpen); assert.equal(workspaces.projects.current(id), projectId); saves.push(input); return [];
    }, close: async () => { events.push('presets-close'); } },
  };
  const run = (parameters: Record<string, unknown> = {}) => runEngineeringOperation(machines, workspaces, id,
    operation, parameters, new AbortController().signal, options);
  return { run, options, config, machines, workspaces, live, payloads, administrative, saves, events,
    leaseOpen: () => leaseOpen, releases: () => releases, switchScope: () => { override = 'fedcba9876543210'; } };
}

test('project operations use the captured UID payload without root helper files or selected-config rereads', async () => {
  const f = fixture('runbooks');
  const result = await f.run({ steps: [{ name: 'command', command: 'printf fixture', timeout: 1 }] });
  assert.equal(f.payloads.length, 1); assert.equal(f.administrative.length, 0); assert.equal(f.releases(), 1);
  const { captured, execution } = f.payloads[0];
  assert.equal(captured._workspace, projectId);
  assert.equal(execution.environment.TOKEN, 'fixture-private-token');
  const request = unpackRequest(execution.command);
  assert.deepEqual(request.environment, {}); assert.equal(request.directory, f.config.directory);
  assert.equal(request.parameters.steps[0].command, 'printf fixture');
  assert.equal(result.stdout, '[私密配置已隐藏]');
});

test('non-enumerable named-project metadata stays bound to the original task without changing the config hash', async () => {
  const f = fixture();
  assert.equal(Object.getOwnPropertyDescriptor(f.config, '_workspace')?.enumerable, false);
  assert.equal(Object.hasOwn(structuredClone(f.config), '_workspace'), false);
  await f.run();
  const captured = f.payloads[0].captured;
  assert.equal(captured._workspace, projectId);
  assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
  assert.equal(projectVersion(captured), projectVersion(f.config));
});

test('a matching config hash cannot authorize preparation captured for another project', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  f.options.terminals = { prepare: async (...args) => {
    const result = await prepare(...args);
    const wrongProject = Object.defineProperty(structuredClone(result.captured!.project), '_workspace',
      { value: 'fedcba9876543210', enumerable: false });
    assert.equal(projectVersion(wrongProject), projectVersion(f.config));
    return { ...result, captured: { ...result.captured!, project: wrongProject } };
  } };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length + f.administrative.length, 0);
  assert.equal(f.releases(), 1);
});

test('the current complete helper fits the native payload and the packed bootstrap preserves UTF-8 request data', async () => {
  const request = { operation: 'hash-manifest', directory: '/srv/projects/original', environment: {}, parameters: { path: '中文' } };
  const current = engineeringInvocation(await engineeringSource(), request);
  const frame = projectIdentityPayload({ command: current.command, environment: { TOKEN: 'fixture-token' } });
  assert.ok(frame.input.length < 131072);
  const invocation = engineeringInvocation(moduleSource, request);
  const execution = localPython(pythonSource(invocation.command));
  assert.equal(execution.error, undefined); assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(JSON.parse(execution.stdout).request, request);
});

test('raw and compressed source/request limits reject oversized data before any guest execution', () => {
  for (const [source, request] of [
    ['x'.repeat(engineeringLimits.sourceBytes + 1), {}],
    [randomBytes(60000).toString('hex'), {}],
    [moduleSource, { data: 'x'.repeat(engineeringLimits.requestBytes + 1) }],
    [moduleSource, { data: randomBytes(30000).toString('hex') }],
  ] as const) assert.throws(() => engineeringInvocation(source, request),
    (error: any) => error.status === 413 && error.code === 'ENGINEERING_INPUT_TOO_LARGE');
});

test('guest decoding rejects extra compressed data and bounded decompression bombs without executing the source', () => {
  const invocation = engineeringInvocation(moduleSource, { operation: 'hash-manifest' });
  const python = pythonSource(invocation.command);
  const source = python.match(/^module=unpack\(("[A-Za-z0-9+/=]+"),/m)!;
  const packed = Buffer.from(JSON.parse(source[1]), 'base64');
  const tail = Buffer.concat([packed, Buffer.from('unexpected trailing bytes')]).toString('base64');
  const bomb = deflateSync(Buffer.alloc(engineeringLimits.sourceBytes + 1, 65)).toString('base64');
  for (const value of [tail, bomb]) {
    const result = localPython(python.replace(source[1], JSON.stringify(value)));
    assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
    assert.equal(result.stdout, ''); assert.match(result.stderr, /Engineering transport integrity/);
  }
});

test('only three validated administrative operations use fixed root environment, root cwd and bounded stdin', async () => {
  for (const [operation, parameters] of [
    ['guest-clock-policy', { mode: 'inspect' }], ['static-routes', { mode: 'list' }],
    ['packet-capture', { interface: 'eth0', protocol: 'tcp', maxPackets: 2, durationSeconds: 1 }],
  ] as const) {
    const f = fixture(operation); f.config.environment = { PATH: '/project/untrusted', PYTHONPATH: '/project/untrusted', TOKEN: 'project-only-token' };
    f.workspaces.resolveProject = async () => { throw new Error('Administrative operations must not resolve project secrets'); };
    await f.run(parameters);
    assert.equal(f.payloads.length, 0); assert.equal(f.administrative.length, 1);
    const { command, input } = f.administrative[0];
    assert.match(command, /\/usr\/bin\/env -i HOME=\/ USER=root LOGNAME=root/);
    assert.match(command, /PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin LANG=C LC_ALL=C/);
    assert.match(command, /ip netns exec sk-0123456789abcdef/);
    assert.equal(command.includes('sh -lc'), false); assert.equal(command.includes(f.config.directory), false);
    assert.equal(command.includes('/project/untrusted'), false); assert.equal(command.includes('project-only-token'), false);
    const request = JSON.parse(input.toString('utf8'));
    assert.equal(request.operation, operation); assert.equal(request.directory, '/'); assert.deepEqual(request.environment, {});
    const invocation = engineeringInvocation(moduleSource, request, true);
    const correct = localPython(pythonSource(invocation.command), invocation.input);
    assert.equal(correct.status, 0, correct.stderr);
    const altered = localPython(pythonSource(invocation.command), Buffer.concat([invocation.input!, Buffer.from('x')]));
    assert.notEqual(altered.status, 0); assert.match(altered.stderr, /Engineering request integrity/);
  }
});

test('the actual privileged helper paths read no project files, hooks or output paths', async () => {
  const source = Buffer.from(await engineeringSource());
  const code = [
    'import pathlib, json, sys',
    'ns={"__name__":"draft_admin_review"}',
    'exec(compile(sys.stdin.buffer.read(),"trusted-helper.py","exec"),ns)',
    'calls=[]',
    'def denied(*args,**kwargs): raise AssertionError("project file/config/output access")',
    'def run(args,cwd=None,**kwargs):',
    ' assert args[0] in ("tcpdump","date","ip")',
    ' assert cwd is None or cwd==pathlib.Path("/")',
    ' calls.append(args)',
    ' return {"code":0,"stdout":"","stderr":""}',
    'ns["run"]=run',
    'ns["shutil"].which=lambda name: "/usr/sbin/tcpdump" if name=="tcpdump" else None',
    'for name in ("safe_path","read_text","history","atomic_json","task_import"): ns[name]=denied',
    'for name in ("open","read_text","read_bytes","resolve","is_symlink","exists","mkdir","write_text"): setattr(pathlib.Path,name,denied)',
    'root=pathlib.Path("/")',
    'ns["execute"](root,"guest-clock-policy",{"mode":"sync","_hostEpochMs":1700000000000})',
    'ns["execute"](root,"static-routes",{"mode":"add","destination":"192.0.2.0/24","gateway":"192.0.2.1"})',
    'ns["capability_execute"](root,"packet-capture",{"interface":"eth0","protocol":"tcp","port":443,"durationSeconds":1,"maxPackets":2})',
    'assert [row[0] for row in calls]==["date","ip","tcpdump"]',
    'assert calls[-1]==["tcpdump","-i","eth0","-p","-nn","-tt","-l","-q","-s","96","-c","2","tcp","and","port","443"]',
    'print(json.dumps({"code":0,"executables":[row[0] for row in calls]}))',
  ].join('\n');
  const output = localPython(code, source);
  assert.equal(output.error, undefined); assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), { code: 0, executables: ['date', 'ip', 'tcpdump'] });
});

test('unknown operations and invalid administrative parameters never enter any runner', async () => {
  const f = fixture('unknown-root-operation');
  await assert.rejects(f.run(), (error: any) => error.code === 'ENGINEERING_OPERATION_UNSUPPORTED');
  const routes = fixture('static-routes');
  await assert.rejects(routes.run({ mode: 'add', destination: '0.0.0.0/0' }));
  await assert.rejects(routes.run({ mode: 'list', command: 'malicious-root-command' }));
  assert.equal(f.releases(), 0); assert.equal(routes.releases(), 0);
  assert.equal(f.administrative.length + routes.administrative.length, 0);
});

test('internal matrix commands and parity probes have explicit bounded schemas and use the UID runner', async () => {
  for (const [operation, parameters] of [
    ['capability-command', { argv: ['npm', 'test'], timeout: 60 }],
    ['environment-fingerprint', {}],
  ] as const) {
    const f = fixture(operation);
    await f.run(parameters);
    assert.equal(f.payloads.length, 1); assert.equal(f.administrative.length, 0);
    assert.deepEqual(unpackRequest(f.payloads[0].execution.command).parameters, parameters);
  }
  const command = fixture('capability-command'), fingerprint = fixture('environment-fingerprint');
  for (const parameters of [{ argv: [] }, { argv: [''] }, { argv: ['bad\0command'] },
    { argv: ['npm'], timeout: 1801 }, { argv: ['npm'], root: true }])
    await assert.rejects(command.run(parameters));
  await assert.rejects(fingerprint.run({ command: 'untrusted' }));
  assert.equal(command.releases() + fingerprint.releases(), 0);
});

test('a source-load live replacement fails before code launch and releases the original preparation lease', async () => {
  const f = fixture();
  f.options.source = async () => { f.machines.live.set(id, {} as any); return moduleSource; };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length + f.administrative.length, 0); assert.equal(f.releases(), 1);
});

test('original config edits fail before execution even when preparation captured a later candidate', async () => {
  const f = fixture(); const prepare = f.options.terminals!.prepare;
  f.options.terminals!.prepare = async (...args) => { f.config.environment = { MODE: 'changed' }; return prepare(...args); };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
});

test('task import writes to the original project while its lease remains held', async () => {
  const f = fixture('task-import');
  const result = await f.run({ save: true });
  assert.equal(result.saved, 1); assert.equal(f.saves.length, 1); assert.equal(f.releases(), 1);
  assert.deepEqual(f.events, ['uid-task', 'presets-close', 'release']);
});

test('task import rejects a scope switch during execution before reading or saving presets', async () => {
  const f = fixture('task-import'), runTask = f.options.runProjectTask!;
  f.options.runProjectTask = async (...args) => { const output = await runTask(...args); f.switchScope(); return output; };
  await assert.rejects(f.run({ save: true }), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.saves.length, 0); assert.equal(f.releases(), 1);
});

test('result persistence holds the original lease, and persistence failure releases it without root fallback', async () => {
  const f = fixture(); let reached!: () => void, finish!: () => void;
  const saving = new Promise<void>(resolve => { reached = resolve; });
  const saved = new Promise<void>(resolve => { finish = resolve; });
  f.options.onResult = async () => { assert.ok(f.leaseOpen()); reached(); await saved; assert.ok(f.leaseOpen()); };
  const operation = f.run(); await saving; assert.equal(f.releases(), 0); finish(); await operation;
  assert.equal(f.releases(), 1);
  const failed = fixture(), error = new AppError('result storage failure', 503, 'RESULT_STORAGE_FAILED');
  failed.options.onResult = async () => { throw error; };
  await assert.rejects(failed.run(), value => value === error);
  assert.equal(failed.releases(), 1); assert.equal(failed.administrative.length, 0);
});

test('native cleanup 503/status/code propagate unchanged and never become JSON errors or success-check failures', async () => {
  for (const code of ['PROJECT_IDENTITY_CLEANUP_FAILED', 'GUEST_TASK_CLEANUP_FAILED']) {
    const f = fixture(), error = new AppError('original cleanup failure', 503, code);
    f.options.runProjectTask = async () => { throw error; };
    let saved = false; f.options.onResult = async () => { saved = true; };
    await assert.rejects(f.run().then(result => requireSuccessfulResult(result)), value => value === error);
    assert.equal(saved, false); assert.equal(f.releases(), 1); assert.equal(f.administrative.length, 0);
  }
});

test('the real extended-operation job saves its result through the original preparation lease', async () => {
  const f = fixture(), jobs = new Jobs();
  // Keep this model in memory; do not initialize production stores or VM services.
  const service = Object.create(ExtendedFeatures.prototype) as ExtendedFeatures;
  Object.assign(service, { machines: f.machines, workspaces: f.workspaces, jobs,
    state: async () => ({ settings: {} }) });
  let persisted = 0;
  (service as any).runOperation = async (_id: string, operation: string, parameters: Record<string, unknown>,
    signal: AbortSignal, persist: (value: unknown) => Promise<void>) => {
    assert.equal(typeof persist, 'function');
    return runEngineeringOperation(f.machines, f.workspaces, id, operation, parameters, signal,
      { ...f.options, onResult: async result => {
        assert.ok(f.leaseOpen()); await persist(result); assert.ok(f.leaseOpen()); ++persisted;
      } });
  };
  try {
    const job: any = await service.action(id, { action: 'operation', operation: 'hash-manifest' });
    await jobs.wait(job.key);
    assert.equal(job.status, 'done'); assert.equal(job.projectId, projectId);
    assert.equal((await jobs.result(job.id)).stdout, '[私密配置已隐藏]');
    assert.equal(persisted, 1); assert.equal(f.releases(), 1);
  } finally { await jobs.close(); }
});

test('the extended-operation job retains a native cleanup error code without storing a fabricated result', async () => {
  const f = fixture(), jobs = new Jobs(), error = new AppError('original cleanup failure', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.options.runProjectTask = async () => { throw error; };
  const service = Object.create(ExtendedFeatures.prototype) as ExtendedFeatures;
  Object.assign(service, { machines: f.machines, workspaces: f.workspaces, jobs,
    state: async () => ({ settings: {} }) });
  (service as any).runOperation = async (_id: string, operation: string, parameters: Record<string, unknown>,
    signal: AbortSignal, onResult: EngineeringRunOptions['onResult']) =>
    runEngineeringOperation(f.machines, f.workspaces, id, operation, parameters, signal, { ...f.options, onResult });
  try {
    const job: any = await service.action(id, { action: 'operation', operation: 'hash-manifest' });
    await jobs.wait(job.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, error.code);
    assert.equal(job.error, error.message); assert.equal(job.result, undefined);
    assert.equal(f.releases(), 1); assert.equal(f.administrative.length, 0);
  } finally { await jobs.close(); }
});

test('cross-project workspace search preserves infrastructure 503 errors instead of producing a check failure', async () => {
  const f = fixture(), error = new AppError('original cleanup failure', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  Object.assign(f.workspaces.projects, { with: async () => { throw error; } });
  const capabilities = new CapabilityActions(f.machines, f.workspaces);
  await assert.rejects(capabilities.run(id, 'workspace-search', { query: 'TODO', targets: [{ vmId: id, projectId }] },
    new AbortController().signal).then(result => requireSuccessfulResult(result)), value => value === error);
  Object.assign(f.workspaces.projects, { with: async () => { throw new AppError('target unavailable', 409); } });
  const result = await capabilities.run(id, 'workspace-search', { query: 'TODO', targets: [{ vmId: id, projectId }] },
    new AbortController().signal);
  assert.equal(result.code, 1); assert.equal(result.ready, false);
});
