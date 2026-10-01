import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Machines } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema } from '../server/workspaces.ts';
import { runSshAgentForward } from '../server/ssh-agent-forward.ts';

test('agent commands use project scope, preserve the forwarded socket, redact secrets and cancel their process group', async () => {
  const socket = process.platform === 'win32' ? '\\\\.\\pipe\\sakura-agent-test-' + randomUUID() :
    join(tmpdir(), 'sakura-agent-' + randomUUID());
  const agent = createServer((connection) => connection.on('error', () => {}));
  await new Promise<void>((done) => agent.listen(socket, done));
  const previous = process.env.SSH_AUTH_SOCK;
  process.env.SSH_AUTH_SOCK = socket;
  const id = randomUUID(), lock = new Machines({} as Engine), commands: { command: string; agent?: string }[] = [];
  let wait = false, badNamespace = false, began!: () => void;
  const executing = new Promise<void>((done) => { began = done; });
  const live = {};
  const machines = {
    get: () => ({ distro: 'alpine' }), state: () => 'running', requireUnlocked: () => {},
    locked: lock.locked.bind(lock), live: new Map([[id, live]]),
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal,
      _log?: unknown, path?: string) => {
      commands.push({ command, agent: path });
      if (!command.includes('setsid sh -c')) return { code: badNamespace ? 1 : 0,
        stdout: '', stderr: badNamespace ? '项目命名空间已有网络路由' : '' };
      began();
      if (wait) await new Promise<void>((_done, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return { code: 7, stdout: 'private-agent-value output', stderr: 'private-agent-value' };
    },
  } as unknown as Machines;
  const project = projectSchema.parse({ directory: '/workspace/agent', networkIsolation: 'private',
    environment: { TOKEN: 'private-agent-value', SSH_AUTH_SOCK: '/tmp/incorrect-agent' }, secrets: { TOKEN: 'agent-key' } });
  const workspaces = { resolvedConfig: async () => project } as unknown as Workspaces;
  try {
    const result = await runSshAgentForward(machines, id, { command: 'ssh-add -L', confirmed: true }, undefined, workspaces);
    assert.equal(result.code, 7);
    assert.equal(result.projectId, 'default');
    assert.equal(result.networkIsolation, 'private');
    assert.equal(result.stdout, '[私密配置已隐藏] output');
    assert.equal(result.stderr, '[私密配置已隐藏]');
    const command = commands.find((item) => item.command.includes('setsid sh -c'))!;
    assert.equal(command.agent, socket);
    assert.ok(command.command.indexOf('ip netns exec sk-default') < command.command.indexOf('export TOKEN='));
    assert.ok(!command.command.includes('/tmp/incorrect-agent'));
    assert.ok(commands.filter((item) => item !== command).every((item) => !item.agent && !item.command.includes('private-agent-value')));
    badNamespace = true;
    await assert.rejects(runSshAgentForward(machines, id, { command: 'true', confirmed: true }, undefined, workspaces), /网络路由/);
    assert.equal(commands.filter((item) => item.agent).length, 1);
    badNamespace = false; wait = true;
    const abort = new AbortController();
    const cancelled = runSshAgentForward(machines, id, { command: 'sleep 600', confirmed: true }, abort.signal, workspaces);
    // The second invocation reaches the command after its fresh agent probe.
    const deadline = Date.now() + 5000;
    while (commands.filter((item) => item.agent).length < 2) {
      assert.ok(Date.now() < deadline, 'The cancellable command must start');
      await new Promise((done) => setTimeout(done, 1));
    }
    await executing;
    await assert.rejects(machines.locked(id, async () => {}), /另一项操作/);
    const rejected = assert.rejects(cancelled);
    abort.abort(); await rejected;
    assert.ok(commands.filter((item) => item.command.includes('sakura_owned_anchor') && item.command.includes('.pid.stop')).length >= 2);
    await machines.locked(id, async () => {});
  } finally {
    if (previous === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = previous;
    await new Promise<void>((done) => agent.close(() => done()));
  }
});
