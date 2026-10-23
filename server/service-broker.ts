/**
 * 模块职责：按服务契约发布系统及官方插件实现，把普通公开调用绑定到提供者与消费者的当前激活，并跟踪双方 scope 中的未完成异步借用。
 * Module purpose: Publishes system/official implementations through service contracts, binding ordinary public calls to current provider/consumer activations and observing pending asynchronous borrows in both scopes.
 * 能力边界：契约快照决定可读取成员，嵌套返回继续封装；独立清理回执可在撤销后释放原资源，普通业务权限不会因此恢复。
 * Capability boundary: Contract snapshots determine readable members and nested returns remain wrapped; separate cleanup receipts can release original resources after revocation without restoring ordinary business authority.
 */
import { AppError } from '../shared/errors.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { ServiceContract, ServiceRef } from './service-ref.ts';
import { serviceRef } from './service-ref.ts';
import type { PluginInstance } from './plugin-instance.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import { withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { resourceContext, withResourceContext } from './host-runtime/context.ts';
import { isVmLiveView } from './vm-reference.ts';
import { cleanupReceipt, isCleanupReceipt } from './cleanup-receipt.ts';
import { PUBLIC_SERVICE_CONTRACTS } from './public-service-members.ts';
import { officialServiceContracts, systemServiceContracts } from './service-contracts.ts';

type Registration = { instance: PluginInstance; version: number; contract: ServiceContract<any>; value: unknown };
/**
 * 入口 / Entry: serviceRefForSystem.
 * 功能：为给定系统插件 id 构造固定键名 service 的引用，供 system 查询系统服务目录。
 * Purpose: Builds a reference to the fixed service key for a system plugin id, used by system-directory lookup.
 * 输入与结果：id 是提供者标识；使用宿主声明的规范版本与契约，未登记的内部服务沿用版本 1。
 * Inputs/result: Uses the host's canonical version and contract; unregistered internal services retain the version-one fallback.
 */
const serviceRefForSystem = <T>(id: string) => {
  const contract = systemServiceContracts[id as keyof typeof systemServiceContracts] as ServiceContract<T> | undefined;
  return contract ? serviceRef(id, 'service', contract) : serviceRef<T>(id, 'service');
};
const hidden = new Set(['constructor', '__proto__', 'prototype', 'machines', 'engine', 'options']);
const lifecycle = new Set(['init', 'close', 'file', 'dataFile']);
// 转发的公共代理仍按能力处理，保留其契约及内层代理检查，不能按普通空对象复制。
// A handle forwarded by another provider remains executable and keeps its original checks.
const publicHandles = new WeakMap<object, ServiceContract<any>>();
/**
 * 入口 / Entry: descriptor.
 * 功能：把嵌套属性或方法结果的契约标识解析为宿主公共契约；直接声明的契约对象原样传递。
 * Purpose: Resolves a nested-property or method-result contract id through the host public-contract table; passes inline contract objects through.
 * 输入与结果：value 可省略；未知字符串标识或未指定契约返回 undefined，由 wrap 决定数据复制或能力封装。
 * Inputs/result: value is optional; an unknown string id or absent contract yields undefined, leaving wrap to classify data and capabilities.
 */
const descriptor = (value?: string | ServiceContract<any>) => typeof value === 'string' ? PUBLIC_SERVICE_CONTRACTS[value] : value;
/**
 * 入口 / Entry: snapshotContract.
 * 功能：复制并冻结服务的成员、可选成员、方法及嵌套契约描述，注册后修改原声明不能扩大代理的公开成员。
 * Purpose: Copies and freezes member, optional-member, method and nested-contract declarations so later edits to the original declaration cannot widen the proxy interface.
 * 输入与结果：contract 是已选定的提供者契约；seen 是本次复制的对象到快照映射；返回冻结的契约快照。服务实现 value 本身不被冻结。
 * Inputs/result: contract is the selected provider contract; seen maps source objects to snapshots during this copy; returns a frozen contract snapshot without freezing the service implementation.
 * 设计：先登记尚未完成的快照，再递归 properties/returns，保留共享引用并终止循环契约图；字符串引用仍由 descriptor 在使用时解析。
 * Design: Records the incomplete snapshot before traversing properties/returns, preserving shared references and terminating cyclic contract graphs; string references remain resolved by descriptor at use time.
 */
function snapshotContract<T>(contract: ServiceContract<T>, seen = new WeakMap<object, ServiceContract<any>>()): ServiceContract<T> {
  if (seen.has(contract)) return seen.get(contract)!;
  const snapshot: any = { id: contract.id, version: contract.version, members: Object.freeze([...contract.members]),
    optional: contract.optional && Object.freeze([...contract.optional]), methods: contract.methods && Object.freeze([...contract.methods]) };
  seen.set(contract, snapshot);
  /**
   * 入口 / Entry: snapshotContract.nested.
   * 功能：复制 properties 或 returns 的成员到契约映射，并冻结新映射；字符串 id 保留，内联契约递归使用同一个 seen。
   * Purpose: Copies and freezes a properties/returns member-to-contract map; preserves string ids and recursively snapshots inline contracts with the same seen map.
   * 输入与结果：values 可省略；省略时返回 undefined，否则返回独立的冻结映射，避免原映射后续变更影响已注册服务。
   * Inputs/result: absent values returns undefined; otherwise returns a separate frozen map so mutations of the original map do not affect the registered service.
   */
  const nested = (values?: Readonly<Record<string, string | ServiceContract<any>>>) => values &&
    Object.freeze(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value : snapshotContract(value, seen)])));
  snapshot.properties = nested(contract.properties); snapshot.returns = nested(contract.returns);
  return Object.freeze(snapshot);
}
/**
 * 入口 / Entry: executable.
 * 功能：判断一个返回值是否需要作为可执行能力封装，而不是按普通数据对象复制；函数、已知公共代理及非普通类实例均判为能力。
 * Purpose: Classifies a returned value for capability wrapping rather than ordinary-data copying; functions, known public proxies and non-plain class instances count as capabilities.
 * 输入与结果：value 是待分类值，seen 防止对普通对象的枚举值重复递归；返回 boolean，AbortSignal 和 VM live view 在此分类中例外返回 false。
 * Inputs/result: value is inspected and seen prevents repeated recursion through enumerable plain-object values; returns a boolean, treating AbortSignal and VM live views as exceptions here.
 * 边界：普通对象/数组只递归 Object.values；这是封装分支的分类规则，并非对符号、不可枚举属性或任意对象执行能力的完整验证。
 * Boundary: Plain objects/arrays recurse through Object.values only; this is a wrapping classification, not exhaustive validation of symbols, non-enumerable properties or arbitrary executable object behavior.
 */
function executable(value: any, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (value instanceof AbortSignal || isVmLiveView(value)) return false;
  if (publicHandles.has(value)) return true;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return true;
  return Object.values(value).some((item) => executable(item, seen));
}
/** 引用绑定提供者与消费者这两次具体激活；嵌套方法及保存的回调沿用同一普通权能检查。 / References are bound to two exact activations, including nested methods and cached callbacks. */
export class ServiceBroker {
  private registrations = new Map<string, Registration>();
  private borrows = new Map<PluginInstance, number>();
  private originals = new WeakMap<object, object>();
  private handles = new WeakMap<PluginInstance, Map<Registration, unknown>>();
  /**
   * 入口 / Entry: ServiceBroker.constructor.
   * 功能：把服务代理绑定到实例目录和插件声明目录；实例目录用于识别当前激活，声明目录用于校验服务所有权和依赖。
   * Purpose: Binds service mediation to the instance directory and manifest catalog: the former identifies current activations, and the latter validates service ownership and dependencies.
   * 输入与结果：directory 与 catalog 由宿主提供；构造时建立空注册表、异步借用计数和代理缓存，尚不发布服务或执行插件代码。
   * Inputs/result: The host supplies directory and catalog; construction starts empty registrations, asynchronous-borrow counts and proxy caches without publishing services or executing plugin code.
   */
  constructor(
    private directory: PluginDirectory,
    private catalog: readonly PluginManifest[],
  ) {}
  /**
   * 入口 / Entry: ServiceBroker.registerSystem.
   * 功能：在系统实例的 identity/service 槽位发布实现；允许 activating 实例注册，拒绝已撤销实例和非 system 来源。
   * Purpose: Publishes an implementation at the system instance identity/service slot; permits activating instances and rejects revoked instances or non-system sources.
   * 输入与结果：instance 是所有者，value 是实现，declared 是可选契约；内置系统契约优先，校验后保存不可变契约快照，无返回值。
   * Inputs/result: instance owns value and declared is an optional contract; the built-in system contract takes precedence, and validation stores an immutable contract snapshot with no return value.
   * 边界与失败：缺少契约或成员无效时抛错；同时提供内置及声明契约时 id/version 必须一致。此入口 set 可替换同槽记录；旧代理通过注册记录对象比较识别替换。
   * Boundary/failure: Missing or invalid contracts throw; when built-in and declared contracts coexist their id/version must match. This set may replace a slot, which old proxies detect by registration-object identity.
   */
  registerSystem<T>(instance: PluginInstance, value: T, declared?: ServiceContract<T>) {
    instance.check(undefined, true);
    if (instance.source !== 'system') throw new Error('系统服务身份无效');
    const expected = systemServiceContracts[instance.pluginId];
    const contract = expected || declared;
    if (!contract) throw new AppError('系统服务缺少公共契约：' + instance.pluginId, 500, 'PLUGIN_SERVICE_CONTRACT_MISSING');
    if (expected && declared && (declared.id !== expected.id || declared.version !== expected.version))
      throw new AppError('系统服务契约不兼容', 409, 'PLUGIN_SERVICE_CONTRACT');
    this.assertContract(contract, value);
    this.registrations.set(`${instance.identity}/service`, { instance, version: contract.version, contract: snapshotContract(contract), value });
  }
  /**
   * 入口 / Entry: ServiceBroker.system.
   * 功能：消费者仅能查询 allowed 中列出的系统服务；查询时要求 services 权限，并允许消费者处于 activating。
   * Purpose: Allows a consumer to look up only listed system services, requiring services permission while permitting the consumer to be activating.
   * 输入与结果：consumer 是借用方，id 是系统提供者，allowed 是其已声明依赖列表；返回受限句柄，缺失或尚未运行的外部提供者返回 undefined。
   * Inputs/result: consumer borrows from system provider id and allowed lists its declared dependencies; returns a restricted handle or undefined when an external provider is absent or not running.
   * 失败：未声明依赖返回 403；可选查询只容忍不可用，仍拒绝契约或服务版本不兼容。
   * Failure: An undeclared dependency raises 403; optional lookup tolerates unavailability but still rejects contract or service-version incompatibility.
   */
  system<T>(consumer: PluginInstance, id: string, allowed: readonly string[]): T | undefined {
    consumer.check('services', true);
    if (!allowed.includes(id))
      throw new AppError('未声明系统服务依赖：' + id, 403, 'PLUGIN_DEPENDENCY_DENIED');
    return this.handle(consumer, serviceRefForSystem(id), true, 'system');
  }
  /**
   * 入口 / Entry: ServiceBroker.register.
   * 功能：插件只能发布自身 manifest.services 已声明的键；注册绑定当前实例 identity，同一次激活的同键重复注册会抛错。
   * Purpose: Lets a plugin publish only its own declared manifest.services keys, binding registration to its instance identity and rejecting duplicate keys in that activation.
   * 输入与结果：instance 是所有者，reference 指定提供者/键/版本，value 是实现；返回传入的 value，注册表保存本 broker 可解包的一层实现及冻结契约。
   * Inputs/result: instance owns the implementation, reference selects provider/key/version, and value is the service; returns the input value while storing the implementation after one broker-known unwrap plus a frozen contract.
   * 契约与失败：内置官方契约优先；自带契约 id 必须与内置一致，最终契约版本必须与 reference.version 一致，并校验必需成员及方法可调用性。
   * Contract/failure: The official contract takes precedence; an inline contract id must match it, the selected contract version must match reference.version, and required members and declared methods are validated.
   */
  register<T>(instance: PluginInstance, reference: ServiceRef<T>, value: T) {
    instance.check(undefined, true);
    const key = reference.key;
    if (reference.pluginId !== instance.pluginId)
      throw new Error(`插件 ${instance.pluginId} 不能注册其他提供者的服务：${reference.pluginId}`);
    const manifest = this.catalog.find((item) => item.id === instance.pluginId);
    if (!manifest?.services.includes(key))
      throw new Error(`插件 ${instance.pluginId} 不能注册非自有服务：${key}`);
    const id = `${instance.identity}/${key}`;
    if (this.registrations.has(id)) throw new Error(`插件服务已注册：${key}`);
    const expected = officialServiceContracts[`${instance.pluginId}/${key}`];
    const contract = expected || reference.contract;
    if (!contract) throw new AppError('插件服务缺少公共契约：' + key, 500, 'PLUGIN_SERVICE_CONTRACT_MISSING');
    if (expected && reference.contract && reference.contract.id !== expected.id)
      throw new AppError('插件服务契约不兼容', 409, 'PLUGIN_SERVICE_CONTRACT');
    if (contract.version !== reference.version)
      throw new AppError('插件服务版本不兼容', 409, 'PLUGIN_SERVICE_VERSION');
    this.assertContract(contract, value);
    this.registrations.set(id, {
      instance,
      value: this.unwrap(value),
      version: reference.version,
      contract: snapshotContract(contract),
    });
    return value;
  }
  /**
   * 入口 / Entry: ServiceBroker.lookup.
   * 功能：依据消费者 manifest 的 requires/optional 查询官方插件服务；自有服务无需依赖项，其他提供者必须声明依赖且其目录声明包含目标服务键。
   * Purpose: Looks up official services through the consumer manifest requires/optional lists; self-service lookup needs no dependency, while other providers must be declared and expose the requested catalog key.
   * 输入与结果：reference 是目标服务，optional 控制不可用时是否返回 undefined；找到依赖时将其插件版本交给 handle 做精确比较，返回受限句柄。
   * Inputs/result: reference selects the service and optional controls whether unavailability returns undefined; the matched dependency version is passed to handle for exact comparison, yielding a restricted handle.
   * 边界：manifest.optional 中存在依赖不会自动设置本次 optional 参数；依赖声明错误和版本不兼容仍抛错，普通成员使用时再检查 services 权限。
   * Boundary: Membership in manifest.optional does not automatically set this call optional; declaration errors and version mismatches still throw, and ordinary member use checks services permission later.
   */
  lookup<T>(
    consumer: PluginInstance,
    manifest: PluginManifest,
    reference: ServiceRef<T>,
    optional = false,
  ): T | undefined {
    consumer.check(undefined, true);
    const dependency = [...manifest.requires, ...manifest.optional].find(
      (item) => item.id === reference.pluginId,
    );
    if (reference.pluginId !== consumer.pluginId && !dependency)
      throw new Error(`插件 ${consumer.pluginId} 未声明依赖 ${reference.pluginId}`);
    if (!this.catalog.some((item) => item.id === reference.pluginId && item.services.includes(reference.key)))
      throw new Error(`插件 ${reference.pluginId} 未声明服务：${reference.key}`);
    return this.handle(consumer, reference, optional, 'official', dependency?.version);
  }
  /**
   * 入口 / Entry: ServiceBroker.handle.
   * 功能：按 source/reference 选取当前提供者及注册记录，核对服务版本、可选 contractId 和依赖插件版本，构造或复用该消费者的公共服务句柄。
   * Purpose: Selects the current provider and registration through source/reference, checks service version, optional contractId and dependency plugin version, and creates or reuses that consumer public handle.
   * 输入与结果：consumer 是借用方；optional 仅使不存在或外部提供者未运行时返回 undefined；source 区分系统/官方目录，dependencyVersion 约束提供者插件版本。其余不兼容抛 409。
   * Inputs/result: consumer is the borrower; optional yields undefined only for missing registrations or non-running external providers; source chooses the system/official directory and dependencyVersion constrains plugin version. Other incompatibilities raise 409.
   * 设计：闭包捕获提供者和注册记录对象，而非只记插件 id；普通读取、方法调用和传入回调使用 check，使停止、重启或替换记录后的旧能力被拒绝。自有服务允许 activating，外部提供者必须 running。
   * Design: Closures capture provider and registration objects rather than only plugin ids; ordinary reads, method calls and forwarded callbacks use check to reject old capabilities after stopping, restarting or registration replacement. Self-service permits activating; external providers must be running.
   * 设计：契约成员控制可见面，嵌套能力沿用同一检查；Promise 的包装及清理工作被双方 scope 观察，以统计提供者的未完成异步借用，缓存句柄本身不算活动借用。
   * Design: Contract members define visibility and nested capabilities retain the same checks; wrapped Promises and cleanup work are observed by both scopes to count pending asynchronous provider borrows. Merely caching a handle does not count as a borrow.
   * 清理边界：已标记的清理回执走独立路径，允许撤销后释放既有资源；这不是恢复普通业务权限。获取缓存句柄本身不执行 check，普通能力在后续使用处检查。
   * Cleanup boundary: Marked cleanup receipts take a separate path so existing resources can be released after revocation; they do not restore ordinary business authority. Returning a cached handle does not itself call check; ordinary capabilities check at later use.
   */
  private handle<T>(
    consumer: PluginInstance,
    reference: ServiceRef<T>,
    optional: boolean,
    source: 'official' | 'system',
    dependencyVersion?: string,
  ): T | undefined {
    const provider = this.directory.get(source, reference.pluginId);
    const entry = provider && this.registrations.get(`${provider.identity}/${reference.key}`);
    if (!entry || (provider !== consumer && provider.phase !== 'running')) {
      if (optional) return undefined;
      throw new AppError(
        `插件服务未运行：${reference.pluginId}.${reference.key}`,
        403,
        'PLUGIN_SERVICE_UNAVAILABLE',
      );
    }
    if (entry.version !== reference.version || (reference.contractId && reference.contractId !== entry.contract.id) || (dependencyVersion && dependencyVersion !== provider!.version))
      throw new AppError('插件服务版本不兼容', 409, 'PLUGIN_SERVICE_VERSION');
    /**
     * 入口 / Entry: ServiceBroker.handle.check.
     * 功能：重新确认借用方的 services 权限与未撤销状态，并确认提供者仍存活；消费者可 activating，仅自调用的提供者也可 activating。
     * Purpose: Rechecks borrower services permission and live state and verifies the provider is live; the consumer may be activating, and an activating provider is allowed only for self-calls.
     * 输入与结果：无参数，使用 handle 捕获的双方实例、reference/source 和 entry；成功无返回值，不满足条件抛权限或撤销错误。
     * Inputs/result: Takes no arguments and uses the captured instances, reference/source and entry; success returns nothing and failure throws permission or revocation errors.
     * 设计：目录中的实例必须仍是同一对象、注册表条目必须仍是同一 entry；因此旧方法闭包和异步回调不能在同 id 的新激活或新注册上续用原能力。
     * Design: The directory instance and registration entry must remain the same objects, preventing retained method closures or asynchronous callbacks from reusing old authority against a new activation or registration with the same id.
     */
    const check = () => {
      consumer.check('services', true);
      provider!.check(undefined, provider === consumer);
      if (
        this.directory.get(source, reference.pluginId) !== provider ||
        this.registrations.get(`${provider!.identity}/${reference.key}`) !== entry
      )
        throw new AppError('插件服务代次已改变', 403, 'PLUGIN_REVOKED');
    };
    let cache = this.handles.get(consumer);
    if (!cache) this.handles.set(consumer, (cache = new Map()));
    if (cache.has(entry)) return cache.get(entry) as T;
    const wrappers = new WeakMap<object, Map<string, any>>(),
      promises = new WeakMap<Promise<unknown>, Promise<unknown>>(),
      receipts = new WeakMap<Function,
      /**
       * 中文功能：缓存零参资源清理回执；返回 void 表示同步成功，返回 Promise<void> 表示调用者可等待的异步清理，拒绝允许后续重试。
       * English: Caches zero-argument cleanup receipts; void denotes synchronous success and Promise<void> denotes awaitable asynchronous cleanup, with rejection permitting later retry.
       * 所属 / Owner: ServiceBroker.handle.receipts.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 结果 / Result: `void | Promise<void>`.
       */
      () => void | Promise<void>>();
    /**
     * 入口 / Entry: ServiceBroker.handle.observe.
     * 功能：为当前提供者增加一个未完成异步借用，将同一个 pending Promise 登记到消费者与提供者 scope，并返回该 Promise。
     * Purpose: Adds one pending asynchronous borrow for this provider, registers the same pending Promise in consumer and provider scopes, and returns it.
     * 输入与结果：operation 是原 Promise；返回保持其结果/拒绝的 finally 派生 Promise，成功或失败结算都会减少计数，归零后删除计数项。
     * Inputs/result: operation is the original Promise; returns its finally-derived Promise preserving resolution/rejection and decrementing the count on either settlement, deleting a zero count.
     * 设计：计数覆盖实际异步等待，不代表持有代理的数量；双方可等待同一工作收尾，此处仅观察，不取消 operation 或强制其完成。
     * Design: Counts actual asynchronous waits rather than held proxies; both scopes can await the same work, but observation neither cancels operation nor forces it to finish.
     */
    const observe = <R>(operation: Promise<R>): Promise<R> => {
      this.borrows.set(provider!, (this.borrows.get(provider!) || 0) + 1);
      // 双方观察同一个派生 Promise；finally 在成功或拒绝时都归还本次异步借用。
      // Both scopes observe one derived Promise; finally releases this asynchronous borrow on resolution or rejection.
      const pending = operation.finally(() => {
        const left = (this.borrows.get(provider!) || 1) - 1;
        if (left) this.borrows.set(provider!, left);
        else this.borrows.delete(provider!);
      });
      consumer.scope.observe(pending);
      provider!.scope.observe(pending);
      return pending;
    };
    /**
     * 入口 / Entry: ServiceBroker.handle.receipt.
     * 功能：把已标记的零参资源清理函数 work 包装为可重复调用的清理回执，同一个原函数在本句柄内只生成一次 unregister。
     * Purpose: Wraps marked zero-argument resource-cleanup work in a repeatable receipt, creating only one unregister per original function within this handle.
     * 输入与结果：work 在提供者的 cleanup 上下文运行；返回无值或 Promise<void> 的回执，成功后再调用不重复释放，异步执行期间共享 pending。
     * Inputs/result: work runs in provider cleanup context; returns a void/Promise<void> receipt that avoids repeated release after success and shares pending while asynchronous cleanup runs.
     * 设计：普通业务检查会在撤销后拒绝，因此清理使用独立权能，并把同一回执留在借用方及所有者 scope（自调用仅登记一次）；任一 abort 都尝试清理，scope 保留失败后的重试入口。
     * Design: Ordinary authority is rejected after revocation, so cleanup uses separate authority and retains the same receipt in borrower and owner scopes, only once for self-calls. Either abort attempts cleanup and scopes retain retry paths after failures.
     * 失败边界：同步抛错或 Promise 拒绝不标记 closed；异步拒绝清除 pending 以允许重试。仅原生 Promise 作为异步清理等待，其他返回值走同步成功分支。
     * Failure boundary: A synchronous throw or Promise rejection does not mark closed; asynchronous rejection clears pending for retry. Only native Promises are awaited as asynchronous cleanup; other return values follow synchronous success.
     */
    const receipt = (work:
    /**
     * 中文功能：原资源的零参释放操作；由 receipt 在提供者 cleanup 上下文执行，抛错或原生 Promise 拒绝表示此次释放未确认。
     * English: Supplies zero-argument release work for the original resource; receipt runs it in provider cleanup context, with a throw or native-Promise rejection leaving release unconfirmed.
     * 所属 / Owner: ServiceBroker.handle.receipt.work.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `unknown`.
     */
    () => unknown) => {
      const existing = receipts.get(work);
      if (existing) return existing;
      let closed = false;
      let pending: Promise<void> | undefined;
      const failures = new Set<unknown>();
      const confirmations: (
      /**
       * 中文功能：成功重试后将先前清理失败的同一 error 对象交给 scope，删除其对应失败记录；参数不是本次新错误。
       * English: After a successful retry, passes an earlier cleanup error object to the scope to remove its matching failure record; the argument is not a newly raised error.
       * 所属 / Owner: ServiceBroker.handle.receipt.confirmations.
       * 输入 / Inputs: error: unknown.
       * 结果 / Result: `void`.
       */
      (error: unknown) => void)[] = [];
      /**
       * 入口 / Entry: ServiceBroker.handle.confirm.
       * 功能：清理成功后把回执标为 closed，将此前失败的同一 error 对象交给双方 scope 的确认函数，撤销这些已被成功重试覆盖的失败记录。
       * Purpose: Marks the receipt closed after successful cleanup and passes each earlier error object to scope acknowledgers, clearing failure records superseded by the successful retry.
       * 输入与结果：无参数；更新闭包状态并清空 failures，无返回值；确认的是该回执的清理结果，不是重新授权插件实例。
       * Inputs/result: Takes no arguments, updates captured state and clears failures, returning nothing; confirms cleanup by this receipt without reauthorizing the plugin instance.
       */
      const confirm = () => {
        closed = true;
        for (const error of failures) for (const confirmed of confirmations) confirmed(error);
        failures.clear();
      };
      /**
       * 入口 / Entry: ServiceBroker.handle.callback@170.
       * 功能：执行 unregister 回执：已成功则直接返回，正在清理则复用 pending，否则在提供者 cleanup 上下文调用原 work。
       * Purpose: Executes unregister: returns immediately after success, reuses pending cleanup, or calls original work in provider cleanup context.
       * 输入与结果：无参数；同步清理成功返回 void，异步清理返回双方 scope 已观察的 Promise<void>；不执行普通 check，避免撤销后无法释放既有资源。
       * Inputs/result: Takes no arguments; successful synchronous cleanup returns void, and asynchronous cleanup returns a Promise<void> observed by both scopes. It avoids ordinary check so revocation does not block release of existing resources.
       * 失败处理：同步错误记入 failures 后原样抛出；异步拒绝记入 failures、清空 pending 并继续拒绝；只有实际成功才 confirm，后续重试不会被失败误标成已关闭。
       * Failure handling: Synchronous errors are recorded and rethrown; asynchronous rejection records the error, clears pending and remains rejected. Only success calls confirm, so failure does not incorrectly close the retry path.
       */
      const unregister = cleanupReceipt(() => {
        if (closed) return;
        if (pending) return pending;
        let completed: unknown;
        try {
          completed = withPluginCleanup(provider!, work);
        } catch (error) {
          failures.add(error);
          throw error;
        }
        if (!(completed instanceof Promise)) {
          confirm();
          return;
        }
        pending = observe(
          // 保留失败对象供成功重试确认，同时清空 pending；否则失败 Promise 会永久挡住重试。
          // Retain the failure object for later acknowledgement and clear pending so a rejected Promise cannot permanently block retries.
          completed.then(confirm, (error) => {
            failures.add(error);
            pending = undefined;
            throw error;
          }),
        );
        return pending;
      });
      receipts.set(work, unregister);
      /**
       * 入口 / Entry: ServiceBroker.handle.revoke.
       * 功能：响应消费者或提供者 abort，立即尝试调用 unregister；若监听注册前任一信号已经 aborted，也调用此入口。
       * Purpose: Responds to consumer/provider abort by attempting unregister immediately, and also handles either signal already being aborted before listener setup.
       * 输入与结果：无参数、无返回值；本次触发会吸收同步错误及异步拒绝，避免 abort 分发造成未处理错误。
       * Inputs/result: Takes no arguments and returns nothing; absorbs synchronous errors and asynchronous rejection from this attempt to avoid unhandled failures during abort dispatch.
       * 设计：吸收错误不等于确认释放；原回执在 scope 中保留且 closed 仍为 false，后续 scope 清理可重试同一资源。
       * Design: Absorbing an error does not confirm release: the original receipt remains retained in scopes and closed remains false, allowing later scope cleanup to retry the same resource.
       */
      const revoke = () => {
        try {
          void Promise.resolve(unregister()).catch(() => {});
        } catch {
          /* Both original scopes retain the receipt for recovery. */
        }
      };
      // scope 统一等待同一 unregister，重试成功后可按原 error 身份清除 scope 的历史失败。
      // Scopes await the same unregister; successful retries can clear historical failures by original error identity.
      confirmations.push(
        consumer.scope.retainCleanup(async () => {
          await unregister();
        }),
      );
      if (provider !== consumer)
        confirmations.push(
          provider!.scope.retainCleanup(async () => {
            await unregister();
          }),
        );
      consumer.signal.addEventListener('abort', revoke, { once: true });
      if (provider !== consumer) provider!.signal.addEventListener('abort', revoke, { once: true });
      if (consumer.signal.aborted || provider!.signal.aborted) revoke();
      return unregister;
    };
    /**
     * 入口 / Entry: ServiceBroker.handle.invoke.
     * 功能：检查双方当前权能，在提供者上下文调用 callable，并按 resultContract 封装结果；receiver 保留方法原始 this，参数其余内容不变。
     * Purpose: Checks current authority, calls callable in provider context, and wraps its result through resultContract; receiver preserves the original method this and other argument contents remain unchanged.
     * 输入与结果：callable/receiver/args 是原函数、接收者和实参；resultContract 可为公共 id 或内联契约；返回封装后的同步结果或 Promise，调用异常原样传播。
     * Inputs/result: callable/receiver/args specify the original function, receiver and arguments; resultContract is a public id or inline contract; returns a wrapped synchronous result or Promise and propagates invocation errors.
     * 设计：仅顶层函数参数被包装，提供者回调它们时切回消费者权限并执行同一个 check，避免保存的回调绕过双方激活检查；不递归改写参数对象。
     * Design: Only top-level function arguments are wrapped, restoring consumer authority with the same check when called by the provider so retained callbacks cannot bypass activation checks; argument objects are not recursively rewritten.
     * 上下文：服务执行权归提供者，caller 标识优先沿用外层调用链，否则取消费者；actor/vm/project 元数据随调用传递，check 也作为后续操作上下文的检查器传入。
     * Context: Service execution belongs to the provider; caller identity retains the outer call chain when present, otherwise uses the consumer. Actor/vm/project metadata is carried through and check is supplied as the operation-context guard for later operations.
     */
    const invoke = (callable: Function, receiver: unknown, args: unknown[], resultContract?: string | ServiceContract<any>) => {
      check();
      const before = resourceContext();
      // 提供者调用实参回调时，恢复消费者上下文；回调保留本次双方实例检查，其他实参原样转发。
      // Argument callbacks restore consumer context when called by the provider and retain both captured-instance checks; other arguments pass through.
      const forwarded = args.map((arg) =>
        typeof arg === 'function'
          ? (...input: unknown[]) =>
              withPluginAuthority(consumer, () => Reflect.apply(arg, undefined, input), check)
          : arg,
      );
      return wrap(
        withPluginAuthority(
          provider!,
          () =>
            withResourceContext(
              {
                callerPluginInstanceId: before?.callerPluginInstanceId || consumer.identity,
                serviceConsumerPluginInstanceId: consumer.source === 'system'
                  ? before?.serviceConsumerPluginInstanceId || consumer.identity : consumer.identity,
                callerPluginGeneration: before?.callerPluginGeneration || consumer.generation,
                actorId: before?.actorId,
                vmId: before?.vmId,
                projectId: before?.projectId,
              },
              () => Reflect.apply(callable, receiver, forwarded),
            ),
          check,
        ), descriptor(resultContract),
      );
    };
    /**
     * 入口 / Entry: ServiceBroker.handle.wrap.
     * 功能：递归区分返回数据、Promise、清理回执和服务能力，保留契约约束及 handle 捕获的双方实例检查。
     * Purpose: Recursively distinguishes returned data, Promises, cleanup receipts and service capabilities while retaining contract constraints and the handle captured-instance checks.
     * 输入与结果：value 是实现或调用结果，declared 是可选嵌套契约；原始值及 Date/视图/Error/AbortSignal/VM live view 原样返回，数组逐项封装。
     * Inputs/result: value is an implementation or call result and declared is an optional nested contract; primitives and Date/views/Error/AbortSignal/VM live views pass through, and array items are wrapped individually.
     * 设计：同一个原生 Promise 只登记一次异步借用，其成功值按相同契约再封装；拒绝保持拒绝。这里不把任意 thenable 统一识别为 Promise，也不在每个数据值返回时重新 check。
     * Design: Each native Promise is observed once and its resolution is wrapped with the same contract; rejection remains rejected. Arbitrary thenables are not uniformly treated as Promises and returning each data value does not itself recheck authority.
     * 数据边界：无声明、无已知代理标记且 executable 为 false 的普通对象复制所有 own keys 的当前值，副本可写；不会冻结数据，也不复制 getter/setter 描述符。
     * Data boundary: An undeclared plain object without a known-handle marker and classified non-executable is copied by current values of all own keys; the copy is writable, with neither data freezing nor getter/setter descriptor copying.
     * 能力设计：按原对象和 contract.id 缓存函数/代理，公开对象只读成员白名单；无契约的能力对象不暴露成员。既有公共代理保留其 WeakMap 契约并作为底层值继续封装，而非当普通空对象复制。
     * Capability design: Functions/proxies are cached by original object and contract.id, exposing only the member whitelist; undeclared capability objects expose no members. An existing public proxy retains its WeakMap contract and is wrapped as an underlying value rather than copied as empty data.
     * 转发检查：包装既有代理时，读取和调用仍经过内层代理及其旧闭包，再叠加本次提供者/消费者检查；WeakMap 标记因此保留原能力约束，不授予跳过原检查的捷径。
     * Forwarding checks: Wrapping an existing proxy still reads/calls through that inner proxy and its original closures while adding the current provider/consumer checks; the WeakMap marker retains capability constraints rather than bypassing original checks.
     */
    const wrap = (value: any, declared?: ServiceContract<any>): any => {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
      if (isCleanupReceipt(value)) return receipt(value);
      if (value instanceof Promise) {
        if (!promises.has(value)) promises.set(value, observe(value.then((result) => wrap(result, declared))));
        return promises.get(value);
      }
      if (Array.isArray(value)) return value.map((item) => wrap(item, declared));
      if (
        value instanceof Date ||
        ArrayBuffer.isView(value) ||
        value instanceof Error ||
        value instanceof AbortSignal ||
        isVmLiveView(value)
      )
        return value;
      // 无显式契约的普通数据走副本分支；已标记代理及类实例走能力分支，避免丢失调用检查。
      // Data responses have no executable authority. Class instances and capability objects do.
      if (
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
        !declared && !publicHandles.has(value) &&
        !executable(value)
      ) {
        const copy: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(value));
        for (const key of Reflect.ownKeys(value))
          Object.defineProperty(copy, key, {
            value: wrap(Reflect.get(value, key)),
            enumerable: Object.getOwnPropertyDescriptor(value, key)?.enumerable,
            writable: true,
            configurable: true,
          });
        return copy;
      }
      const contract = declared || publicHandles.get(value);
      const shapeId = contract?.id || '';
      let objectWrappers = wrappers.get(value);
      if (!objectWrappers) wrappers.set(value, (objectWrappers = new Map()));
      if (objectWrappers.has(shapeId)) return objectWrappers.get(shapeId);
      if (typeof value === 'function') {
        /**
         * 入口 / Entry: ServiceBroker.handle.callable.
         * 功能：给作为服务结果返回的函数建立稳定包装，把每次调用交给 invoke 做双方检查、权限切换和结果封装。
         * Purpose: Creates a stable wrapper for a returned service function, routing each call through invoke for authority checks, context switching and result wrapping.
         * 输入与结果：args 是调用实参；以 undefined 为 receiver 调用原函数并返回 invoke 的结果，未为此独立函数指定方法返回契约。
         * Inputs/result: args are call arguments; invokes the original function with undefined receiver and returns the invoke result, without a method-specific result contract for this standalone function.
         */
        const callable = (...args: unknown[]) => invoke(value, undefined, args);
        objectWrappers.set(shapeId, callable);
        return callable;
      }
      const publicKeys = contract?.members || [];
      const keys = new Set(publicKeys);
      // 空且无原型的目标使默认 ownKeys/描述符/原型反射不暴露底层实现；in 与 get 由独立 trap 控制。
      // An empty null-prototype target keeps default ownKeys/descriptor/prototype reflection from exposing implementation details; in and get use separate traps.
      const proxy = new Proxy(Object.create(null), {
        /**
         * 入口 / Entry: ServiceBroker.handle.has.
         * 功能：为 in 运算报告成员是否同时属于字符串契约白名单且存在于底层实现；符号及未声明成员返回 false。
         * Purpose: Answers the in operator only for string keys both declared by the contract and present on the underlying implementation; symbols and undeclared keys return false.
         * 输入与结果：_target 是空代理目标（不使用），key 是查询键；返回 boolean。此存在性探测不调用 check，也不执行 get 的生命周期成员过滤。
         * Inputs/result: _target is the unused empty proxy target and key is queried; returns a boolean. Existence checks do not call check or apply the get trap lifecycle-member filter.
         */
        has: (_target, key) => typeof key === 'string' && keys.has(key) && Reflect.has(value, key),
        /**
         * 入口 / Entry: ServiceBroker.handle.get.
         * 功能：读取公开成员时先拒绝符号、隐藏键和未声明键；init/close/file/dataFile 仅允许提供者自身或 system:operation-host，普通外部消费者被拒绝。
         * Purpose: Rejects symbols, hidden keys and undeclared keys on reads; init/close/file/dataFile are available only to the provider itself or system:operation-host, rejecting ordinary external consumers.
         * 输入与结果：_target 是空目标，key 是读取键；未声明 then 返回 undefined，防止 Promise 解析把普通句柄误当 thenable；其他违规读取抛 403。
         * Inputs/result: _target is the empty target and key is read; an undeclared then yields undefined so Promise resolution does not mistake an ordinary handle for a thenable; other prohibited reads raise 403.
         * 设计：读取原成员时以原 value 为 getter 的 receiver；普通成员随后 check，属性按 properties 契约封装，方法返回闭包以保留原 this 并在每次调用 invoke 时再次检查。
         * Design: Reads the original member with value as getter receiver; ordinary members then check, properties wrap through properties contracts, and methods return closures preserving original this and rechecking through invoke on each call.
         * 清理与顺序边界：Reflect.get 在 check 前执行，不能宣称 getter 本身先通过存活检查；已标记的清理成员直接返回原回执并跳过普通 check，沿用该回执已有的清理语义。
         * Cleanup/order boundary: Reflect.get executes before check, so getter execution is not preceded by this liveness check; marked cleanup members return the original receipt directly, bypassing ordinary check and retaining that receipt existing cleanup semantics.
         */
        get: (_target, key) => {
          if (key === 'then' && !keys.has('then')) return undefined;
          if (
            typeof key !== 'string' ||
            (hidden.has(key) ||
              !keys.has(key) ||
              (lifecycle.has(key) && provider !== consumer && consumer.identity !== 'system:operation-host'))
          )
            throw new AppError('服务内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
          const member = Reflect.get(value, key, value);
          if (isCleanupReceipt(member)) return member;
          check();
          if (typeof member !== 'function') return wrap(member, descriptor(contract?.properties?.[key]));
          // 每次调用重新核对双方，并以原 value 为 this；保存方法闭包不能绕过撤销检查。
          // Each call rechecks both instances and uses the original value as this; retaining a method closure does not bypass revocation.
          return (...args: unknown[]) => invoke(member, value, args, contract?.returns?.[String(key)]);
        },
        /**
         * 入口 / Entry: ServiceBroker.handle.set.
         * 功能：禁止通过公共句柄写入任意成员，避免消费者替换或扩展提供者实现。
         * Purpose: Rejects all writes through the public handle so a consumer cannot replace or extend provider implementation members.
         * 输入与结果：此 trap 不使用目标/键/值；总是抛 403 PLUGIN_SERVICE_READONLY，不改变底层对象。只读约束针对能力代理，不针对已复制的数据结果。
         * Inputs/result: This trap ignores target/key/value and always throws 403 PLUGIN_SERVICE_READONLY without changing the underlying object; read-only applies to capability proxies rather than copied data results.
         */
        set: () => {
          throw new AppError('公共服务接口不可写', 403, 'PLUGIN_SERVICE_READONLY');
        },
        /**
         * 入口 / Entry: ServiceBroker.handle.defineProperty.
         * 功能：拒绝在公共代理上定义属性，避免借描述符建立契约之外的成员。
         * Purpose: Rejects defining properties on the public proxy, preventing descriptor-based additions outside its contract.
         * 输入与结果：不使用 trap 参数，总返回 false；Reflect.defineProperty 报失败，Object.defineProperty 依 JavaScript 规则抛 TypeError，未修改目标或实现。
         * Inputs/result: Ignores trap arguments and returns false; Reflect.defineProperty reports failure and Object.defineProperty throws TypeError under JavaScript rules, without modifying target or implementation.
         */
        defineProperty: () => false,
        /**
         * 入口 / Entry: ServiceBroker.handle.deleteProperty.
         * 功能：拒绝通过公共代理删除属性，防止消费者改变服务可用成员。
         * Purpose: Rejects property deletion through the public proxy so consumers cannot alter service members.
         * 输入与结果：不使用 trap 参数，总返回 false；Reflect.deleteProperty 报失败，严格模式 delete 依 JavaScript 规则抛 TypeError，未修改底层实现。
         * Inputs/result: Ignores trap arguments and returns false; Reflect.deleteProperty reports failure and strict-mode delete throws TypeError under JavaScript rules, without modifying the implementation.
         */
        deleteProperty: () => false,
      });
      objectWrappers.set(shapeId, proxy);
      if (contract) publicHandles.set(proxy, contract);
      this.originals.set(proxy, value);
      return proxy;
    };
    const handle = wrap(entry.value, entry.contract) as T;
    cache.set(entry, handle);
    return handle;
  }
  /**
   * 入口 / Entry: ServiceBroker.activeBorrows.
   * 功能：读取指定提供者实例尚未结算的异步服务/清理借用数量，供插件生命周期判断仍有多少工作在等待。
   * Purpose: Reads the pending asynchronous service/cleanup borrow count for a provider instance, supporting lifecycle decisions about outstanding work.
   * 输入与结果：instance 按对象身份索引；未登记或已全部结算返回 0。该数字不统计缓存句柄、同步调用或长期持有的对象。
   * Inputs/result: instance is indexed by object identity; returns zero when absent or fully settled. The count excludes cached handles, synchronous calls and long-held objects.
   */
  activeBorrows(instance: PluginInstance) {
    return this.borrows.get(instance) || 0;
  }
  /**
   * 入口 / Entry: ServiceBroker.assertContract.
   * 功能：注册前验证契约基本形状及实现成员：非空 id、正整数版本、members 数组，以及可绑定的对象或函数实现。
   * Purpose: Validates basic contract shape and implementation members before registration: nonempty id, positive integer version, a members array and an object/function implementation.
   * 输入与结果：contract 是最终提供者契约，value 是实现；成功无返回值，缺失或不合法契约抛 500，不在此冻结或修改实现。
   * Inputs/result: contract is the selected provider contract and value its implementation; success returns nothing, invalid/missing contracts raise 500, and the implementation is neither frozen nor modified here.
   * 规则：members 不得重复、含隐藏键或 init；非 optional 成员必须通过 in 存在，methods 列出的已存在成员必须可调用。optional 的缺失不会撤销其白名单资格。
   * Rules: Members must not repeat or include hidden keys/init; non-optional members must exist through in, and present entries listed in methods must be callable. An absent optional member still belongs to the whitelist.
   * 边界：此校验不是完整递归类型验证；in 可接受继承成员，方法检查可能执行 getter，properties/returns 的嵌套描述在 snapshotContract 中复制。
   * Boundary: This is not full recursive type validation; in may accept inherited members, method inspection may execute getters, and nested properties/returns declarations are copied by snapshotContract.
   */
  private assertContract(contract: ServiceContract<any>, value: unknown) {
    if (!contract.id || !Number.isInteger(contract.version) || contract.version < 1 || !Array.isArray(contract.members))
      throw new AppError('服务公共契约声明无效', 500, 'PLUGIN_SERVICE_CONTRACT_MISSING');
    if (!value || (typeof value !== 'object' && typeof value !== 'function'))
      throw new AppError('服务公共契约必须绑定对象', 500, 'PLUGIN_SERVICE_CONTRACT');
    // 可选槽允许缺失；注册后的可见成员来自契约快照，不能由实现或消费者后续扩展。
    // Optional contract slots may be absent. Runtime visibility comes only from this immutable snapshot.
    if (new Set(contract.members).size !== contract.members.length || contract.members.some((key) => hidden.has(key) || key === 'init'))
      throw new AppError('服务公共契约包含内部成员', 500, 'PLUGIN_SERVICE_CONTRACT');
    for (const key of contract.members) {
      if (!(key in value) && !contract.optional?.includes(key))
        throw new AppError('服务缺少声明成员：' + key, 500, 'PLUGIN_SERVICE_CONTRACT');
      if (key in value && contract.methods?.includes(key) && typeof Reflect.get(value, key) !== 'function')
        throw new AppError('服务声明方法不可调用：' + key, 500, 'PLUGIN_SERVICE_CONTRACT');
    }
  }
  /**
   * 入口 / Entry: ServiceBroker.unwrap.
   * 功能：取得本 broker 已登记代理的直接底层对象，供插件注册实现时去掉一层本地包装；不递归拆解转发代理。
   * Purpose: Retrieves the immediate underlying object of a proxy known to this broker, removing one local wrapper when registering an implementation without recursively unwrapping forwarded proxies.
   * 输入与结果：value 为任意值；已知对象代理返回 originals 中的值，否则原样返回。函数包装未写入 originals，因此也原样返回；此入口本身不执行权限检查。
   * Inputs/result: value may be anything; a known object proxy returns its originals entry and other values pass through. Function wrappers are not recorded there and pass through too; this entry performs no authority check itself.
   */
  unwrap<T>(value: T): T {
    return (
      value && (typeof value === 'object' || typeof value === 'function')
        ? this.originals.get(value as object) || value
        : value
    ) as T;
  }
  /**
   * 入口 / Entry: ServiceBroker.remove.
   * 功能：删除所有由指定实例对象持有的注册记录，使捕获这些 entry 的旧公共能力在后续 check 中失效。
   * Purpose: Deletes every registration owned by the specified instance object so old public capabilities capturing those entries fail later checks.
   * 输入与结果：instance 是已退役的所有者；无返回值，仅修改注册表，不调用服务 close、不清空消费者缓存，也不取消已观察的 Promise。
   * Inputs/result: instance is the retiring owner; returns nothing and only changes registrations, without calling service close, clearing consumer caches or cancelling observed Promises.
   * 生命周期：已有异步借用通过自己的 finally 结算计数；资源释放由实例 scope 与清理回执负责，移除注册记录不等于证明物理清理完成。
   * Lifecycle: Existing asynchronous borrows settle their counts through finally; instance scopes and cleanup receipts own resource release, so removing registrations does not prove physical cleanup.
   */
  remove(instance: PluginInstance) {
    for (const [key, entry] of this.registrations)
      if (entry.instance === instance) this.registrations.delete(key);
  }
}
