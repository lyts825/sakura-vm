import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Workspaces as WorkspacesType } from '../server/workspaces.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-management-'));
process.env.SAKURA_DATA_DIR = root;
const { Jobs } = await import('../server/jobs.ts');
const { projectSchema, setupFingerprint } = await import('../server/workspaces.ts');
const { serviceOrder } = await import('../server/project-services.ts');
const { recipeSchema } = await import('../server/recipes.ts');
const { ignored, syncDirection } = await import('../server/sync.ts');
const { verifyBackup, backupPolicySchema } = await import('../server/backups.ts');
const { redact, hostPortIssue } = await import('../server/maintenance.ts');
const { Ide } = await import('../server/ide.ts');
const { dirtyEdit, completeFileSave } = await import('../src/file-editor-state.ts');
after(() => rm(root, { recursive: true, force: true }));

test('task history survives restart and interrupted work never resumes implicitly', async () => {
  const dir = join(root, 'history');
  await mkdir(dir);
  await writeFile(
    join(dir, 'test.json'),
    JSON.stringify([
      { id: 'old', key: 'vm', status: 'running', startedAt: new Date().toISOString(), log: 'preparing' },
    ]),
  );
  const jobs = new Jobs('test', dir);
  assert.equal(jobs.view('vm')?.status, 'interrupted');
  await jobs.close();
  const reopened = new Jobs('test', dir);
  assert.equal(reopened.get('old')?.status, 'interrupted');
  assert.match(reopened.get('old')!.error!, /重启/);
  await reopened.close();
});
test('cancelling a tracked task waits for cleanup and records a durable cancelled result', async () => {
  const jobs = new Jobs('cancel', root);
  let entered!: () => void,
    cleaned = false;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = jobs.track('vm', async (_log, signal) => {
    entered();
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        'abort',
        () => {
          cleaned = true;
          resolve();
        },
        { once: true },
      ),
    );
  });
  const rejected = assert.rejects(pending, /取消/);
  await ready;
  jobs.cancel(jobs.view('vm')!.id!);
  await rejected;
  assert.ok(cleaned);
  await jobs.close();
  const data = JSON.parse(await readFile(join(root, 'cancel.json'), 'utf8'));
  assert.equal(data[0].status, 'cancelled');
  assert.ok(data[0].finishedAt);
});
test('multi-service projects validate dependencies, duplicates, cycles and shell-safe environment names', () => {
  const valid = projectSchema.parse({
    services: [
      { name: 'web', command: 'npm start', dependsOn: ['api'] },
      { name: 'api', command: 'python app.py' },
    ],
  });
  assert.deepEqual(
    serviceOrder(valid.services!).map((s) => s.name),
    ['api', 'web'],
  );
  assert.deepEqual(
    serviceOrder(valid.services!, 'api').map((s) => s.name),
    ['api'],
  );
  for (const services of [
    [{ name: 'a', command: 'run', dependsOn: ['missing'] }],
    [
      { name: 'a', command: 'run', dependsOn: ['b'] },
      { name: 'b', command: 'run', dependsOn: ['a'] },
    ],
    [
      { name: 'a', command: 'run' },
      { name: 'a', command: 'run' },
    ],
  ])
    assert.equal(projectSchema.safeParse({ services }).success, false);
  assert.equal(projectSchema.safeParse({ environment: { 'A;rm': 'x' } }).success, false);
  assert.notEqual(
    setupFingerprint(projectSchema.parse({ environment: { NODE_ENV: 'dev' } })),
    setupFingerprint(projectSchema.parse({ environment: { NODE_ENV: 'prod' } })),
  );
});
test('environment recipes reject executable host settings and preserve legacy projects', () => {
  const recipe = recipeSchema.parse({ version: 1, project: { command: 'npm start' } });
  assert.equal(recipe.project.directory, '/workspace');
  assert.equal(recipeSchema.safeParse({ ...recipe, hostCommand: 'calc.exe' }).success, false);
  assert.equal(recipeSchema.safeParse({ ...recipe, resources: { diskGiB: 129 } }).success, false);
  assert.equal(recipeSchema.safeParse({ ...recipe, resources: { name: 'ignored-name' } }).success, false);
});
test('sync decisions distinguish one-sided edits from conflicts and ignores handle nested paths', () => {
  assert.equal(syncDirection('new', 'base', 'base'), 'push');
  assert.equal(syncDirection('base', 'new', 'base'), 'pull');
  assert.equal(syncDirection('host', 'guest', 'base'), 'conflict');
  assert.equal(syncDirection('same', 'same'), 'same');
  assert.ok(ignored('nested/debug.log', ['*.log']));
  assert.ok(ignored('build/deep/output.js', ['build/**']));
  assert.ok(ignored('src/dist/bundle.js', ['dist']));
  assert.ok(!ignored('src/distance.ts', ['dist']));
  assert.ok(!ignored('other/output.js', ['build/**']));
});
test('backup verification rejects truncation and changed disk bytes', async () => {
  const disk = Buffer.from('disk bytes'),
    manifest = Buffer.from(JSON.stringify({ sha256: createHash('sha256').update(disk).digest('hex') }));
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01');
  prefix.writeUInt32BE(manifest.length, 8);
  const file = join(root, 'backup.sakura');
  await writeFile(file, Buffer.concat([prefix, manifest, disk]));
  const signal = new AbortController().signal;
  assert.match(await verifyBackup(file, signal), /^[a-f0-9]{64}$/);
  await writeFile(file, Buffer.concat([prefix, manifest, Buffer.from('corrupted')]));
  await assert.rejects(verifyBackup(file, signal), /校验失败/);
  await writeFile(file, prefix);
  await assert.rejects(verifyBackup(file, signal));
  assert.equal(backupPolicySchema.safeParse({ keep: 0 }).success, false);
  assert.equal(backupPolicySchema.safeParse({ intervalHours: 0 }).success, false);
});
test('SSH integration preserves user configuration, is idempotent and follows changed project ports', async (t) => {
  const id = randomUUID();
  const vm = { id, name: 'dev', distro: 'debian' };
  const machine = Object.assign(new EventEmitter(), {
    records: new Map([[id, vm]]),
    live: new Map([[id, { sshPort: 23456 }]]),
    get: () => vm,
    state: () => 'running',
    locked: async (_key: string, fn: () => Promise<unknown>) => fn(),
  }) as unknown as MachinesType;
  const project = {
    config: async () => ({ directory: "/workspace/中文 path/$HOME/`marker/it's" }),
  } as unknown as WorkspacesType;
  const dir = join(root, 'user-ssh');
  await mkdir(dir);
  await writeFile(join(dir, 'config'), 'Host existing\n  HostName example.com\n');
  const ide = new Ide(machine, project, dir);
  t.after(() => ide.close());
  const alias = `sakura-${id}-default`;
  let port = 43333, starts = 0;
  const endpoint = () => ({ hostKeyAlias: alias, port,
    identity: join(root, 'project-ssh', 'default', 'id_rsa'),
    knownHosts: join(root, 'project-ssh', 'default', 'known_hosts') });
  Reflect.set(ide, 'projectSsh', {
    status: async (vmId: string, config: { directory: string }) => {
      assert.equal(vmId, id);
      assert.equal(config.directory, (await project.config(id)).directory);
      return { present: true, running: true, valid: true, processes: 1 };
    },
    endpoint: async (vmId: string) => { assert.equal(vmId, id); return endpoint(); },
    entries: async () => [endpoint()],
    start: async (vmId: string) => { assert.equal(vmId, id); ++starts; },
    close: async () => {},
  });
  await ide.install(id);
  await ide.install(id);
  const config = await readFile(join(dir, 'config'), 'utf8');
  assert.equal(config.match(/Include/g)?.length, 1);
  assert.match(config, /Host existing/);
  const state = await ide.view(id);
  assert.match(state.url, /%E4%B8%AD%E6%96%87%20path/);
  assert.equal(
    state.command,
    `code --remote ssh-remote+${alias} '/workspace/中文 path/$HOME/\`marker/it''s'`,
  );
  assert.equal(starts, 2);
  const generated = await readFile(join(root, 'ssh/config'), 'utf8');
  assert.match(generated, /Port 43333/);
  assert.match(generated, /StrictHostKeyChecking yes/);
  assert.match(generated, /project-ssh\/default\/id_rsa/);
  assert.equal(generated.includes('Port 23456'), false);
  machine.live.get(id)!.sshPort = 34567;
  port = 43334;
  await ide.update();
  const updated = await readFile(join(root, 'ssh/config'), 'utf8');
  assert.match(updated, /Port 43334/);
  assert.equal(updated.includes('Port 34567'), false);
  await ide.close();
  assert.equal(machine.listenerCount('change'), 0);
});
test('diagnostic reports remove private keys, credentials and local paths', () => {
  const value = redact(
    'token=abc password: xyz\n-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----\nC:\\Users\\Alice\\workspace\nhttps://user:pass@example.com\nAuthorization: Bearer abc.def\n{"password":"two words","authorization":"Basic ZGVtbw=="}',
  );
  for (const secret of ['abc', 'xyz', 'PRIVATE KEY', 'Alice', 'user:pass', 'words', 'ZGVtbw'])
    assert.ok(!value.includes(secret));
});
test('diagnostics detect host program port conflicts and release successful probes', async (t) => {
  const server = createServer();
  t.after(() => {
    if (server.listening) server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  assert.equal(await hostPortIssue(port), 'EADDRINUSE');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  assert.equal(await hostPortIssue(port), null);
  assert.equal(await hostPortIssue(port), null);
});
test('drafts detect unsaved text and retain newer typing after a successful save', () => {
  const submitted = { path: '/a', content: 'one', baseContent: 'old', version: 'old-version' };
  assert.ok(dirtyEdit(submitted));
  assert.ok(!dirtyEdit({ ...submitted, content: 'old' }));
  const next = completeFileSave({ ...submitted, content: 'two' }, submitted)!;
  assert.equal(next.content, 'two');
  assert.equal(next.baseContent, 'one');
  assert.ok(dirtyEdit(next));
});
