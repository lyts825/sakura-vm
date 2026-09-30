import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

export function IdeConnection({ vm, request }: FeatureProps) {
  const ide = useRemote<{
    supported: boolean;
    running: boolean;
    alias: string;
    command: string;
    url: string;
    networkIsolation?: 'host' | 'private';
    projectScoped?: boolean;
    sshCommand?: string;
    runtime?: { present: boolean; running: boolean; valid: boolean; reason: string | null };
  }>(request, `/vms/${vm.id}/ide`);
  const [link, setLink] = useState('');
  const action = useAction();
  return (
    <>
      <div className="feature-card">
        <h4>在 VS Code 中开发</h4>
        {ide.data?.supported ? (
          <>
            <p className="subtle-note">
              {ide.data.projectScoped
                ? '使用此项目专属的 SSH 服务，编辑器与子进程遵守项目网络设置。停止项目 SSH 会关闭其编辑器和后台进程。'
                : '连接当前项目目录。首次配置会向本机 SSH 配置添加 Sakura 的 Include，并保留原配置备份。'}
            </p>
            {ide.data.networkIsolation === 'private' && (
              <p className="subtle-note">
                首次连接请在 VS Code 用户设置中使用
                <code>"remote.SSH.localServerDownload": "always"</code>， 并关闭 Remote Server Listen On
                Socket。扩展和项目依赖也需提前准备。
              </p>
            )}
            <button
              className="secondary compact"
              disabled={action.busy || !ide.data.running}
              onClick={() =>
                void action.run(async (signal) => {
                  const result = await request(`/vms/${vm.id}/ide`, 'POST', undefined, signal);
                  setLink(result.url);
                  await ide.reload();
                }, 'SSH 连接配置已更新')
              }
            >
              <ExternalLink size={14} />
              配置 VS Code 连接
            </button>
            {ide.data.projectScoped && ide.data.runtime?.running && (
              <button
                className="text-button"
                disabled={action.busy || !ide.data.running}
                onClick={() => {
                  if (confirm('停止此项目的 SSH、编辑器及其后台进程？'))
                    void action.run(async (signal) => {
                      await request(`/vms/${vm.id}/ide`, 'POST', { action: 'stop' }, signal);
                      setLink('');
                      await ide.reload();
                    }, '项目 SSH 已停止');
                }}
              >
                停止项目 SSH
              </button>
            )}
            {ide.data.runtime?.reason && <p className="subtle-note">{ide.data.runtime.reason}</p>}
            {(ide.data.projectScoped ? ide.data.url : link) && (
              <a className="primary compact" href={ide.data.projectScoped ? ide.data.url : link}>
                打开 VS Code
              </a>
            )}
            <p className="muted">也可以在 PowerShell 中运行：</p>
            <code className="wrap-code">{ide.data.command}</code>
            {ide.data.sshCommand && <code className="wrap-code">{ide.data.sshCommand}</code>}
          </>
        ) : (
          <p className="muted">
            Remote-SSH 接入支持 Debian 与 Ubuntu。Alpine 可继续使用网页终端和文件编辑器。
          </p>
        )}
      </div>
      <Feedback error={action.error || ide.error} message={action.message} />
    </>
  );
}
