import { services as networkServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';

import { NetworkProfiles } from '../../server/network-profiles.ts';
import { HttpIngress } from '../../server/http-ingress.ts';
import { ingressActionSchema, ingressViewSchema } from '../../shared/http-ingress.ts';
import { IngressCertificates } from '../../server/ingress-certificates.ts';
import { certificateActionSchema, certificateViewSchema } from '../../shared/ingress-certificates.ts';
import { LocalAliases } from '../../server/local-aliases.ts';
import { localAliasActionSchema, localAliasViewSchema } from '../../shared/local-aliases.ts';

export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(networkServices.network, new NetworkProfiles(m));
  const certificates = host.provide(networkServices.certificates, new IngressCertificates(host.capabilities.metadata.reference('certificates')));
  await host.capabilities.metadata.run('certificates', async () => certificates.init());
  const ingress = host.provide(networkServices.ingress, new HttpIngress(m, host.capabilities.metadata.reference('ingress'), certificates, host.networking));
  await ingress.init();
  await host.provide(networkServices.localAliases, new LocalAliases(() => ingress.aliasNames(),
    undefined, host.capabilities.metadata.reference('local-aliases'))).init();
  host.registerJobs(host.network.jobs, () => {
    throw new AppError('请在网络配置中重新测试当前设置');
  });
}
export const operations: Record<string, PluginOperation> = {
  'ingress-certificate-view': {
    response: certificateViewSchema,
    execute() {
      return this.use(networkServices.certificates).view();
    },
  },
  'ingress-certificate-action': {
    request: certificateActionSchema,
    response: certificateViewSchema,
    execute(_url, input, signal) {
      return this.capabilities.metadata.run('certificates',
      async () => this.use(networkServices.certificates).action(input));
    },
  },
  'ingress-view': {
    response: ingressViewSchema,
    execute() {
      return this.use(networkServices.ingress).view();
    },
  },
  'ingress-action': {
    request: ingressActionSchema,
    response: ingressViewSchema,
    async execute(_url, input) {
      const view = await this.use(networkServices.ingress).action(input);
      await this.use(networkServices.localAliases).refresh();
      return view;
    },
  },
  'local-aliases-view': {
    response: localAliasViewSchema,
    execute() {
      return this.use(networkServices.localAliases).view();
    },
  },
  'local-aliases-action': {
    request: localAliasActionSchema,
    response: localAliasViewSchema,
    execute(_url, input) {
      return this.use(networkServices.localAliases).action(input);
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
  this.vm.get(id);
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
        send(await this.vm.setForwards(id, forwards));
        return true;
      }
      if (req.method === 'GET') {
        let listening = new Set<number>();
        if (this.vm.state(id) === 'running') {
          const result = await this.vm.exec(id, 'cat /proc/net/tcp /proc/net/tcp6', 10000);
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
          forwards: this.vm.get(id).forwards.map((p) => ({ ...p, listening: listening.has(p.guest) })),
          listening: [...listening],
        });
        return true;
      }
    }
  }
  return false;
}
