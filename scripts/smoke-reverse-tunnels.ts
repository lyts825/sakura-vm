import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { reverseSmokeKernel, reverseSmokeReceiver, withOwnedReverseSmoke } from './reverse-identity-smoke-support.ts';

const selected = process.argv.find((value, index) => index > 1 && !value.startsWith('--')) || 'alpine';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(selected));
const distro = selected as 'alpine' | 'debian' | 'ubuntu';

async function exchange(port: number, bytes: Buffer | string, halfClose = false) {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1'), chunks: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error('TCP exchange timed out')), 15000);
    socket.once('connect', () => halfClose ? socket.end(bytes) : socket.write(bytes));
    socket.on('data', (chunk) => chunks.push(chunk)); socket.once('error', reject);
    socket.once('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
  });
}

if (process.argv.includes('--validate-only')) {
  console.log(JSON.stringify({ kind: 'reverse-tunnel', distro, vmStarted: false, source: 'formal public ExtendedFeatures action',
    durableManagers: 1, dependencies: ['fixed administrator python3', 'fixed administrator tmux'],
    migration: 'explicit mkdir and reviewed preview/apply for default plus two named projects',
    fixture: 'fresh owned and retained', observerBytes: Buffer.byteLength(reverseSmokeKernel),
    rootTestReceiverBytes: Buffer.byteLength(reverseSmokeReceiver), nativeCleanup: 'full original service domain before VM shutdown' }));
} else await withOwnedReverseSmoke(distro, async ({ machines, workspaces, vmId, alpha, beta, directories,
  namespaces, job, prove, stopped, scope, recordCase }) => {
  const host = await job('default', 'open'), hostRecord = await prove('default');
  const first = await job(alpha, 'open'), firstRecord = await prove(alpha);
  const second = await job(beta, 'open'), secondRecord = await prove(beta);
  assert.equal(first.projectId, alpha); assert.equal(second.projectId, beta); assert.equal(first.networkIsolation, 'private');
  assert.equal(new Set([host.localPort, first.localPort, second.localPort]).size, 3);
  assert.notEqual(namespaces.get(alpha), namespaces.get(beta)); assert.notEqual(namespaces.get(alpha), namespaces.get('default'));
  for (const [project, opened] of [['default', host], [alpha, first], [beta, second]] as const)
    assert.equal((await exchange(opened.localPort, 'who\n')).toString(), `${project}|${namespaces.get(project)}`);
  await recordCase('three same-port namespaces through three actual UID brokers', { guestPort: 8765, localPorts: [host.localPort, first.localPort, second.localPort] });

  await assert.rejects(scope(alpha, () => workspaces.save(vmId, { directory: directories.get(alpha)!, networkIsolation: 'host' })), /先关闭.*隧道/);
  await assert.rejects(scope(alpha, () => workspaces.save(vmId, { directory: directories.get(alpha)! + '-changed', networkIsolation: 'private' })), /先关闭.*隧道/);
  assert.equal((await job('default', 'close')).closed, true); await stopped(hostRecord);
  assert.equal((await job('default', 'status')).active, false); assert.equal((await job(alpha, 'status')).active, true);
  await assert.rejects(exchange(host.localPort, 'who\n'));
  await recordCase('configuration guards and project-specific whole-domain stop');

  const payload = Buffer.alloc(256 * 1024); for (let index = 0; index < payload.length; index++) payload[index] = index & 255;
  assert.deepEqual(await exchange(first.localPort, Buffer.concat([Buffer.from('binary\n'), payload]), true), payload);
  await recordCase('256 KiB binary with NUL and all octets, half-close and complete response EOF', { bytes: payload.length });

  const idle = connect(second.localPort, '127.0.0.1'); idle.on('error', () => {});
  try {
    await once(idle, 'connect', { signal: AbortSignal.timeout(15000) });
    const acknowledged = once(idle, 'data', { signal: AbortSignal.timeout(15000) }); idle.write('hold\n');
    assert.equal((await acknowledged)[0].toString(), 'ready\n'); await delay(6000);
    const echoed = once(idle, 'data', { signal: AbortSignal.timeout(15000) }); idle.write('after idle');
    assert.equal((await echoed)[0].toString(), 'after idle');
  } finally { idle.destroy(); }
  await recordCase('idle connection remains usable after six seconds');

  const fixedRoot = 'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ';
  let route = false;
  try {
    assert.equal((await machines.exec(vmId, fixedRoot + `ip -n sk-${alpha} route add blackhole 203.0.113.0/24`)).code, 0); route = true;
    assert.equal((await exchange(first.localPort, 'who\n')).length, 0, 'Changed route must refuse a new bridge');
  } finally { if (route) assert.equal((await machines.exec(vmId, fixedRoot + `ip -n sk-${alpha} route del blackhole 203.0.113.0/24`)).code, 0); }
  assert.equal((await exchange(first.localPort, 'who\n')).toString(), `${alpha}|${namespaces.get(alpha)}`);
  await recordCase('route change rejects a connection and restored original route works');

  assert.equal((await job(alpha, 'close')).closed, true); await stopped(firstRecord);
  const abort = new AbortController(), independent = await job(alpha, 'open', 300, abort.signal), independentRecord = await prove(alpha);
  abort.abort();
  assert.equal((await exchange(independent.localPort, 'who\n')).toString(), `${alpha}|${namespaces.get(alpha)}`,
    'Cancelling a completed public request does not cancel its independent tunnel lifetime');
  assert.equal((await job(alpha, 'close')).closed, true); await stopped(independentRecord);
  await recordCase('completed public request signal does not own tunnel lifetime');

  // One public owner means closing Beta really closes its current tunnel. Prove
  // that original domain closed, then exercise a no-op Beta close while Alpha
  // remains live; reopening Beta provides the later pause case.
  assert.equal((await job(beta, 'close')).closed, true); await stopped(secondRecord);
  const expiring = await job(alpha, 'open', 10), expiringRecord = await prove(alpha);
  assert.equal(expiring.projectId, alpha);
  assert.equal((await exchange(expiring.localPort, 'who\n')).toString(), `${alpha}|${namespaces.get(alpha)}`);
  assert.equal((await job(beta, 'close')).closed, false);
  assert.equal((await exchange(expiring.localPort, 'who\n')).toString(), `${alpha}|${namespaces.get(alpha)}`);
  await recordCase('public project jobs and no-op close preserve the other project', { expirySeconds: 10 });
  await delay(Math.max(0, Date.parse(expiringRecord.expiresAt) - Date.now()) + 300);
  await assert.rejects(exchange(expiring.localPort, 'who\n'));
  // Timer revocation alone cannot prove native closure. Explicit original-owner
  // close joins any pending timer stop before the whole-domain assertions.
  await job(alpha, 'close'); await stopped(expiringRecord);
  await recordCase('expiry closes the original service domain and native/host ticket');

  const paused = await job(beta, 'open'), pausedRecord = await prove(beta), originalLive = machines.live.get(vmId);
  await machines.suspend(vmId); await assert.rejects(exchange(paused.localPort, 'who\n'));
  assert.equal((await job(beta, 'status')).active, false);
  await recordCase('pause immediately revokes the host loopback entry');
  // Resume the same live, then retire exactly the pre-pause service receipt.
  // Shutdown would remove processes without confirming native ticket closure.
  await machines.resume(vmId); assert.equal(machines.live.get(vmId), originalLive);
  await job(beta, 'close'); await stopped(pausedRecord);
  assert.equal((await job(beta, 'status')).active, false);
  await recordCase('resume original VM and confirm complete pre-pause native cleanup before shutdown');
  console.log(`Real ${distro} UID project TCP tunnel cases passed; final own VM and ticket cleanup follows.`);
});
