/** 固定计划确认：原生模态焦点、退出与到期状态。 */
import { useEffect, useRef, useState } from 'react';
import type { SuitePlan } from '../shared/contracts/suite-common';
export function SuitePlanDialog({
  value,
  busy,
  onApprove,
  onCancel,
}: {
  value: SuitePlan;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    [expired, setExpired] = useState(Date.parse(value.expiresAt) <= Date.now());
  useEffect(() => {
    const element = dialog.current!,
      previous = document.activeElement;
    element.showModal();
    if (!busy) cancel.current?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [value.id]);
  useEffect(() => {
    const element = dialog.current;
    if (!busy && element?.open && document.activeElement === element) cancel.current?.focus();
  }, [busy]);
  useEffect(() => {
    const remaining = Date.parse(value.expiresAt) - Date.now();
    setExpired(remaining <= 0);
    const timer = setTimeout(() => setExpired(true), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [value.id, value.expiresAt]);
  return (
    <dialog
      ref={dialog}
      className="suite-dialog"
      aria-label="批准固定计划"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2>核对固定计划</h2>
      <p>动作：{value.action}</p>
      <p>截止：{new Date(value.expiresAt).toLocaleString()}</p>
      <code>摘要 {value.digest}</code>
      <pre>{JSON.stringify(value.input, null, 2)}</pre>
      {expired && <p role="status">计划已到期，请返回重新预览。</p>}
      <button disabled={busy || expired} onClick={onApprove}>
        批准并执行
      </button>
      <button ref={cancel} autoFocus disabled={busy} onClick={onCancel}>
        返回修改
      </button>
    </dialog>
  );
}
