/** 工作台聚合各独立领域服务，不保存另一份业务状态。 */
import type { AppDomainV1 } from './service-contracts/app-runtime.ts';
import type { AppAction } from '../shared/contracts/app-http.ts';
import { appActionSchemas } from '../shared/contracts/app-http.ts';
import { appView } from './app-store.ts';
import type { AppView } from '../shared/contracts/app-runtime.ts';
export class AppWorkbench {
  constructor(private domains: AppDomainV1[]) {}
  async view(appId?: string) {
    const views = await Promise.all(this.domains.map((d) => d.view(appId)));
    const result = appView({});
    for (const view of views)
      for (const key of Object.keys(result) as (keyof AppView)[]) {
        if (key === 'selectedId') continue;
        const value = view[key];
        if (Array.isArray(value)) (result[key] as unknown[]).push(...value);
      }
    return result;
  }
  async act(appId: string, input: AppAction) {
    appActionSchemas.workbench.parse(input);
    return this.view(appId);
  }
}
