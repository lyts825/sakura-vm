/**
 * 模块职责：回归验证模块，围绕 `ssh-agent-machines` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ssh-agent-machines`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: an owned forwarding Agent never authenticates the instance root login or falls back after key refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import ssh2, { type BaseAgent, type Connection } from 'ssh2';
import { Machines } from '../server/machines.ts';
import { OwnedForwardAgent } from '../server/ssh-agent-scope.ts';

const { Server } = ssh2;
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an owned forwarding Agent never authenticates the instance root login or falls back after key refusal
 * 状态影响 / State effects: `agent.getIdentities`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export`, `generateKeyPairSync`, `server.address`, `Object.create`.
 * 检查边界 / Checked boundaries: `assert.rejects(machine.connectOnce(live, Buffer.from(login), 5000, undefined, agent), /authentication/i)`; `assert.ok(publickeyAuth > 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an owned forwarding Agent never authenticates the instance root login or falls back after key refusal', async () => {
  const host = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const login = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const clients = new Set<Connection>();
  let agentAuth = 0, publickeyAuth = 0;
  const agent = new OwnedForwardAgent('only-a-unit-fixture-no-real-agent', new AbortController().signal);
  agent.getIdentities = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: callback。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: an owned forwarding Agent never authenticates the instance root login or falls back after key refusal
   * 协作入口 / Collaborators: `callback`.
   */
  callback => { ++agentAuth; callback(new Error('must not authenticate root with forwarding credentials')); };
  const server = new Server({ hostKeys: [host] }, client => {
    clients.add(client); client.on('error', () => {}); client.once('close', () => clients.delete(client));
    client.on('authentication', context => { if (context.method === 'publickey') ++publickeyAuth; context.reject(['publickey']); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const live = { sshPort: (server.address() as { port: number }).port, clients: new Set() };
  const machine = Object.create(Machines.prototype) as { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: live: unknown; key: Buffer; timeout: number; signal: AbortSignal; agent: BaseAgent。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  connectOnce(live: unknown, key: Buffer,
    timeout: number, signal?: AbortSignal, agent?: BaseAgent): Promise<unknown> };
  try {
    await assert.rejects(machine.connectOnce(live, Buffer.from(login), 5000, undefined, agent), /authentication/i);
    assert.ok(publickeyAuth > 0); assert.equal(agentAuth, 0);
  } finally {
    await agent.close();
    for (const client of clients) client.end();
    const closed = once(server, 'close'); server.close(); await closed;
  }
});
