import { Download, Layers, Plus, Upload } from 'lucide-react';
import { lazy, useRef, useState } from 'react';
import type { JobView } from '../../server/jobs';
import { Feedback, JobLog, useAction, useRemote, type Request } from '../../src/feature-shared';
import '../../src/features.css';
import type { PluginPageProps } from '../../src/plugin-client';
import { PluginGate } from '../../src/plugin-context';
const GoldenImageLibrary = lazy(() =>
  import('../snapshots/GoldenImages').then((module) => ({ default: module.GoldenImageLibrary })),
);

export type ImageInfo = {
  id: 'alpine' | 'debian' | 'ubuntu';
  name: string;
  ready: boolean;
  minimumMemory: number;
  minimumDisk: number;
  job: JobView | null;
};

export function ImageCatalog({
  request,
  token,
  refresh,
}: {
  request: Request;
  token: string;
  refresh: () => Promise<unknown>;
}) {
  const remote = useRemote<ImageInfo[]>(request, '/images', true, 2500);
  const action = useAction();
  const [name, setName] = useState('imported-linux');
  const [password, setPassword] = useState('');
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="feature-panel">
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="image-catalog">
        {remote.data?.map((img) => (
          <div className="feature-card" key={img.id}>
            <span className="tag">官方云镜像</span>
            <h3>{img.name}</h3>
            <p>x86_64 · 最低 {img.minimumMemory} MiB 内存</p>
            <span className={`badge ${img.ready ? 'running' : ''}`}>
              {img.ready ? '可创建实例' : '尚未下载'}
            </span>
            {!img.ready && (
              <button
                className="secondary compact"
                disabled={action.busy || img.job?.status === 'running'}
                onClick={() =>
                  void action.run(async () => {
                    await request(`/images/${img.id}`, 'POST');
                    remote.reload();
                  })
                }
              >
                <Download size={14} />
                下载并校验
              </button>
            )}
            <JobLog job={img.job} />
          </div>
        ))}
      </div>
      <PluginGate id="snapshots">
        <div className="feature-card">
          <h3>导入 Sakura 实例</h3>
          <p>从 .sakura 或 .sakura.enc 文件恢复到新实例，端口转发默认清空。</p>
          <PluginGate id="backups">
            <label>
              加密备份密码
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                maxLength={1024}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="普通备份可留空"
              />
            </label>
          </PluginGate>
          <div className="inline-form">
            <input
              aria-label="导入实例名称"
              pattern="[a-z][a-z0-9-]*"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="secondary compact"
              disabled={action.busy}
              onClick={() => file.current?.click()}
            >
              <Upload size={14} />
              {action.busy ? '正在处理…' : '选择导出文件'}
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept=".sakura,.enc"
            hidden
            onChange={(e) => {
              const value = e.target.files?.[0];
              if (value)
                void action.run(async (signal) => {
                  if (value.name.endsWith('.enc') && !password) throw new Error('请输入加密备份密码');
                  const response = await fetch(`/api/import?name=${encodeURIComponent(name)}`, {
                    method: 'POST',
                    headers: {
                      'X-Sakura-Token': token,
                      'Content-Type': 'application/octet-stream',
                      ...(value.name.endsWith('.enc')
                        ? {
                            'X-Sakura-Passphrase': btoa(
                              Array.from(new TextEncoder().encode(password), (byte) =>
                                String.fromCharCode(byte),
                              ).join(''),
                            ),
                          }
                        : {}),
                    },
                    body: value,
                    signal,
                  });
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  setPassword('');
                  await refresh();
                }, '实例已导入，可在工作空间启动');
              e.target.value = '';
            }}
          />
        </div>
      </PluginGate>
    </div>
  );
}

function ImagesPage({ request, token, refresh, onCreate, vms }: PluginPageProps) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Layers size={14} /> THE SEEDS OF SOMETHING NEW
          </div>
          <h1>轻装出发。</h1>
          <p>共享一份基础镜像，为每个想法创建独立的空间。</p>
        </div>
      </div>
      <ImageCatalog request={request} token={token} refresh={refresh} />
      <PluginGate id="snapshots">
        <GoldenImageLibrary request={request} refresh={refresh} vms={vms} />
      </PluginGate>
      <button className="primary" onClick={onCreate}>
        <Plus size={16} />
        创建发行版
      </button>
      <div className="info-callout">
        <Layers size={24} />
        <div>
          <h3>一个基础，多个可能。</h3>
          <p>基础镜像保持只读。新发行版使用 QCOW2 增量磁盘，只有实际写入的数据占用额外空间。</p>
        </div>
      </div>
    </>
  );
}
export const pages = { images: ImagesPage };
