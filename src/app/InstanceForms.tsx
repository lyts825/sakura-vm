/**
 * 模块职责：实例创建和资源配置表单，复用发行版、架构与硬件选项并提交控制面操作。
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
import { useState } from 'react';
import type { ImageInfo } from '../../plugins/images/client';
import type { VMConfig, VMView } from '../../shared/contracts/vm.ts';
import { api } from '../controller-session';
import { useRemote } from '../feature-shared';
import { usePlugin } from '../plugin-context';
import { active, memory, Modal } from './ui';

function ResourceFields({
  config,
  set,
  disabled = false,
}: {
  config: VMConfig;
  set: (v: VMConfig) => void;
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
export function CreateModal({
  busy,
  names,
  close,
  submit,
}: {
  busy: boolean;
  names: string[];
  close: () => void;
  submit: (c: VMConfig, boot: boolean) => unknown;
}) {
  const [config, set] = useState<VMConfig>({
    name: names.includes('alpine-dev') ? `alpine-${names.length + 1}` : 'alpine-dev',
    memoryMiB: 512,
    cpus: 2,
    diskGiB: 8,
    accelerator: 'auto',
    forwards: [],
  });
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(config, boot);
        }}
      >
        <label>
          发行版
          <select
            value={imageId}
            onChange={(e) => {
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
            pattern="[a-z][a-z0-9-]*"
            maxLength={32}
            value={config.name}
            onChange={(e) => set({ ...config, name: e.target.value })}
          />
          <small>小写字母、数字和短横线，例如 alpine-dev</small>
        </label>
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
            onClick={() => {
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
        <label className="checkbox-label">
          <input type="checkbox" checked={boot} onChange={(e) => setBoot(e.target.checked)} />
          创建后立即启动
        </label>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy || !selectedImage?.ready}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}创建发行版
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ConfigPanel({
  vm,
  busy,
  save,
  remove,
}: {
  vm: VMView;
  busy: boolean;
  save: (c: VMConfig) => unknown;
  remove: () => void;
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
  return (
    <div className="content-panel config-panel">
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(config);
        }}
      >
        <ResourceFields config={config} set={set} disabled={running || !!vm.sandbox} />
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
                disabled={running || config.forwards.length >= 12}
                onClick={() => set({ ...config, forwards: [...config.forwards, { host: 8080, guest: 80 }] })}
              >
                <Plus size={14} />
                添加
              </button>
            </div>
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
                    disabled={running}
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
                    disabled={running}
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
                  aria-label="删除端口规则"
                  disabled={running}
                  onClick={() => set({ ...config, forwards: config.forwards.filter((_, j) => j !== i) })}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </>
        )}
        <div className="config-actions">
          <button className="primary compact" disabled={busy || running || !!vm.sandbox}>
            <Save size={14} />
            保存配置
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
