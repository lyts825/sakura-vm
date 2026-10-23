/** 配置修订只保存非敏感值及强私密引用版本，执行时再次原子核对。 */
import type { PluginMetadata } from './plugin-metadata.ts';
import type { AppTargetsV1 } from './service-contracts/app-runtime.ts';
import type { SecretsV1 } from './service-contracts/v1.ts';
import { appActionSchemas, type AppAction } from '../shared/contracts/app-http.ts';
import { appConfigSchema, type AppConfig } from '../shared/contracts/app-runtime.ts';
import { AppStore, appHash, appNow, appNewId, appView, appRequire } from './app-store.ts';
import { appTarget } from './app-runtime.ts';
import { AppError } from '../shared/errors.ts';
export class AppConfigService {
  private store: AppStore<AppConfig>;
  constructor(
    metadata: PluginMetadata,
    private targets: AppTargetsV1,
    private secrets: SecretsV1,
    authorize: () => Promise<void>,
  ) {
    this.store = new AppStore(metadata, appConfigSchema, authorize);
  }
  async view(appId?: string) {
    return appView({ configs: await this.store.read(appId) });
  }
  async act(appId: string, raw: AppAction) {
    const input = appActionSchemas.config.parse(raw);
    if (input.action === 'verify') {
      await this.resolve(appId, input.id);
      return this.view(appId);
    }
    const t = await appTarget(this.targets, appId);
    if (Object.keys(input.values).some((k) => k in input.secretRefs))
      throw new AppError('公开配置和私密引用名称重复', 400);
    const refs = await this.secrets.references(t.vmId, input.secretRefs),
      versions = Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.version]));
    const item = appConfigSchema.parse({
      appId,
      id: appNewId(),
      revision: input.expectedRevision + 1,
      values: input.values,
      secretRefs: input.secretRefs,
      secretVersions: versions,
      digest: appHash([input.values, input.secretRefs, versions]),
      createdAt: appNow(),
    });
    await this.store.write((rows) => {
      const revision = Math.max(0, ...rows.filter((r) => r.appId === appId).map((r) => r.revision));
      if (revision !== input.expectedRevision) throw new AppError('配置已被修改，请刷新', 409);
      rows.push(item);
    });
    return appView({ ...(await this.view(appId)), selectedId: item.id });
  }
  async resolve(appId: string, id: string) {
    const c = appRequire(
        (await this.store.read(appId)).find((r) => r.id === id),
        '配置修订不存在',
      ),
      t = await appTarget(this.targets, appId);
    return { ...c.values, ...(await this.secrets.resolveVersioned(t.vmId, c.secretRefs, c.secretVersions)) };
  }
}
