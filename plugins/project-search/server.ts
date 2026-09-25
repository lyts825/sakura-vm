export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { ProjectFiles } from '../../server/project-files.ts';
export async function activate(host: PluginContext) {
  host.projectFiles = new ProjectFiles(host.machines, host.workspaces);
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

  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4) {
    if (action === 'project-files' && req.method === 'GET') {
      send(
        await this.projectFiles.scan(
          id,
          url.searchParams.get('q') || '',
          url.searchParams.get('content') === '1',
          signal,
        ),
      );
      return true;
    }
  }
  return false;
}
