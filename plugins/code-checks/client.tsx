import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type Variable = { name: string; value: string; type: string; variablesReference: number };
type DebugView = {
  installed: boolean; active: boolean; token?: string;
  state?: 'starting' | 'running' | 'stopped' | 'terminated' | 'error';
  path?: string; directory?: string; reason?: string; error?: string; output?: string;
  breakpoints?: { line: number; verified: boolean; message?: string }[];
  frames?: { id: number; name: string; path: string; line: number; column: number }[];
  variables?: Variable[]; selectedFrame?: number;
};
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
  useEffect(() => setExpanded({}), [view?.state, view?.selectedFrame, view?.frames?.[0]?.line]);
  useEffect(() => {
    if (view?.token) setBreakpoints((view.breakpoints || []).map((item) => item.line).join(', '));
  }, [view?.token]);
  const run = (input: Record<string, unknown>, success: string) => void action.run(async (signal) => {
    await request(`/vms/${vmId}/debugger`, 'POST', input, signal);
    remote.reload();
  }, success);
  const token = view?.token;
  return (
    <div className="feature-card">
      <div className="panel-heading"><h4>Python 调试器</h4>
        <span className="muted">{view?.state || (view?.installed ? '就绪' : '未安装')}</span>
      </div>
      <Feedback error={action.error || remote.error || view?.error} message={action.message} />
      {view?.installed === false && <button className="secondary compact" disabled={action.busy}
        onClick={() => run({ action: 'install' }, '调试器已安装')}>
        安装 Python 调试器
      </button>}
      {view?.installed && !view.active && <>
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
      {view?.active && token && <>
        <p className="muted">正在调试 {view.path}{view.reason ? ` · ${view.reason}` : ''}</p>
        <div className="feature-actions">
          {view.state === 'running' && <button className="secondary compact" disabled={action.busy}
            onClick={() => run({ action: 'pause', token }, '已请求暂停')}>暂停</button>}
          {view.state === 'stopped' && <>
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
        {!!view.breakpoints?.length && <p className="subtle-note">断点：{view.breakpoints.map((item) =>
          `${item.line}${item.verified ? ' ✓' : ` 未确认${item.message ? `（${item.message}）` : ''}`}`).join(' · ')}</p>}
        {view.state === 'stopped' && <div className="feature-grid">
          <div className="feature-card"><h4>调用栈</h4>
            {view.frames?.map((frame) => <button key={frame.id} className="text-button"
              aria-pressed={view.selectedFrame === frame.id}
              onClick={() => {
                run({ action: 'inspect', token, frameId: frame.id }, '已选中栈帧');
                if (view.directory && frame.path.startsWith(`${view.directory}/`))
                  void openPath(frame.path, frame.line);
              }}>
              {frame.name} · {frame.path}:{frame.line}
            </button>)}
          </div>
          <div className="feature-card"><h4>变量</h4>
            {view.variables?.map((item, index) => <div key={`${item.name}:${index}`}>
              {item.variablesReference > 0 ? <button className="text-button" onClick={() =>
                void action.run(async (signal) => {
                  const result = await request<{ variables: Variable[] }>(`/vms/${vmId}/debugger`, 'POST',
                    { action: 'expand', token, reference: item.variablesReference }, signal);
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
      {!!view?.output && <details open={view.state === 'terminated'}><summary>程序输出</summary>
        <pre className="feature-log">{view.output}</pre>
      </details>}
    </div>
  );
}
