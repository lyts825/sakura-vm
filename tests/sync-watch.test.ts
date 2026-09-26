import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SyncWatchers } from '../server/sync-watch.ts';
import type { Machines } from '../server/machines.ts';

async function until(condition: () => boolean) {
  const end = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < end, 'watch event deadline');
    await delay(20);
  }
}

test('recursive host events and guest events trigger scans, with periodic reconciliation and disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-watch-'));
  let events = 0,
    guestEvent = false;
  const watches = new SyncWatchers(
    {
      state: () => 'running',
      exec: async () => {
        const code = guestEvent ? 0 : 2;
        guestEvent = false;
        return { code, stdout: '', stderr: '' };
      },
    } as unknown as Machines,
    () => events++,
  );
  try {
    await mkdir(join(root, 'nested'));
    watches.ensure('project', 'vm', { host: root, guest: '/workspace', auto: true, watch: true });
    await until(() => watches.view('project')?.guest === 'watching');
    assert.equal(watches.view('project')?.host, 'watching');
    const now = Date.now();
    watches.started('project', now);
    assert.equal(watches.due('project', now + 1000), false);
    assert.equal(watches.due('project', now + 60000), true);
    await writeFile(join(root, 'nested', 'file.txt'), 'changed');
    await until(() => events > 0);
    assert.equal(watches.due('project', now + 1000), true);
    await delay(100);
    watches.started('project', Date.now());
    const before = events;
    guestEvent = true;
    await until(() => events > before);
    assert.equal(watches.due('project', Date.now()), true);
    watches.retain(() => false);
    assert.equal(watches.view('project'), null);
  } finally {
    await watches.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('missing inotify falls back to scans and closing or replacing a watcher cancels SSH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-watch-fallback-'));
  let mode = 'missing',
    aborted = 0,
    started = 0;
  const watches = new SyncWatchers(
    {
      state: () => 'running',
      exec: async (_id: string, _command: string, _timeout: number, signal: AbortSignal) => {
        if (mode === 'missing') return { code: 127, stdout: '', stderr: '' };
        started++;
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted++;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      },
    } as unknown as Machines,
    () => {},
  );
  try {
    watches.ensure('project', 'vm', { host: root, guest: '/workspace', auto: true, watch: true });
    await until(() => !!watches.view('project')?.reason);
    watches.started('project', Date.now());
    assert.equal(watches.due('project', Date.now()), true);
    mode = 'wait';
    watches.ensure('project', 'vm', { host: root, guest: '/another', auto: true, watch: true });
    await until(() => started === 1);
    watches.ensure('project', 'vm', { host: root, guest: '/third', auto: true, watch: true });
    await until(() => started === 2);
    await watches.close();
    assert.equal(aborted, 2);
  } finally {
    await watches.close();
    await rm(root, { recursive: true, force: true });
  }
});
