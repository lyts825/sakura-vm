import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
// @ts-expect-error JavaScript CLI modules intentionally have no declaration file.
import { sandboxCommand } from '../scripts/sandbox-cli.mjs';

test('sandbox CLI keeps shell syntax inside quoted guest arguments', async () => {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const api = async (path: string, method?: string, body?: unknown) => {
    calls.push({ path, method, body });
    return path === '/sandboxes' ? { sandboxes: [{ id: 'id', name: 'sample' }], runs: [] } : { id: 'job' };
  };
  const result = await sandboxCommand('sandbox', 'run', ['sample', '--', 'printf', '%s', "a'b $(host)"], api);
  assert.equal(result.handled, true);
  assert.deepEqual(calls[1], {
    path: '/vms/id/sandbox/run',
    method: 'POST',
    body: { command: "'printf' '%s' 'a'\\''b $(host)'" },
  });
  await assert.rejects(sandboxCommand('sandbox', 'destroy', ['ordinary'], api), /Sandbox not found/);
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0);
});

test('sandbox CLI retrieves execution history after the VM has been destroyed', async () => {
  const job = { vmId: 'deleted', title: 'sample · 沙箱命令', status: 'done', log: 'kept' };
  const api = async () => ({ sandboxes: [], runs: [job] });
  assert.deepEqual((await sandboxCommand('sandbox', 'logs', ['sample'], api)).value, [job]);
  assert.deepEqual((await sandboxCommand('sandbox', 'logs', ['deleted'], api)).value, [job]);
});

test('sandbox CLI exports verified binary artifacts without overwriting an existing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-sandbox-cli-'));
  try {
    const bytes = Buffer.from([0, 255, 7]),
      output = join(directory, 'output.bin');
    const api = async () => ({
      base64: bytes.toString('base64'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    await sandboxCommand('sandbox', 'artifact', ['run', 'artifact', output], api);
    assert.deepEqual(await readFile(output), bytes);
    await assert.rejects(sandboxCommand('sandbox', 'artifact', ['run', 'artifact', output], api), {
      code: 'EEXIST',
    });
    const config = join(directory, 'run.json'),
      submitted: unknown[] = [];
    await writeFile(config, JSON.stringify({ command: 'pwd', artifacts: ['output.bin'] }));
    await sandboxCommand(
      'sandbox',
      'run-config',
      ['sample', config],
      async (path: string, _method: string, body: unknown) => {
        if (path === '/sandboxes') return { sandboxes: [{ id: 'id', name: 'sample' }] };
        submitted.push(body);
        return {};
      },
    );
    assert.deepEqual(submitted, [{ command: 'pwd', artifacts: ['output.bin'] }]);
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('sakura-sandbox-cli-'));
    await rm(directory, { recursive: true, force: true });
  }
});
