/** 中文：管理本地发行包的发布者信任、检查、暂存和启动指针。English: Manage publisher trust, local-release verification, staging and activation pointers. */
import { useId, useState } from 'react';
import { trustedUpdateResponseSchema, type TrustedUpdateView } from '../shared/contracts/trusted-update.ts';
import type { Request } from './feature-shared';
import { Feedback, useAction, useRemote } from './feature-shared';
import './trusted-update-settings.css';

/** 中文：逐项显示发行身份，保留完整路径和验证指纹。English: Display release identity with complete paths and verification fingerprints. */
function ReleaseIdentity({ release }: { release: TrustedUpdateView['active'] }) {
  return <dl className="trusted-update-identity">
    <div><dt>目录</dt><dd><code data-locale-ignore>{release.path}</code></dd></div>
    {release.version && <div><dt>版本</dt><dd data-locale-ignore>{release.version}</dd></div>}
    {release.publisher && <div><dt>发布者</dt><dd data-locale-ignore>{release.publisher}</dd></div>}
    {release.source && <div><dt>声明来源</dt><dd data-locale-ignore>{release.source}</dd></div>}
    {release.fingerprint && <div><dt>发行指纹</dt><dd><code data-locale-ignore>{release.fingerprint}</code></dd></div>}
  </dl>;
}

export function TrustedUpdateSettings({ request }: { request: Request }) {
  const remote = useRemote<TrustedUpdateView>(request, '/trusted-updates');
  const action = useAction();
  const [view, setView] = useState<TrustedUpdateView | null>(null);
  const [path, setPath] = useState(''), [label, setLabel] = useState(''), [source, setSource] = useState(''), [publicKey, setPublicKey] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const hintId = useId();
  const state = view || remote.data;
  const change = (input: { action: string; [key: string]: unknown }) => void action.run(async (signal) => {
    setPendingAction(input.action);
    if (input.action === 'stage' || input.action === 'check') setView((current) => current ? { ...current, checked: undefined } : current);
    const result = await request<TrustedUpdateView>('/trusted-updates', 'POST', input, signal);
    signal.throwIfAborted(); setView(trustedUpdateResponseSchema.parse(result)); setAcknowledge(false);
  });
  const pendingLabels: Record<string, string> = { check: '正在检查签名与完整性…', stage: '正在暂存并运行健康检查…',
    activate: '正在设置下次启动版本…', rollback: '正在回退启动指针…', 'add-publisher': '正在添加发布者信任…', 'remove-publisher': '正在撤销发布者信任…' };
  return <section className="feature-card trusted-update-panel" aria-label="可信更新中心">
    <div className="trusted-update-heading">
      <h3>可信更新中心</h3>
      <button className="secondary compact" disabled={action.busy} onClick={() => { setView(null); remote.reload(); }}>刷新更新状态</button>
    </div>
    <p className="subtle-note">选择已下载的本地发行包。签名认证发布者和声明来源，暂存通过隔离健康检查后，启用将在重启时生效。</p>
    <Feedback error={action.error || remote.error} message={!action.busy && !action.error ? state?.message : undefined} />
    {!state && !remote.error && <p role="status" className="trusted-update-notice">正在读取可信更新状态…</p>}
    {remote.error && <p className="subtle-note">{state ? '当前显示上次读取的更新状态，可刷新重试。' : '更新状态尚未读取成功，请刷新重试。'}</p>}
    {action.busy && <p role="status" className="trusted-update-notice">{pendingLabels[pendingAction] || '正在处理更新操作…'}</p>}
    {state && <>
      <div className="trusted-update-section trusted-update-current">
        <div className="trusted-update-heading"><h4>当前启动指针</h4><span className="trusted-update-badge">{state.active.verified ? '发布者已认证' : '发布者未认证'}</span></div>
        <ReleaseIdentity release={state.active} />
      </div>
      <details className="trusted-update-section trusted-update-publishers"><summary>受信任发布者（{state.publishers.length}）</summary>
        {state.publishers.length === 0 && <p className="trusted-update-empty">尚无受信任发布者。添加发布者及其声明来源后，再检查发行包。</p>}
        <div className="trusted-update-cards">
          {state.publishers.map((publisher) => <div key={publisher.id} className="trusted-update-item">
            <h5 data-locale-ignore>{publisher.label}</h5>
            <dl className="trusted-update-identity">
              <div><dt>声明来源</dt><dd data-locale-ignore>{publisher.source}</dd></div>
              <div><dt>公钥指纹</dt><dd><code data-locale-ignore>{publisher.id}</code></dd></div>
            </dl>
            <button className="secondary compact" disabled={action.busy} onClick={() => change({ action: 'remove-publisher', revision: state.trustRevision, id: publisher.id })}>撤销信任</button>
          </div>)}
        </div>
        <div className="trusted-update-publisher-form">
          <h5>添加受信任发布者</h5>
          <label>发布者名称<input disabled={action.busy} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label>声明来源 URL<input disabled={action.busy} value={source} placeholder="https://example.org/releases" onChange={(event) => setSource(event.target.value)} /></label>
          <label className="trusted-update-key">Ed25519 公钥<textarea disabled={action.busy} rows={4} value={publicKey} placeholder="-----BEGIN PUBLIC KEY-----" onChange={(event) => setPublicKey(event.target.value)} /></label>
          <button className="secondary compact" disabled={action.busy || !label || !source || !publicKey} onClick={() => change({ action: 'add-publisher', revision: state.trustRevision, label, source, publicKey })}>信任此发布者与来源</button>
        </div>
      </details>
      <div className="trusted-update-section">
        <h4>1. 检查本地发行包</h4>
        <label>本地发行包目录<input disabled={action.busy} value={path} onChange={(event) => { setPath(event.target.value); if (view?.checked) setView({ ...view, checked: undefined }); }} /></label>
        {!path && <p id={`${hintId}-path`} className="subtle-note">先填写已下载的本地发行包目录。</p>}
        <button className="secondary compact" disabled={action.busy || !path} aria-describedby={!path ? `${hintId}-path` : undefined} onClick={() => change({ action: 'check', path })}>检查签名与完整性</button>
        {state.checked && <div className="trusted-update-item trusted-update-checked">
          <h5>签名与完整性检查结果</h5>
          <dl className="trusted-update-identity">
            <div><dt>版本</dt><dd data-locale-ignore>{state.checked.version}</dd></div>
            <div><dt>发布者</dt><dd data-locale-ignore>{state.checked.publisher}</dd></div>
            <div><dt>声明来源</dt><dd data-locale-ignore>{state.checked.source}</dd></div>
            <div><dt>发行序号</dt><dd>{state.checked.sequence}</dd></div>
            <div><dt>文件数量</dt><dd>{state.checked.files}</dd></div>
            <div><dt>发行指纹</dt><dd><code data-locale-ignore>{state.checked.fingerprint}</code></dd></div>
            <div><dt>签名到期</dt><dd data-locale-ignore>{state.checked.expiresAt}</dd></div>
          </dl>
          <p className="subtle-note">核对上述身份后，暂存发行包并运行隔离健康检查。</p>
          <button className="secondary compact" disabled={action.busy} onClick={() => change({ action: 'stage', token: state.checked!.token })}>暂存并运行健康检查</button>
        </div>}
      </div>
      <div className="trusted-update-section">
        <div className="trusted-update-heading"><h4>2. 选择下次启动版本</h4><span className="trusted-update-count">{state.candidates.length} 个候选版本</span></div>
        <p className="subtle-note">暂存并通过健康检查后，在这里选择版本。启用将在重启时生效。</p>
        {state.candidates.length === 0 && <p className="trusted-update-empty">尚无候选版本。请先检查并暂存本地发行包。</p>}
        <div className="trusted-update-cards">
          {state.candidates.map((candidate, index) => {
            const reason = !candidate.verified ? '此版本未认证或不可用，无法设为下次启动版本。' : candidate.path === state.active.path ? '此版本已是当前启动指针。' : '';
            const reasonId = `${hintId}-candidate-${index}`;
            return <div key={candidate.path} className="trusted-update-item">
              <div className="trusted-update-heading"><h5>{candidate.version ? <span data-locale-ignore>{candidate.version}</span> : '候选版本'}</h5><span className="trusted-update-badge">{candidate.verified ? '发布者已认证' : '未认证或不可用'}</span></div>
              <ReleaseIdentity release={candidate} />
              {candidate.error && <p className="machine-error">{candidate.error}</p>}
              {reason && <p id={reasonId} className="subtle-note">{reason}</p>}
              <button className="secondary compact" disabled={action.busy || !candidate.verified || candidate.path === state.active.path} aria-describedby={reason ? reasonId : undefined}
                onClick={() => change({ action: 'activate', path: candidate.path, revision: state.trustRevision })}>下次启动使用此版本</button>
            </div>;
          })}
        </div>
      </div>
      {state.previous && <div className="trusted-update-section">
        <h4>回退启动指针</h4>
        <p className="subtle-note">{state.previous.verified ? '回退目标的发布者已认证。' : '发布者未认证，仅恢复历史启动版本。请先确认下方选项。'}</p>
        <ReleaseIdentity release={state.previous} />
        {!state.previous.verified && <label className="trusted-update-confirm"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />我确认回退到发布者未认证的历史版本</label>}
        <button className="secondary compact" disabled={action.busy || (!state.previous.verified && !acknowledge)} onClick={() => change({ action: 'rollback', revision: state.trustRevision,
          expectedPrevious: state.previous!.path, acknowledgeUnverified: acknowledge })}>回退启动指针</button>
      </div>}
    </>}
  </section>;
}
