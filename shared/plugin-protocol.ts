import type { z } from 'zod';
import type {
  pluginManifestSchema,
  pluginPackSchema,
  pluginSelectionSchema,
  httpContributionSchema,
  operationContributionSchema,
} from './plugin-schema.ts';

export const PLUGIN_API_VERSION = 3;
export const BUILTIN_PLUGIN_VERSION = '0.3.0';
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginPack = z.infer<typeof pluginPackSchema>;
export type PluginSelection = z.infer<typeof pluginSelectionSchema>;
export type HttpContribution = z.infer<typeof httpContributionSchema>;
export type OperationContribution = z.infer<typeof operationContributionSchema>;
export type PluginRoot = { kind: 'plugin' | 'pack'; id: string };
export type PluginStatus = {
  selection: PluginSelection;
  active: string[];
  planned: string[];
  reasons: Record<string, PluginRoot[]>;
  migrations: string[];
  restartRequired: boolean;
  errors: Record<string, string>;
  lifecycle: Record<string, { phase: 'active' | 'failed' | 'skipped'; activationMs: number }>;
  plugins: PluginManifest[];
  packs: PluginPack[];
};

type PluginInput = Pick<PluginManifest, 'id' | 'name' | 'description' | 'category'> &
  Partial<
    Omit<
      PluginManifest,
      'kind' | 'schemaVersion' | 'contributes' | 'id' | 'name' | 'description' | 'category'
    >
  > & { contributes?: Partial<PluginManifest['contributes']> };
export function definePlugin(input: PluginInput): PluginManifest {
  return {
    schemaVersion: 1,
    kind: 'plugin',
    version: BUILTIN_PLUGIN_VERSION,
    apiVersion: PLUGIN_API_VERSION,
    experimental: false,
    requires: [],
    optional: [],
    services: [],
    lifecycle: { activateMs: 30000, closeMs: 10000 },
    ...input,
    contributes: {
      http: [],
      operations: [],
      sockets: [],
      pages: [],
      tabs: [],
      developmentSections: [],
      ...input.contributes,
    },
  };
}
export const pin = (id: string, version = BUILTIN_PLUGIN_VERSION) => ({ id, version });
export const http = (
  path: string,
  methods: HttpContribution['methods'],
  projectScoped = false,
): HttpContribution => ({ path, methods, projectScoped });
export const operation = (
  id: string,
  method: OperationContribution['method'],
  path: string,
  status = 200,
): OperationContribution => ({ id, method, path, status });
export function definePack(
  input: Pick<PluginPack, 'id' | 'name' | 'description' | 'members'> &
    Partial<Pick<PluginPack, 'version' | 'replacesPlugins'>>,
): PluginPack {
  return { schemaVersion: 1, kind: 'pack', version: BUILTIN_PLUGIN_VERSION, replacesPlugins: [], ...input };
}
export const member = (id: string, kind: 'plugin' | 'pack' = 'plugin', version = BUILTIN_PLUGIN_VERSION): PluginPack['members'][number] => ({
  ...pin(id, version),
  kind,
});
export const emptySelection = (): PluginSelection => ({ schemaVersion: 3, plugins: [], packs: [] });
