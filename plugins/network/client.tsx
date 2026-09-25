import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JobView } from '../../server/jobs';
import type { VMConfig } from '../../server/model';
import type { NetworkChange, NetworkProfile } from '../../server/network-profiles';
import '../../src/development.css';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';

export function ServicesPanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<{
    forwards: (VMConfig['forwards'][number] & { listening: boolean })[];
    listening: number[];
  }>(request, `/vms/${vm.id}/services`);
  const [forwards, setForwards] = useState(vm.forwards);
  const action = useAction();
  const patch = (i: number, value: Partial<VMConfig['forwards'][number]>) =>
    setForwards((list) => list.map((v, n) => (n === i ? { ...v, ...value } : v)));
  return (
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
          void action.run(async () => {
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
  );
}

export const networkFields: [keyof NetworkProfile, string, string][] = [
  ['httpProxy', 'HTTP 代理', 'http://10.0.2.2:7890'],
  ['httpsProxy', 'HTTPS 代理', 'http://10.0.2.2:7890'],
  ['noProxy', '不使用代理的地址', 'localhost,127.0.0.1,::1'],
  ['npmRegistry', 'npm 仓库', 'https://registry.npmjs.org'],
  ['pipIndex', 'Python 包索引', 'https://pypi.org/simple'],
  ['apkMirror', 'Alpine 镜像根地址', 'https://dl-cdn.alpinelinux.org/alpine'],
  ['aptMirror', 'Debian / Ubuntu 软件源', ''],
  ['aptSecurityMirror', '安全更新软件源', ''],
];

export function NetworkPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
      config: NetworkProfile;
      changes: NetworkChange[];
      appliedAt?: string;
      job: JobView | null;
    }>(request, `/vms/${vm.id}/network`),
    action = useAction();
  const [config, setConfig] = useState<NetworkProfile | null>(null),
    [preview, setPreview] = useState<{
      config: NetworkProfile;
      changes: NetworkChange[];
      token: string;
    } | null>(null);
  useEffect(() => {
    if (!config && remote.data) setConfig(remote.data.config);
  }, [config, remote.data]);
  const run = (kind: string) =>
    action.run(async (signal) => {
      const value = await request(
        `/vms/${vm.id}/network`,
        'POST',
        { action: kind, config, token: preview?.token },
        signal,
      );
      if (kind === 'preview') setPreview(value);
      else {
        setPreview(null);
        remote.reload();
      }
    });
  const applied = !!remote.data?.appliedAt || !!remote.data?.changes.length,
    busy = action.busy || vm.status !== 'running';
  return (
    <>
      <p className="subtle-note">
        预览后应用到此实例。代理和包仓库设置用于新的登录终端及 Sakura 项目任务；已有进程需重新启动。
      </p>
      {vm.status !== 'running' && stopped}
      <Feedback error={action.error || remote.error} />
      {config && (
        <div className="feature-grid">
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
