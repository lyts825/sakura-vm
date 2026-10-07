/**
 * 模块职责（中文）：识别剪贴板中的敏感凭证，执行复制/粘贴前的保护检查，并同步本地保护偏好。
 * Module responsibility (English): Detecting sensitive text and applying protection rules before copy or paste.
 * 详细范围（中文）：公开入口包括 clipboardProtectionEnabled, setClipboardProtection, subscribeClipboardProtection, sensitiveClipboardReason, assertClipboardSafe, assertClipboardTransfer, writeProtectedClipboard, installClipboardProtection；职责覆盖识别敏感文本并在复制或粘贴前执行保护规则，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include clipboardProtectionEnabled, setClipboardProtection, subscribeClipboardProtection, sensitiveClipboardReason, assertClipboardSafe, assertClipboardTransfer, writeProtectedClipboard, installClipboardProtection. The scope covers Detecting sensitive text and applying protection rules before copy or paste. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { ClipboardContext } from '../shared/clipboard-policy';
import { assertClipboardPolicy, clipboardContext, currentClipboardRule } from './clipboard-policy';
const key = 'sakura-clipboard-protection';
const changeEvent = 'sakura-clipboard-protection-change';
let fallback = false;
let memoryOnly = false;

/**
 * 中文：读取敏感检测开关；存储不可用或当前仅内存模式时使用最近内存开关值。
 * English: Read the sensitive-detection switch, using its latest in-memory value when storage is unavailable or memory-only mode is active.
 */
export function clipboardProtectionEnabled() {
  if (memoryOnly) return fallback;
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return fallback;
  }
}
/**
 * 中文：更新内存开关并尝试持久化，随后发出当前窗口通知；写入失败保留已选择的开关值。
 * English: Update the in-memory switch, attempt persistence and notify this window; failed writes retain the selected value.
 * 中文：输入：enabled：是否启用本能力或读取流程
 * English: Inputs: enabled: whether this capability/read flow is enabled
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function setClipboardProtection(enabled: boolean) {
  fallback = enabled;
  try {
    localStorage.setItem(key, String(enabled));
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(changeEvent));
}
/**
 * 中文：订阅本开关的跨窗口和当前窗口变化，并返回移除两类监听的清理函数。
 * English: Subscribe to cross-window and in-window switch changes and return cleanup removing both listeners.
 * 中文：输入：changed：偏好变化通知回调
 * English: Inputs: changed: preference-change notification callback
 * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
 * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
 */
export function subscribeClipboardProtection(changed: /** 中文：通知本地偏好变化，订阅者随后读取最新快照；这是 subscribeClipboardProtection 的调用契约 | English: Notify local preference changes so subscribers read the latest snapshot; this is the callable contract of subscribeClipboardProtection | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) {
  /**
   * 中文：只对本开关键或存储全量清空通知观察者，避免其他偏好写入触发无关更新。
   * English: Notify observers only for this switch key or a full storage clear, avoiding updates caused by unrelated preferences.
   * 中文：输入：event：触发本处理器的事件及其数据
   * English: Inputs: event: triggering event and its data
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const storage = (event: StorageEvent) => {
    if (!event.key || event.key === key) changed();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(changeEvent, changed);
  /**
   * 中文：在识别敏感文本并在复制或粘贴前执行保护规则流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Detecting sensitive text and applying protection rules before copy or paste, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(changeEvent, changed);
  };
}

const patterns: Array<[string, RegExp]> = [
  ['私钥', /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----|PuTTY-User-Key-File-\d+:/],
  [
    '访问令牌',
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255}|xox[baprs]-[A-Za-z0-9-]{20,255}|sk-[A-Za-z0-9_-]{20,255})\b/,
  ],
  ['云访问密钥', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['JWT 会话令牌', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/],
  ['带凭据的 URL', /https?:\/\/[^\s/:@]+:[^\s/@]{6,}@/i],
];

/** Only return categories, never a matching value or a text excerpt. */
/**
 * 中文：以 1 MiB 字符及 UTF-8 上限约束检测，识别已知私钥/令牌和长明文凭据赋值；跳过变量引用、掩码和脱敏占位符，返回首个原因或 null。
 * English: Bound detection by one MiB of characters and UTF-8 bytes. Recognize known keys/tokens and long plaintext credential assignments, skip variable references/masks/redaction placeholders, and return the first reason or null.
 * 中文：输入：text：待处理的文本内容
 * English: Inputs: text: text content to process
 * 中文：结果：string | null，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: string | null carrying the described computation/transport result; throwing branches do not provide success
 */
export function sensitiveClipboardReason(text: string): string | null {
  if (text.length > 1024 * 1024 || new TextEncoder().encode(text).length > 1024 * 1024)
    return '文本超过 1 MiB 检测上限';
  for (const [kind, pattern] of patterns) if (pattern.test(text)) return '疑似' + kind;
  const assignments =
    /\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key)\b["']?\s*[:=]\s*["']?([^\s"'`]{12,})/gi;
  for (const match of text.matchAll(assignments))
    if (!/^(?:\$\{|\*{3}|<|process\.env\.|os\.environ|\[REDACTED\])/i.test(match[1])) return '疑似明文凭据';
  return null;
}
/**
 * 中文：仅在开关启用时运行敏感检测；命中后抛出含调整入口提示的错误，安全文本无副作用。
 * English: Run sensitive detection only when enabled; on a match throw an error with configuration guidance, leaving safe text unaffected.
 * 中文：输入：text：待处理的文本内容；enabled：是否启用本能力或读取流程（缺省 clipboardProtectionEnabled()）
 * English: Inputs: text: text content to process; enabled: whether this capability/read flow is enabled (default clipboardProtectionEnabled())
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function assertClipboardSafe(text: string, enabled = clipboardProtectionEnabled()) {
  const reason = enabled ? sensitiveClipboardReason(text) : null;
  if (reason) throw new Error(`剪贴板传递已阻止：${reason}。可在设置中调整剪贴板敏感检测。`);
}
/**
 * 中文：先执行按应用传输规则，再把全局开关与应用 sensitive 规则合并执行敏感检查；任一拒绝均中止传输。
 * English: Apply application transfer policy first, then combine the global switch with the application's sensitive rule for detection; either refusal stops transfer.
 * 中文：输入：context：当前调用所属的应用或工作区上下文；direction：复制或粘贴的传输方向；text：待处理的文本内容；hasFiles：本次剪贴板内容是否包含文件（缺省 false）
 * English: Inputs: context: application/workspace context for the call; direction: copy/paste transfer direction; text: text content to process; hasFiles: whether clipboard content contains files (default false)
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function assertClipboardTransfer(
  context: ClipboardContext,
  direction: 'copy' | 'paste',
  text: string,
  hasFiles = false,
) {
  assertClipboardPolicy(context, direction, text, hasFiles);
  assertClipboardSafe(text, clipboardProtectionEnabled() || currentClipboardRule(context).sensitive);
}
/**
 * 中文：在浏览器写入之前完成复制方向的策略和敏感检查；检测失败或浏览器授权失败通过 Promise 拒绝传回调用者。
 * English: Complete copy-policy and sensitivity checks before writing to the browser clipboard; detection or browser-permission failures reject the returned promise.
 * 中文：输入：text：待处理的文本内容；context：当前调用所属的应用或工作区上下文（缺省 { app: 'workbench' }）
 * English: Inputs: text: text content to process; context: application/workspace context for the call (default { app: 'workbench' })
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function writeProtectedClipboard(
  text: string,
  context: ClipboardContext = { app: 'workbench' },
) {
  assertClipboardTransfer(context, 'copy', text);
  await navigator.clipboard.writeText(text);
}

/**
 * 中文：为复制/剪切同时登记捕获和冒泡检查，为粘贴登记捕获检查；覆盖原选区和处理器后来提供的数据，卸载时成对移除所有监听。
 * English: Register capture and bubble checks for copy/cut and a capture check for paste. Cover both the original selection and data later supplied by handlers, and remove every listener on disposal.
 * 中文：输入：document：提供 DOM 事件和可见性的文档；blocked：向界面反馈剪贴板拒绝原因的回调
 * English: Inputs: document: document providing DOM events/visibility; blocked: callback reporting clipboard refusal reasons
 * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
 * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
 */
export function installClipboardProtection(document: Document, blocked: /** 中文：把被拒绝的剪贴板传输原因交给界面显示；这是 installClipboardProtection 的调用契约 | English: Deliver clipboard-transfer refusal reasons for UI feedback; this is the callable contract of installClipboardProtection | 中文：输入：message：签名所示 string 业务值 | English: Inputs: message: the string domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (message: string) => void) {
  /**
   * 中文：按事件方向检查纯文本、HTML、文件和密码框选区；拒绝时清空剪贴板数据并阻止默认行为，捕获阶段还阻止后续处理器，再反馈具体原因。
   * English: Check text, HTML, files and password-field selections for the event direction. On refusal clear clipboard data and prevent default handling; capture also stops later handlers before reporting the reason.
   * 中文：输入：event：触发本处理器的事件及其数据；capture：是否在事件捕获阶段执行
   * English: Inputs: event: triggering event and its data; capture: whether handling occurs in event capture
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   * 中文：拒绝原因：剪贴板传递已阻止：密码输入框中的内容。。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 剪贴板传递已阻止：密码输入框中的内容。. These errors reach the direct caller or this function's catch handler
   */
  const check = (event: ClipboardEvent, capture: boolean) => {
    const target = event.target;
    const context = clipboardContext(target);
    const direction = event.type === 'paste' ? 'paste' : 'copy';
    const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
    const selected =
      input && input.selectionStart !== null && input.selectionEnd !== null
        ? input.value.slice(input.selectionStart, input.selectionEnd)
        : document.getSelection()?.toString() || '';
    const supplied =
      event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('text/html') || '';
    let reason = '';
    try {
      const text = direction === 'paste' ? supplied : supplied || selected;
      assertClipboardTransfer(context, direction, text, !!event.clipboardData?.files.length);
      // Some editors supply rich content alongside plain text. Check both.
      const html = event.clipboardData?.getData('text/html');
      if (html) assertClipboardTransfer(context, direction, html);
      if (
        (clipboardProtectionEnabled() || currentClipboardRule(context).sensitive) &&
        direction === 'copy' &&
        input instanceof HTMLInputElement &&
        input.type === 'password' &&
        selected
      )
        throw new Error('剪贴板传递已阻止：密码输入框中的内容。');
      return;
    } catch (error) {
      reason = (error as Error).message;
    }
    event.preventDefault();
    event.clipboardData?.clearData();
    if (capture) event.stopImmediatePropagation();
    blocked(reason);
  };
  const /** 中文：在目标处理器运行前执行传输检查，拒绝时终止事件继续传播。 | English: Check transfers before target handlers run, stopping further propagation on refusal. | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data */ capture = (event: ClipboardEvent) => check(event, true),
    /**
     * 中文：在复制/剪切处理器填充数据后再次检查最终内容，防止只检查原选区而漏掉新增数据。
     * English: Recheck final copy/cut content after handlers populate it, covering data absent from the original selection.
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     */
    bubble = (event: ClipboardEvent) => check(event, false);
  for (const type of ['copy', 'cut'] as const) {
    document.addEventListener(type, capture, true);
    document.addEventListener(type, bubble);
  }
  document.addEventListener('paste', capture, true);
  /**
   * 中文：在识别敏感文本并在复制或粘贴前执行保护规则流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Detecting sensitive text and applying protection rules before copy or paste, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  return () => {
    for (const type of ['copy', 'cut'] as const) {
      document.removeEventListener(type, capture, true);
      document.removeEventListener(type, bubble);
    }
    document.removeEventListener('paste', capture, true);
  };
}
