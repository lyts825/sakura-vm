import test from 'node:test';
import assert from 'node:assert/strict';
import { guestTask, guestTaskControlPaths, guestTaskControlRoot } from '../server/guest-task.ts';
import type { Machines } from '../server/machines.ts';
import { randomUUID } from 'node:crypto';
import { OwnedForwardAgent, bindTaskAgent } from '../server/ssh-agent-scope.ts';
import { projectIdentitySchema } from '../server/project-identity.ts';

const result = { stdout: 'worker output', stderr: '', code: 7 };

test('binary task input stays outside argv and survives the background launcher stdin redirection', async () => {
  const runId = '476c4053-3d3d-4ea4-8546-e7026ce90b46', input = Buffer.from('private task input\0中文');
  const commands: string[] = [], received: Buffer[] = [], live = {};
  const machines = {
    live: new Map([['owned', live]]),
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal) => {
      assert.equal(signal, undefined, 'cleanup uses its own uncancelled connections');
      commands.push(command); return { ...result, code: 0 };
    },
    execInput: async (_id: string, command: string, body: Buffer) => {
      commands.push(command); received.push(body);
      assert.ok(command.startsWith('# SAKURA_GUEST_TASK_RUN\n') && command.includes('exec 7<&0'));
      assert.ok(command.includes('<&7 &') && command.includes('exec 7<&-'));
      assert.ok(command.includes('sakura-task-' + runId));
      assert.ok(!command.includes('private task input') && !command.includes(input.toString('base64')));
      return result;
    },
  } as unknown as Machines;
  const operation = guestTask(machines, 'owned', '/fixed/payload-launcher', new AbortController().signal,
    undefined, 10000, undefined, undefined, { input, runId });
  input.fill(0);
  assert.deepEqual(await operation, result);
  assert.equal(received[0].toString(), 'private task input\0中文');
  assert.ok(commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'));
});

test('oversized task input is refused before allocating or cleaning any task receipt', async () => {
  let calls = 0;
  const machines = { live: new Map(), exec: async () => { calls++; return result; },
    execInput: async () => { calls++; return result; } } as unknown as Machines;
  await assert.rejects(guestTask(machines, 'owned', '/fixed/launch', new AbortController().signal,
    undefined, 10000, undefined, undefined, { input: Buffer.alloc(131073) }), { code: 'GUEST_INPUT_INVALID' });
  assert.equal(calls, 0);
});

test('only an exact minted Agent task preserves the authenticated channel socket; every cleanup stays env-i', async () => {
  const runId = randomUUID(), identityId = randomUUID(), commands: string[] = [], live = {};
  const agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal);
  const machines = { live: new Map([['owned', live]]),
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal, _log?: unknown, source?: unknown) => {
      commands.push(command); assert.equal(signal, undefined); assert.equal(source, undefined);
      return { ...result, code: 0 };
    }, execInput: async (_id: string, command: string, input: Buffer, _timeout: number,
      _signal: AbortSignal, _log: unknown, source: unknown) => {
      commands.push(command); assert.equal(source, agent); assert.equal(input.toString(), 'protected frame');
      return result;
    } } as unknown as Machines;
  const ctx = { resource: { version: 1 as const, kind: 'ssh-agent' as const, leaseId: randomUUID(), brokerSha256: 'a'.repeat(64), timeoutSeconds: 60 },
    identity: projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUID(), projectId: 'default', identityId,
      revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
      home: '/var/lib/sakura-project-homes/' + identityId, directory: '/workspace', directoryDevice: '1', directoryInode: '2',
      homeDevice: '1', homeInode: '3', networkIsolation: 'host' }),
    owner: { kind: 'task' as const, runId, bootId: randomUUID() }, sha256: 'b'.repeat(64) };
  const release = bindTaskAgent(machines, 'owned', ctx, agent, live as never);
  try {
    assert.deepEqual(await guestTask(machines, 'owned', '/fixed/agent-native-launcher', new AbortController().signal,
      undefined, 10000, agent, undefined, { input: Buffer.from('protected frame'), runId, forwardedAgent: true }), result);
    assert.ok(commands[0].includes('env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C SAKURA_SSH_AGENT_SOURCE="${SSH_AUTH_SOCK-}"'));
    assert.ok(commands.slice(1).every(command => command.includes('env -i PATH=') && !command.includes('SSH_AUTH_SOCK') && !command.includes('SAKURA_SSH_AGENT_SOURCE')));
    const count = commands.length;
    for (const options of [{ runId: randomUUID(), input: Buffer.from('frame') }, { runId, input: undefined }])
      await assert.rejects(guestTask(machines, 'owned', '/fixed/launch', new AbortController().signal,
        undefined, 10000, agent, undefined, { ...options, forwardedAgent: true }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    machines.live.set('owned', {} as never);
    await assert.rejects(guestTask(machines, 'owned', '/fixed/launch', new AbortController().signal,
      undefined, 10000, agent, undefined, { runId, input: Buffer.from('frame'), forwardedAgent: true }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(commands.length, count, 'rejected caller flags cannot allocate or clean an unrelated task');
  } finally { release(); await agent.close(); }
});
function fixture(execute?: (command: string, attempt: number) => Promise<typeof result>, worker = result) {
  const live = {},
    commands: string[] = [],
    logs: string[] = [];
  let controls = 0;
  const machines = {
    live: new Map([['owned', live]]),
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal) => {
      commands.push(command);
      if (command.startsWith('# SAKURA_GUEST_TASK_RUN\n')) {
        if (signal?.aborted) throw signal.reason;
        return worker;
      }
      if (command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')) return { ...result, code: 0 };
      return execute ? execute(command, ++controls) : { ...result, code: 0 };
    },
  } as unknown as Machines;
  return { live, machines, commands, logs, log: (value: string) => logs.push(value) };
}

test('identity receipt cleanup failures retain their error code and cannot retire the outer receipt', async () => {
  const f = fixture();
  await assert.rejects(guestTask(f.machines, 'owned', 'true', new AbortController().signal,
    undefined, 10000, undefined, async () => {
      throw new (await import('../server/model.ts')).AppError('identity still unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    }), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.commands.some(command => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')), false);
});

test('cleanup retries its independent connection before the stage callback and receipt retirement', async () => {
  const f = fixture(async (_command, attempt) => {
    if (attempt === 1) throw new Error('first cleanup connection failed');
    return { ...result, code: 0 };
  });
  let callback = 0;
  assert.deepEqual(
    await guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        ++callback;
        assert.equal(f.commands.filter((command) => command.includes('sakura_owned_anchor')).length, 2);
        assert.equal(
          f.commands.some((command) => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')),
          false,
        );
      },
    ),
    result,
  );
  assert.equal(callback, 1);
  assert.ok(f.logs.some((value) => value.includes('第 1 次未确认')));
  assert.equal(f.commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'), true);
});

test('unconfirmed task scope cleanup keeps the receipt and never runs stage cleanup', async () => {
  const f = fixture(async () => ({ ...result, stderr: 'owned group still alive', code: 1 }));
  let callback = 0;
  await assert.rejects(
    guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        ++callback;
      },
    ),
    (error: any) =>
      error.code === 'GUEST_TASK_CLEANUP_FAILED' && /owned group still alive/.test(error.message),
  );
  assert.equal(callback, 0);
  assert.equal(f.commands.filter((command) => command.includes('sakura_owned_anchor')).length, 3);
  assert.equal(
    f.commands.some((command) => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')),
    false,
  );
  assert.ok(f.logs.some((value) => value.includes('/run/sakura-guest-tasks/')));
});

test('stage cleanup retries only after the scope is confirmed and preserves worker status', async () => {
  const f = fixture();
  let attempts = 0;
  assert.deepEqual(
    await guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        assert.equal(f.commands.filter((command) => command.includes('sakura_owned_anchor')).length, 1);
        if (++attempts < 3) throw new Error('stage connection failed');
      },
    ),
    result,
  );
  assert.equal(attempts, 3);
  assert.equal(f.commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'), true);
});

test('a guest without the required task scope reports refusal instead of a successful command', async () => {
  const refused = {
    stdout: '',
    stderr: 'SAKURA_TASK_SCOPE_UNAVAILABLE: 客户机需要可写 cgroup v2；项目代码未执行',
    code: 126,
  };
  const f = fixture(undefined, refused);
  let callback = false;
  await assert.rejects(
    guestTask(
      f.machines,
      'owned',
      'project command',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        callback = true;
      },
    ),
    (error: any) => error.code === 'GUEST_TASK_SCOPE_UNAVAILABLE' && /项目代码未执行/.test(error.message),
  );
  assert.equal(callback, true);
  assert.equal(f.commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'), true);
});

test('lost retirement acknowledgements retry the same receipt after a single authorized stage cleanup', async () => {
  const commands: string[] = [],
    logs: string[] = [];
  const live = {};
  let retirements = 0,
    callbacks = 0;
  const machines = {
    live: new Map([['owned', live]]),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.startsWith('# SAKURA_GUEST_TASK_RUN\n')) return result;
      if (command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n') && ++retirements === 1) throw new Error('retirement reply lost');
      return { ...result, code: 0 };
    },
  } as unknown as Machines;
  assert.deepEqual(
    await guestTask(
      machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      (value) => logs.push(value),
      10000,
      undefined,
      async () => {
        ++callbacks;
      },
    ),
    result,
  );
  assert.equal(callbacks, 1);
  assert.equal(retirements, 2);
  assert.equal(commands.at(-1), commands.at(-2));
  assert.ok(logs.some((value) => value.includes('归属核销第 1 次未确认')));
});

test('stage callbacks are refused when the guest boot or stopped scope cannot be reconfirmed', async () => {
  const f = fixture(async (command) => ({
    ...result,
    code: command.includes('任务停止归属记录已丢失') ? 1 : 0,
    stderr: command.includes('任务停止归属记录已丢失') ? 'guest boot changed before stage cleanup' : '',
  }));
  let callbacks = 0;
  await assert.rejects(
    guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        ++callbacks;
      },
    ),
    /guest boot changed/,
  );
  assert.equal(callbacks, 0);
  assert.equal(f.commands.filter((command) => command.includes('任务停止归属记录已丢失')).length, 3);
  assert.equal(
    f.commands.some((command) => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')),
    false,
  );
});

test('stage cleanup failure and live instance replacement cannot retire uncertain ownership', async () => {
  const f = fixture();
  let attempts = 0;
  await assert.rejects(
    guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        ++attempts;
        throw new Error('stage connection failed');
      },
    ),
    /后续清理未确认/,
  );
  assert.equal(attempts, 3);
  assert.equal(
    f.commands.some((command) => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')),
    false,
  );
  const changed = fixture(async () => {
    changed.machines.live.set('owned', {} as any);
    return { ...result, code: 0 };
  });
  let callback = false;
  await assert.rejects(
    guestTask(
      changed.machines,
      'owned',
      'true',
      new AbortController().signal,
      changed.log,
      10000,
      undefined,
      async () => {
        callback = true;
      },
    ),
    /实例已改变/,
  );
  assert.equal(callback, false);
  assert.equal(changed.commands.filter((command) => command.includes('sakura_owned_anchor')).length, 1);
});

test('cancellation still performs cleanup without passing an already aborted signal to control calls', async () => {
  const f = fixture(),
    controller = new AbortController();
  const original = new Error('owned cancellation');
  controller.abort(original);
  let callback = false;
  await assert.rejects(
    guestTask(f.machines, 'owned', 'true', controller.signal, f.log, 10000, undefined, async () => {
      callback = true;
    }),
    (error) => error === original,
  );
  assert.equal(callback, true);
  assert.equal(f.commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'), true);
});

test('private control path and every root phase validate protected parents and the same call nonce', async () => {
  const runId = 'd0ae3dc9-206b-498d-b172-6c9cb2c6e2f1', f = fixture();
  assert.deepEqual(guestTaskControlPaths(runId), {
    directory: guestTaskControlRoot + '/' + runId,
    receipt: guestTaskControlRoot + '/' + runId + '/.sakura-job-' + runId + '.pid',
  });
  await guestTask(f.machines, 'owned', 'true', new AbortController().signal, undefined,
    10000, undefined, async () => {}, { runId });
  const phases = ['RUN', 'CLEANUP', 'CONFIRM_STOPPED', 'RETIRE'];
  assert.equal(f.commands.length, phases.length);
  let nonce: string | undefined;
  for (let index = 0; index < phases.length; ++index) {
    const command = f.commands[index];
    assert.ok(command.startsWith('# SAKURA_GUEST_TASK_' + phases[index] + '\n'));
    assert.ok(command.includes('/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c'));
    assert.match(command, /sakura_control_directory \/ parent/);
    assert.match(command, /sakura_control_directory \/run parent/);
    assert.ok(command.includes('0 0 600 1'));
    assert.ok(command.includes('run UUID') || command.includes('sakura_control_task'));
    assert.doesNotMatch(command, /chmod|\/tmp\/\.sakura-job-/);
    const tokens = [...new Set(command.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g))]
      .filter(value => value !== runId);
    assert.equal(tokens.length, 1);
    if (nonce) assert.equal(tokens[0], nonce);
    else nonce = tokens[0];
  }
  const again = fixture();
  await guestTask(again.machines, 'owned', 'true', new AbortController().signal, undefined,
    10000, undefined, undefined, { runId });
  assert.ok(!again.commands[0].includes(nonce!));
  assert.ok(f.commands.at(-1)?.includes('任务域未停止，拒绝核销控制记录'));
  assert.ok(f.commands.at(-1)?.includes('授权记录缺失且控制目录非空'));
});

test('a refused private control directory cannot invoke cleanup callbacks or report worker success', async () => {
  const f = fixture(async () => ({ ...result, code: 125, stderr: 'SAKURA_TASK_CONTROL_REFUSED: 控制目录必须为 root0700' }));
  let callback = 0;
  await assert.rejects(guestTask(f.machines, 'owned', 'true', new AbortController().signal,
    f.log, 10000, undefined, async () => { callback++; }), (error: any) =>
      error.code === 'GUEST_TASK_CLEANUP_FAILED' && error.message.includes('root0700'));
  assert.equal(callback, 0);
  assert.equal(f.commands.some(value => value.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')), false);
  assert.ok(f.commands.slice(1).every(value => value.includes('sakura_control_task')));
});

test('private receipt retirement failures cannot downgrade unconfirmed control ownership to success', async () => {
  const commands: string[] = [], live = {};
  const machines = { live: new Map([['owned', live]]), exec: async (_id: string, command: string) => {
    commands.push(command);
    return command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')
      ? { code: 125, stdout: '', stderr: 'SAKURA_TASK_CONTROL_REFUSED: 任务控制授权或启动身份不符' }
      : { ...result, code: command.startsWith('# SAKURA_GUEST_TASK_RUN\n') ? 7 : 0 };
  } } as unknown as Machines;
  await assert.rejects(guestTask(machines, 'owned', 'exit 7', new AbortController().signal), {
    code: 'GUEST_TASK_CLEANUP_FAILED',
  });
  assert.equal(commands.filter(value => value.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')).length, 3);
});
