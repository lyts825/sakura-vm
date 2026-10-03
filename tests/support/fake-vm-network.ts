import type { NetworkRuntime, VmNetworkLease } from '../../server/network/index.ts';

/** Unit fixtures run fake VM engines and must not start a real QEMU networking process. */
export const fakeVmNetwork: Pick<NetworkRuntime, 'attachVm'> = {
  async attachVm(options) {
    const abort = new AbortController();
    let connected = true;
    const lease: VmNetworkLease = {
      vmId: options.vmId, generation: options.generation,
      netdev: 'stream,id=sakura-net,server=off,addr.type=inet,addr.host=127.0.0.1,addr.port=1',
      signal: abort.signal,
      get connected() { return connected; },
      async setConnected(value) { abort.signal.throwIfAborted(); connected = value; },
      policy: { isolated: options.isolated, ipv6: !options.isolated && options.ipv6 !== false,
        forwards: [{ host: options.sshPort, guest: 22 }, ...options.forwards] },
      async forward() { abort.signal.throwIfAborted(); },
      async renew(generation) {
        abort.abort();
        const next = await fakeVmNetwork.attachVm({ ...options, generation });
        await next.setConnected(connected);
        return next;
      },
      async close() { abort.abort(); },
    };
    return lease;
  },
};
