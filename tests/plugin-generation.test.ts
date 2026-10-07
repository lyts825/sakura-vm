/**
 * 回归范围（完整情景见下方用例与断言）：
 * - front-end authority changes cancel plugin requests while core requests remain independent
 * - an old operation admission cannot call a newly activated provider
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginGeneration } from '../src/plugin-generation.ts';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { OperationGateway } from '../server/operation-gateway.ts';
import type { IncomingMessage } from 'node:http';

test('front-end authority changes cancel plugin requests while core requests remain independent', async () => {
  const directory = new PluginDirectory(), a = directory.begin('official', 'metrics', '1', 'artifact');
  directory.publish(a); const generations = new PluginGeneration(); generations.update(directory.view());
  const signal = generations.capture('/vms/example/metrics')!; assert.ok(signal);
  assert.equal(generations.capture('/system'), undefined);
  a.setPermissions(['vm']); assert.equal(generations.update(directory.view()), true); assert.equal(signal.aborted, true);
  const next = generations.capture('/vms/example/metrics')!; assert.equal(next.aborted, false);
  assert.equal(generations.update(directory.view()), false); a.revoke(); await a.scope.dispose();
});

test('an old operation admission cannot call a newly activated provider', async () => {
  const directory = new PluginDirectory(), a = directory.begin('official', 'metrics', '1', 'artifact');
  directory.publish(a);
  const gateway = new OperationGateway({ enabled: () => ['metrics'], instance: () => directory.get('official', 'metrics'),
    bind: async () => ({ check: async () => 'owner' }) });
  const admission = await gateway.prepare({ method: 'GET' } as IncomingMessage, new URL('http://localhost/api/vms/vm/metrics'));
  a.revoke(); await a.scope.dispose(); a.phase = 'inactive';
  const b = directory.begin('official', 'metrics', '2', 'replacement'); directory.publish(b);
  let calls = 0; assert.throws(() => admission.run(() => calls++), { code: 'PLUGIN_REVOKED' });
  await assert.rejects(admission.check(), { code: 'PLUGIN_REVOKED' }); assert.equal(calls, 0);
  b.revoke(); await b.scope.dispose();
});
