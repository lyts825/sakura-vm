/**
 * 模块职责（中文）：管理磁盘包签名密钥和信任状态，查看签名配置并执行密钥操作。
 * Module responsibility (English): UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles.
 * 详细范围（中文）：公开入口包括 SignedBundlesPanel；职责覆盖快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SignedBundlesPanel. The scope covers UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

import type { SignedBundlesView } from './view-types';

/**
 * 中文：呈现快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现中的 SignedBundlesPanel 界面，订阅 /signed-bundles，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SignedBundlesPanel surface for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles, subscribing to /signed-bundles. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function SignedBundlesPanel({ request }: { request: Request }) {
  const remote = useRemote<SignedBundlesView>(request, '/signed-bundles', true, 30000);
  const action = useAction();
  const [name, setName] = useState(''),
    [publicKey, setPublicKey] = useState('');
  const view = remote.data;
  /**
   * 中文：提交 POST /signed-bundles，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /signed-bundles for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：body：待按操作契约编码的请求正文；message：签名所示 string 业务值；onSuccess：签名所示 () => void 业务值
   * English: Inputs: body: request body to encode under the operation contract; message: the string domain value in the signature; onSuccess: the () => void domain value in the signature
   */
  const change = (body: Record<string, unknown>, message: string, onSuccess?: /** 中文：仅操作确认成功后执行后续选择或列表核对；这是 SignedBundlesPanel.change 的调用契约 | English: Run follow-up selection/list reconciliation only after confirmed operation success; this is the callable contract of SignedBundlesPanel.change | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) =>
    void action.run(/** 中文：提交 POST /signed-bundles，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /signed-bundles for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：签名策略尚未加载。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 签名策略尚未加载. These errors reach the direct caller or this function's catch handler */ async (signal) => {
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
