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
const SignedBundlesPanel = lazy(() =>
  import('../snapshots/SignedBundles').then((module) => ({ default: module.SignedBundlesPanel })),
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
  const diskFile = useRef<HTMLInputElement>(null);
  const [diskName, setDiskName] = useState('imported-disk');
  const [diskFormat, setDiskFormat] = useState<'raw' | 'vmdk' | 'vhdx' | 'ova'>('raw');
  const [diskDistro, setDiskDistro] = useState<'alpine' | 'debian' | 'ubuntu'>('alpine');
  const [diskMemory, setDiskMemory] = useState(1024);
  const [diskCpus, setDiskCpus] = useState(2);
  const [diskFirmware, setDiskFirmware] = useState<'bios' | 'uefi'>('bios');
  const [diskSha256, setDiskSha256] = useState('');
  const [importedHash, setImportedHash] = useState('');
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
      <div className="feature-card">
        <h3>导入其他镜像</h3>
        <p>导入独立的 RAW、VMDK、VHDX 或单磁盘 OVA，转换成 Sakura 管理的 QCOW2 实例。源镜像应是支持 NoCloud/Tiny Cloud 初始化的 Linux 云镜像；最多上传 8 GiB，虚拟磁盘最大 128 GiB。较小镜像会扩容到所选发行版的最低容量。</p>
        <div className="disk-import-form">
          <label>实例名称
            <input aria-label="镜像导入实例名称" pattern="[a-z][a-z0-9-]*" maxLength={32} value={diskName} onChange={(event) => setDiskName(event.target.value)} />
          </label>
          <label>文件格式
            <select aria-label="镜像文件格式" value={diskFormat} onChange={(event) => setDiskFormat(event.target.value as typeof diskFormat)}>
              <option value="raw">RAW</option><option value="vmdk">VMDK</option><option value="vhdx">VHDX</option><option value="ova">OVA</option>
            </select>
          </label>
          <label>源发行版
            <select aria-label="镜像源发行版" value={diskDistro} onChange={(event) => setDiskDistro(event.target.value as typeof diskDistro)}>
              <option value="alpine">Alpine</option><option value="debian">Debian</option><option value="ubuntu">Ubuntu</option>
            </select>
          </label>
          <label>内存 MiB
            <input aria-label="导入实例内存" type="number" min={diskDistro === 'alpine' ? 256 : 1024} max={8192} value={diskMemory} onChange={(event) => setDiskMemory(Number(event.target.value))} />
          </label>
          <label>CPU
            <input aria-label="导入实例 CPU" type="number" min={1} max={8} value={diskCpus} onChange={(event) => setDiskCpus(Number(event.target.value))} />
          </label>
          <label>启动固件
            <select aria-label="导入实例固件" value={diskFirmware} onChange={(event) => setDiskFirmware(event.target.value as typeof diskFirmware)}>
              <option value="bios">BIOS</option><option value="uefi">UEFI / OVMF</option>
            </select>
          </label>
        </div>
        <label>预期 SHA-256（可选）
          <input aria-label="导入镜像 SHA-256" placeholder="留空则仅计算并显示校验值" value={diskSha256} maxLength={64} onChange={(event) => setDiskSha256(event.target.value.toLowerCase().trim())} />
        </label>
        <button className="secondary compact" disabled={action.busy} onClick={() => diskFile.current?.click()}>
          <Upload size={14} />{action.busy ? '正在处理…' : '选择镜像文件'}
        </button>
        <input ref={diskFile} type="file" accept=".raw,.img,.vmdk,.vhdx,.ova" hidden onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) void action.run(async (signal) => {
            if (!/^[a-z][a-z0-9-]{0,31}$/.test(diskName)) throw new Error('实例名称格式不正确');
            if (selected.size > 8 * 1024 ** 3) throw new Error('镜像文件超过 8 GiB');
            if (diskSha256 && !/^[a-f0-9]{64}$/.test(diskSha256)) throw new Error('SHA-256 必须为 64 位十六进制');
            const query = new URLSearchParams({ name: diskName, format: diskFormat, distro: diskDistro, memoryMiB: String(diskMemory), cpus: String(diskCpus), firmware: diskFirmware });
            if (diskSha256) query.set('sha256', diskSha256);
            const response = await fetch(`/api/image-import?${query}`, {
              method: 'POST',
              headers: { 'X-Sakura-Token': token, 'Content-Type': 'application/octet-stream' },
              body: selected,
              signal,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '导入失败');
            setImportedHash(result.source.sha256);
            await refresh();
          }, '镜像已导入，可在工作空间启动');
          event.target.value = '';
        }} />
        {importedHash && <p className="disk-import-hash">最近导入文件 SHA-256：<code>{importedHash}</code></p>}
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
        <SignedBundlesPanel request={request} />
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
