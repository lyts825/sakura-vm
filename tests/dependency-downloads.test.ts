import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-dependency-auth-test-'));
process.env.SAKURA_DATA_DIR = root;
const { dependencyDownloadsSchema, resolveDependencyAuthentication, withDependencyAuthentication } =
  await import('../server/dependency-downloads.ts');
const { networkSchema, networkEnvironment } = await import('../server/network-profiles.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Machines } = await import('../server/machines.ts');
const { projectDependencyCacheScript } = await import('../server/project-dependency-cache.ts');
after(async () => {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
});

const config = {
  npm: { kind: 'bearer' as const, endpoint: 'https://packages.example.com/npm/', tokenSecret: 'npm-read' },
  pip: {
    kind: 'basic' as const,
    endpoint: 'https://packages.example.com/simple/',
    username: 'reader',
    passwordSecret: 'pip-read',
  },
};

test('download authentication accepts only named secrets and a fixed HTTPS or loopback endpoint', () => {
  assert.deepEqual(dependencyDownloadsSchema.parse(config), config);
  for (const endpoint of [
    'https://user:pass@example.com/',
    'https://example.com/?token=secret',
    'https://example.com/#secret',
    'http://example.com/',
    'https://example.com/%2fsecret',
    'https://example.com/%252e%252e/secret',
    'https://example.com/%01secret',
    'https://example.com/..;/secret',
    'file:///tmp/registry',
  ])
    assert.equal(
      dependencyDownloadsSchema.safeParse({ npm: { ...config.npm, endpoint } }).success,
      false,
      endpoint,
    );
  for (const invalid of [
    { npm: { ...config.npm, token: 'plaintext' } },
    { pip: { ...config.pip, password: 'plaintext' } },
    { npm: { ...config.npm, tokenSecret: '${PROJECT_SECRET}' } },
  ])
    assert.equal(dependencyDownloadsSchema.safeParse(invalid).success, false);
  assert.equal(
    dependencyDownloadsSchema.safeParse({ npm: { ...config.npm, endpoint: 'http://127.0.0.1:8080/npm/' } })
      .success,
    true,
  );
  const profile = networkSchema.parse({ dependencyDownloads: config });
  assert.deepEqual(networkEnvironment(profile), {
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
  });
});

test('prefetch resolves only its separately applied download credential, without project secret resolution', async () => {
  const machines = new Machines({} as any),
    id = randomUUID();
  machines.records.set(id, { id, template: 'none' } as any);
  const calls: string[] = [];
  let appliedAt: string | undefined = new Date().toISOString();
  const workspaces = new Workspaces(machines, {
    network: { state: async () => ({ config: { dependencyDownloads: config }, appliedAt }) } as any,
    secrets: {
      value: async (_id: string, name: string) => {
        calls.push(name);
        return 'owned-download-value';
      },
      resolve: async () => {
        throw new Error('must not resolve project secrets');
      },
    } as any,
  });
  try {
    const npm = await workspaces.dependencyDownloadAuthentication(id, 'npm');
    assert.equal(npm?.authorization, 'Bearer owned-download-value');
    const pip = await workspaces.dependencyDownloadAuthentication(id, 'pip');
    assert.equal(
      pip?.authorization,
      'Basic ' + Buffer.from('reader:owned-download-value').toString('base64'),
    );
    assert.deepEqual(calls, ['npm-read', 'pip-read']);
    appliedAt = undefined;
    assert.equal(await workspaces.dependencyDownloadAuthentication(id, 'npm'), undefined);
    assert.deepEqual(calls, ['npm-read', 'pip-read']);
    await assert.rejects(resolveDependencyAuthentication(id, config.npm), /私密配置插件/);
    await assert.rejects(
      resolveDependencyAuthentication(id, config.npm, {
        value: async () => 'token\r\nAuthorization: bad',
      } as any),
      /不支持的字符/,
    );
    const canonical = await resolveDependencyAuthentication(
      id,
      { ...config.npm, endpoint: 'https://PACKAGES.example.com:443/npm/' },
      { value: async () => 'owned-download-value' } as any,
    );
    assert.equal(canonical.endpoint, config.npm.endpoint);
    await assert.rejects(
      resolveDependencyAuthentication(id, config.pip, {
        value: async () => '多字节'.repeat(2048),
      } as any),
      /超过认证下载器支持的长度/,
    );
  } finally {
    await workspaces.close();
  }
});

test('credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation', async () => {
  const authentication = await resolveDependencyAuthentication('vm', config.npm, {
    value: async () => 'owned-value-never-command',
  } as any);
  for (const outcome of ['success', 'failure', 'cancel']) {
    const commands: string[] = [],
      files = new Map<string, string>();
    const abort = new AbortController(),
      instance = {};
    const machines = {
      live: new Map([['vm', instance]]),
      exec: async (_id: string, command: string) => {
        commands.push(command);
        return {
          code: 0,
          stdout: command.includes('mktemp') ? '/run/sakura-dependency-auth.abcdef123456\n' : '',
          stderr: '',
        };
      },
      sftp: async (_id: string, work: Function) =>
        work({
          createWriteStream: (path: string, options: any) => {
            assert.deepEqual(options, { flags: 'wx', mode: 0o600 });
            return new Writable({
              write(chunk, _encoding, next) {
                files.set(path, (files.get(path) || '') + chunk);
                next();
              },
            });
          },
        }),
    } as any;
    const pending = withDependencyAuthentication(
      machines,
      'vm',
      authentication,
      abort.signal,
      async (paths) => {
        assert.equal(
          JSON.parse(files.get(paths.credentialFile)!).authorization,
          authentication.authorization,
        );
        const script = projectDependencyCacheScript(
          '/workspace/project',
          'default',
          'npm',
          'prefetch-dependencies',
          {},
          paths,
        );
        assert.ok(!script.includes('owned-value-never-command'));
        assert.match(script, /python3 -I .*broker\.py/);
        if (outcome === 'failure') throw new Error('owned failure');
        if (outcome === 'cancel') {
          abort.abort();
          abort.signal.throwIfAborted();
        }
        return 'done';
      },
    );
    if (outcome === 'success') assert.equal(await pending, 'done');
    else await assert.rejects(pending);
    assert.match(commands.at(-1)!, /rmdir --/);
    assert.ok(commands.every((command) => !command.includes('owned-value-never-command')));
  }
  assert.throws(
    () =>
      projectDependencyCacheScript(
        '/workspace',
        'default',
        'npm',
        'prefetch-dependencies',
        {},
        { credentialFile: '/tmp/arbitrary', brokerFile: '/tmp/owned.py' },
      ),
    /临时路径/,
  );
});

test('real Python mirror enforces origin, redirect, metadata and non-reflection constraints', () => {
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(
    python,
    ['-I', '-B', 'tests/dependency-download-broker.test.py', resolve('server/dependency-download-broker.py')],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, SAKURA_BROKER_TEST_ROOT: root },
    },
  );
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 10 tests/);
});

test('lost preparation receipts and transient cleanup failures retain exact ownership', async () => {
  const authentication = await resolveDependencyAuthentication('vm', config.npm, {
    value: async () => 'owned-download-value',
  } as any);
  for (const fault of ['lost-mkdir', 'transient-cleanup', 'persistent-cleanup', 'new-boot']) {
    const commands: string[] = [];
    const instance = {},
      live = new Map<string, object>([['vm', instance]]);
    let cleanupAttempts = 0,
      writes = 0;
    const abort = new AbortController();
    const machines = {
      live,
      exec: async (_id: string, command: string) => {
        commands.push(command);
        if (commands.length === 1) {
          assert.match(command, /mkdir -m 700 -- '\/run\/sakura-dependency-auth\.[a-f0-9]{32}'/);
          if (fault === 'lost-mkdir') {
            abort.abort();
            throw abort.signal.reason;
          }
        } else {
          cleanupAttempts++;
          if (fault === 'persistent-cleanup' || (fault === 'transient-cleanup' && cleanupAttempts === 1))
            throw new Error('owned control connection failed');
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      sftp: async (_id: string, work: Function) =>
        work({
          createWriteStream: () =>
            new Writable({
              write(_chunk, _encoding, next) {
                writes++;
                next();
              },
            }),
        }),
    } as any;
    const pending = withDependencyAuthentication(machines, 'vm', authentication, abort.signal, async () => {
      if (fault === 'new-boot') live.set('vm', {});
      return 'done';
    });
    if (fault === 'lost-mkdir') {
      await assert.rejects(pending, /abort/i);
      assert.equal(writes, 0);
      assert.equal(cleanupAttempts, 1);
      assert.ok(!commands.at(-1)!.includes('rm -f'));
    } else if (fault === 'persistent-cleanup') {
      await assert.rejects(pending, /临时目录未能清理/);
      assert.equal(cleanupAttempts, 3);
    } else {
      assert.equal(await pending, 'done');
      assert.equal(cleanupAttempts, fault === 'new-boot' ? 0 : 2);
    }
    const path = commands[0].match(/\/run\/sakura-dependency-auth\.[a-f0-9]{32}/)![0];
    assert.ok(commands.every((command) => command.includes(path)));
  }
});
