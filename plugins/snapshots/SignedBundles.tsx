import { useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type TrustedKey = { name: string; fingerprint: string; publicKey: string };
type View = {
  revision: number;
  requireTrustedOnImport: boolean;
  localKey: TrustedKey | null;
  trustedKeys: TrustedKey[];
};

export function SignedBundlesPanel({ request }: { request: Request }) {
  const remote = useRemote<View>(request, '/signed-bundles', true, 30000);
  const action = useAction();
  const [name, setName] = useState(''),
    [publicKey, setPublicKey] = useState('');
  const view = remote.data;
  const change = (body: Record<string, unknown>, message: string, onSuccess?: () => void) =>
    void action.run(async (signal) => {
      if (!view) throw new Error('签名策略尚未加载');
      await request('/signed-bundles', 'POST', { ...body, revision: view.revision }, signal);
      onSuccess?.();
      remote.reload();
    }, message);
  return (
    <div className="feature-card">
      <h4>签名实例包</h4>
      <p className="subtle-note">
        启用后，本机导出的实例包会以 Ed25519
        签名；外部导入仅接受受信任公钥签名且磁盘校验通过的包。已有本地备份和黄金镜像仍可恢复。
      </p>
      <Feedback error={action.error || remote.error} message={action.message} />
      {view && (
        <>
          <div className="feature-actions">
            <span className={`badge ${view.requireTrustedOnImport ? 'running' : ''}`}>
              {view.requireTrustedOnImport ? '仅允许受信任签名导入' : '允许旧格式导入'}
            </span>
            <button
              className="secondary compact"
              disabled={action.busy}
              onClick={() =>
                change(
                  { action: 'configure', requireTrustedOnImport: !view.requireTrustedOnImport },
                  view.requireTrustedOnImport ? '已允许旧格式导入' : '已启用签名实例包策略',
                )
              }
            >
              {view.requireTrustedOnImport ? '停用严格导入' : '启用严格导入'}
            </button>
          </div>
          {view.localKey && (
            <label className="signed-bundles-fingerprint">
              本机签名公钥 · SHA-256 {view.localKey.fingerprint}
              <textarea aria-label="本机签名公钥" readOnly value={view.localKey.publicKey} rows={4} />
            </label>
          )}
          <div className="inline-form">
            <input
              aria-label="受信任公钥名称"
              placeholder="公钥名称"
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="secondary compact"
              disabled={action.busy || !name.trim() || !publicKey.trim()}
              onClick={() =>
                change({ action: 'trust', name, publicKey }, '已加入受信任公钥', () => {
                  setName('');
                  setPublicKey('');
                })
              }
            >
              信任公钥
            </button>
          </div>
          <textarea
            aria-label="粘贴 Ed25519 公钥"
            placeholder="粘贴另一台 Sakura 的本机签名公钥（PEM）"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            rows={4}
            maxLength={2000}
          />
          <div className="snapshot-list">
            {view.trustedKeys.map((key) => (
              <div key={key.fingerprint}>
                <div>
                  <b>{key.name}</b>
                  <p className="signed-bundles-fingerprint">SHA-256 {key.fingerprint}</p>
                </div>
                <button
                  className="text-button danger-text"
                  disabled={
                    action.busy ||
                    (view.requireTrustedOnImport && key.fingerprint === view.localKey?.fingerprint)
                  }
                  onClick={() =>
                    change({ action: 'forget', fingerprint: key.fingerprint }, '已移除受信任公钥')
                  }
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
