import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { pluginManifestSchema, pluginPackSchema, pluginSelectionSchema } from '../shared/plugin-schema.ts';
import { PLUGINS } from '../shared/plugins.ts';
import { loaders } from '../server/plugins/registry.ts';

const folder = new URL('../docs/schemas/', import.meta.url);
const checking = process.argv.includes('--check');
if (!checking) await mkdir(folder, { recursive: true });
for (const [name, schema] of Object.entries({
  plugin: pluginManifestSchema,
  pack: pluginPackSchema,
  selection: pluginSelectionSchema,
})) {
  const file = new URL(`${name}.schema.json`, folder);
  const text = JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n';
  if (checking) {
    if ((await readFile(file, 'utf8')).replaceAll('\r\n', '\n') !== text)
      throw new Error(`Schema is stale: ${file.pathname}`);
  } else await writeFile(file, text);
}
const operations: Record<string, unknown> = {};
for (const plugin of PLUGINS) {
  if (!plugin.contributes.operations.length) continue;
  const module = await loaders[plugin.id]();
  for (const declaration of plugin.contributes.operations) {
    const implementation = module.operations?.[declaration.id];
    if (!implementation) throw new Error(`Missing operation implementation: ${plugin.id}.${declaration.id}`);
    operations[`${plugin.id}.${declaration.id}`] = {
      ...declaration,
      request: implementation.request ? z.toJSONSchema(implementation.request) : null,
      response: z.toJSONSchema(implementation.response),
    };
  }
}
const operationsFile = new URL('operations.json', folder);
const operationsText = JSON.stringify(operations, null, 2) + '\n';
if (checking) {
  if ((await readFile(operationsFile, 'utf8')).replaceAll('\r\n', '\n') !== operationsText)
    throw new Error(`Operation contracts are stale: ${operationsFile.pathname}`);
} else await writeFile(operationsFile, operationsText);
console.log(
  checking ? 'Plugin schemas and operations are up to date.' : 'Generated plugin, pack, selection and operation schemas.',
);
