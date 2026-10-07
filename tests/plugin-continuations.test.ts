/**
 * 回归范围（完整情景见下方用例与断言）：
 * - native completion callbacks preserve their admitted identity without acquiring cleanup or fresh business authority
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { pluginAuthority, pluginCleanup, withPluginCleanup } from '../server/plugin-authority.ts';
import { captureOperationCheck } from '../server/operation-context.ts';
import { resourceContext, withResourceContext } from '../server/host-runtime/context.ts';
import { vmAccess } from '../server/vm-access.ts';

test('native completion callbacks preserve their admitted identity without acquiring cleanup or fresh business authority', async () => {
  const directory = new PluginDirectory();
  const instance = directory.begin('official', 'continuation', '1', 'a'.repeat(64));
  const other = directory.begin('system', 'unrelated-cleanup', '1', 'b'.repeat(64));
  directory.publish(instance);
  directory.publish(other);
  const vmId = '00000000-0000-4000-8000-000000000001';
  const native = new EventEmitter();
  let commands = 0;
  const machine = {
    records: new Map(),
    live: new Map([[vmId, {}]]),
    connect: async () => native,
    exec: async () => {
      commands++;
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  const vm = vmAccess(machine as never, instance.scope, instance);
  const client = await withResourceContext(
    { actorId: 'original-account', projectId: 'original-project' },
    () => vm.connect(vmId),
  );
  let checked!: Promise<void>,
    completed = false;
  client.once('close', function (this: unknown) {
    completed = true;
    assert.equal(this, client);
    assert.equal(pluginAuthority(), instance);
    assert.equal(pluginCleanup(), undefined);
    assert.equal(resourceContext()?.actorId, 'original-account');
    assert.equal(resourceContext()?.projectId, 'original-project');
    assert.equal(resourceContext()?.vmId, vmId);
    assert.equal(resourceContext()?.pluginGeneration, instance.generation);
    assert.throws(() => vm.exec(vmId, 'new-operation'), { name: 'AbortError' });
    checked = assert.rejects(captureOperationCheck()(), { code: 'PLUGIN_REVOKED' });
  });
  instance.revoke();
  withPluginCleanup(other, () => native.emit('close'));
  assert.equal(completed, true);
  await checked;
  assert.equal(commands, 0);
  await instance.scope.dispose();
  await other.scope.dispose();
});
