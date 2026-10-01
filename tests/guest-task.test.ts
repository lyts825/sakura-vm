import test from 'node:test';
import assert from 'node:assert/strict';
import { guestTask } from '../server/guest-task.ts';
import type { Machines } from '../server/machines.ts';

const result = { stdout: 'worker output', stderr: '', code: 7 };
function fixture(execute?: (command: string, attempt: number) => Promise<typeof result>, worker = result) {
  const live = {},
    commands: string[] = [],
    logs: string[] = [];
  let controls = 0;
  const machines = {
    live: new Map([['owned', live]]),
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal) => {
      commands.push(command);
      if (command.startsWith('setsid sh -c')) {
        if (signal?.aborted) throw signal.reason;
        return worker;
      }
      if (command.startsWith('rm -f')) return { ...result, code: 0 };
      return execute ? execute(command, ++controls) : { ...result, code: 0 };
    },
  } as unknown as Machines;
  return { live, machines, commands, logs, log: (value: string) => logs.push(value) };
}

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
          f.commands.some((command) => command.startsWith('rm -f')),
          false,
        );
      },
    ),
    result,
  );
  assert.equal(callback, 1);
  assert.ok(f.logs.some((value) => value.includes('第 1 次未确认')));
  assert.equal(f.commands.at(-1)?.startsWith('rm -f'), true);
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
    f.commands.some((command) => command.startsWith('rm -f')),
    false,
  );
  assert.ok(f.logs.some((value) => value.includes('/tmp/.sakura-job-')));
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
  assert.equal(f.commands.at(-1)?.startsWith('rm -f'), true);
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
  assert.equal(f.commands.at(-1)?.startsWith('rm -f'), true);
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
      if (command.startsWith('setsid sh -c')) return result;
      if (command.startsWith('rm -f') && ++retirements === 1) throw new Error('retirement reply lost');
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
    f.commands.some((command) => command.startsWith('rm -f')),
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
    f.commands.some((command) => command.startsWith('rm -f')),
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
  assert.equal(f.commands.at(-1)?.startsWith('rm -f'), true);
});
