/**
 * 模块职责（中文）：显示敏感剪贴板保护开关及其生效说明，同步浏览器内的策略变更。
 * Module responsibility (English): Editing sensitive-clipboard protection preferences in the browser.
 * 详细范围（中文）：公开入口包括 ClipboardSettings；职责覆盖编辑浏览器的敏感剪贴板保护偏好，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ClipboardSettings. The scope covers Editing sensitive-clipboard protection preferences in the browser. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState, useSyncExternalStore } from 'react';
import './settings-feedback.css';
import {
  clipboardAppNames,
  clipboardApps,
  defaultClipboardPolicies,
  effectiveClipboardRule,
  type ClipboardApp,
  type ClipboardRule,
} from '../shared/clipboard-policy';
import { getClipboardPolicies, setClipboardPolicies, subscribeClipboardPolicies } from './clipboard-policy';
import {
  clipboardProtectionEnabled,
  setClipboardProtection,
  subscribeClipboardProtection,
} from './clipboard-protection';

/**
 * 中文：呈现编辑浏览器的敏感剪贴板保护偏好中的 ClipboardSettings 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ClipboardSettings surface for Editing sensitive-clipboard protection preferences in the browser. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vms = [] } 提供 vms（vms 状态） 上下文字段
 * English: Inputs: { vms = [] } provides context fields vms (vms state)
 */
export function ClipboardSettings({ vms = [] }: { vms?: { id: string; name: string }[] }) {
  const enabled = useSyncExternalStore(subscribeClipboardProtection, clipboardProtectionEnabled);
  const state = useSyncExternalStore(subscribeClipboardPolicies, getClipboardPolicies);
  const [scope, setScope] = useState('global'),
    [app, setApp] = useState<ClipboardApp>('terminal'),
    [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const context = { app, vmId: scope === 'global' ? undefined : scope };
  const rule = effectiveClipboardRule(state.policies, context);
  const overridden = scope === 'global' || !!state.policies.instances[scope]?.[app];
  /**
   * 中文：在编辑浏览器的敏感剪贴板保护偏好流程中clipboardPolicies 状态，错误反馈；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing sensitive-clipboard protection preferences in the browser, clipboardPolicies state, error feedback. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：next：待采用的新状态或数据
   * English: Inputs: next: new state/data to adopt
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const save = (next: typeof state.policies) => {
    try {
      setClipboardPolicies(next);
      setError('');
      setMessage('剪贴板策略已更新，立即生效。');
    } catch (error) {
      setError((error as Error).message);
      setMessage('');
    }
  };
  /**
   * 中文：更新 next.defaults[app]、next.instances[scope] 以维护编辑浏览器的敏感剪贴板保护偏好当前状态；这些赋值属于此输入/事件的状态转换
   * English: Update next.defaults[app], next.instances[scope] to maintain current state for Editing sensitive-clipboard protection preferences in the browser; these assignments belong to this input/event transition
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const update = (value: ClipboardRule) => {
    const next = structuredClone(state.policies);
    if (scope === 'global') next.defaults[app] = value;
    else next.instances[scope] = { ...next.instances[scope], [app]: value };
    save(next);
  };
  return (
    <section className="system-card clipboard-settings" aria-label="剪贴板敏感检测设置">
      <h3>剪贴板敏感检测</h3>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setClipboardProtection(event.target.checked)}
        />
        阻止复制疑似密钥和令牌
      </label>
      <p className="subtle-note">
        检查本页面复制、剪切、粘贴及桌面双向文本传递；检测在浏览器本地完成，不读取后台剪贴板、不保存文本。可识别常见私钥、令牌和明文凭据格式，不能识别所有秘密或图片内容。
      </p>
      <p className="subtle-note">设置仅保存在此浏览器。启用时超过 1 MiB 的文本会被阻止。</p>
      <details className="clipboard-policies">
        <summary>按应用剪贴板策略</summary>
        <p>
          控制 Sakura 网页工作台中的应用入口；全局设置可由单个实例覆盖。不会修改 Windows 或 Linux
          其他程序的系统剪贴板权限。
        </p>
        {(state.error || error) && <p role="alert">{state.error || error}</p>}
        {!state.persistent && <p role="status">浏览器无法保存策略；当前标签页仍生效，关闭后不保留。</p>}
        <label>
          策略范围
          <select aria-label="策略范围" value={scope} onChange={(e) => { setScope(e.target.value); setMessage(''); setError(''); }}>
            <option value="global">所有实例的默认策略</option>
            {vms.map((vm) => (
              <option key={vm.id} value={vm.id} data-locale-ignore>
                {vm.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          应用入口
          <select aria-label="应用入口" value={app} onChange={(e) => { setApp(e.target.value as ClipboardApp); setMessage(''); setError(''); }}>
            {clipboardApps.map((value) => (
              <option key={value} value={value}>
                {clipboardAppNames[value]}
              </option>
            ))}
          </select>
        </label>
        <div className="clipboard-rule-summary" aria-label="当前生效的剪贴板策略">
          <p><strong>{clipboardAppNames[app]}</strong> · {scope === 'global' ? '全局默认策略' : overridden ? '使用实例独立策略' : '继承全局默认策略'}</p>
          <dl>
            <div><dt>复制与剪切</dt><dd>{rule.copy ? '允许' : '已阻止'}</dd></div>
            <div><dt>粘贴</dt><dd>{rule.paste ? '允许' : '已阻止'}</dd></div>
            <div><dt>敏感文本检测</dt><dd>{enabled || rule.sensitive ? '开启' : '关闭'}</dd></div>
            <div><dt>策略文本上限</dt><dd>{rule.maxTextBytes / 1024} KiB</dd></div>
          </dl>
          {scope !== 'global' && !overridden && <p className="subtle-note">勾选下方“为此实例单独设置”后，可以修改此实例的规则。</p>}
        </div>
        {scope !== 'global' && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              disabled={!!state.error}
              checked={overridden}
              onChange={(e) => {
                if (e.target.checked) update({ ...rule });
                else {
                  const next = structuredClone(state.policies);
                  delete next.instances[scope]?.[app];
                  if (!Object.keys(next.instances[scope] || {}).length) delete next.instances[scope];
                  save(next);
                }
              }}
            />
            为此实例单独设置
          </label>
        )}
        <fieldset disabled={!overridden || !!state.error}>
          <legend>{clipboardAppNames[app]}的剪贴板权限</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={rule.copy}
              onChange={(e) => update({ ...rule, copy: e.target.checked })}
            />
            允许复制与剪切到宿主
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={rule.paste}
              onChange={(e) => update({ ...rule, paste: e.target.checked })}
            />
            允许从宿主粘贴
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={rule.files}
              onChange={(e) => update({ ...rule, files: e.target.checked })}
            />
            允许剪贴板文件与图片
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={rule.sensitive}
              onChange={(e) => update({ ...rule, sensitive: e.target.checked })}
            />
            此应用始终检查敏感文本
          </label>
          <label>
            文本上限
            <select
              aria-label="文本上限"
              value={rule.maxTextBytes}
              onChange={(e) => update({ ...rule, maxTextBytes: Number(e.target.value) })}
            >
              {[1024, 4096, 16384, 65536, 262144, 1048576].map((value) => (
                <option key={value} value={value}>
                  {value / 1024} KiB
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <p className="subtle-note">
          设置立即生效。终端粘贴另有 16 KiB
          上限；全局敏感检测开启时，应用不能关闭检测。文件上传、下载和键盘输入不属于剪贴板操作。
        </p>
        <button className="secondary compact" onClick={() => save(defaultClipboardPolicies())}>
          恢复全部剪贴板默认策略
        </button>
        {message && <p role="status" className="clipboard-save-message">{message}</p>}
      </details>
    </section>
  );
}
