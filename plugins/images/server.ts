export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { Images } from '../../server/images.ts';
import { DiskImports, diskImportSchema } from '../../server/disk-imports.ts';
import { AppError } from '../../server/model.ts';

export async function activate(host: PluginContext) {
  host.images = new Images();
  host.provide('diskImports', new DiskImports(host.machines));
  host.registerJobs(host.images.jobs, (job) => host.images.prepare(job.key!));
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
  if (url.pathname === '/api/image-import' && req.method === 'POST') {
    if (this.importing) throw new AppError('另一个导入仍在进行', 409);
    const input = diskImportSchema.parse({
      name: url.searchParams.get('name'),
      format: url.searchParams.get('format'),
      distro: url.searchParams.get('distro'),
      memoryMiB: Number(url.searchParams.get('memoryMiB')),
      cpus: Number(url.searchParams.get('cpus')),
      accelerator: url.searchParams.get('accelerator') || 'auto',
      ...(url.searchParams.has('sha256') ? { sha256: url.searchParams.get('sha256') } : {}),
    });
    this.importing = true;
    try {
      send(await this.use<DiskImports>('images', 'diskImports').import(input, req, signal), 201);
    } finally {
      this.importing = false;
    }
    return true;
  }
  if (parts[1] === 'images') {
    if (parts.length === 2 && req.method === 'GET') {
      send(this.images.list());
      return true;
    }
    if (parts.length === 3 && req.method === 'POST') {
      send(this.images.prepare(parts[2]), 202);
      return true;
    }
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  return false;
}
