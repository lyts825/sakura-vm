import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { IngressInput, IngressView } from '../../shared/http-ingress.ts';
import type { CertificatePolicy, CertificateView } from '../../shared/ingress-certificates.ts';
import { Feedback, useAction, useRemote, type FeatureProps } from '../../src/feature-shared.tsx';

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
  };
}

export function IngressPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<IngressView>(request, '/ingress');
  const certificates = useRemote<CertificateView>(request, '/ingress-certificate');
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
      <Feedback error={action.error || remote.error || certificates.error} message={action.message} />
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
              onChange={(event) => change({ protocol: event.target.value as 'http' | 'https' })}
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
              }, '服务入口已生效')
            }
          >
            <Save size={14} />
            保存入口
          </button>
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
