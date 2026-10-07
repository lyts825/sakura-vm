/**
 * 模块职责（中文）：订阅控制面事件并合并实例/系统刷新，协调请求顺序、连接状态与实例选择。
 * Module responsibility (English): Combining events and polling into ordered controller snapshots.
 * 详细范围（中文）：公开入口包括 useControllerState；职责覆盖将事件和轮询合并为有序控制面快照，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include useControllerState. The scope covers Combining events and polling into ordered controller snapshots. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { System } from '../../shared/contracts/controller.ts';
import type { VMView } from '../../shared/contracts/vm.ts';
import { controllerSession, RefreshQueue } from '../controller-session';
import { watchController } from '../controller-watch';
import { ResponseOrder } from '../request-order';
import { pluginGeneration } from '../plugin-generation';
import { socketPath } from '../../shared/socket-client.ts';

/**
 * 中文：提交 operation core.vms.list；operation core.system，完成将事件和轮询合并为有序控制面快照的数据交互；异步失败传给此处的捕获分支或外层动作反馈
 * English: Perform operation core.vms.list; operation core.system for Combining events and polling into ordered controller snapshots. Propagate asynchronous failure to this catch path or the outer action feedback
 * 中文：输入：setSelectedRaw：签名所示 Dispatch<SetStateAction<string>> 业务值
 * English: Inputs: setSelectedRaw: the Dispatch<SetStateAction<string>> domain value in the signature
 * 中文：结果：包含 vms、system、loading、offline、refresh、invalidate、upsertVm、reconnect 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing vms, system, loading, offline, refresh, invalidate, upsertVm, reconnect for caller state reads/operations
 */
export function useControllerState(setSelectedRaw: Dispatch<SetStateAction<string>>) {
  const [vms, setVms] = useState<VMView[]>([]),
    [system, setSystem] = useState<System | null>(null);
  const [loading, setLoading] = useState(true),
    [offline, setOffline] = useState('');
  const refreshOrder = useRef(new ResponseOrder());
  const refreshQueue = useRef(new RefreshQueue());
  const refreshAbort = useRef(new AbortController());
  const watcher = useRef<ReturnType<typeof watchController> | null>(null);
  /**
   * 中文：提交 operation core.vms.list；operation core.system，完成将事件和轮询合并为有序控制面快照的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation core.vms.list; operation core.system for Combining events and polling into ordered controller snapshots. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const refresh = useCallback(
    () =>
      refreshQueue.current.run(/** 中文：提交 operation core.vms.list；operation core.system，完成将事件和轮询合并为有序控制面快照的数据交互并更新vms 状态、system 状态、offline 状态、selectedRaw 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation core.vms.list; operation core.system for Combining events and polling into ordered controller snapshots and update vms state, system state, offline state, selectedRaw state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态 | English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state */ async () => {
        // VM 列表和系统状态成对更新；旧读取若晚于已应用的新快照返回，整组结果均丢弃。
        const version = refreshOrder.current.start();
        const signal = AbortSignal.any([refreshAbort.current.signal, AbortSignal.timeout(15000)]);
        try {
          const [data, sys] = await Promise.all([
            controllerSession.operation('core.vms.list', { signal }),
            controllerSession.operation('core.system', { signal }),
          ]);
          if (!refreshOrder.current.accept(version)) return;
          setVms(data);
          pluginGeneration.update(sys.pluginRuntime);
          setSystem(sys);
          if (sys.session) controllerSession.updateSession(sys.session);
          setOffline('');
          setSelectedRaw((current) => (data.some((v) => v.id === current) ? current : data[0]?.id || ''));
        } catch (error) {
          if (refreshOrder.current.accept(version)) throw error;
        }
      }),
    [setSelectedRaw],
  );
  useEffect(/** 中文：当依赖 [refresh] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [refresh] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    refreshAbort.current = new AbortController();
    const connection = watchController({
      session: controllerSession,
      refresh,
      error: setOffline,
      /**
       * 中文：在将事件和轮询合并为有序控制面快照流程中loading 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Combining events and polling into ordered controller snapshots, loading state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       */
      settled: () => setLoading(false),
      document,
      window,
      /**
       * 中文：按当前页面协议选择 ws/wss，并把凭证编码到 events 通道 URL，创建控制面事件连接。
       * English: Select ws/wss from the current page protocol, encode credentials into the events channel URL and create the controller event socket.
       * 中文：输入：credential：此处理器的调用值
       * English: Inputs: credential: the invocation value for this handler
       */
      socket: (credential) =>
        new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` +
            socketPath('events', {}, { token: credential }),
        ),
    });
    watcher.current = connection;
    /**
     * 中文：在将事件和轮询合并为有序控制面快照流程中关闭所属连接或存储对象，使匹配资源缓存失效，取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Combining events and polling into ordered controller snapshots, close the owned connection/storage object, invalidate matching resource caches, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      connection.close();
      watcher.current = null;
      refreshOrder.current.invalidate();
      refreshAbort.current.abort();
    };
  }, [refresh]);
  /**
   * 中文：在将事件和轮询合并为有序控制面快照流程中使匹配资源缓存失效；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Combining events and polling into ordered controller snapshots, invalidate matching resource caches. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   */
  const invalidate = useCallback(() => refreshOrder.current.invalidate(), []);
  // 直接应用写入返回的实例时先失效已发出的读取，防止旧列表把刚确认的变更覆盖掉。
  /**
   * 中文：在将事件和轮询合并为有序控制面快照流程中vms 状态，使匹配资源缓存失效；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Combining events and polling into ordered controller snapshots, vms state, invalidate matching resource caches. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：vm：签名所示 VMView 业务值
   * English: Inputs: vm: the VMView domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const upsertVm = useCallback((vm: VMView) => {
    refreshOrder.current.invalidate();
    setVms((current) => [...current.filter((entry) => entry.id !== vm.id), vm]);
  }, []);
  /**
   * 中文：请求现有观察器重建事件连接，不创建第二个独立观察器。
   * English: Ask the existing watcher to reconnect without creating another independent watcher.
   */
  const reconnect = useCallback(() => watcher.current?.reconnect(), []);
  return { vms, system, loading, offline, refresh, invalidate, upsertVm, reconnect };
}
