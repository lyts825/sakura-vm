import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';

export const services = [] as const;
export async function activate(host: Features) {}
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
    if (action === 'terminal-session' && req.method === 'POST') {
      const { session } = z
        .object({ session: z.string().regex(/^[a-z0-9-]{1,48}$/) })
        .strict()
        .parse(await body(req));
      if (this.machines.state(id) === 'running')
        await this.machines.exec(
          id,
          `if command -v tmux >/dev/null && tmux has-session -t =sakura-terminal-${session} 2>/dev/null; then tmux kill-session -t =sakura-terminal-${session}; fi`,
        );
      send({ ok: true });
      return true;
    }
  }
  return false;
}
