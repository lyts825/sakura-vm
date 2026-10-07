/**
 * 模块职责（中文）：“发行版镜像”插件的Linux 镜像目录、外部磁盘导入及黄金镜像/签名包入口，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for cloud-image downloads and external disk imports.
 * 详细范围（中文）：公开入口包括 ImageInfo, ImageCatalog, pages；职责覆盖云镜像下载与外部磁盘导入的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ImageInfo, ImageCatalog, pages. The scope covers UI interaction and state presentation for cloud-image downloads and external disk imports. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { Download, Layers, Plus, Upload } from 'lucide-react';
import { Suspense, useRef, useState } from 'react';
import type { OperationResponse } from '../../shared/contracts/api-client.generated';
import { Feedback, JobLog, useAction, useRemote, type Request } from '../../src/feature-shared';
import '../../src/features.css';
import { embeddedPluginComponent, type PluginPageProps } from '../../src/plugin-client';
import { PluginGate } from '../../src/plugin-context';
import { PluginBoundary } from '../../src/plugin-boundary';
import { pluginGeneration } from '../../src/plugin-generation';
import { controllerSession } from '../../src/controller-session';
/**
 * 中文：懒加载 ../snapshots/GoldenImages 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../snapshots/GoldenImages and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadGoldenImageLibrary = () =>
  import('../snapshots/GoldenImages').then((module) => ({ default: module.GoldenImageLibrary }));
/**
 * 中文：懒加载 ../snapshots/SignedBundles 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../snapshots/SignedBundles and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadSignedBundlesPanel = () =>
  import('../snapshots/SignedBundles').then((module) => ({ default: module.SignedBundlesPanel }));

export type ImageInfo = OperationResponse<'images.legacy.get.images'>[number];

/**
 * 中文：呈现云镜像下载与外部磁盘导入的界面交互与状态呈现中的 BundleImport 界面，组合 Upload，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the BundleImport surface for UI interaction and state presentation for cloud-image downloads and external disk imports and composing Upload. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ refresh } 提供 refresh（refresh 状态） 上下文字段
 * English: Inputs: { refresh } provides context fields refresh (refresh state)
 */
function BundleImport({ refresh }: { refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 BundleImport 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of BundleImport | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown> }) {
  const action = useAction();
  const [name, setName] = useState('imported-linux');
  const [password, setPassword] = useState('');
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <Feedback error={action.error} message={action.message} />
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
            onChange={/**
             * 中文功能：捕获所选备份文件，提交普通或加密备份导入动作，完成后清空密码并刷新；重置文件输入以便再次选择同一文件。
             * English: Capture the selected backup file and submit plain/encrypted import, clear the password and refresh on completion, then reset file input to allow selecting the same file again.
             * 输入 / Inputs: e.
             * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
             * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
             * 设计思路：异步动作组合 images、snapshots 与必要 backups 的安装身份取消信号，提交前后均检查，避免撤销插件后发布导入结果。
             * Design: The async action combines images/snapshots and required backups installation abort signals and checks before/after submission, preventing result publication after plugin revocation.
             */
            (e) => {
              const value = e.target.files?.[0];
              if (value)
                void action.run(/** 中文：提交 operation snapshots.legacy.post.import，完成云镜像下载与外部磁盘导入的界面交互与状态呈现的数据交互并更新password 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation snapshots.legacy.post.import for UI interaction and state presentation for cloud-image downloads and external disk imports and update password state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：请输入加密备份密码。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 请输入加密备份密码. These errors reach the direct caller or this function's catch handler | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                  if (value.name.endsWith('.enc') && !password) throw new Error('请输入加密备份密码');
                  const combined = AbortSignal.any([signal, pluginGeneration.captureIdentity('official:images'),
                    pluginGeneration.captureIdentity('official:snapshots'),
                    ...(value.name.endsWith('.enc') ? [pluginGeneration.captureIdentity('official:backups')] : [])]);
                  combined.throwIfAborted();
                  await controllerSession.operation('snapshots.legacy.post.import', {
                    query: { name },
                    headers: value.name.endsWith('.enc') ? {
                      'x-sakura-passphrase': btoa(Array.from(new TextEncoder().encode(password), (byte) =>
                        String.fromCharCode(byte)).join('')),
                    } : {},
                    body: value,
                    signal: combined,
                  });
                  combined.throwIfAborted();
                  setPassword('');
                  await refresh();
                }, '实例已导入，可在工作空间启动');
              e.target.value = '';
            }}
          />
        </div>
    </>
  );
}

/**
 * 中文：呈现云镜像下载与外部磁盘导入的界面交互与状态呈现中的 ImageCatalog 界面，订阅 /images，组合 Upload，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ImageCatalog surface for UI interaction and state presentation for cloud-image downloads and external disk imports, subscribing to /images and composing Upload. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  request,
  refresh,
} 提供 request（带身份和权限作用域的传输能力）、refresh（refresh 状态） 上下文字段
 * English: Inputs: {
  request,
  refresh,
} provides context fields request (transport capability bound to identity/authority scope), refresh (refresh state)
 */
export function ImageCatalog({
  request,
  refresh,
}: {
  request: Request;
  token: string;
  refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 ImageCatalog 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of ImageCatalog | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>;
}) {
  const remote = useRemote<ImageInfo[]>(request, '/images', true, 2500);
  const action = useAction();
  const diskFile = useRef<HTMLInputElement>(null);
  const [diskName, setDiskName] = useState('imported-disk');
  const [diskFormat, setDiskFormat] = useState<'raw' | 'vmdk' | 'vhdx' | 'ova'>('raw');
  const [diskDistro, setDiskDistro] = useState<'alpine' | 'debian' | 'ubuntu'>('alpine');
  const [diskArchitecture, setDiskArchitecture] = useState<'x86_64' | 'aarch64'>('x86_64');
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
            <p>{img.id === 'debian-arm64' ? 'ARM64' : 'x86_64'} · 最低 {img.minimumMemory} MiB 内存</p>
            <span className={`badge ${img.ready ? 'running' : ''}`}>
              {img.ready ? '可创建实例' : '尚未下载'}
            </span>
            {!img.ready && (
              <button
                className="secondary compact"
                disabled={action.busy || img.job?.status === 'running'}
                onClick={() =>
                  void action.run(/** 中文：提交 POST /images/{img.id}，完成云镜像下载与外部磁盘导入的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /images/{img.id} for UI interaction and state presentation for cloud-image downloads and external disk imports. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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
            <select aria-label="镜像源发行版" value={diskDistro}
              onChange={(event) => setDiskDistro(event.target.value as typeof diskDistro)}>
              {diskArchitecture !== 'aarch64' && <option value="alpine">Alpine</option>}
              <option value="debian">Debian</option>
              {diskArchitecture !== 'aarch64' && <option value="ubuntu">Ubuntu</option>}
            </select>
          </label>
          <label>客户机架构
            <select aria-label="导入实例架构" value={diskArchitecture}
              onChange={(event) => {
                const architecture = event.target.value as typeof diskArchitecture;
                setDiskArchitecture(architecture);
                if (architecture === 'aarch64') {
                  setDiskDistro('debian');
                  setDiskFirmware('uefi');
                }
              }}>
              <option value="x86_64">x86_64</option><option value="aarch64">ARM64</option>
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
              {diskArchitecture !== 'aarch64' && <option value="bios">BIOS</option>}
              <option value="uefi">UEFI / OVMF</option>
            </select>
          </label>
        </div>
        <label>预期 SHA-256（可选）
          <input aria-label="导入镜像 SHA-256" placeholder="留空则仅计算并显示校验值" value={diskSha256} maxLength={64} onChange={(event) => setDiskSha256(event.target.value.toLowerCase().trim())} />
        </label>
        <button className="secondary compact" disabled={action.busy} onClick={() => diskFile.current?.click()}>
          <Upload size={14} />{action.busy ? '正在处理…' : '选择镜像文件'}
        </button>
        <input ref={diskFile} type="file" accept=".raw,.img,.vmdk,.vhdx,.ova" hidden onChange={/**
         * 中文功能：捕获磁盘镜像文件，验证名称、8 GiB 大小与可选 SHA-256 后提交当前镜像配置，成功时保存来源摘要并刷新。
         * English: Capture a disk-image file, validate name/8 GiB size/optional SHA-256, then submit current image configuration and retain the returned source digest before refresh.
         * 输入 / Inputs: event.
         * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
         * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
         * 设计思路：文件对象在重置输入前捕获；组合动作和插件身份信号并在响应后复核，使重复选择和撤销不会误用可变 DOM 输入。
         * Design: Capture the file object before resetting input and recheck combined action/plugin signals after response so repeat selection or revocation cannot misuse mutable DOM input.
         */
        (event) => {
          const selected = event.target.files?.[0];
          if (selected) void action.run(/** 中文：提交 operation images.legacy.post.image-import，完成云镜像下载与外部磁盘导入的界面交互与状态呈现的数据交互并更新importedHash 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation images.legacy.post.image-import for UI interaction and state presentation for cloud-image downloads and external disk imports and update importedHash state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：实例名称格式不正确；镜像文件超过 8 GiB；SHA-256 必须为 64 位十六进制。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 实例名称格式不正确; 镜像文件超过 8 GiB; SHA-256 必须为 64 位十六进制. These errors reach the direct caller or this function's catch handler | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
            if (!/^[a-z][a-z0-9-]{0,31}$/.test(diskName)) throw new Error('实例名称格式不正确');
            if (selected.size > 8 * 1024 ** 3) throw new Error('镜像文件超过 8 GiB');
            if (diskSha256 && !/^[a-f0-9]{64}$/.test(diskSha256)) throw new Error('SHA-256 必须为 64 位十六进制');
            const combined = AbortSignal.any([signal, pluginGeneration.captureIdentity('official:images')]);
            combined.throwIfAborted();
            const result = await controllerSession.operation('images.legacy.post.image-import', {
              query: { name: diskName, format: diskFormat, distro: diskDistro, architecture: diskArchitecture,
                memoryMiB: String(diskMemory), cpus: String(diskCpus), firmware: diskFirmware,
                ...(diskSha256 ? { sha256: diskSha256 } : {}) },
              body: selected,
              signal: combined,
            });
            combined.throwIfAborted();
            setImportedHash(result.source.sha256);
            await refresh();
          }, '镜像已导入，可在工作空间启动');
          event.target.value = '';
        }} />
        {importedHash && <p className="disk-import-hash">最近导入文件 SHA-256：<code>{importedHash}</code></p>}
      </div>
      <PluginGate id="snapshots">
        <PluginBoundary identity="official:snapshots" request={request} label="实例包导入">
          {() => <BundleImport refresh={refresh} />}
        </PluginBoundary>
        <PluginBoundary identity="official:snapshots" request={request} label="实例包签名">
          {(scopedRequest, lifetime) => {
            const SignedBundlesPanel = embeddedPluginComponent('snapshots', 'signed-bundles', lifetime, loadSignedBundlesPanel);
            return <Suspense fallback={<p role="status">正在加载签名设置…</p>}>
              <SignedBundlesPanel request={scopedRequest} />
            </Suspense>;
          }}
        </PluginBoundary>
      </PluginGate>
    </div>
  );
}

/**
 * 中文：呈现云镜像下载与外部磁盘导入的界面交互与状态呈现中的 ImagesPage 界面，组合 Layers、ImageCatalog、Plus，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ImagesPage surface for UI interaction and state presentation for cloud-image downloads and external disk imports and composing Layers, ImageCatalog, Plus. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request, token, refresh, onCreate, vms } 提供 request（带身份和权限作用域的传输能力）、token（当前传输认证凭证）、refresh（refresh 状态）、onCreate（onCreate 状态）、vms（vms 状态） 上下文字段
 * English: Inputs: { request, token, refresh, onCreate, vms } provides context fields request (transport capability bound to identity/authority scope), token (current transport credential), refresh (refresh state), onCreate (onCreate state), vms (vms state)
 */
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
        <PluginBoundary identity="official:snapshots" request={request} label="黄金镜像库">
          {(scopedRequest, lifetime) => {
            const GoldenImageLibrary = embeddedPluginComponent('snapshots', 'golden-images', lifetime, loadGoldenImageLibrary);
            return <Suspense fallback={<p role="status">正在加载黄金镜像库…</p>}>
              <GoldenImageLibrary request={scopedRequest} refresh={refresh} vms={vms} />
            </Suspense>;
          }}
        </PluginBoundary>
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
