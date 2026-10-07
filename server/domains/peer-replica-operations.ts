/**
 * 模块职责：封装远端故障副本的核验、激活与退役，操作前核对原副本身份。
 * Module purpose: Wraps remote replica checks, activation and retirement, verifying the original replica identity before effects.
 */
import { AppError } from '../../shared/errors.ts';
import { peerReplicaActivationInput, peerActivationResult, peerActivationCheckResult, peerRetirementResult } from '../../shared/contracts/peer-transfer.ts';

export type PeerReplicaPorts = {
  /**
   * 签名 / Signature: PeerReplicaPorts.requireAvailable.
   * 功能：为封装远端故障副本的核验、激活与退役声明 requireAvailable 的输入与结果契约，所属容器为 PeerReplicaPorts。
   * Purpose: Declares the input/result contract for requireAvailable in PeerReplicaPorts. Module responsibility: Wraps remote replica checks, activation and retirement, verifying the original replica identity before effects.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  requireAvailable(): void;
  /**
   * 签名 / Signature: PeerReplicaPorts.request.
   * 功能：为封装远端故障副本的核验、激活与退役声明 request 的输入与结果契约，所属容器为 PeerReplicaPorts。
   * Purpose: Declares the input/result contract for request in PeerReplicaPorts. Module responsibility: Wraps remote replica checks, activation and retirement, verifying the original replica identity before effects.
   * 输入 / Inputs: peerId: string; path: string; input: unknown; timeoutMs: number optional
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  request(peerId: string, path: string, input: unknown, timeoutMs?: number): Promise<unknown>;
};

/** Replica receipts remain domain authority; transport only carries validated requests and replies. */
export class PeerReplicaOperations {
  /**
   * 入口 / Entry: PeerReplicaOperations.constructor.
   * 功能：建立 PeerReplicaOperations 的封装远端故障副本的核验、激活与退役上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PeerReplicaOperations context for this module's responsibility: Wraps remote replica checks, activation and retirement, verifying the original replica identity before effects. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: ports: PeerReplicaPorts
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private readonly ports: PeerReplicaPorts) {}
  /**
   * 入口 / Entry: PeerReplicaOperations.check.
   * 功能：在封装远端故障副本的核验、激活与退役中，核对调用资格、输入或资源归属；本入口产生 `result` 供上层消费（`PeerReplicaOperations`）。
   * Purpose: Checks admission, input or resource ownership in `PeerReplicaOperations`; this entry produces `result` for its caller. Module context: Wraps remote replica checks, activation and retirement, verifying the original replica identity before effects.
   * 处理：通过 `this.ports.requireAvailable`, `peerReplicaActivationInput.parse`, `peerActivationCheckResult.parse`, `this.ports.request` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.requireAvailable`, `peerReplicaActivationInput.parse`, `peerActivationCheckResult.parse`, `this.ports.request`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `this.ports.request`.
   * 拒绝 / Refusals: 条件 / conditions `result.id !== value.remoteVmId`; 异常 / errors `new AppError('远端故障副本身份已变化', 409)`.
   */
  async check(peerId: string, input: unknown) {
    this.ports.requireAvailable();
    const value = peerReplicaActivationInput.parse(input);
    const result = peerActivationCheckResult.parse(await this.ports.request(peerId, '/peer/replica-activate-check', value));
    if (result.id !== value.remoteVmId) throw new AppError('远端故障副本身份已变化', 409);
    return result;
  }
  /**
   * 入口 / Entry: PeerReplicaOperations.activate.
   * 功能：在封装远端故障副本的核验、激活与退役中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`PeerReplicaOperations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PeerReplicaOperations`; this entry produces `result` for its caller. Module context: Wraps remote replica checks, activation and retirement, verifying the original replica identity before effects.
   * 处理：通过 `this.ports.requireAvailable`, `peerReplicaActivationInput.parse`, `peerActivationResult.parse`, `this.ports.request` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.requireAvailable`, `peerReplicaActivationInput.parse`, `peerActivationResult.parse`, `this.ports.request`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `this.ports.request`.
   * 拒绝 / Refusals: 条件 / conditions `result.id !== value.remoteVmId`; 异常 / errors `new AppError('远端故障副本身份已变化', 409)`.
   */
  async activate(peerId: string, input: unknown) {
    this.ports.requireAvailable();
    const value = peerReplicaActivationInput.parse(input);
    const result = peerActivationResult.parse(await this.ports.request(peerId, '/peer/replica-activate', value, 30_000));
    if (result.id !== value.remoteVmId) throw new AppError('远端故障副本身份已变化', 409);
    return result;
  }
  /**
   * 入口 / Entry: PeerReplicaOperations.retire.
   * 功能：在封装远端故障副本的核验、激活与退役中，结束、撤销或清理本次拥有的领域资源；本入口产生 `result` 供上层消费（`PeerReplicaOperations`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PeerReplicaOperations`; this entry produces `result` for its caller. Module context: Wraps remote replica checks, activation and retirement, verifying the original replica identity before effects.
   * 处理：通过 `this.ports.requireAvailable`, `peerReplicaActivationInput.parse`, `peerRetirementResult.parse`, `this.ports.request` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.requireAvailable`, `peerReplicaActivationInput.parse`, `peerRetirementResult.parse`, `this.ports.request`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `this.ports.request`.
   * 拒绝 / Refusals: 条件 / conditions `result.id !== value.remoteVmId`; 异常 / errors `new AppError('远端故障副本身份已变化', 409)`.
   */
  async retire(peerId: string, input: unknown) {
    this.ports.requireAvailable();
    const value = peerReplicaActivationInput.parse(input);
    const result = peerRetirementResult.parse(await this.ports.request(peerId, '/peer/replica-retire', value, 30_000));
    if (result.id !== value.remoteVmId) throw new AppError('远端故障副本身份已变化', 409);
    return result;
  }
}
