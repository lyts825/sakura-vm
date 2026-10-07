/**
 * 模块职责（中文）：按用户触发运行 axe 页面审计，展示违规元素、规则说明和定位入口。
 * Module responsibility (English): User-triggered accessibility auditing and locating affected page elements.
 * 详细范围（中文）：公开入口包括 AccessibilityAudit；职责覆盖按用户触发运行无障碍检查并定位页面问题，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include AccessibilityAudit. The scope covers User-triggered accessibility auditing and locating affected page elements. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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

/**
 * 中文：呈现按用户触发运行无障碍检查并定位页面问题中的 AccessibilityAudit 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the AccessibilityAudit surface for User-triggered accessibility auditing and locating affected page elements. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  enabled,
  pageKey,
  pageName,
  close,
} 提供 enabled（是否启用本能力或读取流程）、pageKey（pageKey 状态）、pageName（pageName 状态）、close（close 状态） 上下文字段
 * English: Inputs: {
  enabled,
  pageKey,
  pageName,
  close,
} provides context fields enabled (whether this capability/read flow is enabled), pageKey (pageKey state), pageName (pageName state), close (close state)
 */
export function AccessibilityAudit({
  enabled,
  pageKey,
  pageName,
  close,
}: {
  enabled: boolean;
  pageKey: string;
  pageName: string;
  close: /** 中文：请求关闭当前界面，实际导航或卸载由父级决定；这是 AccessibilityAudit 的调用契约 | English: Request surface closure, leaving actual navigation/unmounting to the parent; this is the callable contract of AccessibilityAudit | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
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
  /**
   * 中文：更新 located.current 以维护按用户触发运行无障碍检查并定位页面问题当前状态；这些赋值属于此输入/事件的状态转换
   * English: Update located.current to maintain current state for User-triggered accessibility auditing and locating affected page elements; these assignments belong to this input/event transition
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const clearLocation = () => {
    located.current?.removeAttribute('data-sakura-audit-target');
    located.current = undefined;
  };
  useEffect(/** 中文：当依赖 [pageKey, enabled] 变化时report 状态，错误反馈，focus 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [pageKey, enabled] change, report state, error feedback, focus state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
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
  useEffect(/** 中文：当依赖 [enabled, focusOutline] 变化时登记浏览器或资源事件监听；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [enabled, focusOutline] change, register browser/resource event listeners. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!enabled || !focusOutline) return;
    document.documentElement.dataset.sakuraAuditFocus = 'true';
    /**
     * 中文：在按用户触发运行无障碍检查并定位页面问题流程中focus 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In User-triggered accessibility auditing and locating affected page elements, focus state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const record = (event: FocusEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || element.closest('[data-audit-tools]')) return;
      setFocus((history) => [
        ...history.slice(-19),
        `${element.tagName.toLowerCase()} · tabindex ${element.tabIndex}`,
      ]);
    };
    document.addEventListener('focusin', record);
    /**
     * 中文：在按用户触发运行无障碍检查并定位页面问题流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In User-triggered accessibility auditing and locating affected page elements, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      delete document.documentElement.dataset.sakuraAuditFocus;
      document.removeEventListener('focusin', record);
    };
  }, [enabled, focusOutline]);
  /**
   * 中文：在按用户触发运行无障碍检查并定位页面问题流程中忙碌标记，错误反馈，report 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In User-triggered accessibility auditing and locating affected page elements, busy flag, error feedback, report state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
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
      /**
       * 中文：把 axe 结果压缩为可导出的规则与节点视图，复用 DOM 元素身份并为定位保留引用；每规则最多保留 500 个节点但保留总数。
       * English: Compact axe results into exportable rule/node views, reuse DOM identities and retain element references for location. Keep at most five hundred nodes per rule while retaining the total count.
       * 中文：输入：rows：签名所示 Result[] 业务值
       * English: Inputs: rows: the Result[] domain value in the signature
       * 中文：结果：Finding[]，包含上述计算或传输完成值；抛错分支不提供成功结果
       * English: Result: Finding[] carrying the described computation/transport result; throwing branches do not provide success
       */
      const compact = (rows: Result[]): Finding[] =>
        rows.map((rule) => ({
          id: rule.id,
          help: translations[rule.id]?.help || rule.help,
          description: translations[rule.id]?.description || rule.description,
          helpUrl: rule.helpUrl,
          impact: rule.impact || null,
          nodeCount: rule.nodes.length,
          nodes: rule.nodes.slice(0, 500).map(/**
           * 中文功能：为每个可访问性违规 DOM 节点复用或分配稳定 ID，保存可定位元素并去重相关检查名称。
           * English: Reuse/allocate a stable ID per accessibility-violation DOM node, retain locatable elements and deduplicate related check names.
           * 输入 / Inputs: node.
           * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
           * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
           * 设计思路：WeakMap 中的元素身份与用于聚焦的 ID 索引分开，缺失 element 仍返回 unknown 标签，保持报告记录可显示。
           * Design: Separate WeakMap element identity from the focus-by-ID index; missing elements still return an unknown tag so report rows remain displayable.
           */
          (node) => {
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
  /**
   * 中文：在按用户触发运行无障碍检查并定位页面问题流程中错误反馈，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In User-triggered accessibility auditing and locating affected page elements, error feedback, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：id：目标资源标识
   * English: Inputs: id: target resource identifier
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
  /**
   * 中文：呈现规则标题、影响说明、文档链接和节点定位按钮；超过保留上限时说明完整数量与已保留节点数。
   * English: Render rule titles/impact/help links/node-location buttons, explaining full versus retained counts when the storage cap is exceeded.
   * 中文：输入：title：签名所示 string 业务值；rows：签名所示 Finding[] 业务值
   * English: Inputs: title: the string domain value in the signature; rows: the Finding[] domain value in the signature
   */
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
