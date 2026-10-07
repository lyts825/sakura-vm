/** HA 烟雾验证的独立目标服务进程，启动生产接收器、公开配对与来宾应用观测，并响应关闭指令。
 * Run the independent target service for HA smoke checks, exposing production receiver pairing/guest observations and controlled shutdown. */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import assert from 'node:assert/strict';
import { randomUUID, X509Certificate } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import { cpus, freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { z } from 'zod';

if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR)
  process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { Bundles } = await import('../server/bundles.ts');
const { createHostImportReceiver } = await import('../server/host-import-receiver.ts');
const { SessionLock } = await import('../server/session-lock.ts');
const { freePort } = await import('../server/qmp.ts');

type Request = { id: number; action: 'grant' | 'inspect' | 'ready' | 'write' | 'http' | 'stop' | 'lock' | 'shutdown';
  requesterId?: string; targetVmId?: string };
/** 经父子 IPC 返回关联请求结果；没有 IPC 连接时可选调用不产生额外发送。
 * Return correlated results over parent/child IPC; an absent IPC channel produces no additional send. */
const send = (payload: unknown) => process.send?.(payload);
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let machines: InstanceType<typeof Machines> | undefined;
let peers: InstanceType<typeof HostPeers> | undefined;
let application: Server | undefined;
let session: InstanceType<typeof SessionLock> | undefined;
let work: Promise<unknown> = Promise.resolve();
let closing: Promise<void> | undefined;
const appToken = process.env.SAKURA_HA_TEST_APP_TOKEN!;
assert.match(appToken, /^[a-f0-9]{64}$/);

/** 校验实例 UUID，在来宾查询回环应用健康接口并严格解析 ready/marker/bootId/pid；执行失败或响应形状异常均拒绝。
 * Validate the VM UUID, query its loopback application and strictly parse ready/marker/bootId/pid; execution failures or malformed responses reject. */
async function guestHttp(id: string) {
  z.uuid().parse(id);
  const result = await machines!.exec(id,
    `python3 -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:18080/health", timeout=3).read().decode())'`,
    10_000);
  if (result.code !== 0) throw new Error(result.stderr || 'Guest HTTP application unavailable');
  return z.object({ ready: z.boolean(), marker: z.string(), bootId: z.uuid(), pid: z.number().int() })
    .strict().parse(JSON.parse(result.stdout));
}

/** 复用唯一关闭 Promise，先停 HTTPS 观测入口，再释放实例、对等主机、会话锁和运行时，防止重复关闭交错。
 * Reuse one shutdown promise, stopping HTTPS observations before closing machines/peers/session/runtime to avoid interleaved duplicate teardown. */
function close() {
  return closing ||= (async () => {
    if (application?.listening) await new Promise<void>((done) => application!.close(() => done()));
    await machines?.close(); await peers?.close(); await session?.close(); await engine?.runtime.close();
  })();
}

try {
  engine = await createRuntime(); machines = new Machines(engine); await machines.init();
  /** 返回此目标进程的主机资源和当前实例计数，供真实对等监听器报告；不启动或修改实例。
   * Report target host resources and current VM counts for the real peer listener without starting or mutating VMs. */
  const status = async () => ({ platform: process.platform, arch: process.arch,
    cpus: cpus().length, memoryTotal: totalmem(), memoryFree: freemem(), load: [0, 0, 0],
    vmCount: machines!.records.size, runningVms: machines!.live.size });
  const port = await freePort(), file = join(process.env.SAKURA_DATA_DIR!, 'target-peer.json');
  peers = new HostPeers(status, file, 'HA integration target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {}); await peers.init(false);
  await peers.configure({ operation: 'listener', listener: { enabled: true, host: '127.0.0.1', port } });
  await peers.close(); peers = new HostPeers(status, file, 'HA integration target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {}); await peers.init(true);
  const bundles = new Bundles(machines);
  session = new SessionLock(); await session.init(false);
  peerHandlers.set(peers, { ...peerHandlers.get(peers), importReceiver: createHostImportReceiver(machines, { /** 提供已初始化的目标 Bundles 实例给接收器，按需解析依赖而不创建第二份状态。
 * Provide the initialized target Bundles instance to the receiver, resolving the dependency on demand without duplicating state. */ bundles: () => bundles,
    /** 本隔离 HA 场景没有额外迁移阻塞，返回 false；真实会话锁检查仍由独立入口执行。
     * Return false because this isolated HA scenario adds no migration block; the separate callback still enforces the real session lock. */
    migrationBlocked: () => false,
    /** 委托目标会话锁检查控制面是否解锁，锁定时抛错阻断接收器的敏感操作。
     * Delegate to the target session lock, throwing while locked to block sensitive receiver operations. */
    requireSessionUnlocked: () => session!.requireUnlocked() }) });
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60_000), notAfterDate: new Date(Date.now() + 3600_000) });
  application = createServer({ cert: cert.cert, key: cert.private }, (req, res) => void (/** 受应用令牌保护的健康端点只检查精确 VM 的就绪标记；来宾访问或协议校验失败返回 503，避免把进程存在误作业务就绪。
 * The application-token-protected health endpoint checks readiness markers for the exact VM; guest access/protocol failures return 503 instead of treating process existence as application readiness. */ async () => {
    try {
      if (req.headers.authorization !== `Bearer ${appToken}`) {
        res.writeHead(401); res.end(); return;
      }
      const url = new URL(req.url!, 'https://localhost');
      assert.equal(req.method, 'GET'); assert.equal(url.pathname, '/health');
      const id = z.uuid().parse(url.searchParams.get('vmId'));
      let ready = false;
      if (machines!.state(id) === 'running')
        ready = await guestHttp(id).then((value) => value.ready &&
          ['historical-ha-data', 'target-only-write'].includes(value.marker), () => false);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ready, vmId: id }));
    } catch { res.writeHead(503); res.end(); }
  })());
  await new Promise<void>((done) => application!.listen(0, '127.0.0.1', done));
  const address = application.address(); assert.ok(address && typeof address !== 'string');
  const code = await peers.configure({ operation: 'create-code' }); assert.ok('pairing' in code && code.pairing);
  send({ type: 'ready', port, fingerprint: peers.view().fingerprint, hostId: peers.view().hostId,
    code: code.pairing.value, applicationUrl: `https://127.0.0.1:${address.port}/health`,
    applicationFingerprint: new X509Certificate(cert.cert).fingerprint256 });
  process.on('message', /** 把父进程 IPC 请求追加到串行工作链，避免授权、锁定、写入和停机交叠；请求 ID 随成功/失败回应回传，shutdown 在清理后断开。
 * Queue parent IPC requests on one work chain so grants, locking, writes and shutdown do not overlap; echo request IDs in success/failure replies and disconnect only after shutdown cleanup. */ (raw: Request) => {
    work = work.then(/** 按 action 执行接管授权、控制面锁定、精确目标检查及来宾写入；检查中验证普通 start 受限，异常转成当前 ID 的失败回应，不中断后续队列。
 * Execute grants, control-plane locking, exact-target inspection and guest writes by action; inspection proves ordinary start is denied, while exceptions become failed replies for this ID without breaking later queued work. */ async () => {
      try {
        let result: unknown;
        if (raw.action === 'grant') {
          const inbound = peers!.view().incoming.find((item) => item.requesterId === raw.requesterId);
          assert.ok(inbound);
          await peers!.configure({ operation: 'allow-import', id: inbound.id, enabled: true });
          await peers!.configure({ operation: 'allow-failover', id: inbound.id, enabled: true });
        } else if (raw.action === 'lock') {
          await session!.configure({ enabled: true, idleMinutes: 240, newPassword: randomUUID() });
          result = session!.lock(); assert.equal(session!.view().locked, true);
          assert.throws(() => session!.requireUnlocked(), /控制面已锁定/);
        }
        else if (raw.action === 'inspect') {
          const id = z.uuid().parse(raw.targetVmId), vm = machines!.get(id);
          let ordinaryStartDenied = false;
          try { await machines!.start(id); } catch { ordinaryStartDenied = true; }
          result = { status: machines!.state(id), ordinaryStartDenied,
            retired: !!vm.haRetirement, origin: vm.migrationOrigin,
            ...(machines!.state(id) === 'running' ? { application: await guestHttp(id) } : {}) };
        } else if (raw.action === 'ready') {
          const response = await machines!.exec(z.uuid().parse(raw.targetVmId), 'touch /workspace/ha-ready', 10_000);
          assert.equal(response.code, 0, response.stderr);
        } else if (raw.action === 'write') {
          const response = await machines!.exec(z.uuid().parse(raw.targetVmId),
            'printf target-only-write > /workspace/ha-data; sync', 10_000);
          assert.equal(response.code, 0, response.stderr);
        } else if (raw.action === 'http') result = await guestHttp(z.uuid().parse(raw.targetVmId));
        else if (raw.action === 'stop') await machines!.stop(z.uuid().parse(raw.targetVmId), true);
        else if (raw.action === 'shutdown') {
          await close(); send({ id: raw.id, ok: true }); process.disconnect(); return;
        } else throw new Error('Unknown worker action');
        send({ id: raw.id, ok: true, result });
      } catch (error) { send({ id: raw.id, ok: false, error: (error as Error).message }); }
    });
  });
  process.once('disconnect', () => void work.finally(close));
} catch (error) {
  send({ type: 'error', error: (error as Error).stack }); await close(); process.disconnect(); process.exitCode = 1;
}
