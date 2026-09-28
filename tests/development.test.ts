import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Bundles as BundlesType } from '../server/bundles';
import type { Machines as MachinesType } from '../server/machines';
import type { Workspaces as WorkspacesType } from '../server/workspaces';
import type { Engine } from '../server/runtime';

const root = await mkdtemp(join(tmpdir(), 'sakura-development-test-'));
process.env.SAKURA_DATA_DIR = root;
const { encryptFile, decryptFile, importEncrypted } = await import('../server/encrypted-backups.ts');
const { Secrets, privateLog, dpapi } = await import('../server/secrets.ts');
const { networkSchema, networkEnvironment, rewriteMirrors, NetworkProfiles } =
  await import('../server/network-profiles.ts');
const { presetSchema, presetScript, CommandPresets } = await import('../server/command-presets.ts');
const { gitActionSchema, parseStatus, repositoryPath } = await import('../server/git-workbench.ts');
const { containerActionSchema, Containers } = await import('../server/containers.ts');
const { verifyDevcontainerTemplateMetadata } = await import('../server/devcontainer-templates.ts');
const { Machines } = await import('../server/machines.ts');
const { DataMigration } = await import('../server/data-migration.ts');
const { dataDirectory } = await import('../server/data-directory.ts');
const { ServiceHealth } = await import('../server/service-health.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { Jobs } = await import('../server/jobs.ts');
const { Backups } = await import('../server/backups.ts');
const { Ide, sshPath } = await import('../server/ide.ts');
const { restoreDrafts, saveDraftResult, anyDirty } = await import('../src/editor-drafts.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(root, /sakura-development-test-/);
  await rm(root, { recursive: true, force: true });
});

test('encrypted backups round-trip bytes and reject a wrong password, altered header, payload and truncation', async () => {
  const source = join(root, 'plain'),
    encrypted = join(root, 'encrypted'),
    restored = join(root, 'restored');
  const bytes = Buffer.concat([Buffer.from('樱花\0private\n'), Buffer.alloc(256 * 1024, 47)]);
  await writeFile(source, bytes);
  await encryptFile(source, encrypted, 'long-password-樱花');
  assert.ok(!(await readFile(encrypted)).includes(Buffer.from('private')));
  await decryptFile(encrypted, restored, 'long-password-樱花');
  assert.deepEqual(await readFile(restored), bytes);
  const damaged = join(root, 'damaged'),
    destination = join(root, 'partial');
  await assert.rejects(decryptFile(encrypted, destination, 'incorrect-password'), /密码错误/);
  await assert.rejects(stat(destination), { code: 'ENOENT' });
  for (const position of [12, 32, 65]) {
    const value = await readFile(encrypted);
    value[position] ^= 1;
    await writeFile(damaged, value);
    await assert.rejects(decryptFile(damaged, destination, 'long-password-樱花'), /密码错误/);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
  }
  await writeFile(damaged, (await readFile(encrypted)).subarray(0, 35));
  await assert.rejects(decryptFile(damaged, destination, 'long-password-樱花'), /大小无效/);
  await assert.rejects(decryptFile(encrypted, restored, 'long-password-樱花'), { code: 'EEXIST' });
  assert.deepEqual(await readFile(restored), bytes);
});
test('cancelled encryption and decryption never overwrite an existing destination', async () => {
  const source = join(root, 'cancel-source'),
    encrypted = join(root, 'cancel-encrypted'),
    destination = join(root, 'cancel-plain');
  await writeFile(source, 'important content');
  await encryptFile(source, encrypted, 'cancel-password');
  await writeFile(destination, 'keep me');
  await assert.rejects(decryptFile(encrypted, destination, 'cancel-password', AbortSignal.abort()));
  assert.equal(await readFile(destination, 'utf8'), 'keep me');
  const cancelled = join(root, 'cancelled-new');
  await assert.rejects(decryptFile(encrypted, cancelled, 'cancel-password', AbortSignal.abort()));
  await assert.rejects(stat(cancelled), { code: 'ENOENT' });
  await assert.rejects(encryptFile(source, encrypted, 'cancel-password'), { code: 'EEXIST' });
});

test('encrypted backup jobs never retry as plaintext and wrong passwords do not import any data', async () => {
  const id = randomUUID(),
    machines = new Machines({} as Engine);
  machines.get = () => ({ id, name: 'encrypted-test' }) as ReturnType<MachinesType['get']>;
  const data = Buffer.from('fake disk content'),
    manifest = Buffer.from(JSON.stringify({ sha256: createHash('sha256').update(data).digest('hex') })),
    length = Buffer.alloc(4);
  length.writeUInt32BE(manifest.length);
  const bundle = Buffer.concat([Buffer.from('SAKURA01'), length, manifest, data]);
  let imported = false;
  const bundles = {
    export: async (_id: string, output: NodeJS.WritableStream) => {
      await pipeline(Readable.from([bundle]), output);
    },
    import: async () => {
      imported = true;
      return { name: 'restored' };
    },
  } as unknown as BundlesType;
  const backups = new Backups(machines, bundles);
  try {
    await backups.policy(id, { directory: join(root, 'external-backups') });
    const job = await backups.run(id, 'backup-password-123');
    await backups.jobs.wait(id);
    assert.equal(job.status, 'done', job.error);
    assert.equal(job.action, undefined);
    const item = (await backups.view(id)).items[0];
    assert.equal(item.encrypted, true);
    const download = await backups.downloadable(id, item.id);
    assert.equal(download.type, 'file');
    assert.match(download.path, /external-backups/);
    await backups.operate(id, item.id, 'restore', 'restored', 'wrong-password');
    await backups.jobs.wait(id);
    assert.equal(backups.jobs.view(id)?.status, 'error');
    assert.equal(imported, false);
    await backups.operate(id, item.id, 'restore', 'restored', 'backup-password-123');
    await backups.jobs.wait(id);
    assert.equal(backups.jobs.view(id)?.status, 'done', backups.jobs.view(id)?.error);
    assert.equal(imported, true);
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith('.decrypt-')),
      false,
    );
  } finally {
    await backups.close();
  }
});
test('encrypted uploads are authenticated before import and temporary uploads are cleaned on failure', async () => {
  const source = join(root, 'upload-plain'),
    file = join(root, 'upload-encrypted');
  await writeFile(source, 'test bundle');
  await encryptFile(source, file, 'upload-password');
  const bytes = await readFile(file);
  let imports = 0;
  const bundles = {
    importExternal: async (_name: string, stream: Readable) => {
      imports++;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString(), 'test bundle');
      return { id: 'restored' };
    },
  } as unknown as BundlesType;
  await assert.rejects(
    importEncrypted(
      bundles,
      'restored',
      Readable.from([bytes]),
      'wrong-password',
      new AbortController().signal,
    ),
    /密码错误/,
  );
  assert.equal(imports, 0);
  assert.equal(
    (
      await importEncrypted(
        bundles,
        'restored',
        Readable.from([bytes]),
        'upload-password',
        new AbortController().signal,
      )
    ).id,
    'restored',
  );
  assert.equal(imports, 1);
  assert.equal(
    (await readdir(root)).some((name) => /^\.(encrypted-import|decrypt)-/.test(name)),
    false,
  );
});

test('private values are stored encrypted, listed as metadata and redacted across every chunk boundary', async () => {
  const id = randomUUID(),
    locks = new Machines({} as Engine);
  locks.get = () => ({ id }) as ReturnType<MachinesType['get']>;
  const secrets = new Secrets(
    locks,
    async (kind, value) =>
      kind === 'protect'
        ? Buffer.from(value).reverse().toString('base64')
        : Buffer.from(value, 'base64').reverse().toString(),
    join(root, 'private'),
  );
  await secrets.save(id, { name: 'api-token', value: 'hidden-value-123' });
  assert.equal(await secrets.value(id, 'api-token'), 'hidden-value-123');
  assert.deepEqual(Object.keys((await secrets.list(id))[0]).sort(), ['name', 'updatedAt']);
  assert.ok(!(await readFile(join(root, 'private', id + '.json'), 'utf8')).includes('hidden-value-123'));
  assert.deepEqual(await secrets.resolve(id, { TOKEN: 'api-token' }), { TOKEN: 'hidden-value-123' });
  const text = 'before hidden-value-123 middle hidden-value-123 after';
  for (let i = 0; i <= text.length; i++) {
    let log = '';
    const stream = privateLog(
      (chunk) => {
        log += chunk;
      },
      ['hidden-value-123'],
    );
    stream.write(text.slice(0, i));
    stream.write(text.slice(i));
    stream.flush();
    assert.equal(log, 'before [私密配置已隐藏] middle [私密配置已隐藏] after');
  }
  await secrets.remove(id, 'api-token');
  await assert.rejects(secrets.value(id, 'api-token'), /缺少私密配置/);
});
test(
  'Windows DPAPI can protect and recover a Unicode value without persisting plaintext',
  { skip: process.platform !== 'win32' },
  async () => {
    const value = Buffer.from('test-only-樱花-credential').toString('base64');
    const encrypted = await dpapi('protect', value);
    assert.notEqual(encrypted, value);
    assert.equal(await dpapi('unprotect', encrypted), value);
  },
);
test('network previews reject credentials and preserve signing keys, comments and third-party repositories', () => {
  assert.throws(() => networkSchema.parse({ httpProxy: 'http://user:password@example.com' }));
  assert.throws(() => networkSchema.parse({ pipIndex: 'https://example.com?token=x' }));
  const config = networkSchema.parse({
    npmRegistry: 'https://registry.example.com',
    httpProxy: 'http://127.0.0.1:7890',
    aptMirror: 'https://mirror.example.com/debian',
    aptSecurityMirror: 'https://mirror.example.com/debian-security',
    apkMirror: 'https://mirror.example.com/alpine',
  });
  const text =
    '# deb http://deb.debian.org/debian bookworm main\ndeb http://deb.debian.org/debian bookworm main\ndeb https://security.debian.org/debian-security bookworm-security main\nURIs: https://deb.debian.org/debian\nSigned-By: https://deb.debian.org/key.gpg\ndeb https://download.docker.com/linux/debian bookworm stable';
  const result = rewriteMirrors(text, 'debian', config);
  assert.match(result, /^# deb http:\/\/deb.debian.org/);
  assert.match(result, /deb https:\/\/mirror.example.com\/debian bookworm main/);
  assert.match(result, /URIs: https:\/\/mirror.example.com\/debian/);
  assert.match(result, /Signed-By: https:\/\/deb.debian.org\/key.gpg/);
  assert.match(result, /https:\/\/download.docker.com\/linux\/debian/);
  assert.equal(
    rewriteMirrors('https://dl-cdn.alpinelinux.org/alpine/v3.23/main', 'alpine', config),
    'https://mirror.example.com/alpine/v3.23/main',
  );
  assert.equal(networkEnvironment(config).NPM_CONFIG_REGISTRY, config.npmRegistry);
  assert.equal(networkEnvironment(config).http_proxy, config.httpProxy);
});
test('Git status handles renamed and untracked paths and rejects traversal or command injection', () => {
  assert.deepEqual(parseStatus('R  new name.ts\0old name.ts\0?? 新文件.txt\0 M src/index.ts\0'), [
    { index: 'R', worktree: ' ', path: 'new name.ts', previous: 'old name.ts' },
    { index: '?', worktree: '?', path: '新文件.txt' },
    { index: ' ', worktree: 'M', path: 'src/index.ts' },
  ]);
  for (const path of ['../outside', 'a/../../b', '/root/file', 'a\0b'])
    assert.equal(repositoryPath.safeParse(path).success, false);
  for (const branch of ['--force', 'main;whoami', '$(whoami)'])
    assert.equal(gitActionSchema.safeParse({ action: 'switch', branch }).success, false);
});
test('command parameters are quoted as data and stored presets preserve their identity', async () => {
  const preset = {
    ...presetSchema.parse({
      name: 'Test',
      command: 'printf "%s" "$TARGET"',
      parameters: [{ name: 'TARGET', value: 'all' }],
    }),
    id: randomUUID(),
  };
  assert.match(
    presetScript(preset, { TARGET: "x'; touch /tmp/should-not-run; '" }),
    /export TARGET='x'\\'';/,
  );
  assert.throws(() => presetScript(preset, { UNDECLARED: 'no' }), /未声明/);
  assert.equal(
    presetSchema.safeParse({
      ...preset,
      parameters: [
        { name: 'X', value: '' },
        { name: 'X', value: 'two' },
      ],
    }).success,
    false,
  );
  const id = randomUUID(),
    locks = new Machines({} as Engine);
  locks.get = () => ({ id }) as ReturnType<MachinesType['get']>;
  const commands = new CommandPresets(locks, {} as WorkspacesType);
  try {
    await commands.save(id, preset);
    await commands.save(id, { ...preset, name: 'Updated' });
    const list = await commands.list(id);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Updated');
    await commands.remove(id, preset.id);
    assert.equal((await commands.list(id)).length, 0);
  } finally {
    await commands.close();
  }
});
test('container actions reject unsafe identifiers, flags and parent Compose paths', async () => {
  for (const input of [
    { action: 'stop', id: '--all' },
    { action: 'pull', image: 'nginx; touch /tmp/x' },
    { action: 'compose-up', file: '../compose.yaml' },
    { action: 'dockerfile-up', file: '../Dockerfile' },
    { action: 'dockerfile-up', file: '/etc/passwd' },
    { action: 'template-apply', templateId: 'unknown', version: '1.0.0' },
    { action: 'template-apply', templateId: 'debian', version: 'latest' },
  ])
    assert.equal(containerActionSchema.safeParse(input).success, false);
  const machines = { get: () => ({ distro: 'alpine' }) } as unknown as MachinesType;
  const containers = new Containers(machines, {} as WorkspacesType);
  try {
    assert.equal((await containers.view('vm')).supported, false);
    await assert.rejects(containers.run('vm', { action: 'install' }), /Debian 和 Ubuntu/);
  } finally {
    await containers.close();
  }
});
test('official Dev Container template metadata binds the requested source, version and file paths', () => {
  const metadata = {
    id: 'debian', version: '4.0.2', name: 'Debian', description: 'Debian environment',
    publisher: 'Dev Container Spec Maintainers',
    documentationURL: 'https://github.com/devcontainers/templates/tree/main/src/debian',
    options: { imageVariant: { type: 'string', default: 'bookworm', proposals: ['trixie', 'bookworm'] } },
    optionalPaths: ['.github/dependabot.yml'],
    files: ['.devcontainer/devcontainer.json', '.github/dependabot.yml'],
  };
  const output = `[log] metadata\n${JSON.stringify(metadata)}\n`;
  const verified = verifyDevcontainerTemplateMetadata(output, 'debian', '4.0.2');
  assert.equal(verified.reference, 'ghcr.io/devcontainers/templates/debian:4.0.2');
  assert.deepEqual(verified.imageVariant?.choices, ['bookworm', 'trixie']);
  assert.throws(() => verifyDevcontainerTemplateMetadata(output, 'python', '4.0.2'), /来源或版本/);
  assert.throws(() => verifyDevcontainerTemplateMetadata(output, 'debian', '4.0.1'), /来源或版本/);
  assert.throws(() => verifyDevcontainerTemplateMetadata(JSON.stringify({ ...metadata,
    publisher: 'Impostor' }), 'debian'), /来源或版本/);
  assert.throws(() => verifyDevcontainerTemplateMetadata(JSON.stringify({ ...metadata,
    files: ['../escape', '.devcontainer/devcontainer.json'] }), 'debian'), /元数据无效/);
});
test('container view keeps project Dev Container files visible when the CLI is unavailable', async () => {
  const machines = {
    get: () => ({ distro: 'debian' }),
    exec: async (_id: string, command: string) => {
      if (command.includes('SAKURA_DEVCONTAINER_VERSION'))
        return { code: 0, stdout: 'Dockerfile\n.devcontainer/devcontainer.json\nSAKURA_DEVCONTAINER_VERSION\nunavailable\n', stderr: '' };
      if (command.includes('SAKURA_IMAGES'))
        return { code: 0, stdout: 'SAKURA_IMAGES\nSAKURA_VOLUMES\nSAKURA_COMPOSE\nDocker Compose 2\nSAKURA_FILES\n', stderr: '' };
      return { code: 0, stdout: '27.0\n', stderr: '' };
    },
  } as unknown as MachinesType;
  const workspaces = { config: async () => ({ directory: '/workspace' }) } as unknown as WorkspacesType;
  const containers = new Containers(machines, workspaces);
  try {
    const view = await containers.view('vm');
    assert.equal(view.devcontainer?.cliInstalled, false);
    assert.deepEqual(view.devcontainer?.files, ['Dockerfile', '.devcontainer/devcontainer.json']);
  } finally {
    await containers.close();
  }
});
test('multiple drafts keep typing independent from an in-flight save and discard invalid restored entries', () => {
  const submitted = { id: 'a', path: '/a', content: 'submitted', baseContent: 'old' },
    other = { id: 'b', path: '/b', content: 'b', baseContent: 'b' };
  const result = saveDraftResult([{ ...submitted, content: 'newer typing' }, other], submitted, 'v2');
  assert.equal(result[0].content, 'newer typing');
  assert.equal(result[0].baseContent, 'submitted');
  assert.equal(result[1], other);
  assert.equal(anyDirty(result), true);
  const renamed = { ...submitted, path: '/new-path', fresh: true };
  assert.equal(saveDraftResult([renamed], submitted, 'v2')[0], renamed);
  const restored = restoreDrafts([
    null,
    { path: 'relative', content: 'x' },
    submitted,
    submitted,
    { ...other, id: 'a' },
  ]);
  assert.equal(restored.length, 2);
  assert.notEqual(restored[0].id, restored[1].id);
});
test('migration checks stale previews, preserves originals, and activates only a completed verified copy', async () => {
  const source = join(root, 'migration-source'),
    target = join(root, 'migration-target');
  await mkdir(source);
  await writeFile(join(source, 'important.txt'), 'original');
  const machines = new Machines({ run: async () => '{}' } as unknown as Engine);
  const migration = new DataMigration(machines, () => [], source);
  try {
    await assert.rejects(migration.plan(source), /相同或相互包含/);
    const stale = await migration.plan(target);
    await writeFile(join(source, 'new.txt'), 'new');
    await assert.rejects(migration.start(target, stale.token), /重新预览/);
    assert.equal(machines.maintenance, false);
    const plan = await migration.plan(target);
    assert.equal(plan.count, 2);
    await migration.start(target, plan.token);
    await migration.jobs.wait('data');
    assert.equal(migration.jobs.view('data')?.status, 'done', migration.jobs.view('data')?.error);
    assert.equal(dataDirectory(source), target);
    assert.equal(await readFile(join(source, 'important.txt'), 'utf8'), 'original');
    assert.equal(await readFile(join(target, 'important.txt'), 'utf8'), 'original');
    await assert.rejects(
      machines.locked('new', async () => {}),
      /迁移维护/,
    );
    await migration.cancelActivation();
    assert.equal(dataDirectory(source), source);
    assert.equal(machines.maintenance, false);
  } finally {
    await migration.close();
  }
});
test('migration refuses live guests, interrupted copies and unverified redirections', async () => {
  const source = join(root, 'interrupted-source'),
    target = join(root, 'interrupted-target');
  await mkdir(source);
  await writeFile(join(source, 'data'), Buffer.alloc(1024 * 1024));
  const machines = new Machines({} as Engine),
    migration = new DataMigration(machines, () => [], source);
  try {
    const plan = await migration.plan(target);
    machines.live.set('test', {} as never);
    await assert.rejects(migration.start(target, plan.token), /停止全部实例/);
    machines.live.clear();
    await migration.start(target, plan.token);
    migration.jobs.cancel('data');
    await migration.jobs.wait('data');
    assert.equal(dataDirectory(source), source);
    assert.equal(machines.maintenance, false);
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith('.sakura-migrate-')),
      false,
    );
    await mkdir(target);
    await writeFile(
      join(source, '.sakura-redirect.json'),
      JSON.stringify({ version: 1, target, id: 'expected' }),
    );
    await writeFile(
      join(target, '.sakura-migration.json'),
      JSON.stringify({ id: 'different', source, completedAt: 'now' }),
    );
    assert.throws(() => dataDirectory(source), /尚未完成/);
  } finally {
    await migration.close();
  }
});

test('flushing unchanged job history does not invalidate a reviewed migration plan', async () => {
  const source = join(root, 'history-migration-source'),
    target = join(root, 'history-migration-target');
  await mkdir(source);
  const jobs = new Jobs('existing-task', join(source, 'jobs'));
  const machines = new Machines({} as Engine),
    migration = new DataMigration(machines, () => [jobs], source);
  try {
    jobs.start('example', async () => {});
    await jobs.wait('example');
    const plan = await migration.plan(target),
      file = join(source, 'jobs', 'existing-task.json'),
      modified = (await stat(file)).mtimeMs;
    await jobs.flush();
    assert.equal((await stat(file)).mtimeMs, modified);
    await migration.start(target, plan.token);
    await migration.jobs.wait('data');
    assert.equal(migration.jobs.view('data')?.status, 'done', migration.jobs.view('data')?.error);
    await migration.cancelActivation();
  } finally {
    await migration.close();
    await jobs.close();
  }
});

test('SSH includes from a previous migrated directory are repaired without editing the user config', async () => {
  const previous = join(root, 'old-data-root');
  await mkdir(join(previous, 'ssh'), { recursive: true });
  await writeFile(
    join(previous, '.sakura-redirect.json'),
    JSON.stringify({ version: 1, target: root, id: 'ssh-migration' }),
  );
  await writeFile(
    join(root, '.sakura-migration.json'),
    JSON.stringify({ source: previous, id: 'ssh-migration', completedAt: 'now' }),
  );
  const machines = new Machines({} as Engine),
    ide = new Ide(machines, {} as WorkspacesType, join(root, 'test-user-ssh'));
  try {
    await ide.update();
    assert.equal(
      await readFile(join(previous, 'ssh', 'config'), 'utf8'),
      `Include ${sshPath(join(root, 'ssh', 'config'))}\n`,
    );
    await assert.rejects(stat(join(root, 'test-user-ssh')), { code: 'ENOENT' });
  } finally {
    await ide.close();
    await rm(join(root, '.sakura-migration.json'));
  }
});
test('health checks back off, enforce restart limits, preserve state after failed stops and honour manual stops', async () => {
  const id = randomUUID(),
    project = projectSchema.parse({
      services: [
        {
          name: 'api',
          command: 'sleep 60',
          health: {
            command: 'health-probe',
            failures: 1,
            interval: 5,
            maxRestarts: 1,
            restart: true,
            backoff: 5,
          },
        },
      ],
    });
  const emitter = new EventEmitter() as unknown as MachinesType;
  emitter.live = new Map([[id, {} as never]]);
  emitter.state = () => 'running';
  emitter.exec = async (_id, script) => ({
    code: script.includes('health-probe') ? 1 : 0,
    stdout: '',
    stderr: '',
  });
  const projects = new Jobs('health-test-projects', root);
  const workspaces = {
    config: async () => project,
    resolvedConfig: async () => project,
    jobs: projects,
  } as unknown as WorkspacesType;
  const health = new ServiceHealth(emitter, workspaces);
  try {
    (await health.expect(id, 'start'))(true);
    await health.tick(10000);
    await health.jobs.wait(id);
    assert.equal((await health.view(id)).services[0].restarts, 1);
    await health.tick(12000);
    assert.equal((await health.view(id)).services[0].failures, 1);
    await health.tick(20000);
    assert.equal((await health.view(id)).services[0].status, 'exhausted');
    (await health.expect(id, 'stop'))(false);
    assert.equal((await health.view(id)).services[0].desired, true);
    (await health.expect(id, 'stop'))(true);
    await health.tick(30000);
    assert.equal((await health.view(id)).services[0].desired, false);
    (await health.expect(id, 'start'))(false);
    assert.equal((await health.view(id)).services[0].desired, false);
  } finally {
    await health.close();
    await projects.close();
  }
});
test('interrupted network changes can be restored but externally changed files are protected', async () => {
  const id = randomUUID(),
    locks = new Machines({} as Engine),
    files = new Map([['/etc/profile.d/sakura-network.sh', 'before']]);
  locks.get = () => ({ id, distro: 'alpine' }) as ReturnType<MachinesType['get']>;
  locks.sftp = (async (_id: string, work: (ftp: unknown) => Promise<unknown>) =>
    work({
      lstat: (path: string, done: Function) =>
        files.has(path) ? done(null, { isFile: () => true }) : done({ code: 2 }),
    })) as MachinesType['sftp'];
  locks.readGuestFile = async (_id, path) => files.get(path)!;
  locks.writeGuestFile = async (_id, path, content) => {
    files.set(path, content);
  };
  locks.exec = async () => ({ code: 0, stdout: '', stderr: '' });
  const network = new NetworkProfiles(locks);
  try {
    const preview = await network.preview(id, { httpProxy: 'http://localhost:7890' });
    await assert.rejects(
      network.apply(id, { httpProxy: 'http://localhost:7891' }, preview.token),
      /重新预览/,
    );
    await network.apply(id, preview.config, preview.token);
    assert.ok((await network.environment(id)).HTTP_PROXY);
    files.set('/etc/profile.d/sakura-network.sh', 'external change');
    await assert.rejects(network.restore(id), /外部修改/);
    assert.equal(files.get('/etc/profile.d/sakura-network.sh'), 'external change');
    files.set('/etc/profile.d/sakura-network.sh', preview.changes[0].after);
    await network.restore(id);
    assert.equal(files.get('/etc/profile.d/sakura-network.sh'), 'before');
    assert.deepEqual(await network.environment(id), {});
  } finally {
    await network.close();
  }
});
