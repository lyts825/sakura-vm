import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { IngressInput, IngressView } from '../../shared/http-ingress.ts';
import type { CertificatePolicy, CertificateView } from '../../shared/ingress-certificates.ts';
import type { LocalAliasView } from '../../shared/local-aliases.ts';
import { Feedback, useAction, useRemote, type FeatureProps } from '../../src/feature-shared.tsx';

function localDateTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function blank(vmId: string, upstreamPort: number): IngressInput {
  return {
    name: '',
    protocol: 'http',
    domainAlias: false,
    listenPort: 8888,
    pathPrefix: '/',
    vmId,
    upstreamPort,
    healthPath: '/',
    stripPrefix: false,
    clientAuth: null,
  };
}

export function IngressPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<IngressView>(request, '/ingress');
  const certificates = useRemote<CertificateView>(request, '/ingress-certificate');
  const aliases = useRemote<LocalAliasView>(request, '/local-aliases');
  const action = useAction();
  const [form, setForm] = useState<IngressInput>(() => blank(vm.id, vm.forwards[0]?.host || 8080));
  const [policy, setPolicy] = useState<CertificatePolicy | null>(null);
  useEffect(() => {
    if (!policy && certificates.data?.policy) setPolicy(certificates.data.policy);
  }, [policy, certificates.data]);
  const entries = remote.data?.entries.filter((entry) => entry.vmId === vm.id) || [];
  const change = (value: Partial<IngressInput>) => setForm((current) => ({ ...current, ...value }));
  const refresh = () => remote.reload();
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>HTTP/HTTPS 服务入口</h3>
          <p>按路径转发到已配置的 Windows 端口，仅在本机 127.0.0.1 监听。</p>
        </div>
        <button
          className="secondary compact"
          onClick={() => setForm(blank(vm.id, vm.forwards[0]?.host || 8080))}
        >
          <Plus size={14} />
          新建
        </button>
      </div>
      <Feedback error={action.error || remote.error || certificates.error || aliases.error}
        message={action.message} />
      {entries.map((entry) => (
        <div className="feature-card" key={entry.id}>
          <div className="panel-heading">
            <div>
              <h4>{entry.name}</h4>
              <a href={entry.url} target="_blank" rel="noreferrer">
                {entry.url} <ExternalLink size={13} />
              </a>
              <p className="subtle-note">
                上游 127.0.0.1:{entry.upstreamPort} · 健康：
                {
                  {
                    healthy: '正常',
                    unhealthy: '异常',
                    stopped: '实例已停止',
                    unconfigured: '转发已移除',
                    checking: '检查中',
                  }[entry.health.status]
                }
                {entry.health.httpStatus ? `（HTTP ${entry.health.httpStatus}）` : ''}
                {entry.health.error ? `：${entry.health.error}` : ''}
              </p>
              {entry.clientAuth && <p className="subtle-note">
                mTLS 客户端证书已启用
                {entry.clientAuth.rotateAt && ` · ${Date.now() >= Date.parse(entry.clientAuth.rotateAt) ? '已于' : '将于'} ${new Date(entry.clientAuth.rotateAt).toLocaleString()} 切换至替换证书`}
              </p>}
            </div>
            <div className="feature-actions">
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  setForm({
                    id: entry.id,
                    name: entry.name,
                    protocol: entry.protocol,
                    domainAlias: entry.domainAlias,
                    listenPort: entry.listenPort,
                    pathPrefix: entry.pathPrefix,
                    vmId: entry.vmId,
                    upstreamPort: entry.upstreamPort,
                    healthPath: entry.healthPath,
                    stripPrefix: entry.stripPrefix,
                    clientAuth: entry.clientAuth,
                  })
                }
              >
                编辑
              </button>
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async (signal) => {
                    await request('/ingress', 'POST', { action: 'check', id: entry.id }, signal);
                    refresh();
                  }, '健康检查已完成')
                }
              >
                检查
              </button>
              <button
                className="icon-button"
                aria-label={`删除入口 ${entry.name}`}
                disabled={action.busy}
                onClick={() =>
                  void action.run(async (signal) => {
                    await request('/ingress', 'POST', { action: 'delete', id: entry.id }, signal);
                    if (form.id === entry.id) setForm(blank(vm.id, vm.forwards[0]?.host || 8080));
                    refresh();
                    aliases.reload();
                  }, '服务入口已删除')
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {remote.data?.listenerErrors[String(entry.listenPort)] && (
            <p role="alert" className="machine-error">
              监听失败：{remote.data.listenerErrors[String(entry.listenPort)]}
            </p>
          )}
        </div>
      ))}
      {!entries.length && <p className="muted">先添加端口转发，再创建 HTTP 服务入口。</p>}
      <div className="feature-card">
        <h4>{form.id ? '编辑入口' : '新建入口'}</h4>
        <div className="feature-grid">
          <label>
            名称
            <input
              value={form.name}
              maxLength={60}
              placeholder="Web 应用"
              onChange={(event) => change({ name: event.target.value })}
            />
          </label>
          <label>
            入口端口
            <input
              type="number"
              min={1024}
              max={65535}
              value={form.listenPort}
              onChange={(event) => change({ listenPort: Number(event.target.value) })}
            />
          </label>
          <label>
            协议
            <select
              value={form.protocol}
              onChange={(event) => change({
                protocol: event.target.value as 'http' | 'https',
                clientAuth: event.target.value === 'http' ? null : form.clientAuth,
              })}
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS（本机证书）</option>
            </select>
          </label>
          <label>
            入口路径
            <input
              value={form.pathPrefix}
              maxLength={160}
              placeholder="/app"
              onChange={(event) => change({ pathPrefix: event.target.value })}
            />
          </label>
          <label>
            上游转发端口
            <select
              value={form.upstreamPort}
              onChange={(event) => change({ upstreamPort: Number(event.target.value) })}
            >
              {!vm.forwards.some((forward) => forward.host === form.upstreamPort) && (
                <option value={form.upstreamPort}>{form.upstreamPort}（未配置）</option>
              )}
              {vm.forwards.map((forward) => (
                <option key={forward.host} value={forward.host}>
                  {forward.host} → Linux {forward.guest}
                  {forward.name ? ` · ${forward.name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            健康检查路径
            <input
              value={form.healthPath}
              maxLength={160}
              placeholder="/health"
              onChange={(event) => change({ healthPath: event.target.value })}
            />
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            checked={form.stripPrefix}
            onChange={(event) => change({ stripPrefix: event.target.checked })}
          />{' '}
          转发前移除入口路径前缀
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.domainAlias}
            onChange={(event) => change({ domainAlias: event.target.checked })}
          />{' '}
          为此入口生成 .localhost 本地域名
        </label>
        {form.protocol === 'https' && <>
          <label>
            <input type="checkbox" checked={!!form.clientAuth}
              onChange={(event) => change({ clientAuth: event.target.checked ? { currentPem: '' } : null })} />{' '}
            要求客户端证书（mTLS）
          </label>
          {form.clientAuth && <>
            <p className="subtle-note">粘贴客户端的 PEM 公钥证书；请求必须持有对应私钥。可提前登记替换证书，并按设定时间切换。</p>
            <label>当前客户端证书（PEM）
              <textarea rows={5} value={form.clientAuth.currentPem}
                onChange={(event) => change({ clientAuth: { ...form.clientAuth!, currentPem: event.target.value } })} />
            </label>
            <label>当前签发 CA（PEM，直签证书可选）
              <textarea rows={4} value={form.clientAuth.currentCaPem || ''}
                onChange={(event) => change({ clientAuth: {
                  ...form.clientAuth!, currentCaPem: event.target.value || undefined,
                } })} />
            </label>
            <label>替换客户端证书（PEM，可选）
              <textarea rows={5} value={form.clientAuth.replacementPem || ''}
                onChange={(event) => change({ clientAuth: {
                  ...form.clientAuth!,
                  replacementPem: event.target.value || undefined,
                  replacementCaPem: event.target.value ? form.clientAuth!.replacementCaPem : undefined,
                  rotateAt: event.target.value ? form.clientAuth!.rotateAt : undefined,
                } })} />
            </label>
            {form.clientAuth.replacementPem && <label>替换签发 CA（PEM，直签证书可选）
              <textarea rows={4} value={form.clientAuth.replacementCaPem || ''}
                onChange={(event) => change({ clientAuth: {
                  ...form.clientAuth!, replacementCaPem: event.target.value || undefined,
                } })} />
            </label>}
            {form.clientAuth.replacementPem && <label>切换时间
              <input type="datetime-local" value={localDateTime(form.clientAuth.rotateAt)}
                onChange={(event) => change({ clientAuth: {
                  ...form.clientAuth!,
                  rotateAt: event.target.value ? new Date(event.target.value).toISOString() : undefined,
                } })} />
            </label>}
          </>}
        </>}
        <div className="feature-actions">
          <button
            className="primary compact"
            disabled={action.busy || !vm.forwards.length || !form.name.trim()}
            onClick={() =>
              void action.run(async (signal) => {
                await request('/ingress', 'POST', { action: 'save', entry: form }, signal);
                setForm(blank(vm.id, vm.forwards[0]?.host || 8080));
                refresh();
                certificates.reload();
                aliases.reload();
              }, '服务入口已生效')
            }
          >
            <Save size={14} />
            保存入口
          </button>
        </div>
      </div>
      <div className="feature-card">
        <h4>Windows 系统域名解析</h4>
        <p className="subtle-note">启用后，Sakura 仅管理系统 hosts 文件中带标记的入口别名，使浏览器外的本机程序也能解析。修改 hosts 文件需要以管理员身份运行 Sakura；关闭时会移除 Sakura 管理的记录。</p>
        {aliases.data && <p>状态：{aliases.data.enabled ? '已启用' : '未启用'} ·
          已安装 {aliases.data.installed.length} 个 · 待同步 {aliases.data.missing.length} 个
          {aliases.data.stale.length > 0 && ` · 待移除 ${aliases.data.stale.length} 个`}</p>}
        {aliases.data?.error && <p role="alert" className="machine-error">{aliases.data.error}</p>}
        {!aliases.data?.supported && <p className="subtle-note">仅 Windows 支持系统 hosts 别名。</p>}
        <div className="feature-actions">
          <button className="secondary compact" disabled={action.busy || !aliases.data?.supported}
            onClick={() => void action.run(async (signal) => {
              try { await request('/local-aliases', 'POST',
                { action: 'set-enabled', enabled: !aliases.data?.enabled }, signal); }
              finally { aliases.reload(); }
            }, aliases.data?.enabled ? '系统别名已关闭' : '系统别名已启用')}>
            {aliases.data?.enabled ? '关闭系统解析' : '启用系统解析'}
          </button>
          <button className="secondary compact" disabled={action.busy || !aliases.data?.supported}
            onClick={() => void action.run(async (signal) => {
              try { await request('/local-aliases', 'POST', { action: 'sync' }, signal); }
              finally { aliases.reload(); }
            }, '系统别名已同步')}>重新同步</button>
        </div>
      </div>
      <div className="feature-card">
        <h4>本机 HTTPS 证书</h4>
        <p className="subtle-note">
          首次创建 HTTPS 入口时生成自签名证书。浏览器信任前会显示证书警告；私钥仅保存在本机。
        </p>
        {certificates.data?.certificate ? (
          <p>
            SHA-256 指纹：<code>{certificates.data.certificate.fingerprint256}</code>
            <br />
            有效期至 {new Date(certificates.data.certificate.validTo).toLocaleString()}
            {certificates.data.nextRotationAt &&
              ` · 下次轮换 ${new Date(certificates.data.nextRotationAt).toLocaleString()}`}
          </p>
        ) : (
          <p className="muted">尚未生成证书。</p>
        )}
        {certificates.data?.rotationError && (
          <p role="alert" className="machine-error">
            轮换失败：{certificates.data.rotationError}
          </p>
        )}
        {policy && (
          <div className="feature-grid">
            <label>
              <input
                type="checkbox"
                checked={policy.autoRotate}
                onChange={(event) => setPolicy({ ...policy, autoRotate: event.target.checked })}
              />{' '}
              自动轮换
            </label>
            <label>
              到期前轮换（天）
              <input
                type="number"
                min={1}
                max={90}
                value={policy.renewBeforeDays}
                onChange={(event) =>
                  setPolicy({ ...policy, renewBeforeDays: Number(event.target.value) })
                }
              />
            </label>
          </div>
        )}
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={action.busy || !policy}
            onClick={() =>
              void action.run(async (signal) => {
                await request('/ingress-certificate', 'POST', { action: 'configure', policy }, signal);
                certificates.reload();
              }, '轮换策略已保存')
            }
          >
            保存证书策略
          </button>
          <button
            className="secondary compact"
            disabled={action.busy}
            onClick={() =>
              void action.run(async (signal) => {
                await request('/ingress-certificate', 'POST', { action: 'rotate' }, signal);
                certificates.reload();
              }, '证书已轮换，新的 TLS 连接开始使用新证书')
            }
          >
            立即轮换
          </button>
          {certificates.data?.certificate && (
            <button
              className="secondary compact"
              onClick={() => {
                const blob = new Blob([certificates.data!.certificate!.pem], {
                  type: 'application/x-pem-file',
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'sakura-localhost.pem';
                document.body.append(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              下载公钥证书
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
