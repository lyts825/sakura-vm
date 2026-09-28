import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamTemplates } from '../server/team-templates.ts';

test('team templates preview and copy safe project and resource settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-team-template-'));
  const file = join(directory, 'templates.json');
  const source = { id: 'source', cpus: 3, memoryMiB: 1536, diskGiB: 12,
    accelerator: 'auto', distro: 'alpine', firmware: 'bios' };
  const created: Record<string, unknown>[] = [];
  const saved: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const machines = {
    get: (id: string) => id === 'source' ? source : { id },
    locked: async (_key: string, work: () => Promise<unknown>) => work(),
    create: async (input: Record<string, unknown>) => { created.push(input); return { id: 'new-vm' }; },
    delete: async (id: string) => { deleted.push(id); },
    view: async (id: string) => ({ id, name: created.at(-1)?.name }),
  };
  const project = {
    directory: '/workspace/private', template: 'node',
    repository: 'https://user:password@example.invalid/private.git',
    setup: 'echo a-secret', command: 'echo another-secret',
    environment: { TOKEN: 'do-not-copy' }, secrets: { TOKEN: 'private-key' },
    previewPort: 3000, runtimes: { node: '22.12.0' },
    services: [{ name: 'secret-service', command: 'echo do-not-copy' }],
  };
  const workspaces = {
    config: async () => project,
    save: async (id: string, content: Record<string, unknown>) => { saved.push({ id, content }); },
  };
  const catalog = new TeamTemplates(machines as never, workspaces as never, file);
  try {
    const preview = await catalog.action('source', { mode: 'capture', name: 'Node starter' }, 'check') as any;
    assert.equal(preview.ready, true);
    assert.equal(preview.content.resources.memoryMiB, 1536);
    assert.equal(preview.content.project.directory, '/workspace');
    assert.equal(preview.content.project.repository, '');
    assert.ok(!JSON.stringify(preview).includes('do-not-copy'));
    assert.ok(!JSON.stringify(preview).includes('password'));
    await assert.rejects(catalog.action('source', { mode: 'capture', name: 'Node starter',
      fingerprint: '0'.repeat(64) }, 'run'), /重新预览/);
    const capture = await catalog.action('source', { mode: 'capture', name: 'Node starter',
      fingerprint: preview.fingerprint }, 'run') as any;
    assert.equal(capture.template.version, 1);
    const listed = await catalog.action('source', { mode: 'list' }, 'check') as any;
    assert.equal(listed.templates.length, 1);
    assert.ok(!Object.hasOwn(listed.templates[0], 'content'));
    const templateId = capture.template.id;
    const inspected = await catalog.action('source', { mode: 'create', templateId,
      targetName: 'new-workspace' }, 'check') as any;
    assert.equal(inspected.template.fingerprint, preview.fingerprint);
    await assert.rejects(catalog.action('source', { mode: 'create', templateId,
      targetName: 'new-workspace', fingerprint: '0'.repeat(64) }, 'run'), /重新预览/);
    const result = await catalog.action('source', { mode: 'create', templateId,
      targetName: 'new-workspace', fingerprint: preview.fingerprint }, 'run') as any;
    assert.equal(result.vmId, 'new-vm');
    assert.equal(created[0].forwards instanceof Array, true);
    assert.equal((created[0].forwards as unknown[]).length, 0);
    assert.equal((saved[0].content as any).template, 'node');
    assert.equal((saved[0].content as any).repository, '');
    assert.equal(deleted.length, 0);
    assert.ok(!JSON.stringify(await readFile(file, 'utf8')).includes('do-not-copy'));
    source.memoryMiB = 2048;
    const updatePreview = await catalog.action('source', { mode: 'capture', name: 'Node starter',
      templateId }, 'check') as any;
    assert.equal(updatePreview.previousFingerprint, preview.fingerprint);
    await assert.rejects(catalog.action('source', { mode: 'capture', name: 'Node starter',
      templateId, fingerprint: updatePreview.fingerprint }, 'run'), /重新预览/);
    const updated = await catalog.action('source', { mode: 'capture', name: 'Node starter',
      templateId, fingerprint: updatePreview.fingerprint,
      previousFingerprint: updatePreview.previousFingerprint }, 'run') as any;
    assert.equal(updated.template.version, 2);
    assert.equal(updated.template.content.resources.memoryMiB, 2048);
    const removed = await catalog.action('source', { mode: 'delete', templateId,
      fingerprint: updatePreview.fingerprint }, 'run') as any;
    assert.equal(removed.deleted, templateId);
    assert.equal((await catalog.action('source', { mode: 'list' }, 'check') as any).templates.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('team template mutation rejects stale source, failed target setup cleans the new instance, and corrupt state fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-team-template-'));
  const file = join(directory, 'templates.json');
  const source = { id: 'source', cpus: 2, memoryMiB: 1024, diskGiB: 8,
    accelerator: 'auto', distro: 'alpine', firmware: 'bios' };
  const removed: string[] = [];
  const machines = {
    get: () => source,
    locked: async (_key: string, work: () => Promise<unknown>) => work(),
    create: async () => ({ id: 'failed-vm' }),
    delete: async (id: string) => { removed.push(id); },
  };
  let repository = 'https://example.invalid/repo.git';
  const workspaces = {
    config: async () => ({ directory: '/workspace', template: 'node', repository }),
    save: async () => { throw new Error('setup failed'); },
  };
  const catalog = new TeamTemplates(machines as never, workspaces as never, file);
  try {
    const first = await catalog.action('source', { mode: 'capture', name: 'Starter' }, 'check') as any;
    repository = 'https://example.invalid/changed.git';
    await assert.rejects(catalog.action('source', { mode: 'capture', name: 'Starter',
      fingerprint: first.fingerprint }, 'run'), /重新预览/);
    const second = await catalog.action('source', { mode: 'capture', name: 'Starter' }, 'check') as any;
    const captured = await catalog.action('source', { mode: 'capture', name: 'Starter',
      fingerprint: second.fingerprint }, 'run') as any;
    await assert.rejects(catalog.action('source', { mode: 'create',
      templateId: captured.template.id, fingerprint: second.fingerprint,
      targetName: 'failed-target' }, 'run'), /setup failed/);
    assert.deepEqual(removed, ['failed-vm']);
    const state = JSON.parse(await readFile(file, 'utf8'));
    state.templates[0].content.project.repository = 'https://evil.invalid/changed.git';
    await writeFile(file, JSON.stringify(state));
    await assert.rejects(catalog.action('source', { mode: 'list' }, 'check'), /校验失败/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
