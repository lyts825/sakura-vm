/**
 * 模块职责：维护实例 HA 见证、栅栏和接管归属；更改必须匹配原登记身份。
 */
import { z } from 'zod';
import { haPromotionSchema, haRetirementSchema, haWitnessEnrollmentSchema, type HaPromotion, type VMRecord } from '../../shared/contracts/vm.ts';
import { AppError } from '../../shared/errors.ts';

export type VmHaAuthorityPorts = {
  get(id: string): VMRecord;
  requireStopped(id: string): void;
  locked<T>(id: string, work: () => Promise<T>): Promise<T>;
  save(): Promise<void>;
  changed(): void;
};

/** Owns durable witness, takeover and retirement receipts without owning VM processes. */
export class VmHaAuthority {
  constructor(private readonly ports: VmHaAuthorityPorts) {}
  async enrollHaWitness(id: string, targetHostId: string, failureThreshold: number) {
    z.uuid().parse(targetHostId);
    z.number().int().min(2).max(10).parse(failureThreshold);
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id);
      this.ports.requireStopped(id);
      if (vm.haWitnessEnrollment) {
        if (vm.haWitnessEnrollment.targetHostId !== targetHostId ||
            vm.haWitnessEnrollment.failureThreshold !== failureThreshold)
          throw new AppError('实例已登记其他 HA 见证目标，须先撤销', 409);
        return vm.haWitnessEnrollment;
      }
      vm.haWitnessEnrollment = haWitnessEnrollmentSchema.parse({ targetHostId,
        failureThreshold,
        registeredAt: new Date().toISOString() });
      try { await this.ports.save(); }
      catch (error) { delete vm.haWitnessEnrollment; throw error; }
      this.ports.changed();
      return vm.haWitnessEnrollment;
    });
  }
  async releaseHaWitness(id: string, targetHostId: string) {
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id), previous = vm.haWitnessEnrollment;
      if (!previous || previous.targetHostId !== targetHostId)
        throw new AppError('实例见证登记已变化', 409);
      delete vm.haWitnessEnrollment;
      try { await this.ports.save(); }
      catch (error) { vm.haWitnessEnrollment = previous; throw error; }
      this.ports.changed();
    });
  }
  async fenceForHa(id: string, raw: HaPromotion,
    guard?: () => Promise<void> | void) {
    const promotion = haPromotionSchema.parse(raw);
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id);
      this.ports.requireStopped(id);
      await guard?.();
      if (vm.haPromotion) {
        if (vm.haPromotion.transferId !== promotion.transferId)
          throw new AppError('来源实例已有其他故障接管栅栏', 409);
        return vm.haPromotion;
      }
      vm.haPromotion = promotion;
      try { await this.ports.save(); }
      catch (error) { delete vm.haPromotion; throw error; }
      this.ports.changed();
      return promotion;
    });
  }
  async updateHaPromotion(id: string, transferId: string,
    patch: Pick<HaPromotion, 'status'> & { error?: string }) {
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id), previous = vm.haPromotion;
      if (!previous || previous.transferId !== transferId)
        throw new AppError('故障接管栅栏已变化', 409);
      vm.haPromotion = haPromotionSchema.parse({ ...previous, ...patch,
        updatedAt: new Date().toISOString() });
      try { await this.ports.save(); }
      catch (error) { vm.haPromotion = previous; throw error; }
      this.ports.changed();
      return vm.haPromotion;
    });
  }
  async releaseHaPromotion(id: string, transferId: string) {
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id), previous = vm.haPromotion;
      this.ports.requireStopped(id);
      if (!previous || previous.transferId !== transferId)
        throw new AppError('故障接管栅栏已变化', 409);
      delete vm.haPromotion;
      try { await this.ports.save(); }
      catch (error) { vm.haPromotion = previous; throw error; }
      this.ports.changed();
      return { released: true };
    });
  }
  async retireHaReplica(id: string, raw: unknown) {
    const identity = haRetirementSchema.omit({ retiredAt: true }).parse(raw);
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id);
      this.ports.requireStopped(id);
      if (vm.migrationOrigin?.sourceHostId !== identity.sourceHostId ||
          vm.migrationOrigin.transferId !== identity.transferId ||
          vm.migrationOrigin.sourceVmId !== identity.sourceVmId ||
          vm.migrationOrigin.snapshotId !== identity.snapshotId ||
          vm.migrationOrigin.diskSha256 !== identity.sha256)
        throw new AppError('故障副本身份与导入记录不一致', 409);
      if (vm.haRetirement) return vm.haRetirement;
      vm.haRetirement = { ...identity, retiredAt: new Date().toISOString() };
      try { await this.ports.save(); }
      catch (error) { delete vm.haRetirement; throw error; }
      this.ports.changed();
      return vm.haRetirement;
    });
  }
}
