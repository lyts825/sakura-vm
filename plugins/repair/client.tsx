/** 单文件修复的显式发送、验证和接受界面。 Explicit send, validate and accept controls for single-file repair. */
import { useRef, useState } from 'react';
import type { FeatureProps, Request } from '../../src/feature-shared';
import { Feedback, useAction } from '../../src/feature-shared';
import { repairSessionSchema, type RepairSession } from '../../shared/contracts/repair-session.ts';
import '../../src/features.css';

const stateLabels: Record<RepairSession['state'], string> = { preview: '待确认发送', generating: '生成中',
  review: '待审阅和验证', validating: '隔离验证中', validated: '验证通过', 'apply-unknown': '应用结果待核对', applied: '补丁已接受', failed: '操作失败', cancelled: '已取消' };

/** 每个阶段由单独用户动作触发，命令编辑后禁用旧验证的接受入口。
 * Trigger each stage explicitly and disable acceptance when the reviewed command changes. */
export function RepairPanel({ vm, request, projectId, developmentDraft }: FeatureProps) {
  const [target, setTarget] = useState(developmentDraft?.target ?? '');
  const [context, setContext] = useState('');
  const [instruction, setInstruction] = useState(developmentDraft?.instruction ?? '');
  const [command, setCommand] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState<{ value: RepairSession; request: Request }>();
  const epoch = useRef(0), scope = useRef({ request, vmId: vm.id, projectId });
  if (scope.current.request !== request || scope.current.vmId !== vm.id || scope.current.projectId !== projectId) {
    epoch.current++; scope.current = { request, vmId: vm.id, projectId };
  }
  const session = saved?.request === request && saved.value.vmId === vm.id &&
    (!projectId || saved.value.projectId === projectId) ? saved.value : undefined;
  const action = useAction(), cancellation = useAction();
  const base = `/vms/${vm.id}/repair`;
  /** 请求结束后同步服务端记录，失败时保留可审阅证据。 Refresh server evidence after each request, including failures. */
  const perform = async (body: unknown, signal: AbortSignal) => {
    const generation = epoch.current;
    try {
      const value = repairSessionSchema.parse(await request(base, 'POST', body, signal));
      signal.throwIfAborted(); if (epoch.current === generation) setSaved({ value, request });
    } catch (error) {
      if (session && !signal.aborted && epoch.current === generation) {
        try { const value = repairSessionSchema.parse(await request(`${base}?sessionId=${session.id}`, 'GET', undefined, signal));
          signal.throwIfAborted(); if (epoch.current === generation) setSaved({ value, request }); } catch { /* 保留原始操作错误。 Retain the original action error. */ }
      }
      throw error;
    }
  };
  return <div className="feature-card">
    <h3>AI 修复会话</h3>
    <p>每次修改 1 个现有 UTF-8 文件，可选择最多 7 个上下文文件。先在设置中配置本机模型。</p>
    <p className="subtle-note">验证沙箱仅重建选中的文本文件，不包含完整项目、依赖目录和原实例环境。沙箱断网，停机即丢弃写入。</p>
    <label>目标文件（相对项目目录）<input value={target} disabled={action.busy || !!session}
      onChange={event => setTarget(event.target.value)} placeholder="src/example.py" /></label>
    <label>上下文文件（每行 1 个，可留空）<textarea rows={3} value={context} disabled={action.busy || !!session}
      onChange={event => setContext(event.target.value)} /></label>
    <label>修复要求<textarea rows={3} value={instruction} disabled={action.busy || !!session}
      onChange={event => setInstruction(event.target.value)} /></label>
    <button className="primary compact" disabled={action.busy || cancellation.busy || !!session || vm.status !== 'running' || !target || !instruction}
      onClick={() => { setReviewed(false); setCommand(''); void action.run(signal => perform({ action: 'preview', input: {
        target, context: context.split(/\r?\n/).map(path => path.trim()).filter(Boolean), instruction,
      } }, signal)); }}>选择文件并预览发送内容</button>
    {session && <>
      <p role="status">{stateLabels[session.state]} · {session.target}</p>
      <details open={session.state === 'preview'}><summary>发送给本机模型的内容</summary>
        <p>{session.preview.model || '尚未选择模型'} · {session.preview.endpoint} · 已脱敏 {session.preview.redactions} 处</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{session.preview.content}</pre>
      </details>
      <button className="primary compact" disabled={action.busy || cancellation.busy || session.state !== 'preview'}
        onClick={() => void action.run(signal => perform({ action: 'generate', sessionId: session.id }, signal))}>
        确认发送并生成补丁</button>
      <button className="secondary compact" disabled={cancellation.busy}
        onClick={() => void cancellation.run(async signal => {
          // 单独的取消请求能够终止正在等待的生成或验证。 A separate cancel request can stop pending generation or validation.
          const generation = ++epoch.current; setReviewed(false); setCommand('');
          await request(base, 'POST', { action: 'cancel', sessionId: session.id }, signal);
          signal.throwIfAborted(); if (epoch.current === generation) setSaved(undefined);
        }, '会话已关闭；已接受或结果待核对的文件变更不会撤销')}>关闭会话并重新选择</button>
      {session.state === 'apply-unknown' && <p className="machine-error">文件可能已替换，请在文件工作台核对。关闭会话不会撤销写入。补丁 SHA-256：{session.patchSha256}</p>}
      {session.patch && <>
        <h4>审阅补丁</h4><p>{session.patch.summary}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <div><strong>原文件</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' }}>{session.before}</pre></div>
          <div><strong>修复后</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto' }}>{session.patch.content}</pre></div>
        </div>
        <label>隔离验证命令<input value={command} disabled={action.busy}
          onChange={event => { setCommand(event.target.value); setReviewed(false); }} placeholder="sh -n src/example.sh" /></label>
        <label><input type="checkbox" checked={reviewed} disabled={action.busy}
          onChange={event => setReviewed(event.target.checked)} />我已审阅命令及所选文件，允许在新建的隔离沙箱执行。</label>
        <button className="secondary compact" disabled={action.busy || cancellation.busy || !reviewed || !command || !['review', 'validated', 'failed'].includes(session.state)}
          onClick={() => void action.run(signal => perform({ action: 'validate', input: {
            sessionId: session.id, command, timeoutSeconds: 60,
          } }, signal))}>在隔离沙箱验证</button>
        {session.validation && <div>
          <p>验证结果：{session.validation.passed ? '通过' : '未通过或尚未完成'}；沙箱清理：{session.validation.cleanup}；
            退出码：{session.validation.job?.execution?.exitCode ?? '未知'}</p>
          <p>本次命令：<code>{session.validation.command}</code></p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>{session.validation.job?.log || session.validation.job?.error || '尚无执行日志'}</pre>
        </div>}
        <p className="subtle-note">应用前复核全部所选文件摘要，并遵守文件工作台编辑锁。请先停止会修改这些文件的客户机进程。</p>
        <button className="primary compact" disabled={action.busy || cancellation.busy || session.state !== 'validated' ||
          !session.validation?.passed || session.validation.command !== command || !reviewed}
          onClick={() => void action.run(signal => perform({ action: 'apply', sessionId: session.id }, signal), '已接受验证过的单文件补丁')}>
          接受补丁并更新原文件</button>
      </>}
      {session.error && <p className="machine-error">{session.error}</p>}
    </>}
    <Feedback error={action.error || cancellation.error} message={action.message || cancellation.message} />
  </div>;
}
export const developmentSections = { repair: RepairPanel };
