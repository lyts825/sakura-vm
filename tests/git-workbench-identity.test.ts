import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { GitWorkbench, type GitWorkbenchOptions } from '../server/git-workbench.ts';
import { GitProjectTasks } from '../server/git-project-task.ts';
import type { Machines } from '../server/machines.ts';
import { projectSchema, projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { textVersion } from '../server/files.ts';
import { Jobs } from '../server/jobs.ts';
import { ProjectIdentities, projectIdentityPayload, type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';

const id = '11111111-1111-4111-8111-111111111111', scope = '0123456789abcdef';
type Output = { code: number; stdout: string; stderr: string };
const output = (stdout = '', code = 0, stderr = ''): Output => ({ stdout, code, stderr });
function clone(project: Project) {
  return Object.defineProperty(structuredClone(project), '_workspace', { value: project._workspace, enumerable: false });
}
function fixture(mode: 'host' | 'private' = 'private') {
  const context = new AsyncLocalStorage<string>(), abort = new AbortController(), live = {};
  let outside = scope, forced: string | undefined, leaseOpen = false, creates = 0, releases = 0, closes = 0, resolves = 0;
  const config = Object.defineProperty(projectSchema.parse({ directory: '/workspace/app', networkIsolation: mode,
    environment: { MODE: 'original' }, secrets: { TOKEN: 'git-token' } }), '_workspace', { value: scope, enumerable: false });
  const commands: Parameters<NonNullable<GitWorkbenchOptions['runProjectTask']>>[] = [], events: string[] = [];
  const files = new Map([['/workspace/app/conflict.txt', 'current\n']]), administrative: string[] = [];
  const machines = {
    live: new Map([[id, live]]), state: () => 'running',
    locked: async (_id: string, action: () => unknown) => action(),
    exec: async () => { throw new Error('Root Git fallback forbidden'); },
    execInput: async () => { throw new Error('Direct root payload execution forbidden'); },
    readGuestFile: async (_id: string, path: string) => {
      assert.ok(leaseOpen); administrative.push('read:' + path); return files.get(path)!;
    },
    writeGuestFile: async (_id: string, path: string, content: string, overwrite: boolean, expected?: string) => {
      assert.ok(leaseOpen); assert.equal(overwrite, true); assert.equal(textVersion(files.get(path)!), expected);
      assert.ok(Buffer.byteLength(content) <= 1024 ** 2); administrative.push('write:' + path); files.set(path, content);
    },
  } as unknown as Machines;
  const workspaces = {
    projects: { current: () => forced || context.getStore() || outside,
      key: () => id + ':' + (forced || context.getStore() || outside),
      inScope: (_id: string, projectId: string, action: () => unknown) => context.run(projectId, action) },
    config: async () => clone(config),
    resolvedConfig: async () => { throw new Error('Selected project reread forbidden'); },
    resolveProject: async (_id: string, captured: Project) => {
      ++resolves; assert.equal(captured._workspace, scope); assert.equal(projectVersion(captured), projectVersion(config));
      return { ...captured, _workspace: scope, environment: { ...captured.environment, TOKEN: 'private-git-token' } };
    },
  } as unknown as Workspaces;
  const manager: ReturnType<NonNullable<GitWorkbenchOptions['createPreparation']>> = {
    prepare: async (_id, projectId, session, readOnly, signal, _terminal, options) => {
      assert.equal(projectId, scope); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(options, { mode: 'task' }); leaseOpen = true; events.push('prepare');
      return { projectId: scope, command: 'unused', terminalId: undefined, networkIsolation: mode, signal: signal!,
        captured: { project: clone(config), configVersion: projectVersion(config), live: live as any },
        release() { leaseOpen = false; ++releases; events.push('release'); } };
    }, close: async () => { assert.equal(leaseOpen, false); ++closes; events.push('close'); },
  };
  let answer = async (command: string): Promise<Output> => {
    if (command.includes('rev-parse --is-inside-work-tree')) return output('true\n');
    if (command.includes('status --porcelain')) return output(' M tracked.txt\0?? new.txt\0');
    if (command.includes('symbolic-ref --quiet HEAD')) return output('refs/heads/main\n');
    if (command.includes('rev-parse --verify HEAD')) return output('a'.repeat(40) + '\n');
    if (command.includes('for-each-ref') && command.includes('upstream:short')) return output('');
    if (command.includes('for-each-ref')) return output('main\nreview\n');
    if (command.includes('log -30')) return output('a'.repeat(40) + '\0aaaaaaa\0subject\0author\0' + '2026-10-02T00:00:00Z\0\n');
    if (command.includes('remote get-url')) return output('https://example.test/repository.git\n');
    if (command.endsWith(' remote')) return output('origin\n');
    if (command.includes('remote -v')) return output('origin\thttps://user:uri-secret@example.test/repository.git?token=url-secret\t(fetch)\n');
    if (command.includes('ls-files --unmerged')) return output([1, 2, 3].map((stage) => `100644 ${String(stage).repeat(40)} ${stage}\tconflict.txt\0`).join(''));
    if (command.includes('cat-file -s')) return output('5\n');
    if (command.includes('cat-file blob')) return output('blob\n');
    if (command.includes('grep --cached')) return output('', 1);
    if (command.includes('hash-object --no-filters')) return output('b'.repeat(40) + '\n');
    if (command.includes('then printf link')) return output('file');
    if (command.includes('ls-files --others')) return output('new.txt\0');
    return output();
  };
  const options: GitWorkbenchOptions = {
    createPreparation: () => { ++creates; return manager; },
    runProjectTask: async (...args) => {
      const [, vmId, captured, execution, signal, _log, timeout, _agent, _cleanup, pins] = args;
      assert.equal(vmId, id); assert.equal(captured._workspace, scope); assert.equal(captured.networkIsolation, mode);
      assert.equal(projectVersion(captured), projectVersion(config)); assert.equal(pins?.expectedLive, live);
      assert.equal(signal.aborted, false); assert.ok(leaseOpen); assert.ok([10000, 30000, 120000].includes(timeout!));
      assert.equal(execution.environment?.TOKEN, 'private-git-token'); projectIdentityPayload(execution);
      commands.push(args); events.push('uid-start');
      const result = await answer(execution.command);
      events.push('domain-removed'); events.push('ticket-closed'); return result;
    },
  };
  const service = new GitWorkbench(machines, workspaces, options); service.jobs = new Jobs();
  const run = async (value: unknown) => { const job = await service.run(id, value); await service.jobs.wait(job.key!); return job; };
  return { service, run, options, manager, machines, workspaces, config, live, abort, commands, events, files, administrative,
    answer: (value: typeof answer) => { answer = value; }, creates: () => creates, releases: () => releases,
    closes: () => closes, resolves: () => resolves, leaseOpen: () => leaseOpen,
    switchOutside: () => { outside = 'fedcba9876543210'; }, forceScope: () => { forced = 'fedcba9876543210'; } };
}

test('a complete named-project view resolves once, holds one lease and preserves NUL-parsed Git status/history', async (t) => {
  const f = fixture(); t.after(() => f.service.close()); const result = await f.service.view(id, f.abort.signal);
  assert.equal(result.projectId, scope); assert.equal(result.repository, true);
  assert.deepEqual(result.changes.map((item) => item.path), ['tracked.txt', 'new.txt']);
  assert.equal(result.history[0].subject, 'subject'); assert.equal(result.branch, 'main');
  assert.equal(f.resolves(), 1); assert.equal(f.creates(), 1); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  assert.ok(f.commands.length >= 8);
  for (const [, , captured, execution] of f.commands) {
    assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
    assert.equal('HOME' in execution.environment!, false); assert.match(execution.command, /GIT_CONFIG_GLOBAL="\$HOME\/\.gitconfig"/);
    assert.ok(execution.command.startsWith('set -eu\n'));
    assert.equal(execution.command.includes('cd '), false, 'native cwd descriptor must remain authoritative');
  }
  assert.equal(JSON.stringify(result).includes('uri-secret'), false); assert.equal(JSON.stringify(result).includes('url-secret'), false);
  assert.deepEqual(f.events.slice(-4), ['domain-removed', 'ticket-closed', 'release', 'close']);
});

test('project selection during the first read cannot reinterpret the original named scope, task payload or job key', async (t) => {
  const f = fixture(), read = f.workspaces.config; t.after(() => f.service.close());
  f.workspaces.config = async (...args) => { f.switchOutside(); return read(...args); };
  const job = await f.run({ action: 'stage', paths: ['new.txt'] });
  assert.equal(job.status, 'done', job.error); assert.equal(job.projectId, scope); assert.equal(job.key, id + ':' + scope);
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0][2]._workspace, scope);
  assert.equal(f.workspaces.projects.current(id), 'fedcba9876543210');
});

test('host and private operations use only bounded UID frames; secrets, author and message never enter root launch argv', async (t) => {
  for (const mode of ['host', 'private'] as const) {
    const f = fixture(mode); t.after(() => f.service.close());
    f.config.environment = { ...f.config.environment, GIT_CONFIG_PARAMETERS: "'include.path=/root/.gitconfig'",
      GIT_DIR: '/root/administrative.git', GIT_CONFIG_GLOBAL: '/root/.gitconfig' };
    const job = await f.run({ action: 'commit', message: 'user body private-git-token', author: 'Author Example', email: 'author@example.test' });
    assert.equal(job.status, 'done', job.error); assert.equal(f.resolves(), 1);
    const execution = f.commands.at(-1)![3], identityId = randomUUID(), runId = randomUUID();
    assert.match(execution.command, /unset GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_DIR/);
    assert.match(execution.command, /GIT_CONFIG_GLOBAL="\$HOME\/\.gitconfig" GIT_CONFIG_COUNT=0/);
    assert.equal(execution.environment?.GIT_CONFIG_PARAMETERS, "'include.path=/root/.gitconfig'",
      'project environment remains in UID frame; the UID Git body clears its administrative config overrides');
    const identity: ProjectIdentity = { version: 1, phase: 'active', registryId: randomUUID(), identityId, projectId: scope,
      revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 24000, gid: 24000,
      home: '/var/lib/sakura-project-homes/' + identityId, directory: '/workspace/app', networkIsolation: mode,
      homeDevice: '1', homeInode: '2', directoryDevice: '1', directoryInode: '3' };
    const run: ProjectIdentityRun = { version: 1, phase: 'active', mode: 'inherit-current', registryId: identity.registryId,
      identityId, projectId: scope, revision: 1, runId, bootId: randomUUID(), build: 'a'.repeat(64),
      networkDevice: '1', networkInode: '4', cgroupDevice: '1', cgroupInode: '5', cgroupName: 'sakura-task-' + runId,
      namespace: mode === 'private' ? 'sk-' + scope : '' };
    const payload = new ProjectIdentities(f.machines).input(identity, run, execution);
    assert.equal(payload.command.includes('private-git-token'), false); assert.equal(payload.command.includes('Author Example'), false);
    assert.equal(payload.command.includes('commit'), false); assert.ok(payload.input.includes(Buffer.from(execution.command)));
    assert.equal(payload.input.readUInt32LE(12), 0); assert.deepEqual(f.administrative, []);
  }
});

test('untracked diff keeps exit code 1 semantics, existing truncation, and resolved secret redaction', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  f.answer(async (command) => command.includes('ls-files') ? output('new.txt\0')
    : output('private-git-token\n' + 'x'.repeat(210000), 1));
  const result = await f.service.diff(id, 'new.txt', false, f.abort.signal);
  assert.equal(result.truncated, true); assert.equal(result.diff.length, 200000);
  assert.ok(result.diff.startsWith('[私密配置已隐藏]')); assert.equal(f.commands.length, 2);
  assert.match(f.commands[1][3].command, /--no-ext-diff --no-textconv --no-index -- \/dev\/null/);
  assert.equal(f.resolves(), 1); assert.equal(f.releases(), 1);
});

test('merge versions keep raw expected hashes while the administrator file read stays pinned inside the lease', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  const result = await f.service.mergeInputs(id, 'conflict.txt', f.abort.signal);
  assert.equal(result.expectedVersion, textVersion('current\n')); assert.equal(result.base, 'blob\n');
  assert.deepEqual(f.administrative, ['read:/workspace/app/conflict.txt']);
  assert.ok(f.commands[0][3].command.includes('test ! -L')); assert.equal(f.commands[0][6], 10000);
  assert.equal(f.resolves(), 1); assert.equal(f.releases(), 1);
});

test('resolve preserves the administrator editor upload and 1 MiB contract without placing file content in the Git frame', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  const current = await f.service.mergeInputs(id, 'conflict.txt'), content = 'z'.repeat(1024 ** 2);
  f.commands.length = 0; f.administrative.length = 0;
  const job = await f.run({ action: 'resolve', path: current.path, expectedVersion: current.expectedVersion,
    expectedIndex: current.expectedIndex, content });
  assert.equal(job.status, 'done', job.error); assert.equal(f.files.get('/workspace/app/conflict.txt'), content);
  assert.deepEqual(f.administrative, ['read:/workspace/app/conflict.txt', 'write:/workspace/app/conflict.txt']);
  assert.ok(f.commands.every((args) => !args[3].command.includes(content)));
  assert.match(f.commands.at(-1)![3].command, /add -- 'conflict\.txt'/); assert.equal(f.resolves(), 2);
});

test('symlink, file type and readlink probes for conflict choices are UID tasks in the same operation', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  f.answer(async (command) => command.includes('ls-files --unmerged')
    ? output(`120000 ${'a'.repeat(40)} 2\tshortcut\0`)
    : command.includes('then printf link') ? output('link') : command.includes('readlink -n') ? output('private-git-token') : output());
  const choices = await f.service.conflictChoices(id, 'shortcut');
  assert.equal(choices.worktree, 'link'); assert.equal(choices.expectedWorktree, textVersion('link:private-git-token'));
  assert.equal(f.commands.length, 4); assert.equal(f.resolves(), 1); assert.deepEqual(f.administrative, []);
});

test('invalid paths and unknown actions reject before task preparation or any administrator file operation', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  for (const path of ['/etc/config', '../outside', 'bad\0path']) {
    await assert.rejects(f.service.diff(id, path, false)); await assert.rejects(f.service.mergeInputs(id, path));
    await assert.rejects(f.service.conflictChoices(id, path));
  }
  await assert.rejects(f.service.run(id, { action: 'root-exec', command: 'id' }));
  assert.equal(f.creates(), 0); assert.equal(f.commands.length, 0); assert.deepEqual(f.administrative, []);
});

test('later config, scope or live changes block the next Git command, keep original effects and release the original lease', async (t) => {
  for (const change of ['config', 'scope', 'live'] as const) {
    const f = fixture(); t.after(() => f.service.close());
    f.answer(async () => {
      if (change === 'config') f.config.environment = { MODE: 'changed' };
      if (change === 'scope') f.forceScope();
      if (change === 'live') f.machines.live.set(id, {} as any);
      return output('true\n');
    });
    await assert.rejects(f.service.view(id), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.commands.length, 1); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

test('invalid preparation lease, inconsistent resolved boundary and missing directory never execute Git', async (t) => {
  for (const kind of ['lease-live', 'lease-version', 'resolved-directory', 'directory-missing'] as const) {
    const f = fixture(); t.after(() => f.service.close());
    if (kind === 'resolved-directory') {
      const resolve = f.workspaces.resolveProject;
      f.workspaces.resolveProject = async (...args) => ({ ...await resolve(...args), directory: '/workspace/other' });
    } else {
      const prepare = f.manager.prepare;
      f.manager.prepare = async (...args) => {
        if (kind === 'directory-missing') throw new AppError('explicit migration needed', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING');
        const lease = await prepare(...args);
        if (kind === 'lease-live') lease.captured!.live = {} as any;
        else lease.captured!.configVersion = '0'.repeat(64); return lease;
      };
    }
    await assert.rejects(f.service.view(id)); assert.equal(f.commands.length, 0); assert.equal(f.closes(), 1);
  }
});

test('canceled GET and unknown contexts never retry as root or publish a partial view', async (t) => {
  const f = fixture(); t.after(() => f.service.close()); f.abort.abort();
  await assert.rejects(f.service.view(id, f.abort.signal), (error: any) => error.name === 'AbortError');
  assert.equal(f.creates(), 0); assert.equal(f.commands.length, 0);
  const tasks = new GitProjectTasks(f.machines, f.workspaces, f.options); t.after(() => tasks.close());
  await assert.rejects(tasks.exec(id, 'git status'), (error: any) => error.code === 'PROJECT_IDENTITY_TASK_CONTEXT_MISSING');
});

test('native cleanup 503 and transport failures propagate unchanged and never become repository:false', async (t) => {
  for (const failure of [new AppError('original native receipt retained', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'),
    new Error('SSH transport disconnected')]) {
    const f = fixture(); t.after(() => f.service.close());
    f.options.runProjectTask = async () => { throw failure; };
    await assert.rejects(f.service.view(id), (error) => error === failure);
    assert.equal(f.releases(), 1); assert.equal(f.closes(), 1); assert.deepEqual(f.administrative, []);
  }
});

test('Jobs keeps cancellation plus uncertain native cleanup as durable error with the original cleanup code', async (t) => {
  const f = fixture(); t.after(() => f.service.close()); let ready!: () => void;
  const entered = new Promise<void>((resolve) => { ready = resolve; });
  f.options.runProjectTask = async (_machines, _id, _captured, _execution, signal) => {
    ready(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new AppError('original whole domain still populated', 503, 'GUEST_TASK_CLEANUP_FAILED');
  };
  const job = await f.service.run(id, { action: 'stage', paths: ['tracked.txt'] }); await entered;
  f.service.jobs.cancel(job.id!); await f.service.jobs.wait(job.key!);
  assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

test('simultaneous preparation and task cleanup failures stay AppError 503 for Jobs and preserve all original causes', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  const taskFailure = new AppError('native ticket retained', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  const leaseFailure = new Error('lease release failed'), prepare = f.manager.prepare;
  f.manager.prepare = async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = () => { release(); throw leaseFailure; }; return lease;
  };
  f.options.runProjectTask = async () => { throw taskFailure; };
  await assert.rejects(f.service.view(id), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, taskFailure.code);
    assert.deepEqual((error as any).errors, [taskFailure, leaseFailure]); assert.equal((error as any).cause, taskFailure); return true;
  });
  const job = await f.run({ action: 'stage', paths: ['tracked.txt'] });
  assert.equal(job.status, 'error'); assert.equal(job.errorCode, taskFailure.code); assert.equal(f.closes(), 2);
});

test('commit secret scan logs only locations and retains its stop behavior after UID migration', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  f.answer(async (command) => command.includes('grep --cached') ? output('keys.txt\0' + '2\0private-git-token\n')
    : command.includes('status --porcelain') ? output('M  keys.txt\0') : output('main\n'));
  const job = await f.run({ action: 'commit', message: 'must stop' });
  assert.equal(job.status, 'error'); assert.match(job.log, /keys\.txt:2/);
  assert.equal(job.log.includes('private-git-token'), false); assert.match(job.error!, /疑似密钥/);
  assert.equal(f.commands.some((args) => args[3].command.includes('commit -m')), false);
});

test('long payloads and outputs are rejected explicitly without truncating raw Git data or invoking a root fallback', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  const job = await f.run({ action: 'stage', paths: Array.from({ length: 200 }, (_, i) => `${i}/` + 'x'.repeat(4090)) });
  assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); assert.equal(f.commands.length, 0);
  f.answer(async () => output('x'.repeat(1024 ** 2 + 1)));
  await assert.rejects(f.service.view(id), (error: any) => error.code === 'GIT_OUTPUT_TOO_LARGE');
  assert.equal(f.releases(), 2); assert.equal(f.closes(), 2);
});

test('an accepted job keeps the preparation lease until the last UID task has finished all cleanup', async (t) => {
  const f = fixture(); t.after(() => f.service.close()); let started!: () => void, finish!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; }), gate = new Promise<void>((resolve) => { finish = resolve; });
  f.options.runProjectTask = async () => { started(); await gate; assert.ok(f.leaseOpen()); f.events.push('last-domain-confirmed'); return output(); };
  const job = await f.service.run(id, { action: 'stage', paths: ['tracked.txt'] }); await ready;
  assert.equal(f.releases(), 0); assert.equal(f.closes(), 0); finish(); await f.service.jobs.wait(job.key!);
  assert.equal(job.status, 'done'); assert.deepEqual(f.events, ['prepare', 'last-domain-confirmed', 'release', 'close']);
});

test('default AbortController cancellation inside a prepared GET preserves the original DOMException', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  f.answer(async () => { f.abort.abort(); f.abort.signal.throwIfAborted(); return output(); });
  await assert.rejects(f.service.view(id, f.abort.signal), error => error === f.abort.signal.reason);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

test('a cancelled remote job retains cancelled status when its task throws a default AbortError', async (t) => {
  const f = fixture(); t.after(() => f.service.close()); let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), run = f.options.runProjectTask!;
  f.options.runProjectTask = async (...args) => {
    if (!args[3].command.includes('fetch --atomic')) return run(...args);
    started(); await new Promise<void>(resolve => args[4].addEventListener('abort', () => resolve(), { once: true }));
    args[4].throwIfAborted(); return output();
  };
  const job = await f.service.run(id, { action: 'fetch', remote: 'origin' }); await ready;
  f.service.jobs.cancel(job.id!); await f.service.jobs.wait(job.key!);
  assert.equal(job.status, 'cancelled', job.error); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

test('a frozen private cleanup error keeps its original status/code and cause without leaking the message', async (t) => {
  const f = fixture(); t.after(() => f.service.close());
  const failure = Object.freeze(new AppError('private-git-token original domain unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
  f.options.runProjectTask = async () => { throw failure; };
  await assert.rejects(f.service.view(id), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, failure.code);
    assert.equal(error.cause, failure); assert.equal(error.message.includes('private-git-token'), false); return true;
  });
});
