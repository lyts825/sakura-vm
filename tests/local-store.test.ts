import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeStore } from '../server/local-store.ts';

const originalRename = fs.rename, originalWriteFile = fs.writeFile;
const base = resolve('.data/local-store-test-temp');
const windows = process.platform === 'win32';

async function fixture() {
  await fs.mkdir(base, { recursive: true });
  assert.equal(await fs.realpath(base), base);
  assert.equal((await fs.lstat(base)).isSymbolicLink(), false);
  const directory = await fs.mkdtemp(join(base, 'local-store-'));
  const file = join(directory, 'state.json');
  const old = JSON.stringify({ generation: 'old', body: 'old-owned-body'.repeat(2048) }, null, 2);
  const value = { generation: 'new', body: 'new-owned-body'.repeat(2048) };
  const next = JSON.stringify(value, null, 2);
  await originalWriteFile(file, old);
  return { directory, file, old, value, next, cleanup: async () => {
    assert.equal(dirname(resolve(directory)), base);
    assert.equal(await fs.realpath(directory), directory);
    assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
    await fs.rm(directory, { recursive: true, force: true });
  } };
}

// Only this helper's own FileStream holds its own fixture file. The .NET call
// avoids PowerShell module autoload and excludes FileShare.Delete explicitly.
async function holdWindowsFile(file: string) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'
$stream=[System.IO.File]::Open('${file.replaceAll("'", "''")}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
try {
  [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush()
  [void][Console]::In.ReadLine()
} finally { $stream.Dispose() }
[Console]::Out.WriteLine('CLOSED')
`], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '', locked = false;
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => { readyResolve = yes; readyReject = no; });
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString('utf8');
    if (output.length > 4096) readyReject(new Error('owned lock helper output limit'));
    if (!locked && /(?:^|\r?\n)LOCKED\r?\n/.test(output)) { locked = true; readyResolve(); }
  });
  child.stderr.on('data', (data: Buffer) => { errors = (errors + data.toString('utf8')).slice(0, 4096); });
  child.on('error', error => readyReject(error));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(yes => {
    child.on('close', (code, signal) => {
      if (!locked) readyReject(new Error(`owned lock helper exited before locking: ${code}: ${errors}`));
      yes({ code, signal });
    });
  });
  async function bounded<T>(promise: Promise<T>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, no) => {
      timer = setTimeout(() => no(new Error('owned lock helper timeout')), 10_000);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
  async function release() {
    if (child.exitCode === null && child.signalCode === null && !child.stdin.destroyed) child.stdin.end('RELEASE\n');
    try {
      const result = await bounded(exited);
      assert.equal(result.code, 0, errors);
      assert.equal(result.signal, null);
      assert.ok(output.includes('CLOSED'));
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await bounded(exited);
      throw error;
    }
  }
  try { await bounded(ready); }
  catch (error) { child.stdin.end(); child.kill(); await bounded(exited); throw error; }
  return { release };
}

test('Windows replacement retries a real short file lock without exposing a missing or partial destination', { skip: !windows }, async t => {
  const f = await fixture();
  let lock: Awaited<ReturnType<typeof holdWindowsFile>> | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let stopReader = false;
  let reader: Promise<void> | undefined;
  try {
    lock = await holdWindowsFile(f.file);
    const counts = { old: 0, new: 0 };
    reader = (async () => {
      while (!stopReader) {
        const bytes = await fs.readFile(f.file, 'utf8');
        assert.ok(bytes === f.old || bytes === f.next, 'readers see a complete old or new document');
        ++counts[bytes === f.old ? 'old' : 'new'];
        await delay(2);
      }
    })();
    // Attach immediately so an unexpected read failure cannot be an unhandled rejection.
    void reader.catch(() => {});
    const released = new Promise<void>((yes, no) => {
      releaseTimer = setTimeout(() => { void lock!.release().then(yes, no); }, 150);
    });
    const started = performance.now();
    await writeStore(f.file, f.value);
    await released;
    await delay(15);
    stopReader = true;
    await reader;
    assert.equal(await fs.readFile(f.file, 'utf8'), f.next);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
    assert.ok(counts.old > 1 && counts.new > 0);
    t.diagnostic(JSON.stringify({ nativeLock: true, shareDelete: false, elapsedMs: Math.round(performance.now() - started), reads: counts,
      oldSha256: createHash('sha256').update(f.old).digest('hex'), newSha256: createHash('sha256').update(f.next).digest('hex') }));
  } finally {
    stopReader = true;
    if (releaseTimer) clearTimeout(releaseTimer);
    await reader?.catch(() => {});
    await lock?.release();
    await f.cleanup();
  }
});

test('Windows sustained native lock preserves the old document, returns the rename error, and cleans its only temporary file', { skip: !windows }, async t => {
  const f = await fixture();
  let lock: Awaited<ReturnType<typeof holdWindowsFile>> | undefined;
  try {
    lock = await holdWindowsFile(f.file);
    const started = performance.now();
    let failure: NodeJS.ErrnoException | undefined;
    await assert.rejects(writeStore(f.file, f.value), error => {
      failure = error as NodeJS.ErrnoException;
      assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(failure.code || ''));
      assert.equal(failure.syscall, 'rename');
      assert.equal((failure as NodeJS.ErrnoException & { dest: string }).dest, f.file);
      assert.ok(failure.path?.startsWith(f.file + '.') && failure.path.endsWith('.tmp'));
      return true;
    });
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs >= 900 && elapsedMs < 5000, `bounded retry elapsed ${elapsedMs}ms`);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
    t.diagnostic(JSON.stringify({ nativeLock: true, shareDelete: false, elapsedMs: Math.round(elapsedMs), code: failure!.code,
      errno: failure!.errno, syscall: failure!.syscall, oldSha256: createHash('sha256').update(f.old).digest('hex') }));
  } finally { await lock?.release(); await f.cleanup(); }
});

for (const code of ['EPERM', 'EACCES', 'EBUSY']) test(`Windows ${code} retry uses one exclusive flushed write and the identical temporary inode and bytes`, { skip: !windows }, async t => {
  const f = await fixture();
  let writes = 0, attempts = 0;
  const identities: Array<{ path: string; device: number; inode: number; sha256: string }> = [];
  try {
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      ++writes;
      assert.deepEqual(args[2], { mode: 0o600, flag: 'wx', flush: true });
      return originalWriteFile(...args);
    });
    t.mock.method(fs, 'rename', async (temp: string, destination: string) => {
      ++attempts;
      const info = await fs.lstat(temp), bytes = await fs.readFile(temp, 'utf8');
      assert.equal(bytes, f.next);
      assert.equal(await fs.readFile(destination, 'utf8'), f.old);
      identities.push({ path: temp, device: info.dev, inode: info.ino, sha256: createHash('sha256').update(bytes).digest('hex') });
      if (attempts < 3) throw Object.assign(new Error('owned transient rename error'), { code });
      return originalRename(temp, destination);
    });
    syncBuiltinESMExports();
    await writeStore(f.file, f.value);
    assert.equal(writes, 1); assert.equal(attempts, 3);
    for (const identity of identities) assert.deepEqual(identity, identities[0]);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.next);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup(); }
});

test('non-retry rename errors are returned unchanged after one attempt and preserve the destination', async t => {
  const f = await fixture(), failure = Object.assign(new Error('owned non-retry error'), { code: 'EIO' });
  let attempts = 0;
  try {
    t.mock.method(fs, 'rename', async () => { ++attempts; throw failure; }); syncBuiltinESMExports();
    await assert.rejects(writeStore(f.file, f.value), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup(); }
});

test('the non-Windows platform gate returns EPERM unchanged without retry', async t => {
  const f = await fixture(), failure = Object.assign(new Error('owned platform gate error'), { code: 'EPERM' });
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let attempts = 0;
  try {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    t.mock.method(fs, 'rename', async () => { ++attempts; throw failure; }); syncBuiltinESMExports();
    await assert.rejects(writeStore(f.file, f.value), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup();
  }
});

test('serialization failure never writes or renames and leaves the original store intact', async t => {
  const f = await fixture();
  let writes = 0, attempts = 0;
  try {
    t.mock.method(fs, 'writeFile', async () => { ++writes; throw new Error('must not write'); });
    t.mock.method(fs, 'rename', async () => { ++attempts; throw new Error('must not rename'); }); syncBuiltinESMExports();
    await assert.rejects(writeStore(f.file, { invalid: 1n }), TypeError);
    assert.equal(writes, 0); assert.equal(attempts, 0);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup(); }
});

test('flush failure never publishes its written temporary bytes and preserves the original error', async t => {
  const f = await fixture(), failure = Object.assign(new Error('owned flush failure'), { code: 'EIO' });
  let attempts = 0;
  try {
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      assert.deepEqual(args[2], { mode: 0o600, flag: 'wx', flush: true });
      await originalWriteFile(...args);
      throw failure;
    });
    t.mock.method(fs, 'rename', async () => { ++attempts; throw new Error('must not rename after flush failure'); }); syncBuiltinESMExports();
    await assert.rejects(writeStore(f.file, f.value), error => error === failure);
    assert.equal(attempts, 0);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup(); }
});
