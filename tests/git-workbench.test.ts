import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import type { PluginContext } from '../server/plugin-api.ts';
import type { Engine } from '../server/runtime.ts';
import { isGitConflict } from '../shared/git.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-git-test-'));
process.env.SAKURA_DATA_DIR = root;
const { GitWorkbench, gitActionSchema, parseStatus, redactGitOutput } =
  await import('../server/git-workbench.ts');
const { Machines } = await import('../server/machines.ts');
const { ProjectCatalog } = await import('../server/project-catalog.ts');
const { Jobs } = await import('../server/jobs.ts');
const { route: gitRoute } = await import('../plugins/git/server.ts');
const { route: taskRoute } = await import('../server/plugins/tasks.ts');
const execFile = promisify(execFileCallback);
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};
const gitOptions = [
  '-c',
  'user.name=Git regression',
  '-c',
  'user.email=git@example.test',
  '-c',
  'core.autocrlf=false',
];
const shell =
  process.platform === 'win32'
    ? join(
        dirname(dirname((await execFile('where.exe', ['git'])).stdout.trim().split(/\r?\n/)[0])),
        'bin',
        'bash.exe',
      )
    : '/bin/sh';
const id = '11111111-1111-4111-8111-111111111111';
const projectId = '0123456789abcdef';
const posix = (path: string) => path.replaceAll('\\', '/');

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(root.includes('sakura-git-test-'));
  await rm(root, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]) {
  return (await execFile('git', [...gitOptions, ...args], { cwd, env })).stdout.trim();
}
async function commit(cwd: string, name: string, text: string) {
  await writeFile(join(cwd, name), text);
  await git(cwd, 'add', '--', name);
  await git(cwd, 'commit', '-m', text);
  return git(cwd, 'rev-parse', 'HEAD');
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(root, 'repo-'));
  const bare = join(directory, 'remote.git'),
    local = join(directory, 'local'),
    peer = join(directory, 'peer');
  await git(directory, 'init', '--bare', '--initial-branch=main', bare);
  await git(directory, 'clone', bare, local);
  await git(local, 'config', 'user.name', 'Git regression');
  await git(local, 'config', 'user.email', 'git@example.test');
  await commit(local, 'shared.txt', 'base\n');
  await git(local, 'push', '-u', 'origin', 'main');
  await git(directory, 'clone', bare, peer);
  await git(local, 'remote', 'set-url', 'origin', 'https://example.test/repository.git');
  const commands: { command: string; timeout?: number; signal?: AbortSignal }[] = [];
  const machines = new Machines({} as Engine);
  machines.get = () => ({ id }) as ReturnType<MachinesType['get']>;
  machines.state = () => 'running';
  let projectDirectory = local;
  let beforeNetwork: ((command: string, signal?: AbortSignal) => Promise<void>) | undefined;
  let afterNetwork: (() => Promise<void>) | undefined;
  machines.exec = async (_id, command, timeout, signal) => {
    commands.push({ command, timeout, signal });
    const network = command.includes('GIT_ALLOW_PROTOCOL=https');
    if (network) {
      await beforeNetwork?.(command, signal);
      signal?.throwIfAborted();
      // Substitute only transport in the guest adapter. The workbench still validates
      // real configured HTTPS URLs; real Git executes every ref and worktree operation.
      command = command
        .replace('GIT_ALLOW_PROTOCOL=https', 'GIT_ALLOW_PROTOCOL=file')
        .replace(
          '-c protocol.https.allow=always',
          `-c protocol.file.allow=always -c 'url.${posix(bare)}.insteadOf=https://example.test/repository.git'`,
        );
    }
    try {
      const { stdout, stderr } = await execFile(shell, ['-c', command], {
        env,
        signal,
        timeout,
        maxBuffer: 1024 * 1024,
      });
      if (network) await afterNetwork?.();
      return { stdout, stderr, code: 0 };
    } catch (error) {
      if (signal?.aborted) throw error;
      const result = error as Error & { stdout: string; stderr: string; code: number };
      if (typeof result.code !== 'number') throw error;
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    }
  };
  const projects = new ProjectCatalog(machines);
  const workspaces = {
    projects,
    config: async () => ({ directory: posix(projectDirectory) }),
  } as unknown as Workspaces;
  const service = new GitWorkbench(machines, workspaces);
  service.jobs = new Jobs('git', join(directory, 'jobs'));
  t.after(() => service.close());
  const scope = <T>(action: () => T) => projects.inScope(id, projectId, action);
  const start = (value: unknown) => scope(() => service.run(id, value));
  const run = async (value: unknown) => {
    const job = await start(value);
    await service.jobs.wait(job.key!);
    return job;
  };
  const host = {
    machines,
    git: service,
    jobStores: () => [service.jobs],
    retryHandler: () => undefined,
  } as unknown as PluginContext;
  return {
    directory,
    bare,
    local,
    peer,
    commands,
    service,
    scope,
    start,
    run,
    host,
    setDirectory: (path: string) => {
      projectDirectory = path;
    },
    beforeNetwork: (fn: typeof beforeNetwork) => {
      beforeNetwork = fn;
    },
    afterNetwork: (fn: typeof afterNetwork) => {
      afterNetwork = fn;
    },
  };
}

test('remote inputs reject refspecs, revisions, flags, shell syntax and credential URLs', () => {
  for (const action of ['fetch', 'pull', 'push']) {
    for (const branch of [
      '--force',
      'HEAD',
      'HEAD~1',
      'main:other',
      '+main',
      'main..other',
      'a/.hidden',
      'a.lock',
      'a//b',
      'main;id',
      '$(id)',
    ])
      assert.equal(gitActionSchema.safeParse({ action, branch }).success, false, `${action}: ${branch}`);
    for (const remote of ['--all', 'https://example.test/repo', 'origin;id', 'origin..bad'])
      assert.equal(gitActionSchema.safeParse({ action, remote }).success, false);
    assert.equal(gitActionSchema.safeParse({ action, force: true }).success, false);
  }
  for (const url of [
    'not a URL',
    'file:///tmp/repo',
    'ssh://git@example.test/repo',
    'https://user:secret@example.test/repo',
    'https://example.test/repo?token=secret',
  ])
    assert.equal(gitActionSchema.safeParse({ action: 'remote-add', name: 'origin', url }).success, false);
  for (const pair of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
    assert.ok(isGitConflict(parseStatus(`${pair} conflict name.txt\0`)[0]));
  assert.equal(isGitConflict(parseStatus(' M ordinary.txt\0')[0]), false);
});

test('fetch changes only remote tracking refs despite dangerous repository defaults', async (t) => {
  const f = await fixture(t);
  const head = await git(f.local, 'rev-parse', 'HEAD');
  const next = await commit(f.peer, 'shared.txt', 'remote update\n');
  await git(f.peer, 'push');
  await writeFile(join(f.local, 'shared.txt'), 'my uncommitted work\n');
  await git(f.local, 'branch', 'keep-local');
  await git(f.local, 'tag', 'keep-tag');
  await git(f.local, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*');
  await git(f.local, 'config', 'fetch.prune', 'true');
  await git(f.local, 'config', 'fetch.pruneTags', 'true');
  const job = await f.run({ action: 'fetch' });
  assert.equal(job.status, 'done', job.error);
  assert.equal(await git(f.local, 'rev-parse', 'refs/remotes/origin/main'), next);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
  assert.equal(await git(f.local, 'rev-parse', 'keep-local'), head);
  assert.equal(await git(f.local, 'rev-parse', 'keep-tag'), head);
  assert.equal(await readFile(join(f.local, 'shared.txt'), 'utf8'), 'my uncommitted work\n');
  assert.equal(job.projectId, projectId);
  assert.equal(job.vmId, id);
  assert.equal(job.key, `${id}:${projectId}`);
  const network = f.commands.find((value) => value.command.includes('GIT_ALLOW_PROTOCOL=https'))!;
  assert.equal(network.timeout, 120000);
  assert.match(network.command, /GIT_TERMINAL_PROMPT=0.*GIT_ASKPASS=\/bin\/false/);
  assert.match(network.command, /--refmap= .*\+refs\/heads\/\*:refs\/remotes\/origin\/\*/);
});

test('pull honors the differently named upstream and fast-forwards without configured rebase or squash', async (t) => {
  const f = await fixture(t);
  await git(f.local, 'branch', '-m', 'local-topic');
  await git(f.local, 'config', 'pull.rebase', 'true');
  await git(f.local, 'config', 'merge.autoStash', 'true');
  await git(f.local, 'config', 'branch.local-topic.mergeOptions', '--squash');
  const next = await commit(f.peer, 'shared.txt', 'remote update\n');
  await git(f.peer, 'push');
  const job = await f.run({ action: 'pull' });
  assert.equal(job.status, 'done', job.error);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), next);
  assert.equal(await git(f.local, 'branch', '--show-current'), 'local-topic');
  const view = await f.scope(() => f.service.view(id));
  assert.deepEqual(view.upstream, { name: 'origin/main', remote: 'origin', branch: 'main' });
  assert.deepEqual(view.divergence, [0, 0]);
  assert.deepEqual(view.changes, []);
  assert.equal(view.operation, null);
});

test('dirty pulls preserve staged, unstaged and untracked work without fetching or autostashing', async (t) => {
  const f = await fixture(t);
  const head = await git(f.local, 'rev-parse', 'HEAD');
  await git(f.local, 'config', 'merge.autoStash', 'true');
  for (const kind of ['unstaged', 'staged', 'untracked']) {
    const name = kind === 'untracked' ? 'new.txt' : 'shared.txt';
    await writeFile(join(f.local, name), kind);
    if (kind === 'staged') await git(f.local, 'add', name);
    const before = await git(f.local, 'status', '--porcelain=v1');
    const job = await f.run({ action: 'pull' });
    assert.equal(job.errorCode, 'git_dirty_worktree');
    assert.equal(await git(f.local, 'status', '--porcelain=v1'), before);
    assert.equal(await readFile(join(f.local, name), 'utf8'), kind);
    assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
    await git(f.local, 'reset', '--hard', head);
  }
  assert.ok(!f.commands.some((value) => value.command.includes('GIT_ALLOW_PROTOCOL=https')));
  assert.equal(await git(f.local, 'stash', 'list'), '');
});

test('diverged pull and non-fast-forward push report explicit failures and preserve both histories', async (t) => {
  const f = await fixture(t);
  const localHead = await commit(f.local, 'local.txt', 'local commit\n');
  const remoteHead = await commit(f.peer, 'remote.txt', 'remote commit\n');
  await git(f.peer, 'push');
  const pull = await f.run({ action: 'pull', remote: 'origin', branch: 'main' });
  assert.equal(pull.status, 'error');
  assert.equal(pull.errorCode, 'git_diverged');
  assert.match(pull.error!, /分叉.*快进/);
  const push = await f.run({ action: 'push', remote: 'origin', branch: 'main' });
  assert.equal(push.errorCode, 'git_push_rejected', push.error);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), localHead);
  assert.equal(await git(f.bare, 'rev-parse', 'main'), remoteHead);
  assert.equal(await git(f.local, 'status', '--porcelain=v1'), '');
  assert.deepEqual((await f.scope(() => f.service.view(id))).divergence, [1, 1]);
  await assert.rejects(stat(join(f.local, '.git', 'MERGE_HEAD')), { code: 'ENOENT' });
  await f.service.jobs.flush();
  const restored = new Jobs('git', join(f.directory, 'jobs'));
  assert.equal(restored.get(push.id!)?.errorCode, 'git_push_rejected');
  await restored.close();
});

test('push sends only the current commit to the chosen branch despite mirror, push refspec and tag defaults', async (t) => {
  const f = await fixture(t);
  const oldHead = await git(f.bare, 'rev-parse', 'main');
  const head = await commit(f.local, 'local.txt', 'current commit\n');
  await git(f.local, 'branch', 'unrelated');
  await git(f.local, 'tag', '-a', 'private-tag', '-m', 'tag');
  await git(f.local, 'config', 'remote.origin.mirror', 'true');
  await git(f.local, 'config', 'remote.origin.push', '+refs/heads/*:refs/heads/*');
  await git(f.local, 'config', 'push.followTags', 'true');
  const job = await f.run({ action: 'push', branch: 'review/topic' });
  assert.equal(job.status, 'done', job.error);
  assert.equal(await git(f.bare, 'rev-parse', 'review/topic'), head);
  assert.equal(await git(f.bare, 'rev-parse', 'main'), oldHead);
  assert.equal(
    await git(f.bare, 'for-each-ref', '--format=%(refname)', 'refs/heads'),
    'refs/heads/main\nrefs/heads/review/topic',
  );
  assert.equal(await git(f.bare, 'tag'), '');
});

test('file conflicts and resolved-but-unfinished merges block pull, push and conflicted commits', async (t) => {
  const f = await fixture(t);
  await git(f.local, 'switch', '-c', 'other');
  await commit(f.local, 'shared.txt', 'other\n');
  await git(f.local, 'switch', 'main');
  await commit(f.local, 'shared.txt', 'main\n');
  const merge = await f.run({ action: 'merge', branch: 'other', ffOnly: false });
  assert.equal(merge.errorCode, 'git_conflict', merge.error);
  const view = await f.scope(() => f.service.view(id));
  assert.deepEqual(view.conflicts, ['shared.txt']);
  assert.equal(view.operation, 'MERGE_HEAD');
  const conflicted = await readFile(join(f.local, 'shared.txt'), 'utf8');
  for (const action of ['pull', 'push']) assert.equal((await f.run({ action })).errorCode, 'git_conflict');
  assert.equal((await f.run({ action: 'commit', message: 'must not commit' })).errorCode, 'git_conflict');
  assert.equal(await readFile(join(f.local, 'shared.txt'), 'utf8'), conflicted);
  await writeFile(join(f.local, 'shared.txt'), 'resolved\n');
  assert.equal((await f.run({ action: 'stage', paths: ['shared.txt'] })).status, 'done');
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_operation_in_progress');
  assert.equal((await f.scope(() => f.service.view(id))).conflicts?.length, 0);
});

test('detached, unborn and rebasing worktrees require explicit recovery before pull or push', async (t) => {
  const f = await fixture(t);
  await git(f.local, 'checkout', '--detach');
  for (const action of ['pull', 'push'])
    assert.equal((await f.run({ action })).errorCode, 'git_detached_head');
  assert.equal((await f.run({ action: 'fetch' })).status, 'done');
  await git(f.local, 'switch', 'main');
  const linked = join(f.directory, 'linked');
  await git(f.local, 'worktree', 'add', '-b', 'linked', linked);
  f.setDirectory(linked);
  const rebasePath = await git(linked, 'rev-parse', '--git-path', 'rebase-merge');
  await mkdir(resolve(linked, rebasePath), { recursive: true });
  assert.equal((await f.run({ action: 'push' })).errorCode, 'git_operation_in_progress');
  assert.equal((await f.scope(() => f.service.view(id))).operation, 'rebase-merge');
  const empty = join(f.directory, 'empty');
  await git(f.directory, 'init', '--initial-branch=main', empty);
  f.setDirectory(empty);
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_unborn_branch');
  const view = await f.scope(() => f.service.view(id));
  assert.equal(view.hasCommits, false);
  assert.deepEqual(view.divergence, []);
});

test('unknown remotes, missing branches, rewritten URLs and unsafe push URLs fail without exposing credentials', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run({ action: 'fetch', remote: 'missing' })).errorCode, 'git_remote_missing');
  assert.equal((await f.run({ action: 'pull', branch: 'missing' })).errorCode, 'git_remote_branch_missing');
  await git(f.local, 'config', 'url.file:///tmp/unsafe.insteadOf', 'https://example.test/');
  assert.equal((await f.run({ action: 'fetch' })).errorCode, 'git_unsafe_remote');
  await git(f.local, 'config', '--remove-section', 'url.file:///tmp/unsafe');
  await git(
    f.local,
    'config',
    'remote.origin.pushurl',
    'https://user:private-token@example.test/repo?token=other-secret',
  );
  assert.equal((await f.run({ action: 'push' })).errorCode, 'git_unsafe_remote');
  const view = await f.scope(() => f.service.view(id));
  assert.doesNotMatch(JSON.stringify(view), /private-token|other-secret/);
  assert.equal(
    redactGitOutput('fatal: https://user:secret@example.test/repo?token=secret'),
    'fatal: https://example.test/repo',
  );
  await git(f.local, 'config', 'remote.origin.pushurl', 'https://example.test/repo');
  await git(f.local, 'config', '--add', 'remote.origin.pushurl', 'https://example.test/other');
  assert.equal((await f.run({ action: 'push' })).errorCode, 'git_ambiguous_remote');
});

test('pull rechecks local edits and branch changes made while fetch is running', async (t) => {
  const f = await fixture(t);
  const head = await git(f.local, 'rev-parse', 'HEAD');
  await commit(f.peer, 'shared.txt', 'remote update\n');
  await git(f.peer, 'push');
  f.afterNetwork(async () => {
    await writeFile(join(f.local, 'new.txt'), 'during fetch');
  });
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_dirty_worktree');
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
  await rm(join(f.local, 'new.txt'));
  f.afterNetwork(async () => {
    await git(f.local, 'switch', '-c', 'another');
  });
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_branch_changed');
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
});

test('pull preserves ignored files and stays in the accepted project directory after configuration changes', async (t) => {
  const f = await fixture(t);
  const head = await git(f.local, 'rev-parse', 'HEAD');
  await writeFile(join(f.local, '.git', 'info', 'exclude'), 'ignored.txt\n');
  await writeFile(join(f.local, 'ignored.txt'), 'private local work');
  const next = await commit(f.peer, 'ignored.txt', 'remote tracked content');
  await git(f.peer, 'push');
  assert.equal((await f.run({ action: 'pull' })).errorCode, 'git_pull_blocked');
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), head);
  assert.equal(await readFile(join(f.local, 'ignored.txt'), 'utf8'), 'private local work');
  await rm(join(f.local, 'ignored.txt'));
  f.commands.length = 0;
  f.afterNetwork(async () => {
    f.setDirectory(f.peer);
  });
  const pulled = await f.run({ action: 'pull' });
  assert.equal(pulled.status, 'done', pulled.error);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), next);
  assert.ok(f.commands.every((value) => value.command.startsWith(`cd '${posix(f.local)}'`)));
});

test('network and authentication errors are durable, redacted and never automatically retried', async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  f.beforeNetwork(async () => {
    attempts++;
    throw new Error(
      'Authentication failed for https://user:private-token@example.test/repo?token=other-secret',
    );
  });
  const job = await f.run({ action: 'fetch' });
  assert.equal(job.status, 'error');
  assert.match(job.error!, /Authentication failed/);
  assert.doesNotMatch(JSON.stringify(job), /private-token|other-secret/);
  assert.equal(attempts, 1);
  const res = {
    payload: {} as any,
    writeHead() {},
    end(value: string) {
      this.payload = JSON.parse(value);
    },
  };
  await taskRoute.call(
    f.host,
    { method: 'GET' } as IncomingMessage,
    res as unknown as ServerResponse,
    new URL('http://localhost/api/events'),
    async () => ({}),
    new AbortController().signal,
  );
  assert.equal(res.payload.events[0].id, job.id);
  assert.match(res.payload.events[0].message, /Authentication failed/);
});

test('accepted Git jobs serialize per project, keep their directory, and cancel through the task endpoint', async (t) => {
  const f = await fixture(t);
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.beforeNetwork(async (_command, signal) => {
    entered();
    await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }));
  });
  const response = () => ({
    status: 0,
    payload: {} as any,
    writeHead(status: number) {
      this.status = status;
    },
    end(value: string) {
      this.payload = JSON.parse(value);
    },
  });
  const req = { method: 'POST' } as IncomingMessage,
    res = response();
  const requestAbort = new AbortController();
  assert.equal(
    await f.scope(() =>
      gitRoute.call(
        f.host,
        req,
        res as unknown as ServerResponse,
        new URL(`http://localhost/api/vms/${id}/git?project=${projectId}`),
        async () => ({ action: 'pull' }),
        requestAbort.signal,
      ),
    ),
    true,
  );
  assert.equal(res.status, 202);
  assert.equal(res.payload.projectId, projectId);
  await ready;
  requestAbort.abort(); // Closing the submitting HTTP request does not cancel an accepted background job.
  await assert.rejects(f.start({ action: 'push' }), (error: any) => error.status === 409);
  f.setDirectory(f.peer);
  const job = f.service.jobs.get(res.payload.id)!;
  const cancelled = response();
  await taskRoute.call(
    f.host,
    req,
    cancelled as unknown as ServerResponse,
    new URL(`http://localhost/api/jobs/${job.id}/cancel`),
    async () => ({}),
    new AbortController().signal,
  );
  await f.service.jobs.wait(job.key!);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.errorCode, undefined);
  assert.equal(await git(f.local, 'rev-parse', 'HEAD'), await git(f.peer, 'rev-parse', 'HEAD'));
  assert.ok(f.commands.every((value) => value.command.startsWith(`cd '${posix(f.local)}'`)));
  assert.ok(!f.commands.some((value) => value.command.includes(' merge --ff-only')));
  assert.equal(
    f.commands.find((value) => value.command.includes('GIT_ALLOW_PROTOCOL=https'))!.signal?.aborted,
    true,
  );
});
