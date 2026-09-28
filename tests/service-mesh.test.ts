import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ServiceMesh, envoySidecarConfig, serviceMeshInput } from '../server/service-mesh.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

test('Envoy sidecar policy is project scoped, validated, launched and stopped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-mesh-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  const vmId = '11111111-1111-4111-8111-111111111111';
  let projectId = 'default',
    running = false,
    guestRunning = false,
    envoy = true;
  let networkIsolation: 'host' | 'private' = 'host';
  const commands: string[] = [];
  const machines = {
    get: () => ({ id: vmId }),
    state: () => (guestRunning ? 'running' : 'stopped'),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('tmux new-session')) {
        assert.match(command, /envoy --mode validate/);
        const encoded = /printf '%s' '([A-Za-z0-9+/=]+)'/.exec(command)?.[1];
        assert.ok(encoded);
        const config = JSON.parse(Buffer.from(encoded, 'base64').toString());
        assert.equal(config.static_resources.listeners[0].address.socket_address.address, '127.0.0.1');
        assert.equal(config.static_resources.listeners[0].address.socket_address.port_value, 15001);
        assert.equal(
          config.static_resources.clusters[0].load_assignment.endpoints[0].lb_endpoints[0].endpoint.address
            .socket_address.port_value,
          8080,
        );
        assert.equal(config.admin, undefined);
        running = true;
        return { code: 0, stdout: '', stderr: '' };
      }
      if (command.includes('tmux kill-session')) {
        running = false;
        return { code: 0, stdout: '', stderr: '' };
      }
      return {
        code: 0,
        stdout: `ENVOY=${envoy ? '/usr/bin/envoy' : ''}\nTMUX=/usr/bin/tmux\nRUNNING=${running ? 'yes' : 'no'}\n${envoy ? 'envoy 1.31' : ''}\n`,
        stderr: '',
      };
    },
  } as unknown as Machines;
  const workspaces = { projects: { current: () => projectId },
    config: async () => ({ networkIsolation }) } as unknown as Workspaces;
  const file = join(root, 'mesh.json');
  const policy = { name: 'frontend', listenPort: 15001, upstreamPort: 8080 };
  const mesh = new ServiceMesh(machines, workspaces, file);
  try {
    await mesh.init();
    assert.equal((await mesh.action(vmId, { mode: 'save', policy }, 'check')).ready, true);
    assert.equal((await mesh.action(vmId, { mode: 'save', policy }, 'run')).ready, true);
    assert.equal((await mesh.status(vmId)).policy?.name, 'frontend');
    guestRunning = true;
    envoy = false;
    await assert.rejects(mesh.action(vmId, { mode: 'start' }, 'run'), /Envoy/);
    envoy = true;
    const started = await mesh.action(vmId, { mode: 'start' }, 'run');
    assert.equal(started.sidecarRunning, true);
    assert.equal(started.executed, true);
    await assert.rejects(mesh.assertNoRunning(vmId), /停止所有项目/);
    await assert.rejects(mesh.action(vmId, { mode: 'save', policy }, 'run'), /先停止/);
    await mesh.action(vmId, { mode: 'stop' }, 'run');
    assert.equal((await mesh.status(vmId)).sidecarRunning, false);
    networkIsolation = 'private';
    assert.equal((await mesh.status(vmId)).ready, false);
    await assert.rejects(mesh.action(vmId, { mode: 'start' }, 'run'), /私有项目网络/);
    networkIsolation = 'host';

    projectId = '0123456789abcdef';
    assert.equal((await mesh.status(vmId)).policy, null);
    await assert.rejects(mesh.action(vmId, { mode: 'save', policy }, 'run'), /端口已由/);
    await mesh.action(vmId, { mode: 'save', policy: { ...policy, listenPort: 15002 } }, 'run');
    await mesh.close();
    const restored = new ServiceMesh(machines, workspaces, file);
    await restored.init();
    assert.equal((await restored.status(vmId)).policy?.listenPort, 15002);
    projectId = 'default';
    assert.equal((await restored.status(vmId)).policy?.listenPort, 15001);
    await restored.action(vmId, { mode: 'remove' }, 'run');
    assert.equal((await restored.status(vmId)).policy, null);
    await restored.close();
    assert.ok(commands.some((command) => command.includes('tmux new-session')));
  } finally {
    await mesh.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('sidecar schema only accepts bounded loopback TCP port policies', () => {
  assert.equal(
    serviceMeshInput.safeParse({
      mode: 'save',
      policy: {
        name: 'api',
        listenPort: 15000,
        upstreamPort: 15000,
      },
    }).success,
    false,
  );
  assert.equal(
    serviceMeshInput.safeParse({
      mode: 'save',
      policy: {
        name: 'api;rm',
        listenPort: 15000,
        upstreamPort: 8080,
      },
    }).success,
    false,
  );
  const config = envoySidecarConfig({ name: 'api', listenPort: 15000, upstreamPort: 8080 });
  assert.ok(!JSON.stringify(config).includes('0.0.0.0'));
  assert.ok(!('admin' in config));
});
