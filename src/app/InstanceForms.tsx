/**
 * 模块职责（中文）：实例创建和资源配置表单，复用发行版、架构与硬件选项并提交控制面操作。
 * Module responsibility (English): Forms for creating VMs and editing their resource configuration.
 * 详细范围（中文）：公开入口包括 CreateModal, ConfigPanel；职责覆盖创建实例与编辑资源配置的表单，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include CreateModal, ConfigPanel. The scope covers Forms for creating VMs and editing their resource configuration. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import {
  ArrowRight,
  Cpu,
  HardDrive,
  LoaderCircle,
  MemoryStick,
  Network,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useId, useState } from 'react';
import type { ImageInfo } from '../../plugins/images/client';
import type { VMConfig, VMView } from '../../shared/contracts/vm.ts';
import { api } from '../controller-session';
import { useRemote } from '../feature-shared';
import { usePlugin } from '../plugin-context';
import { active, memory, Modal } from './ui';
import './instance-config.css';

/**
 * 中文：呈现创建实例与编辑资源配置的表单中的 ResourceFields 界面，组合 Cpu、MemoryStick，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ResourceFields surface for Forms for creating VMs and editing their resource configuration and composing Cpu, MemoryStick. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  config,
  set,
  disabled = false,
} 提供 config（config 状态）、set（ 状态）、disabled（disabled 状态） 上下文字段
 * English: Inputs: {
  config,
  set,
  disabled = false,
} provides context fields config (config state), set ( state), disabled (disabled state)
 */
function ResourceFields({
  config,
  set,
  disabled = false,
}: {
  config: VMConfig;
  set: /** 中文：合并指定资源字段到受控表单草稿，保留未编辑字段；这是 ResourceFields 的调用契约 | English: Merge selected resource fields into the controlled form draft, preserving untouched fields; this is the callable contract of ResourceFields | 中文：输入：v：签名所示 VMConfig 业务值 | English: Inputs: v: the VMConfig domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (v: VMConfig) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="resource-fields">
      <div className="form-grid">
        <label>
          <span>
            <Cpu size={15} />
            处理器
          </span>
          <select value={config.cpus} onChange={(e) => set({ ...config, cpus: +e.target.value })}>
            {[1, 2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n} vCPU
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            <MemoryStick size={15} />
            内存
          </span>
          <select value={config.memoryMiB} onChange={(e) => set({ ...config, memoryMiB: +e.target.value })}>
            {[256, 512, 1024, 2048, 4096, 8192].map((n) => (
              <option key={n} value={n}>
                {memory(n)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        执行模式
        <select
          value={config.accelerator}
          onChange={(e) => set({ ...config, accelerator: e.target.value as VMConfig['accelerator'] })}
        >
          <option value="auto">
            {config.architecture === 'aarch64' ? '自动 · ARM64 使用 TCG' : '自动 · 优先使用可用的硬件加速'}
          </option>
          <option value="tcg">TCG · 兼容模式，无需系统配置</option>
          {config.architecture !== 'aarch64' && (
            <option value="whpx">WHPX · 硬件加速，需已启用 Windows Hypervisor Platform</option>
          )}
        </select>
      </label>
      <label>
        启动固件
        <select
          aria-label="启动固件"
          value={config.firmware || 'bios'}
          onChange={(e) => set({ ...config, firmware: e.target.value as VMConfig['firmware'] })}
        >
          {config.architecture !== 'aarch64' && <option value="bios">BIOS · 兼容现有磁盘</option>}
          <option value="uefi">UEFI · OVMF 固件</option>
        </select>
        <small>切换已有实例前，请确认磁盘包含对应固件可启动的系统。</small>
      </label>
    </fieldset>
  );
}
/**
 * 中文：呈现创建实例与编辑资源配置的表单中的 CreateModal 界面，订阅 /images、/storage-pools，组合 ResourceFields、HardDrive、LoaderCircle、Plus，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the CreateModal surface for Forms for creating VMs and editing their resource configuration, subscribing to /images, /storage-pools and composing ResourceFields, HardDrive, LoaderCircle, Plus. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  busy,
  names,
  close,
  submit,
} 提供 busy（忙碌标记）、names（names 状态）、close（close 状态）、submit（submit 状态） 上下文字段
 * English: Inputs: {
  busy,
  names,
  close,
  submit,
} provides context fields busy (busy flag), names (names state), close (close state), submit (submit state)
 */
export function CreateModal({
  busy,
  names,
  close,
  submit,
}: {
  busy: boolean;
  names: string[];
  close: /** 中文：请求关闭当前界面，实际导航或卸载由父级决定；这是 CreateModal 的调用契约 | English: Request surface closure, leaving actual navigation/unmounting to the parent; this is the callable contract of CreateModal | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
  submit: /** 中文：把已校验的新实例表单交给创建流程，失败由上层显示；这是 CreateModal 的调用契约 | English: Submit the validated new-VM form to creation, with outer failure feedback; this is the callable contract of CreateModal | 中文：输入：c：签名所示 VMConfig 业务值；boot：签名所示 boolean 业务值 | English: Inputs: c: the VMConfig domain value in the signature; boot: the boolean domain value in the signature | 中文：结果：unknown；调用者依赖此类型约定 | English: Result: unknown; callers depend on this type contract */ (c: VMConfig, boot: boolean) => unknown;
}) {
  const [config, set] = useState<VMConfig>(() => {
    let name = 'alpine-dev';
    let suffix = names.length + 1;
    while (names.includes(name)) name = `alpine-${suffix++}`;
    return {
      name,
      memoryMiB: 512,
      cpus: 2,
      diskGiB: 8,
      accelerator: 'auto',
      forwards: [],
    };
  });
  const nameHelpId = useId();
  const nameErrorId = useId();
  const duplicateName = names.includes(config.name);
  const [boot, setBoot] = useState(true);
  const [poolName, setPoolName] = useState('');
  const [poolPath, setPoolPath] = useState('');
  const [poolBusy, setPoolBusy] = useState(false);
  const [poolError, setPoolError] = useState('');
  const hasImages = usePlugin('images'),
    hasProjects = usePlugin('projects');
  const images = useRemote<ImageInfo[]>(api, '/images', hasImages);
  const pools = useRemote<{
    pools: { id: string; name: string; available: boolean; freeBytes: number | null }[];
  }>(api, '/storage-pools');
  const imageId = config.architecture === 'aarch64' ? 'debian-arm64' : config.distro || 'alpine';
  const selectedImage = hasImages ? images.data?.find((i) => i.id === imageId) : { ready: true };
  return (
    <Modal title="一个新的 Linux 空间" subtitle="选择资源，剩下的交给 Sakura。" onClose={close}>
      <form className="create-instance-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !selectedImage?.ready || duplicateName) return;
          submit(config, boot);
        }}
      >
        <label>
          发行版
          <select
            value={imageId}
            onChange={/**
             * 中文功能：切换发行版或镜像时同步架构、加速器和固件，并按镜像最低要求提高内存及磁盘配置。
             * English: Synchronize architecture/accelerator/firmware when switching distro/image and raise memory/disk settings to image minimum requirements.
             * 输入 / Inputs: e.
             * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
             * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
             */
            (e) => {
              const arm64 = e.target.value === 'debian-arm64';
              const distro = (arm64 ? 'debian' : e.target.value) as VMConfig['distro'];
              const image = images.data?.find((i) => i.id === e.target.value);
              set({
                ...config,
                distro,
                architecture: arm64 ? 'aarch64' : 'x86_64',
                accelerator: arm64 ? 'tcg' : 'auto',
                firmware: arm64 ? 'uefi' : config.firmware,
                memoryMiB: Math.max(config.memoryMiB, image?.minimumMemory || 512),
                diskGiB: Math.max(config.diskGiB, image?.minimumDisk || 4),
              });
            }}
          >
            {(images.data || [{ id: 'alpine', name: 'Alpine 3.23', ready: true }]).map((image) => (
              <option key={image.id} value={image.id}>
                {image.name}
                {image.ready ? '' : '（请先到镜像库下载）'}
              </option>
            ))}
          </select>
        </label>
        {hasProjects && (
          <label>
            开发环境模板
            <select
              value={config.template || 'none'}
              onChange={(e) => set({ ...config, template: e.target.value as VMConfig['template'] })}
            >
              <option value="none">空白环境</option>
              <option value="node">Node.js + Git + tmux</option>
              <option value="python">Python + Git + tmux</option>
              <option value="rust">Rust + Git + tmux</option>
            </select>
            <small>首次启动自动安装所选工具，可在“项目”中查看进度或重试。</small>
          </label>
        )}
        <label>
          发行版名称
          <input
            required
            autoFocus
            data-initial-focus
            aria-invalid={duplicateName || undefined}
            aria-describedby={`${nameHelpId}${duplicateName ? ` ${nameErrorId}` : ''}`}
            pattern="[a-z][a-z0-9-]*"
            maxLength={32}
            value={config.name}
            onChange={(e) => set({ ...config, name: e.target.value })}
          />
          <small id={nameHelpId}>小写字母、数字和短横线，例如 alpine-dev</small>
          {duplicateName && <small id={nameErrorId} className="field-error" role="alert">已有同名发行版，请换一个名称。</small>}
        </label>
        <details className="instance-advanced" open>
          <summary>资源与启动设置<span>{config.cpus} vCPU · {memory(config.memoryMiB)}</span></summary>
        <ResourceFields config={config} set={set} />
        <label>
          <span>
            <HardDrive size={15} />
            磁盘容量
            <select value={config.diskGiB} onChange={(e) => set({ ...config, diskGiB: +e.target.value })}>
              {[4, 8, 16, 32, 64, 128].map((n) => (
                <option value={n} key={n}>
                  {n} GiB
                </option>
              ))}
            </select>
          </span>
          <small>按实际写入占用空间，无需预先分配全部容量。</small>
        </label>
        <label>
          存储池
          <select
            aria-label="新实例存储池"
            value={config.storagePoolId || 'default'}
            onChange={(e) =>
              set({ ...config, storagePoolId: e.target.value === 'default' ? undefined : e.target.value })
            }
          >
            {(
              pools.data?.pools || [{ id: 'default', name: '默认数据目录', available: true, freeBytes: null }]
            ).map((pool) => (
              <option key={pool.id} value={pool.id} disabled={!pool.available}>
                {pool.name}
                {pool.available ? '' : '（目录不可用）'}
              </option>
            ))}
          </select>
          <small>实例磁盘和随附文件写入所选目录；控制记录仍保存在 Sakura 数据目录。</small>
        </label>
        <details>
          <summary>新增本机存储池</summary>
          <label>
            名称
            <input value={poolName} maxLength={60} onChange={(event) => setPoolName(event.target.value)} />
          </label>
          <label>
            已存在的绝对目录
            <input value={poolPath} onChange={(event) => setPoolPath(event.target.value)} />
          </label>
          <button
            type="button"
            className="secondary compact"
            disabled={poolBusy || !poolName.trim() || !poolPath.trim()}
            onClick={/** 中文：提交 operation /storage-pools，完成创建实例与编辑资源配置的表单的数据交互并更新poolBusy 状态、poolError 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /storage-pools for Forms for creating VMs and editing their resource configuration and update poolBusy state, poolError state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
              setPoolBusy(true);
              setPoolError('');
              void api<{ created: { id: string } }>('/storage-pools', 'POST', {
                mode: 'create',
                name: poolName,
                path: poolPath,
              })
                .then((result) => {
                  set({ ...config, storagePoolId: result.created.id });
                  pools.reload();
                  setPoolName('');
                  setPoolPath('');
                })
                .catch((error) => setPoolError((error as Error).message))
                .finally(() => setPoolBusy(false));
            }}
          >
            创建存储池
          </button>
          {poolError && <p role="alert">{poolError}</p>}
        </details>
        </details>
        <label className="checkbox-label">
          <input type="checkbox" checked={boot} onChange={(e) => setBoot(e.target.checked)} />
          创建后立即启动
        </label>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy || !selectedImage?.ready || duplicateName}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}创建发行版
          </button>
        </div>
      </form>
    </Modal>
  );
}
/**
 * 中文：呈现创建实例与编辑资源配置的表单中的 ConfigPanel 界面，组合 ResourceFields、Network、Plus、Save、Trash2，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ConfigPanel surface for Forms for creating VMs and editing their resource configuration and composing ResourceFields, Network, Plus, Save, Trash2. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  vm,
  busy,
  save,
  remove,
} 提供 vm（vm 状态）、busy（忙碌标记）、save（save 状态）、remove（移除服务端会话的异步操作） 上下文字段
 * English: Inputs: {
  vm,
  busy,
  save,
  remove,
} provides context fields vm (vm state), busy (busy flag), save (save state), remove (asynchronous server-session removal)
 */
export function ConfigPanel({
  vm,
  busy,
  save,
  remove,
}: {
  vm: VMView;
  busy: boolean;
  save: /** 中文：提交当前编辑内容并返回保存结果，失败允许调用者保留草稿；这是 ConfigPanel 的调用契约 | English: Submit current edit content and return its save result, allowing callers to retain drafts on failure; this is the callable contract of ConfigPanel | 中文：输入：c：签名所示 VMConfig 业务值 | English: Inputs: c: the VMConfig domain value in the signature | 中文：结果：unknown；调用者依赖此类型约定 | English: Result: unknown; callers depend on this type contract */ (c: VMConfig) => unknown;
  remove: /** 中文：异步删除对应服务端会话，成功兑现后才改变本地标签集合；这是 ConfigPanel 的调用契约 | English: Asynchronously remove the server session before success permits local tab changes; this is the callable contract of ConfigPanel | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
}) {
  const [config, set] = useState<VMConfig>({
    name: vm.name,
    cpus: vm.cpus,
    memoryMiB: vm.memoryMiB,
    accelerator: vm.accelerator,
    diskGiB: vm.diskGiB,
    storagePoolId: vm.storagePoolId,
    forwards: vm.forwards,
    distro: vm.distro,
    architecture: vm.architecture,
    template: vm.template,
    firmware: vm.firmware,
  });
  const running = active(vm);
  const hasNetwork = usePlugin('network');
  const portsErrorId = useId();
  const duplicateHosts = new Set(config.forwards.filter((port, index, ports) => ports.some((other, otherIndex) => otherIndex !== index && other.host === port.host)).map(port => port.host));
  const portConflict = hasNetwork && duplicateHosts.size > 0;
  return (
    <div className="content-panel config-panel" aria-label="发行版资源配置">
      <div className="panel-heading">
        <div>
          <h3>为你的工作，分配刚好的资源</h3>
          <p>
            {vm.sandbox
              ? '沙箱的资源和网络策略已固定；需要调整时请创建新沙箱。'
              : running
                ? '停止发行版后，可以修改配置。'
                : '配置将在下次启动时生效。'}
          </p>
        </div>
      </div>
      <div className="config-summary" aria-label="当前配置草稿">
        <span><Cpu size={16} aria-hidden="true" /><strong>{config.cpus}</strong> vCPU</span>
        <span><MemoryStick size={16} aria-hidden="true" /><strong>{memory(config.memoryMiB)}</strong> 内存</span>
        <span><HardDrive size={16} aria-hidden="true" /><strong>{config.diskGiB} GiB</strong> 磁盘</span>
      </div>
      <p className="config-edit-state" role="status">{busy ? '正在处理配置，请稍候…' : vm.sandbox ? '沙箱配置已锁定' : running ? '运行期间配置只读' : '可编辑 · 保存后于下次启动生效'}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || running || vm.sandbox || portConflict) return;
          save(config);
        }}
      >
        <ResourceFields config={config} set={set} disabled={busy || running || !!vm.sandbox} />
        {hasNetwork && !vm.sandbox && (
          <>
            <div className="panel-heading port-heading">
              <h3>
                <Network size={16} />
                本机端口转发
              </h3>
              <button
                type="button"
                className="text-button"
                disabled={busy || running || config.forwards.length >= 12}
                onClick={() => {
                  let host = 8080;
                  while (config.forwards.some(port => port.host === host)) host++;
                  set({ ...config, forwards: [...config.forwards, { host, guest: 80 }] });
                }}
              >
                <Plus size={14} />
                添加
              </button>
            </div>
            <p className="config-port-count">{config.forwards.length} / 12 条规则 · Windows 端口不能重复</p>
            {portConflict && <p id={portsErrorId} className="config-port-error" role="alert">Windows 端口重复，请为每条规则设置不同的本机端口。</p>}
            {config.forwards.length === 0 && (
              <p className="muted small-text">
                尚无转发规则。添加后，可从 Windows 的 localhost 访问 Linux 服务。
              </p>
            )}
            {config.forwards.map((p, i) => (
              <div className="port-row" key={i}>
                <label>
                  Windows 端口
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    required
                    value={p.host}
                    aria-label={`Windows 端口 ${i + 1}`}
                    aria-invalid={duplicateHosts.has(p.host) || undefined}
                    aria-describedby={duplicateHosts.has(p.host) ? portsErrorId : undefined}
                    disabled={busy || running}
                    onChange={(e) =>
                      set({
                        ...config,
                        forwards: config.forwards.map((f, j) =>
                          j === i ? { ...f, host: +e.target.value } : f,
                        ),
                      })
                    }
                  />
                </label>
                <ArrowRight size={17} />
                <label>
                  Linux 端口
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={p.guest}
                    aria-label={`Linux 端口 ${i + 1}`}
                    disabled={busy || running}
                    onChange={(e) =>
                      set({
                        ...config,
                        forwards: config.forwards.map((f, j) =>
                          j === i ? { ...f, guest: +e.target.value } : f,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`删除端口规则 ${i + 1}：${p.host} → ${p.guest}`}
                  disabled={busy || running}
                  onClick={() => set({ ...config, forwards: config.forwards.filter((_, j) => j !== i) })}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </>
        )}
        <div className="config-actions">
          <button className="primary compact" disabled={busy || running || !!vm.sandbox || portConflict}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
            {busy ? '正在处理…' : '保存配置'}
          </button>
          <button
            type="button"
            className="text-button danger-text"
            disabled={busy || running}
            onClick={remove}
          >
            <Trash2 size={14} />
            删除发行版
          </button>
        </div>
      </form>
    </div>
  );
}
