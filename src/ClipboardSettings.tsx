import { useSyncExternalStore } from 'react';
import {
  clipboardProtectionEnabled,
  setClipboardProtection,
  subscribeClipboardProtection,
} from './clipboard-protection';

export function ClipboardSettings() {
  const enabled = useSyncExternalStore(subscribeClipboardProtection, clipboardProtectionEnabled);
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
        检查本页面复制、剪切及桌面双向文本传递；检测在浏览器本地完成，不读取后台剪贴板、不保存文本。可识别常见私钥、令牌和明文凭据格式，不能识别所有秘密或图片内容。
      </p>
      <p className="subtle-note">设置仅保存在此浏览器。启用时超过 1 MiB 的文本会被阻止。</p>
    </div>
  );
}
