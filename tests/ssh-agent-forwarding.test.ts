import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema } from '../server/workspaces.ts';
import { ProjectTerminals, assertProjectTerminalsStopped } from '../server/project-terminals.ts';
import { projectIdentityTask } from '../server/project-run-scope.ts';
import { SshAgentForwarder } from '../server/ssh-agent-forward.ts';
import { OwnedForwardAgent } from '../server/ssh-agent-scope.ts';
import { AppError } from '../server/model.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-agent-forward-unit-'));
const source = await readFile(new URL('../server/ssh-agent-broker.py', import.meta.url));
await writeFile(join(root, 'broker.py'), source);
await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, file: 'broker.py', size: source.length,
  sha256: createHash('sha256').update(source).digest('hex') }));
after(async () => {
  const canonical = await realpath(root), parent = await realpath(tmpdir());
  assert.equal(dirname(canonical), parent); assert.ok(basename(canonical).startsWith('sakura-agent-forward-unit-'));
  await rm(canonical, { recursive: true, force: true });
});

async function fixture() {
  const path = process.platform === 'win32' ? '\\\\.\\pipe\\sakura-agent-unit-' + randomUUID() : join(root, randomUUID());
  const sockets = new Set<Socket>(), server = createServer(connection => {
    sockets.add(connection); connection.on('error', () => {}); connection.once('close', () => sockets.delete(connection));
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  const previous = process.env.SSH_AUTH_SOCK; process.env.SSH_AUTH_SOCK = path;
  const vmId = randomUUID(), locks = new Machines({} as never), live = {}, commands: string[] = [];
  let projectId = '1111111111111111', releases = 0, closes = 0, resolves = 0;
  const raw = { ...projectSchema.parse({ directory: '/srv/projects/agent', networkIsolation: 'private',
    environment: { TOKEN: 'raw-value', SSH_AUTH_SOCK: '/tmp/wrong-agent' }, secrets: { TOKEN: 'own-key' } }), _workspace: projectId };
  const machines = { live: new Map([[vmId, live]]), get: () => ({ distro: 'alpine' }),
    state: () => 'running', requireUnlocked: () => {}, locked: locks.locked.bind(locks),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stderr: '', stdout: command.includes('project-directory-migrations') ? 'null' : '' };
    } } as unknown as Machines;
  const workspaces = { beforeConfigChange: () => () => {}, projects: { current: () => projectId,
    with: async (_id: string, target: string, action: () => unknown) => {
      assert.equal(target, raw._workspace, 'probe delay must not change the captured target'); return action();
    } }, config: async () => raw, resolveProject: async (_id: string, captured: typeof raw) => {
      ++resolves; assert.equal(captured, raw);
      return { ...captured, environment: { ...captured.environment, TOKEN: 'own-private-value' } };
    }, resolvedConfig: async () => { throw new Error('must resolve only captured config'); }, close: async () => {} } as unknown as Workspaces;
  const terminals = new ProjectTerminals(machines, workspaces), prepare = terminals.prepare.bind(terminals);
  terminals.prepare = async (...args) => {
    const prepared = await prepare(...args), release = prepared.release;
    return { ...prepared, release: () => { ++releases; release(); } };
  };
  const close = terminals.close.bind(terminals);
  terminals.close = async () => { ++closes; await close(); };
  return { vmId, machines, raw, live, commands, terminals, workspaces,
    changeProject: () => { projectId = '2222222222222222'; }, counts: () => ({ releases, closes, resolves }),
    forwarder: (runner: typeof projectIdentityTask) => new SshAgentForwarder(machines,
      { terminals, runTask: runner, sourceDirectory: root }),
    done: async () => {
      await terminals.close();
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = previous;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    } };
}

test('forwarding captures the target before host probing and sends code/env only to the UID task runner', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const operation = f.forwarder(async (_machines, id, project, body, signal, _log, timeout, path, callback, options) => {
      ++calls; assert.equal(id, f.vmId); assert.equal(project._workspace, f.raw._workspace);
      assert.equal(body.command, 'ssh-add -L; echo own-private-value');
      assert.equal(body.environment?.TOKEN, 'own-private-value'); assert.equal(body.environment?.SSH_AUTH_SOCK, undefined);
      assert.equal(path, undefined); assert.equal(callback, undefined); assert.equal(timeout, 60000);
      assert.equal(signal.aborted, false); assert.equal(options?.expectedLive, f.live);
      assert.ok(options?.sshAgent?.agent instanceof OwnedForwardAgent); assert.equal(options.sshAgent.resource.kind, 'ssh-agent');
      assert.throws(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace),
        { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await f.machines.locked(f.vmId, async () => {});
      return { code: 7, stdout: 'own-private-value output', stderr: 'own-private-value' };
    }).run(f.vmId, { command: 'ssh-add -L; echo own-private-value', confirmed: true });
    f.changeProject();
    const result = await operation;
    assert.equal(calls, 1); assert.equal(result.code, 7); assert.equal(result.ready, false);
    assert.equal(result.stdout, '[私密配置已隐藏] output'); assert.equal(result.stderr, '[私密配置已隐藏]');
    assert.equal(result.projectId, f.raw._workspace); assert.equal(result.networkIsolation, 'private');
    assert.ok(result.configVersion); assert.deepEqual(f.counts(), { releases: 1, closes: 0, resolves: 1 });
    assert.ok(f.commands.every(command => !command.includes('own-private-value') && !command.includes('/tmp/wrong-agent')));
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace));
  } finally { await f.done(); }
});

test('forwarded cancellation holds the task lease until cleanup finishes and shared close waits for it', async () => {
  const f = await fixture(); let began!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; }), barrier = new Promise<void>(resolve => { finish = resolve; });
  try {
    const controller = new AbortController();
    const operation = f.forwarder(async (_m, _id, _p, _body, signal) => {
      began(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      assert.throws(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace),
        { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await barrier; throw new AppError('own-private-value still unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    }).run(f.vmId, { command: 'sleep 600', confirmed: true }, controller.signal);
    const rejected = assert.rejects(operation, error => error instanceof AppError && error.status === 503 &&
      error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && !error.message.includes('own-private-value'));
    await started; controller.abort();
    let closed = false; const closing = f.terminals.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false); assert.equal(f.counts().releases, 0);
    finish(); await rejected; await closing;
    assert.equal(f.counts().releases, 1); assert.equal(f.counts().closes, 1);
  } finally { finish(); await f.done(); }
});

test('a resolver-time instance replacement is passed to admission rather than followed', async () => {
  const f = await fixture(); let called = 0;
  const resolve = f.workspaces.resolveProject.bind(f.workspaces);
  f.workspaces.resolveProject = async (...args) => {
    const result = await resolve(...args); f.machines.live.set(f.vmId, {} as never); return result;
  };
  try {
    await assert.rejects(f.forwarder(async (_m, _id, _project, _body, _signal, _log, _timeout, _path, _callback, options) => {
      ++called; assert.equal(options?.expectedLive, f.live); assert.notEqual(f.machines.live.get(f.vmId), options?.expectedLive);
      throw new AppError('captured live changed', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    }).run(f.vmId, { command: 'must-not-run', confirmed: true }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(called, 1); assert.equal(f.counts().releases, 1);
  } finally { await f.done(); }
});

test('invalid or unconfirmed commands never prepare a lease or create an Agent owner', async () => {
  const f = await fixture(); let executions = 0;
  try {
    const forwarder = f.forwarder(async () => { ++executions; return { code: 0, stdout: '', stderr: '' }; });
    for (const input of [{ command: 'true' }, { command: 'true', confirmed: false }, { command: '', confirmed: true }])
      await assert.rejects(forwarder.run(f.vmId, input));
    assert.equal(executions, 0); assert.deepEqual(f.counts(), { releases: 0, closes: 0, resolves: 0 });
  } finally { await f.done(); }
});
