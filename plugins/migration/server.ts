import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as migrationServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { AppError } from '../../shared/errors.ts';

import { DataMigration } from '../../server/data-migration.ts';

export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(migrationServices.migration, new DataMigration(m, () =>
    host.jobSources(),
  ));
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage, signal?: AbortSignal) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] === 'migration' && parts.length === 2) {
    if (req.method === 'GET') {
      send(await this.use(migrationServices.migration).view());
      return true;
    }
    if (req.method === 'POST') {
      const input = httpRouteRequests["migration.legacy.post.migration"]
        .parse(await body(req, signal));
      if (input.action === 'cancel-activation') send(await this.use(migrationServices.migration).cancelActivation());
      else if (input.action === 'preview') {
        const { files: _files, ...plan } = await this.use(migrationServices.migration).plan(input.target || '');
        send(plan);
      } else {
        if (this.activity.mutations || this.activity.importing) throw new AppError('请等待正在执行的请求完成', 409);
        send(await this.use(migrationServices.migration).start(input.target || '', input.token || ''), 202);
      }
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.migration": route,
  "legacy.post.migration": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("migration");
