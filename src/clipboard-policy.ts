/**
 * 模块职责（中文）：读取并缓存按应用划分的剪贴板策略，通过订阅通知页面，并依据当前工作区上下文判定传输权限。
 * Module responsibility (English): Caching and evaluating clipboard-transfer rules for the current workspace application context.
 * 详细范围（中文）：公开入口包括 getClipboardPolicies, setClipboardPolicies, subscribeClipboardPolicies, clipboardContext, currentClipboardRule, assertClipboardPolicy；职责覆盖按当前工作区应用上下文缓存与判定剪贴板传输规则，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include getClipboardPolicies, setClipboardPolicies, subscribeClipboardPolicies, clipboardContext, currentClipboardRule, assertClipboardPolicy. The scope covers Caching and evaluating clipboard-transfer rules for the current workspace application context. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import {
  clipboardApps,
  clipboardPolicyReason,
  defaultClipboardPolicies,
  effectiveClipboardRule,
  parseClipboardPolicies,
  type ClipboardApp,
  type ClipboardContext,
  type ClipboardPolicies,
} from '../shared/clipboard-policy';

const key = 'sakura-clipboard-policies',
  eventName = 'sakura-clipboard-policies-change';
let cachedText: string | null | undefined;
let snapshot = { policies: defaultClipboardPolicies(), error: '', persistent: true };
let memoryOnly = false;
/**
 * 中文：按 localStorage 原始文本缓存策略快照；读取失败沿用内存值，超长或损坏策略则关闭默认复制/粘贴并显示恢复提示，避免解析失败后意外放行。
 * English: Cache policy snapshots by raw localStorage text. Storage failures retain memory state; oversized or malformed policies disable default copy/paste and expose recovery guidance so parse failure cannot permit transfers.
 * 中文：拒绝原因：策略过大。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 策略过大. These errors reach the direct caller or this function's catch handler
 */
export function getClipboardPolicies() {
  if (memoryOnly) return snapshot;
  let text: string | null;
  try {
    text = localStorage.getItem(key);
  } catch {
    return snapshot;
  }
  if (text === cachedText) return snapshot;
  cachedText = text;
  try {
    if (text && text.length > 65536) throw new Error('策略过大');
    snapshot = {
      policies: text === null ? defaultClipboardPolicies() : parseClipboardPolicies(JSON.parse(text)),
      error: '',
      persistent: true,
    };
  } catch {
    const policies = defaultClipboardPolicies();
    for (const rule of Object.values(policies.defaults)) {
      rule.copy = false;
      rule.paste = false;
    }
    snapshot = {
      policies,
      error: '已暂停剪贴板传递：本浏览器策略损坏，请在设置中恢复默认策略。',
      persistent: true,
    };
  }
  return snapshot;
}
/**
 * 中文：先严格校验策略，再尝试持久化并发布当前窗口的变化事件；浏览器拒绝存储时仍保留内存策略，同时标记未持久化。
 * English: Validate the policy before attempting persistence and publishing an in-window change event. If browser storage refuses the write, retain the in-memory policy and mark it nonpersistent.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function setClipboardPolicies(value: ClipboardPolicies) {
  const policies = parseClipboardPolicies(value),
    text = JSON.stringify(policies);
  try {
    localStorage.setItem(key, text);
    cachedText = text;
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  snapshot = { policies, error: '', persistent: !memoryOnly };
  window.dispatchEvent(new Event(eventName));
}
/**
 * 中文：同时监听跨窗口 storage 与当前窗口策略事件，返回对应退订；全量清空或本策略键变化才重读缓存。
 * English: Listen to cross-window storage and in-window policy events, returning an unsubscribe. Invalidate cached storage only for a full clear or this policy key.
 * 中文：输入：changed：偏好变化通知回调
 * English: Inputs: changed: preference-change notification callback
 * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
 * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
 */
export function subscribeClipboardPolicies(changed: /** 中文：通知本地偏好变化，订阅者随后读取最新快照；这是 subscribeClipboardPolicies 的调用契约 | English: Notify local preference changes so subscribers read the latest snapshot; this is the callable contract of subscribeClipboardPolicies | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) {
  /**
   * 中文：外部窗口修改本策略键或清空存储时撤销内存专用标记和文本缓存，再通知订阅者重新读取。
   * English: When another window changes this policy key or clears storage, clear memory-only/text-cache markers and notify subscribers to reread.
   * 中文：输入：event：触发本处理器的事件及其数据
   * English: Inputs: event: triggering event and its data
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === key) {
      memoryOnly = false;
      cachedText = undefined;
      changed();
    }
  };
  window.addEventListener('storage', storage);
  window.addEventListener(eventName, changed);
  /**
   * 中文：在按当前工作区应用上下文缓存与判定剪贴板传输规则流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Caching and evaluating clipboard-transfer rules for the current workspace application context, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(eventName, changed);
  };
}
/**
 * 中文：从事件目标的最近应用容器读取剪贴板应用和实例身份；未知应用回退到 workbench，使没有容器的元素仍受默认规则控制。
 * English: Read clipboard application and VM identity from the event target's nearest application container. Unknown apps fall back to workbench so unscoped elements still follow default rules.
 * 中文：输入：target：事件目标或操作目标
 * English: Inputs: target: event/operation target
 * 中文：结果：包含 app、vmId 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing app, vmId for caller state reads/operations
 */
export function clipboardContext(target: EventTarget | null): ClipboardContext {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-clipboard-app]') : null;
  const app = element?.dataset.clipboardApp;
  return {
    app: clipboardApps.includes(app as ClipboardApp) ? (app as ClipboardApp) : 'workbench',
    vmId: element?.dataset.clipboardVm,
  };
}
/**
 * 中文：把当前缓存策略与应用/实例上下文交给共享决策器，返回覆盖默认值后的有效规则。
 * English: Resolve the cached policy against application/VM context through the shared evaluator, returning the rule after default overrides.
 * 中文：输入：context：当前调用所属的应用或工作区上下文
 * English: Inputs: context: application/workspace context for the call
 */
export function currentClipboardRule(context: ClipboardContext) {
  return effectiveClipboardRule(getClipboardPolicies().policies, context);
}
/**
 * 中文：按应用规则核对方向、UTF-8 字节数和文件传输；超长文本无需完整编码，策略损坏或决策返回原因时抛出可显示的阻止错误。
 * English: Check direction, UTF-8 byte count and file transfer against the application rule. Avoid fully encoding oversized text; throw a displayable blocking error for damaged policy or an evaluator refusal.
 * 中文：输入：context：当前调用所属的应用或工作区上下文；direction：复制或粘贴的传输方向；text：待处理的文本内容；hasFiles：本次剪贴板内容是否包含文件（缺省 false）
 * English: Inputs: context: application/workspace context for the call; direction: copy/paste transfer direction; text: text content to process; hasFiles: whether clipboard content contains files (default false)
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function assertClipboardPolicy(
  context: ClipboardContext,
  direction: 'copy' | 'paste',
  text: string,
  hasFiles = false,
) {
  const state = getClipboardPolicies();
  const reason =
    state.error ||
    clipboardPolicyReason(
      effectiveClipboardRule(state.policies, context),
      direction,
      text.length > 1048576 ? 1048577 : new TextEncoder().encode(text).length,
      hasFiles,
      context.app,
    );
  if (reason) throw new Error(`剪贴板传递已阻止：${reason}。可在设置中调整按应用剪贴板策略。`);
}
