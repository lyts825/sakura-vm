import { ExternalLink, LoaderCircle, Square, TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VMView } from '../server/model';
import { Feedback, useRemote, type Request } from './feature-shared';
import { connectSingleAppPopup, createSingleAppPopup } from './single-app-window';

type AppSession = {
  id: string;
  program: string;
  resolution: string;
  password: string;
  networkIsolation: 'host' | 'private';
  dataDirectory: string;
  clipboard?: { copy: boolean; paste: boolean };
  status: 'running' | 'stopped' | 'relaunch-required';
  startedAt: string;
};

export function SingleAppWindowsPanel({ vm, token, request }: {
  vm: VMView; token: string; request: Request;
}) {
  const [program, setProgram] = useState('xterm');
  const [args, setArgs] = useState('');
  const [resolution, setResolution] = useState('1024x768');
  const [allowCopy, setAllowCopy] = useState(true);
  const [allowPaste, setAllowPaste] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRemote<{ sessions: AppSession[];
    clipboardPolicies: Record<string, { copy: boolean; paste: boolean }> }>(request,
    `/vms/${vm.id}/single-app`, vm.status === 'running', 5000);
  const rules = list.data?.clipboardPolicies;
  const savedPolicy = rules && Object.hasOwn(rules, program.trim())
    ? rules[program.trim()] : undefined;
  const unsavedRelaxation = !!savedPolicy &&
    ((!savedPolicy.copy && allowCopy) || (!savedPolicy.paste && allowPaste));
  useEffect(() => {
    setAllowCopy(savedPolicy?.copy ?? true);
    setAllowPaste(savedPolicy?.paste ?? true);
  }, [program, savedPolicy?.copy, savedPolicy?.paste]);

  const updatePolicy = async (remove: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await request(`/vms/${vm.id}/single-app`, 'POST', remove
        ? { action: 'clipboard-remove', program: program.trim() }
        : { action: 'clipboard-save', program: program.trim(),
          clipboard: { copy: allowCopy, paste: allowPaste } });
      list.reload();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

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
    if (unsavedRelaxation) {
      setError('放宽此程序的剪贴板权限前，请先保存新规则');
      return;
    }
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
        resolution, clipboard: { copy: allowCopy, paste: allowPaste },
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
        <p>在当前项目中运行 Linux 图形程序，沿用项目网络设置。每个窗口独立保存应用数据；每台实例最多四个。</p>
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
      <label className="single-app-clipboard-toggle"><input type="checkbox" checked={allowCopy}
        onChange={(event) => setAllowCopy(event.target.checked)} />允许复制到宿主</label>
      <label className="single-app-clipboard-toggle"><input type="checkbox" checked={allowPaste}
        onChange={(event) => setAllowPaste(event.target.checked)} />允许粘贴到应用</label>
      <button className="secondary compact" type="button" disabled={busy || !program.trim()}
        onClick={() => void updatePolicy(false)}>保存此程序规则</button>
      {savedPolicy && <button className="text-button" type="button" disabled={busy}
        onClick={() => void updatePolicy(true)}>移除程序规则</button>}
      {savedPolicy && <small>收紧规则会断开仍具旧权限的窗口，需停止并重开；放宽权限只适用于后续窗口。
        </small>}
      <button className="primary compact" type="submit"
        disabled={busy || vm.status !== 'running' || unsavedRelaxation}>
        {busy ? <LoaderCircle size={14} className="spin" /> : <ExternalLink size={14} />}
        启动应用
      </button>
    </form>
    <Feedback error={error || list.error} />
    {!!list.data?.sessions.length && <div className="desktop-single-app-sessions">
      {list.data.sessions.map((session) => <div key={session.id}>
        <span><b>{session.program}</b><small>{session.resolution} · {session.status === 'running' ? '运行中'
          : session.status === 'relaunch-required' ? '规则已收紧，需停止并重开' : '已退出'} ·
          复制{session.clipboard?.copy === false ? '关闭' : '开启'} ·
          粘贴{session.clipboard?.paste === false ? '关闭' : '开启'}</small>
        <small>{session.networkIsolation === 'private' ? '私有网络' : '共享网络'} ·
          数据目录 {session.dataDirectory}</small></span>
        <button className="secondary compact" disabled={session.status !== 'running'}
          onClick={() => void open(session)}><ExternalLink size={13} /> 打开</button>
        <button className="secondary compact" disabled={busy}
          onClick={() => void stop(session)}><Square size={13} /> 停止</button>
      </div>)}
    </div>}
  </section>;
}
