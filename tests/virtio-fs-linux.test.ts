import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, writeFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines } from '../server/machines.ts';

test('Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle',
  { skip: process.platform !== 'linux' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'sakura-vfs-test-'));
    const qemuDir = join(root, 'qemu');
    const share = join(root, 'share');
    await mkdir(qemuDir);
    await mkdir(share);
    const qemu = join(qemuDir, 'qemu-system-x86_64');
    const daemon = join(root, 'virtiofsd');
    await writeFile(qemu, `#!/usr/bin/env node
console.log(process.argv.includes('-device') ? 'vhost-user-fs-pci' : 'memory-backend-memfd');
`);
    await writeFile(daemon, `#!/usr/bin/env node
const { createServer } = require('node:net');
const { writeFileSync } = require('node:fs');
if (process.argv.includes('--version')) { console.log('virtiofsd test'); process.exit(0); }
const socket = process.argv[process.argv.indexOf('--socket-path') + 1];
writeFileSync(socket + '.args', JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }));
const server = createServer(() => {});
server.listen(socket);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
    await Promise.all([chmod(qemu, 0o755), chmod(daemon, 0o755)]);
    process.env.SAKURA_DATA_DIR = join(root, 'data');
    process.env.SAKURA_QEMU_DIR = qemuDir;
    process.env.SAKURA_VIRTIOFSD_PATH = daemon;
    const { VirtioFsShares } = await import('../server/virtio-fs.ts');
    const id = 'c3915729-d526-4c60-9224-df29862864f3';
    const vm = { id, memoryMiB: 512, architecture: 'x86_64' };
    const boot = {};
    let running = false, mounted = false;
    const commands: string[] = [];
    const machines = {
      records: new Map([[id, vm]]), live: new Map<string, object>(),
      get: () => vm,
      state: () => running ? 'running' : 'stopped',
      requireUnlocked: () => {},
      requireStopped: () => { if (running) throw Error('running'); },
      exec: async (_id: string, command: string) => {
        commands.push(command);
        if (command.startsWith('awk '))
          return { code: 0, stdout: mounted ? 'sakura-host|virtiofs\n' : '', stderr: '' };
        if (command.startsWith('mount -t virtiofs')) mounted = true;
        if (command.startsWith('umount ')) mounted = false;
        return { code: 0, stdout: '', stderr: '' };
      },
    } as unknown as Machines;
    const service = new VirtioFsShares(machines);
    try {
      await service.init();
      await service.action(id, { operation: 'configure',
        policy: { enabled: true, hostPath: share, readOnly: true } });
      running = true;
      machines.live.set(id, boot as never);
      const exits: string[] = [];
      const attachment = await machines.prepareBootAttachment!(vm as never,
        (error) => exits.push(error));
      assert.ok(attachment);
      const socketArgument = attachment.args[attachment.args.indexOf('-chardev') + 1];
      const socket = socketArgument.slice(socketArgument.indexOf('path=') + 5);
      assert.ok((await lstat(socket)).isSocket());
      assert.ok(attachment.args.includes('node,memdev=sakura-vfs-mem'));
      const sidecar = JSON.parse(await readFile(socket + '.args', 'utf8')) as
        { pid: number; args: string[] };
      const daemonArgs = sidecar.args;
      assert.ok(daemonArgs.includes('--readonly'));
      assert.equal(daemonArgs[daemonArgs.indexOf('--shared-dir') + 1], share);
      await service.action(id, { operation: 'mount' });
      assert.equal((await service.view(id)).mounted, true);
      assert.ok(commands.some((command) => command.includes('mount -t virtiofs -o ro')));
      await service.action(id, { operation: 'unmount' });
      assert.equal((await service.view(id)).policy.enabled, false);
      assert.equal(mounted, false);
      process.kill(sidecar.pid, 'SIGTERM');
      for (let attempt = 0; attempt < 50 && !exits.length; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(exits.length, 1);
      await attachment.close();
      await assert.rejects(lstat(socket), { code: 'ENOENT' });
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
