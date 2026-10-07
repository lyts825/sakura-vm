/** 分布式在线迁移验证的目标进程，运行生产接收器并支持服务重启与目标实例/项目配置观测。
 * Run a separate production migration target process with controlled pairing/recovery/status/termination for distributed smoke verification. */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR)
  process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostPeers, isAuthenticatedMigrationCompletion } = await import('../server/host-peers.ts');
const { LiveMigrationReceiver, registerLiveMigrationTargetPort } = await import('../server/live-migration-receiver.ts');
const { freePort } = await import('../server/qmp.ts');
const { vmDir } = await import('../server/model.ts');

type Request = { id: number; action: 'grant' | 'inspect' | 'restart' | 'shutdown';
  requesterId?: string; targetVmId?: string };
/** 通过 IPC 向源侧返回 ready 或带请求 ID 的结果，供分布式迁移验证关联响应。
 * Send readiness or request-ID results over IPC for response correlation in distributed migration checks. */
const send = (payload: unknown) => process.send?.(payload);
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let machines: InstanceType<typeof Machines> | undefined;
let peers: InstanceType<typeof HostPeers> | undefined;
let work: Promise<unknown> = Promise.resolve();
let releaseTargetPort: (/** 保存本次目标端口预留的无参数释放器；停机调用后回收该预留，undefined 表示尚未取得资源。
 * Hold the zero-argument disposer for this target-port reservation; shutdown releases only the acquired reservation and undefined means none was acquired. */ () => void) | undefined;

/** 先关闭目标实例并撤销迁移端口注册，再关闭对等主机和运行时；保留顺序以使接收能力先失效。
 * Close target machines and revoke migration-port registration before peers/runtime so receiving authority expires first. */
async function close() {
  await machines?.close();
  releaseTargetPort?.();
  await peers?.close();
  await engine?.runtime.close();
}

/** 创建真实目标运行时、实例管理与认证迁移接收器；首启写入回环监听配置，重启复用落盘配置以验证恢复行为。
 * Create the real target runtime/machines/authenticated migration receiver; first start writes loopback listener settings, while restart reuses disk state to verify recovery. */
async function open(restart = false) {
  engine = await createRuntime();
  machines = new Machines(engine);
  await machines.init();
  releaseTargetPort = registerLiveMigrationTargetPort(machines, {
    /** 把接收器给定的实例 ID 和精确会话票据交给 Machines 绑定，结果与验证错误保持原样。
     * Forward VM ID and exact session receipt to Machines binding, preserving its result and validation errors. */
    bindSession: (id, receipt) => machines!.bindIncomingSession(id, receipt),
    /** 按实例与会话 ID 恢复生产接收记录，避免只根据实例名称认领其他迁移会话。
     * Recover production incoming state using VM and session IDs rather than claiming another migration session by VM name. */
    recover: (id, sessionId) => machines!.recoverIncoming(id, sessionId),
    authenticated: isAuthenticatedMigrationCompletion,
  });
  /** 向对等主机报告资源/实例计数；作为接收器成员时转发 verifiedStatus，返回经认证的会话状态。
   * Report resources/VM counts to peers; the receiver member forwards verifiedStatus to return authenticated session state. */
  const status = async () => ({ platform: process.platform, arch: process.arch,
    cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0], vmCount: machines!.records.size,
    runningVms: machines!.live.size });
  const peerFile = join(process.env.SAKURA_DATA_DIR!, 'target-peer.json');
  peers = new HostPeers(status, peerFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  if (!restart) {
    const port = await freePort();
    await peers.init(false);
    await peers.configure({ operation: 'listener', listener: { enabled: true, host: '127.0.0.1', port } });
    await peers.close();
    peers = new HostPeers(status, peerFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  }
  await peers.init(true);
  const receiver = new LiveMigrationReceiver(machines, peers);
  peerHandlers.set(peers, { ...peerHandlers.get(peers), liveMigrationReceiver: {
    /** 把输入交给生产接收器的预备阶段，建立真实会话和目标资源，拒绝结果向调用方传播。
     * Forward input to production receiver preparation, creating real session/target resources and propagating rejection. */
    prepare: (input) => receiver.prepare(input),
    /** 交给生产接收器完成阶段验证会话票据并交接目标所有权，保持其返回值和失败边界。
     * Delegate completion to the production receiver for receipt validation/target ownership transfer, preserving results and failure boundaries. */
    complete: (input) => receiver.complete(input),
    /** 转发精确会话输入以撤销该迁移接收资源；资源归属和可撤销阶段由生产接收器验证。
     * Forward exact session input to abort its receiving resources; the production receiver validates ownership and abortable phase. */
    abort: (input) => receiver.abort(input),
    /** 向对等主机报告资源/实例计数；作为接收器成员时转发 verifiedStatus，返回经认证的会话状态。
     * Report resources/VM counts to peers; the receiver member forwards verifiedStatus to return authenticated session state. */
    status: (input) => receiver.verifiedStatus(input),
  } });
}

try {
  await open();
  const code = await peers!.configure({ operation: 'create-code' });
  if (!('pairing' in code) || !code.pairing) throw new Error('Pairing code unavailable');
  send({ type: 'ready', port: peers!.view().listener.port, fingerprint: peers!.view().fingerprint,
    hostId: peers!.view().hostId, code: code.pairing.value });
  process.on('message', /** 将目标 worker 的 IPC 授权、检查、重启和停机串行排队，回应保留请求 ID；串行化避免旧服务关闭与新监听器启动发生竞争。
 * Serialize target-worker IPC grants, inspection, restart and shutdown while preserving request IDs in replies, preventing old-service closure from racing new listeners. */ (raw: Request) => {
    work = work.then(/** 按当前请求为配对来源启用导入/激活、读取迁移内存与持久标记及项目配置，或关闭后重建服务；失败返回当前 ID 的错误而不冒充成功。
 * For the current request grant import/activation to the paired source, inspect migration memory/persistent markers and project configuration, or close/rebuild services; return errors for this ID without claiming success. */ async () => {
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
          const persistent = await machines!.exec(id, 'cat /workspace/sakura-migration-marker', 15_000);
          const projects = JSON.parse(await readFile(join(vmDir(id), 'projects.json'), 'utf8'));
          const project = JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8'));
          send({ id: raw.id, ok: true, result: { status: machines!.state(id),
            originStatus: vm.liveMigrationOrigin?.status, marker: marker.stdout.trim(),
            persistentMarker: persistent.stdout.trim(), sessionId: vm.liveMigrationOrigin?.sessionId,
            projectCommand: project.command, projectCount: projects.projects.length } });
        } else if (raw.action === 'restart') {
          await close();
          await open(true);
          send({ id: raw.id, ok: true });
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
