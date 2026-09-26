import type { ClipboardContext } from '../shared/clipboard-policy';
import { assertClipboardPolicy, clipboardContext, currentClipboardRule } from './clipboard-policy';
const key = 'sakura-clipboard-protection';
const changeEvent = 'sakura-clipboard-protection-change';
let fallback = false;
let memoryOnly = false;

export function clipboardProtectionEnabled() {
  if (memoryOnly) return fallback;
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return fallback;
  }
}
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
export function subscribeClipboardProtection(changed: () => void) {
  const storage = (event: StorageEvent) => {
    if (!event.key || event.key === key) changed();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(changeEvent, changed);
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
export function assertClipboardSafe(text: string, enabled = clipboardProtectionEnabled()) {
  const reason = enabled ? sensitiveClipboardReason(text) : null;
  if (reason) throw new Error(`剪贴板传递已阻止：${reason}。可在设置中调整剪贴板敏感检测。`);
}
export function assertClipboardTransfer(
  context: ClipboardContext,
  direction: 'copy' | 'paste',
  text: string,
  hasFiles = false,
) {
  assertClipboardPolicy(context, direction, text, hasFiles);
  assertClipboardSafe(text, clipboardProtectionEnabled() || currentClipboardRule(context).sensitive);
}
export async function writeProtectedClipboard(
  text: string,
  context: ClipboardContext = { app: 'workbench' },
) {
  assertClipboardTransfer(context, 'copy', text);
  await navigator.clipboard.writeText(text);
}

export function installClipboardProtection(document: Document, blocked: (message: string) => void) {
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
  const capture = (event: ClipboardEvent) => check(event, true),
    bubble = (event: ClipboardEvent) => check(event, false);
  for (const type of ['copy', 'cut'] as const) {
    document.addEventListener(type, capture, true);
    document.addEventListener(type, bubble);
  }
  document.addEventListener('paste', capture, true);
  return () => {
    for (const type of ['copy', 'cut'] as const) {
      document.removeEventListener(type, capture, true);
      document.removeEventListener(type, bubble);
    }
    document.removeEventListener('paste', capture, true);
  };
}
