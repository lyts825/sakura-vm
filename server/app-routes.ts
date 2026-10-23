/** 应用独立入口通过预期修订切换，进程身份变化后拒绝继续代理。 */
import type { PluginMetadata } from './plugin-metadata.ts';
import type { AppTargetsV1, AppObserveV1 } from './service-contracts/app-runtime.ts';
import type { VmAccess } from './vm-access.ts';
import { appActionSchemas, type AppAction } from '../shared/contracts/app-http.ts';
import { appRouteSchema, type AppRoute } from '../shared/contracts/app-runtime.ts';
import { AppStore, appNow, appNewId, appView, appRequire } from './app-store.ts';
import { appTarget, appCheck } from './app-runtime.ts';
import { AppIngress } from './app-ingress.ts';
import { AppError } from '../shared/errors.ts';
export class AppRoutes {
  private store: AppStore<AppRoute>;
  private live = new Map<string, AppIngress>();
  private tail = Promise.resolve();
  constructor(
    metadata: PluginMetadata,
    private machines: VmAccess,
    private targets: AppTargetsV1,
    private observe: AppObserveV1,
    private authorize: () => Promise<void>,
  ) {
    this.store = new AppStore(metadata, appRouteSchema, authorize);
  }
  async init() {
    await this.store.write((rows) => {
      for (const r of rows) if (r.state === 'open') r.state = 'unknown';
    });
  }
  async view(appId?: string) {
    return appView({ routes: await this.store.read(appId) });
  }
  async act(appId: string, raw: AppAction) {
    const input = appActionSchemas.routes.parse(raw);
    const work = this.tail.then(async () => {
      const rows = await this.store.read(appId),
        old = rows.at(-1);
      if (input.action === 'reconcile') {
        if (old?.state === 'unknown')
          await this.store.write((all) => {
            all.find((r) => r.id === old.id)!.state = 'closed';
          });
        return this.view(appId);
      }
      if ((old?.revision || 0) !== input.expectedRevision) throw new AppError('入口修订已变化', 409);
      if (input.action === 'close' || input.action === 'drain') {
        if (input.action === 'drain') this.live.get(appId)?.pause();
        else {
          await this.live.get(appId)?.close();
          this.live.delete(appId);
        }
        if (old)
          await this.store.write((all) => {
            const r = all.find((r) => r.id === old.id)!;
            r.state = 'closed';
            r.revision++;
          });
        return this.view(appId);
      }
      const t = await appTarget(this.targets, appId);
      await appCheck(this.machines, t);
      if (t.lease?.id !== input.leaseId || Date.parse(t.lease.expiresAt) <= Date.now())
        throw new AppError('入口切换租约失效', 409);
      const evidence = (await this.observe.view(appId)).observations
        .filter((o) => o.installationId === input.installationId && o.bootId === t.bootId)
        .at(-1);
      if (!evidence || evidence.status !== 'healthy' || Date.now() - Date.parse(evidence.checkedAt) > 30000)
        throw new AppError('新版本缺少有效健康证据', 409);
      const live = this.machines.live.get(t.vmId),
        check = () => {
          if (
            this.machines.get(t.vmId).createdAt !== t.vmCreatedAt ||
            this.machines.live.get(t.vmId) !== live
          )
            throw new AppError('入口原目标身份失效', 409);
        },
        next = new AppIngress(this.machines, t, input.port, check, this.authorize);
      const prior = this.live.get(appId);
      try {
        if (!(await next.health(input.healthPath))) throw new AppError('入口实际探测失败', 409);
        const url =
          prior && old ? old.url : await next.open(appId, old?.url ? Number(new URL(old.url).port) : 0);
        const row: AppRoute = {
          appId,
          id: appNewId(),
          revision: input.expectedRevision + 1,
          installationId: input.installationId,
          url,
          port: input.port,
          state: 'open',
          bootId: t.bootId,
          createdAt: appNow(),
        };
        await this.store.write((all) => {
          const current = all.filter((r) => r.appId === appId).at(-1);
          if ((current?.revision || 0) !== input.expectedRevision)
            throw new AppError('入口并发修订冲突', 409);
          all.push(row);
        });
        if (prior) {
          prior.retarget(t, input.port, check);
          await next.close();
        } else this.live.set(appId, next);
        if (old)
          await this.store.write((all) => {
            appRequire(
              all.find((r) => r.id === old.id),
              '入口记录缺失',
            ).state = 'closed';
          });
        return this.view(appId);
      } catch (error) {
        await next.close();
        throw error;
      }
    });
    this.tail = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  async close() {
    await Promise.allSettled([...this.live.values()].map((p) => p.close()));
    this.live.clear();
    await this.store.write((rows) => {
      for (const r of rows) if (r.state === 'open') r.state = 'closed';
    });
  }
}
