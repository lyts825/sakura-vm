import type { Live } from './vm-state.ts';

export type VmLive = Readonly<Pick<Live, 'status' | 'incoming' | 'accelerator' | 'startedAt' |
  'sshPort' | 'qmpPort' | 'agentPort' | 'serialPort' | 'memoryTargetMiB' | 'error'>> & {
  readonly abort: Readonly<Pick<AbortController, 'signal'>>;
};
const hosts = new WeakMap<object, object>();
const originals = new WeakMap<object, Live>();
const views = new WeakMap<Live, VmLive>();
export function registerVmAccess(port: object, host: object) { hosts.set(port, host); }
export function vmHostIdentity(port: object): object { return hosts.get(port) || port; }
export function vmLiveIdentity(live: Live | VmLive): Live { return originals.get(live) || live as Live; }
export function vmLiveView(live: Live): VmLive {
  const existing = views.get(live); if (existing) return existing;
  const view: any = Object.create(null);
  for (const key of ['status', 'incoming', 'accelerator', 'startedAt', 'sshPort', 'qmpPort',
    'agentPort', 'serialPort', 'memoryTargetMiB', 'error'] as const)
    Object.defineProperty(view, key, { enumerable: true, get: () => live[key] });
  view.abort = Object.freeze({ signal: live.abort?.signal });
  Object.freeze(view); originals.set(view, live); views.set(live, view); return view;
}
export function isVmLiveView(value: object) { return originals.has(value); }
