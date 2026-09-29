import { AppError } from './model.ts';
import { checkHaFailover, haFailoverOptions } from './ha-failover.ts';
import type { HaFailureMonitor } from './ha-failure-monitor.ts';
import type { HostPeers } from './host-peers.ts';
import type { Machines } from './machines.ts';
import type { SnapshotReplications } from './snapshot-replications.ts';

type Policy = { enabled: boolean; options: unknown };
const INTERVAL_MS = 15_000;

/** Only promotes a replica after this service has observed its own QEMU process exit. */
export class HaLocalFailovers {
  private timer?: ReturnType<typeof setInterval>;
  private work = Promise.resolve();
  private closed = false;
  private errors: Record<string, string> = {};
  private observedLive = new Set<string>();

  constructor(private machines: Machines, private monitor: HaFailureMonitor,
    private peers: HostPeers, private replications: SnapshotReplications,
    private policies: () => Promise<Record<string, Policy>>,
    private allowed: () => boolean = () => true) {}

  async init() {
    this.machines.on('change', this.observeLive);
    this.observeLive();
    await this.sample();
    this.timer = setInterval(() => void this.sample().catch((error) =>
      console.error('本机 QEMU 故障接管扫描失败：', error)), INTERVAL_MS);
    this.timer.unref();
  }

  private observeLive = () => {
    for (const id of this.machines.live.keys())
      if (this.machines.state(id) === 'running') this.observedLive.add(id);
  };

  view(id: string) { return { error: this.errors[id] || null }; }
  hasObservedLive(id: string) { return this.observedLive.has(id); }

  sample() {
    const current = this.work.catch(() => {}).then(() => this.scan());
    this.work = current;
    return current;
  }

  rejoin(id: string, dataReconciled: boolean) {
    const current = this.work.catch(() => {}).then(async () => {
      if (this.closed || !this.allowed())
        throw new AppError('故障接管服务当前不可用', 503);
      if (!dataReconciled)
        throw new AppError('请先回迁目标期间的写入数据，或明确接受丢失目标新数据', 409);
      this.machines.requireUnlocked(id);
      const promotion = this.machines.get(id).haPromotion;
      if (!promotion) throw new AppError('来源实例没有故障接管栅栏', 409);
      this.machines.requireStopped(id);
      await this.peers.retireReplica(promotion.peerId, {
        transferId: promotion.transferId, remoteVmId: promotion.remoteVmId,
        sha256: promotion.sha256, sourceVmId: id, snapshotId: promotion.snapshotId,
      });
      await this.monitor.reconfigure(id);
      await this.machines.releaseHaPromotion(id, promotion.transferId);
      delete this.errors[id];
      return { ready: true, executed: true, retiredRemoteVmId: promotion.remoteVmId,
        message: '目标副本已持久封锁，来源实例的启动栅栏已解除。' };
    });
    this.work = current.then(() => {}, () => {});
    return current;
  }

  private async scan() {
    if (this.closed || !this.allowed()) return;
    const policies = await this.policies();
    for (const [id, policy] of Object.entries(policies)) {
      if (this.closed || !this.allowed() || !policy.enabled) continue;
      const options = haFailoverOptions.safeParse(policy.options);
      if (!options.success || !options.data.autoProcessFailover) continue;
      try {
        await this.attempt(id, policy);
        delete this.errors[id];
      } catch (error) {
        this.errors[id] = (error as Error).message;
        console.error(`实例 ${id} 的本机故障接管失败：`, error);
      }
    }
  }

  private async attempt(id: string, policy: Policy) {
    const vm = this.machines.get(id);
    if (vm.haPromotion?.status === 'accepted') return;
    if (this.machines.live.has(id)) return;
    let promotion = vm.haPromotion;
    if (!promotion) {
      if (!this.observedLive.has(id) || !this.monitor.view(id)?.suspected) return;
      this.machines.requireUnlocked(id);
      const checked = await checkHaFailover(this.machines, this.peers,
        this.replications, id, policy.options, policy.enabled, undefined, true, true);
      const replica = checked.replica;
      if (!checked.localProcessReady || !replica?.remoteVmId || !replica.sha256)
        return;
      const input = { transferId: replica.transferId, remoteVmId: replica.remoteVmId,
        sha256: replica.sha256, sourceVmId: id, snapshotId: replica.snapshotId };
      const target = await this.peers.checkReplicaActivation(replica.peerId, input);
      if (target.status !== 'stopped')
        throw new AppError(`故障副本当前为 ${target.status}，拒绝自动接管`, 409);
      if (this.closed || !this.allowed()) return;
      const at = new Date().toISOString();
      promotion = await this.machines.fenceForHa(id, {
        peerId: replica.peerId, targetHostId: checked.policy.targetHostId!,
        transferId: input.transferId, remoteVmId: input.remoteVmId,
        snapshotId: input.snapshotId, sha256: input.sha256,
        fencedAt: at, status: 'fenced', updatedAt: at,
      }, async () => {
        if (this.closed || !this.allowed() || !this.observedLive.has(id) ||
            !this.monitor.view(id)?.suspected ||
            this.machines.live.has(id))
          throw new AppError('来源实例故障状态已变化，取消接管', 409);
        const latest = (await this.policies())[id];
        const parsed = haFailoverOptions.safeParse(latest?.options);
        if (!latest?.enabled || !parsed.success || !parsed.data.autoProcessFailover ||
            parsed.data.targetHostId !== checked.policy.targetHostId)
          throw new AppError('接管策略已变化，取消接管', 409);
      });
    }
    const input = { transferId: promotion.transferId, remoteVmId: promotion.remoteVmId,
      sha256: promotion.sha256, sourceVmId: id, snapshotId: promotion.snapshotId };
    try {
      if (this.closed || !this.allowed()) return;
      const target = await this.peers.checkReplicaActivation(promotion.peerId, input);
      if (this.closed || !this.allowed()) return;
      const result = target.status === 'stopped'
        ? await this.peers.activateReplica(promotion.peerId, input) : target;
      if (result.status !== 'starting' && result.status !== 'running')
        throw new AppError(`故障副本当前为 ${result.status}，尚未接管`, 409);
      await this.machines.updateHaPromotion(id, promotion.transferId,
        { status: 'accepted', error: undefined });
    } catch (error) {
      await this.machines.updateHaPromotion(id, promotion.transferId,
        { status: 'fenced', error: (error as Error).message.slice(0, 500) });
      throw error;
    }
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.machines.off('change', this.observeLive);
    await this.work.catch(() => {});
  }
}
