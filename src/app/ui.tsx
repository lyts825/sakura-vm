/**
 * 模块职责：应用外壳共用的状态徽标、资源格式化和模态框基础组件。
 */
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { VMView } from '../../shared/contracts/vm.ts';
import { formatNumber } from '../localization';

export const bytes = (n: number) =>
  n >= 1073741824
    ? `${formatNumber(n / 1073741824, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`
    : `${formatNumber(n / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
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
export const active = (vm: VMView) =>
  vm.poweredOn || ['running', 'paused', 'starting', 'stopping'].includes(vm.status);
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
export function Badge({ vm }: { vm: VMView }) {
  return (
    <span className={`badge ${vm.status}`}>
      <span />
      {states[vm.status]}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    dialog
      .querySelector<HTMLElement>('input:not([type="hidden"]):not([readonly]), textarea, select')
      ?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
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
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
