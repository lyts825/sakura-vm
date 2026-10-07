/**
 * 模块职责（中文）：按实例/项目隔离终端持久化状态，向多个界面订阅者提供一致快照。
 * Module responsibility (English): Sharing VM/project-scoped persistent terminal state across surfaces.
 * 详细范围（中文）：公开入口包括 createTerminalStores, getTerminalStore；职责覆盖跨界面共享按 VM/项目隔离的终端持久状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include createTerminalStores, getTerminalStore. The scope covers Sharing VM/project-scoped persistent terminal state across surfaces. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { restoreTerminals, terminalReducer, type TerminalAction, type TerminalState } from './terminal-state';
import { applyTerminalLayout, type TerminalLayout } from './terminal-layouts';

type TerminalStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Snapshot = TerminalState & { closing: string | null; error: string; suspended: boolean };

/**
 * 中文：恢复一个实例/项目的终端快照并统一更新订阅者与浏览器存储。关闭请求对完成时最新快照执行 reducer；暂停标记先持久化，失败或重载也不能偷偷重建会话。
 * English: Restore one VM/project terminal snapshot and keep subscribers/browser storage in sync. Apply close completion to the latest snapshot through the reducer. Persist suspension before cleanup so failure or reload cannot silently recreate sessions.
 * 中文：输入：id：目标资源标识；storage：调用时提供浏览器存储能力的工厂
 * English: Inputs: id: target resource identifier; storage: factory providing browser storage at invocation
 * 中文：结果：包含 getSnapshot、subscribe、dispatch、applyLayout、resume、stopAll、close 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing getSnapshot, subscribe, dispatch, applyLayout, resume, stopAll, close for caller state reads/operations
 */
function createStore(id: string, storage: /** 中文：提供浏览器持久化能力，调用时获取当前可用存储对象；这是 createStore 的调用契约 | English: Provide browser persistence by obtaining the currently available storage object on invocation; this is the callable contract of createStore | 中文：结果：TerminalStorage；调用者依赖此类型约定 | English: Result: TerminalStorage; callers depend on this type contract */ () => TerminalStorage) {
  const key = `sakura-terminals-${id}`;
  let saved: unknown = null;
  try {
    saved = JSON.parse(storage().getItem(key) || 'null');
  } catch {}
  let snapshot: Snapshot = { ...restoreTerminals(saved), closing: null, error: '', suspended: false };
  try {
    const selected = storage().getItem(key + '-active');
    if (snapshot.tabs.some((tab) => tab.id === selected)) snapshot.active = selected!;
    snapshot.suspended = storage().getItem(key + '-suspended') === 'true';
  } catch {}
  const listeners = new Set</** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 createStore 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of createStore | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void>();

  /**
   * 中文：替换共享快照，分别仅持久化变化的标签、活动项和暂停标记，再通知所有观察者；存储拒绝不影响内存状态。
   * English: Replace the shared snapshot, persist only changed tabs/active selection/suspension markers and notify observers; refused persistence does not prevent in-memory state.
   * 中文：输入：next：待采用的新状态或数据
   * English: Inputs: next: new state/data to adopt
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const update = (next: Snapshot) => {
    const tabsChanged = next.tabs !== snapshot.tabs;
    const activeChanged = next.active !== snapshot.active;
    const suspendedChanged = next.suspended !== snapshot.suspended;
    snapshot = next;
    if (suspendedChanged) {
      try { storage().setItem(key + '-suspended', String(snapshot.suspended)); } catch {}
    }
    if (activeChanged || tabsChanged) {
      try {
        storage().setItem(key + '-active', snapshot.active);
      } catch {}
    }
    if (tabsChanged) {
      try {
        storage().setItem(key, JSON.stringify(snapshot.tabs));
      } catch {
        // Keep this page's sessions usable when browser storage is unavailable.
      }
    }
    for (const listener of listeners) listener();
  };
  /**
   * 中文：由 reducer 计算终端状态，只有引用变化才合并快照并发布，避免空动作触发重渲染。
   * English: Compute terminal state through the reducer and merge/publish only on reference change, avoiding rerenders for no-op actions.
   * 中文：输入：action：本次动作或状态机输入
   * English: Inputs: action: current action/state-machine input
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const dispatch = (action: TerminalAction) => {
    const next = terminalReducer(snapshot, action);
    if (next !== snapshot) update({ ...snapshot, ...next });
  };

  return {
    /**
     * 中文：返回稳定共享快照供 useSyncExternalStore 读取，只有 update 才更换引用。
     * English: Return the stable shared snapshot for useSyncExternalStore; only update replaces its reference.
     */
    getSnapshot: () => snapshot,
    /**
     * 中文：登记共享终端状态观察者，退订只移除此观察者，不停止其他界面的终端。
     * English: Register a shared terminal-state observer; unsubscribe removes only that observer without stopping terminals used by other surfaces.
     * 中文：输入：listener：本订阅的变化观察者
     * English: Inputs: listener: change observer for this subscription
     * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
     * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
     */
    subscribe: (listener: /** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 createStore.subscribe 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of createStore.subscribe | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    /**
     * 中文：没有关闭操作在途时应用校验后的布局并清空错误；关闭期间拒绝布局替换避免会话集合竞态。
     * English: Apply a validated layout and clear errors only with no close in flight; reject layout replacement during closure to avoid session-set races.
     * 中文：输入：layout：已选择的终端分屏布局
     * English: Inputs: layout: selected terminal split layout
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     * 中文：拒绝原因：请等待终端关闭操作结束。这些错误交给直接调用者或本函数 catch 处理
     * English: Refusal reasons: 请等待终端关闭操作结束. These errors reach the direct caller or this function's catch handler
     */
    applyLayout(layout: TerminalLayout) {
      if (snapshot.closing) throw new Error('请等待终端关闭操作结束');
      update({ ...snapshot, ...applyTerminalLayout(snapshot, layout), error: '' });
    },
    /**
     * 中文：没有关闭操作在途时解除暂停并清空错误，不在删除会话期间复活终端连接。
     * English: Unsuspend/clear errors only with no close in flight, avoiding connection revival while sessions are being removed.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    resume() {
      if (!snapshot.closing) update({ ...snapshot, suspended: false, error: '' });
    },
    /**
     * 中文：先暂停共享终端并锁住关闭入口，再调用服务端删除；失败保留标签并显示错误，finally 释放关闭锁，避免把未知结果当作已恢复。
     * English: Suspend shared terminals/lock closing before server removal. Retain tabs and show failure errors, releasing the close lock in finally without treating unknown outcomes as resumed sessions.
     * 中文：输入：remove：移除服务端会话的异步操作
     * English: Inputs: remove: asynchronous server-session removal
     * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
     * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
     * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
     * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
     */
    async stopAll(remove: /** 中文：异步删除对应服务端会话，成功兑现后才改变本地标签集合；这是 createStore.stopAll 的调用契约 | English: Asynchronously remove the server session before success permits local tab changes; this is the callable contract of createStore.stopAll | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>) {
      if (snapshot.closing) return;
      // Unmount sockets first. Keep this persisted even if the request fails:
      // a browser reload must not recreate sessions during cleanup or editing.
      update({ ...snapshot, suspended: true, closing: '*', error: '' });
      try { await remove(); }
      catch (error) { update({ ...snapshot, error: error instanceof Error ? error.message : String(error) }); }
      finally { update({ ...snapshot, closing: null }); }
    },
    /**
     * 中文：仅在存在目标且至少保留一个标签时关闭；服务端确认删除后才 reducer 移除，失败保留原标签，finally 释放互斥标记。
     * English: Close only an existing target while retaining at least one tab. Remove through the reducer only after server confirmation, retain the tab on failure and release the exclusion marker in finally.
     * 中文：输入：session：目标终端或桌面会话；remove：移除服务端会话的异步操作
     * English: Inputs: session: target terminal/desktop session; remove: asynchronous server-session removal
     * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
     * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
     * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
     * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
     */
    async close(session: string, remove: /** 中文：异步删除对应服务端会话，成功兑现后才改变本地标签集合；这是 createStore.close 的调用契约 | English: Asynchronously remove the server session before success permits local tab changes; this is the callable contract of createStore.close | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>) {
      if (snapshot.closing || snapshot.tabs.length < 2 || !snapshot.tabs.some((tab) => tab.id === session))
        return;
      update({ ...snapshot, closing: session, error: '' });
      try {
        await remove();
        // Reduce against the current store, not the component that started the
        // request. It may have unmounted and been replaced while closing.
        dispatch({ type: 'close', id: session });
      } catch (error) {
        update({ ...snapshot, error: error instanceof Error ? error.message : String(error) });
      } finally {
        update({ ...snapshot, closing: null });
      }
    },
  };
}

// One owner per VM/project outlives its mounted views, including pending requests.
// Every view subscribes to the same snapshot and writes the same latest tab list.
/**
 * 中文：按实例/项目作用域键懒建并缓存共享 store，同作用域多个界面复用状态和观察者。
 * English: Lazily create/cache shared stores by VM/project scope key so multiple surfaces reuse state/observers in the same scope.
 * 中文：输入：storage：调用时提供浏览器存储能力的工厂
 * English: Inputs: storage: factory providing browser storage at invocation
 * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
 * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
 */
export function createTerminalStores(storage: /** 中文：提供浏览器持久化能力，调用时获取当前可用存储对象；这是 createTerminalStores 的调用契约 | English: Provide browser persistence by obtaining the currently available storage object on invocation; this is the callable contract of createTerminalStores | 中文：结果：TerminalStorage；调用者依赖此类型约定 | English: Result: TerminalStorage; callers depend on this type contract */ () => TerminalStorage) {
  const stores = new Map<string, ReturnType<typeof createStore>>();
  return (id: string) => {
    let store = stores.get(id);
    if (!store) {
      store = createStore(id, storage);
      stores.set(id, store);
    }
    return store;
  };
}

export const getTerminalStore = createTerminalStores(() => localStorage);
