/** 在宿主生命周期内装配监管与安全关闭，业务插件只取得独立服务契约。
 * Assemble supervision and safe shutdown under the host lifetime; plugins receive only its public contract. */
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { DATA } from './paths.ts';
import { MetadataStore } from './metadata-store.ts';
import { DrillSupervision } from './drill-supervision.ts';
import { CoreDrillMachine } from './core-drill-machine.ts';
import { CoreDrillValidation, launchCoreDrillProcess } from './core-drill-validation.ts';
import { WindowsDrillWatchdogs } from './drill-watchdogs.ts';
import { windowsProcessPin } from './vm-process-pin.ts';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import type { ObservedHostProcess } from './process-supervisor.ts';
import { drillDelegationSchema } from '../shared/contracts/drill-supervision.ts';
import { AppError } from '../shared/errors.ts';

class CoreDrillService extends DrillSupervision {
  constructor(
    private ledger: MetadataStore<unknown>,
    private machinePort: CoreDrillMachine,
    private guards: WindowsDrillWatchdogs,
    private children: Set<ObservedHostProcess>,
  ) {
    super(ledger, machinePort, guards);
  }
  async close() {
    const state = z
      .object({ rows: z.array(z.object({ input: drillDelegationSchema, state: z.string() }).passthrough()) })
      .passthrough()
      .parse((await this.ledger.read()).value);
    for (const row of state.rows.filter((row) => row.state !== 'released' && row.state !== 'delegated')) {
      if (await this.retireUnstartedForShutdown(row.input.runId)) continue;
      let stopped = false;
      try {
        const handle = await this.guards.reconnect(row.input.runId);
        await handle.contain();
        const deadline = Date.now() + 5000;
        while (!(await handle.read()).some((event) => event.kind === 'stopped') && Date.now() < deadline)
          await delay(25);
        stopped = (await handle.read()).some((event) => event.kind === 'stopped');
      } catch (error) {
        if (!(await this.machinePort.confirmStopped(row.input.identity))) throw error;
        stopped = true;
      }
      if (!stopped && !(await this.machinePort.confirmStopped(row.input.identity)))
        throw new AppError('原演练进程关闭未确认，保留监管账本', 503, 'DRILL_CLEANUP_PENDING');
      await this.machinePort.release(row.input.identity, row.input.runId);
    }
    await Promise.all([...this.children].map((child) => child.waitForClose(5000)));
    await this.ledger.flush();
  }
}

/** 装配本体私有端口；创建服务不准备镜像或执行监管校验。
 * Compose private core ports without preparing images or executing validation. */
export async function createCoreDrillService(
  machines: VmAccess,
  workspaces: () => WorkspacesV1,
  directory: PluginDirectory,
) {
  const validation = new CoreDrillValidation(machines),
    machine = new CoreDrillMachine(machines, workspaces, directory, validation);
  const controller = process.platform === 'win32' ? (await windowsProcessPin(process.pid)).created : '0';
  const children = new Set<ObservedHostProcess>();
  const guards = new WindowsDrillWatchdogs(
    join(DATA, 'drill-supervision', 'guards'),
    validation.executable,
    controller,
    async (file, args) => {
      const child = await launchCoreDrillProcess('drill-watchdog', file, args);
      children.add(child);
      void child.closed.then(() => children.delete(child));
    },
    () => validation.view(),
    windowsProcessPin,
  );
  return new CoreDrillService(
    new MetadataStore<unknown>(join(DATA, 'drill-supervision', 'ledger.json'), {
      fallback: () => ({ version: 1, rows: [] }),
    }),
    machine,
    guards,
    children,
  );
}
