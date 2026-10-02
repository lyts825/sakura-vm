import { useEffect, useState } from 'react';
import { defaultClipboardRule, type ClipboardRule } from '../shared/clipboard-policy';
import type { X11ClipboardApplication, X11ClipboardView } from '../shared/x11-clipboard';
import { Feedback, JobLog, useAction, useRemote, type Request } from './feature-shared';

export function X11ClipboardSettings({
  vmId,
  desktopReady,
  request,
  transport = 'x11',
}: {
  vmId: string;
  desktopReady: boolean;
  request: Request;
  transport?: 'x11' | 'wayland';
}) {
  const path = `/vms/${vmId}/${transport}-clipboard`;
  const wayland = transport === 'wayland';
  const label = wayland ? '原生 Wayland' : 'Linux X11';
  const remote = useRemote<X11ClipboardView>(request, path, true, 5000),
    action = useAction();
  const [version, setVersion] = useState(0),
    [image, setImage] = useState('/usr/bin/konsole');
  const [applications, setApplications] = useState<X11ClipboardApplication[]>([]);
  const [args, setArgs] = useState('');
  useEffect(() => {
    if (remote.data && remote.data.version > version) {
      setVersion(remote.data.version);
      setApplications(remote.data.applications);
    }
  }, [remote.data, version]);
  const post = (input: object, message = '') =>
    void action.run(async (signal) => {
      try {
        await request(path, 'POST', input, signal);
      } finally {
        remote.reload();
      }
    }, message);
  const save = (input: object) =>
    void action.run(async (signal) => {
      try {
        const value = await request<X11ClipboardView>(path, 'POST', { ...input, version }, signal);
        setVersion(value.version);
        setApplications(value.applications);
        if (value.error) throw new Error('配置已保存，但部分应用尚未应用：' + value.error);
      } finally {
        remote.reload();
      }
    }, 'Linux 应用规则已保存；请查看各应用的状态');
  const update = (image: string, rule: ClipboardRule) =>
    setApplications(applications.map((app) => (app.image === image ? { ...app, rule } : app)));
  const installing = remote.data?.installation?.status === 'running';
  return (
    <section className="system-card native-settings x11-clipboard" aria-label={`${label} 应用剪贴板策略`}>
      <h3>{label} 应用剪贴板策略</h3>
      <p>
        绑定完整应用路径后，通过此处启动到当前 KDE
        桌面。应用及其子进程使用当前项目的目录和网络空间，运行中可收紧复制、粘贴及内容限制。
      </p>
      <p className="subtle-note">
        {wayland
          ? '需要原生 Wayland 桌面会话。各应用使用独立用户及会话总线，剪贴板数据收齐并检查后才交给接收方；不接管已运行的应用。未知扩展和特权剪贴板管理接口不可用，门户文件令牌拒绝传输。规则收紧会取消尚未交付的数据，已交付的内容无法撤回。'
          : '代理覆盖成功加载的 64 位动态应用的 Xlib 与 XCB 调用，支持完整检查 INCR 与 MULTIPLE。现有应用、静态程序和直接发送底层协议的程序仍未覆盖；原生 Wayland 请使用对应入口。停用规则会放宽进程当前限制，完全卸载代理需退出应用。'}
      </p>
      <Feedback error={action.error || remote.error} message={action.message} />
      {remote.data?.error && <p role="alert">{remote.data.error}</p>}
      <div className="button-row">
        <button
          className="secondary compact"
          disabled={action.busy || installing}
          onClick={() => post({ action: 'install' }, `正在安装 ${label} 剪贴板代理`)}
        >
          {remote.data?.ready ? '重建原生代理' : '安装原生代理'}
        </button>
        <button
          className="secondary compact"
          disabled={action.busy || installing}
          onClick={() => post({ action: 'refresh' })}
        >
          刷新并应用已保存规则
        </button>
      </div>
      {remote.data?.installation && <JobLog job={remote.data.installation} />}
      {!desktopReady && <p className="subtle-note">启动应用前，请先启动并绑定当前项目的 KDE 桌面。</p>}
      <fieldset disabled={action.busy}>
        <label>
          Linux 应用完整路径
          <input
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder="/usr/bin/konsole"
          />
        </label>
        <button
          className="secondary compact"
          disabled={!image || !version}
          onClick={() =>
            void action.run(async (signal) => {
              const value = await request<{ image: string; sha256: string }>(
                path,
                'POST',
                { action: 'identify', image },
                signal,
              );
              setImage(value.image);
              setApplications((current) =>
                current.some((app) => app.image === value.image)
                  ? current.map((app) => (app.image === value.image ? { ...app, sha256: value.sha256 } : app))
                  : [...current, { ...value, rule: defaultClipboardRule() }],
              );
            }, '应用路径与文件摘要已读取；请保存规则')
          }
        >
          读取应用身份
        </button>
        <label>
          启动参数（每行一个，可留空）
          <textarea rows={3} value={args} onChange={(event) => setArgs(event.target.value)} />
        </label>
        {applications.map((app) => (
          <article key={app.image} className="x11-clipboard-application">
            <h4>{app.image}</h4>
            <p className="subtle-note">文件摘要：{app.sha256.slice(0, 16)}</p>
            <div className="x11-clipboard-flags">
              {(
                [
                  ['copy', '允许复制'],
                  ['paste', '允许粘贴'],
                  ['files', '允许文件与其他格式'],
                  ['sensitive', '检测敏感文本'],
                ] as const
              ).map(([key, label]) => (
                <label className="checkbox-label" key={key}>
                  <input
                    type="checkbox"
                    checked={app.rule[key]}
                    onChange={(event) => update(app.image, { ...app.rule, [key]: event.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label>
              文本上限（字节）
              <input
                type="number"
                min={1024}
                max={1048576}
                value={app.rule.maxTextBytes}
                onChange={(event) =>
                  update(app.image, { ...app.rule, maxTextBytes: Number(event.target.value) })
                }
              />
            </label>
            <div className="button-row">
              <button
                className="secondary compact"
                onClick={() => save({ action: 'save', application: app })}
              >
                保存此应用规则
              </button>
              <button
                className="secondary compact"
                disabled={
                  !remote.data?.ready ||
                  !desktopReady ||
                  !remote.data.applications.some(
                    (saved) =>
                      saved.image === app.image &&
                      saved.sha256 === app.sha256 &&
                      JSON.stringify(saved.rule) === JSON.stringify(app.rule),
                  )
                }
                onClick={() =>
                  post(
                    {
                      action: 'launch',
                      version,
                      image: app.image,
                      args: args.split(/\r?\n/).filter((value) => value.length > 0),
                    },
                    '应用已在 KDE 桌面中启动',
                  )
                }
              >
                按已保存规则启动
              </button>
              <button
                className="secondary compact"
                onClick={() => save({ action: 'remove', image: app.image })}
              >
                移除并停用此应用规则
              </button>
            </div>
          </article>
        ))}
      </fieldset>
      <p className="subtle-note">
        关闭面板或 Sakura 控制服务会保留进程当前规则。应用使用独立 D-Bus
        会话，避免转交给未受控的既有进程；统计仅包含拒绝次数，不记录剪贴板文本或应用输出。
      </p>
      <div className="x11-clipboard-sessions" aria-label="Linux 受控应用">
        {remote.data?.sessions.map((session) => (
          <article key={session.id}>
            <h4>{session.image || session.id}</h4>
            <p>
              {session.state === 'running' ? '运行中' : session.state === 'stopped' ? '已停止' : '需要处理'} ·{' '}
              {session.active ? '规则已启用' : '规则已停用'} · 项目 {session.projectId || '未知'}
            </p>
            <p className="subtle-note">
              拒绝复制 {session.blockedCopy || 0} 次 · 拒绝粘贴 {session.blockedPaste || 0} 次
            </p>
            {session.desktopOwner && session.applicationOwner && (
              <p className="subtle-note">
                桌面账号 UID {session.desktopOwner.uid} ·{' '}
                {session.applicationOwner.kind === 'window-sandbox'
                  ? <>应用独立账号 UID {session.applicationOwner.uid}</>
                  : '应用沿用桌面项目账号'}
              </p>
            )}
            {session.processes?.map((process) => (
              <p className="subtle-note" key={`${process.pid}:${process.created}`}>
                PID {process.pid} · {process.loaded ? '已接入策略' : '尚未连接策略'} · {process.image}
              </p>
            ))}
            {session.compatible === false && <p role="alert">代理版本已更新，请停止并重新启动此应用。</p>}
            {session.error && <p role="alert">{session.error}</p>}
            <div className="button-row">
              <button
                className="secondary compact"
                title="强制结束本会话的应用及子进程；请先保存内容"
                disabled={action.busy || session.state === 'stopped'}
                onClick={() => post({ action: 'stop', id: session.id })}
              >
                停止应用及子进程
              </button>
              <button
                className="secondary compact"
                disabled={action.busy || session.state !== 'stopped'}
                onClick={() => post({ action: 'forget', id: session.id })}
              >
                清理已停止记录
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
