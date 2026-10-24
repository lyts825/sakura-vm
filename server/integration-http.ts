/** 领域 HTTP 适配；只分派当前插件已声明的方法。 HTTP dispatch is confined to one declared domain service. */
import type { PluginRoute } from './plugin-api.ts';
import { sendJson } from './http-response.ts';
import { ilScope } from '../shared/contracts/integration-lab.ts';
import {
  integrationQuerySchema,
  integrationRequestSchemas,
  integrationResponseSchemas,
  type IntegrationDomain,
} from '../shared/contracts/integration-http.ts';
import { ilFail } from './integration-store.ts';
import type * as Ports from './service-contracts/integration-lab.ts';
type Service =
  | Ports.IntegrationSpecsV1
  | Ports.IntegrationEnvironmentsV1
  | Ports.IntegrationFixturesV1
  | Ports.IntegrationMocksV1
  | Ports.IntegrationScenariosV1
  | Ports.IntegrationAssertionsV1
  | Ports.IntegrationRunnersV1
  | Ports.IntegrationLoadV1
  | Ports.IntegrationReportsV1
  | Ports.IntegrationExchangeV1
  | Ports.IntegrationWorkbenchV1;
export function integrationRoute(
  domain: IntegrationDomain,
  resolve: (host: ThisParameterType<PluginRoute>) => Service,
): PluginRoute {
  return async function (req, res, url, body, signal) {
    if (url.pathname !== '/api/integration-' + domain) return false;
    const query = integrationQuerySchema.parse(Object.fromEntries(url.searchParams));
    const scope = () => ilScope.parse(query);
    const service = resolve(this);
    let result: unknown;
    if (req.method === 'GET') {
      if (domain === 'specs') {
        const port = service as Ports.IntegrationSpecsV1;
        result = {
          workspaces: await port.workspaces(),
          definitions: query.workspaceId ? await port.list(scope()) : [],
          comparisons: query.workspaceId ? await port.comparisons(scope()) : [],
        };
      } else if (domain === 'runners') {
        const port = service as Ports.IntegrationRunnersV1;
        result = { runs: await port.list(scope()), plans: await port.plans(scope()) };
      } else if (domain === 'exchange') result = await (service as Ports.IntegrationExchangeV1).imports();
      else if (domain === 'workbench')
        result = query.workspaceId
          ? await (service as Ports.IntegrationWorkbenchV1).view(scope())
          : await (service as Ports.IntegrationWorkbenchV1).templates();
      else result = await (service as Ports.IntegrationDefinitionsV1<unknown>).list(scope());
      sendJson(res, integrationResponseSchemas[domain].view.parse({ result }));
      return true;
    }
    if (req.method !== 'POST') return false;
    const raw = await body(req, signal);
    const input = integrationRequestSchemas[domain].parse(raw);
    const { action, ...args } = input;
    // 方法列表按领域固定，evaluate/resolve/容量与许可没有 HTTP 入口。 No public evidence, secret-resolution or permit endpoint.
    const definitions = [
      'specs',
      'environments',
      'fixtures',
      'mocks',
      'scenarios',
      'assertions',
      'load',
    ].includes(domain);
    if (definitions && ['save', 'get', 'seal', 'archive'].includes(action)) {
      const port = service as Ports.IntegrationDefinitionsV1<unknown>;
      if (action === 'save' && 'content' in input)
        result = await port.save(scope(), args as Parameters<typeof port.save>[1]);
      else if ('ref' in input) result = await port[action as 'get' | 'seal' | 'archive'](scope(), input.ref);
      else ilFail('ACTION_INPUT');
    } else
      switch (domain) {
        case 'specs': {
          const p = service as Ports.IntegrationSpecsV1;
          if (input.action === 'create-workspace') result = await p.createWorkspace({ name: input.name });
          else if (input.action === 'compare' && typeof input.before === 'object')
            result = await p.compare(scope(), input.before, input.after as typeof input.before);
          break;
        }
        case 'environments': {
          const p = service as Ports.IntegrationEnvironmentsV1;
          if (input.action === 'application-targets') result = await p.applicationTargets(scope());
          else if ('ref' in input) {
            if (input.action === 'versions') result = await p.versions(scope(), input.ref);
            else if (input.action === 'revoke') {
              await p.revoke(scope(), input.ref);
              result = { revoked: true };
            }
          }
          break;
        }
        case 'fixtures': {
          const p = service as Ports.IntegrationFixturesV1;
          if (input.action === 'import')
            result = await p.importData(scope(), {
              name: input.name,
              format: input.format,
              text: input.text,
              redact: input.redact,
            });
          else if (input.action === 'generate')
            result = await p.generate(scope(), { name: input.name, seed: input.seed, rows: input.rows });
          break;
        }
        case 'scenarios':
          if (input.action === 'compile')
            result = await (service as Ports.IntegrationScenariosV1).compile(scope(), input.ref);
          break;
        case 'runners': {
          const p = service as Ports.IntegrationRunnersV1;
          if (input.action === 'images') result = await p.availableImages(scope());
          else if (input.action === 'image-uploads') result = await p.imageUploads(scope());
          else if (input.action === 'image-begin')
            result = await p.beginImage(scope(), {
              digest: input.digest,
              bytes: input.bytes,
              distro: input.distro,
              architecture: input.architecture,
              source: input.source,
            });
          else if (input.action === 'image-append')
            result = await p.appendImage(scope(), input.id, input.offset, input.data);
          else if (input.action === 'image-finish') result = await p.finishImage(scope(), input.id);
          else if (input.action === 'image-discard') {
            await p.discardImage(scope(), input.id);
            result = { discarded: true };
          } else if (input.action === 'preview' && 'input' in input)
            result = await p.preview(scope(), input.input);
          else if (input.action === 'apply')
            result = await p.apply(scope(), {
              planId: input.planId,
              digest: input.digest,
              approveWrites: input.approveWrites,
            });
          else if (
            ['inspect', 'cancel', 'recover'].includes(input.action) &&
            'id' in input &&
            typeof input.id === 'string'
          )
            result = await p[input.action as 'inspect' | 'cancel' | 'recover'](scope(), input.id);
          else if (input.action === 'verify-effect' && typeof input.id === 'string')
            result = await p.verifyEffect(scope(), input.id, input.evidenceDigest, input.conclusion);
          break;
        }
        case 'load': {
          const p = service as Ports.IntegrationLoadV1;
          if (input.action === 'preview' && 'ref' in input) result = await p.preview(scope(), input.ref);
          else if (input.action === 'apply')
            result = await p.apply(scope(), {
              planId: input.planId,
              digest: input.digest,
              approveWrites: input.approveWrites,
            });
          break;
        }
        case 'reports': {
          const p = service as Ports.IntegrationReportsV1;
          if (input.action === 'get' && 'id' in input) result = await p.get(scope(), input.id);
          else if (input.action === 'seal' && 'runId' in input) result = await p.seal(scope(), input.runId);
          else if (input.action === 'compare' && typeof input.before === 'string')
            result = await p.compare(scope(), input.before, input.after as string);
          else if (input.action === 'cleanup-plan') result = await p.cleanupPlan(scope());
          else if (input.action === 'cleanup') result = await p.cleanup(scope(), input.digest);
          break;
        }
        case 'exchange': {
          const p = service as Ports.IntegrationExchangeV1;
          if (input.action === 'upload-begin')
            result = await p.beginUpload({
              name: input.name,
              bytes: input.bytes,
              digest: input.digest,
              contentType: input.contentType,
            });
          else if (input.action === 'upload-append')
            result = await p.appendUpload(input.id, input.offset, input.data);
          else if (input.action === 'upload-complete') result = await p.completeUpload(input.id);
          else if (input.action === 'upload-discard') result = await p.discardUpload(input.id);
          else if (input.action === 'uploads') result = await p.uploads();
          else if (input.action === 'export')
            result = await p.exportBundle(scope(), {
              scenario: input.scenario,
              mock: input.mock,
              assertions: input.assertions,
              reports: input.reports,
            });
          else if (input.action === 'quarantine') result = await p.quarantine({ bundle: input.bundle });
          else if (input.action === 'accept') result = await p.accept(input.id, input.digest);
          break;
        }
        case 'workbench':
          if (input.action === 'create')
            result = await (service as Ports.IntegrationWorkbenchV1).create({
              name: input.name,
              template: input.template,
            });
          break;
      }
    if (result === undefined) ilFail('ACTION_NOT_SUPPORTED');
    sendJson(res, integrationResponseSchemas[domain].act.parse({ result }));
    return true;
  };
}
