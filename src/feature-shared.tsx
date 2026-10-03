import { formatDateTime, formatNumber } from './localization';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VMView } from '../shared/contracts/vm.ts';
import type { JobView } from '../shared/contracts/jobs.ts';
import { resourceCache, type ResourceSnapshot } from './resource-cache';
import { jobPresentation } from './job-presentation';
export type Request = <T = any>(
  path: string,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<T>;
export type FeatureProps = {
  vm: VMView;
  request: Request;
  token: string;
  refresh: () => Promise<unknown>;
  projectId?: string;
  onProjectChange?: (projectId: string) => void;
};
export const distroName = (distro?: string, architecture?: string) => {
  const name = ({ alpine: 'Alpine 3.23', debian: 'Debian 12', ubuntu: 'Ubuntu 24.04 LTS' })
    [distro || 'alpine'] || distro;
  return architecture === 'aarch64' ? `${name} ARM64` : name;
};
export const formatBytes = (value: number) =>
  value >= 1024 ** 3 ? `${formatNumber(value / 1024 ** 3, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GiB`
    : `${formatNumber(value / 1024 ** 2, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MiB`;
export function useRemote<T>(request: Request, path: string, enabled = true, interval = 5000) {
  const [state, setState] = useState<{ request: Request; path: string; generation: number; snapshot: ResourceSnapshot<T> }>();
  useEffect(() => {
    if (!enabled) return;
    return resourceCache.watch<T>(request, path, snapshot => setState({ request, path, generation: resourceCache.generation, snapshot }), interval);
  }, [request, path, enabled, interval]);
  const current = enabled && state?.request === request && state.path === path && state.generation === resourceCache.generation ? state.snapshot : undefined;
  return { data: current?.data ?? null, error: current?.error || '',
    reload: useCallback(() => resourceCache.invalidate(request, path), [request, path]) };
}

if (typeof document !== 'undefined') {
  const visibility = () => resourceCache.setVisible(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', visibility);
  visibility();
}
export function useAction() {
  const pending = useRef(false),
    alive = useRef(true),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const run = async (action: (signal: AbortSignal) => Promise<unknown>, success = '') => {
    if (!alive.current || pending.current) return;
    pending.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action(abort.signal);
      if (alive.current) setMessage(success);
    } catch (e) {
      if (alive.current) {
        if ((e as Error).name === 'AbortError') setMessage('操作已取消');
        else setError((e as Error).message);
      }
    } finally {
      pending.current = false;
      if (controller.current === abort) controller.current = null;
      if (alive.current) setBusy(false);
    }
  };
  const clear = () => {
    setError('');
    setMessage('');
  };
  return { busy, error, message, run, clear };
}
export function Feedback({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="machine-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="feature-success">
          {message}
        </p>
      )}
    </>
  );
}
export function JobLog({ job }: { job?: JobView | null }) {
  return job ? (
    <div className="job-block">
      <span
        className={`badge ${job.status === 'running' ? 'starting' : job.status === 'done' ? 'running' : 'error'}`}
      >
        {jobPresentation(job).label}
      </span>
      <Feedback error={job.error} />
      {jobPresentation(job).detail && <p className="subtle-note">{jobPresentation(job).detail}</p>}
      {job.errorCode && <p className="subtle-note"><code>{job.errorCode}</code></p>}
      {job.logPruned && !job.log && (
        <p className="subtle-note">日志已按保留策略清理（{formatDateTime(new Date(job.logPruned.at))}）。</p>
      )}
      {job.log && (
        <pre className="feature-log" aria-label="操作日志">
          {job.log}
        </pre>
      )}
    </div>
  ) : null;
}
export async function download(
  request: Request,
  id: string,
  target: { type: 'file'; path: string } | { type: 'export' },
) {
  const { url } = await request<{ url: string }>(`/vms/${id}/download`, 'POST', target);
  if (!/^\/api\/downloads\/[a-f0-9]{64}$/.test(url)) throw new Error('无效的下载地址');
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.referrerPolicy = 'no-referrer';
  document.body.append(a);
  a.click();
  a.remove();
}
