/** 中文：管理本地发行包的发布者信任、检查、暂存和启动指针。English: Manage publisher trust, local-release verification, staging and activation pointers. */
import { useState } from 'react';
import { trustedUpdateResponseSchema, type TrustedUpdateView } from '../shared/contracts/trusted-update.ts';
import type { Request } from './feature-shared';
import { Feedback, useAction, useRemote } from './feature-shared';

export function TrustedUpdateSettings({ request }: { request: Request }) {
  const remote = useRemote<TrustedUpdateView>(request, '/trusted-updates');
  const action = useAction();
  const [view, setView] = useState<TrustedUpdateView | null>(null);
  const [path, setPath] = useState(''), [label, setLabel] = useState(''), [source, setSource] = useState(''), [publicKey, setPublicKey] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const state = view || remote.data;
  const change = (input: { action: string; [key: string]: unknown }) => void action.run(async (signal) => {
    if (input.action === 'stage' || input.action === 'check') setView((current) => current ? { ...current, checked: undefined } : current);
    const result = await request<TrustedUpdateView>('/trusted-updates', 'POST', input, signal);
    signal.throwIfAborted(); setView(trustedUpdateResponseSchema.parse(result)); setAcknowledge(false);
  });
  return <section className="feature-card" aria-label="可信更新中心">
    <h3>可信更新中心</h3>
    <p className="subtle-note">选择已下载的本地发行包。签名认证发布者和声明来源，暂存通过隔离健康检查后，启用将在重启时生效。</p>
    <Feedback error={action.error || remote.error} message={state?.message} />
    <button className="secondary compact" disabled={action.busy} onClick={() => { setView(null); remote.reload(); }}>刷新更新状态</button>
    {state && <>
      <p>当前启动指针：{state.active.path} · {state.active.verified ? '已认证：' + state.active.publisher : '发布者未认证'}</p>
      <details><summary>受信任发布者（{state.publishers.length}）</summary>
        {state.publishers.map((publisher) => <div key={publisher.id} className="diagnostic-row">
          <b>{publisher.label}</b><p>{publisher.source}</p><p style={{ overflowWrap: 'anywhere' }}>公钥指纹：{publisher.id}</p>
          <button className="secondary compact" disabled={action.busy} onClick={() => change({ action: 'remove-publisher', revision: state.trustRevision, id: publisher.id })}>撤销信任</button>
        </div>)}
        <label>发布者名称<input disabled={action.busy} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <label>声明来源 URL<input disabled={action.busy} value={source} placeholder="https://example.org/releases" onChange={(event) => setSource(event.target.value)} /></label>
        <label>Ed25519 公钥<textarea disabled={action.busy} value={publicKey} placeholder="-----BEGIN PUBLIC KEY-----" onChange={(event) => setPublicKey(event.target.value)} /></label>
        <button className="secondary compact" disabled={action.busy || !label || !source || !publicKey} onClick={() => change({ action: 'add-publisher', revision: state.trustRevision, label, source, publicKey })}>信任此发布者与来源</button>
      </details>
      <label>本地发行包目录<input disabled={action.busy} value={path} onChange={(event) => { setPath(event.target.value); if (view?.checked) setView({ ...view, checked: undefined }); }} /></label>
      <button className="secondary compact" disabled={action.busy || !path} onClick={() => change({ action: 'check', path })}>检查签名与完整性</button>
      {state.checked && <div className="diagnostic-row">
        <b>{state.checked.version} · {state.checked.publisher}</b><p>来源：{state.checked.source} · 序号 {state.checked.sequence} · {state.checked.files} 个文件</p>
        <p style={{ overflowWrap: 'anywhere' }}>发行指纹：{state.checked.fingerprint}</p><p>签名到期：{state.checked.expiresAt}</p>
        <button className="secondary compact" disabled={action.busy} onClick={() => change({ action: 'stage', token: state.checked!.token })}>暂存并运行健康检查</button>
      </div>}
      {state.candidates.map((candidate) => <div key={candidate.path} className="diagnostic-row">
        <b>{candidate.version || '候选版本'} · {candidate.verified ? candidate.publisher : '未认证或不可用'}</b>
        <p>{candidate.path}</p>{candidate.error && <p>{candidate.error}</p>}
        <button className="secondary compact" disabled={action.busy || !candidate.verified || candidate.path === state.active.path}
          onClick={() => change({ action: 'activate', path: candidate.path, revision: state.trustRevision })}>下次启动使用此版本</button>
      </div>)}
      {state.previous && <div>
        <p>回退目标：{state.previous.path} · {state.previous.verified ? '发布者已认证' : '发布者未认证，仅恢复历史启动版本'}</p>
        {!state.previous.verified && <label><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />我确认回退到发布者未认证的历史版本</label>}
        <button className="secondary compact" disabled={action.busy || (!state.previous.verified && !acknowledge)} onClick={() => change({ action: 'rollback', revision: state.trustRevision,
          expectedPrevious: state.previous!.path, acknowledgeUnverified: acknowledge })}>回退启动指针</button>
      </div>}
    </>}
  </section>;
}
