/** 烟雾验收：验证配对 TLS 在线迁移的 RAM 标记、项目配置、目标就绪和源 fencing。
 * Smoke acceptance for paired TLS migration of RAM markers/project config, target readiness and source fencing. */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-runner-smoke-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(process.cwd(), '.data', 'images', 'alpine-3.23.qcow2');
if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR)
  process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { LiveMigrationReceiver } = await import('../server/live-migration-receiver.ts');
const { LiveMigrationRunner } = await import('../server/live-migration-runner.ts');
const { createLiveMigrationCompletionPort } = await import('../server/live-migration-proof.ts');
const { vmDir } = await import('../server/model.ts');
const { freePort, qmp } = await import('../server/qmp.ts');
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let source: InstanceType<typeof Machines> | undefined;
let target: InstanceType<typeof Machines> | undefined;
let sourcePeers: InstanceType<typeof HostPeers> | undefined;
let targetPeers: InstanceType<typeof HostPeers> | undefined;
let sourceVmId: string | undefined;
let targetVmId: string | undefined;
try {
  engine = await createRuntime();
  source = new Machines(engine);
  target = new Machines(engine);
  await source.init();
  await target.init();
  /** 返回迁移夹具的固定资源与实例计数，供生产对等服务的状态接口，不影响真实迁移接收器。
   * Return fixed fixture resources/VM counts for the production peer-status interface without altering the real migration receiver. */
  const peerStatus = async () => ({ platform: process.platform, arch: process.arch,
    cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 1, runningVms: 0 });
  const port = await freePort();
  const targetFile = join(root, 'target-peer.json');
  targetPeers = new HostPeers(peerStatus, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await targetPeers.init(false);
  await targetPeers.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port,
  } });
  await targetPeers.close();
  targetPeers = new HostPeers(peerStatus, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await targetPeers.init(true);
  sourcePeers = new HostPeers(peerStatus, join(root, 'source-peer.json'), 'Source', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await sourcePeers.init(false);
  const code = await targetPeers.configure({ operation: 'create-code' });
  if (!('pairing' in code) || !code.pairing) throw new Error('Missing pairing code');
  await sourcePeers.configure({ operation: 'connect',
    url: `https://127.0.0.1:${port}/`,
    fingerprint: targetPeers.view().fingerprint, code: code.pairing.value });
  const inboundId = targetPeers.view().incoming[0].id;
  const outbound = sourcePeers.view().outbound[0];
  await targetPeers.configure({ operation: 'allow-import', id: inboundId, enabled: true });
  await targetPeers.configure({ operation: 'allow-activate', id: inboundId, enabled: true });
  const receiver = new LiveMigrationReceiver(target, targetPeers);
  peerHandlers.set(targetPeers, { ...peerHandlers.get(targetPeers), liveMigrationReceiver: {
    /** 将会话输入转发到生产接收器 prepare，返回预备票据并传播验证/资源失败。
     * Forward session input to production receiver prepare, returning its preparation receipt and propagating validation/resource failures. */
    prepare: (input) => receiver.prepare(input),
    /** 转发完成输入给生产接收器，使认证票据和所有权交接仍由正式实现验证。
     * Forward completion input to the production receiver so authenticated receipts/ownership transfer remain validated by the real implementation. */
    complete: (input) => receiver.complete(input),
    /** 转发指定会话的撤销输入，保持正式接收器的资源归属和阶段检查。
     * Forward abort input for the specified session, retaining production ownership/phase checks. */
    abort: (input) => receiver.abort(input),
    /** 调用 verifiedStatus 返回经验证会话状态，避免用夹具伪造迁移完成证据。
     * Call verifiedStatus for validated session state instead of fabricating completion evidence in the fixture. */
    status: (input) => receiver.verifiedStatus(input),
  } });
  const vm = await source.create({ name: 'migration-source', accelerator: 'tcg',
    memoryMiB: 256, cpus: 1, diskGiB: 2 });
  sourceVmId = vm.id;
  await source.start(vm.id);
  const bootDeadline = Date.now() + 120_000;
  while (source.state(vm.id) !== 'running') {
    if (Date.now() >= bootDeadline) throw new Error('Source guest did not become ready');
    await delay(500);
  }
  assert.equal((await source.exec(vm.id,
    'printf sakura-live-migration > /tmp/sakura-migration-marker', 15_000)).code, 0);
  const projectIndex = { active: 'default',
    projects: [{ id: 'default', name: '默认项目' }] };
  const projectConfig = { directory: '/workspace', command: 'printf migrated' };
  await writeFile(join(vmDir(vm.id), 'projects.json'), JSON.stringify(projectIndex));
  await writeFile(join(vmDir(vm.id), 'project.json'), JSON.stringify(projectConfig));
  let lastMigrationStatus = '';
  const tracedQmp = (/** 透明代理 QMP，打印状态变化和非查询命令，抑制重复 query-migrate 日志；错误记录后重抛，保持 QMP 原结果和超时。
 * Proxy QMP transparently, logging status transitions/nonquery commands while suppressing repeated query-migrate logs; log/rethrow errors and preserve QMP results/timeouts. */ async (qmpPort: number, command: string,
    args?: Record<string, unknown>, timeoutMs?: number) => {
    try {
      const result = await qmp(qmpPort, command, args, timeoutMs);
      if (!command.startsWith('query-')) console.log('Source QMP:', command);
      if (command === 'query-migrate') {
        const status = (result as { status?: string }).status || 'none';
        if (status !== lastMigrationStatus) {
          console.log('Source migration:', status);
          lastMigrationStatus = status;
        }
      }
      return result;
    } catch (error) {
      console.error('Source QMP failed:', command, String(error));
      throw error;
    }
  }) as typeof qmp;
  const runner = new LiveMigrationRunner(source, sourcePeers, tracedQmp, undefined,
    createLiveMigrationCompletionPort(source, () => sourcePeers!));
  let result: Awaited<ReturnType<typeof runner.run>>;
  try {
    result = await runner.run(vm.id, {
      targetHostId: outbound.remoteId, targetName: 'migration-target',
    }, undefined, (line) => process.stdout.write(line));
  } catch (error) {
    await delay(2000);
    console.error('Source QEMU:', source.state(vm.id),
      source.live.get(vm.id)?.qmpPort, source.get(vm.id).lastError,
      source.logs.get(vm.id)?.slice(-4000));
    for (const targetVm of target.records.values())
      console.error('Target QEMU:', target.state(targetVm.id),
        target.live.get(targetVm.id)?.qmpPort,
        target.logs.get(targetVm.id)?.slice(-4000));
    throw error;
  }
  targetVmId = result.targetVmId;
  assert.equal(result.ready, true);
  assert.equal(source.state(vm.id), 'stopped');
  assert.equal(source.get(vm.id).liveMigrationFence?.targetVmId, targetVmId);
  assert.equal(target.get(targetVmId).liveMigrationOrigin?.status, 'ready');
  assert.deepEqual(JSON.parse(await readFile(join(vmDir(targetVmId), 'projects.json'), 'utf8')),
    projectIndex);
  const transferredProject = JSON.parse(await readFile(join(vmDir(targetVmId),
    'project.json'), 'utf8')) as { command: string };
  assert.equal(transferredProject.command, projectConfig.command);
  const marker = await target.exec(targetVmId, 'cat /tmp/sakura-migration-marker', 15_000);
  assert.equal(marker.code, 0);
  assert.equal(marker.stdout.trim(), 'sakura-live-migration');
  console.log('A live Alpine guest retained its in-memory marker and Sakura project configuration through paired TLS migration; target SSH became ready and source QEMU stopped behind a durable fence.');
} finally {
  if (source && sourceVmId) await source.stop(sourceVmId, true).catch(() => {});
  if (target && targetVmId) await target.stop(targetVmId, true).catch(() => {});
  await source?.close();
  await target?.close();
  await sourcePeers?.close();
  await targetPeers?.close();
  await engine?.runtime.close();
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-runner-smoke-'))
    throw new Error('Refusing unexpected smoke cleanup path');
  await rm(resolved, { recursive: true, force: true });
}
