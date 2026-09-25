export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { CommandPresets } from '../../server/command-presets.ts';
import { presetSchema } from '../../server/command-presets.ts';
import type { PluginOperation } from '../../server/plugin-api.ts';
export async function activate(host: PluginContext) {
  host.provide('commands', new CommandPresets(host.machines, host.workspaces));
}
const idFrom = (url: URL) => url.pathname.split('/')[3];
const presetView = z.object({
  id: z.uuid(), name: z.string(), command: z.string(),
  parameters: z.array(z.object({ name: z.string(), value: z.string() })),
});
export const operations: Record<string, PluginOperation> = {
  list: {
    response: z.object({ projectId: z.string(), presets: z.array(presetView), job: z.any().nullable() }),
    async execute(url) {
      const id = idFrom(url);
      this.machines.get(id);
      return {
        projectId: this.workspaces.projects.current(id),
        presets: await this.use<CommandPresets>('commands', 'commands').list(id),
        job: this.commands.jobs.view(this.workspaces.projects.key(id)),
      };
    },
  },
  save: {
    request: presetSchema,
    response: z.array(presetView),
    execute(url, input) {
      return this.use<CommandPresets>('commands', 'commands').save(idFrom(url), input);
    },
  },
  remove: {
    request: z.object({ id: z.uuid() }).strict(),
    response: z.array(presetView),
    execute(url, input) {
      return this.use<CommandPresets>('commands', 'commands').remove(idFrom(url), (input as { id: string }).id);
    },
  },
  run: {
    request: z.object({ id: z.uuid(), values: z.record(z.string(), z.string()).default({}) }).strict(),
    response: z.object({ id: z.string(), status: z.string() }).passthrough(),
    execute(url, input) {
      const value = input as { id: string; values: Record<string, string> };
      return this.use<CommandPresets>('commands', 'commands').run(idFrom(url), value.id, value.values);
    },
  },
};
export async function route(): Promise<boolean> {
  return false;
}
