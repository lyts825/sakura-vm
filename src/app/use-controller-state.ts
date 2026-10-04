import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { System } from '../../shared/contracts/controller.ts';
import type { VMView } from '../../shared/contracts/vm.ts';
import { api, controllerSession, RefreshQueue } from '../controller-session';
import { watchController } from '../controller-watch';
import { ResponseOrder } from '../request-order';
import { pluginGeneration } from '../plugin-generation';

export function useControllerState(setSelectedRaw: Dispatch<SetStateAction<string>>) {
  const [vms, setVms] = useState<VMView[]>([]),
    [system, setSystem] = useState<System | null>(null);
  const [loading, setLoading] = useState(true),
    [offline, setOffline] = useState('');
  const refreshOrder = useRef(new ResponseOrder());
  const refreshQueue = useRef(new RefreshQueue());
  const refreshAbort = useRef(new AbortController());
  const watcher = useRef<ReturnType<typeof watchController> | null>(null);
  const refresh = useCallback(
    () =>
      refreshQueue.current.run(async () => {
        const version = refreshOrder.current.start();
        const signal = AbortSignal.any([refreshAbort.current.signal, AbortSignal.timeout(15000)]);
        try {
          const [data, sys] = await Promise.all([
            api<VMView[]>('/vms', 'GET', undefined, signal),
            api<System>('/system', 'GET', undefined, signal),
          ]);
          if (!refreshOrder.current.accept(version)) return;
          setVms(data);
          pluginGeneration.update(sys.pluginRuntime);
          setSystem(sys);
          if (sys.session) controllerSession.updateSession(sys.session);
          setOffline('');
          setSelectedRaw((current) => (data.some((v) => v.id === current) ? current : data[0]?.id || ''));
        } catch (error) {
          if (refreshOrder.current.accept(version)) throw error;
        }
      }),
    [setSelectedRaw],
  );
  useEffect(() => {
    refreshAbort.current = new AbortController();
    const connection = watchController({
      session: controllerSession,
      refresh,
      error: setOffline,
      settled: () => setLoading(false),
      document,
      window,
      socket: (credential) =>
        new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events?token=${encodeURIComponent(credential)}`,
        ),
    });
    watcher.current = connection;
    return () => {
      connection.close();
      watcher.current = null;
      refreshOrder.current.invalidate();
      refreshAbort.current.abort();
    };
  }, [refresh]);
  const invalidate = useCallback(() => refreshOrder.current.invalidate(), []);
  const upsertVm = useCallback((vm: VMView) => {
    refreshOrder.current.invalidate();
    setVms((current) => [...current.filter((entry) => entry.id !== vm.id), vm]);
  }, []);
  const reconnect = useCallback(() => watcher.current?.reconnect(), []);
  return { vms, system, loading, offline, refresh, invalidate, upsertVm, reconnect };
}
