/**
 * 模块职责：“代码与调试工具”插件的DAP 调试连接、断点、调用栈和变量面板，使用宿主传入的实例、项目和请求上下文。
 */
import { useEffect, useState } from 'react';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type DebugView = OperationResponse<'code-checks.legacy.get.vms.vmId.debugger'>;
type VariableResult = Extract<OperationResponse<'code-checks.legacy.post.vms.vmId.debugger'>, { variables: unknown[] }>;
type Variable = VariableResult['variables'][number];
function breakpointLines(text: string) {
  if (!text.trim()) return [];
  const lines = text.split(/[,，\s]+/).map(Number);
  if (lines.length > 100 || lines.some((line) => !Number.isInteger(line) || line < 1 || line > 100000))
    throw new Error('请用逗号或空格填写 1–100000 的断点行号');
  return [...new Set(lines)].sort((a, b) => a - b);
}
export function DebugPanel({ vmId, request, path, dirty, openPath }: {
  vmId: string; request: Request; path: string; dirty: boolean;
  openPath: (path: string, line?: number) => Promise<void>;
}) {
  const remote = useRemote<DebugView>(request, `/vms/${vmId}/debugger`, true, 1000);
  const action = useAction();
  const [breakpoints, setBreakpoints] = useState('');
  const [stopOnEntry, setStopOnEntry] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, Variable[]>>({});
  const view = remote.data;
  const session = view && 'token' in view ? view : null;
  const details = view && 'variables' in view ? view : null;
  useEffect(() => setExpanded({}), [session?.token, session?.state, details?.selectedFrame, details?.frames[0]?.line]);
  useEffect(() => {
    if (details?.token) setBreakpoints(details.breakpoints.map((item) => item.line).join(', '));
  }, [details?.token]);
  const run = (input: Record<string, unknown>, success: string) => void action.run(async (signal) => {
    await request(`/vms/${vmId}/debugger`, 'POST', input, signal);
    remote.reload();
  }, success);
  const token = session?.token;
  const pending = view && 'pending' in view ? view.pending : session?.needsReview && token ? [{ token }] : [];
  return (
    <div className="feature-card">
      <div className="panel-heading"><h4>Python 调试器</h4>
        <span className="muted">{session?.state || (view?.installed ? '就绪' : '未安装')}</span>
      </div>
      <Feedback error={action.error || remote.error || session?.error} message={action.message} />
      {view?.installed === false && <button className="secondary compact" disabled={action.busy}
        onClick={() => run({ action: 'install' }, '调试器已安装')}>
        安装 Python 调试器
      </button>}
      {!!pending.length && <div role="status">
        <p className="subtle-note">上次调试尚未完成清理，请先清理原会话再启动。</p>
        {pending.map((item, index) => <button key={item.token} className="secondary compact" disabled={action.busy}
          onClick={() => run({ action: 'stop', token: item.token }, '原调试会话已清理')}>
          清理上次调试{pending.length > 1 ? ` ${index + 1}` : ''}
        </button>)}
      </div>}
      {view?.installed && !view.active && !pending.length && <>
        <label>断点行号（逗号或空格分隔）
          <input aria-label="断点行号" value={breakpoints} onChange={(event) => setBreakpoints(event.target.value)}
            placeholder="例如 3, 8" />
        </label>
        <label className="checkbox-row"><input type="checkbox" checked={stopOnEntry}
          onChange={(event) => setStopOnEntry(event.target.checked)} />进入第一行时暂停</label>
        <button className="primary compact" disabled={action.busy || dirty}
          onClick={() => {
            try { run({ action: 'start', path, breakpoints: breakpointLines(breakpoints), stopOnEntry }, '调试会话已启动'); }
            catch (error) { void action.run(async () => { throw error; }); }
          }}>
          开始调试
        </button>
        {dirty && <p className="subtle-note">保存当前 Python 文件后可启动调试。</p>}
      </>}
      {view?.active && token && details && <>
        <p className="muted">正在调试 {details.path}{details.reason ? ` · ${details.reason}` : ''}</p>
        <div className="feature-actions">
          {details.state === 'running' && <button className="secondary compact" disabled={action.busy}
            onClick={() => run({ action: 'pause', token }, '已请求暂停')}>暂停</button>}
          {details.state === 'stopped' && <>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => run({ action: 'continue', token }, '继续运行')}>继续</button>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => run({ action: 'next', token }, '单步越过')}>单步越过</button>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => run({ action: 'stepIn', token }, '单步进入')}>单步进入</button>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => run({ action: 'stepOut', token }, '单步跳出')}>单步跳出</button>
          </>}
          <button className="secondary compact" disabled={action.busy}
            onClick={() => run({ action: 'stop', token }, '调试已停止')}>停止调试</button>
        </div>
        <div className="feature-actions">
          <label>断点行号
            <input aria-label="运行中的断点行号" value={breakpoints}
              onChange={(event) => setBreakpoints(event.target.value)} />
          </label>
          <button className="secondary compact" disabled={action.busy}
            onClick={() => {
              try { run({ action: 'breakpoints', token, lines: breakpointLines(breakpoints) }, '断点已更新'); }
              catch (error) { void action.run(async () => { throw error; }); }
            }}>更新断点</button>
        </div>
        {!!details.breakpoints.length && <p className="subtle-note">断点：{details.breakpoints.map((item) =>
          `${item.line}${item.verified ? ' ✓' : ` 未确认${item.message ? `（${item.message}）` : ''}`}`).join(' · ')}</p>}
        {details.state === 'stopped' && <div className="feature-grid">
          <div className="feature-card"><h4>调用栈</h4>
            {details.frames.map((frame) => <button key={frame.id} className="text-button"
              aria-pressed={details.selectedFrame === frame.id}
              onClick={() => {
                run({ action: 'inspect', token, frameId: frame.id }, '已选中栈帧');
                if (details.directory && frame.path.startsWith(`${details.directory}/`))
                  void openPath(frame.path, frame.line);
              }}>
              {frame.name} · {frame.path}:{frame.line}
            </button>)}
          </div>
          <div className="feature-card"><h4>变量</h4>
            {details.variables.map((item, index) => <div key={`${item.name}:${index}`}>
              {item.variablesReference > 0 ? <button className="text-button" onClick={() =>
                void action.run(async (signal) => {
                  const result = await request<VariableResult>(`/vms/${vmId}/debugger`, 'POST',
                    { action: 'expand', token, reference: item.variablesReference }, signal);
                  signal.throwIfAborted();
                  setExpanded((current) => ({ ...current, [item.variablesReference]: result.variables }));
                })}>
                {item.name}: {item.value} ({item.type}) ▸
              </button> : <p>{item.name}: {item.value} ({item.type})</p>}
              {expanded[item.variablesReference]?.map((child, childIndex) => <p key={childIndex} className="muted">
                ↳ {child.name}: {child.value}
              </p>)}
            </div>)}
          </div>
        </div>}
      </>}
      {!!details?.output && <details open={details.state === 'terminated'}><summary>程序输出</summary>
        <pre className="feature-log">{details.output}</pre>
      </details>}
    </div>
  );
}
