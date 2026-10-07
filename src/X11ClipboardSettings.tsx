/**
 * 模块职责（中文）：配置原生 X11/Wayland 剪贴板桥接，查看会话与应用策略及安装状态。
 * Module responsibility (English): Configuring native Linux clipboard sessions, application policies and installation.
 * 详细范围（中文）：公开入口包括 X11ClipboardSettings；职责覆盖配置 Linux 原生剪贴板会话、应用策略与安装，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include X11ClipboardSettings. The scope covers Configuring native Linux clipboard sessions, application policies and installation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useState } from 'react';
import { defaultClipboardRule, type ClipboardRule } from '../shared/clipboard-policy';
import type { X11ClipboardApplication, X11ClipboardView } from '../shared/x11-clipboard';
import { Feedback, JobLog, useAction, useRemote, type Request } from './feature-shared';

/**
 * 中文：呈现配置 Linux 原生剪贴板会话、应用策略与安装中的 X11ClipboardSettings 界面，订阅 path，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the X11ClipboardSettings surface for Configuring native Linux clipboard sessions, application policies and installation, subscribing to path. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  vmId,
  desktopReady,
  request,
  transport = 'x11',
} 提供 vmId（当前实例标识）、desktopReady（desktopReady 状态）、request（带身份和权限作用域的传输能力）、transport（transport 状态） 上下文字段
 * English: Inputs: {
  vmId,
  desktopReady,
  request,
  transport = 'x11',
} provides context fields vmId (current VM identifier), desktopReady (desktopReady state), request (transport capability bound to identity/authority scope), transport (transport state)
 */
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
  useEffect(/** 中文：当依赖 [remote.data, version] 变化时version 状态，applications 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data, version] change, version state, applications state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (remote.data && remote.data.version > version) {
      setVersion(remote.data.version);
      setApplications(remote.data.applications);
    }
  }, [remote.data, version]);
  /**
   * 中文：提交 POST path，完成配置 Linux 原生剪贴板会话、应用策略与安装的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for Configuring native Linux clipboard sessions, application policies and installation. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：input：尚待校验的输入数据；message：此处理器的调用值（缺省 ''）
   * English: Inputs: input: input data requiring validation; message: the invocation value for this handler (default '')
   */
  const post = (input: object, message = '') =>
    void action.run(/** 中文：提交 POST path，完成配置 Linux 原生剪贴板会话、应用策略与安装的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for Configuring native Linux clipboard sessions, application policies and installation. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
      try {
        await request(path, 'POST', input, signal);
      } finally {
        remote.reload();
      }
    }, message);
  /**
   * 中文：提交 POST path，完成配置 Linux 原生剪贴板会话、应用策略与安装的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for Configuring native Linux clipboard sessions, application policies and installation. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：input：尚待校验的输入数据
   * English: Inputs: input: input data requiring validation
   */
  const save = (input: object) =>
    void action.run(/** 中文：提交 POST path，完成配置 Linux 原生剪贴板会话、应用策略与安装的数据交互并更新version 状态、applications 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for Configuring native Linux clipboard sessions, application policies and installation and update version state, applications state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
      try {
        const value = await request<X11ClipboardView>(path, 'POST', { ...input, version }, signal);
        setVersion(value.version);
        setApplications(value.applications);
        if (value.error) throw new Error('配置已保存，但部分应用尚未应用：' + value.error);
      } finally {
        remote.reload();
      }
    }, 'Linux 应用规则已保存；请查看各应用的状态');
  /**
   * 中文：在配置 Linux 原生剪贴板会话、应用策略与安装流程中applications 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Configuring native Linux clipboard sessions, application policies and installation, applications state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：image：签名所示 string 业务值；rule：签名所示 ClipboardRule 业务值
   * English: Inputs: image: the string domain value in the signature; rule: the ClipboardRule domain value in the signature
   */
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
            void action.run(/** 中文：提交 POST path，完成配置 Linux 原生剪贴板会话、应用策略与安装的数据交互并更新image 状态、applications 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for Configuring native Linux clipboard sessions, application policies and installation and update image state, applications state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
