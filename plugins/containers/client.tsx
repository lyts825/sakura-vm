import { Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { JobView } from '../../server/jobs';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';

export type DockerItem = Record<string, string>;
type TemplateInfo = {
  id: string; version: string; name: string; description: string; documentationURL: string;
  reference: string; sourceMatched: boolean; projectId: string;
  imageVariant?: { default: string; choices: string[] };
  optionalPaths: string[]; files: string[];
};

export function ContainersPanel({ vm, request, projectId }: FeatureProps) {
  const remote = useRemote<{
      supported: boolean;
      installed: boolean;
      available?: boolean;
      privateNetwork?: boolean;
      runtime?: {present:boolean;running:boolean;valid:boolean;reason:string|null};
      error?: string;
      version?: string;
      compose?: string;
      containers: DockerItem[];
      images: DockerItem[];
      volumes: DockerItem[];
      files: string[];
      devcontainer?: { cliInstalled: boolean; version?: string; files: string[]; error?: string };
      templates?: { id: string; name: string; description: string }[];
      job: JobView | null;
    }>(request, `/vms/${vm.id}/containers`, vm.status === 'running', 8000),
    action = useAction();
  const [image, setImage] = useState(''),
    [file, setFile] = useState('compose.yaml'),
    [dockerfile, setDockerfile] = useState('Dockerfile'),
    [templateId, setTemplateId] = useState('javascript-node'),
    [templateInfo, setTemplateInfo] = useState<TemplateInfo | null>(null),
    [templateVariant, setTemplateVariant] = useState(''),
    [templateOmit, setTemplateOmit] = useState<string[]>([]),
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
  const inspectTemplate = () => action.run(async (signal) => {
    const info = await request<Omit<TemplateInfo, 'projectId'>>(
      `/vms/${vm.id}/containers?template=${encodeURIComponent(templateId)}`, 'GET', undefined, signal);
    setTemplateInfo({ ...info, projectId: projectId || 'default' });
    setTemplateVariant(info.imageVariant?.default || '');
    setTemplateOmit(info.optionalPaths);
  });
  const busy = action.busy || remote.data?.job?.status === 'running';
  const selectedTemplate = templateInfo?.id === templateId &&
    templateInfo.projectId === (projectId || 'default') ? templateInfo : null;
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>Docker / Compose</h3>
          <p>{remote.data?.privateNetwork ? '管理所选项目的私有容器和镜像。' : '管理此实例内的容器、镜像和项目。'}</p>
        </div>
        <button className="icon-button" aria-label="刷新容器" onClick={remote.reload}>
          <RefreshCw size={16} />
        </button>
      </div>
      <Feedback error={action.error || remote.error || output.error || remote.data?.error || remote.data?.devcontainer?.error} />
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
                      onClick={() => void run({ action: remote.data?.privateNetwork && remote.data.installed ? 'start-project-runtime' : 'install' })}
                    >
                      {remote.data.privateNetwork && remote.data.installed ? '启动项目 Docker 环境' : '安装并启动 Docker / Compose'}
                    </button>
                  )}
                  {remote.data.privateNetwork && remote.data.runtime?.running && (
                    <button className="text-button" disabled={busy} onClick={() => {
                      if (confirm('停止此项目的所有容器和 Docker 环境？容器记录与数据卷会保留。'))
                        void run({action:'stop-project-runtime'});
                    }}>停止项目 Docker 环境</button>
                  )}
                  {remote.data.privateNetwork && (
                    <p className="subtle-note">容器使用本项目回环网络。Compose 服务需设置 network_mode: host，并使用应用自身的端口；镜像先通过下方入口预取。</p>
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
                        <h4>Dev Container</h4>
                        <p className="subtle-note">
                          {remote.data.devcontainer?.cliInstalled
                            ? `Dev Container CLI ${remote.data.devcontainer.version}`
                            : 'devcontainer.json 需要先安装 Dev Container CLI。'}
                        </p>
                        {!remote.data.devcontainer?.cliInstalled &&
                          <button className="secondary compact" disabled={busy}
                            onClick={() => void run({ action: 'install-devcontainer-cli' })}>
                            安装 Dev Container CLI
                          </button>}
                        {(remote.data.devcontainer?.files.some((path) => path.endsWith('devcontainer.json')))
                          ? <div className="feature-actions">
                              <button className="primary compact"
                                disabled={busy || !remote.data.devcontainer?.cliInstalled}
                                onClick={() => void run({ action: 'devcontainer-up' })}>
                                按 devcontainer.json 创建或启动
                              </button>
                            </div>
                          : <p className="muted">当前项目没有 devcontainer.json。</p>}
                        <label>
                          项目内的 Dockerfile
                          <input value={dockerfile} onChange={(event) => setDockerfile(event.target.value)} />
                        </label>
                        <button className="secondary compact" disabled={busy || !dockerfile.trim()}
                          onClick={() => void run({ action: 'dockerfile-up', file: dockerfile.trim() })}>
                          从 Dockerfile 构建并启动
                        </button>
                        <p className="subtle-note">Dockerfile 模式将项目挂载到容器的 /workspace；已有容器直接启动，需更新镜像时先移除旧容器。</p>
                      </div>
                      <div className="feature-card">
                        <h4>官方 Dev Container 模板</h4>
                        <p className="subtle-note">从官方 OCI 目录读取元数据，核对发布者与模板身份后应用到空项目目录。</p>
                        <label>
                          模板
                          <select value={templateId} onChange={(event) => {
                            setTemplateId(event.target.value);
                            setTemplateInfo(null);
                          }}>
                            {(remote.data.templates || []).map((template) =>
                              <option value={template.id} key={template.id}>{template.name} · {template.description}</option>)}
                          </select>
                        </label>
                        <button className="secondary compact" disabled={busy || !remote.data.devcontainer?.cliInstalled}
                          onClick={() => void inspectTemplate()}>校验模板来源</button>
                        {!remote.data.devcontainer?.cliInstalled &&
                          <p className="muted">请先安装上方的 Dev Container CLI。</p>}
                        {selectedTemplate && <>
                          <p>{selectedTemplate.name} · {selectedTemplate.version}</p>
                          <p className="subtle-note">{selectedTemplate.description}</p>
                          <p className="subtle-note">来源匹配：{selectedTemplate.reference}</p>
                          <a href={selectedTemplate.documentationURL} target="_blank" rel="noreferrer">查看官方模板说明</a>
                          <p className="subtle-note">模板包含：{selectedTemplate.files.join('、')}</p>
                          {selectedTemplate.imageVariant && <label>
                            镜像版本
                            <select value={templateVariant} onChange={(event) => setTemplateVariant(event.target.value)}>
                              {selectedTemplate.imageVariant.choices.map((choice) =>
                                <option value={choice} key={choice}>{choice}</option>)}
                            </select>
                          </label>}
                          {selectedTemplate.optionalPaths.map((path) => <label key={path}>
                            <input type="checkbox" checked={!templateOmit.includes(path)}
                              onChange={(event) => setTemplateOmit((current) =>
                                event.target.checked ? current.filter((item) => item !== path) : [...current, path])} />
                            包含可选文件 {path}
                          </label>)}
                          {(remote.data.devcontainer?.files.length || 0) > 0 &&
                            <p className="subtle-note">当前项目已有 Dev Container 或 Dockerfile 文件；请切换到空项目目录再应用模板。</p>}
                          <button className="primary compact"
                            disabled={busy || !!remote.data.devcontainer?.files.length}
                            onClick={() => void run({ action: 'template-apply', templateId,
                              version: selectedTemplate.version,
                              ...(templateVariant ? { imageVariant: templateVariant } : {}),
                              omitPaths: templateOmit })}>应用模板到空项目</button>
                        </>}
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
