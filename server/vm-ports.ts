/**
 * 模块职责：声明虚拟机目录、锁、执行和文件等领域端口，限制领域对核心管理实现的依赖。
 * Module purpose: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
 */
import type { BaseAgent, Client, SFTPWrapper } from 'ssh2';
import type {
  HaPromotion, HaRetirement, HaWitnessEnrollment, LiveMigrationFence,
  MigrationFingerprint, VMConfig, VMRecord, VMStatus, VMView,
} from '../shared/contracts/vm.ts';
import type { SandboxPolicy } from '../shared/sandbox.ts';
import type { qmp } from './qmp.ts';
import type { Engine } from './runtime.ts';
import type { StorageLease } from './storage-runtime.ts';
import type { VmLive } from './vm-reference.ts';
import type { LiveMigrationProjects } from './live-migration-projects.ts';

/** Capabilities are declared independently of the Machines implementation. */
export interface VmRecordPort {
  /**
   * 签名 / Signature: VmRecordPort.get.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 get 的输入与结果契约，所属容器为 VmRecordPort。
   * Purpose: Declares the input/result contract for get in VmRecordPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: VMRecord.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  get(id: string): VMRecord;
  readonly records: ReadonlyMap<string, VMRecord>;
}
export interface VmLockPort {
  /**
   * 签名 / Signature: VmLockPort.isBusy.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 isBusy 的输入与结果契约，所属容器为 VmLockPort。
   * Purpose: Declares the input/result contract for isBusy in VmLockPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  isBusy(id: string): boolean;
  /**
   * 签名 / Signature: VmLockPort.requireStopped.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 requireStopped 的输入与结果契约，所属容器为 VmLockPort。
   * Purpose: Declares the input/result contract for requireStopped in VmLockPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  requireStopped(id: string): void;
  /**
   * 签名 / Signature: VmLockPort.requireUnlocked.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 requireUnlocked 的输入与结果契约，所属容器为 VmLockPort。
   * Purpose: Declares the input/result contract for requireUnlocked in VmLockPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  requireUnlocked(id: string): void;
  /**
   * 签名 / Signature: VmLockPort.incidentLocked.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 incidentLocked 的输入与结果契约，所属容器为 VmLockPort。
   * Purpose: Declares the input/result contract for incidentLocked in VmLockPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  incidentLocked(id: string): boolean;
  /**
   * 签名 / Signature: VmLockPort.locked.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 locked 的输入与结果契约，所属容器为 VmLockPort。
   * Purpose: Declares the input/result contract for locked in VmLockPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; action: () => Promise<T>; allowIncident: boolean optional; allowFailedExecutions: boolean optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  locked<T>(id: string, action:
  /**
   * 中文功能：将 VmLockPort.locked.action 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by VmLockPort.locked.action, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: VmLockPort.locked.action.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<T>`.
   */
  () => Promise<T>, allowIncident?: boolean, allowFailedExecutions?: boolean): Promise<T>;
}
export interface VmEventPort {
  /**
   * 签名 / Signature: VmEventPort.on.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 on 的输入与结果契约，所属容器为 VmEventPort。
   * Purpose: Declares the input/result contract for on in VmEventPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: event: string | symbol; listener: (...args: any[]) => void
   * 输出 / Returns: this.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  on(event: string | symbol, listener:
  /**
   * 中文功能：为 VmEventPort.on.listener 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for VmEventPort.on.listener using its declared event data.
   * 所属 / Owner: VmEventPort.on.listener.
   * 输入 / Inputs: ...args: any[].
   * 结果 / Result: `void`.
   */
  (...args: any[]) => void): this;
  /**
   * 签名 / Signature: VmEventPort.off.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 off 的输入与结果契约，所属容器为 VmEventPort。
   * Purpose: Declares the input/result contract for off in VmEventPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: event: string | symbol; listener: (...args: any[]) => void
   * 输出 / Returns: this.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  off(event: string | symbol, listener:
  /**
   * 中文功能：为 VmEventPort.off.listener 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for VmEventPort.off.listener using its declared event data.
   * 所属 / Owner: VmEventPort.off.listener.
   * 输入 / Inputs: ...args: any[].
   * 结果 / Result: `void`.
   */
  (...args: any[]) => void): this;
  /**
   * 签名 / Signature: VmEventPort.emit.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 emit 的输入与结果契约，所属容器为 VmEventPort。
   * Purpose: Declares the input/result contract for emit in VmEventPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: event: string | symbol; args: any[]
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  emit(event: string | symbol, ...args: any[]): boolean;
}
export interface VmCatalogPort extends VmRecordPort {
  readonly closing: boolean;
  readonly live: ReadonlyMap<string, VmLive>;
  readonly logs: ReadonlyMap<string, string>;
  /**
   * 签名 / Signature: VmCatalogPort.state.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 state 的输入与结果契约，所属容器为 VmCatalogPort。
   * Purpose: Declares the input/result contract for state in VmCatalogPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: VMStatus.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  state(id: string): VMStatus;
  /**
   * 签名 / Signature: VmCatalogPort.list.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 list 的输入与结果契约，所属容器为 VmCatalogPort。
   * Purpose: Declares the input/result contract for list in VmCatalogPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<VMView[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  list(): Promise<VMView[]>;
  /**
   * 签名 / Signature: VmCatalogPort.view.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 view 的输入与结果契约，所属容器为 VmCatalogPort。
   * Purpose: Declares the input/result contract for view in VmCatalogPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  view(id: string): Promise<VMView>;
  /**
   * 签名 / Signature: VmCatalogPort.commandline.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 commandline 的输入与结果契约，所属容器为 VmCatalogPort。
   * Purpose: Declares the input/result contract for commandline in VmCatalogPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { name: string; machine: string; architecture: 'x86_64' | 'aarch64'; memoryMiB: number; cpus: number; hardware: VMConfig['hardware']; resourceArguments: string[]; deviceArgume….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  commandline(id: string): {
    name: string; machine: string; architecture: 'x86_64' | 'aarch64'; memoryMiB: number;
    cpus: number; hardware: VMConfig['hardware']; resourceArguments: string[];
    deviceArguments: string[]; audioArguments: string[]; display: string; diskOptions: string;
    diskEncryption: { format: string; secretName: string } | undefined;
    diskPersistence: 'persistent' | 'discard-on-stop'; accelerator: VMConfig['accelerator'];
    disk: string; forwards: VMConfig['forwards'];
  };
  /**
   * 签名 / Signature: VmCatalogPort.boot.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 boot 的输入与结果契约，所属容器为 VmCatalogPort。
   * Purpose: Declares the input/result contract for boot in VmCatalogPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: string | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  boot?(id: string): string | undefined;
}
export interface VmLifecyclePort {
  /**
   * 签名 / Signature: VmLifecyclePort.create.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 create 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for create in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: input: unknown; sandbox: SandboxPolicy optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  create(input: unknown, sandbox?: SandboxPolicy): Promise<VMView>;
  /**
   * 签名 / Signature: VmLifecyclePort.update.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 update 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for update in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; input: unknown | ((current: VMRecord) => unknown); guard: (current: VMRecord) => void optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  update(id: string, input: unknown | (
  /**
   * 中文功能：接收当前 VMRecord 并构造更新数据，具体更新提交由所属 update 契约负责。
   * English: Receives the current VMRecord and constructs update data, with commit governed by the enclosing update contract.
   * 所属 / Owner: VmLifecyclePort.update.input.
   * 输入 / Inputs: current: VMRecord.
   * 结果 / Result: `unknown`.
   */
  (current: VMRecord) => unknown), guard?:
  /**
   * 中文功能：在 VmLifecyclePort.update.guard 所属变更前核验原输入或身份条件；未通过以异常或 Promise 拒绝阻止变更。
   * English: Checks original input/identity conditions before the change owned by VmLifecyclePort.update.guard; exceptions or Promise rejection prevent that change.
   * 所属 / Owner: VmLifecyclePort.update.guard.
   * 输入 / Inputs: current: VMRecord.
   * 结果 / Result: `void`.
   */
  (current: VMRecord) => void): Promise<VMView>;
  /**
   * 签名 / Signature: VmLifecyclePort.delete.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 delete 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for delete in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; expected: MigrationFingerprint optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  delete(id: string, expected?: MigrationFingerprint): Promise<void>;
  /**
   * 签名 / Signature: VmLifecyclePort.start.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 start 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for start in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  start(id: string): Promise<VMView>;
  /**
   * 签名 / Signature: VmLifecyclePort.stop.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 stop 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for stop in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; force: boolean optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  stop(id: string, force?: boolean): Promise<VMView>;
  /**
   * 签名 / Signature: VmLifecyclePort.suspend.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 suspend 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for suspend in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  suspend(id: string): Promise<VMView>;
  /**
   * 签名 / Signature: VmLifecyclePort.resume.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 resume 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for resume in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  resume(id: string): Promise<VMView>;
  /**
   * 签名 / Signature: VmLifecyclePort.terminateSandbox.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 terminateSandbox 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for terminateSandbox in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  terminateSandbox(id: string): Promise<void>;
  /**
   * 签名 / Signature: VmLifecyclePort.enterMaintenance.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 enterMaintenance 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for enterMaintenance in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  /**
   * 中文功能：声明维护准入能力，调用后返回结束本次维护范围的释放函数。
   * English: Declares maintenance admission returning a release function that ends that maintenance scope.
   * 所属 / Owner: VmLifecyclePort.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `() => void`.
   */
  enterMaintenance():
  /**
   * 中文功能：结束由 enterMaintenance 返回的原维护范围。
   * English: Ends the original maintenance scope returned by enterMaintenance.
   * 所属 / Owner: VmLifecyclePort.enterMaintenance.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void;
  /**
   * 签名 / Signature: VmLifecyclePort.setIncidentLockdown.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 setIncidentLockdown 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for setIncidentLockdown in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; locked: boolean
   * 输出 / Returns: Promise<{ locked: boolean; stopped: boolean }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  setIncidentLockdown(id: string, locked: boolean): Promise<{ locked: boolean; stopped: boolean }>;
  /**
   * 签名 / Signature: VmLifecyclePort.organize.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 organize 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for organize in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  organize(id: string, input: unknown): Promise<VMView>;
  /**
   * 签名 / Signature: VmLifecyclePort.bootGuard.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 bootGuard 的输入与结果契约，所属容器为 VmLifecyclePort。
   * Purpose: Declares the input/result contract for bootGuard in VmLifecyclePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; reset: boolean optional
   * 输出 / Returns: Promise<{ attempts: number[]; failures: number; limit: number; windowSeconds: number; blocked: boolean; retryAt: string | null; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  bootGuard(id: string, reset?: boolean): Promise<{
    attempts: number[]; failures: number; limit: number; windowSeconds: number;
    blocked: boolean; retryAt: string | null;
  }>;
}
export type VmExecutionResult = { stdout: string; stderr: string; code: number };
export interface VmTransportPort {
  /**
   * 签名 / Signature: VmTransportPort.connect.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 connect 的输入与结果契约，所属容器为 VmTransportPort。
   * Purpose: Declares the input/result contract for connect in VmTransportPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; timeout: number optional; signal: AbortSignal optional; agentPath: string | BaseAgent optional
   * 输出 / Returns: Promise<Client>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  connect(id: string, timeout?: number, signal?: AbortSignal, agentPath?: string | BaseAgent): Promise<Client>;
  /**
   * 签名 / Signature: VmTransportPort.exec.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 exec 的输入与结果契约，所属容器为 VmTransportPort。
   * Purpose: Declares the input/result contract for exec in VmTransportPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; command: string; timeout: number optional; signal: AbortSignal optional; output: (data: string) => void optional; agentPath: string | BaseAgent optional
   * 输出 / Returns: Promise<VmExecutionResult>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  exec(id: string, command: string, timeout?: number, signal?: AbortSignal,
    output?:
    /**
     * 中文功能：将 exec 的数据、日志或阶段文本交付给调用方通知通道。
     * English: Delivers exec data/log/phase text through the caller notification channel.
     * 所属 / Owner: VmTransportPort.exec.output.
     * 输入 / Inputs: data: string.
     * 结果 / Result: `void`.
     */
    (data: string) => void, agentPath?: string | BaseAgent): Promise<VmExecutionResult>;
  /**
   * 签名 / Signature: VmTransportPort.execInput.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 execInput 的输入与结果契约，所属容器为 VmTransportPort。
   * Purpose: Declares the input/result contract for execInput in VmTransportPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; command: string; input: Buffer; timeout: number optional; signal: AbortSignal optional; output: (data: string) => void optional; agentPath: string | BaseAgent optional
   * 输出 / Returns: Promise<VmExecutionResult>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  execInput(id: string, command: string, input: Buffer, timeout?: number, signal?: AbortSignal,
    output?:
    /**
     * 中文功能：将 execInput 的数据、日志或阶段文本交付给调用方通知通道。
     * English: Delivers execInput data/log/phase text through the caller notification channel.
     * 所属 / Owner: VmTransportPort.execInput.output.
     * 输入 / Inputs: data: string.
     * 结果 / Result: `void`.
     */
    (data: string) => void, agentPath?: string | BaseAgent): Promise<VmExecutionResult>;
  /**
   * 签名 / Signature: VmTransportPort.sftp.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 sftp 的输入与结果契约，所属容器为 VmTransportPort。
   * Purpose: Declares the input/result contract for sftp in VmTransportPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; work: (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>; signal: AbortSignal optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  sftp<T>(id: string, work:
  /**
   * 中文功能：将 VmTransportPort.sftp.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by VmTransportPort.sftp.work, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: VmTransportPort.sftp.work.
   * 输入 / Inputs: sftp: SFTPWrapper; transportSignal?: AbortSignal.
   * 结果 / Result: `Promise<T>`.
   */
  (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export interface VmGuestFilesPort {
  /**
   * 签名 / Signature: VmGuestFilesPort.files.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 files 的输入与结果契约，所属容器为 VmGuestFilesPort。
   * Purpose: Declares the input/result contract for files in VmGuestFilesPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; path: string
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  files(id: string, path: string): Promise<unknown>;
  /**
   * 签名 / Signature: VmGuestFilesPort.readGuestFile.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 readGuestFile 的输入与结果契约，所属容器为 VmGuestFilesPort。
   * Purpose: Declares the input/result contract for readGuestFile in VmGuestFilesPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; path: string
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  readGuestFile(id: string, path: string): Promise<string>;
  /**
   * 签名 / Signature: VmGuestFilesPort.writeGuestFile.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 writeGuestFile 的输入与结果契约，所属容器为 VmGuestFilesPort。
   * Purpose: Declares the input/result contract for writeGuestFile in VmGuestFilesPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; path: string; content: string; overwrite: boolean optional; expectedVersion: string optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  writeGuestFile(id: string, path: string, content: string, overwrite?: boolean, expectedVersion?: string): Promise<void>;
  /**
   * 签名 / Signature: VmGuestFilesPort.beforeFileReplace.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 beforeFileReplace 的输入与结果契约，所属容器为 VmGuestFilesPort。
   * Purpose: Declares the input/result contract for beforeFileReplace in VmGuestFilesPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: callback: (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  /**
   * 中文功能：声明文件替换前钩子登记能力，返回解除本次登记的函数。
   * English: Declares pre-file-replacement hook registration, returning a function that removes this registration.
   * 所属 / Owner: VmGuestFilesPort.
   * 输入 / Inputs: callback: (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>.
   * 结果 / Result: `() => void`.
   */
  beforeFileReplace(callback:
  /**
   * 中文功能：在替换实例文件前接收实例、路径、原 SFTP 能力及取消信号，异步完成替换前钩子。
   * English: Receives VM/path/original SFTP capability/cancellation before file replacement and asynchronously completes the pre-replacement hook.
   * 所属 / Owner: VmGuestFilesPort.beforeFileReplace.callback.
   * 输入 / Inputs: id: string; path: string; ftp: SFTPWrapper; signal?: AbortSignal.
   * 结果 / Result: `Promise<void>`.
   */
  (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>):
  /**
   * 中文功能：解除 beforeFileReplace 的原钩子登记。
   * English: Removes the original beforeFileReplace hook registration.
   * 所属 / Owner: VmGuestFilesPort.beforeFileReplace.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void;
  /**
   * 签名 / Signature: VmGuestFilesPort.fileReplacing.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 fileReplacing 的输入与结果契约，所属容器为 VmGuestFilesPort。
   * Purpose: Declares the input/result contract for fileReplacing in VmGuestFilesPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; path: string; ftp: SFTPWrapper; signal: AbortSignal optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  fileReplacing(id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal): Promise<void>;
}
export interface VmRescuePort {
  /**
   * 签名 / Signature: VmRescuePort.withRescue.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 withRescue 的输入与结果契约，所属容器为 VmRescuePort。
   * Purpose: Declares the input/result contract for withRescue in VmRescuePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: sourceId: string; signal: AbortSignal; phase: (text: string) => void; work: (rescueId: string, signal: AbortSignal) => Promise<T>; diagnostic: (text: string) => void optional; readOnlyDisk: string optional; comparisonDisk: string optional; targetDisk: { file: string; writable: boolean } optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  withRescue<T>(sourceId: string, signal: AbortSignal, phase:
  /**
   * 中文功能：将 withRescue 的数据、日志或阶段文本交付给调用方通知通道。
   * English: Delivers withRescue data/log/phase text through the caller notification channel.
   * 所属 / Owner: VmRescuePort.withRescue.phase.
   * 输入 / Inputs: text: string.
   * 结果 / Result: `void`.
   */
  (text: string) => void,
    work:
    /**
     * 中文功能：将 VmRescuePort.withRescue.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
     * English: Supplies work to the original context owned by VmRescuePort.withRescue.work, returning the declared business result or asynchronous rejection.
     * 所属 / Owner: VmRescuePort.withRescue.work.
     * 输入 / Inputs: rescueId: string; signal: AbortSignal.
     * 结果 / Result: `Promise<T>`.
     */
    (rescueId: string, signal: AbortSignal) => Promise<T>, diagnostic?:
    /**
     * 中文功能：将 withRescue 的数据、日志或阶段文本交付给调用方通知通道。
     * English: Delivers withRescue data/log/phase text through the caller notification channel.
     * 所属 / Owner: VmRescuePort.withRescue.diagnostic.
     * 输入 / Inputs: text: string.
     * 结果 / Result: `void`.
     */
    (text: string) => void,
    readOnlyDisk?: string, comparisonDisk?: string, targetDisk?: { file: string; writable: boolean }): Promise<T>;
}
export type CreatedVmSnapshot = {
  id: `${string}-${string}-${string}-${string}-${string}`; name: string; createdAt: string;
  diskGiB: number; pendingResize: boolean; consistency: 'vmstate' | 'offline' | 'filesystem';
  stateFingerprint?: string;
};
export interface VmSnapshotPort {
  /**
   * 签名 / Signature: VmSnapshotPort.snapshotIdentity.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 snapshotIdentity 的输入与结果契约，所属容器为 VmSnapshotPort。
   * Purpose: Declares the input/result contract for snapshotIdentity in VmSnapshotPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; snapshotId: string optional
   * 输出 / Returns: Promise<{ key: string; seed: Buffer }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  snapshotIdentity(id: string, snapshotId?: string): Promise<{ key: string; seed: Buffer }>;
  /**
   * 签名 / Signature: VmSnapshotPort.snapshot.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 snapshot 的输入与结果契约，所属容器为 VmSnapshotPort。
   * Purpose: Declares the input/result contract for snapshot in VmSnapshotPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: Promise<CreatedVmSnapshot>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  snapshot(id: string, name: string): Promise<CreatedVmSnapshot>;
  /**
   * 签名 / Signature: VmSnapshotPort.onlineSnapshot.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 onlineSnapshot 的输入与结果契约，所属容器为 VmSnapshotPort。
   * Purpose: Declares the input/result contract for onlineSnapshot in VmSnapshotPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: Promise<CreatedVmSnapshot>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  onlineSnapshot(id: string, name: string): Promise<CreatedVmSnapshot>;
  /**
   * 签名 / Signature: VmSnapshotPort.memorySnapshot.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 memorySnapshot 的输入与结果契约，所属容器为 VmSnapshotPort。
   * Purpose: Declares the input/result contract for memorySnapshot in VmSnapshotPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: Promise<CreatedVmSnapshot>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  memorySnapshot(id: string, name: string): Promise<CreatedVmSnapshot>;
  /**
   * 签名 / Signature: VmSnapshotPort.restore.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 restore 的输入与结果契约，所属容器为 VmSnapshotPort。
   * Purpose: Declares the input/result contract for restore in VmSnapshotPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; snapshotId: string; backup: boolean optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  restore(id: string, snapshotId: string, backup?: boolean): Promise<VMView>;
  /**
   * 签名 / Signature: VmSnapshotPort.restoreMemory.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 restoreMemory 的输入与结果契约，所属容器为 VmSnapshotPort。
   * Purpose: Declares the input/result contract for restoreMemory in VmSnapshotPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; snapshotId: string; backup: boolean optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  restoreMemory(id: string, snapshotId: string, backup?: boolean): Promise<VMView>;
  /**
   * 签名 / Signature: VmSnapshotPort.editSnapshot.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 editSnapshot 的输入与结果契约，所属容器为 VmSnapshotPort。
   * Purpose: Declares the input/result contract for editSnapshot in VmSnapshotPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; snapshotId: string; patch: { name: string; note: string } | null
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  editSnapshot(id: string, snapshotId: string, patch: { name: string; note: string } | null): Promise<VMView>;
  /**
   * 签名 / Signature: VmSnapshotPort.recordMerge.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 recordMerge 的输入与结果契约，所属容器为 VmSnapshotPort。
   * Purpose: Declares the input/result contract for recordMerge in VmSnapshotPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; origin: NonNullable<VMRecord['mergeOrigin']>
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  recordMerge(id: string, origin: NonNullable<VMRecord['mergeOrigin']>): Promise<VMView>;
}
export interface VmSnapshotStatePort {
  /**
   * 签名 / Signature: VmSnapshotStatePort.capture.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 capture 的输入与结果契约，所属容器为 VmSnapshotStatePort。
   * Purpose: Declares the input/result contract for capture in VmSnapshotStatePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  capture(id: string, snapshotId: string): Promise<void>;
  /**
   * 签名 / Signature: VmSnapshotStatePort.prepareRestore.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 prepareRestore 的输入与结果契约，所属容器为 VmSnapshotStatePort。
   * Purpose: Declares the input/result contract for prepareRestore in VmSnapshotStatePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: Promise<() => Promise<void>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  prepareRestore(id: string, snapshotId: string): Promise<
  /**
   * 中文功能：在快照恢复发布前完成提供者准备的异步钩子。
   * English: Asynchronous provider-preparation hook before publishing a snapshot restore.
   * 所属 / Owner: VmSnapshotStatePort.prepareRestore.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<void>`.
   */
  () => Promise<void>>;
  /**
   * 签名 / Signature: VmSnapshotStatePort.remove.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 remove 的输入与结果契约，所属容器为 VmSnapshotStatePort。
   * Purpose: Declares the input/result contract for remove in VmSnapshotStatePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  remove(id: string, snapshotId: string): Promise<void>;
  /**
   * 签名 / Signature: VmSnapshotStatePort.ensureOnlineAllowed.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 ensureOnlineAllowed 的输入与结果契约，所属容器为 VmSnapshotStatePort。
   * Purpose: Declares the input/result contract for ensureOnlineAllowed in VmSnapshotStatePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  ensureOnlineAllowed(id: string): Promise<void>;
}
export type VmDiskEncryptionStatus = {
  enabled: boolean; encrypted: boolean; format: 'luks' | undefined; secretName: string | undefined;
  keyAvailable: boolean; stopped: boolean; snapshots: number;
};
export type VmStorageMove = { moved: boolean; from: string; to: string; cleanupPending: boolean; vm: VMView };
export interface VmStoragePort {
  /**
   * 签名 / Signature: VmStoragePort.withDiskSecret.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 withDiskSecret 的输入与结果契约，所属容器为 VmStoragePort。
   * Purpose: Declares the input/result contract for withDiskSecret in VmStoragePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: vm: VMRecord; action: (file: string) => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  withDiskSecret<T>(vm: VMRecord, action:
  /**
   * 中文功能：将 VmStoragePort.withDiskSecret.action 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by VmStoragePort.withDiskSecret.action, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: VmStoragePort.withDiskSecret.action.
   * 输入 / Inputs: file: string.
   * 结果 / Result: `Promise<T>`.
   */
  (file: string) => Promise<T>): Promise<T>;
  /**
   * 签名 / Signature: VmStoragePort.diskEncryptionStatus.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 diskEncryptionStatus 的输入与结果契约，所属容器为 VmStoragePort。
   * Purpose: Declares the input/result contract for diskEncryptionStatus in VmStoragePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<VmDiskEncryptionStatus>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  diskEncryptionStatus(id: string): Promise<VmDiskEncryptionStatus>;
  /**
   * 签名 / Signature: VmStoragePort.encryptDisk.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 encryptDisk 的输入与结果契约，所属容器为 VmStoragePort。
   * Purpose: Declares the input/result contract for encryptDisk in VmStoragePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; secretName: string; signal: AbortSignal optional
   * 输出 / Returns: Promise<VmDiskEncryptionStatus>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  encryptDisk(id: string, secretName: string, signal?: AbortSignal): Promise<VmDiskEncryptionStatus>;
  /**
   * 签名 / Signature: VmStoragePort.resize.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 resize 的输入与结果契约，所属容器为 VmStoragePort。
   * Purpose: Declares the input/result contract for resize in VmStoragePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; diskGiB: number; signal: AbortSignal optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  resize(id: string, diskGiB: number, signal?: AbortSignal): Promise<VMView>;
  /**
   * 签名 / Signature: VmStoragePort.completeResize.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 completeResize 的输入与结果契约，所属容器为 VmStoragePort。
   * Purpose: Declares the input/result contract for completeResize in VmStoragePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  completeResize(id: string): Promise<void>;
  /**
   * 签名 / Signature: VmStoragePort.moveStoragePool.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 moveStoragePool 的输入与结果契约，所属容器为 VmStoragePort。
   * Purpose: Declares the input/result contract for moveStoragePool in VmStoragePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; targetPoolId: string; signal: AbortSignal optional; log: (text: string) => void optional
   * 输出 / Returns: Promise<VmStorageMove>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  moveStoragePool(id: string, targetPoolId: string, signal?: AbortSignal, log?:
  /**
   * 中文功能：将 moveStoragePool 的数据、日志或阶段文本交付给调用方通知通道。
   * English: Delivers moveStoragePool data/log/phase text through the caller notification channel.
   * 所属 / Owner: VmStoragePort.moveStoragePool.log.
   * 输入 / Inputs: text: string.
   * 结果 / Result: `void`.
   */
  (text: string) => void): Promise<VmStorageMove>;
  /**
   * 签名 / Signature: VmStoragePort.importDisk.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 importDisk 的输入与结果契约，所属容器为 VmStoragePort。
   * Purpose: Declares the input/result contract for importDisk in VmStoragePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: input: unknown; disk: string; options: { signal?: AbortSignal; pendingResize?: boolean; storage?: StorageLease } optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  importDisk(input: unknown, disk: string, options?: { signal?: AbortSignal; pendingResize?: boolean; storage?: StorageLease }): Promise<VMView>;
  /**
   * 签名 / Signature: VmStoragePort.adopt.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 adopt 的输入与结果契约，所属容器为 VmStoragePort。
   * Purpose: Declares the input/result contract for adopt in VmStoragePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: input: unknown; disk: string; key: string; seed: Buffer; project: unknown optional; pendingResize: boolean optional; projects: { active: string; projects: { id: string; name: string }[]; configs: Record<string, u… optional; migrationOrigin: VMRecord['migrationOrigin'] optional; diskEncryption: VMRecord['diskEncryption'] optional; branchOrigin: VMRecord['branchOrigin'] optional; storage: StorageLease optional; signal: AbortSignal optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  adopt(input: unknown, disk: string, key: string, seed: Buffer, project?: unknown, pendingResize?: boolean,
    projects?: { active: string; projects: { id: string; name: string }[]; configs: Record<string, unknown> },
    migrationOrigin?: VMRecord['migrationOrigin'], diskEncryption?: VMRecord['diskEncryption'],
    branchOrigin?: VMRecord['branchOrigin'], storage?: StorageLease, signal?: AbortSignal): Promise<VMView>;
}
export type VmHotplugResult =
  | { kind: 'cpu'; current: number; maximum: number;
      slots: { type: string; props: Record<string, number>; 'qom-path'?: string; 'vcpus-count': number }[];
      canAdd: boolean; accelerator: 'tcg' | 'whpx'; guestPossible: number; devices?: undefined }
  | { kind: 'cpu'; code: number; ready: boolean; current: number; maximum: number;
      guestOnline: number | null; guestCode: number; warning?: string; slots?: undefined;
      canAdd?: undefined; accelerator?: undefined; guestPossible?: undefined; devices?: undefined }
  | { kind: 'memory'; current: number; maximum: number;
      devices: { type: string; data: { slot?: number; size?: number; id?: string } }[];
      canAdd: boolean; accelerator: 'tcg' | 'whpx'; slots?: undefined; guestPossible?: undefined }
  | { kind: 'memory'; code: number; ready: boolean; current: number; maximum: number;
      devices: unknown; guestMemoryKiB: number | null; warning?: string; slots?: undefined;
      canAdd?: undefined; accelerator?: undefined; guestPossible?: undefined };
export interface VmHardwarePort {
  /**
   * 签名 / Signature: VmHardwarePort.configureHardware.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 configureHardware 的输入与结果契约，所属容器为 VmHardwarePort。
   * Purpose: Declares the input/result contract for configureHardware in VmHardwarePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; input: unknown; expected: { hardware: unknown; memoryMiB: number; architecture?: string } optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  configureHardware(id: string, input: unknown, expected?: { hardware: unknown; memoryMiB: number; architecture?: string }): Promise<VMView>;
  /**
   * 签名 / Signature: VmHardwarePort.hotplug.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 hotplug 的输入与结果契约，所属容器为 VmHardwarePort。
   * Purpose: Declares the input/result contract for hotplug in VmHardwarePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; kind: 'cpu' | 'memory'; target: number optional; signal: AbortSignal optional
   * 输出 / Returns: Promise<VmHotplugResult>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  hotplug(id: string, kind: 'cpu' | 'memory', target?: number, signal?: AbortSignal): Promise<VmHotplugResult>;
  /**
   * 签名 / Signature: VmHardwarePort.setForwards.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 setForwards 的输入与结果契约，所属容器为 VmHardwarePort。
   * Purpose: Declares the input/result contract for setForwards in VmHardwarePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; input: unknown; expected: VMConfig['forwards'] optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  setForwards(id: string, input: unknown, expected?: VMConfig['forwards']): Promise<VMView>;
  /**
   * 签名 / Signature: VmHardwarePort.setMemoryTarget.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 setMemoryTarget 的输入与结果契约，所属容器为 VmHardwarePort。
   * Purpose: Declares the input/result contract for setMemoryTarget in VmHardwarePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; memoryMiB: number
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  setMemoryTarget(id: string, memoryMiB: number): Promise<VMView>;
  /**
   * 签名 / Signature: VmHardwarePort.reserveHostPorts.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 reserveHostPorts 的输入与结果契约，所属容器为 VmHardwarePort。
   * Purpose: Declares the input/result contract for reserveHostPorts in VmHardwarePort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: owner: string; ports: Iterable<number>
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  reserveHostPorts(owner: string, ports: Iterable<number>): void;
}
export interface VmMigrationPort {
  /**
   * 签名 / Signature: VmMigrationPort.migrationFingerprint.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 migrationFingerprint 的输入与结果契约，所属容器为 VmMigrationPort。
   * Purpose: Declares the input/result contract for migrationFingerprint in VmMigrationPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<MigrationFingerprint>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  migrationFingerprint(id: string): Promise<MigrationFingerprint>;
  /**
   * 签名 / Signature: VmMigrationPort.createIncomingTarget.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 createIncomingTarget 的输入与结果契约，所属容器为 VmMigrationPort。
   * Purpose: Declares the input/result contract for createIncomingTarget in VmMigrationPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: input: unknown; identity: { key: string; seed: Buffer }; source: { sourceHostId: string; sourceVmId: string; transferId: string; completionProtocol?: …; projects: LiveMigrationProjects optional; organization: VMRecord['organization'] optional
   * 输出 / Returns: Promise<VMRecord>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createIncomingTarget(input: unknown, identity: { key: string; seed: Buffer },
    source: { sourceHostId: string; sourceVmId: string; transferId: string; completionProtocol?: 1 },
    projects?: LiveMigrationProjects, organization?: VMRecord['organization']): Promise<VMRecord>;
  /**
   * 签名 / Signature: VmMigrationPort.startIncoming.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 startIncoming 的输入与结果契约，所属容器为 VmMigrationPort。
   * Purpose: Declares the input/result contract for startIncoming in VmMigrationPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  startIncoming(id: string): Promise<VMView>;
  /**
   * 签名 / Signature: VmMigrationPort.completeIncoming.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 completeIncoming 的输入与结果契约，所属容器为 VmMigrationPort。
   * Purpose: Declares the input/result contract for completeIncoming in VmMigrationPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; query: typeof qmp optional; sessionId: string optional
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  completeIncoming(id: string, query?: typeof qmp, sessionId?: string): Promise<VMView>;
  /**
   * 签名 / Signature: VmMigrationPort.fenceForLiveMigration.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 fenceForLiveMigration 的输入与结果契约，所属容器为 VmMigrationPort。
   * Purpose: Declares the input/result contract for fenceForLiveMigration in VmMigrationPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; raw: unknown; query: typeof qmp optional
   * 输出 / Returns: Promise<LiveMigrationFence>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  fenceForLiveMigration(id: string, raw: unknown, query?: typeof qmp): Promise<LiveMigrationFence>;
}
export interface VmHaPort {
  /**
   * 签名 / Signature: VmHaPort.beforeHaStart.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 beforeHaStart 的输入与结果契约，所属容器为 VmHaPort。
   * Purpose: Declares the input/result contract for beforeHaStart in VmHaPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: guard: (id: string) => Promise<void>
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  /**
   * 中文功能：声明 HA 启动前 guard 登记能力，返回解除该 guard 的函数。
   * English: Declares before-HA-start guard registration, returning its deregistration function.
   * 所属 / Owner: VmHaPort.
   * 输入 / Inputs: guard: (id: string) => Promise<void>.
   * 结果 / Result: `() => void`.
   */
  beforeHaStart(guard:
  /**
   * 中文功能：在 VmHaPort.beforeHaStart.guard 所属变更前核验原输入或身份条件；未通过以异常或 Promise 拒绝阻止变更。
   * English: Checks original input/identity conditions before the change owned by VmHaPort.beforeHaStart.guard; exceptions or Promise rejection prevent that change.
   * 所属 / Owner: VmHaPort.beforeHaStart.guard.
   * 输入 / Inputs: id: string.
   * 结果 / Result: `Promise<void>`.
   */
  (id: string) => Promise<void>):
  /**
   * 中文功能：解除 beforeHaStart 的原 guard 登记。
   * English: Removes the original beforeHaStart guard registration.
   * 所属 / Owner: VmHaPort.beforeHaStart.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void;
  /**
   * 签名 / Signature: VmHaPort.enrollHaWitness.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 enrollHaWitness 的输入与结果契约，所属容器为 VmHaPort。
   * Purpose: Declares the input/result contract for enrollHaWitness in VmHaPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; targetHostId: string; failureThreshold: number
   * 输出 / Returns: Promise<HaWitnessEnrollment>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  enrollHaWitness(id: string, targetHostId: string, failureThreshold: number): Promise<HaWitnessEnrollment>;
  /**
   * 签名 / Signature: VmHaPort.releaseHaWitness.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 releaseHaWitness 的输入与结果契约，所属容器为 VmHaPort。
   * Purpose: Declares the input/result contract for releaseHaWitness in VmHaPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; targetHostId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  releaseHaWitness(id: string, targetHostId: string): Promise<void>;
  /**
   * 签名 / Signature: VmHaPort.fenceForHa.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 fenceForHa 的输入与结果契约，所属容器为 VmHaPort。
   * Purpose: Declares the input/result contract for fenceForHa in VmHaPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; raw: HaPromotion; guard: () => Promise<void> | void optional
   * 输出 / Returns: Promise<HaPromotion>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  fenceForHa(id: string, raw: HaPromotion, guard?:
  /**
   * 中文功能：在 VmHaPort.fenceForHa.guard 所属变更前核验原输入或身份条件；未通过以异常或 Promise 拒绝阻止变更。
   * English: Checks original input/identity conditions before the change owned by VmHaPort.fenceForHa.guard; exceptions or Promise rejection prevent that change.
   * 所属 / Owner: VmHaPort.fenceForHa.guard.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<void> | void`.
   */
  () => Promise<void> | void): Promise<HaPromotion>;
  /**
   * 签名 / Signature: VmHaPort.updateHaPromotion.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 updateHaPromotion 的输入与结果契约，所属容器为 VmHaPort。
   * Purpose: Declares the input/result contract for updateHaPromotion in VmHaPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; transferId: string; patch: Pick<HaPromotion, 'status'> & { error?: string }
   * 输出 / Returns: Promise<HaPromotion>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  updateHaPromotion(id: string, transferId: string, patch: Pick<HaPromotion, 'status'> & { error?: string }): Promise<HaPromotion>;
  /**
   * 签名 / Signature: VmHaPort.releaseHaPromotion.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 releaseHaPromotion 的输入与结果契约，所属容器为 VmHaPort。
   * Purpose: Declares the input/result contract for releaseHaPromotion in VmHaPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; transferId: string
   * 输出 / Returns: Promise<{ released: boolean }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  releaseHaPromotion(id: string, transferId: string): Promise<{ released: boolean }>;
  /**
   * 签名 / Signature: VmHaPort.retireHaReplica.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 retireHaReplica 的输入与结果契约，所属容器为 VmHaPort。
   * Purpose: Declares the input/result contract for retireHaReplica in VmHaPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: Promise<HaRetirement>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  retireHaReplica(id: string, raw: unknown): Promise<HaRetirement>;
  /**
   * 签名 / Signature: VmHaPort.startHaReplica.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 startHaReplica 的输入与结果契约，所属容器为 VmHaPort。
   * Purpose: Declares the input/result contract for startHaReplica in VmHaPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; identity: { sourceHostId: string; transferId: string; sourceVmId: string; snapshotId: string; s…
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  startHaReplica(id: string, identity: { sourceHostId: string; transferId: string; sourceVmId: string; snapshotId: string; sha256: string }): Promise<VMView>;
}
export interface VmEnginePort {
  readonly engine: Pick<Engine, 'run' | 'runStatus' | 'version' | 'aarch64Available' | 'whpxAvailable'>;
}
export type VmStoragePoolView = {
  currentPoolId: string | null;
  pendingCleanup: { vmId: string; sourcePoolId: string; targetPoolId: string; addedAt: string }[];
  pools: { id: string; name: string; root: string; createdAt: string; available: boolean;
    totalBytes: number | null; freeBytes: number | null; allocatedBytes: number;
    vms: { id: string; name: string; diskBytes: number }[] }[];
};
export type VmStoragePoolRunResult = VmStoragePoolView & { ready: boolean; executed: boolean } & (
  | { created?: undefined; removed?: undefined; cleanup?: undefined; moved?: undefined }
  | { created: { id: string; name: string; root: string; createdAt: string };
      removed?: undefined; cleanup?: undefined; moved?: undefined }
  | { removed: string; created?: undefined; cleanup?: undefined; moved?: undefined }
  | { cleanup: { completed: string[]; errors: { vmId: string; message: string }[] };
      created?: undefined; removed?: undefined; moved?: undefined }
  | { moved: VmStorageMove; created?: undefined; removed?: undefined; cleanup?: undefined }
);
export interface VmStoragePoolsPort {
  /**
   * 签名 / Signature: VmStoragePoolsPort.view.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 view 的输入与结果契约，所属容器为 VmStoragePoolsPort。
   * Purpose: Declares the input/result contract for view in VmStoragePoolsPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string optional
   * 输出 / Returns: Promise<VmStoragePoolView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  view(id?: string): Promise<VmStoragePoolView>;
  /**
   * 签名 / Signature: VmStoragePoolsPort.directory.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 directory 的输入与结果契约，所属容器为 VmStoragePoolsPort。
   * Purpose: Declares the input/result contract for directory in VmStoragePoolsPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string; poolId: string optional
   * 输出 / Returns: string.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  directory(id: string, poolId?: string): string;
  /**
   * 签名 / Signature: VmStoragePoolsPort.conflictsWithDataTarget.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 conflictsWithDataTarget 的输入与结果契约，所属容器为 VmStoragePoolsPort。
   * Purpose: Declares the input/result contract for conflictsWithDataTarget in VmStoragePoolsPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: target: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  conflictsWithDataTarget(target: string): boolean;
  /**
   * 签名 / Signature: VmStoragePoolsPort.run.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 run 的输入与结果契约，所属容器为 VmStoragePoolsPort。
   * Purpose: Declares the input/result contract for run in VmStoragePoolsPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string | undefined; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional; log: (text: string) => void optional
   * 输出 / Returns: Promise<VmStoragePoolRunResult>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  run(id: string | undefined, input: unknown, action: 'check' | 'run', signal?: AbortSignal, log?:
  /**
   * 中文功能：将 run 的数据、日志或阶段文本交付给调用方通知通道。
   * English: Delivers run data/log/phase text through the caller notification channel.
   * 所属 / Owner: VmStoragePoolsPort.run.log.
   * 输入 / Inputs: text: string.
   * 结果 / Result: `void`.
   */
  (text: string) => void): Promise<VmStoragePoolRunResult>;
  /**
   * 签名 / Signature: VmStoragePoolsPort.hasPendingCleanup.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 hasPendingCleanup 的输入与结果契约，所属容器为 VmStoragePoolsPort。
   * Purpose: Declares the input/result contract for hasPendingCleanup in VmStoragePoolsPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: id: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  hasPendingCleanup(id: string): boolean;
  /**
   * 签名 / Signature: VmStoragePoolsPort.ensure.
   * 功能：为声明虚拟机目录、锁、执行和文件等领域端口声明 ensure 的输入与结果契约，所属容器为 VmStoragePoolsPort。
   * Purpose: Declares the input/result contract for ensure in VmStoragePoolsPort. Module responsibility: Declares VM catalogue, lock, execution and file ports, limiting domain dependence on manager internals.
   * 输入 / Inputs: poolId: string optional
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  ensure(poolId?: string): Promise<string>;
}

/** Consumer ports intentionally expose only each domain's actual VM capabilities. */
export type VmSnapshotInspectionPort = Pick<VmRecordPort, 'get'> &
  Pick<VmLockPort, 'isBusy' | 'requireStopped' | 'requireUnlocked' | 'locked'> &
  Pick<VmEventPort, 'on' | 'off'> & VmEnginePort & VmRescuePort & Pick<VmTransportPort, 'exec'>;
export type VmSnapshotMergePort = Omit<VmSnapshotInspectionPort, 'on' | 'off'> &
  Pick<VmRecordPort, 'records'> & Pick<VmSnapshotPort, 'recordMerge'> & Pick<VmLifecyclePort, 'delete'>;
export type VmSnapshotReplicationPort = Pick<VmRecordPort, 'get'> &
  Pick<VmLockPort, 'locked' | 'requireStopped'> & Pick<VmSnapshotPort, 'snapshotIdentity'>;
export type VmStoragePoolOwnerPort = VmRecordPort & Pick<VmLockPort, 'locked'> & Pick<VmStoragePort, 'moveStoragePool'>;
