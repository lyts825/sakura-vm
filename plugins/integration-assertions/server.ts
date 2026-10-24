/** 装配独立领域；跨插件只调用声明服务。 Assemble one domain using declared services. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { IntegrationAssertions } from '../../server/integration-assertions.ts';
import { integrationRoute } from '../../server/integration-http.ts';
import { integrationResponseSchemas } from '../../shared/contracts/integration-http.ts';
import { services } from './services.ts';
import { services as specsServices } from '../integration-specs/services.ts';
import { services as scenariosServices } from '../integration-scenarios/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const deps = { specs: host.use(specsServices.specs), scenarios: host.use(scenariosServices.scenarios) };
  const service = new IntegrationAssertions(meta, deps.specs, deps.scenarios);

  host.provide(services.assertions, service);

  host.onDispose(() => service.close());
}
export const route = integrationRoute('assertions', (host) => host.use(services.assertions));
export const httpHandlers = { view: route, act: route };
export const responseContracts = Object.fromEntries(
  Object.entries(integrationResponseSchemas.assertions).map(([id, schema]) => [
    id,
    { kind: 'json' as const, statuses: [200], media: 'application/json', schema },
  ]),
);
