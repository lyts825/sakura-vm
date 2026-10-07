/**
 * 模块职责：“沙箱工作台”插件服务端入口。激活时装配 Sandboxes，并处理声明的服务端操作。
 */
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { services as sandboxServices } from './services.ts';
export { manifest } from './manifest.ts';
import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';
import { Sandboxes, sandboxCreateSchema, sandboxRunSchema } from '../../server/sandboxes.ts';


export async function activate(host: PluginContext) {
  const service = host.provide(sandboxServices.sandboxes, new Sandboxes(host.vm));
  await service.init();
  host.registerJobs(service.jobs, () => {
    throw new AppError('请在沙箱工作台检查命令后重新执行');
  });
}




const idFrom = (url: URL) => url.pathname.split('/')[3];
const service = (host: PluginContext) => host.use(sandboxServices.sandboxes);

export const operations: Record<string, PluginOperation> = {
  artifact: {
    response: pluginRouteResponses["sandbox.artifact"].schema,
    execute(url) {
      return service(this).artifact(
        z.uuid().parse(url.searchParams.get('run')),
        z.uuid().parse(url.searchParams.get('artifact')),
      );
    },
  },
  list: {
    response: pluginRouteResponses["sandbox.list"].schema,
    execute() {
      return service(this).list();
    },
  },
  create: {
    request: sandboxCreateSchema,
    response: pluginRouteResponses["sandbox.create"].schema,
    execute(_url, input) {
      return service(this).create(input);
    },
  },
  inspect: {
    response: pluginRouteResponses["sandbox.inspect"].schema,
    execute(url) {
      return service(this).view(idFrom(url));
    },
  },
  control: {
    request: z.object({ action: z.enum(['start', 'stop']) }).strict(),
    response: pluginRouteResponses["sandbox.control"].schema,
    execute(url, input) {
      return service(this).control(idFrom(url), (input as { action: 'start' | 'stop' }).action);
    },
  },
  destroy: {
    response: pluginRouteResponses["sandbox.destroy"].schema,
    execute(url) {
      return service(this).control(idFrom(url), 'destroy');
    },
  },
  run: {
    request: sandboxRunSchema,
    response: pluginRouteResponses["sandbox.run"].schema,
    execute(url, input) {
      return service(this).run(idFrom(url), input);
    },
  },
};
export async function route() {
  return false;
}

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("sandbox");
