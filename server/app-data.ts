/** 持久数据独立于版本目录，迁移核对租约与模式，删除须短时计划。 */
import type { PluginMetadata } from './plugin-metadata.ts';
import type { AppTargetsV1 } from './service-contracts/app-runtime.ts';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { appActionSchemas, type AppAction } from '../shared/contracts/app-http.ts';
import { appDatasetSchema, type AppDataset } from '../shared/contracts/app-runtime.ts';
import { AppStore, appNow, appNewId, appView, appRequire } from './app-store.ts';
import { appTarget, appExec, appUserExec, appOwnDirectory } from './app-runtime.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
export class AppData {
  private store: AppStore<AppDataset>;
  private deletes = new Map<string, { appId: string; id: string; expires: number; generation: number }>();
  constructor(
    metadata: PluginMetadata,
    private machines: VmAccess,
    private targets: AppTargetsV1,
    private workspaces: WorkspacesV1,
    authorize: () => Promise<void>,
  ) {
    this.store = new AppStore(metadata, appDatasetSchema, authorize);
  }
  async view(appId?: string) {
    return appView({ datasets: await this.store.read(appId) });
  }
  async act(appId: string, raw: AppAction) {
    const input = appActionSchemas.data.parse(raw),
      t = await appTarget(this.targets, appId);
    if (input.action === 'restore-catalog') {
      if (t.desired !== 'stopped' || t.lease?.id !== input.leaseId)
        throw new AppError('恢复数据目录需要原交接租约', 409);
      for (const d of input.datasets) {
        if (d.appId !== appId || d.path !== t.directory + '/data/' + d.name)
          throw new AppError('恢复目录归属不一致', 409);
        await appExec(this.machines, t, `test -d ${quote(d.path)} && test ! -L ${quote(d.path)}`);
      }
      await this.store.write((rows) => {
        for (let n = rows.length - 1; n >= 0; n--) if (rows[n].appId === appId) rows.splice(n, 1);
        rows.push(...input.datasets);
      });
      return this.view(appId);
    }
    if (input.action === 'create') {
      if (t.lease || t.transition) throw new AppError('应用变更处理中，不能增加数据目录', 409);
      if ((await this.store.read(appId)).some((r) => r.name === input.name))
        throw new AppError('数据目录已登记', 409);
      const path = t.directory + '/data/' + input.name;
      await appExec(
        this.machines,
        t,
        `set -eu\nmkdir -p ${quote(t.directory + '/data')}\ntest ! -e ${quote(path)}\nmkdir -m 700 ${quote(path)}`,
      );
      await appOwnDirectory(this.machines, this.workspaces, t, path);
      const d = appDatasetSchema.parse({
        appId,
        id: appNewId(),
        name: input.name,
        generation: 0,
        schemaVersion: input.schemaVersion,
        path,
        budgetBytes: input.budgetBytes,
        enforcement: 'capacity-preflight',
        retained: true,
        createdAt: appNow(),
      });
      await this.store.write((rows) => {
        rows.push(d);
      });
      return appView({ ...(await this.view(appId)), selectedId: d.id });
    }
    if (input.action === 'migrate') {
      if (!t.lease || t.lease.id !== input.leaseId || Date.parse(t.lease.expiresAt) <= Date.now())
        throw new AppError('迁移租约无效', 409);
      const all = await this.store.read(appId);
      if (all.some((d) => d.schemaVersion !== input.fromSchema)) throw new AppError('数据模式已变化', 409);
      await appUserExec(
        this.machines,
        this.workspaces,
        t,
        `cd ${quote(t.directory)}\n${input.command}`,
        600000,
      );
      await appUserExec(
        this.machines,
        this.workspaces,
        t,
        `cd ${quote(t.directory)}\n${input.verification}`,
        60000,
      );
      await this.store.write((rows) => {
        for (const d of rows.filter((r) => r.appId === appId)) {
          d.generation++;
          d.schemaVersion = input.toSchema;
        }
      });
      return this.view(appId);
    }
    if (input.action === 'inspect') {
      for (const d of await this.store.read(appId)) {
        const out = await appExec(this.machines, t, `du -sk ${quote(d.path)}`);
        const bytes = Number(out.stdout.trim().split(/\s+/)[0]) * 1024;
        if (!Number.isFinite(bytes) || bytes > d.budgetBytes)
          throw new AppError('数据容量超过预检预算：' + d.name, 409);
      }
      return this.view(appId);
    }
    const d = appRequire(
      (await this.store.read(appId)).find((r) => r.id === input.id),
      '数据目录不存在',
    );
    if (input.action === 'plan-delete') {
      const token = appNewId();
      this.deletes.set(token, { appId, id: d.id, generation: d.generation, expires: Date.now() + 300000 });
      return appView({ ...(await this.view(appId)), selectedId: token });
    }
    const plan = this.deletes.get(input.token);
    if (
      !plan ||
      plan.appId !== appId ||
      plan.id !== d.id ||
      plan.generation !== d.generation ||
      plan.expires < Date.now() ||
      t.desired !== 'stopped' ||
      t.lease
    )
      throw new AppError('删除计划过期、数据变化或应用仍在使用数据', 409);
    this.deletes.delete(input.token);
    if (d.path !== t.directory + '/data/' + d.name) throw new AppError('数据目录归属不一致', 409);
    await appExec(
      this.machines,
      t,
      `python3 -I -S -c ${quote('import os,shutil,stat\np=' + JSON.stringify(d.path) + '\ns=os.lstat(p)\nassert stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode)\nshutil.rmtree(p)')}`,
    );
    await this.store.write((rows) => {
      const index = rows.findIndex((r) => r.id === d.id && r.appId === appId);
      if (index >= 0) rows.splice(index, 1);
    });
    return this.view(appId);
  }
}
