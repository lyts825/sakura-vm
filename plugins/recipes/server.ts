import { services as recipesServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { Recipes } from '../../server/recipes.ts';
export async function activate(host: PluginContext) {
  host.provide(recipesServices.recipes, new Recipes(host.vm, host.workspaces));
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
    return true;
  };
  if (parts[1] === 'recipes' && parts.length === 2 && req.method === 'POST') {
    const { name, recipe } = z
      .object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), recipe: z.unknown() })
      .strict()
      .parse(await body(req));
    send(await this.recipes.create(name, recipe), 201);
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'recipe') {
      if (req.method === 'GET') {
        send(await this.recipes.export(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.recipes.apply(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const { action: kind } = z
          .object({ action: z.enum(['read', 'write']) })
          .strict()
          .parse(await body(req));
        send(await this.recipes[kind](id));
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.post.recipes": route,
  "legacy.get.vms.vmId.recipe": route,
  "legacy.put.vms.vmId.recipe": route,
  "legacy.post.vms.vmId.recipe": route,
};
