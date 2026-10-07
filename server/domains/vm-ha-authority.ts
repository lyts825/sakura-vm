/**
 * 模块职责：维护实例 HA 见证、栅栏和接管归属；更改必须匹配原登记身份。
 * Module purpose: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
 */
import { z } from 'zod';
import { haPromotionSchema, haRetirementSchema, haWitnessEnrollmentSchema, type HaPromotion, type VMRecord } from '../../shared/contracts/vm.ts';
import { AppError } from '../../shared/errors.ts';

export type VmHaAuthorityPorts = {
  /**
   * 签名 / Signature: VmHaAuthorityPorts.get.
   * 功能：为维护实例 HA 见证、栅栏和接管归属声明 get 的输入与结果契约，所属容器为 VmHaAuthorityPorts。
   * Purpose: Declares the input/result contract for get in VmHaAuthorityPorts. Module responsibility: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
   * 输入 / Inputs: id: string
   * 输出 / Returns: VMRecord.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  get(id: string): VMRecord;
  /**
   * 签名 / Signature: VmHaAuthorityPorts.requireStopped.
   * 功能：为维护实例 HA 见证、栅栏和接管归属声明 requireStopped 的输入与结果契约，所属容器为 VmHaAuthorityPorts。
   * Purpose: Declares the input/result contract for requireStopped in VmHaAuthorityPorts. Module responsibility: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
   * 输入 / Inputs: id: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  requireStopped(id: string): void;
  /**
   * 签名 / Signature: VmHaAuthorityPorts.locked.
   * 功能：为维护实例 HA 见证、栅栏和接管归属声明 locked 的输入与结果契约，所属容器为 VmHaAuthorityPorts。
   * Purpose: Declares the input/result contract for locked in VmHaAuthorityPorts. Module responsibility: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
   * 输入 / Inputs: id: string; work: () => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  locked<T>(id: string, work:
  /**
   * 中文功能：将 VmHaAuthorityPorts.locked.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by VmHaAuthorityPorts.locked.work, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: VmHaAuthorityPorts.locked.work.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<T>`.
   */
  () => Promise<T>): Promise<T>;
  /**
   * 签名 / Signature: VmHaAuthorityPorts.save.
   * 功能：为维护实例 HA 见证、栅栏和接管归属声明 save 的输入与结果契约，所属容器为 VmHaAuthorityPorts。
   * Purpose: Declares the input/result contract for save in VmHaAuthorityPorts. Module responsibility: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  save(): Promise<void>;
  /**
   * 签名 / Signature: VmHaAuthorityPorts.changed.
   * 功能：为维护实例 HA 见证、栅栏和接管归属声明 changed 的输入与结果契约，所属容器为 VmHaAuthorityPorts。
   * Purpose: Declares the input/result contract for changed in VmHaAuthorityPorts. Module responsibility: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  changed(): void;
};

/** Owns durable witness, takeover and retirement receipts without owning VM processes. */
export class VmHaAuthority {
  /**
   * 入口 / Entry: VmHaAuthority.constructor.
   * 功能：建立 VmHaAuthority 的维护实例 HA 见证、栅栏和接管归属上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the VmHaAuthority context for this module's responsibility: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: ports: VmHaAuthorityPorts
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private readonly ports: VmHaAuthorityPorts) {}
  /**
   * 入口 / Entry: VmHaAuthority.enrollHaWitness.
   * 功能：在维护实例 HA 见证、栅栏和接管归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); if (vm.haWitnessEnrollment)…` 供上层消费（`VmHaAuthority`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmHaAuthority`; this entry produces `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); if (vm.haWitnessEnrollment)…` for its caller. Module context: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `z.number().int().min().max().parse`, `z.number().int().min().max` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `z.number().int().min().max().parse`, `z.number().int().min().max`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; targetHostId: string; failureThreshold: number
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); if (vm.haWitnessEnrollment)…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async enrollHaWitness(id: string, targetHostId: string, failureThreshold: number) {
    z.uuid().parse(targetHostId);
    z.number().int().min(2).max(10).parse(failureThreshold);
    /**
     * 入口 / Entry: VmHaAuthority.enrollHaWitness.callback@22.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `vm.haWitnessEnrollment`.
     * 副作用 / Effects: `this.ports.save`; 更新 / updates `vm.haWitnessEnrollment`.
     * 拒绝 / Refusals: 条件 / conditions `vm.haWitnessEnrollment`; `vm.haWitnessEnrollment.targetHostId !== targetHostId || vm.haWitnessEnrollment.failureThreshold !== failureThreshold`; 异常 / errors `new AppError('实例已登记其他 HA 见证目标，须先撤销', 409)`; `error`.
     * 失败处理：catch 分支执行 `delete vm.haWitnessEnrollment;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `delete vm.haWitnessEnrollment;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: VmHaAuthority.releaseHaWitness.
   * 功能：把本层请求转交 `this.ports.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.ports.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; targetHostId: string
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id), previous = vm.haWitnessEnrollment; if (!previous || previo…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async releaseHaWitness(id: string, targetHostId: string) {
    /**
     * 入口 / Entry: VmHaAuthority.releaseHaWitness.callback@41.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.ports.save`; 更新 / updates `vm.haWitnessEnrollment`.
     * 拒绝 / Refusals: 条件 / conditions `!previous || previous.targetHostId !== targetHostId`; 异常 / errors `new AppError('实例见证登记已变化', 409)`; `error`.
     * 失败处理：catch 分支执行 `vm.haWitnessEnrollment = previous;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `vm.haWitnessEnrollment = previous;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: VmHaAuthority.fenceForHa.
   * 功能：在维护实例 HA 见证、栅栏和接管归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); await guard?.(); if (vm.haP…` 供上层消费（`VmHaAuthority`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmHaAuthority`; this entry produces `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); await guard?.(); if (vm.haP…` for its caller. Module context: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
   * 处理：通过 `haPromotionSchema.parse`, `this.ports.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haPromotionSchema.parse`, `this.ports.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; raw: HaPromotion; guard: () => Promise<void> | void optional
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); await guard?.(); if (vm.haP…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async fenceForHa(id: string, raw: HaPromotion,
    guard?: () => Promise<void> | void) {
    const promotion = haPromotionSchema.parse(raw);
    /**
     * 入口 / Entry: VmHaAuthority.fenceForHa.callback@54.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `vm.haPromotion`; `promotion`.
     * 副作用 / Effects: `this.ports.save`; 更新 / updates `vm.haPromotion`.
     * 拒绝 / Refusals: 条件 / conditions `vm.haPromotion`; `vm.haPromotion.transferId !== promotion.transferId`; 异常 / errors `new AppError('来源实例已有其他故障接管栅栏', 409)`; `error`.
     * 失败处理：catch 分支执行 `delete vm.haPromotion;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `delete vm.haPromotion;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: VmHaAuthority.updateHaPromotion.
   * 功能：把本层请求转交 `this.ports.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.ports.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; transferId: string; patch: Pick<HaPromotion, 'status'> & { error?: string }
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id), previous = vm.haPromotion; if (!previous || previous.trans…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async updateHaPromotion(id: string, transferId: string,
    patch: Pick<HaPromotion, 'status'> & { error?: string }) {
    /**
     * 入口 / Entry: VmHaAuthority.updateHaPromotion.callback@72.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `vm.haPromotion`.
     * 副作用 / Effects: `this.ports.save`; 更新 / updates `vm.haPromotion`.
     * 拒绝 / Refusals: 条件 / conditions `!previous || previous.transferId !== transferId`; 异常 / errors `new AppError('故障接管栅栏已变化', 409)`; `error`.
     * 失败处理：catch 分支执行 `vm.haPromotion = previous;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `vm.haPromotion = previous;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: VmHaAuthority.releaseHaPromotion.
   * 功能：把本层请求转交 `this.ports.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.ports.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; transferId: string
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id), previous = vm.haPromotion; this.ports.requireStopped(id); …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async releaseHaPromotion(id: string, transferId: string) {
    /**
     * 入口 / Entry: VmHaAuthority.releaseHaPromotion.callback@85.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ released: true }`.
     * 副作用 / Effects: `this.ports.save`; 更新 / updates `vm.haPromotion`.
     * 拒绝 / Refusals: 条件 / conditions `!previous || previous.transferId !== transferId`; 异常 / errors `new AppError('故障接管栅栏已变化', 409)`; `error`.
     * 失败处理：catch 分支执行 `vm.haPromotion = previous;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `vm.haPromotion = previous;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: VmHaAuthority.retireHaReplica.
   * 功能：在维护实例 HA 见证、栅栏和接管归属中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); if (vm.migrationOrigin?.sou…` 供上层消费（`VmHaAuthority`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `VmHaAuthority`; this entry produces `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); if (vm.migrationOrigin?.sou…` for its caller. Module context: Owns VM witness enrollment, fencing and promotion identity; updates must match the original registration.
   * 处理：通过 `haRetirementSchema.omit().parse`, `haRetirementSchema.omit`, `this.ports.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haRetirementSchema.omit().parse`, `haRetirementSchema.omit`, `this.ports.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); if (vm.migrationOrigin?.sou…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async retireHaReplica(id: string, raw: unknown) {
    const identity = haRetirementSchema.omit({ retiredAt: true }).parse(raw);
    /**
     * 入口 / Entry: VmHaAuthority.retireHaReplica.callback@99.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `vm.haRetirement`.
     * 副作用 / Effects: `this.ports.save`; 更新 / updates `vm.haRetirement`.
     * 拒绝 / Refusals: 条件 / conditions `vm.migrationOrigin?.sourceHostId !== identity.sourceHostId || vm.migrationOrigin.transferId !== identity.transferId || vm.mig…`; 异常 / errors `new AppError('故障副本身份与导入记录不一致', 409)`; `error`.
     * 失败处理：catch 分支执行 `delete vm.haRetirement;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `delete vm.haRetirement;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
