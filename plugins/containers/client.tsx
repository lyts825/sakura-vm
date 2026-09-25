import { Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { JobView } from '../../server/jobs';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';

export type DockerItem = Record<string, string>;

export function ContainersPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
      supported: boolean;
      installed: boolean;
      available?: boolean;
      error?: string;
      version?: string;
      compose?: string;
      containers: DockerItem[];
      images: DockerItem[];
      volumes: DockerItem[];
      files: string[];
      job: JobView | null;
    }>(request, `/vms/${vm.id}/containers`, vm.status === 'running', 8000),
    action = useAction();
  const [image, setImage] = useState(''),
    [file, setFile] = useState('compose.yaml'),
    [logs, setLogs] = useState('');
  const output = useRemote<{ log: string }>(
    request,
    `/vms/${vm.id}/containers?logs=${encodeURIComponent(logs)}`,
    !!logs && vm.status === 'running',
  );
  const run = (value: unknown) =>
    action.run(async (signal) => {
      await request(`/vms/${vm.id}/containers`, 'POST', value, signal);
      remote.reload();
      output.reload();
    });
  const busy = action.busy || remote.data?.job?.status === 'running';
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>Docker / Compose</h3>
          <p>管理此实例内的容器、镜像和项目。</p>
        </div>
        <button className="icon-button" aria-label="刷新容器" onClick={remote.reload}>
          <RefreshCw size={16} />
        </button>
      </div>
      <Feedback error={action.error || remote.error || output.error || remote.data?.error} />
      {vm.status !== 'running'
        ? stopped
        : remote.data && (
            <>
              {!remote.data.supported ? (
                <p className="subtle-note">容器面板支持 Debian 和 Ubuntu 实例。</p>
              ) : (
                <>
                  {!remote.data.available && (
                    <button
                      className="primary compact"
                      disabled={busy}
                      onClick={() => void run({ action: 'install' })}
                    >
                      安装并启动 Docker / Compose
                    </button>
                  )}
                  {remote.data.available && (
                    <>
                      <p className="subtle-note">
                        Docker {remote.data.version} · {remote.data.compose || 'Compose 未安装'}
                      </p>
                      <h4>容器</h4>
                      {!remote.data.containers.length && (
                        <p className="muted">暂无容器，可通过 Compose 创建。</p>
                      )}
                      {remote.data.containers.map((container) => (
                        <div className="feature-card" key={container.ID}>
                          <h4>{container.Names || container.ID}</h4>
                          <p>
                            {container.Image} · {container.Status}
                          </p>
                          <p className="subtle-note">{container.Ports}</p>
                          <div className="feature-actions">
                            {[
                              ['start', '启动'],
                              ['stop', '停止'],
                              ['restart', '重启'],
                              ['remove', '删除'],
                            ].map(([kind, label]) => (
                              <button
                                key={kind}
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    kind !== 'remove' ||
                                    confirm(`删除容器 ${container.Names}？容器内未持久化的数据会丢失。`)
                                  )
                                    void run({ action: kind, id: container.ID });
                                }}
                              >
                                {label}
                              </button>
                            ))}
                            <button className="text-button" onClick={() => setLogs(container.ID)}>
                              日志
                            </button>
                          </div>
                        </div>
                      ))}
                      {logs && (
                        <div className="feature-card">
                          <div className="panel-heading">
                            <h4>容器日志</h4>
                            <button className="text-button" onClick={() => setLogs('')}>
                              关闭
                            </button>
                          </div>
                          <pre className="feature-log">{output.data?.log || '暂无日志'}</pre>
                        </div>
                      )}
                      <div className="feature-card">
                        <h4>Compose 项目</h4>
                        <label>
                          项目内的 Compose 文件
                          <input
                            value={file}
                            onChange={(e) => setFile(e.target.value)}
                            list="compose-files"
                          />
                          <datalist id="compose-files">
                            {remote.data.files.map((name) => (
                              <option value={name} key={name} />
                            ))}
                          </datalist>
                        </label>
                        <div className="feature-actions">
                          {[
                            ['compose-up', '启动项目'],
                            ['compose-down', '停止并移除容器'],
                            ['compose-restart', '重启项目'],
                          ].map(([kind, label]) => (
                            <button
                              key={kind}
                              className="secondary compact"
                              disabled={busy || !file}
                              onClick={() => {
                                if (
                                  kind !== 'compose-down' ||
                                  confirm('停止此 Compose 项目并移除容器？命名卷会保留。')
                                )
                                  void run({ action: kind, file });
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="feature-card">
                        <h4>镜像</h4>
                        <label>
                          拉取镜像
                          <input
                            value={image}
                            onChange={(e) => setImage(e.target.value)}
                            placeholder="nginx:alpine"
                          />
                        </label>
                        <button
                          className="secondary compact"
                          disabled={busy || !image.trim()}
                          onClick={() => void run({ action: 'pull', image: image.trim() })}
                        >
                          <Download size={14} />
                          拉取
                        </button>
                        {remote.data.images.map((item, index) => (
                          <div className="development-row" key={`${item.ID}-${index}`}>
                            <span>
                              {item.Repository}:{item.Tag} · {item.Size}
                            </span>
                            <button
                              className="text-button danger-text"
                              disabled={busy}
                              onClick={() => {
                                if (confirm(`删除镜像 ${item.Repository}:${item.Tag}？`))
                                  void run({
                                    action: 'remove-image',
                                    image:
                                      item.Repository === '<none>' || item.Tag === '<none>'
                                        ? item.ID
                                        : `${item.Repository}:${item.Tag}`,
                                  });
                              }}
                            >
                              删除镜像
                            </button>
                          </div>
                        ))}
                      </div>
                      <details className="feature-card">
                        <summary>数据卷（{remote.data.volumes.length}）</summary>
                        {remote.data.volumes.map((volume) => (
                          <p key={volume.Name}>
                            {volume.Name} · {volume.Driver}
                          </p>
                        ))}
                      </details>
                    </>
                  )}
                </>
              )}
              <JobLog job={remote.data.job} />
            </>
          )}
    </div>
  );
}

export const tabs = { containers: ContainersPanel };
