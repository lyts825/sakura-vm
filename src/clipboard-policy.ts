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
export function subscribeClipboardPolicies(changed: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === key) {
      memoryOnly = false;
      cachedText = undefined;
      changed();
    }
  };
  window.addEventListener('storage', storage);
  window.addEventListener(eventName, changed);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(eventName, changed);
  };
}
export function clipboardContext(target: EventTarget | null): ClipboardContext {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-clipboard-app]') : null;
  const app = element?.dataset.clipboardApp;
  return {
    app: clipboardApps.includes(app as ClipboardApp) ? (app as ClipboardApp) : 'workbench',
    vmId: element?.dataset.clipboardVm,
  };
}
export function currentClipboardRule(context: ClipboardContext) {
  return effectiveClipboardRule(getClipboardPolicies().policies, context);
}
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
