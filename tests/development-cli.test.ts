import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const modulePath = '../scripts/development-cli.mjs';
const { developmentCommand } = await import(modulePath);
const root = await mkdtemp(join(tmpdir(), 'sakura-dev-cli-'));
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(root, /sakura-dev-cli-/);
  await rm(root, { recursive: true, force: true });
});
function fixture() {
  const calls: { path: string; method: string; body: any }[] = [];
  const api = async (path: string, method = 'GET', body?: unknown) => {
    calls.push({ path, method, body });
    return path === '/vms' ? [{ id: 'vm-id', name: 'example' }] : { ok: true };
  };
  const run = (action: string, name: string, args: string[] = []) =>
    developmentCommand(action, name, args, api, 'http://127.0.0.1:7339');
  return { calls, run };
}
test('CLI preserves Git paths and command parameters as structured data', async () => {
  const { calls, run } = fixture();
  await run('git', 'example', ['stage', 'a b.txt', 'a;echo.txt']);
  assert.deepEqual(calls.at(-1), {
    path: '/vms/vm-id/git',
    method: 'POST',
    body: { action: 'stage', paths: ['a b.txt', 'a;echo.txt'] },
  });
  const file = join(root, 'values.json');
  await writeFile(file, JSON.stringify({ TARGET: 'one two;$HOME' }));
  await run('commands', 'example', ['run', 'preset-id', file]);
  assert.deepEqual(calls.at(-1)?.body.values, { TARGET: 'one two;$HOME' });
  await run('project-files', 'example', ['hello world', '--content']);
  assert.match(calls.at(-1)!.path, /q=hello%20world&content=1$/);
});
test('CLI applies the reviewed network and migration tokens without silently replanning', async () => {
  const { calls, run } = fixture(),
    file = join(root, 'preview.json');
  await writeFile(
    file,
    JSON.stringify({ token: 'reviewed', target: 'E:\\New Data', config: { httpProxy: '' } }),
  );
  await run('network', 'example', ['apply', file]);
  assert.deepEqual(calls.at(-1)?.body, { action: 'apply', token: 'reviewed', config: { httpProxy: '' } });
  calls.length = 0;
  await run('migration', 'start', [file]);
  assert.deepEqual(calls, [
    {
      path: '/migration',
      method: 'POST',
      body: { action: 'start', target: 'E:\\New Data', token: 'reviewed' },
    },
  ]);
  await assert.rejects(run('network', 'example', ['unrecognized']), /Unknown network action/);
});
test('CLI secrets require the dedicated environment variable and never accept a positional value', async () => {
  const previous = process.env.SAKURA_SECRET_VALUE,
    { calls, run } = fixture();
  try {
    delete process.env.SAKURA_SECRET_VALUE;
    await assert.rejects(
      run('secrets', 'example', ['put', 'token', 'unsafe-positional-value']),
      /SAKURA_SECRET_VALUE/,
    );
    process.env.SAKURA_SECRET_VALUE = 'test-value';
    const result = await run('secrets', 'example', ['put', 'token']);
    assert.deepEqual(calls.at(-1)?.body, { name: 'token', value: 'test-value' });
    assert.ok(!JSON.stringify(result).includes('test-value'));
  } finally {
    if (previous === undefined) delete process.env.SAKURA_SECRET_VALUE;
    else process.env.SAKURA_SECRET_VALUE = previous;
  }
});
