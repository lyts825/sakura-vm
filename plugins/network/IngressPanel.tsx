/**
 * 模块职责（中文）：编辑 HTTP 入口规则和证书策略，展示入口健康检查与证书轮换状态。
 * Module responsibility (English): UI interaction and state presentation for ports, network profiles, ingress and certificates.
 * 详细范围（中文）：公开入口包括 IngressPanel；职责覆盖端口、网络档案、入口与证书的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include IngressPanel. The scope covers UI interaction and state presentation for ports, network profiles, ingress and certificates. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from '../../src/localization';
import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { IngressInput, IngressView } from '../../shared/http-ingress.ts';
import type { CertificatePolicy, CertificateView } from '../../shared/ingress-certificates.ts';
import type { LocalAliasView } from '../../shared/local-aliases.ts';
import { Feedback, useAction, useRemote, type FeatureProps } from '../../src/feature-shared.tsx';

/**
 * 中文：把 ISO 时间按浏览器时区换算为 datetime-local 输入格式，缺省返回空串。
 * English: Convert ISO time into datetime-local input format using the browser zone, returning an empty string when absent.
 * 中文：输入：iso：签名所示 string 业务值
 * English: Inputs: iso: the string domain value in the signature
 */
function localDateTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * 中文：为端口、网络档案、入口与证书的界面交互与状态呈现构造包含 name、protocol、domainAlias、listenPort、pathPrefix、vmId、upstreamPort、healthPath、stripPrefix、clientAuth 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用
 * English: Build a local data object containing name, protocol, domainAlias, listenPort, pathPrefix, vmId, upstreamPort, healthPath, stripPrefix, clientAuth for UI interaction and state presentation for ports, network profiles, ingress and certificates, using current inputs/explicit defaults for subsequent form/state processing
 * 中文：输入：vmId：当前实例标识；upstreamPort：签名所示 number 业务值
 * English: Inputs: vmId: current VM identifier; upstreamPort: the number domain value in the signature
 * 中文：结果：包含 name、protocol、domainAlias、listenPort、pathPrefix、vmId、upstreamPort、healthPath、stripPrefix、clientAuth 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing name, protocol, domainAlias, listenPort, pathPrefix, vmId, upstreamPort, healthPath, stripPrefix, clientAuth for caller state reads/operations
 */
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

/**
 * 中文：呈现端口、网络档案、入口与证书的界面交互与状态呈现中的 IngressPanel 界面，订阅 /ingress、/ingress-certificate、/local-aliases，组合 Plus、Save，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the IngressPanel surface for UI interaction and state presentation for ports, network profiles, ingress and certificates, subscribing to /ingress, /ingress-certificate, /local-aliases and composing Plus, Save. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function IngressPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<IngressView>(request, '/ingress');
  const certificates = useRemote<CertificateView>(request, '/ingress-certificate');
  const aliases = useRemote<LocalAliasView>(request, '/local-aliases');
  const action = useAction();
  const [form, setForm] = useState<IngressInput>(() => blank(vm.id, vm.forwards[0]?.host || 8080));
  const [policy, setPolicy] = useState<CertificatePolicy | null>(null);
  useEffect(/** 中文：当依赖 [policy, certificates.data] 变化时策略草稿；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [policy, certificates.data] change, policy draft. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!policy && certificates.data?.policy) setPolicy(certificates.data.policy);
  }, [policy, certificates.data]);
  const entries = remote.data?.entries.filter((entry) => entry.vmId === vm.id) || [];
  /**
   * 中文：在端口、网络档案、入口与证书的界面交互与状态呈现流程中表单草稿；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for ports, network profiles, ingress and certificates, form draft. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   */
  const change = (value: Partial<IngressInput>) => setForm((current) => ({ ...current, ...value }));
  /**
   * 中文：在端口、网络档案、入口与证书的界面交互与状态呈现流程中触发所属资源重新读取；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for ports, network profiles, ingress and certificates, trigger rereading of the owned resource. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   */
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
                {entry.clientAuth.rotateAt && ` · ${Date.now() >= Date.parse(entry.clientAuth.rotateAt) ? '已于' : '将于'} ${formatDateTime(new Date(entry.clientAuth.rotateAt))} 切换至替换证书`}
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
                  void action.run(/** 中文：提交 POST /ingress，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /ingress for UI interaction and state presentation for ports, network profiles, ingress and certificates. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
                  void action.run(/** 中文：提交 POST /ingress，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互并更新表单草稿；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /ingress for UI interaction and state presentation for ports, network profiles, ingress and certificates and update form draft. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
              void action.run(/** 中文：提交 POST /ingress，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互并更新表单草稿；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /ingress for UI interaction and state presentation for ports, network profiles, ingress and certificates and update form draft. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
            onClick={() => void action.run(/** 中文：提交 POST /local-aliases，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /local-aliases for UI interaction and state presentation for ports, network profiles, ingress and certificates. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
              try { await request('/local-aliases', 'POST',
                { action: 'set-enabled', enabled: !aliases.data?.enabled }, signal); }
              finally { aliases.reload(); }
            }, aliases.data?.enabled ? '系统别名已关闭' : '系统别名已启用')}>
            {aliases.data?.enabled ? '关闭系统解析' : '启用系统解析'}
          </button>
          <button className="secondary compact" disabled={action.busy || !aliases.data?.supported}
            onClick={() => void action.run(/** 中文：提交 POST /local-aliases，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /local-aliases for UI interaction and state presentation for ports, network profiles, ingress and certificates. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
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
            有效期至 {formatDateTime(new Date(certificates.data.certificate.validTo))}
            {certificates.data.nextRotationAt &&
              ` · 下次轮换 ${formatDateTime(new Date(certificates.data.nextRotationAt))}`}
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
              void action.run(/** 中文：提交 POST /ingress-certificate，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /ingress-certificate for UI interaction and state presentation for ports, network profiles, ingress and certificates. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
              void action.run(/** 中文：提交 POST /ingress-certificate，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /ingress-certificate for UI interaction and state presentation for ports, network profiles, ingress and certificates. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
              onClick={/** 中文：在端口、网络档案、入口与证书的界面交互与状态呈现流程中timeout 状态，创建二进制内容临时 URL；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for ports, network profiles, ingress and certificates, timeout state, create temporary binary-content URLs. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
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
