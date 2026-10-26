/**
 * 模块职责：以显式 requires 图创建并初始化服务，再验证运行/清理依赖的准入与拓扑；构造完成、failed 或 unavailable 均不代表就绪或资源已关闭。
 * Module purpose: Creates/initializes services through an explicit requires graph, then validates runtime/disposal readiness and topology; construction, failure or unavailability does not establish readiness or disposal.
 * 关闭时先永久关准入、等待启动/降级，再按消费者先于提供者的顺序清理。清理拒绝保留原值和提供者供重试；外部就绪阶段与业务回调排空仍由应用拥有范围负责。
 * Closure permanently shuts admission, waits for startup/degradation and disposes consumers before providers. Disposal rejection retains original values/providers for retry; the application owns external-ready stages and business-callback draining.
 */
import { AppError } from '../shared/errors.ts';

/** 宿主专用销毁标记，不属于领域 V1 或 HTTP 方法。 */
export const SERVICE_LIFECYCLE: unique symbol = Symbol('sakura.service.lifecycle');

export type ServiceDependencyResolver = Readonly<{
  /**
   * 签名 / Signature: ServiceDependencyResolver.get.
   * 功能：解析消费者 requires 中的启动/清理依赖。消费者进入 initializing 后即可使用，提供者每次访问都必须 ready；registered/disposed 消费者拒绝。
   * Purpose: Resolves a consumer's requires dependencies for startup/cleanup. It is usable after the consumer enters initializing, checks provider readiness on every lookup and refuses registered/disposed consumers.
   * 输入 / Inputs: id: string.
   * 结果：返回被声明提供者的原值 T；未知、未声明或未就绪依赖抛出明确错误。
   * Result: Returns the declared provider's original T value; unknown, undeclared or unready dependencies throw explicit errors.
   */
  get<T = unknown>(id: string): T;
  /**
   * 签名 / Signature: ServiceDependencyResolver.late.
   * 功能：解析 requires、lateRequires 或 disposeRequires 联合声明的运行期依赖，只允许 ready、disposing、cleanup-pending 消费者调用。
   * Purpose: Resolves runtime dependencies from requires, lateRequires or disposeRequires only for ready, disposing or cleanup-pending consumers.
   * 输入 / Inputs: id: string.
   * 结果：返回当前 ready 提供者的原值；drain 期间仅 requires/disposeRequires 保留访问，纯 lateRequires 被拒绝。
   * Result: Returns the current ready provider value; during drain only requires/disposeRequires remain accessible and late-only dependencies are refused.
   */
  late<T = unknown>(id: string): T;
  /**
   * 签名 / Signature: ServiceDependencyResolver.self.
   * 功能：取得当前消费者自身已发布的值，只在该消费者 state=ready 时允许；不提供初始化中的部分实例。
   * Purpose: Returns the consumer's own published value only while its state is ready, never an initializing partial instance.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果：返回原实例 T；该检查关注消费者 readiness，关闭中的仍 ready 消费者也可读取。
   * Result: Returns the original T instance; this checks consumer readiness, so a still-ready consumer during closure can read itself.
   */
  self<T = unknown>(): T;
}>;
export type ServiceDefinition<T> = {
  id: string;
  /** 必需服务未就绪阻止准入；degradable 可返回 unavailable，但清理是否完成仍由 Entry.state 区分。
   * Required services gate admission; degradable may remain unavailable, while Entry.state separately records cleanup completion. */
  startup?: 'required' | 'degradable';
  requires: readonly string[];
  /** 只在应用准入开放时使用的晚期依赖；应用须在关闭前排空相关回调，此数组不进入关闭拓扑。
   * Late dependencies for open-admission callbacks; the application drains these callbacks before closure, and this array is excluded from disposal topology. */
  lateRequires?: readonly string[];
  /** drain 后已准入工作或清理仍使用的依赖；与 requires 一同决定提供者必须存活到消费者清理完成。
   * Dependencies still used by admitted work/cleanup during drain; together with requires they keep providers alive until consumer disposal completes. */
  disposeRequires?: readonly string[];
  /**
   * 签名 / Signature: ServiceDefinition.create.
   * 功能：在所有 requires 已就绪后创建服务值；创建成功保存到 Entry.value，但不因此发布 ready。
   * Purpose: Creates the service value after all requires are ready, storing successful creation in Entry.value without publishing readiness.
   * 输入 / Inputs: dependencies: ServiceDependencyResolver.
   * 结果：返回 T 或 Promise<T>，随后传给 initialize；create 拒绝时 value 通常仍 undefined，dispose 必须能清理创建阶段已产生的副作用。
   * Result: Returns T or Promise<T> for initialize; after create rejects value normally remains undefined, so dispose must handle effects already produced during creation.
   */
  create: (dependencies: ServiceDependencyResolver) => T | Promise<T>;
  /**
   * 签名 / Signature: ServiceDefinition.initialize.
   * 功能：对 create 返回的原实例执行显式就绪初始化；完成且未进入 drain 后，管理器才将服务标为 ready。
   * Purpose: Explicitly initializes the original value from create; the manager publishes ready only after completion and a drain check.
   * 输入 / Inputs: value: T; dependencies: ServiceDependencyResolver.
   * 结果：返回 void 或 Promise<void>；失败保留原 value 并进入 failed，供 dispose 处理已部分初始化的资源。
   * Result: Returns void or Promise<void>; failure retains the original value in failed state for disposal of partially initialized resources.
   */
  initialize: (value: T, dependencies: ServiceDependencyResolver) => void | Promise<void>;
  /**
   * 签名 / Signature: ServiceDefinition.dispose.
   * 功能：关闭创建已尝试的原服务，包括 create 失败后的 undefined 或 initialize 失败后的部分实例；可通过声明的依赖完成清理。
   * Purpose: Disposes an original service whose creation was attempted, including undefined after create failure or a partial instance after initialization failure, using declared dependencies.
   * 输入 / Inputs: value: T | undefined; dependencies: ServiceDependencyResolver.
   * 结果：正常完成被管理器视为清理确认并标为 disposed；拒绝则 cleanup-pending，原实例和必要依赖保留以供重试。
   * Result: Successful completion is treated by the manager as disposal confirmation; rejection leaves cleanup-pending with original value and necessary providers retained for retry.
   * 设计：提供者负责在返回/resolve 前确认自身资源结束；管理器不以构造完成、failed 或 unavailable 代替实际清理。
   * Design: The provider must confirm its resources ended before returning/resolving; construction, failed or unavailable state is not disposal proof.
   */
  dispose: (value: T | undefined, dependencies: ServiceDependencyResolver) => void | Promise<void>;
  /** 仅在当前可清理的无消费者节点之间排序，数值升序；依赖边优先，不能靠 phase 提前关闭提供者。
   * Ascending order only among currently eligible consumer-free nodes; dependency edges take priority and phase cannot dispose providers early. */
  disposePhase?: number;
};
type Entry = {
  definition: ServiceDefinition<any>;
  state: 'registered' | 'initializing' | 'ready' | 'failed' | 'disposing' | 'cleanup-pending' | 'disposed';
  value?: unknown;
  pending?: Promise<unknown>;
  degradation?: Promise<unknown>;
  attempted: boolean;
  unavailable?: boolean;
  error?: unknown;
};

/** 创建/初始化与显式 ready 分开；保存失败实例和清理待确认图，供关闭及恢复确认使用。
 * Separates creation/initialization from explicit readiness, retaining failed instances and pending-disposal graphs for closure/recovery confirmation. */
export class ServiceLifecycle {
  private entries = new Map<string, Entry>();
  private external = new Map<string, unknown>();
  private closing?: Promise<void>;
  private draining = false;
  /**
   * 入口 / Entry: ServiceLifecycle.accepting.
   * 功能：报告管理器是否尚未进入 drain，不代表所有服务已初始化或 validateReady 已通过。
   * Purpose: Reports whether the manager has entered drain, without implying all services initialized or passed validateReady.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果：返回 !draining，不修改状态。
   * Result: Returns !draining without changing state.
   */
  get accepting() {
    return !this.draining;
  }

  /**
   * 入口 / Entry: ServiceLifecycle.ready.
   * 功能：登记外部已就绪阶段及可选值，它不由本管理器创建或关闭；关闭期间或 ID 与任何阶段重复时拒绝。
   * Purpose: Registers an externally ready stage and optional value that this manager neither creates nor disposes, refusing during drain or on duplicate IDs.
   * 输入 / Inputs: id: string; value?: unknown.
   * 结果：写入 external，无返回值；Map.has 决定就绪，因此 undefined 也可作为已就绪值。
   * Result: Writes external with no returned value; Map.has determines readiness, so undefined can be an externally ready value.
   */
  ready(id: string, value?: unknown) {
    if (this.draining || this.entries.has(id) || this.external.has(id))
      throw new AppError('重复或已关闭的外部就绪阶段：' + id, 409, 'SERVICE_STAGE_INVALID');
    this.external.set(id, value);
  }
  /**
   * 入口 / Entry: ServiceLifecycle.register.
   * 功能：校验唯一服务声明、依赖数组和三阶段钩子，复制并去重冻结各依赖数组，登记为尚未尝试的 registered。
   * Purpose: Validates a unique service declaration, dependency arrays and three hooks, copies/deduplicates/freezes each dependency array and registers an unattempted entry.
   * 输入 / Inputs: definition: ServiceDefinition<T>.
   * 结果：只登记而不构造服务；无返回值，不完整声明或 drain/重复登记拒绝。
   * Result: Registers without constructing the service; returns nothing and refuses incomplete declarations or drain/duplicates.
   * 设计：复制冻结依赖数组，使之后对调用方原数组的修改不能改变生命周期图；阶段函数仍保持提供者原实现。
   * Design: Copying/freezing dependency arrays prevents later caller-array mutation from changing lifecycle graphs while retaining the provider's original hooks.
   */
  register<T>(definition: ServiceDefinition<T>) {
    if (this.draining || this.entries.has(definition.id) || this.external.has(definition.id))
      throw new AppError('重复或已关闭的服务声明：' + definition.id, 409, 'SERVICE_DECLARATION_INVALID');
    if (
      !definition.id ||
      (definition.startup !== undefined && !['required', 'degradable'].includes(definition.startup)) ||
      !Array.isArray(definition.requires) ||
      (definition.lateRequires !== undefined && !Array.isArray(definition.lateRequires)) ||
      (definition.disposeRequires !== undefined && !Array.isArray(definition.disposeRequires)) ||
      [...definition.requires, ...(definition.lateRequires || []), ...(definition.disposeRequires || [])]
        .some(id => typeof id !== 'string' || !id) ||
      !['create', 'initialize', 'dispose'].every(
        (key) => typeof definition[key as keyof typeof definition] === 'function',
      )
    )
      throw new AppError('服务生命周期声明不完整', 400, 'SERVICE_DECLARATION_INVALID');
    this.entries.set(definition.id, { definition: { ...definition,
      requires: Object.freeze([...new Set(definition.requires)]),
      lateRequires: Object.freeze([...new Set(definition.lateRequires || [])]),
      disposeRequires: Object.freeze([...new Set(definition.disposeRequires || [])]),
    }, state: 'registered', attempted: false });
  }
  /**
   * 入口 / Entry: ServiceLifecycle.validate.
   * 功能：遍历 requires 启动图，外部 ready 阶段作为终点；验证所有启动依赖存在且没有循环。
   * Purpose: Traverses the requires startup graph, treating externally ready stages as terminals, checking missing startup dependencies and cycles.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果：无返回值；错误包含依赖路径。此阶段不校验 lateRequires/disposeRequires 的就绪或清理图。
   * Result: Returns nothing; errors contain dependency paths. Late/disposal readiness and the cleanup graph are checked later.
   */
  validate() {
    const visited = new Set<string>(),
      active = new Set<string>();
    /**
     * 入口 / Entry: ServiceLifecycle.validate.visit.
     * 功能：对一个启动节点进行 DFS：active 标记当前递归路径，visited 复用已验证子图，路径数组用于报出缺失/循环链。
     * Purpose: DFS-validates one startup node: active tracks the recursive path, visited reuses validated subgraphs and path reports missing/cyclic chains.
     * 输入 / Inputs: id: string; path: string[].
     * 结果：只更新本次验证的集合；外部/已访问节点直接返回。
     * Result: Only updates this validation's sets; external/visited nodes return immediately.
     */
    const visit = (id: string, path: string[]) => {
      if (this.external.has(id) || visited.has(id)) return;
      const entry = this.entries.get(id);
      if (!entry)
        throw new AppError(
          '服务依赖未声明或未就绪：' + [...path, id].join(' → '),
          503,
          'SERVICE_DEPENDENCY_MISSING',
        );
      if (active.has(id))
        throw new AppError('服务依赖形成循环：' + [...path, id].join(' → '), 409, 'SERVICE_DEPENDENCY_CYCLE');
      active.add(id);
      for (const dependency of entry.definition.requires) visit(dependency, [...path, id]);
      active.delete(id);
      visited.add(id);
    };
    for (const id of this.entries.keys()) visit(id, []);
  }
  /** 每次解析核对捕获消费者、已冻结依赖数组及当前提供者状态，避免保留解析器获得陈旧权限。
   * Every lookup checks the captured consumer, frozen dependency arrays and live provider state rather than granting stale retained-resolver authority. */
  /**
   * 入口 / Entry: ServiceLifecycle.dependencies.
   * 功能：为指定已登记服务创建冻结解析器，捕获原 Entry 并在每次调用重新检查消费者/提供者状态和已冻结依赖声明。
   * Purpose: Creates a frozen resolver for a registered service, capturing its original Entry and rechecking consumer/provider state and frozen dependency declarations on every call.
   * 输入 / Inputs: id: string.
   * 结果：返回 get/late/self 三种时间约束能力；未知消费者以 SERVICE_UNKNOWN 拒绝。
   * Result: Returns get/late/self capabilities with distinct timing constraints; an unknown consumer fails with SERVICE_UNKNOWN.
   * 设计：解析器不是提供者快照；保留旧解析器也不能绕过 disposed 状态、依赖声明或 drain 时的晚期准入限制。
   * Design: The resolver is not a provider snapshot; retaining it cannot bypass disposed state, declarations or late-only admission restrictions during drain.
   */
  dependencies(id: string): ServiceDependencyResolver {
    const entry = this.entries.get(id);
    if (!entry) throw new AppError('未知服务：' + id, 404, 'SERVICE_UNKNOWN');
    /**
     * 入口 / Entry: ServiceLifecycle.dependencies.resolve.
     * 功能：统一执行依赖读取：get 仅允许 requires，late 允许三组声明并限制消费者阶段；drain 拒绝只用于入站回调的晚期边。
     * Purpose: Applies shared lookup rules: get permits only requires, late permits all three declaration sets with consumer-stage restrictions, and drain refuses late-only inbound edges.
     * 输入 / Inputs: dependency: string; late: boolean.
     * 结果：返回 external 原值或 ready 内部提供者 value；未声明为 403，阶段不允许或提供者未就绪为 503。
     * Result: Returns the original external value or ready internal provider value; undeclared access is 403 and invalid consumer/provider state is 503.
     */
    const resolve = (dependency: string, late: boolean) => {
      const definition = entry.definition;
      if (entry.state === 'registered' || entry.state === 'disposed')
        throw new AppError('依赖消费者尚未就绪或已关闭：' + id, 503, 'SERVICE_NOT_READY');
      const declared = late ? [...definition.requires, ...(definition.lateRequires || []),
        ...(definition.disposeRequires || [])] : definition.requires;
      if (!declared.includes(dependency))
        throw new AppError('未声明服务依赖：' + id + ' → ' + dependency, 403, 'SERVICE_DEPENDENCY_DENIED');
      if (late && entry.state !== 'ready' && entry.state !== 'disposing' && entry.state !== 'cleanup-pending')
        throw new AppError('延迟服务依赖只能由已就绪服务使用：' + id, 503, 'SERVICE_NOT_READY');
      if (this.draining && !definition.requires.includes(dependency) && !definition.disposeRequires?.includes(dependency))
        throw new AppError('入站延迟依赖已关闭：' + id + ' → ' + dependency, 503, 'SERVICE_DRAINING');
      if (this.external.has(dependency)) return this.external.get(dependency);
      const provider = this.entries.get(dependency);
      if (!provider || provider.state !== 'ready')
        throw new AppError('服务依赖尚未就绪：' + id + ' → ' + dependency, 503, 'SERVICE_NOT_READY');
      return provider.value;
    };
    return Object.freeze({
      /**
       * 入口 / Entry: ServiceLifecycle.dependencies.get.
       * 功能：使用 get 的启动/清理规则读取当前 requires 提供者。
       * Purpose: Reads a current requires provider using get's startup/cleanup rules.
       * 输入 / Inputs: dependency: string.
       * 结果：返回 resolve(dependency,false) 的 T，不缓存值或改变阶段。
       * Result: Returns T from resolve(dependency,false), without caching values or changing stages.
       */
      get: <T>(dependency: string) => resolve(dependency, false) as T,
      /**
       * 入口 / Entry: ServiceLifecycle.dependencies.late.
       * 功能：使用 late 的运行/清理规则读取当前已声明提供者，drain 时拒绝纯 lateRequires。
       * Purpose: Reads the current declared provider using late's runtime/cleanup rules, refusing late-only dependencies during drain.
       * 输入 / Inputs: dependency: string.
       * 结果：返回 resolve(dependency,true) 的 T，执行与原消费者绑定的实时校验。
       * Result: Returns T from resolve(dependency,true), checking live state bound to the original consumer.
       */
      late: <T>(dependency: string) => resolve(dependency, true) as T,
      /**
       * 入口 / Entry: ServiceLifecycle.dependencies.self.
       * 功能：只在原消费者仍 ready 时返回其自身已发布实例。
       * Purpose: Returns the original consumer's published instance only while it remains ready.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 结果：非 ready 状态抛 SERVICE_NOT_READY；不公开初始化或清理中的部分值。
       * Result: Nonready states throw SERVICE_NOT_READY, withholding initializing/disposing partial values.
       */
      self: <T>() => {
        if (entry.state !== 'ready') throw new AppError('服务尚未就绪：' + id, 503, 'SERVICE_NOT_READY');
        return entry.value as T;
      },
    });
  }
  /**
   * 入口 / Entry: ServiceLifecycle.start.
   * 功能：启动指定服务：先验证图，递归启动 requires，然后按 create→initialize 推进状态；已有 ready 值直接复用，在途启动共享工作。
   * Purpose: Starts a service by validating the graph, recursively starting requires and advancing through create→initialize; reuses ready values and shares in-flight startup work.
   * 输入 / Inputs: id: string.
   * 结果：Promise 交付 ready 原值；失败保存 error 和已有 value，并置 failed；非 registered 状态不能直接重新启动。
   * Result: The Promise delivers the ready original value; failure stores error/existing value in failed state and nonregistered entries cannot restart directly.
   * 设计：attempted 在 create 前标记，确保创建抛错也安排 dispose(undefined)；等待后检查 drain，避免关闭期间发布迟到 ready。依赖失败发生在 create 前则消费者未尝试。
   * Design: Set attempted before create so thrown creation still schedules dispose(undefined); check drain after waits to avoid late readiness publication. A dependency failure before create leaves the consumer unattempted.
   */
  async start<T>(id: string): Promise<T> {
    if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
    this.validate();
    const entry = this.entries.get(id);
    if (!entry) throw new AppError('未知服务：' + id, 404, 'SERVICE_UNKNOWN');
    if (entry.state === 'ready') return entry.value as T;
    if (entry.pending) return entry.pending as Promise<T>;
    if (entry.state !== 'registered')
      throw new AppError('服务启动失败，需先确认清理：' + id, 503, 'SERVICE_NOT_READY');
    /**
     * 入口 / Entry: ServiceLifecycle.start.callback@135.
     * 功能：执行本次启动的依赖等待、创建与初始化；创建成功先保存原值，初始化成功后复核 drain 才提交 ready。
     * Purpose: Runs this startup attempt's dependency waits, creation and initialization, saving the created value and committing ready only after a final drain check.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果：失败将 entry 置 failed 并保存原异常，既不自动销毁 value，也不把失败视为清理确认。
     * Result: Failure marks entry failed and stores the original error without destroying the value or treating failure as cleanup confirmation.
     */
    const pending = Promise.resolve().then(async () => {
      try {
        for (const dependency of entry.definition.requires) {
          if (!this.external.has(dependency)) await this.start(dependency);
        }
        if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
        entry.state = 'initializing';
        entry.attempted = true;
        const dependencies = this.dependencies(id);
        entry.value = await entry.definition.create(dependencies);
        await entry.definition.initialize(entry.value, dependencies);
        if (this.draining) throw new AppError('初始化期间服务已关闭', 503, 'SERVICE_DRAINING');
        entry.state = 'ready';
        return entry.value;
      } catch (error) {
        entry.state = 'failed';
        entry.error = error;
        throw error;
      }
    });
    entry.pending = pending;
    try {
      return (await pending) as T;
    } finally {
      entry.pending = undefined;
    }
  }
  /** 可选启动失败不发布 ready；unavailable 与清理成功独立，失败清理保留原图和原值。
   * Optional startup failure never publishes ready; unavailability is independent of disposal success, retaining the original graph/value on cleanup failure. */
  /**
   * 入口 / Entry: ServiceLifecycle.startDegradable.
   * 功能：仅启动明确 degradable 的服务，去重在途降级处理；启动失败后标记 unavailable，并清理已尝试创建的原值。
   * Purpose: Starts only explicitly degradable services, deduplicating in-flight degradation; startup failure marks unavailable and disposes attempted original values.
   * 输入 / Inputs: id: string.
   * 结果：成功返回 T；已降级/本次可降级失败返回 undefined；清理失败保留 cleanup-pending 和启动/清理 AggregateError。
   * Result: Returns T on success or undefined for an unavailable/degraded result; cleanup failure retains cleanup-pending and an AggregateError of startup/disposal failures.
   * 设计：unavailable 禁止重复启动，不代表 disposed；drain 或非本服务 failed 的异常仍传播。关闭流程将重试未确认清理，并保留它所需提供者。
   * Design: Unavailable prevents repeated startup but is not disposed; drain/nonfailed-entry errors still propagate. Closure retries unconfirmed disposal while retaining its providers.
   */
  async startDegradable<T>(id: string): Promise<T | undefined> {
    if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
    const entry = this.entries.get(id);
    if (!entry || entry.definition.startup !== 'degradable')
      throw new AppError('服务未声明可降级：' + id, 409, 'SERVICE_DECLARATION_INVALID');
    if (entry.degradation) return entry.degradation as Promise<T | undefined>;
    if (entry.unavailable) return undefined;
    /**
     * 入口 / Entry: ServiceLifecycle.startDegradable.callback@170.
     * 功能：捕获可选服务的真实启动失败；在未 drain 且 entry=failed 时执行降级清理，保留原启动错误与清理错误。
     * Purpose: Handles genuine optional-service startup failure, degrading/disposing only without drain and with failed state while retaining startup and cleanup errors.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果：返回启动值或 undefined；attempted=false 时不调用 dispose，清理拒绝不发布 ready。
     * Result: Returns the startup value or undefined; does not dispose unattempted entries and cleanup rejection never publishes ready.
     */
    const pending = (async () => {
      try {
        return await this.start<T>(id);
      } catch (error) {
        if (this.draining || entry.state !== 'failed') throw error;
        entry.unavailable = true;
        if (entry.attempted) {
          entry.state = 'disposing';
          try {
            await entry.definition.dispose(entry.value, this.dependencies(id));
            entry.state = 'disposed';
          } catch (cleanup) {
            entry.state = 'cleanup-pending';
            entry.error = new AggregateError([error, cleanup], '附属服务启动失败且清理待确认：' + id);
          }
        }
        return undefined;
      }
    })();
    entry.degradation = pending;
    try { return await pending; }
    finally { entry.degradation = undefined; }
  }
  /** 不可用可选提供者只豁免自身准入，任何已就绪消费者仍必须拥有全部已就绪依赖。
   * An unavailable optional provider exempts only itself; every ready consumer still needs all declared providers ready. */
  /**
   * 入口 / Entry: ServiceLifecycle.validateReady.
   * 功能：在开放准入前核对所有必需消费者和它们的三组提供者 ready；不可用可选服务只豁免自身 ready，仍要求声明存在。
   * Purpose: Checks required consumers and all three provider sets before admission; unavailable optional entries are exempt only from their own readiness and still require existing declarations.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果：随后验证 requires+disposeRequires 清理图无循环；任一存活消费者依赖降级提供者仍拒绝。
   * Result: Then validates the requires+disposeRequires cleanup graph for cycles; a live consumer depending on a degraded provider still fails.
   * 设计：lateRequires 只用于开放期回调，不进入关闭拓扑；drain 后仍要使用的依赖须放 disposeRequires，否则无法保证清理期间可解析。
   * Design: LateRequires describes open-admission callbacks and is excluded from closure topology; dependencies needed after drain belong in disposeRequires for cleanup-time resolution.
   */
  validateReady() {
    if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
    this.validate();
    for (const [id, entry] of this.entries) {
      if (entry.state !== 'ready' && entry.definition.startup === 'degradable' && entry.unavailable &&
          ['failed', 'disposed', 'cleanup-pending'].includes(entry.state)) {
        for (const dependency of [...entry.definition.requires, ...(entry.definition.lateRequires || []),
          ...(entry.definition.disposeRequires || [])])
          if (!this.external.has(dependency) && !this.entries.has(dependency))
            throw new AppError('服务依赖未声明：' + id + ' → ' + dependency, 503, 'SERVICE_DEPENDENCY_MISSING');
        continue;
      }
      if (entry.state !== 'ready')
        throw new AppError('服务尚未就绪：' + id, 503, 'SERVICE_NOT_READY');
      for (const dependency of [...entry.definition.requires, ...(entry.definition.lateRequires || []),
        ...(entry.definition.disposeRequires || [])])
        if (!this.external.has(dependency) && this.entries.get(dependency)?.state !== 'ready')
          throw new AppError('延迟服务依赖尚未就绪：' + id + ' → ' + dependency, 503, 'SERVICE_NOT_READY');
    }
    const visited = new Set<string>(), active = new Set<string>();
    /**
     * 入口 / Entry: ServiceLifecycle.validateReady.visit.
     * 功能：对清理图 DFS，使用 requires 与 disposeRequires 两种边检测循环，外部就绪阶段作为终点。
     * Purpose: DFS-checks cleanup cycles through requires and disposeRequires, treating externally ready stages as terminals.
     * 输入 / Inputs: id: string.
     * 结果：维护本次 active/visited 集合，循环报 SERVICE_DISPOSE_DEPENDENCY_CYCLE。
     * Result: Maintains local active/visited sets and reports SERVICE_DISPOSE_DEPENDENCY_CYCLE on recursion cycles.
     */
    const visit = (id: string) => {
      if (this.external.has(id) || visited.has(id)) return;
      if (active.has(id)) throw new AppError('服务清理依赖形成循环：' + id, 409, 'SERVICE_DISPOSE_DEPENDENCY_CYCLE');
      active.add(id);
      const definition = this.entries.get(id)!.definition;
      for (const dependency of [...definition.requires, ...(definition.disposeRequires || [])]) visit(dependency);
      active.delete(id); visited.add(id);
    };
    for (const id of this.entries.keys()) visit(id);
  }
  /**
   * 入口 / Entry: ServiceLifecycle.startAll.
   * 功能：依登记次序启动全部服务，为 degradable 选择降级入口，最后 validateReady 才认可完整准入。
   * Purpose: Starts all services in registration order, selecting degradation for optional entries and validating full readiness at the end.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果：失败先 await close 回收已尝试实例，再重抛；关闭也失败时同时保留启动与清理错误。
   * Result: On failure, awaits close for attempted instances before rethrowing; disposal failure aggregates startup and cleanup errors.
   */
  async startAll() {
    this.validate();
    try {
      for (const [id, entry] of this.entries)
        if (entry.definition.startup === 'degradable') await this.startDegradable(id);
        else await this.start(id);
      this.validateReady();
    } catch (error) {
      try {
        await this.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], '服务启动及清理失败');
      }
      throw error;
    }
  }
  /**
   * 入口 / Entry: ServiceLifecycle.view.
   * 功能：构造当前阶段诊断数组，包含尝试/降级状态、错误文本以及三种依赖列表的副本，不暴露服务实例。
   * Purpose: Builds stage diagnostics with attempted/degraded state, error text and copies of all dependency lists without exposing service instances.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果：同步返回逐服务视图，不改变生命周期状态。
   * Result: Synchronously returns per-service views without changing lifecycle state.
   */
  view() {
    return [...this.entries].map(([id, entry]) => ({
      id,
      state: entry.state,
      attempted: entry.attempted,
      startup: entry.definition.startup ?? 'required',
      unavailable: !!entry.unavailable,
      ...(entry.error !== undefined ? { error: String(entry.error) } : {}),
      requires: [...entry.definition.requires],
      lateRequires: [...(entry.definition.lateRequires || [])],
      disposeRequires: [...(entry.definition.disposeRequires || [])],
    }));
  }
  /** 拥有范围已确认原资源结束，例如 close 外的显式恢复；本方法只接纳该确认，不重新执行清理。
   * The owning scope confirms original-resource disposal, including explicit recovery outside close; this method accepts that confirmation without rerunning cleanup. */
  /**
   * 入口 / Entry: ServiceLifecycle.confirmDisposed.
   * 功能：接受拥有范围在 close 外完成恢复清理的明确确认，将已知服务状态标为 disposed；未知 ID 不做操作。
   * Purpose: Accepts explicit owning-scope confirmation of recovery disposal outside close, marking known entries disposed and ignoring unknown IDs.
   * 输入 / Inputs: id: string.
   * 结果：无返回值，不自行调用 dispose 或验证实际资源；资源已结束的证明由确认方负责。
   * Result: Returns nothing and neither invokes disposal nor verifies physical resources; the confirmer owns disposal evidence.
   */
  confirmDisposed(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.state = 'disposed';
  }
  /**
   * 入口 / Entry: ServiceLifecycle.close.
   * 功能：立即进入永久 drain，去重在途 close，等待原启动/降级完成后关闭所有 attempted 且未 disposed 的服务。
   * Purpose: Immediately enters permanent drain, shares in-flight close and awaits original startup/degradation before disposing attempted, undisposed services.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果：成功 Promise 完成并缓存；失败保留 cleanup-pending 原值和依赖，释放 closing 句柄允许后续 close 重试，draining 不恢复。
   * Result: Success resolves/caches closure; failure retains cleanup-pending values/providers and releases the closing handle for another close attempt, without reopening admission.
   * 设计：选择没有剩余消费者的节点先 dispose，只有候选节点才按 disposePhase 升序排序；失败消费者留在图中阻止其提供者先关闭，同时仍可清理独立分支。这里只等待启动/降级，不追踪任意业务回调，所属应用须排空 lateRequires 的开放期工作。
   * Design: Dispose nodes with no remaining consumers first, using ascending disposePhase only among eligible candidates. Failed consumers remain to preserve providers while independent branches can close. This waits only for startup/degradation; the owning application drains open-period lateRequires work.
   */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.draining = true;
    /**
     * 入口 / Entry: ServiceLifecycle.close.callback@262.
     * 功能：执行反依赖关闭循环：每个节点在 dispose 正常完成后移除；异常置 cleanup-pending，本次不重试该节点并继续独立分支。
     * Purpose: Runs reverse-dependency disposal: removes nodes only after dispose succeeds; errors set cleanup-pending, skip that node for this pass and continue independent branches.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果：剩余节点无法安全推进时用 AggregateError 返回失败和保留 ID；循环不把未完成资源标记为 disposed。
     * Result: When remaining nodes cannot safely advance, rejects with AggregateError containing failures/retained IDs rather than marking unfinished resources disposed.
     */
    const pending = Promise.resolve().then(async () => {
      await Promise.allSettled(
        [...this.entries.values()].flatMap(entry =>
          [entry.pending, entry.degradation].filter((pending): pending is Promise<unknown> => !!pending)),
      );
      const remaining = new Set(
        [...this.entries]
          .filter(([, entry]) => entry.attempted && entry.state !== 'disposed')
          .map(([id]) => id),
      );
      const failures: unknown[] = [],
        failed = new Set<string>();
      while (remaining.size) {
        const next = [...remaining]
          .filter(
            (id) =>
              !failed.has(id) &&
              ![...remaining].some(
                (other) => other !== id && [
                  ...this.entries.get(other)!.definition.requires,
                  ...(this.entries.get(other)!.definition.disposeRequires || []),
                ].includes(id),
              ),
          )
          .sort(
            (a, b) =>
              (this.entries.get(a)!.definition.disposePhase ?? 0) -
              (this.entries.get(b)!.definition.disposePhase ?? 0),
          )[0];
        if (!next) break;
        const entry = this.entries.get(next)!;
        entry.state = 'disposing';
        try {
          await entry.definition.dispose(entry.value, this.dependencies(next));
          entry.state = 'disposed';
          remaining.delete(next);
        } catch (error) {
          entry.state = 'cleanup-pending';
          failed.add(next);
          failures.push(error);
        }
      }
      if (remaining.size)
        throw new AggregateError(failures, '服务清理未确认，保留依赖：' + [...remaining].join(', '));
    });
    this.closing = pending;
    void pending.catch(() => {
      if (this.closing === pending) this.closing = undefined;
    });
    return pending;
  }
}
