/**
 * 模块职责（中文）：“网络管理”插件的端口、代理、网络配置档案与项目服务网络编辑界面，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for ports, network profiles, ingress and certificates.
 * 详细范围（中文）：公开入口包括 ServicesPanel, networkFields, NetworkPanel, tabs, developmentSections；职责覆盖端口、网络档案、入口与证书的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ServicesPanel, networkFields, NetworkPanel, tabs, developmentSections. The scope covers UI interaction and state presentation for ports, network profiles, ingress and certificates. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VMConfig } from '../../shared/contracts/vm.ts';
import type {
  NetworkProfile,
  NetworkPreview,
  NetworkView,
  SavedNetworkProfile,
  ServicesView,
} from './contracts.ts';
import '../../src/development.css';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';
import { IngressPanel } from './IngressPanel';
import { DependencyDownloadsEditor } from './DependencyDownloadsEditor';

/**
 * 中文：呈现端口、网络档案、入口与证书的界面交互与状态呈现中的 ServicesPanel 界面，订阅 /vms/{vm.id}/services，组合 Plus、Save、IngressPanel，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ServicesPanel surface for UI interaction and state presentation for ports, network profiles, ingress and certificates, subscribing to /vms/{vm.id}/services and composing Plus, Save, IngressPanel. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：props：签名所示 FeatureProps 业务值
 * English: Inputs: props: the FeatureProps domain value in the signature
 */
export function ServicesPanel(props: FeatureProps) {
  const { vm, request, refresh } = props;
  const remote = useRemote<ServicesView>(request, `/vms/${vm.id}/services`);
  const [forwards, setForwards] = useState(vm.forwards);
  const forwardsVersion = JSON.stringify(vm.forwards);
  useEffect(/** 中文：当依赖 [vm.id, forwardsVersion] 变化时按指定 Schema 校验并解码，forwards 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vm.id, forwardsVersion] change, validate/decode with the specified schema, forwards state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => setForwards(JSON.parse(forwardsVersion)), [vm.id, forwardsVersion]);
  const action = useAction();
  /**
   * 中文：在端口、网络档案、入口与证书的界面交互与状态呈现流程中forwards 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for ports, network profiles, ingress and certificates, forwards state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：i：签名所示 number 业务值；value：待校验、转换或保存的输入值
   * English: Inputs: i: the number domain value in the signature; value: input value to validate/transform/save
   */
  const patch = (i: number, value: Partial<VMConfig['forwards'][number]>) =>
    setForwards((list) => list.map((v, n) => (n === i ? { ...v, ...value } : v)));
  return (
    <>
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>服务与端口</h3>
          <p>可在运行中更新转发；服务需监听 0.0.0.0 或客户机网卡地址。</p>
        </div>
        <button
          className="secondary compact"
          disabled={forwards.length >= 12}
          onClick={() => setForwards((p) => [...p, { name: '', host: 8080, guest: 80 }])}
        >
          <Plus size={14} />
          添加
        </button>
      </div>
      <Feedback error={action.error || remote.error} message={action.message} />
      {forwards.map((p, i) => (
        <div className="service-row" key={i}>
          <label>
            名称
            <input
              maxLength={40}
              value={p.name || ''}
              placeholder="开发服务器"
              onChange={(e) => patch(i, { name: e.target.value })}
            />
          </label>
          <label>
            Windows 端口
            <input
              type="number"
              min={1024}
              max={65535}
              value={p.host}
              onChange={(e) => patch(i, { host: +e.target.value })}
            />
          </label>
          <label>
            Linux 端口
            <input
              type="number"
              min={1}
              max={65535}
              value={p.guest}
              onChange={(e) => patch(i, { guest: +e.target.value })}
            />
          </label>
          <span className="muted">
            {remote.data?.forwards.find((f) => f.host === p.host && f.guest === p.guest)?.listening
              ? '客户机已监听'
              : '未检测到监听'}
          </span>
          <a
            href={`http://127.0.0.1:${p.host}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开端口 ${p.host}`}
          >
            <ExternalLink size={17} />
          </a>
          <button
            className="icon-button"
            aria-label={`删除端口 ${p.host}`}
            onClick={() => setForwards((list) => list.filter((_, n) => n !== i))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      {!forwards.length && <p className="muted">添加转发，即可从 Windows 浏览器访问 Linux 服务。</p>}
      <button
        className="primary compact"
        disabled={action.busy}
        onClick={() =>
          void action.run(/** 中文：提交 PATCH /vms/{vm.id}/services，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PATCH /vms/{vm.id}/services for UI interaction and state presentation for ports, network profiles, ingress and certificates. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
            await request(`/vms/${vm.id}/services`, 'PATCH', { forwards });
            await refresh();
            remote.reload();
          }, '端口规则已生效')
        }
      >
        <Save size={14} />
        应用端口规则
      </button>
      {!!remote.data?.listening.length && (
        <p className="subtle-note">客户机监听端口：{remote.data.listening.join('、')}</p>
      )}
    </div>
    <IngressPanel key={vm.id} {...props} />
    </>
  );
}

export const networkFields: [Exclude<keyof NetworkProfile, 'dnsServers' | 'dnsDomains' | 'dnssec' | 'forwards' | 'dependencyDownloads'>, string, string][] = [
  ['httpProxy', 'HTTP 代理', 'http://10.0.2.2:7890'],
  ['httpsProxy', 'HTTPS 代理', 'http://10.0.2.2:7890'],
  ['noProxy', '不使用代理的地址', 'localhost,127.0.0.1,::1'],
  ['npmRegistry', 'npm 仓库', 'https://registry.npmjs.org'],
  ['pipIndex', 'Python 包索引', 'https://pypi.org/simple'],
  ['apkMirror', 'Alpine 镜像根地址', 'https://dl-cdn.alpinelinux.org/alpine'],
  ['aptMirror', 'Debian / Ubuntu 软件源', ''],
  ['aptSecurityMirror', '安全更新软件源', ''],
];

/**
 * 中文：呈现端口、网络档案、入口与证书的界面交互与状态呈现中的 NetworkPanel 界面，组合 NetworkEditor，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the NetworkPanel surface for UI interaction and state presentation for ports, network profiles, ingress and certificates and composing NetworkEditor. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：props：签名所示 FeatureProps 业务值
 * English: Inputs: props: the FeatureProps domain value in the signature
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function NetworkPanel(props: FeatureProps) {
  return <NetworkEditor key={props.vm.id} {...props} />;
}

/**
 * 中文：呈现端口、网络档案、入口与证书的界面交互与状态呈现中的 NetworkEditor 界面，订阅 /vms/{vm.id}/network、/network-profiles，组合 DependencyDownloadsEditor，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the NetworkEditor surface for UI interaction and state presentation for ports, network profiles, ingress and certificates, subscribing to /vms/{vm.id}/network, /network-profiles and composing DependencyDownloadsEditor. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request, refresh } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力）、refresh（refresh 状态） 上下文字段
 * English: Inputs: { vm, request, refresh } provides context fields vm (vm state), request (transport capability bound to identity/authority scope), refresh (refresh state)
 */
function NetworkEditor({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<NetworkView>(request, `/vms/${vm.id}/network`),
    action = useAction();
  const profiles = useRemote<SavedNetworkProfile[]>(request, '/network-profiles');
  const [selected, setSelected] = useState(''),
    [profileName, setProfileName] = useState(''),
    [dnsText, setDnsText] = useState(''),
    [domainText, setDomainText] = useState('');
  const [config, setConfig] = useState<NetworkProfile | null>(null),
    [preview, setPreview] = useState<NetworkPreview | null>(null);
  useEffect(/** 中文：当依赖 [config, remote.data, vm.forwards] 变化时config 状态，dnsText 状态，domainText 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [config, remote.data, vm.forwards] change, config state, dnsText state, domainText state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!config && remote.data) {
      setConfig({
        ...remote.data.config,
        dnsDomains: remote.data.config.dnsDomains || [],
        dnssec: remote.data.config.dnssec || 'inherit',
        forwards: remote.data.config.forwards || vm.forwards,
      });
      setDnsText((remote.data.config.dnsServers || []).join(', '));
      setDomainText((remote.data.config.dnsDomains || []).join(', '));
    }
  }, [config, remote.data, vm.forwards]);
  /**
   * 中文：把 DNS 服务器和搜索域文本按逗号/空白拆成数组，合并当前网络草稿其他字段用于提交。
   * English: Split DNS-server/search-domain text by comma/whitespace and merge other network-draft fields for submission.
   */
  const edited = () => ({
    ...config!,
    dnsServers: dnsText.split(/[,\s]+/).filter(Boolean),
    dnsDomains: domainText.split(/[,\s]+/).filter(Boolean),
  });
  /**
   * 中文：提交 POST /vms/{vm.id}/network，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/network for UI interaction and state presentation for ports, network profiles, ingress and certificates. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：kind：签名所示 string 业务值
   * English: Inputs: kind: the string domain value in the signature
   */
  const run = (kind: string) =>
    action.run(/** 中文：提交 POST /vms/{vm.id}/network，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互并更新preview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/network for UI interaction and state presentation for ports, network profiles, ingress and certificates and update preview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
      const value = await request<NonNullable<typeof preview>>(
        `/vms/${vm.id}/network`,
        'POST',
        { action: kind, config: edited(), token: preview?.token },
        signal,
      );
      if (kind === 'preview') setPreview(value);
      else {
        setPreview(null);
        remote.reload();
        await refresh();
      }
    });
  const applied =
      !!remote.data?.appliedAt ||
      !!remote.data?.changes.length ||
      !!remote.data?.forwards ||
      !!remote.data?.dnsBackend ||
      !!remote.data?.resolverLink,
    busy = action.busy || vm.status !== 'running';
  return (
    <>
      <p className="subtle-note">
        预览后应用到此实例。代理和包仓库设置用于新的登录终端及 Sakura 项目任务；已有进程需重新启动。
        连通性测试使用当前实例 DNS 和表单中的代理、镜像设置。
      </p>
      {vm.status !== 'running' && stopped}
      <Feedback error={action.error || remote.error || profiles.error} message={action.message} />
      <div className="feature-card">
        <h4>网络档案</h4>
        <div className="feature-grid">
          <label>
            加载已保存的档案
            <select
              value={selected}
              disabled={applied || action.busy}
              onChange={/**
               * 中文功能：选中已保存的网络配置并同步名称、DNS 文本及域列表；补齐旧记录默认值，同时清空上一份变更预览。
               * English: Select a saved network profile and synchronize its name/DNS/domain text, fill legacy defaults and discard the previous change preview.
               * 输入 / Inputs: event.
               * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
               * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
               */
              (event) => {
                const id = event.target.value,
                  saved = profiles.data?.find((item) => item.id === id);
                setSelected(id);
                setProfileName(saved?.name || '');
                setPreview(null);
                if (saved) {
                  setConfig({
                    ...saved.config,
                    dnsDomains: saved.config.dnsDomains || [],
                    dnssec: saved.config.dnssec || 'inherit',
                  });
                  setDnsText(saved.config.dnsServers.join(', '));
                  setDomainText((saved.config.dnsDomains || []).join(', '));
                }
              }}
            >
              <option value="">新建档案</option>
              {profiles.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            档案名称
            <input
              value={profileName}
              maxLength={60}
              disabled={action.busy}
              onChange={(event) => setProfileName(event.target.value)}
            />
          </label>
        </div>
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={action.busy || !config || !profileName.trim()}
            onClick={() =>
              void action.run(/** 中文：提交 POST /network-profiles，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互并更新当前选择；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /network-profiles for UI interaction and state presentation for ports, network profiles, ingress and certificates and update current selection. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                const saved = await request<SavedNetworkProfile>('/network-profiles', 'POST', {
                  ...(selected ? { id: selected } : {}),
                  name: profileName,
                  config: edited(),
                });
                setSelected(saved.id);
                profiles.reload();
              }, '网络档案已保存，可在其他实例加载')
            }
          >
            保存档案
          </button>
          <button
            className="secondary compact"
            disabled={action.busy || !selected}
            onClick={() =>
              void action.run(/** 中文：提交 DELETE /network-profiles，完成端口、网络档案、入口与证书的界面交互与状态呈现的数据交互并更新当前选择、profileName 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform DELETE /network-profiles for UI interaction and state presentation for ports, network profiles, ingress and certificates and update current selection, profileName state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                await request('/network-profiles', 'DELETE', { id: selected });
                setSelected('');
                setProfileName('');
                profiles.reload();
              }, '档案已删除')
            }
          >
            删除档案
          </button>
        </div>
        <p className="subtle-note">保存与加载只更新档案和表单；预览后应用，才会修改实例网络。</p>
      </div>
      {config && (
        <>
          <div className="feature-grid">
            <label>
              DNS 地址（逗号分隔，留空沿用系统设置）
              <input
                value={dnsText}
                placeholder="10.0.2.3"
                disabled={applied || action.busy}
                onChange={(event) => {
                  setDnsText(event.target.value);
                  setPreview(null);
                }}
              />
            </label>
            <label>
              私有 DNS 路由域名（逗号分隔）
              <input
                value={domainText}
                placeholder="corp.example"
                disabled={applied || action.busy}
                onChange={(event) => {
                  setDomainText(event.target.value);
                  setPreview(null);
                }}
              />
            </label>
            <label>
              DNSSEC 策略
              <select
                value={config.dnssec}
                disabled={applied || action.busy}
                onChange={(event) => {
                  setConfig({ ...config, dnssec: event.target.value as NetworkProfile['dnssec'] });
                  setPreview(null);
                }}
              >
                <option value="inherit">沿用系统设置</option>
                <option value="yes">强制验证</option>
                <option value="allow-downgrade">允许降级</option>
                <option value="no">关闭验证</option>
              </select>
            </label>
            {networkFields
              .filter(([key]) =>
                (vm.distro || 'alpine') === 'alpine' ? !key.startsWith('apt') : key !== 'apkMirror',
              )
              .map(([key, label, placeholder]) => (
                <label key={key}>
                  {label}
                  <input
                    value={config[key]}
                    placeholder={placeholder}
                    disabled={applied || action.busy}
                    onChange={(e) => {
                      setConfig({ ...config, [key]: e.target.value });
                      setPreview(null);
                    }}
                  />
                </label>
              ))}
          </div>
          <p className="subtle-note">
            自定义 DNS 地址支持 Alpine 静态网络和 systemd-resolved；私有域名路由和 DNSSEC 策略需要 systemd-resolved 及指定 DNS 服务器，应用后会核对实际状态。强制 DNSSEC 可能拒绝未签名的私有域名。
          </p>
          <DependencyDownloadsEditor value={config} disabled={applied || action.busy}
            change={dependencyDownloads => { setConfig({ ...config, dependencyDownloads }); setPreview(null); }} />
          <div className="feature-card">
            <label>
              <input
                type="checkbox"
                checked={config.forwards !== undefined}
                disabled={applied || action.busy}
                onChange={(event) => {
                  setConfig({ ...config, forwards: event.target.checked ? vm.forwards : undefined });
                  setPreview(null);
                }}
              />{' '}
              随档案应用 NAT 端口映射
            </label>
            {config.forwards?.map((forward, index) => (
              <div className="service-row" key={index}>
                {(['name', 'host', 'guest'] as const).map((field) => (
                  <label key={field}>
                    {{ name: '名称', host: 'Windows 端口', guest: 'Linux 端口' }[field]}
                    <input
                      type={field === 'name' ? 'text' : 'number'}
                      value={forward[field] || ''}
                      min={field === 'host' ? 1024 : 1}
                      max={65535}
                      maxLength={40}
                      disabled={applied || action.busy}
                      onChange={/**
                       * 中文功能：只更新指定端口转发行的字段，名称保持字符串，其它输入转为数字，并使原变更预览失效。
                       * English: Update only the selected port-forward row, retain names as strings, convert other fields to numbers and invalidate the previous preview.
                       * 输入 / Inputs: event.
                       * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
                       * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
                       */
                      (event) => {
                        setConfig({
                          ...config,
                          forwards: config.forwards!.map((row, n) =>
                            n === index
                              ? {
                                  ...row,
                                  [field]: field === 'name' ? event.target.value : Number(event.target.value),
                                }
                              : row,
                          ),
                        });
                        setPreview(null);
                      }}
                    />
                  </label>
                ))}
                <button
                  className="icon-button"
                  aria-label={`从档案删除端口 ${forward.host}`}
                  disabled={applied || action.busy}
                  onClick={() => {
                    setConfig({ ...config, forwards: config.forwards!.filter((_, n) => n !== index) });
                    setPreview(null);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {config.forwards && (
              <button
                className="secondary compact"
                disabled={applied || action.busy || config.forwards.length >= 12}
                onClick={() => {
                  setConfig({
                    ...config,
                    forwards: [...config.forwards!, { name: '', host: 8080, guest: 80 }],
                  });
                  setPreview(null);
                }}
              >
                添加映射到档案
              </button>
            )}
          </div>
        </>
      )}
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={busy || !config || applied}
          onClick={() => void run('preview')}
        >
          预览修改
        </button>
        <button
          className="secondary compact"
          disabled={busy || !config || remote.data?.job?.status === 'running'}
          onClick={() => void run('test')}
        >
          测试连通性
        </button>
        {applied && (
          <button className="secondary compact" disabled={busy} onClick={() => void run('restore')}>
            恢复原配置
          </button>
        )}
      </div>
      {applied && (
        <p className="feature-success">
          {remote.data?.appliedAt ? '配置已应用' : '应用中断，可恢复原配置后重试'}
        </p>
      )}
      {preview && (
        <div className="feature-card">
          <h4>即将修改 {preview.changes.length} 个文件</h4>
          {preview.forwards && (
            <details open>
              <summary>NAT 端口映射</summary>
              <div className="feature-grid">
                <pre className="feature-log">{JSON.stringify(preview.forwards.before, null, 2)}</pre>
                <pre className="feature-log">{JSON.stringify(preview.forwards.after, null, 2)}</pre>
              </div>
            </details>
          )}
          {preview.resolverLink && (
            <details open>
              <summary>/etc/resolv.conf 解析器链接</summary>
              <div className="feature-grid">
                <pre className="feature-log">{preview.resolverLink.before}</pre>
                <pre className="feature-log">{preview.resolverLink.after}</pre>
              </div>
            </details>
          )}
          {preview.changes.map((change) => (
            <details key={change.path}>
              <summary>{change.path}</summary>
              <div className="feature-grid">
                <pre className="feature-log">{change.before ?? '原文件不存在'}</pre>
                <pre className="feature-log">{change.after}</pre>
              </div>
            </details>
          ))}
          <button className="primary compact" disabled={busy} onClick={() => void run('apply')}>
            应用以上修改
          </button>
        </div>
      )}
      <JobLog job={remote.data?.job} />
    </>
  );
}

export const tabs = { services: ServicesPanel };

export const developmentSections = { network: NetworkPanel };
