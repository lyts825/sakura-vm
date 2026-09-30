import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-project-tunnel-vm-'));
process.env.SAKURA_DATA_DIR = directory;
const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro]);
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ReverseTunnels } = await import('../server/reverse-tunnels.ts');
const { ExtendedFeatures } = await import('../server/extended-features.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines), tunnels = new ReverseTunnels(machines, workspaces);
const extended = new ExtendedFeatures(machines, workspaces);

async function exchange(port: number, bytes: Buffer | string, halfClose = false) {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1'), chunks: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error('TCP exchange timed out')), 15000);
    socket.once('connect', () => halfClose ? socket.end(bytes) : socket.write(bytes));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
  });
}

try {
  const vm = await machines.create({ name: 'project-tunnel-smoke', distro, memoryMiB: 1024, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const tools = await machines.exec(vm.id,
    'command -v python3 >/dev/null || { if command -v apk >/dev/null; then apk add --no-cache python3; else apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3; fi; }', 180000);
  assert.equal(tools.code, 0, tools.stdout + tools.stderr);
  await workspaces.save(vm.id, { directory: '/workspace/host' });
  const alpha = (await workspaces.projects.create(vm.id, 'Alpha', async () => {
    await workspaces.save(vm.id, { directory: '/workspace/alpha', networkIsolation: 'private' });
  })).active;
  const beta = (await workspaces.projects.create(vm.id, 'Beta', async () => {
    await workspaces.save(vm.id, { directory: '/workspace/beta', networkIsolation: 'private' });
  })).active;
  const scope = <T>(project: string, action: () => Promise<T>) => workspaces.projects.with(vm.id, project, action);
  const host = await tunnels.open(vm.id, 8765, 60);
  const first = await scope(alpha, () => tunnels.open(vm.id, 8765, 60));
  const second = await scope(beta, () => tunnels.open(vm.id, 8765, 60));
  assert.equal(first.projectId, alpha); assert.equal(second.projectId, beta);
  assert.equal(first.networkIsolation, 'private');
  assert.equal(new Set([host.localPort, first.localPort, second.localPort]).size, 3);
  const source = `import os,socket,sys,threading
server=socket.socket()
server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
server.bind(('127.0.0.1',8765))
server.listen(8)
def serve(conn):
    try:
        data=b''
        while b'\\n' not in data:
            part=conn.recv(65536)
            if not part: return
            data+=part
        mode,data=data.split(b'\\n',1)
        if mode==b'who':
            conn.sendall((sys.argv[1]+'|'+os.readlink('/proc/self/ns/net')).encode())
        elif mode==b'binary':
            while True:
                part=conn.recv(65536)
                if not part: break
                data+=part
            conn.sendall(data)
        elif mode==b'hold':
            conn.sendall(b'ready\\n')
            while True:
                data=conn.recv(65536)
                if not data: break
                conn.sendall(data)
    finally: conn.close()
while True:
    conn,_=server.accept()
    threading.Thread(target=serve,args=(conn,),daemon=True).start()
`;
  await machines.writeGuestFile(vm.id, '/tmp/sakura-project-tunnel-server.py', source);
  const namespaces = new Map<string, string>();
  for (const project of ['default', alpha, beta]) {
    const prefix = project === 'default' ? '' : `ip netns exec sk-${project} `;
    const launch = await machines.exec(vm.id,
      `nohup ${prefix}python3 -I -S /tmp/sakura-project-tunnel-server.py ${project} >/tmp/sakura-tunnel-${project}.log 2>&1 </dev/null & echo $!`);
    assert.equal(launch.code, 0, launch.stderr);
    namespaces.set(project, (await machines.exec(vm.id, `${prefix}readlink /proc/self/ns/net`)).stdout.trim());
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const checked = await machines.exec(vm.id, `${prefix}python3 -I -S -c "import socket;socket.create_connection(('127.0.0.1',8765),1).close()"`);
      if (checked.code === 0) { ready = true; break; } await delay(100);
    }
    assert.ok(ready, await machines.readGuestFile(vm.id, `/tmp/sakura-tunnel-${project}.log`));
  }
  assert.notEqual(namespaces.get(alpha), namespaces.get(beta));
  assert.notEqual(namespaces.get(alpha), namespaces.get('default'));
  for (const [project, opened] of [['default', host], [alpha, first], [beta, second]] as const)
    assert.equal((await exchange(opened.localPort, 'who\n')).toString(), `${project}|${namespaces.get(project)}`);
  await assert.rejects(scope(alpha, () => workspaces.save(vm.id,
    { directory: '/workspace/alpha', networkIsolation: 'host' })), /先关闭.*隧道/);
  await assert.rejects(scope(alpha, () => workspaces.save(vm.id,
    { directory: '/workspace/changed', networkIsolation: 'private' })), /先关闭.*隧道/);
  assert.equal(await tunnels.stop(vm.id), true);
  assert.equal(tunnels.status(vm.id).active, false);
  assert.equal((await scope(alpha, async () => tunnels.status(vm.id))).active, true);
  await assert.rejects(exchange(host.localPort, 'who\n'));
  const payload = Buffer.alloc(256 * 1024, 137);
  assert.deepEqual(await exchange(first.localPort, Buffer.concat([Buffer.from('binary\n'), payload]), true), payload);
  const idle = connect(second.localPort, '127.0.0.1');
  idle.on('error', () => {}); await once(idle, 'connect', { signal: AbortSignal.timeout(15000) });
  const acknowledged = once(idle, 'data', { signal: AbortSignal.timeout(15000) }); idle.write('hold\n');
  assert.equal((await acknowledged)[0].toString(), 'ready\n');
  await delay(6000);
  const echoed = once(idle, 'data', { signal: AbortSignal.timeout(15000) }); idle.write('after idle');
  assert.equal((await echoed)[0].toString(), 'after idle'); idle.destroy();
  assert.equal((await machines.exec(vm.id, `ip -n sk-${alpha} route add blackhole 203.0.113.0/24`)).code, 0);
  assert.equal((await exchange(first.localPort, 'who\n')).length, 0, 'a changed route must refuse the connection');
  assert.equal((await machines.exec(vm.id, `ip -n sk-${alpha} route del blackhole 203.0.113.0/24`)).code, 0);
  assert.equal((await exchange(first.localPort, 'who\n')).toString(), `${alpha}|${namespaces.get(alpha)}`);
  await scope(alpha, () => tunnels.stop(vm.id));
  const abort = new AbortController();
  const independent = await scope(alpha, () => tunnels.open(vm.id, 8765, 60, abort.signal));
  abort.abort();
  assert.equal((await exchange(independent.localPort, 'who\n')).toString(), `${alpha}|${namespaces.get(alpha)}`,
    'cancelling a completed request does not cancel the tunnel lifetime');
  await scope(alpha, () => tunnels.stop(vm.id));
  const run = async (project: string, mode: string) => {
    const job = await scope(project, () => extended.action(vm.id, { action: 'run', featureId: 'reverse-tunnel',
      options: mode === 'open' ? { mode, guestPort: 8765, durationSeconds: 10 } : { mode } })) as { key: string; id: string };
    await extended.jobs.wait(job.key);
    assert.equal(extended.jobs.view(job.key)?.status, 'done');
    return extended.jobs.result(job.id) as Promise<Record<string, unknown>>;
  };
  const job = await run(alpha, 'open');
  assert.equal(job.projectId, alpha);
  assert.equal((await exchange(Number(job.localPort), 'who\n')).toString(), `${alpha}|${namespaces.get(alpha)}`);
  assert.equal((await run(beta, 'close')).closed, false);
  assert.equal((await exchange(Number(job.localPort), 'who\n')).toString(), `${alpha}|${namespaces.get(alpha)}`);
  await delay(10300);
  await assert.rejects(exchange(Number(job.localPort), 'who\n'));
  await machines.suspend(vm.id);
  await assert.rejects(exchange(second.localPort, 'who\n'));
  assert.equal((await scope(beta, async () => tunnels.status(vm.id))).active, false);
  console.log(`Real ${distro} project TCP tunnels verified three same-port namespaces, project jobs and configuration guards, binary half-close, idle connections, route rejection, independent lifetime, expiry and pause revocation.`);
} finally {
  await extended.close(); await tunnels.close(); await workspaces.close(); await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-project-tunnel-vm-'));
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
