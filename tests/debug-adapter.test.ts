import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Duplex } from 'node:stream';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { DapTransport } from '../server/dap-transport.ts';
import { DebugAdapter } from '../server/debug-adapter.ts';
import { AppError } from '../server/model.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { projectVersion, type Project } from '../server/workspaces.ts';
import { mockProtocolOwner, protocolPair } from './project-protocol-fixture.ts';
import type { ProjectProtocolStreamRecord } from '../server/project-protocol-stream.ts';

function channel() {
  const sent: Buffer[] = [];
  const stream = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) { sent.push(Buffer.from(chunk)); callback(); },
  });
  return { stream, sent };
}
function frame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}
function decode(buffer: Buffer) {
  return JSON.parse(buffer.subarray(buffer.indexOf('\r\n\r\n') + 4).toString('utf8'));
}

test('DAP transport assembles split frames, resolves requests and buffers early events', async () => {
  const { stream, sent } = channel();
  const transport = new DapTransport(stream);
  const request = transport.request('initialize', { clientID: 'sakura' });
  const outgoing = decode(sent[0]);
  assert.equal(outgoing.command, 'initialize');
  const response = frame({ seq: 2, type: 'response', request_seq: outgoing.seq,
    command: 'initialize', success: true, body: { supportsConfigurationDoneRequest: true } });
  stream.push(response.subarray(0, 7));
  stream.push(response.subarray(7));
  assert.deepEqual(await request, { supportsConfigurationDoneRequest: true });
  stream.push(frame({ seq: 3, type: 'event', event: 'initialized', body: { ready: true } }));
  assert.deepEqual(await transport.waitFor('initialized'), { ready: true });
  transport.close();
  await assert.rejects(transport.waitFor('stopped'), /连接已关闭/);
});

test('DAP transport rejects protocol errors and an oversized frame', async () => {
  const { stream, sent } = channel();
  const transport = new DapTransport(stream);
  const request = transport.request('stackTrace');
  stream.push(frame({ seq: 2, type: 'response', request_seq: decode(sent[0]).seq,
    command: 'stackTrace', success: false, message: 'invalid frame' }));
  await assert.rejects(request, /invalid frame/);
  const waiting = transport.waitFor('stopped');
  stream.push(Buffer.from('Content-Length: 4194305\r\n\r\n'));
  await assert.rejects(waiting, /响应长度无效/);
});

test('debug sessions reject concurrent starts and paths outside the current project', async () => {
  let release!: (value: { directory: string }) => void;
  const pending = new Promise<{ directory: string }>((resolve) => { release = resolve; });
  let first = true;
  const workspaces = { config: async () => first ? (first = false, pending) : { directory: '/workspace/app' },
    projects: { current: () => 'default', inScope: (_id: string, _scope: string, action: () => Promise<unknown>) => action() } };
  const machines = { live: new Map([['vm', {}]]), state: () => 'running', exec: async () => ({ code: 1, stdout: '', stderr: '' }) };
  const debuggerService = new DebugAdapter(machines as unknown as Machines, workspaces as unknown as Workspaces,
    { streams: { recordsAll: async () => [] } as never });
  const starting = debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [2] });
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), /正在启动/);
  release({ directory: '/workspace/app' });
  await assert.rejects(starting, /请先安装/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/other/main.py', breakpoints: [] }), /当前项目/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.js', breakpoints: [] }), /Python/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [0] }), /断点行号/);
});

test('private project debugger requests UID adapter code instead of root namespace shell execution', async () => {
  let launched = '', network = '';
  const workspaces = { config: async () => ({ directory: '/workspace/app', networkIsolation: 'private' }),
    projects: { current: () => 'default', inScope: (_id: string, _scope: string, action: () => Promise<unknown>) => action() } };
  const machines = {
    live: new Map([['vm', {}]]), state: () => 'running',
    exec: async () => ({ code: 0, stdout: '{"installed":true}', stderr: '' }),
  };
  const debuggerService = new DebugAdapter(machines as unknown as Machines,
    workspaces as unknown as Workspaces, { streams: { recordsAll: async () => [],
      open: async (_id: string, _kind: string, project: Project, execution: (project: Project) => { command: string }) => {
        network = project.networkIsolation!; launched = execution(project).command; throw new Error('capture launch');
      } } as never });
  await assert.rejects(debuggerService.start('vm', {
    path: '/workspace/app/main.py', breakpoints: [],
  }), /capture launch/);
  assert.equal(network, 'private'); assert.match(launched, /-I -m debugpy.adapter/);
  assert.match(launched, /test -f '\/workspace\/app\/main.py'/);
  assert.ok(!launched.includes('ip netns'));
});

function fixture() {
  const project: Project = { directory: '/workspace/app', template: 'none', repository: '', setup: '', command: '', environment: { PROJECT_TOKEN: 'only-protected-stream' } };
  let scope = '1111111111111111', cleanupFail = false, closeCalls = 0, detachCalls = 0, terminateAtLaunch = false;
  Object.defineProperty(project, '_workspace', { get: () => scope, enumerable: false });
  const live = {}, liveMap = new Map([['vm', live]]);
  const boundaries: Partial<Record<'config' | 'records' | 'installed', () => Promise<void>>> = {};
  const boundary = async (where: 'config' | 'records' | 'installed') => { const operation = boundaries[where]; delete boundaries[where]; await operation?.(); };
  const workspaces = { config: async () => { await boundary('config'); return project; },
    projects: { current: () => scope, inScope: (_id: string, _scope: string, action: () => Promise<unknown>) => action() } } as unknown as Workspaces;
  const requests: any[] = [], frames: Buffer[] = [], commands: string[] = [];
  let records: ProjectProtocolStreamRecord[] = [];
  const streams = {
    recordsAll: async () => { await boundary('records'); return records; },
    readonly: async () => {}, stop: async (_id: string, projectId: string, token: string) => {
      assert.equal(projectId, records[0].projectId); assert.equal(token, records[0].runId);
      if (cleanupFail) throw new AppError('full cgroup still exists', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); records = [];
    }, close: async () => {},
    open: async (_id: string, kind: 'lsp' | 'dap', original: Project, execute: (project: Project) => { command: string },
      _signal?: AbortSignal, _timeoutMs?: number, expectedLive?: object) => {
      assert.equal(expectedLive, live);
      const [client, server] = protocolPair(); const execution = execute(original);
      frames.push(projectIdentityPayload({ ...execution, environment: original.environment, stdin: 'session' }).input);
      const capturedScope = original._workspace, digest = projectVersion(original);
      const owner = mockProtocolOwner('vm', kind, original, client, async () => {
        if (scope !== capturedScope || projectVersion(project) !== digest) throw new AppError('original scope or configuration changed', 409);
      }, async () => {
        ++closeCalls; if (cleanupFail) throw new AppError('full cgroup still exists', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        records = []; server.destroy();
      });
      owner.detachRequest = () => { ++detachCalls; };
      records = [owner.record()];
      let input = Buffer.alloc(0), sequence = 0;
      const event = (name: string, body: unknown = {}) => server.write(frame({ seq: ++sequence, type: 'event', event: name, body }));
      server.on('data', (chunk: Buffer) => {
        input = Buffer.concat([input, chunk]);
        while (true) {
          const end = input.indexOf('\r\n\r\n'); if (end < 0) return;
          const size = Number(/Content-Length: (\d+)/.exec(input.subarray(0, end).toString())?.[1]);
          if (input.length < end + 4 + size) return;
          const request = JSON.parse(input.subarray(end + 4, end + 4 + size).toString()); input = input.subarray(end + 4 + size);
          requests.push(request);
          let body: unknown = {};
          if (request.command === 'launch') { event('initialized'); event('output', { output: 'UID debugger\u0000 output' }); }
          if (request.command === 'setBreakpoints') body = { breakpoints: request.arguments.lines.map((line: number) => ({ line, verified: true })) };
          if (request.command === 'threads') body = { threads: [{ id: 9 }] };
          if (request.command === 'stackTrace') body = { stackFrames: [{ id: 4, name: 'main', source: { path: '/workspace/app/main.py' }, line: 2, column: 1 }] };
          if (request.command === 'scopes') body = { scopes: [{ variablesReference: 42 }] };
          if (request.command === 'variables') body = { variables: [{ name: 'flower', value: '1', type: 'int', variablesReference: 43 }] };
          const response = frame({ seq: ++sequence, type: 'response', request_seq: request.seq, command: request.command, success: true, body });
          server.write(response.subarray(0, 9)); server.write(response.subarray(9));
          if (request.command === 'configurationDone') {
            if (terminateAtLaunch) event('terminated'); else event('stopped', { threadId: 9, reason: 'breakpoint' });
          }
          if (request.command === 'pause') event('stopped', { threadId: 9, reason: 'breakpoint' });
          if (['continue', 'next', 'stepIn', 'stepOut'].includes(request.command)) event('continued');
        }
      }); return owner;
    },
  };
  const machines = { live: liveMap, state: () => 'running', get: () => ({ distro: 'ubuntu' }), exec: async (_id: string, command: string) => {
    commands.push(command); await boundary('installed'); return { code: 0, stdout: '{"installed":true}', stderr: '' };
  } } as unknown as Machines;
  const service = new DebugAdapter(machines, workspaces, { streams,
    adminTask: async (_machines, _id, script) => { commands.push(script); return { code: 0, stdout: '', stderr: '' }; } });
  return { service, requests, commands, frames, project, streams, closeCalls: () => closeCalls, detachCalls: () => detachCalls,
    setScope: (value: string) => { scope = value; }, setCleanupFail: (value: boolean) => { cleanupFail = value; },
    terminateAtLaunch: () => { terminateAtLaunch = true; },
    records: () => structuredClone(records), reload: () => new DebugAdapter(machines, workspaces, { streams }),
    replaceLive: () => liveMap.set('vm', {}), setBoundary: (where: 'config' | 'records' | 'installed', operation: () => Promise<void>) => { boundaries[where] = operation; } };
}

test('DAP UID session preserves real framing, token, launch, stack, variables and commands', async () => {
  const f = fixture(); const start = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [2], stopOnEntry: true, args: ['hello'] });
  assert.equal(start.state, 'stopped'); assert.equal(start.breakpoints[0].verified, true);
  assert.equal(start.frames[0].path, '/workspace/app/main.py'); assert.equal(start.variables[0].name, 'flower');
  assert.ok(start.output.includes('\0')); assert.equal(f.detachCalls(), 1);
  assert.equal(f.frames[0].readUInt32LE(12), 2); assert.ok(f.frames[0].includes(Buffer.from('only-protected-stream')));
  assert.ok(f.commands.every(command => !command.includes('only-protected-stream') && !command.includes('/workspace/app')));
  const launch = f.requests.find(request => request.command === 'launch').arguments;
  assert.deepEqual(launch.args, ['hello']); assert.equal(launch.cwd, '/workspace/app'); assert.equal(launch.stopOnEntry, true);
  assert.equal((await f.service.inspect('vm', start.token, 4)).selectedFrame, 4);
  assert.equal((await f.service.expand('vm', start.token, 43)).variables[0].value, '1');
  assert.equal((await f.service.setBreakpoints('vm', start.token, [3, 3])).breakpoints[0].line, 3);
  assert.equal((await f.service.command('vm', start.token, 'next')).state, 'running');
  assert.equal((await f.service.command('vm', start.token, 'pause')).state, 'stopped');
  assert.equal((await f.service.stop('vm', start.token)).stopped, true); assert.equal(f.closeCalls(), 1);
});

test('DAP full-domain cleanup failure preserves original token and prevents new admission until retry', async () => {
  const f = fixture(); const started = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] });
  const original = f.records(); f.setCleanupFail(true);
  await assert.rejects(f.service.stop('vm', started.token), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.service.status('vm')).token, started.token); assert.deepEqual(f.records(), original);
  await assert.rejects(f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), { status: 503 });
  f.setCleanupFail(false); await f.service.stop('vm', started.token); assert.equal(f.records().length, 0);
});

test('DAP fast program termination completes the protocol handshake and confirms the whole original domain', async () => {
  const f = fixture(); f.terminateAtLaunch();
  const started = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] });
  assert.equal(started.state, 'terminated'); assert.equal(started.active, false);
  assert.equal(f.closeCalls(), 1); assert.equal(f.records().length, 0); assert.equal(f.detachCalls(), 0);
  assert.ok(f.requests.some(request => request.command === 'configurationDone'));
  await f.service.stop('vm', started.token);
});

test('DAP fast termination cannot report success if original full-domain cleanup fails', async () => {
  const f = fixture(); f.terminateAtLaunch(); f.setCleanupFail(true);
  await assert.rejects(f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }),
    { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  const status = await f.service.status('vm'); assert.equal(status.needsReview, true);
  assert.equal(status.token, f.records()[0].runId); assert.equal(status.active, false);
  f.setCleanupFail(false); await f.service.stop('vm', status.token!);
});

test('DAP matching config hash cannot authorize another named scope, and readonly status emits no DAP request', async () => {
  const f = fixture(), started = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] });
  const digest = projectVersion(f.project); f.setScope('2222222222222222'); assert.equal(projectVersion(f.project), digest);
  const requests = f.requests.length;
  await assert.rejects(f.service.command('vm', started.token, 'continue'), { status: 409 });
  const status = await f.service.status('vm'); assert.equal(status.active, false); assert.equal(status.needsReview, true);
  assert.equal(f.requests.length, requests); await f.service.stop('vm', started.token);
});

test('DAP reload reports original pending token without install or attach, then exact original stop', async () => {
  const f = fixture(), started = await f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [] });
  const requests = f.requests.length, commands = f.commands.length, original = f.records();
  const reloaded = f.reload(), status = await reloaded.status('vm');
  assert.equal(status.active, false); assert.equal(status.needsReview, true); assert.equal(status.token, started.token);
  assert.deepEqual(f.records(), original); assert.equal(f.requests.length, requests); assert.equal(f.commands.length, commands);
  await assert.rejects(reloaded.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  f.setScope('3333333333333333'); assert.equal((await reloaded.stop('vm', started.token)).stopped, true);
  await f.service.stop('vm', started.token);
});

test('DAP administrator installation uses fixed empty environment and no project code or environment', async () => {
  const f = fixture(); await f.service.install('vm');
  assert.match(f.commands[0], /env -i HOME=\/ USER=root LOGNAME=root/);
  assert.match(f.commands[0], /--isolated --python/); assert.match(f.commands[0], /--only-binary=:all:/);
  assert.ok(!f.commands[0].includes('only-protected-stream') && !f.commands[0].includes('/workspace/app'));
});

for (const where of ['config', 'records', 'installed'] as const) test('DAP public start cannot authorize replacement live while awaiting ' + where, async () => {
  const f = fixture(); f.setBoundary(where, async () => { await new Promise(resolve => setTimeout(resolve, 0)); f.replaceLive(); });
  await assert.rejects(f.service.start('vm', { path: '/workspace/app/main.py', breakpoints: [2] }),
    { status: 409, code: 'PROJECT_IDENTITY_HOST_CHANGED' }); assert.equal(f.frames.length, 0);
});
test('DAP start copies program, args, breakpoints and stopOnEntry before first config await', async () => {
  const f = fixture(), input = { path: '/workspace/app/main.py', breakpoints: [2], args: ['original'], stopOnEntry: true };
  f.setBoundary('config', async () => {
    await new Promise(resolve => setTimeout(resolve, 0)); input.path = '/etc/shadow'; input.breakpoints[0] = 0; input.args[0] = 'mutated'; input.stopOnEntry = false;
  });
  const started = await f.service.start('vm', input), launch = f.requests.find(request => request.command === 'launch').arguments;
  assert.equal(launch.program, '/workspace/app/main.py'); assert.deepEqual(launch.args, ['original']); assert.equal(launch.stopOnEntry, true);
  assert.equal(started.breakpoints[0].line, 2); await f.service.stop('vm', started.token);
});
