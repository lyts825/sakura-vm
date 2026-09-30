import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockHaWitnessState } from '../server/ha-witness-lock.ts';

const lockModule = new URL('../server/ha-witness-lock.ts', import.meta.url).href;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ha-witness-lock-'));
  const file = join(root, 'state.json');
  await writeFile(file, '{}');
  return { root, file, cleanup: async () => {
    const path = await realpath(root);
    if (!basename(path).startsWith('sakura-ha-witness-lock-') ||
        resolve(path) === resolve(tmpdir())) throw new Error('unsafe lock cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } };
}

function ownerProcess(file: string) {
  const script = `import { lockHaWitnessState } from ${JSON.stringify(lockModule)};
    try {
      const release = await lockHaWitnessState(${JSON.stringify(file)});
      console.log('LOCKED');
      process.stdin.resume();
      process.stdin.once('data', async () => { await release(); process.exit(0); });
    } catch (error) { console.error(error.code || error.message); process.exit(2); }`;
  const loader = process.execArgv.includes('--experimental-transform-types')
    ? ['--experimental-transform-types'] : ['--import', 'tsx'];
  const child = spawn(process.execPath, [...loader, '--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const exited = new Promise<number | null>((done, fail) => {
    child.once('error', fail); child.once('exit', done);
  });
  const ready = new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`lock owner failed to start: ${output}`)), 10_000);
    child.stdout.on('data', () => { if (output.split(/\r?\n/).includes('LOCKED')) { clearTimeout(timer); done(); } });
    void exited.then(() => {
      clearTimeout(timer);
      if (!output.split(/\r?\n/).includes('LOCKED')) fail(new Error(output));
    }, fail);
  });
  return { child, ready, exited, output: () => output };
}

async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGKILL');
  await exited;
}

test('the kernel excludes another process even when the live owner record is removed', async () => {
  const f = await fixture();
  const owner = ownerProcess(f.file);
  try {
    await owner.ready;
    await assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' });
    await unlink(`${f.file}.lock`);
    await assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' });
  } finally { await stop(owner.child); await f.cleanup(); }
});

test('an abrupt process death releases the kernel lock and permits serialized stale-owner recovery', async () => {
  const f = await fixture();
  const owner = ownerProcess(f.file);
  let release: Awaited<ReturnType<typeof lockHaWitnessState>> | undefined;
  try {
    await owner.ready;
    const previous = JSON.parse(await readFile(`${f.file}.lock`, 'utf8'));
    assert.equal(previous.pid, owner.child.pid);
    await stop(owner.child);
    release = await lockHaWitnessState(f.file);
    const current = JSON.parse(await readFile(`${f.file}.lock`, 'utf8'));
    assert.equal(current.pid, process.pid);
    assert.notEqual(current.token, previous.token);
    await assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' });
    await release(); release = undefined;
    release = await lockHaWitnessState(f.file);
  } finally { await release?.(); await stop(owner.child); await f.cleanup(); }
});

test('a remote or malformed owner record never becomes an automatic empty-state authorization', async () => {
  const f = await fixture();
  try {
    for (const owner of [JSON.stringify({ version: 1, host: 'unrecognized-remote-node',
      pid: 999999, token: 'old' }), '{broken']) {
      await writeFile(`${f.file}.lock`, owner);
      await assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' });
      assert.equal(await readFile(`${f.file}.lock`, 'utf8'), owner);
    }
  } finally { await f.cleanup(); }
});
