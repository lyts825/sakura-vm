/**
 * 模块职责：通过 QMP 镜像磁盘并传输 QEMU 运行状态，跟踪迁移阶段与取消收尾。
 * Module purpose: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * 签名 / Signature: MigrationQmp.MigrationQmp.
 * 功能：为通过 QMP 镜像磁盘并传输 QEMU 运行状态声明 MigrationQmp 的输入与结果契约，所属容器为 MigrationQmp。
 * Purpose: Declares the input/result contract for MigrationQmp in MigrationQmp. Module responsibility: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
 * 输入 / Inputs: command: string; args: Record<string, unknown> optional; timeoutMs: number optional
 * 输出 / Returns: Promise<unknown>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export type MigrationQmp = (command: string, args?: Record<string, unknown>,
  timeoutMs?: number) => Promise<unknown>;

type Address = Record<string, unknown>;
/**
 * 入口 / Entry: requireLocalInet.
 * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`live-migration-transport.ts`）。
 * Purpose: Checks admission, input or resource ownership in `live-migration-transport.ts`; the calls and state transitions below complete the operation. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
 * 处理：通过 `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: address: Address; name: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `address.type !== 'inet' || data.host !== '127.0.0.1' || !/^[0-9]{1,5}$/.test(String(data.port)) || Number(data.port) < 1 || N…`; 异常 / errors `new Error(`${name} must use a loopback TCP port`)`.
 */
function requireLocalInet(address: Address, name: string) {
  const data = address.type === 'inet' && address.data &&
    typeof address.data === 'object' ? address.data as Address : address;
  if (address.type !== 'inet' || data.host !== '127.0.0.1' ||
      !/^[0-9]{1,5}$/.test(String(data.port)) ||
      Number(data.port) < 1 || Number(data.port) > 65535)
    throw new Error(`${name} must use a loopback TCP port`);
}

/**
 * 入口 / Entry: requireLocalMigrationUri.
 * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`live-migration-transport.ts`）。
 * Purpose: Checks admission, input or resource ownership in `live-migration-transport.ts`; the calls and state transitions below complete the operation. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
 * 处理：通过 `inline.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.exec`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: uri: string; name: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `inline.exec`.
 * 拒绝 / Refusals: 条件 / conditions `!match || Number(match[1]) < 1 || Number(match[1]) > 65535`; 异常 / errors `new Error(`${name} must use a loopback TCP port`)`.
 */
function requireLocalMigrationUri(uri: string, name: string) {
  const match = /^tcp:127\.0\.0\.1:([0-9]{1,5})$/.exec(uri);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535)
    throw new Error(`${name} must use a loopback TCP port`);
}

export type MirroredMigrationOptions = {
  source: MigrationQmp;
  target: MigrationQmp;
  sourceDiskNode: string;
  targetDiskNode: string;
  nbdListen: Address;
  nbdConnect: Address;
  nbdServerOptions?: Record<string, unknown>;
  nbdClientOptions?: Record<string, unknown>;
  incomingUri: string;
  outgoingUri: string;
  /** Must durably prevent a source restart before it returns. */
  /**
   * 签名 / Signature: MirroredMigrationOptions.fenceSource.
   * 功能：为通过 QMP 镜像磁盘并传输 QEMU 运行状态声明 fenceSource 的输入与结果契约，所属容器为 MirroredMigrationOptions。
   * Purpose: Declares the input/result contract for fenceSource in MirroredMigrationOptions. Module responsibility: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  fenceSource: () => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type Status = { status?: string; running?: boolean; errorDesc?: string };
/**
 * 入口 / Entry: readStatus.
 * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `value as Status` 供上层消费（`live-migration-transport.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `live-migration-transport.ts`; this entry produces `value as Status` for its caller. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: Status；结果来自 / values from `value as Status`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!value || typeof value !== 'object' || Array.isArray(value)`; 异常 / errors `new Error('QEMU returned an invalid status')`.
 */
const readStatus = (value: unknown): Status => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('QEMU returned an invalid status');
  return value as Status;
};

/**
 * 入口 / Entry: writableDiskSize.
 * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `size as number` 供上层消费（`live-migration-transport.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-transport.ts`; this entry produces `size as number` for its caller. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
 * 处理：通过 `value.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.filter`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown; node: string
 * 输出 / Returns: `size as number`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(value)`; `writable.length !== 1 || writable[0].inserted['node-name'] !== node`; `!Number.isSafeInteger(size) || size <= 0`; 异常 / errors `new Error('QEMU returned invalid block devices')`; `new Error('Migration requires exactly one matching writable disk')`.
 */
function writableDiskSize(value: unknown, node: string) {
  if (!Array.isArray(value)) throw new Error('QEMU returned invalid block devices');
  const writable = value.filter((item) => item && typeof item === 'object' &&
    item.inserted && item.inserted.ro === false);
  if (writable.length !== 1 || writable[0].inserted['node-name'] !== node)
    throw new Error('Migration requires exactly one matching writable disk');
  const size = writable[0].inserted.image?.['virtual-size'];
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error('QEMU did not report the disk virtual size');
  return size as number;
}

/**
 * 入口 / Entry: cpuLayout.
 * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `JSON.stringify(value.map((slot) => { if (!slot || typeof slot !== 'object' || typeof slot.type !== 'string' || !slot.type || …` 供上层消费（`live-migration-transport.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-transport.ts`; this entry produces `JSON.stringify(value.map((slot) => { if (!slot || typeof slot !== 'object' || typeof slot.type !== 'string' || !slot.type || …` for its caller. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
 * 处理：通过 `value.map().map().sort`, `value.map().map`, `value.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.map().map().sort`, `value.map().map`, `value.map`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: `JSON.stringify(value.map((slot) => { if (!slot || typeof slot !== 'object' || typeof slot.type !== 'string' || !slot.type || …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(value) || !value.length`; 异常 / errors `new Error('QEMU returned invalid CPU slots')`.
 */
function cpuLayout(value: unknown) {
  if (!Array.isArray(value) || !value.length)
    throw new Error('QEMU returned invalid CPU slots');
  return JSON.stringify(value.map((slot) => {
    if (!slot || typeof slot !== 'object' || typeof slot.type !== 'string' || !slot.type ||
        !Number.isSafeInteger(slot['vcpus-count']) || slot['vcpus-count'] <= 0 ||
        !slot.props || typeof slot.props !== 'object' || Array.isArray(slot.props) ||
        !Object.values(slot.props).every((item) => Number.isSafeInteger(item)))
      throw new Error('QEMU returned invalid CPU slots');
    return [slot.type, slot['vcpus-count'],
      Object.entries(slot.props).sort(([a], [b]) => a.localeCompare(b))];
  }).map((slot) => JSON.stringify(slot)).sort());
}

/**
 * 入口 / Entry: waitFor.
 * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`live-migration-transport.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-transport.ts`; this entry produces `value` for its caller. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
 * 处理：通过 `signal.throwIfAborted`, `source`, `ready`, `delay` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `source`, `ready`, `delay`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `ready(value)`.
 * 输入 / Inputs: source: MigrationQmp; command: 'query-block-jobs' | 'query-migrate'; ready: (value: unknown) => boolean; timeoutMs: number; signal: AbortSignal optional
 * 输出 / Returns: `value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 异常 / errors `new Error(`${command} timed out`)`.
 */
async function waitFor(source: MigrationQmp, command: 'query-block-jobs' | 'query-migrate',
  ready: (value: unknown) => boolean, timeoutMs: number, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const value = await source(command, undefined, 5000);
    if (ready(value)) return value;
    await delay(200, undefined, { signal });
  }
  throw new Error(`${command} timed out`);
}

/** QEMU pre-copy plus NBD disk mirroring over local ports; caller owns secure tunneling and a durable fence. */
/**
 * 入口 / Entry: migrateQemuWithMirroredDisk.
 * 功能：用 QMP 建立 NBD 磁盘镜像并迁移运行内存到暂停目标 QEMU。
 * Purpose: Uses QMP/NBD disk mirroring to transfer live RAM into a paused target QEMU.
 * 设计：核对本机地址与版本、镜像状态和迁移状态；只在实际阶段达到条件后推进，取消走原镜像及会话清理。
 * Design: Local endpoints/versions and mirror/migration state are checked; stages advance on evidence and cancellation cleans the original mirror/session.
 * 输入 / Inputs: input: MirroredMigrationOptions
 * 输出 / Returns: `{ sourceStopped: true, targetRunning: true, fenced: true } as const`.
 * 副作用 / Effects: `randomUUID().replaceAll().slice`; `randomUUID().replaceAll`; 更新 / updates `nbdStarted`, `exported`, `remoteAdded`, `mirrorStarted`.
 * 拒绝 / Refusals: 条件 / conditions `!input.sourceDiskNode || !input.targetDiskNode || !input.incomingUri || !input.outgoingUri || !input.nbdListen || !input.nbdC…`; `readStatus(sourceState).running !== true || readStatus(targetState).running !== false`; `version(sourceVersion) !== version(targetVersion)`; 异常 / errors `new Error('Migration endpoints are incomplete')`; `new Error('Migration requires a running source and paused receiver')`.
 * 失败处理：catch 分支执行 `if (!fenceStarted) { let migrationCancelled = !migrationStarted; if (migrationStarted) { await source('migrate_cancel').catch…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (!fenceStarted) { let migrationCancelled = !migrationStarted; if (migrationStarted) { await source('migrate_cancel').catch…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function migrateQemuWithMirroredDisk(input: MirroredMigrationOptions) {
  const { source, target, signal } = input;
  if (!input.sourceDiskNode || !input.targetDiskNode || !input.incomingUri ||
      !input.outgoingUri || !input.nbdListen || !input.nbdConnect)
    throw new Error('Migration endpoints are incomplete');
  requireLocalInet(input.nbdListen, 'NBD listener');
  requireLocalInet(input.nbdConnect, 'NBD client');
  requireLocalMigrationUri(input.incomingUri, 'Migration receiver');
  requireLocalMigrationUri(input.outgoingUri, 'Migration sender');
  signal?.throwIfAborted();
  const [sourceState, targetState] = await Promise.all([
    source('query-status'), target('query-status'),
  ]);
  if (readStatus(sourceState).running !== true || readStatus(targetState).running !== false)
    throw new Error('Migration requires a running source and paused receiver');
  const [sourceVersion, targetVersion] = await Promise.all([
    source('query-version'), target('query-version'),
  ]);
  /**
   * 入口 / Entry: migrateQemuWithMirroredDisk.version.
   * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``${qemu.major}.${qemu.minor}.${qemu.micro}`` 供上层消费（`live-migration-transport.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-transport.ts`; this entry produces ``${qemu.major}.${qemu.minor}.${qemu.micro}`` for its caller. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
   * 处理：通过 `inline.every` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.every`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: ``${qemu.major}.${qemu.minor}.${qemu.micro}``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!qemu || ![qemu.major, qemu.minor, qemu.micro].every(Number.isInteger)`; 异常 / errors `new Error('QEMU returned an invalid version')`.
   */
  const version = (value: unknown) => {
    const qemu = (value as { qemu?: { major?: number; minor?: number; micro?: number } })?.qemu;
    if (!qemu || ![qemu.major, qemu.minor, qemu.micro].every(Number.isInteger))
      throw new Error('QEMU returned an invalid version');
    return `${qemu.major}.${qemu.minor}.${qemu.micro}`;
  };
  if (version(sourceVersion) !== version(targetVersion))
    throw new Error('Source and target QEMU versions differ');
  const [sourceCpus, targetCpus] = await Promise.all([
    source('query-hotpluggable-cpus'), target('query-hotpluggable-cpus'),
  ]);
  if (cpuLayout(sourceCpus) !== cpuLayout(targetCpus))
    throw new Error('Source and target CPU models or topology differ');
  const [sourceBlocks, targetBlocks] = await Promise.all([
    source('query-block'), target('query-block'),
  ]);
  if (writableDiskSize(sourceBlocks, input.sourceDiskNode) !==
      writableDiskSize(targetBlocks, input.targetDiskNode))
    throw new Error('Source and target disk virtual sizes differ');

  // QEMU block node names are limited; keep every generated name below 32 bytes.
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const exportId = `sakura-export-${id}`;
  const targetNode = `sakura-target-${id}`;
  const mirrorJob = `sakura-mirror-${id}`;
  let nbdStarted = false, exported = false, remoteAdded = false;
  let mirrorStarted = false, migrationStarted = false, fenceStarted = false;
  const timeout = input.timeoutMs || 5 * 60_000;
  /**
   * 入口 / Entry: migrateQemuWithMirroredDisk.mirrorReady.
   * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `job.ready === true` 供上层消费（`live-migration-transport.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-transport.ts`; this entry produces `job.ready === true` for its caller. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
   * 处理：通过 `value.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `value.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: `job.ready === true`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(value)`; `!job`; `job['io-status'] && job['io-status'] !== 'ok'`; 异常 / errors `new Error('QEMU returned invalid block jobs')`; `new Error('Disk mirror job disappeared before synchronization')`.
   */
  const mirrorReady = (value: unknown) => {
    if (!Array.isArray(value)) throw new Error('QEMU returned invalid block jobs');
    const job = value.find((item) => item && typeof item === 'object' &&
      item.device === mirrorJob) as { ready?: boolean; 'io-status'?: string } | undefined;
    if (!job) throw new Error('Disk mirror job disappeared before synchronization');
    if (job['io-status'] && job['io-status'] !== 'ok')
      throw new Error(`Disk mirror I/O failed: ${job['io-status']}`);
    return job.ready === true;
  };
  /**
   * 入口 / Entry: migrateQemuWithMirroredDisk.cleanupTransport.
   * 功能：在通过 QMP 镜像磁盘并传输 QEMU 运行状态中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`live-migration-transport.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `live-migration-transport.ts`; the calls and state transitions below complete the operation. Module context: Mirrors disks and transfers QEMU runtime state through QMP, tracking stages and cancellation cleanup.
   * 处理：通过 `source`, `target` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `source`, `target`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `remoteAdded`; `exported`; `nbdStarted`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `remoteAdded`, `exported`, `nbdStarted`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const cleanupTransport = async () => {
    if (remoteAdded) {
      await source('blockdev-del', { 'node-name': targetNode });
      remoteAdded = false;
    }
    if (exported) {
      await target('block-export-del', { id: exportId });
      exported = false;
    }
    if (nbdStarted) {
      await target('nbd-server-stop');
      nbdStarted = false;
    }
  };
  try {
    await target('migrate-incoming', { uri: input.incomingUri,
      'exit-on-error': false }, 10_000);
    await target('nbd-server-start', {
      ...input.nbdServerOptions, addr: input.nbdListen,
    });
    nbdStarted = true;
    await target('block-export-add', { type: 'nbd', id: exportId,
      'node-name': input.targetDiskNode, name: exportId, writable: true });
    exported = true;
    await source('blockdev-add', { ...input.nbdClientOptions, driver: 'nbd',
      'node-name': targetNode, server: input.nbdConnect, export: exportId });
    remoteAdded = true;
    await source('blockdev-mirror', { 'job-id': mirrorJob,
      device: input.sourceDiskNode, target: targetNode, sync: 'full' });
    mirrorStarted = true;
    await waitFor(source, 'query-block-jobs', mirrorReady, timeout, signal);
    await source('migrate-set-capabilities', { capabilities: [
      { capability: 'pause-before-switchover', state: true },
    ] });
    await source('migrate', { uri: input.outgoingUri }, 10_000);
    migrationStarted = true;
    await waitFor(source, 'query-migrate', (value) => {
      const state = readStatus(value);
      if (state.status === 'failed' || state.status === 'cancelled' ||
          state.status === 'completed')
        throw new Error(`Migration ended before switchover: ${state.status} ${state.errorDesc || ''}`);
      return state.status === 'pre-switchover';
    }, timeout, signal);
    if (readStatus(await source('query-status')).running !== false)
      throw new Error('Source QEMU is still running at pre-switchover');
    signal?.throwIfAborted();
    // The guest may have dirtied the disk during RAM pre-copy. Wait until the
    // final writes reach the target after the source vCPUs have stopped.
    await waitFor(source, 'query-block-jobs', mirrorReady, timeout, signal);
    await source('block-job-cancel', { device: mirrorJob });
    await waitFor(source, 'query-block-jobs', (value) => {
      if (!Array.isArray(value)) throw new Error('QEMU returned invalid block jobs');
      return !value.some((job) => job && typeof job === 'object' &&
        job.device === mirrorJob);
    }, timeout, signal);
    mirrorStarted = false;
    await cleanupTransport();
    signal?.throwIfAborted();
    fenceStarted = true;
    await input.fenceSource();
    await source('migrate-continue', { state: 'pre-switchover' });
    await waitFor(source, 'query-migrate', (value) => {
      const state = readStatus(value);
      if (state.status === 'failed' || state.status === 'cancelled')
        throw new Error(`Migration failed after fencing: ${state.errorDesc || state.status}`);
      return state.status === 'completed';
    }, timeout);
    if (readStatus(await target('query-status')).running !== true ||
        readStatus(await source('query-status')).running !== false)
      throw new Error('QEMU source/target state is inconsistent after migration');
    return { sourceStopped: true, targetRunning: true, fenced: true } as const;
  } catch (error) {
    // Once fencing begins, a rollback could let both copies write. Leave both
    // processes for the control plane to reconcile instead of resuming source.
    if (!fenceStarted) {
      let migrationCancelled = !migrationStarted;
      if (migrationStarted) {
        await source('migrate_cancel').catch(() => {});
        try {
          const terminal = await waitFor(source, 'query-migrate', (value) =>
            ['cancelled', 'failed', 'completed'].includes(readStatus(value).status || ''),
          15_000);
          migrationCancelled = ['cancelled', 'failed'].includes(readStatus(terminal).status || '');
        } catch { migrationCancelled = false; }
      }
      if (mirrorStarted) await source('block-job-cancel', { device: mirrorJob }).catch(() => {});
      if (mirrorStarted) await waitFor(source, 'query-block-jobs', (value) =>
        Array.isArray(value) && !value.some((job) => job && typeof job === 'object' &&
          job.device === mirrorJob), 15_000).catch(() => {});
      await cleanupTransport().catch(() => {});
      const current = readStatus(await source('query-status').catch(() => ({})));
      const receiver = readStatus(await target('query-status').catch(() => ({})));
      if (migrationCancelled && receiver.running === false && current.running === false)
        await source('cont').catch(() => {});
    }
    throw error;
  }
}
