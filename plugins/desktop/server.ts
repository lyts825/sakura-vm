export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { retryTarget } from '../../server/plugins/retry.ts';

import { z } from 'zod';
import { AppError } from '../../server/model.ts';

import { Desktops } from '../../server/desktop.ts';
import { Jobs } from '../../server/jobs.ts';
import { imeInstall } from '../../server/desktop-guest.ts';
import { guestTask } from '../../server/guest-task.ts';
import { singleAppInput } from '../../server/single-app-windows.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.desktops = new Desktops(m);
  host.jobs = new Jobs('input-method');
  host.registerJobs(host.jobs, (job) => installIme.call(host, retryTarget(job)));
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
  if (parts[3] === 'desktop' && parts.length === 4) {
    if (req.method === 'GET') return send(await this.desktops.view(id));
    if (req.method === 'POST') {
      const { action, preferences } = z
        .object({
          action: z.enum(['install', 'start', 'configure']),
          preferences: z
            .object({
              resolution: z.enum(['1280x800', '1440x900', '1600x1000', '1920x1080']).optional(),
              monitorLayout: z.enum(['single', 'dual-horizontal', 'dual-vertical']).optional(),
              scale: z.number().int().min(100).max(200).optional(),
              theme: z.enum(['sakura', 'midnight', 'paper', 'lavender']).optional(),
              wallpaper: z.enum(['sakura', 'midnight', 'paper', 'plain']).optional(),
              accent: z
                .string()
                .regex(/^#[0-9a-fA-F]{6}$/)
                .optional(),
              panel: z.enum(['bottom', 'top', 'floating']).optional(),
              autoHidePanel: z.boolean().optional(),
              animations: z.boolean().optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(await body(req));
      return send(this.desktops.start(id, action, preferences), 202);
    }
  }
  if (action === 'single-app' && parts.length === 4) {
    if (req.method === 'GET') return send({ sessions: await this.desktops.apps.list(id) });
    if (req.method === 'POST') {
      const input = z.discriminatedUnion('action', [
        singleAppInput.safeExtend({ action: z.literal('start') }),
        z.object({ action: z.literal('stop'), id: z.uuid() }).strict(),
      ]).parse(await body(req));
      if (input.action === 'start') {
        const { action: _, ...options } = input;
        return send(await this.desktops.apps.start(id, options), 201);
      }
      return send(await this.desktops.apps.stop(id, input.id));
    }
  }
  if (parts.length === 4) {
    if (action === 'ime') {
      if (req.method === 'GET') {
        send(this.jobs.view(id));
        return true;
      }
      if (req.method === 'POST') {
        if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
        send(installIme.call(this, id), 202);
        return true;
      }
    }
  }
  return false;
}
export function installIme(this: PluginContext, id: string) {
  if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
  return this.jobs.start(
    id,
    async (log, signal) => {
      const result = await guestTask(
        this.machines,
        id,
        imeInstall(this.machines.get(id).distro),
        signal,
        log,
      );
      if (result.code !== 0) throw new Error(result.stderr || '输入法安装失败');
    },
    { title: '安装中文输入法', vmId: id, action: 'install' },
  );
}
