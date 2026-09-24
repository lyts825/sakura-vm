import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { GitWorkbench } from '../git-workbench.ts';

export const services = ['git'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.git = new GitWorkbench(m, host.workspaces);
}
export async function route(
  this: Features,
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
    if (action === 'git') {
      if (req.method === 'GET') {
        send(
          url.searchParams.has('path')
            ? await this.git.diff(
                id,
                url.searchParams.get('path')!,
                url.searchParams.get('staged') === '1',
                signal,
              )
            : await this.git.view(id, signal),
        );
        return true;
      }
      if (req.method === 'POST') {
        send(await this.git.run(id, await body(req)), 202);
        return true;
      }
    }
  }
  return false;
}
