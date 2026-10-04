import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as networkServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';

import { NetworkProfiles } from '../../server/network-profiles.ts';
import { HttpIngress } from '../../server/http-ingress.ts';
import { ingressActionSchema } from '../../shared/http-ingress.ts';
import { IngressCertificates } from '../../server/ingress-certificates.ts';
import { certificateActionSchema } from '../../shared/ingress-certificates.ts';
import { LocalAliases } from '../../server/local-aliases.ts';
import { localAliasActionSchema } from '../../shared/local-aliases.ts';

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
    response: pluginRouteResponses["network.ingress-certificate-view"].schema,
    execute() {
      return this.use(networkServices.certificates).view();
    },
  },
  'ingress-certificate-action': {
    request: certificateActionSchema,
    response: pluginRouteResponses["network.ingress-certificate-action"].schema,
    execute(_url, input, signal) {
      return this.capabilities.metadata.run('certificates',
      async () => this.use(networkServices.certificates).action(input));
    },
  },
  'ingress-view': {
    response: pluginRouteResponses["network.ingress-view"].schema,
    execute() {
      return this.use(networkServices.ingress).view();
    },
  },
  'ingress-action': {
    request: ingressActionSchema,
    response: pluginRouteResponses["network.ingress-action"].schema,
    async execute(_url, input) {
      const view = await this.use(networkServices.ingress).action(input);
      await this.use(networkServices.localAliases).refresh();
      return view;
    },
  },
  'local-aliases-view': {
    response: pluginRouteResponses["network.local-aliases-view"].schema,
    execute() {
      return this.use(networkServices.localAliases).view();
    },
  },
  'local-aliases-action': {
    request: localAliasActionSchema,
    response: pluginRouteResponses["network.local-aliases-action"].schema,
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
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
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

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.network-profiles": route,
  "legacy.post.network-profiles": route,
  "legacy.delete.network-profiles": route,
  "legacy.get.vms.vmId.network": route,
  "legacy.post.vms.vmId.network": route,
  "legacy.get.vms.vmId.services": route,
  "legacy.patch.vms.vmId.services": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("network");
