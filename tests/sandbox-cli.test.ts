import test from 'node:test';
import assert from 'node:assert/strict';
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
