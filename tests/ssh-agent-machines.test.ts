import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import ssh2, { type BaseAgent, type Connection } from 'ssh2';
import { Machines } from '../server/machines.ts';
import { OwnedForwardAgent } from '../server/ssh-agent-scope.ts';

const { Server } = ssh2;
test('an owned forwarding Agent never authenticates the instance root login or falls back after key refusal', async () => {
  const host = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const login = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const clients = new Set<Connection>();
  let agentAuth = 0, publickeyAuth = 0;
  const agent = new OwnedForwardAgent('only-a-unit-fixture-no-real-agent', new AbortController().signal);
  agent.getIdentities = callback => { ++agentAuth; callback(new Error('must not authenticate root with forwarding credentials')); };
  const server = new Server({ hostKeys: [host] }, client => {
    clients.add(client); client.on('error', () => {}); client.once('close', () => clients.delete(client));
    client.on('authentication', context => { if (context.method === 'publickey') ++publickeyAuth; context.reject(['publickey']); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const live = { sshPort: (server.address() as { port: number }).port, clients: new Set() };
  const machine = Object.create(Machines.prototype) as { connectOnce(live: unknown, key: Buffer,
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
