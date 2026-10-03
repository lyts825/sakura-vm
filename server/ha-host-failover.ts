import { AppError } from './model.ts';
import { checkHaFailover, haFailoverOptions } from './ha-failover.ts';
import type { HaWitnessClient } from './ha-witness-client.ts';
import type { HaWitnessPlan } from './ha-witness-core.ts';
import type { Machines } from './machines.ts';
import type { HostPeers } from './host-peers.ts';
import type { SnapshotReplications } from './snapshot-replications.ts';

type Policy = { enabled: boolean; options: unknown };
const INTERVAL_MS = 15_000;

/** Source-side heartbeat and start gate for the independent witness process. */
export class HaHostFailover {
  private work = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private keepaliveTimer?: ReturnType<typeof setInterval>;
  private keepalivePending: Promise<void> | null = null;
  private closed = false;
  private errors: Record<string, string> = {};
  private armed: Record<string, boolean> = {};
  private phases: Record<string, string> = {};
  private targetVmIds: Record<string, string> = {};
  private pendingReturns = new Map<string, number>();
  private failbackPhases: Record<string, 'pending' | 'completed' | null> = {};
  private recoveries: Record<string, boolean> = {};

  constructor(private machines: Machines, private peers: HostPeers,
    private replications: SnapshotReplications,
    private policies: () => Promise<Record<string, Policy>>,
    private client: HaWitnessClient | null) {}

  configured() { return !!this.client; }
  view(id: string) { return { configured: !!this.client,
    armed: !!this.armed[id], phase: this.phases[id] || null,
    targetVmId: this.targetVmIds[id] || null,
    failback: this.failbackPhases[id] || null,
    recoveryHeld: !!this.recoveries[id],
    error: this.errors[id] || null }; }

  private identity(id: string) {
    return { sourceHostId: this.peers.view().hostId, sourceVmId: id };
  }

  async authorizeStart(id: string) {
    if (!this.machines.get(id).haWitnessEnrollment) return;
    if (!this.client) throw new AppError('宿主失联接管已启用，但见证节点未配置',
      503, 'HA_WITNESS_UNAVAILABLE');
    try { await this.client.authorizeStart(this.identity(id)); }
    catch (error) {
      throw new AppError(`见证节点未确认来源启动：${(error as Error).message}`,
        503, 'HA_WITNESS_UNAVAILABLE');
    }
  }

  disarm(id: string, failureThreshold: number) {
    return this.enqueue(() => this.disarmNow(id, failureThreshold));
  }

  private async disarmNow(id: string, failureThreshold: number) {
    if (!this.client) throw new AppError('见证节点未配置，不能安全撤销宿主失联策略', 503);
    const result = await this.client.heartbeat({ ...this.identity(id),
      failureThreshold, plan: null });
    this.rememberReturn(id, failureThreshold, result.failback);
    this.armed[id] = false;
    this.phases[id] = 'source';
  }

  sample() {
    return this.enqueue(() => this.scan());
  }

  private enqueue<T>(task: () => Promise<T>) {
    const current = this.work.catch(() => {}).then(task);
    this.work = current.then(() => {}, () => {});
    return current;
  }

  private keepalive() {
    if (this.closed || !this.client) return Promise.resolve();
    if (this.keepalivePending) return this.keepalivePending;
    const current = this.sendKeepalives().finally(() => {
      if (this.keepalivePending === current) this.keepalivePending = null;
    });
    this.keepalivePending = current;
    return current;
  }

  private async sendKeepalives() {
    const policies = await this.policies();
    await Promise.all([...this.machines.records.values()].map(async (vm) => {
      const enrollment = vm.haWitnessEnrollment;
      const returning = this.pendingReturns.get(vm.id);
      if (returning && this.machines.state(vm.id) === 'running' && !vm.haPromotion) {
        try {
          const result = await this.client!.heartbeat({ ...this.identity(vm.id),
            failureThreshold: returning, plan: null });
          this.rememberReturn(vm.id, returning, result.failback);
        } catch (error) { this.errors[vm.id] = (error as Error).message; }
        return;
      }
      const policy = policies[vm.id];
      const parsed = haFailoverOptions.safeParse(policy?.options);
      if (!enrollment || !policy?.enabled || !parsed.success ||
          !parsed.data.autoHostFailover ||
          parsed.data.targetHostId !== enrollment.targetHostId ||
          parsed.data.failureThreshold !== enrollment.failureThreshold ||
          this.machines.state(vm.id) !== 'running' || vm.haPromotion) return;
      try {
        const result = await this.client!.heartbeat({ ...this.identity(vm.id),
          failureThreshold: enrollment.failureThreshold });
        this.armed[vm.id] = this.machines.state(vm.id) === 'running' && !vm.haPromotion && result.armed;
        this.rememberReturn(vm.id, enrollment.failureThreshold, result.failback);
      } catch (error) {
        this.armed[vm.id] = false;
        this.errors[vm.id] = (error as Error).message;
      }
    }));
  }

  async init() {
    // A completed rejoin survives local policy revocation and source-service
    // restart. Discover its pending routing work from the durable witness.
    if (this.client) await Promise.all([...this.machines.records.values()].map(async (vm) => {
      try {
        const status = await this.client!.status(this.identity(vm.id));
        this.recordStatus(vm.id, status);
      } catch { /* Unregistered VMs do not participate in witness failover. */ }
    }));
    await this.keepalive();
    this.keepaliveTimer = setInterval(() => void this.keepalive().catch((error) =>
      console.error('宿主失联独立心跳失败：', error)), 5_000);
    this.keepaliveTimer.unref();
    await this.sample();
    this.timer = setInterval(() => void this.sample().catch((error) =>
      console.error('宿主失联心跳扫描失败：', error)), INTERVAL_MS);
    this.timer.unref();
  }

  private rememberReturn(id: string, threshold: number,
    phase: 'pending' | 'completed' | null | undefined) {
    if (phase === 'pending') this.pendingReturns.set(id, threshold);
    else if (phase === 'completed' || phase === null) this.pendingReturns.delete(id);
    if (phase !== undefined) this.failbackPhases[id] = phase;
    if (phase === 'completed') delete this.errors[id];
  }

  private recordStatus(id: string, status: Awaited<ReturnType<HaWitnessClient['status']>>) {
    this.phases[id] = status.phase || '';
    this.targetVmIds[id] = status.targetVmId || '';
    this.recoveries[id] = !!status.recoveryHeld;
    if (status.error) this.errors[id] = status.error;
    if (status.recoveryHeld) this.pendingReturns.delete(id);
    else if (status.phase === 'source' && status.failureThreshold)
      this.rememberReturn(id, status.failureThreshold, status.failback?.phase || null);
  }

  private async scan() {
    if (this.closed) return;
    const policies = await this.policies();
    for (const vm of this.machines.records.values()) {
      const enrollment = vm.haWitnessEnrollment;
      if (!enrollment) continue;
      const policy = policies[vm.id];
      const parsed = haFailoverOptions.safeParse(policy?.options);
      if (policy?.enabled && parsed.success && parsed.data.autoHostFailover) continue;
      try {
        await this.disarmNow(vm.id, enrollment.failureThreshold);
        delete this.errors[vm.id];
      } catch (error) { this.errors[vm.id] = (error as Error).message; }
    }
    for (const [id, policy] of Object.entries(policies)) {
      if (this.closed) return;
      const parsed = haFailoverOptions.safeParse(policy.options);
      if (!policy.enabled || !parsed.success || !parsed.data.autoHostFailover) continue;
      try {
        const enrollment = this.machines.get(id).haWitnessEnrollment;
        if (!enrollment || enrollment.targetHostId !== parsed.data.targetHostId ||
            enrollment.failureThreshold !== parsed.data.failureThreshold)
          throw new AppError('来源实例见证登记与策略不一致，拒绝布防', 409);
        if (!this.client) throw new AppError('见证节点未配置', 503);
        const options = parsed.data;
        // Keep liveness independent of potentially slow peer capacity/receipt checks.
        const liveness = await this.client.heartbeat({ ...this.identity(id),
          failureThreshold: options.failureThreshold });
        this.armed[id] = liveness.armed;
        this.rememberReturn(id, options.failureThreshold, liveness.failback);
        let plan: HaWitnessPlan | null = null;
        if (this.machines.state(id) === 'running' && !this.machines.get(id).haPromotion) {
          const checked = await checkHaFailover(this.machines, this.peers,
            this.replications, id, options, true);
          const replica = checked.replica;
          if (checked.hostPlanReady && replica?.remoteVmId && replica.sha256) {
            const snapshot = this.machines.get(id).snapshots.find((item) =>
              item.id === replica.snapshotId);
            if (snapshot) plan = {
              ...this.identity(id), targetHostId: options.targetHostId!,
              transferId: replica.transferId, remoteVmId: replica.remoteVmId,
              snapshotId: replica.snapshotId, sha256: replica.sha256,
              snapshotAt: snapshot.createdAt,
              maxReplicaAgeMinutes: options.maxReplicaAgeMinutes,
            };
          }
        }
        if (plan) {
          // A process failure, local fence or policy change during slow peer
          // validation must not resurrect a withdrawn host-loss plan.
          const latest = (await this.policies())[id];
          const latestOptions = haFailoverOptions.safeParse(latest?.options);
          const currentVm = this.machines.get(id), currentEnrollment = currentVm.haWitnessEnrollment;
          if (this.closed || !latest?.enabled || !latestOptions.success ||
              !latestOptions.data.autoHostFailover ||
              latestOptions.data.targetHostId !== options.targetHostId ||
              latestOptions.data.failureThreshold !== options.failureThreshold ||
              latestOptions.data.maxReplicaAgeMinutes !== options.maxReplicaAgeMinutes ||
              !currentEnrollment ||
              currentEnrollment?.targetHostId !== options.targetHostId ||
              currentEnrollment.failureThreshold !== options.failureThreshold ||
              this.machines.state(id) !== 'running' || currentVm.haPromotion) plan = null;
        }
        if (plan) {
          const result = await this.client.heartbeat({ ...this.identity(id),
            failureThreshold: options.failureThreshold, plan });
          this.armed[id] = result.armed;
        } else await this.disarmNow(id, options.failureThreshold);
        this.phases[id] = 'source';
        this.targetVmIds[id] = plan?.remoteVmId || '';
        delete this.errors[id];
      } catch (error) {
        this.armed[id] = false;
        this.errors[id] = (error as Error).message;
        if (this.client) {
          try {
            const status = await this.client.status(this.identity(id));
            this.recordStatus(id, status);
          } catch { /* The last known phase remains visible. */ }
        }
      }
    }
  }

  async witnessStatus(id: string) {
    if (!this.client) return { configured: false, error: '见证节点未配置' };
    try { return { configured: true, ...await this.client.status(this.identity(id)) }; }
    catch (error) { return { configured: true, error: (error as Error).message }; }
  }

  rejoin(id: string, dataReconciled: boolean) {
    return this.enqueue(() => this.rejoinNow(id, dataReconciled));
  }

  private async rejoinNow(id: string, dataReconciled: boolean) {
    if (!dataReconciled)
      throw new AppError('请先回迁目标期间的写入，或明确接受丢失目标新数据', 409);
    this.machines.requireUnlocked(id);
    this.machines.requireStopped(id);
    if (!this.client) throw new AppError('见证节点未配置', 503);
    const result = await this.client.rejoin({ ...this.identity(id), dataReconciled: true });
    if (result.failback === 'pending') {
      const status = await this.client.status(this.identity(id));
      this.recordStatus(id, status);
    }
    this.armed[id] = false;
    this.phases[id] = 'source';
    this.recoveries[id] = false;
    delete this.errors[id];
    return { ready: true, executed: true, ...result,
      message: result.failback === 'pending'
        ? '目标副本已退役，来源可重新启动；见证将确认来源应用健康后回切流量。'
        : result.failback === 'completed'
          ? '目标副本已退役，流量已确认指向来源实例。'
          : '见证节点确认目标副本已退役，来源可重新启动；来源健康后请恢复流量。' };
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.keepaliveTimer);
    await this.keepalivePending?.catch(() => {});
    await this.work.catch(() => {});
    if (!this.client) return;
    for (const vm of this.machines.records.values()) {
      if (!vm.haWitnessEnrollment) continue;
      try { await this.disarmNow(vm.id, vm.haWitnessEnrollment.failureThreshold); }
      catch (error) {
        console.error(`实例 ${vm.id} 的见证关闭心跳失败：`, (error as Error).message);
      }
    }
  }
}
