/**
 * 模块职责（中文）：应用外壳共用的状态徽标、资源格式化和模态框基础组件。
 * Module responsibility (English): Basic modal, status-badge and resource-value presentation components.
 * 详细范围（中文）：公开入口包括 bytes, memory, states, active, Alpine, Badge, Modal；职责覆盖模态框、状态徽标与资源数值显示的基础界面组件，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include bytes, memory, states, active, Alpine, Badge, Modal. The scope covers Basic modal, status-badge and resource-value presentation components. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { VMView } from '../../shared/contracts/vm.ts';
import { formatNumber } from '../localization';

/**
 * 中文：按 1 GiB 阈值把字节数显示为 GB 或 MB，分别保留两位或一位区域格式小数。
 * English: Display byte counts as GB or MB at the one-GiB threshold, with two or one locale-formatted decimal places respectively.
 * 中文：输入：n：签名所示 number 业务值
 * English: Inputs: n: the number domain value in the signature
 */
export const bytes = (n: number) =>
  n >= 1073741824
    ? `${formatNumber(n / 1073741824, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`
    : `${formatNumber(n / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
/**
 * 中文：把以 MiB 为单位的配置显示成 MiB/GiB，大于等于 1024 时换算为 GiB 并保留最多一位小数。
 * English: Display MiB-valued configuration as MiB/GiB, converting at 1024 MiB with at most one fractional digit.
 * 中文：输入：n：签名所示 number 业务值
 * English: Inputs: n: the number domain value in the signature
 */
export const memory = (n: number) =>
  n >= 1024 ? `${formatNumber(n / 1024, { maximumFractionDigits: 1 })} GiB` : `${formatNumber(n)} MiB`;
export const states = {
  running: '运行中',
  paused: '已暂停',
  stopped: '已停止',
  starting: '启动中',
  stopping: '停止中',
  error: '需要检查',
};
/**
 * 中文：实例 poweredOn 或处于运行、暂停、启动、停止过渡状态时返回 true，避免只看稳定状态遗漏正在占用资源的实例。
 * English: Return true for poweredOn VMs or running/paused/starting/stopping states, covering transitional resource use as well as stable states.
 * 中文：输入：vm：签名所示 VMView 业务值
 * English: Inputs: vm: the VMView domain value in the signature
 */
export const active = (vm: VMView) =>
  vm.poweredOn || ['running', 'paused', 'starting', 'stopping'].includes(vm.status);
/**
 * 中文：呈现 Alpine 标识的内联 SVG，small 仅影响尺寸样式，不触发资源请求。
 * English: Render the inline Alpine-mark SVG; small affects sizing styles without requesting resources.
 * 中文：输入：{ small = false } 提供 small（small 状态） 上下文字段
 * English: Inputs: { small = false } provides context fields small (small state)
 */
export function Alpine({ small = false }: { small?: boolean }) {
  return (
    <span className={`alpine-mark ${small ? 'small' : ''}`}>
      <svg width="32" height="30" viewBox="0 0 40 36" fill="none">
        <path d="M3 29 18 7l8 12 5-7 7 17H3Z" fill="currentColor" />
        <path d="m13 15 5-8 6 9-6-3-5 2Z" fill="white" />
        <path d="m27 18 4-6 4 9-4-3-4 0Z" fill="white" />
      </svg>
    </span>
  );
}
/**
 * 中文：按实例状态应用徽标样式和本地化状态文字，状态由传入实例快照决定。
 * English: Apply badge styling and localized status text from the supplied VM snapshot.
 * 中文：输入：{ vm } 提供 vm（vm 状态） 上下文字段
 * English: Inputs: { vm } provides context fields vm (vm state)
 */
export function Badge({ vm }: { vm: VMView }) {
  return (
    <span className={`badge ${vm.status}`}>
      <span />
      {states[vm.status]}
    </span>
  );
}
/**
 * 中文：挂载时打开原生 dialog 并聚焦首个可编辑控件，关闭时恢复仍在文档中的原焦点；标题关联无障碍 ID，Escape 与遮罩外点击委托 onClose。
 * English: Open a native dialog on mount, focus its first editable control and restore the prior connected focus target on cleanup. Associate its title with an accessibility ID and delegate Escape/outside-backdrop closure to onClose.
 * 中文：输入：{
  title,
  subtitle,
  children,
  onClose,
} 提供 title（title 状态）、subtitle（subtitle 状态）、children（children 状态）、onClose（onClose 状态） 上下文字段
 * English: Inputs: {
  title,
  subtitle,
  children,
  onClose,
} provides context fields title (title state), subtitle (subtitle state), children (children state), onClose (onClose state)
 */
export function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: /** 中文：请求关闭对话框，父级负责更新显示状态；这是 Modal 的调用契约 | English: Request dialog closure so the parent updates display state; this is the callable contract of Modal | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useEffect(/** 中文：当依赖 [] 变化时打开原生模态对话框，把输入焦点移到目标元素；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, open a native modal dialog, move input focus to the target. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    const initial = dialog.querySelector<HTMLElement>('[data-initial-focus]:not(:disabled)') ||
      dialog.querySelector<HTMLElement>('input:not([type="hidden"]):not([readonly]):not(:disabled), textarea:not(:disabled), select:not(:disabled)');
    initial?.focus();
    /**
     * 中文：在模态框、状态徽标与资源数值显示的基础界面组件流程中关闭所属连接或存储对象，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Basic modal, status-badge and resource-value presentation components, close the owned connection/storage object, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal app-modal"
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target !== ref.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={subtitleId}>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
