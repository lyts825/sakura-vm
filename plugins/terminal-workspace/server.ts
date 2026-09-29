export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { ProjectCatalog } from '../../server/project-catalog.ts';
import { stopTerminalsScript } from '../../server/project-terminals.ts';
import { AppError } from '../../server/model.ts';

export async function activate(host: PluginContext) {}
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
    if (action === 'terminal-session' && req.method === 'POST') {
      const input = z.union([
        z.object({ session: z.string().regex(/^[a-z0-9-]{1,48}$/) }).strict(),
        z.object({ action: z.literal('stop-all') }).strict(),
      ])
        .parse(await body(req));
      const projects = this.workspaces?.projects || new ProjectCatalog(this.machines);
      const projectId = await projects.with(id, url.searchParams.get('project'),
        async () => projects.current(id));
      await this.machines.locked(id, async () => {
        if (this.machines.state(id) === 'paused')
          throw new AppError('请先恢复实例再停止项目终端', 409);
        if (this.machines.state(id) === 'running') {
          const result = await this.machines.exec(id, stopTerminalsScript(projectId,
            'session' in input ? input.session : undefined), 10000, signal);
          if (result.code !== 0) throw new AppError(result.stderr || '无法停止项目终端', 409);
        }
      });
      send({ ok: true, projectId });
      return true;
    }
  }
  return false;
}
