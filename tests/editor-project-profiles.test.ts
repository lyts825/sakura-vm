import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'sakura-editor-profiles-'));
process.env.SAKURA_DATA_DIR = directory;
const { Ide } = await import('../server/ide.ts');
const { runReport } = await import('../server/capability-reports.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
const id = '11111111-1111-4111-8111-111111111111';
const privateId = 'aabbccdd00112233';
const sharedId = 'bbccddee11223344';
const privateProject = { ...projectSchema.parse({
  directory: "/workspace/editor alpha's project", networkIsolation: 'private',
  environment: { TOKEN: 'do-not-export-project-secret' },
}), _workspace: privateId };
const sharedProject = { ...projectSchema.parse({ directory: '/workspace/shared' }), _workspace: sharedId };
const machines: any = {
  get: () => ({ id, name: 'test-editor', distro: 'debian' }),
  live: new Map([[id, { sshPort: 32222 }]]), records: new Map(),
  state: () => 'running', on: () => {}, off: () => {},
};
const spacesFor = (project: typeof privateProject | typeof sharedProject) => ({
  config: async () => project,
  projects: { current: () => project._workspace },
  onConfigChange: () => () => {},
}) as any;
const savedPrivate = { ...privateProject };
delete (savedPrivate as { _workspace?: string })._workspace;
const report = (spaces: any, editor = 'neovim', signal = new AbortController().signal) =>
  runReport(machines, spaces, id, 'editor-profiles', { editor }, signal);

test('editor profiles honor saved private siblings and unreadable settings without the IDE plugin', async () => {
  await mkdir(vmDir(id), { recursive: true });
  const saved = join(vmDir(id), `project-${privateId}.json`);
  try {
    await assert.rejects(report(spacesFor(privateProject)), /启用 IDE 插件/);
    await writeFile(saved, JSON.stringify(savedPrivate));
    await assert.rejects(report(spacesFor(sharedProject)), /启用 IDE 插件/);
    await writeFile(saved, '{invalid');
    await assert.rejects(report(spacesFor(sharedProject)), /启用 IDE 插件/);
  } finally { await rm(saved, { force: true }); }
  const legacy = await report(spacesFor(sharedProject));
  assert.equal(legacy.projectScoped, false);
  assert.equal(legacy.alias, 'sakura-test-editor');
  assert.equal(legacy.port, 32222);
});

test('all editor exports share the checked project endpoint and refuse a missing one', async () => {
  const spaces = spacesFor(privateProject), ide = new Ide(machines, spaces, join(directory, 'ssh-client'));
  let endpoint: object | null = null, checked: unknown;
  const identity = join(vmDir(id), 'project-ssh', privateId, 'id_rsa');
  (ide as any).projectSsh = {
    endpoint: async (_id: string, project: unknown, signal: AbortSignal) => {
      signal.throwIfAborted(); checked = project; return endpoint;
    },
    close: async () => {},
  };
  try {
    await assert.rejects(report(spaces), /先在项目页配置/);
    endpoint = { port: 43333, identity,
      knownHosts: join(vmDir(id), 'project-ssh', privateId, 'known_hosts'),
      hostKeyAlias: `sakura-${id}-${privateId}` };
    for (const editor of ['jetbrains', 'neovim', 'vscode']) {
      const value = await report(spaces, editor);
      assert.equal(checked, privateProject);
      assert.equal(value.editor, editor);
      assert.equal(value.projectScoped, true);
      assert.equal(value.projectId, privateId);
      assert.equal(value.networkIsolation, 'private');
      assert.equal(value.port, 43333);
      assert.equal(value.identityFile, identity);
      const content = (value.download as any).content;
      assert.match(content, /StrictHostKeyChecking yes/);
      assert.match(content, /ForwardAgent no\n  ProxyCommand none\n  ProxyJump none/);
      assert.match(content, new RegExp('HostKeyAlias sakura-' + id + '-' + privateId));
      assert.ok(!content.includes('32222'));
      assert.ok(!JSON.stringify(value).includes('do-not-export-project-secret'));
      assert.equal(value.remotePath, `scp://sakura-${id}-${privateId}//workspace/editor alpha's project/`);
    }
    const abort = new AbortController(); abort.abort();
    await assert.rejects(report(spaces, 'neovim', abort.signal));
  } finally { await ide.close(); }
  await assert.rejects(report(spaces), /启用 IDE 插件/);
});

test('a shared project in an instance with a private sibling also exports its own SSH service', async () => {
  const saved = join(vmDir(id), `project-${privateId}.json`);
  await writeFile(saved, JSON.stringify(savedPrivate));
  const spaces = spacesFor(sharedProject), ide = new Ide(machines, spaces, join(directory, 'shared-client'));
  let checked: unknown;
  (ide as any).projectSsh = {
    endpoint: async (_id: string, project: unknown) => {
      checked = project;
      return { port: 43334,
        identity: join(vmDir(id), 'project-ssh', sharedId, 'id_rsa'),
        knownHosts: join(vmDir(id), 'project-ssh', sharedId, 'known_hosts'),
        hostKeyAlias: `sakura-${id}-${sharedId}` };
    },
    close: async () => {},
  };
  try {
    const value = await report(spaces);
    assert.equal(checked, sharedProject);
    assert.equal(value.projectId, sharedId);
    assert.equal(value.networkIsolation, 'host');
    assert.equal(value.projectScoped, true);
    assert.equal(value.port, 43334);
  } finally { await ide.close(); await rm(saved, { force: true }); }
});

test('Alpine project profiles require a checked SSH endpoint and refuse unsupported IDE backends', async () => {
  const alpine = { ...machines, get: () => ({ id, name: 'test-editor', distro: 'alpine' }) };
  const spaces = spacesFor(privateProject),
    ide = new Ide(alpine, spaces, join(directory, 'alpine-client'));
  let endpoint: object | null = null;
  (ide as any).projectSsh = {
    status: async () => ({ present: false, running: false, valid: false, processes: 0, reason: null }),
    endpoint: async () => endpoint,
    entries: async () => [],
    close: async () => {},
  };
  try {
    const view = await ide.view(id);
    assert.equal(view.supported, true);
    assert.equal(view.vscodeSupported, false);
    assert.equal(view.projectScoped, true);
    assert.equal(view.command, '');
    assert.equal(view.url, '');
    assert.equal(view.sshCommand, '');
    await assert.rejects(
      runReport(alpine, spaces, id, 'editor-profiles', { editor: 'neovim' }, new AbortController().signal),
      /先在项目页配置/,
    );
    endpoint = {
      port: 43335,
      identity: join(vmDir(id), 'project-ssh', privateId, 'id_rsa'),
      knownHosts: join(vmDir(id), 'project-ssh', privateId, 'known_hosts'),
      hostKeyAlias: `sakura-${id}-${privateId}`,
    };
    const connected = await ide.view(id);
    assert.equal(connected.sshCommand, `ssh sakura-${id}-${privateId}`);
    assert.equal(connected.command, '');
    assert.equal(connected.url, '');
    const profile = await runReport(
      alpine,
      spaces,
      id,
      'editor-profiles',
      { editor: 'neovim' },
      new AbortController().signal,
    );
    assert.equal(profile.projectScoped, true);
    assert.equal(profile.port, 43335);
    assert.match((profile.download as any).content, /StrictHostKeyChecking yes/);
    assert.ok(!(profile.download as any).content.includes('32222'));
    assert.match(String(profile.instructions), /packadd netrw/);
    assert.equal(profile.relativeRemotePath, `scp://sakura-${id}-${privateId}/./`);
    for (const editor of ['vscode', 'jetbrains'])
      await assert.rejects(
        runReport(alpine, spaces, id, 'editor-profiles', { editor }, new AbortController().signal),
        /Debian 或 Ubuntu/,
      );
  } finally {
    await ide.close();
  }
});
