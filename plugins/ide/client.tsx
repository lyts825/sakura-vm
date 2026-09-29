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
    reason?: 'private-network';
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
              连接当前项目目录。首次配置会向本机 SSH 配置添加 Sakura 的 Include，并保留原配置备份。
            </p>
            <button
              className="secondary compact"
              disabled={action.busy || !ide.data.running}
              onClick={() =>
                void action.run(async () => {
                  const result = await request(`/vms/${vm.id}/ide`, 'POST');
                  setLink(result.url);
                }, 'SSH 连接配置已更新')
              }
            >
              <ExternalLink size={14} />
              配置 VS Code 连接
            </button>
            {link && (
              <a className="primary compact" href={link}>
                打开 VS Code
              </a>
            )}
            <p className="muted">也可以在 PowerShell 中运行：</p>
            <code className="wrap-code">{ide.data.command}</code>
          </>
        ) : (
          <p className="muted">
            {ide.data?.reason === 'private-network'
              ? '实例包含私有项目，不能通过共享网络的 Remote-SSH 运行编辑器；请使用项目终端和文件编辑器。'
              : 'Remote-SSH 接入支持 Debian 与 Ubuntu。Alpine 可继续使用网页终端和文件编辑器。'}
          </p>
        )}
      </div>
      <Feedback error={action.error || ide.error} message={action.message} />
    </>
  );
}
