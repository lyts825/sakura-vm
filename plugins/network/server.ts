export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../server/model.ts';

import { NetworkProfiles } from '../../server/network-profiles.ts';
import { HttpIngress } from '../../server/http-ingress.ts';
import { ingressActionSchema, ingressViewSchema } from '../../shared/http-ingress.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.network = new NetworkProfiles(m);
  await host.provide('ingress', new HttpIngress(m, host.dataFile('ingress'))).init();
  host.registerJobs(host.network.jobs, () => {
    throw new AppError('请在网络配置中重新测试当前设置');
  });
}
export const operations: Record<string, PluginOperation> = {
  'ingress-view': {
    response: ingressViewSchema,
    execute() {
      return this.use<HttpIngress>('network', 'ingress').view();
    },
  },
  'ingress-action': {
    request: ingressActionSchema,
    response: ingressViewSchema,
    execute(_url, input) {
      return this.use<HttpIngress>('network', 'ingress').action(input);
    },
  },
};
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
  if (parts[1] === 'network-profiles') {
    if (parts.length === 2 && req.method === 'GET') return send(await this.network.profiles());
    if (parts.length === 2 && req.method === 'POST')
      return send(await this.network.saveProfile(await body(req)));
    if (parts.length === 2 && req.method === 'DELETE') {
      const { id } = z
        .object({ id: z.uuid() })
        .strict()
        .parse(await body(req));
      return send(await this.network.removeProfile(id));
    }
    return false;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4) {
    if (action === 'network') {
      if (req.method === 'GET') {
        send({ ...(await this.network.state(id)), job: this.network.jobs.view(id) });
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['preview', 'apply', 'restore', 'test']),
            config: z.unknown().optional(),
            token: z.string().optional(),
          })
          .strict()
          .parse(await body(req));
        send(
          input.action === 'preview'
            ? await this.network.preview(id, input.config, signal)
            : input.action === 'apply'
              ? await this.network.apply(id, input.config, input.token || '')
              : input.action === 'restore'
                ? await this.network.restore(id)
                : this.network.test(id, input.config),
        );
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'services') {
      if (req.method === 'PATCH') {
        const { forwards } = z
          .object({ forwards: z.unknown() })
          .strict()
          .parse(await body(req));
        send(await this.machines.setForwards(id, forwards));
        return true;
      }
      if (req.method === 'GET') {
        let listening = new Set<number>();
        if (this.machines.state(id) === 'running') {
          const result = await this.machines.exec(id, 'cat /proc/net/tcp /proc/net/tcp6', 10000);
          if (result.code !== 0) throw new AppError('无法读取客户机监听端口');
          listening = new Set(
            result.stdout
              .split('\n')
              .map((line) => line.trim().split(/\s+/))
              .filter((columns) => columns[3] === '0A')
              .map((columns) => parseInt(columns[1].split(':').at(-1)!, 16)),
          );
        }
        send({
          forwards: this.machines.get(id).forwards.map((p) => ({ ...p, listening: listening.has(p.guest) })),
          listening: [...listening],
        });
        return true;
      }
    }
  }
  return false;
}
