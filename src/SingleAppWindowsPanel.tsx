import { ExternalLink, LoaderCircle, Square, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import type { VMView } from '../server/model';
import { Feedback, useRemote, type Request } from './feature-shared';
import { connectSingleAppPopup, createSingleAppPopup } from './single-app-window';

type AppSession = {
  id: string;
  program: string;
  resolution: string;
  status: 'running' | 'stopped';
  startedAt: string;
};

export function SingleAppWindowsPanel({ vm, token, request }: {
  vm: VMView; token: string; request: Request;
}) {
  const [program, setProgram] = useState('xterm');
  const [args, setArgs] = useState('');
  const [resolution, setResolution] = useState('1024x768');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRemote<{ sessions: AppSession[] }>(request,
    `/vms/${vm.id}/single-app`, vm.status === 'running', 5000);

  const open = async (session: AppSession) => {
    const popup = createSingleAppPopup();
    try {
      await connectSingleAppPopup(popup, vm.id, session, token);
    } catch (cause) {
      popup.close();
      setError((cause as Error).message);
    }
  };

  const start = async () => {
    if (busy) return;
    let popup: Window;
    try { popup = createSingleAppPopup(); }
    catch (cause) { setError((cause as Error).message); return; }
    setBusy(true);
    setError('');
    let session: AppSession | undefined;
    try {
      session = await request<AppSession>(`/vms/${vm.id}/single-app`, 'POST', {
        action: 'start', program: program.trim(),
        args: args.split('\n').map((arg) => arg.trim()).filter(Boolean),
        resolution,
      });
      await connectSingleAppPopup(popup, vm.id, session, token);
    } catch (cause) {
      popup.close();
      if (session) await request(`/vms/${vm.id}/single-app`, 'POST',
        { action: 'stop', id: session.id }).catch(() => {});
      setError((cause as Error).message);
    } finally {
      list.reload();
      setBusy(false);
    }
  };

  const stop = async (session: AppSession) => {
    setBusy(true);
    setError('');
    try {
      await request(`/vms/${vm.id}/single-app`, 'POST', { action: 'stop', id: session.id });
      list.reload();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="desktop-single-app" aria-label="单应用 Linux 窗口">
    <div className="desktop-single-app-head">
      <div>
        <h3><TerminalSquare size={17} /> 单应用窗口</h3>
        <p>在独立浏览器窗口运行 Alpine 图形程序。应用会使用单独的虚拟显示器；每台实例最多四个。</p>
      </div>
      <span>试验功能</span>
    </div>
    <form className="desktop-single-app-form" onSubmit={(event) => {
      event.preventDefault();
      void start();
    }}>
      <label>程序名<input value={program} onChange={(event) => setProgram(event.target.value)}
        pattern="[A-Za-z][A-Za-z0-9+._-]{0,63}" maxLength={64} required
        placeholder="xterm" /></label>
      <label>参数（每行一个）<textarea value={args} onChange={(event) => setArgs(event.target.value)}
        placeholder="可选" rows={2} /></label>
      <label>窗口尺寸<select value={resolution} onChange={(event) => setResolution(event.target.value)}>
        <option value="800x600">800 × 600</option>
        <option value="1024x768">1024 × 768</option>
        <option value="1280x800">1280 × 800</option>
      </select></label>
      <button className="primary compact" type="submit" disabled={busy || vm.status !== 'running'}>
        {busy ? <LoaderCircle size={14} className="spin" /> : <ExternalLink size={14} />}
        启动应用
      </button>
    </form>
    <Feedback error={error || list.error} />
    {!!list.data?.sessions.length && <div className="desktop-single-app-sessions">
      {list.data.sessions.map((session) => <div key={session.id}>
        <span><b>{session.program}</b><small>{session.resolution} · {session.status === 'running' ? '运行中' : '已退出'}</small></span>
        <button className="secondary compact" disabled={session.status !== 'running'}
          onClick={() => void open(session)}><ExternalLink size={13} /> 打开</button>
        <button className="secondary compact" disabled={busy}
          onClick={() => void stop(session)}><Square size={13} /> 停止</button>
      </div>)}
    </div>}
  </section>;
}
