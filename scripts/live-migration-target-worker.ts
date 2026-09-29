import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR)
  process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { LiveMigrationReceiver } = await import('../server/live-migration-receiver.ts');
const { freePort } = await import('../server/qmp.ts');
const { vmDir } = await import('../server/model.ts');

type Request = { id: number; action: 'grant' | 'inspect' | 'shutdown';
  requesterId?: string; targetVmId?: string };
const send = (payload: unknown) => process.send?.(payload);
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let machines: InstanceType<typeof Machines> | undefined;
let peers: InstanceType<typeof HostPeers> | undefined;
let work: Promise<unknown> = Promise.resolve();

async function close() {
  await machines?.close();
  await peers?.close();
  await engine?.runtime.close();
}

try {
  engine = await createRuntime();
  machines = new Machines(engine);
  await machines.init();
  const status = async () => ({ platform: process.platform, arch: process.arch,
    cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0], vmCount: machines!.records.size,
    runningVms: machines!.live.size });
  const port = await freePort();
  const peerFile = join(process.env.SAKURA_DATA_DIR!, 'target-peer.json');
  peers = new HostPeers(status, peerFile, 'Target');
  await peers.init(false);
  await peers.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port,
  } });
  await peers.close();
  peers = new HostPeers(status, peerFile, 'Target');
  await peers.init(true);
  const receiver = new LiveMigrationReceiver(machines, peers);
  peers.setLiveMigrationReceiver({
    prepare: (input) => receiver.prepare(input),
    complete: (input) => receiver.complete(input),
    abort: (input) => receiver.abort(input),
    status: (input) => Promise.resolve(receiver.status(input)),
  });
  const code = await peers.configure({ operation: 'create-code' });
  if (!('pairing' in code) || !code.pairing) throw new Error('Pairing code unavailable');
  send({ type: 'ready', port, fingerprint: peers.view().fingerprint,
    hostId: peers.view().hostId, code: code.pairing.value });
  process.on('message', (raw: Request) => {
    work = work.then(async () => {
      try {
        if (raw.action === 'grant') {
          const inbound = peers!.view().incoming.find((item) =>
            item.requesterId === raw.requesterId);
          if (!inbound) throw new Error('Paired source not found');
          await peers!.configure({ operation: 'allow-import', id: inbound.id, enabled: true });
          await peers!.configure({ operation: 'allow-activate', id: inbound.id, enabled: true });
          send({ id: raw.id, ok: true });
        } else if (raw.action === 'inspect') {
          const id = raw.targetVmId!;
          const vm = machines!.get(id);
          const marker = await machines!.exec(id, 'cat /tmp/sakura-migration-marker', 15_000);
          const projects = JSON.parse(await readFile(join(vmDir(id), 'projects.json'), 'utf8'));
          const project = JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8'));
          send({ id: raw.id, ok: true, result: { status: machines!.state(id),
            originStatus: vm.liveMigrationOrigin?.status, marker: marker.stdout.trim(),
            projectCommand: project.command, projectCount: projects.projects.length } });
        } else if (raw.action === 'shutdown') {
          await close();
          send({ id: raw.id, ok: true });
          process.exit(0);
        }
      } catch (error) { send({ id: raw.id, ok: false, error: String(error) }); }
    }).catch((error) => send({ id: raw.id, ok: false, error: String(error) }));
  });
} catch (error) {
  send({ type: 'error', error: String(error) });
  await close().catch(() => {});
  process.exitCode = 1;
}
