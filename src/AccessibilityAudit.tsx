import { useEffect, useRef, useState } from 'react';
import type { Result } from 'axe-core';
import { saveBlob } from './export-file';
import './accessibility-audit.css';

type Finding = {
  id: string;
  help: string;
  description: string;
  helpUrl: string;
  impact: string | null;
  nodeCount: number;
  nodes: { id: string; tag: string; checks: string[] }[];
};
type Report = {
  engine: string;
  checkedAt: string;
  page: string;
  scope: string;
  passedRules: number;
  notApplicableRules: number;
  violations: Finding[];
  review: Finding[];
};

export function AccessibilityAudit({
  enabled,
  pageKey,
  pageName,
  close,
}: {
  enabled: boolean;
  pageKey: string;
  pageName: string;
  close: () => void;
}) {
  const [report, setReport] = useState<Report>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focusOutline, setFocusOutline] = useState(false);
  const [focus, setFocus] = useState<string[]>([]);
  const epoch = useRef(0),
    running = useRef(false),
    elements = useRef(new Map<string, Element>()),
    located = useRef<Element | undefined>(undefined);
  const clearLocation = () => {
    located.current?.removeAttribute('data-sakura-audit-target');
    located.current = undefined;
  };
  useEffect(() => {
    epoch.current++;
    setReport(undefined);
    setError('');
    setFocus([]);
    elements.current.clear();
    clearLocation();
    return () => {
      epoch.current++;
      clearLocation();
    };
  }, [pageKey, enabled]);
  useEffect(() => {
    if (!enabled || !focusOutline) return;
    document.documentElement.dataset.sakuraAuditFocus = 'true';
    const record = (event: FocusEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || element.closest('[data-audit-tools]')) return;
      setFocus((history) => [
        ...history.slice(-19),
        `${element.tagName.toLowerCase()} · tabindex ${element.tabIndex}`,
      ]);
    };
    document.addEventListener('focusin', record);
    return () => {
      delete document.documentElement.dataset.sakuraAuditFocus;
      document.removeEventListener('focusin', record);
    };
  }, [enabled, focusOutline]);
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setReport(undefined);
    clearLocation();
    const version = ++epoch.current;
    try {
      const [{ default: axe }, { default: locale }] = await Promise.all([
        import('axe-core'),
        import('axe-core/locales/zh_CN.json'),
      ]);
      if (version !== epoch.current) return;
      // Keep rule translations as text. Applying template-based check translations
      // would require dynamic evaluation, which the production CSP deliberately forbids.
      axe.configure({ allowedOrigins: [] });
      const translations: Record<string, { help: string; description: string }> = locale.rules;
      const result = await axe.run(
        { exclude: [['[data-audit-tools]']] },
        {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
          },
          iframes: false,
          preload: false,
          selectors: false,
          elementRef: true,
          resultTypes: ['violations', 'incomplete'],
        },
      );
      if (version !== epoch.current) return;
      elements.current.clear();
      const identities = new Map<Element, string>();
      let nextIdentity = 1;
      const compact = (rows: Result[]): Finding[] =>
        rows.map((rule) => ({
          id: rule.id,
          help: translations[rule.id]?.help || rule.help,
          description: translations[rule.id]?.description || rule.description,
          helpUrl: rule.helpUrl,
          impact: rule.impact || null,
          nodeCount: rule.nodes.length,
          nodes: rule.nodes.slice(0, 500).map((node) => {
            const element = node.element;
            let id = element && identities.get(element);
            if (!id) {
              id = 'element-' + nextIdentity++;
              if (element) {
                identities.set(element, id);
                elements.current.set(id, element);
              }
            }
            return {
              id,
              tag: element?.tagName.toLowerCase() || 'unknown',
              checks: [...new Set([...node.any, ...node.all, ...node.none].map((check) => check.id))],
            };
          }),
        }));
      setReport({
        engine: `axe-core ${result.testEngine.version}`,
        checkedAt: result.timestamp,
        page: pageName,
        scope:
          'Rendered main document; excludes audit controls and iframe contents. Maximum 500 elements per rule.',
        passedRules: result.passes.length,
        notApplicableRules: result.inapplicable.length,
        violations: compact(result.violations),
        review: compact(result.incomplete),
      });
    } catch (error) {
      if (version === epoch.current) setError(String((error as Error).message || error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const locate = (id: string) => {
    const element = elements.current.get(id);
    if (!element?.isConnected) {
      setError('元素已变化，请重新检查当前页面。');
      return;
    }
    clearLocation();
    located.current = element;
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    element.setAttribute('data-sakura-audit-target', 'true');
    if (element instanceof HTMLElement && element.tabIndex >= 0) element.focus({ preventScroll: true });
  };
  if (!enabled) return null;
  const findings = (title: string, rows: Finding[]) => (
    <section aria-label={title}>
      <h3>
        {title}（{rows.length} 条规则）
      </h3>
      {rows.map((rule) => (
        <details key={rule.id} data-audit-rule={rule.id}>
          <summary>
            {rule.help} · {rule.nodeCount} 个元素
          </summary>
          <p>{rule.description}</p>
          <a href={rule.helpUrl} target="_blank" rel="noreferrer">
            规则说明：{rule.id}
          </a>
          <ul>
            {rule.nodes.map((node, index) => (
              <li key={`${node.id}-${index}`}>
                <button className="text-button" onClick={() => locate(node.id)}>
                  定位 {node.id} · {node.tag}
                </button>
              </li>
            ))}
          </ul>
          {rule.nodeCount > rule.nodes.length && <p>仅保留前 500 个元素，全部数量见上方。</p>}
        </details>
      ))}
    </section>
  );
  return (
    <aside className="accessibility-audit" data-audit-tools role="region" aria-label="无障碍检查面板">
      <div className="panel-heading">
        <h2>无障碍检查</h2>
        <button className="text-button" onClick={close}>
          关闭检查模式
        </button>
      </div>
      <p>
        检查当前已渲染页面的 WCAG A/AA 规则与最佳实践，不包含内嵌页面和 Linux
        桌面画面。自动结果不能替代人工键盘与屏幕阅读器验证。
      </p>
      <button className="secondary compact" disabled={busy} onClick={() => void run()}>
        {busy ? '正在检查…' : '检查当前页面'}
      </button>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={focusOutline}
          onChange={(event) => setFocusOutline(event.target.checked)}
        />
        突出显示键盘焦点
      </label>
      {focusOutline && (
        <details>
          <summary>焦点轨迹（最近 {focus.length} 次）</summary>
          <p>在页面按 Tab / Shift+Tab 检查顺序、焦点可见性和能否离开控件，再用屏幕阅读器核对朗读结果。</p>
          <ol>
            {focus.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p role="status">
            检查完成：{report.violations.length} 条规则发现问题，{report.review.length} 条需人工复核，
            {report.passedRules} 条通过。
          </p>
          <p className="subtle-note">
            {report.engine} · {new Date(report.checkedAt).toLocaleTimeString()} · 页面内容变化后请重新检查。
          </p>
          <button
            className="text-button"
            onClick={() =>
              saveBlob(
                'sakura-accessibility.json',
                new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
              )
            }
          >
            导出无障碍报告
          </button>
          {findings('发现的问题', report.violations)}
          {findings('需人工复核', report.review)}
        </>
      )}
    </aside>
  );
}
