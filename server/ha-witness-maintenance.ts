import { createHash, X509Certificate } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createSecureContext } from 'node:tls';
import { AppError } from './model.ts';
import { writeStore } from './local-store.ts';
import { haWitnessBinding, haWitnessStoreSchema, persistHaWitnessState,
  syncHaWitnessDirectory, validateHaWitnessState,
  type HaWitnessStore } from './ha-witness-core.ts';
import { haHttpsRequest } from './ha-witness-http.ts';
import { lockHaWitnessState } from './ha-witness-lock.ts';
import { haWitnessServerConfigSchema, redfishPowerState, witnessVms,
  type HaWitnessServerConfig } from './ha-witness-server.ts';

type ConfigVm = HaWitnessServerConfig['vms'][number];
type StateEntry = HaWitnessStore['entries'][string];
type Observation = { sourceVmId: string; phase: StateEntry['phase'];
  configurationChanged: boolean; powerState: string; targetHostId: string;
  activeVmId: string; targetStatus?: string; retiredVmId?: string };
export type HaWitnessMaintenanceOptions = {
  mode: 'migrate' | 'reconfigure' | 'recover'; backupFile: string; output: string;
  recoveryStateFile?: string;
};

const digest = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');
// Credentials may rotate while an authority is active. Endpoint, certificate,
// hardware and VM identity changes require a withdrawn source-state entry.
function configurationIdentity(vm: ConfigVm) {
  return JSON.stringify({ sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId,
    targetHostId: vm.targetHostId, failureThreshold: vm.failureThreshold,
    redfish: { url: vm.redfish.baseUrl, path: vm.redfish.systemPath,
      uuid: vm.redfish.systemUuid.toLowerCase(), fingerprint: vm.redfish.fingerprint || null,
      caFile: vm.redfish.caFile ? resolve(vm.redfish.caFile) : null },
    target: { url: vm.target.baseUrl, fingerprint: vm.target.fingerprint },
    application: { url: vm.application.url, fingerprint: vm.application.fingerprint || null },
    traffic: { url: vm.traffic.baseUrl, fingerprint: vm.traffic.fingerprint || null },
    failback: vm.failback ? { url: vm.failback.application.url,
      fingerprint: vm.failback.application.fingerprint || null } : null });
}

async function inspect(vm: ConfigVm, entry: StateEntry,
  configurationChanged: boolean): Promise<Observation> {
  const ca = vm.redfish.caFile ? await readFile(vm.redfish.caFile) : undefined;
  const powerState = redfishPowerState(await haHttpsRequest(
    new URL(vm.redfish.systemPath, vm.redfish.baseUrl).toString(), 'GET', undefined,
    { basic: { username: vm.redfish.username, password: vm.redfish.password },
      ca, fingerprint: vm.redfish.fingerprint }), vm.redfish.systemUuid);
  if ((entry.phase === 'fenced' || entry.phase === 'promoted') && powerState !== 'Off')
    throw new AppError('来源宿主不再确认关闭，不能迁移隔离或接管记录', 409);
  const peer = await haHttpsRequest(new URL('/peer/status', vm.target.baseUrl).toString(),
    'GET', undefined, { bearer: vm.target.token, fingerprint: vm.target.fingerprint }) as {
    version?: unknown; id?: unknown };
  if (peer?.version !== 1 || peer.id !== vm.targetHostId)
    throw new AppError('目标主机身份不一致，不能迁移见证状态', 409);
  const trafficUrl = new URL('/status', vm.traffic.baseUrl);
  trafficUrl.searchParams.set('sourceVmId', vm.sourceVmId);
  const traffic = await haHttpsRequest(trafficUrl.toString(), 'GET', undefined,
    { bearer: vm.traffic.token, fingerprint: vm.traffic.fingerprint }) as {
    activeVmId?: unknown };
  const allowedTraffic = entry.phase === 'source' && entry.failback?.phase !== 'pending'
    ? [vm.sourceVmId] : [vm.sourceVmId,
      entry.plan?.remoteVmId || entry.failback?.plan.remoteVmId];
  if (typeof traffic?.activeVmId !== 'string' || !allowedTraffic.includes(traffic.activeVmId))
    throw new AppError('流量入口身份未知或仍指向其他实例，不能迁移见证状态', 409);
  const observation: Observation = { sourceVmId: vm.sourceVmId, phase: entry.phase,
    configurationChanged, powerState, targetHostId: vm.targetHostId,
    activeVmId: traffic.activeVmId };
  if (entry.plan) {
    const plan = entry.plan;
    const replica = await haHttpsRequest(new URL('/peer/replica-activate-check',
      vm.target.baseUrl).toString(), 'POST', { transferId: plan.transferId,
      remoteVmId: plan.remoteVmId, sha256: plan.sha256,
      sourceVmId: plan.sourceVmId, snapshotId: plan.snapshotId },
    { bearer: vm.target.token, fingerprint: vm.target.fingerprint }) as {
      ready?: unknown; id?: unknown; status?: unknown };
    if (replica?.ready !== true || replica.id !== plan.remoteVmId ||
        !['stopped', 'starting', 'running'].includes(String(replica.status)) ||
        ((entry.phase === 'source' || entry.phase === 'fencing') && replica.status !== 'stopped'))
      throw new AppError('精确目标副本身份或运行状态不一致，不能迁移见证状态', 409);
    observation.targetStatus = String(replica.status);
  }
  // A v4 pending/completed receipt already contains the exact durable retirement
  // plan. Preserve it; maintenance never calls a mutating retirement endpoint.
  if (entry.failback) observation.retiredVmId = entry.failback.plan.remoteVmId;
  return observation;
}

/** Offline configuration/version change. No shutdown, activation, retirement or routing writes. */
export async function maintainHaWitnessState(currentRaw: unknown, nextRaw: unknown,
  options: HaWitnessMaintenanceOptions) {
  const current = haWitnessServerConfigSchema.parse(currentRaw);
  const next = haWitnessServerConfigSchema.parse(nextRaw);
  if (new Set(current.vms.map((vm) => vm.sourceVmId)).size !== current.vms.length ||
      new Set(next.vms.map((vm) => vm.sourceVmId)).size !== next.vms.length)
    throw new AppError('见证实例 ID 重复', 409);
  const canonical = async (path: string) => realpath(path).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || options.mode !== 'recover') throw error;
    return join(await realpath(dirname(resolve(path))), basename(path));
  });
  const file = await canonical(current.stateFile);
  if (await canonical(next.stateFile) !== file)
    throw new AppError('受控维护须保留原状态文件路径；不能创建另一份来源授权', 409);
  const destination = async (path: string) => join(await realpath(dirname(resolve(path))), basename(path));
  const backupFile = await destination(options.backupFile), output = await destination(options.output);
  const paths = [file, backupFile, output].map((value) => process.platform === 'win32'
    ? value.toLowerCase() : value);
  if (new Set(paths).size !== 3)
    throw new AppError('状态、备份和回执须使用三个不同路径', 409);
  const release = await lockHaWitnessState(file, { allowMissing: options.mode === 'recover' });
  try {
    const readCurrent = () => readFile(file).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || options.mode !== 'recover') throw error;
      return null;
    });
    const original = await readCurrent();
    const beforeSha256 = original ? digest(original) : null;
    // Exclusive creation keeps failed attempts and historical backups intact.
    await writeFile(backupFile, original || JSON.stringify({ version: 1,
      kind: 'sakura-ha-missing-state', stateFile: file, missing: true }),
    { flag: 'wx', mode: 0o600, flush: true });
    await syncHaWitnessDirectory(backupFile);
    const startedAt = new Date().toISOString();
    const base = { version: 1, kind: 'sakura-ha-witness-maintenance',
      mode: options.mode, startedAt, backupFile, beforeSha256, missingOriginal: !original };
    await writeFile(output, JSON.stringify({ ...base, status: 'started' }, null, 2) + '\n',
      { flag: 'wx', mode: 0o600, flush: true });
    await syncHaWitnessDirectory(output);
    const observations: Observation[] = [];
    let commitStarted = false;
    try {
      if (options.mode === 'recover' && !options.recoveryStateFile)
        throw new AppError('受控恢复须提供合法历史状态备份', 409);
      const recoveryBytes = options.mode === 'recover'
        ? await readFile(resolve(options.recoveryStateFile!)) : null;
      const raw: unknown = JSON.parse((recoveryBytes || original!).toString('utf8'));
      const legacy = (raw as { version?: unknown } | null)?.version !== 4;
      if (options.mode === 'reconfigure' && legacy)
        throw new AppError('旧状态须先使用 --migrate 升级，再调整见证配置', 409);
      const previous = validateHaWitnessState(raw, witnessVms(current), legacy);
      const nextById = new Map(next.vms.map((vm) => [vm.sourceVmId, vm]));
      const previousById = new Map(current.vms.map((vm) => [vm.sourceVmId, vm]));
      const entries: HaWitnessStore['entries'] = {};
      for (const vm of current.vms) {
        const replacement = nextById.get(vm.sourceVmId);
        const entry = previous.entries[vm.sourceVmId] as StateEntry;
        const changed = !replacement || configurationIdentity(vm) !== configurationIdentity(replacement);
        if (options.mode !== 'reconfigure' && changed)
          throw new AppError('版本迁移须保留配置中的实例、硬件和接口绑定', 409);
        if (changed && (entry.phase !== 'source' || entry.plan || entry.recoveryHold ||
            entry.failback?.phase === 'pending'))
          throw new AppError('配置更换须先退出接管、完成回切并撤防；不能降级活动授权', 409);
        if (replacement && (replacement.sourceHostId !== vm.sourceHostId ||
            replacement.redfish.systemUuid.toLowerCase() !== vm.redfish.systemUuid.toLowerCase()))
          throw new AppError('既有实例不能改绑来源宿主或硬件 UUID；须使用新的实例登记', 409);
        if (options.mode === 'recover') {
          entries[vm.sourceVmId] = { ...entry,
            recoveryHold: { restoredAt: Date.now(), backupSha256: digest(recoveryBytes!) },
            error: '状态已从备份恢复；须核对全部历史副本并确认数据后退出恢复封锁' };
          continue;
        }
        observations.push(await inspect(vm, entry, changed));
        if (!replacement) continue;
        if (changed) {
          // Keep the old retirement acknowledgement for lost-response retries.
          // Its full plan remains in the immutable backup and maintenance receipt.
          entries[vm.sourceVmId] = { phase: 'source', plan: null, lastHeartbeatAt: 0,
            ...(entry.retiredRemoteVmId ? { retiredRemoteVmId: entry.retiredRemoteVmId } : {}) };
          observations.push(await inspect(replacement, entries[vm.sourceVmId], true));
        } else entries[vm.sourceVmId] = { ...entry };
      }
      for (const vm of next.vms) {
        if (previousById.has(vm.sourceVmId)) continue;
        if (options.mode !== 'reconfigure')
          throw new AppError('版本迁移不能增加实例登记', 409);
        entries[vm.sourceVmId] = { phase: 'source', plan: null, lastHeartbeatAt: 0 };
        observations.push(await inspect(vm, entries[vm.sourceVmId], true));
      }
      const [cert, key] = await Promise.all([
        readFile(next.listen.certFile), readFile(next.listen.keyFile),
      ]);
      createSecureContext({ cert, key });
      const listener = new X509Certificate(cert);
      if (Date.parse(listener.validFrom) > Date.now() || Date.parse(listener.validTo) <= Date.now())
        throw new AppError('新见证监听证书不在有效期内', 409);
      const migrated = haWitnessStoreSchema.parse({ version: 4, entries,
        bindings: Object.fromEntries(witnessVms(next).map((vm) => [vm.sourceVmId, haWitnessBinding(vm)])) });
      validateHaWitnessState(migrated, witnessVms(next));
      // Detect an out-of-band edit while performing external reads. The kernel
      // lock protects supported authorities; this check also catches manual edits.
      if (await readCurrent().then((value) => value ? digest(value) : null) !== beforeSha256)
        throw new AppError('维护期间状态文件被外部修改，拒绝提交', 409);
      commitStarted = true;
      await persistHaWitnessState(file, migrated);
      const report = { ...base, status: 'applied', ok: true,
        completedAt: new Date().toISOString(), stateVersionBefore: previous.version,
        ...(recoveryBytes ? { recoveryBackupSha256: digest(recoveryBytes), recoveryHeld: true } : {}),
        stateVersionAfter: 4, stateChanged: digest(await readFile(file)) !== beforeSha256,
        afterSha256: digest(await readFile(file)), observations };
      await writeStore(output, report);
      await syncHaWitnessDirectory(output);
      return report;
    } catch (error) {
      const afterSha256 = await readFile(file).then(digest).catch(() => null);
      const report = { ...base, status: commitStarted ? 'commit-unconfirmed' : 'rejected',
        ok: false, completedAt: new Date().toISOString(),
        stateChanged: afterSha256 === null ? null : afterSha256 !== beforeSha256,
        afterSha256, observations,
        error: (error instanceof Error ? error.message : '见证维护失败').slice(0, 500) };
      await writeStore(output, report);
      await syncHaWitnessDirectory(output);
      return report;
    }
  } finally { await release(); }
}
