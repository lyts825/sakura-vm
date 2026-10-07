/**
 * 模块职责：“发行版镜像”插件服务端入口。激活时装配 Images、DiskImports，并处理声明的服务端操作。
 */
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as imagesServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { Images } from '../../server/images.ts';
import { DiskImports, diskImportSchema } from '../../server/disk-imports.ts';
import { AppError } from '../../shared/errors.ts';

export async function activate(host: PluginContext) {
  host.provide(imagesServices.images, new Images());
  host.provide(imagesServices.diskImports, new DiskImports(host.vm));
  host.registerJobs(host.use(imagesServices.images).jobs, (job) => host.use(imagesServices.images).prepare(job.key!));
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
  if (url.pathname === '/api/image-import' && req.method === 'POST') {
    if (this.activity.importing) throw new AppError('另一个导入仍在进行', 409);
    const input = diskImportSchema.parse({
      name: url.searchParams.get('name'),
      format: url.searchParams.get('format'),
      distro: url.searchParams.get('distro'),
      architecture: url.searchParams.get('architecture') || 'x86_64',
      memoryMiB: Number(url.searchParams.get('memoryMiB')),
      cpus: Number(url.searchParams.get('cpus')),
      accelerator: url.searchParams.get('accelerator') || 'auto',
      firmware: url.searchParams.get('firmware') || 'bios',
      ...(url.searchParams.has('sha256') ? { sha256: url.searchParams.get('sha256') } : {}),
    });
    await this.activity.exclusive('import', async () => {
      send(await this.use(imagesServices.diskImports).import(input, req, signal), 201);
    });
    return true;
  }
  if (parts[1] === 'images') {
    if (parts.length === 2 && req.method === 'GET') {
      send(this.use(imagesServices.images).list());
      return true;
    }
    if (parts.length === 3 && req.method === 'POST') {
      send(this.use(imagesServices.images).prepare(parts[2]), 202);
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.images": route,
  "legacy.post.images.imageId": route,
  "legacy.post.image-import": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("images");
