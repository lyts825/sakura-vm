import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setVmStorageRoot } from '../server/model.ts';
import { SingleAppWindows } from '../server/single-app-windows.ts';
import type { Machines } from '../server/machines.ts';

test('per-program clipboard rules persist and corrupt state cannot silently allow a launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-single-app-policy-'));
  const id = randomUUID();
  setVmStorageRoot(id, root);
  const machines = Object.assign(new EventEmitter(), {
    get: () => ({ id }), requireUnlocked: () => {},
    locked: async (_key: string, task: () => Promise<unknown>) => task(),
    records: new Map([[id, { id }]]), state: () => 'stopped',
  }) as unknown as Machines;
  const first = new SingleAppWindows(machines);
  const reopened = new SingleAppWindows(machines);
  try {
    assert.deepEqual(await first.clipboardPolicies(id), {});
    await first.saveClipboardPolicy(id, 'xterm', { copy: false, paste: true });
    assert.deepEqual((await reopened.clipboardPolicies(id)).xterm,
      { copy: false, paste: true });
    await assert.rejects(first.saveClipboardPolicy(id, 'xterm',
      { copy: 'false', paste: true }));
    assert.equal((await reopened.clipboardPolicies(id)).xterm.copy, false);
    await reopened.removeClipboardPolicy(id, 'xterm');
    assert.deepEqual(await first.clipboardPolicies(id), {});
    await writeFile(join(root, id, 'single-app-clipboard.json'), '{broken');
    await assert.rejects(first.clipboardPolicies(id));
    await assert.rejects(first.saveClipboardPolicy(id, 'xterm',
      { copy: true, paste: true }));
  } finally {
    await first.close();
    await reopened.close();
    setVmStorageRoot(id);
    const path = await realpath(root);
    if (dirname(path) !== resolve(tmpdir()) ||
        !basename(path).startsWith('sakura-single-app-policy-'))
      throw new Error('unsafe policy test cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
