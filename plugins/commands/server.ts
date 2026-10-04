import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { services as commandsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { CommandPresets } from '../../server/command-presets.ts';
import { presetSchema } from '../../server/command-presets.ts';
import type { PluginOperation } from '../../server/plugin-api.ts';
export async function activate(host: PluginContext) {
  host.provide(commandsServices.commands, new CommandPresets(host.vm, host.workspaces));
}
const idFrom = (url: URL) => url.pathname.split('/')[3];

export const operations: Record<string, PluginOperation> = {
  list: {
    response: pluginRouteResponses["commands.list"].schema,
    async execute(url) {
      const id = idFrom(url);
      this.vm.get(id);
      return {
        projectId: this.workspaces.projects.current(id),
        presets: await this.use(commandsServices.commands).list(id),
        job: this.commands.jobs.view(this.workspaces.projects.key(id)),
      };
    },
  },
  save: {
    request: presetSchema,
    response: pluginRouteResponses["commands.save"].schema,
    execute(url, input) {
      return this.use(commandsServices.commands).save(idFrom(url), input);
    },
  },
  remove: {
    request: z.object({ id: z.uuid() }).strict(),
    response: pluginRouteResponses["commands.remove"].schema,
    execute(url, input) {
      return this.use(commandsServices.commands).remove(idFrom(url), (input as { id: string }).id);
    },
  },
  run: {
    request: z.object({ id: z.uuid(), values: z.record(z.string(), z.string()).default({}) }).strict(),
    response: pluginRouteResponses["commands.run"].schema,
    execute(url, input) {
      const value = input as { id: string; values: Record<string, string> };
      return this.use(commandsServices.commands).run(idFrom(url), value.id, value.values);
    },
  },
};
export async function route(): Promise<boolean> {
  return false;
}

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("commands");
