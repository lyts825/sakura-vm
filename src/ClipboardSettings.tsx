import { useState, useSyncExternalStore } from 'react';
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

export function ClipboardSettings({ vms = [] }: { vms?: { id: string; name: string }[] }) {
  const enabled = useSyncExternalStore(subscribeClipboardProtection, clipboardProtectionEnabled);
  const state = useSyncExternalStore(subscribeClipboardPolicies, getClipboardPolicies);
  const [scope, setScope] = useState('global'),
    [app, setApp] = useState<ClipboardApp>('terminal'),
    [error, setError] = useState('');
  const context = { app, vmId: scope === 'global' ? undefined : scope };
  const rule = effectiveClipboardRule(state.policies, context);
  const overridden = scope === 'global' || !!state.policies.instances[scope]?.[app];
  const save = (next: typeof state.policies) => {
    try {
      setClipboardPolicies(next);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const update = (value: ClipboardRule) => {
    const next = structuredClone(state.policies);
    if (scope === 'global') next.defaults[app] = value;
    else next.instances[scope] = { ...next.instances[scope], [app]: value };
    save(next);
  };
  return (
    <div className="system-card">
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
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="global">所有实例的默认策略</option>
            {vms.map((vm) => (
              <option key={vm.id} value={vm.id}>
                {vm.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          应用入口
          <select value={app} onChange={(e) => setApp(e.target.value as ClipboardApp)}>
            {clipboardApps.map((value) => (
              <option key={value} value={value}>
                {clipboardAppNames[value]}
              </option>
            ))}
          </select>
        </label>
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
      </details>
    </div>
  );
}
