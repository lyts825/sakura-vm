/** 应用观测保留实际退出、HTTP 响应与启动身份；不把无证据当健康。 */
import type { PluginMetadata } from './plugin-metadata.ts';
import type { AppTargetsV1 } from './service-contracts/app-runtime.ts';
import type { WorkspacesV1, ServiceHealthV1 } from './service-contracts/v1.ts';
import type { VmAccess } from './vm-access.ts';
import { appActionSchemas, type AppAction } from '../shared/contracts/app-http.ts';
import { appObservationSchema, type AppObservation } from '../shared/contracts/app-runtime.ts';
import { AppStore, appNow, appNewId, appView } from './app-store.ts';
import { appTarget, appCheck, appUserExec } from './app-runtime.ts';
import { AppIngress } from './app-ingress.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
export class AppObserve {
  private store: AppStore<AppObservation>;
  private schedule?: ScheduleHandle;
  constructor(
    metadata: PluginMetadata,
    private machines: VmAccess,
    private targets: AppTargetsV1,
    private workspaces: WorkspacesV1,
    private health: ServiceHealthV1,
    private authorize: () => Promise<void>,
  ) {
    this.store = new AppStore(metadata, appObservationSchema, authorize);
  }
  async view(appId?: string) {
    return appView({ observations: await this.store.read(appId) });
  }
  init() {
    this.schedule = scheduler.register({
      owner: 'plugin:app-observe',
      label: '应用持续健康采样',
      intervalMs: 30000,
      overlap: 'skip',
      catchUp: 'once',
      run: async ({ signal }) => {
        for (const t of (await this.targets.view()).targets) {
          signal.throwIfAborted();
          if (t.desired !== 'running' || t.lease || t.transition) continue;
          const row = (await this.store.read(t.appId)).filter((o) => o.probe && o.installationId).at(-1);
          if (!row?.probe || !row.installationId) continue;
          try {
            await this.act(t.appId, { action: 'probe', installationId: row.installationId, ...row.probe });
          } catch (error) {
            await this.store.write((rows) => {
              rows.push({
                ...row,
                id: appNewId(),
                status: 'unknown',
                checkedAt: appNow(),
                detail: '持续采样无法核验目标：' + (error as Error).message.slice(0, 1000),
              });
              while (rows.filter((r) => r.appId === t.appId).length > 500)
                rows.splice(
                  rows.findIndex((r) => r.appId === t.appId),
                  1,
                );
            });
          }
        }
      },
    });
  }
  async close() {
    await this.schedule?.close();
  }
  async act(appId: string, raw: AppAction) {
    const input = appActionSchemas.observe.parse(raw),
      t = await appTarget(this.targets, appId);
    await this.authorize();
    await appCheck(this.machines, t);
    if (input.action === 'logs') {
      const runtime = await this.workspaces.projects.with(t.vmId, t.projectId, () =>
        this.workspaces.runtime(t.vmId),
      );
      return appView({
        observations: [
          {
            appId,
            id: appNewId(),
            installationId: null,
            bootId: t.bootId,
            status: 'unknown',
            checkedAt: appNow(),
            detail: runtime.log.slice(-32768),
            exitCode: null,
          },
        ],
      });
    }
    if (input.action === 'acknowledge') {
      await this.store.write((rows) => {
        rows.push({
          appId,
          id: appNewId(),
          installationId: null,
          bootId: t.bootId,
          status: 'unknown',
          checkedAt: appNow(),
          detail: '人工记录：' + input.message,
          exitCode: null,
        });
      });
      return this.view(appId);
    }
    const row: AppObservation = {
      appId,
      id: appNewId(),
      installationId: input.installationId,
      bootId: t.bootId,
      status: 'unhealthy',
      checkedAt: appNow(),
      detail: '',
      exitCode: null,
      probe: { command: input.command, healthPath: input.healthPath, port: input.port },
    };
    try {
      if (input.command) {
        const r = await appUserExec(this.machines, this.workspaces, t, input.command, 30000);
        row.exitCode = r.code;
        row.status = 'healthy';
        row.detail = '命令探针退出码 ' + r.code;
      } else {
        const live = this.machines.live.get(t.vmId),
          proxy = new AppIngress(
            this.machines,
            t,
            input.port,
            () => {
              if (this.machines.live.get(t.vmId) !== live) throw new Error('启动身份变化');
            },
            this.authorize,
          );
        try {
          row.status = (await proxy.health(input.healthPath)) ? 'healthy' : 'unhealthy';
          row.detail = '实际 HTTP 探针：' + input.healthPath;
        } finally {
          await proxy.close();
        }
      }
      await this.health.view(t.vmId);
    } catch (error) {
      row.detail = (error as Error).message.slice(0, 32768);
    }
    row.checkedAt = appNow();
    await this.store.write((rows) => {
      rows.push(row);
      while (rows.filter((r) => r.appId === appId).length > 500) {
        const n = rows.findIndex((r) => r.appId === appId);
        rows.splice(n, 1);
      }
    });
    return appView({ ...(await this.view(appId)), selectedId: row.id });
  }
}
