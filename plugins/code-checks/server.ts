export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { CodeIntelligence } from '../../server/code-intelligence.ts';
import { LanguageServices } from '../../server/language-services.ts';
import { readJsonBody, MAX_TEXT_REQUEST_BYTES } from '../../server/http.ts';
import { MAX_TEXT_BYTES } from '../../server/files.ts';
import { AppError } from '../../server/model.ts';
export async function activate(host: PluginContext) {
  host.intelligence = new CodeIntelligence(host.machines, host.workspaces);
  host.languageServices = new LanguageServices(host.machines, host.workspaces, host.fileLocks);
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
    if (action === 'language-service') {
      if (req.method === 'GET')
        return send(await this.languageServices.status(id, url.searchParams.get('path') || '', signal));
      if (req.method === 'POST') {
        const value = z.discriminatedUnion('action', [
          z.object({ action: z.literal('install') }).strict(),
          z.object({ action: z.literal('apply'), token: z.uuid(), lockToken: z.uuid().optional() }).strict(),
          z.object({
            action: z.enum(['completion', 'definition', 'diagnostics', 'rename']),
            path: z.string().max(4096), content: z.string().max(MAX_TEXT_BYTES),
            position: z.object({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() }).strict().optional(),
            newName: z.string().max(128).optional(), version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
          }).strict(),
        ]).parse(await readJsonBody(req, MAX_TEXT_REQUEST_BYTES, signal));
        if (value.action === 'install') return send(await this.languageServices.install(id, signal));
        if (value.action === 'apply') {
          if (this.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
          return send(await this.languageServices.apply(id, value.token, value.lockToken));
        }
        return send(await this.languageServices.execute(id, value, signal));
      }
    }
    if (action === 'code-diagnostics' && req.method === 'GET') {
      send(await this.intelligence.diagnose(id, url.searchParams.get('path') || '', signal));
      return true;
    }
  }
  return false;
}
