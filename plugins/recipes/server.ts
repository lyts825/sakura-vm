import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as recipesServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { Recipes } from '../../server/recipes.ts';
export async function activate(host: PluginContext) {
  host.provide(recipesServices.recipes, new Recipes(host.vm, host.use(projectsServices.workspaces)));
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Parameters<PluginRoute>[3],
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] === 'recipes' && parts.length === 2 && req.method === 'POST') {
    const { name, recipe } = httpRouteRequests["recipes.legacy.post.recipes"]
      .parse(await body(req, signal));
    send(await this.use(recipesServices.recipes).create(name, recipe), 201);
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'recipe') {
      const recipes = this.use(recipesServices.recipes);
      if (req.method === 'GET') {
        send(await recipes.export(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await recipes.apply(id, await body(req, signal)));
        return true;
      }
      if (req.method === 'POST') {
        const { action: kind } = httpRouteRequests["recipes.legacy.post.vms.vmId.recipe"]
          .parse(await body(req, signal));
        send(await recipes[kind](id));
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.post.recipes": route,
  "legacy.get.vms.vmId.recipe": route,
  "legacy.put.vms.vmId.recipe": route,
  "legacy.post.vms.vmId.recipe": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("recipes");
