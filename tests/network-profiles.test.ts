import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Engine } from '../server/runtime';

const root = await mkdtemp(join(tmpdir(), 'sakura-network-test-'));
process.env.SAKURA_DATA_DIR = root;
const { NetworkProfiles, networkSchema } = await import('../server/network-profiles.ts');
const { Machines } = await import('../server/machines.ts');
const { createSchema } = await import('../server/model.ts');
const { textVersion } = await import('../server/files.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-network-test-'));
  await rm(root, { recursive: true, force: true });
});

function fixture(distro: 'alpine' | 'ubuntu' = 'alpine') {
  const id = randomUUID(),
    machines = new Machines({} as Engine);
  const record = {
    ...createSchema.parse({ name: 'network-test', distro, forwards: [{ host: 8080, guest: 80 }] }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  };
  machines.records.set(id, record);
  const files = new Map([
    ['/etc/profile.d/sakura-network.sh', '# original environment\n'],
    ['/etc/network/interfaces', 'auto eth0\niface eth0 inet static\n  address 10.0.2.15/24\n'],
    ['/etc/resolv.conf', 'search development.local\noptions timeout:2\nnameserver 10.0.2.3\n'],
    ['/etc/systemd/resolved.conf.d/90-sakura.conf', '# original resolver\n'],
    ['/etc/apt/apt.conf.d/90sakura-proxy', '// original proxy\n'],
  ]);
  machines.sftp = (async (_id: string, work: Function) =>
    work({
      lstat: (path: string, done: Function) =>
        files.has(path) ? done(null, { isFile: () => true }) : done({ code: 2 }),
    })) as InstanceType<typeof Machines>['sftp'];
  machines.readGuestFile = async (_id, path) => files.get(path)!;
  machines.writeGuestFile = async (_id, path, content, overwrite, version) => {
    assert.equal(overwrite, files.has(path));
    if (version) assert.equal(version, textVersion(files.get(path)!));
    files.set(path, content);
  };
  machines.exec = async () => ({ code: 0, stdout: '', stderr: '' });
  return { id, machines, record, files, network: new NetworkProfiles(machines) };
}

test('network archives persist reusable DNS and NAT settings and validate names and addresses', async () => {
  const { network, machines } = fixture();
  try {
    for (const config of [
      { dnsServers: ['8.8.8.8;reboot'] },
      { dnsServers: ['1.1.1.1', '1.1.1.1'] },
      {
        forwards: [
          { host: 8080, guest: 80 },
          { host: 8080, guest: 81 },
        ],
      },
    ])
      assert.equal(networkSchema.safeParse(config).success, false);
    const saved = await network.saveProfile({
      name: 'Office',
      config: { dnsServers: ['::1'], forwards: [{ host: 8081, guest: 80 }] },
    });
    const reloaded = new NetworkProfiles(machines);
    try {
      assert.deepEqual((await reloaded.profiles())[0], saved);
      await assert.rejects(reloaded.saveProfile({ name: 'office', config: {} }), /名称已存在/);
      await reloaded.saveProfile({ id: saved.id, name: 'Office 2', config: saved.config });
      assert.equal((await reloaded.profiles()).length, 1);
      await reloaded.removeProfile(saved.id);
      assert.deepEqual(await reloaded.profiles(), []);
    } finally {
      await reloaded.close();
    }
  } finally {
    await network.close();
  }
});

test('interrupted DNS and NAT apply survives restart and restores only unchanged files and port rules', async () => {
  const { network, machines, record, files, id } = fixture();
  const original = new Map(files),
    originalForwards = structuredClone(record.forwards);
  try {
    const preview = await network.preview(id, {
      dnsServers: ['1.1.1.1'],
      forwards: [{ host: 8090, guest: 22 }],
    });
    record.forwards = [{ host: 8091, guest: 80 }];
    await assert.rejects(network.apply(id, preview.config, preview.token), /重新预览/);
    record.forwards = originalForwards;
    const write = machines.writeGuestFile.bind(machines);
    machines.writeGuestFile = async (...args) => {
      if (args[1].includes('profile.d')) throw new Error('simulated SSH disconnect');
      return write(...args);
    };
    await assert.rejects(network.apply(id, preview.config, preview.token), /SSH disconnect/);
    assert.deepEqual(record.forwards, preview.forwards!.after);
    assert.match(files.get('/etc/resolv.conf')!, /1\.1\.1\.1/);
    assert.match(files.get('/etc/resolv.conf')!, /search development.local\noptions timeout:2/);
    await network.close();
    const restarted = new NetworkProfiles(machines);
    try {
      assert.equal((await restarted.state(id)).appliedAt, undefined);
      machines.writeGuestFile = write;
      record.forwards = [{ host: 8099, guest: 443 }];
      await assert.rejects(restarted.restore(id), /端口映射被外部修改/);
      assert.match(files.get('/etc/resolv.conf')!, /1\.1\.1\.1/);
      record.forwards = preview.forwards!.after;
      await restarted.restore(id);
      assert.deepEqual(files, original);
      assert.deepEqual(record.forwards, originalForwards);
      assert.equal((await restarted.state(id)).forwards, undefined);
    } finally {
      await restarted.close();
    }
  } finally {
    await network.close();
  }
});

test('resolved profiles reload and verify DNS, and failed reloads remain recoverable', async () => {
  const { network, machines, files, id } = fixture('ubuntu');
  let broken = false,
    reloads = 0;
  machines.exec = async (_id, command) => {
    if (command.includes('readlink'))
      return { code: 0, stdout: '/run/systemd/resolve/stub-resolv.conf\n', stderr: '' };
    if (command.includes('restart systemd-resolved')) {
      reloads++;
      return { code: broken ? 1 : 0, stdout: 'Global: 1.1.1.1\nLink 2 (eth0): 10.0.2.3', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  try {
    const preview = await network.preview(id, { dnsServers: ['1.1.1.1'] });
    broken = true;
    await assert.rejects(network.apply(id, preview.config, preview.token), /重新加载 DNS 失败/);
    assert.equal((await network.state(id)).dnsBackend, 'resolved');
    await assert.rejects(network.restore(id), /重新加载 DNS 失败/);
    assert.equal((await network.state(id)).changes.length, 0);
    assert.equal(files.get('/etc/systemd/resolved.conf.d/90-sakura.conf'), '# original resolver\n');
    broken = false;
    await network.restore(id);
    const next = await network.preview(id, preview.config);
    await network.apply(id, next.config, next.token);
    assert.ok((await network.state(id)).appliedAt);
    await network.restore(id);
    assert.equal(reloads, 5);
  } finally {
    await network.close();
  }
});

test('port rules reject stale expectations and roll back in-memory configuration when persistence fails', async () => {
  const { machines, record, id, network } = fixture();
  try {
    await assert.rejects(machines.setForwards(id, [], []), /端口映射已变化/);
    const before = structuredClone(record.forwards);
    (machines as any).save = async () => {
      throw new Error('disk full');
    };
    await assert.rejects(machines.setForwards(id, [], before), /disk full/);
    assert.deepEqual(record.forwards, before);
  } finally {
    await network.close();
  }
});
