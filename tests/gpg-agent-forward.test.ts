import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema } from '../server/workspaces.ts';
import { ProjectTerminals, assertProjectTerminalsStopped } from '../server/project-terminals.ts';
import { projectIdentityTask } from '../server/project-run-scope.ts';
import { gpgAgentForwardInput, guestGpgForwardingReady, GpgAgentForwarder } from '../server/gpg-agent-forward.ts';
import { OwnedGpgForward } from '../server/gpg-agent-host.ts';
import { AppError } from '../server/model.ts';
import { syntheticGpgHostSnapshot } from './gpg-agent-fixture.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-gpg-forward-unit-'));
const source = await readFile(new URL('../server/gpg-agent-broker.py', import.meta.url));
await writeFile(join(root, 'broker.py'), source);
await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, file: 'broker.py', size: source.length,
  sha256: createHash('sha256').update(source).digest('hex') }));
after(async () => {
  const canonical = await realpath(root), parent = await realpath(tmpdir());
  assert.equal(dirname(canonical), parent); assert.ok(basename(canonical).startsWith('sakura-gpg-forward-unit-'));
  await rm(canonical, { recursive: true, force: true });
});

async function fixture() {
  const vmId = randomUUID(), locks = new Machines({} as never), live = {}, commands: string[] = [];
  let projectId = '1111111111111111', releases = 0, closes = 0, resolves = 0, probes = 0;
  const raw = { ...projectSchema.parse({ directory: '/srv/projects/gpg', networkIsolation: 'private',
    environment: { TOKEN: 'raw-value', GNUPGHOME: '/wrong/home', GPG_AGENT_INFO: '/wrong/agent' },
    secrets: { TOKEN: 'own-key' } }), _workspace: projectId };
  let sshConfig = 'disableforwarding no\nallowtcpforwarding remote\nallowstreamlocalforwarding remote\n';
  const machines = { live: new Map([[vmId, live]]), state: () => 'running', get: () => ({ distro: 'alpine' }),
    requireUnlocked: () => {}, locked: locks.locked.bind(locks),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stderr: '', stdout: command.includes('sshd -T') ? sshConfig :
        command.includes('project-directory-migrations') ? 'null' : '' };
    } } as unknown as Machines;
  const workspaces = { beforeConfigChange: () => () => {}, projects: { current: () => projectId,
    with: async (_id: string, target: string, action: () => unknown) => {
      assert.equal(target, raw._workspace); return action();
    } }, config: async () => raw, resolveProject: async (_id: string, captured: typeof raw) => {
      ++resolves; assert.equal(captured, raw);
      return { ...captured, environment: { ...captured.environment, TOKEN: 'own-private-value' } };
    }, resolvedConfig: async () => { throw new Error('must resolve only the captured config'); },
    close: async () => {} } as unknown as Workspaces;
  const terminals = new ProjectTerminals(machines, workspaces), prepare = terminals.prepare.bind(terminals);
  terminals.prepare = async (...args) => {
    const prepared = await prepare(...args), release = prepared.release;
    return { ...prepared, release: () => { ++releases; release(); } };
  };
  const close = terminals.close.bind(terminals);
  terminals.close = async () => { ++closes; await close(); };
  return { vmId, live, raw, machines, terminals, workspaces, commands,
    changeProject: () => { projectId = '2222222222222222'; },
    refuseForwarding: () => { sshConfig = 'disableforwarding yes\n'; },
    counts: () => ({ releases, closes, resolves, probes }),
    forwarder: (runTask: typeof projectIdentityTask) => new GpgAgentForwarder(machines,
      { terminals, runTask, sourceDirectory: root, captureHost: async () => { ++probes; return syntheticGpgHostSnapshot(); } }),
    done: () => terminals.close() };
}

test('GPG forwarding requires a confirmed, bounded single command', async () => {
  const f = await fixture(); let executions = 0;
  try {
    const forwarder = f.forwarder(async () => { ++executions; return { code: 0, stdout: '', stderr: '' }; });
    for (const input of [{ command: 'true' }, { command: 'true', confirmed: false }, { command: '', confirmed: true },
      { command: 'true', confirmed: true, timeoutSeconds: 301 }, { command: 'true', confirmed: true, hostSocket: '/other' }]) {
      assert.equal(gpgAgentForwardInput.safeParse(input).success, false);
      await assert.rejects(forwarder.run(f.vmId, input));
    }
    assert.equal(executions, 0); assert.deepEqual(f.counts(), { releases: 0, closes: 0, resolves: 0, probes: 0 });
  } finally { await f.done(); }
});

test('GPG captures the target before probing and transports only the resolved project body to the UID runner', async () => {
  const f = await fixture(); let calls = 0;
  try {
    const operation = f.forwarder(async (_m, id, project, body, signal, _log, timeout, path, callback, options) => {
      ++calls; assert.equal(id, f.vmId); assert.equal(project._workspace, f.raw._workspace);
      assert.equal(body.command, 'gpg --sign; echo own-private-value'); assert.equal(body.environment?.TOKEN, 'own-private-value');
      assert.equal(body.environment?.GNUPGHOME, undefined); assert.equal(body.environment?.GPG_AGENT_INFO, undefined);
      assert.equal(path, undefined); assert.equal(callback, undefined); assert.equal(timeout, 60000);
      assert.equal(signal.aborted, false); assert.equal(options?.expectedLive, f.live);
      assert.ok(options?.gpgAgent?.bridge instanceof OwnedGpgForward);
      assert.equal(options.gpgAgent.resource.hostSourceSha256, syntheticGpgHostSnapshot().hostSourceSha256);
      assert.throws(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace),
        { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      return { code: 7, stdout: 'own-private-value output', stderr: 'own-private-value' };
    }).run(f.vmId, { command: 'gpg --sign; echo own-private-value', confirmed: true });
    f.changeProject(); const result = await operation;
    assert.equal(calls, 1); assert.equal(result.code, 7); assert.equal(result.ready, false);
    assert.equal(result.stdout, '[私密配置已隐藏] output'); assert.equal(result.stderr, '[私密配置已隐藏]');
    assert.equal(result.projectId, f.raw._workspace); assert.equal(result.networkIsolation, 'private'); assert.ok(result.configVersion);
    assert.deepEqual(f.counts(), { releases: 1, closes: 0, resolves: 1, probes: 1 });
    assert.ok(f.commands.every(command => !command.includes('own-private-value') && !command.includes('/wrong/home')));
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace));
  } finally { await f.done(); }
});

test('GPG cancellation holds its project lease through cleanup and redacts a cleanup refusal', async () => {
  const f = await fixture(); let began!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const barrier = new Promise<void>(resolve => { finish = resolve; });
  try {
    const controller = new AbortController();
    const operation = f.forwarder(async (_m, _id, _p, _body, signal) => {
      began(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      assert.throws(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace),
        { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await barrier; throw new AppError('own-private-value cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    }).run(f.vmId, { command: 'sleep 600', confirmed: true }, controller.signal);
    const failure = assert.rejects(operation, error => error instanceof AppError && error.status === 503 &&
      error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && !error.message.includes('own-private-value'));
    await started; controller.abort();
    let closed = false; const closing = f.terminals.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false); assert.equal(f.counts().releases, 0);
    finish(); await failure; await closing;
    assert.equal(f.counts().releases, 1); assert.equal(f.counts().closes, 1);
  } finally { finish(); await f.done(); }
});

test('a resolver-time guest replacement refuses before a GPG command is admitted', async () => {
  const f = await fixture(); let executed = 0;
  const resolve = f.workspaces.resolveProject.bind(f.workspaces);
  f.workspaces.resolveProject = async (...args) => {
    const result = await resolve(...args); f.machines.live.set(f.vmId, {} as never); return result;
  };
  try {
    await assert.rejects(f.forwarder(async () => { ++executed; return { code: 0, stdout: '', stderr: '' }; })
      .run(f.vmId, { command: 'must-not-run', confirmed: true }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(executed, 0); assert.equal(f.counts().releases, 1);
    assert.ok(f.commands.every(command => !command.includes('sshd -T')));
  } finally { await f.done(); }
});

test('a forwarding policy refusal releases preparation without creating a GPG run', async () => {
  const f = await fixture(); let executed = 0; f.refuseForwarding();
  try {
    await assert.rejects(f.forwarder(async () => { ++executed; return { code: 0, stdout: '', stderr: '' }; })
      .run(f.vmId, { command: 'must-not-run', confirmed: true }), /未允许远端 Unix/);
    assert.equal(executed, 0); assert.equal(f.counts().releases, 1);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.vmId, f.raw._workspace));
  } finally { await f.done(); }
});

test('remote Unix forwarding accepts only guest SSH settings that allow it', async () => {
  let config = 'disableforwarding no\nallowtcpforwarding no\nallowstreamlocalforwarding yes\n';
  const machines = { exec: async () => ({ code: 0, stdout: config, stderr: '' }) } as unknown as Machines;
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), false);
  config = 'disableforwarding no\nallowtcpforwarding remote\nallowstreamlocalforwarding remote\n';
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), true);
  config = 'disableforwarding yes\nallowtcpforwarding yes\nallowstreamlocalforwarding yes\n';
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), false);
});
