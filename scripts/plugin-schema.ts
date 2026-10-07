/** 从当前插件协议和操作目录生成 JSON Schema 与操作说明，支持 --check 校验已提交生成物。
 * Define strict plugin/pack manifest validation used by catalog synchronization and architecture checks. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { pluginManifestSchema, pluginPackSchema, pluginSelectionSchema } from '../shared/plugin-schema.ts';
import { PLUGINS } from '../shared/plugins.ts';
import { loaders } from '../server/plugins/registry.ts';
import { pluginRouteResponses } from '../shared/contracts/plugin-route-responses.ts';
import type { HttpResponseContract } from '../shared/contracts/http-response.ts';
import { requestContract, wireRequestSchema } from '../server/http-request-contracts.ts';

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
  if (!plugin.contributes.routes.length) continue;
  const module = await loaders[plugin.id]();
  for (const route of plugin.contributes.routes) {
    const id = `${plugin.id}.${route.id}`;
    const contract = (pluginRouteResponses as Record<string, HttpResponseContract>)[id];
    if (!contract || contract.kind === 'json' && !contract.schema)
      throw new Error(`Missing public response contract: ${id}`);
    if (!contract.statuses.length || contract.statuses.some(status => !Number.isInteger(status) || status < 200 || status >= 400))
      throw new Error(`Invalid successful response statuses: ${id}`);
    const implementation = route.handler === 'operation' ? module.operations?.[route.id] : undefined;
    if (route.handler === 'operation' ? !implementation : !module.httpHandlers?.[route.id])
      throw new Error(`Missing operation implementation: ${id}`);
    if (implementation && implementation.response !== contract.schema)
      throw new Error(`Handler uses a different public response contract: ${id}`);
    const declaration = plugin.contributes.operations.find(item => item.id === route.id) || route;
    const input = requestContract(id, route.policy, route.method, implementation?.request);
    operations[id] = {
      ...declaration,
      status: contract.statuses[0], statuses: contract.statuses,
      kind: contract.kind, media: contract.media,
      input: { kind: input.kind, required: input.required, ...(input.media ? { media: input.media } : {}),
        ...(input.bodylessQuery ? { bodylessQuery: input.bodylessQuery } : {}),
        query: z.toJSONSchema(input.query, { io: 'input' }), headers: z.toJSONSchema(input.headers, { io: 'input' }) },
      request: input.schema ? wireRequestSchema(input.schema) : null,
      response: contract.schema ? z.toJSONSchema(contract.schema) : null,
    };
  }
}
for (const id of Object.keys(pluginRouteResponses))
  if (!Object.hasOwn(operations, id)) throw new Error(`Response contract has no declared route: ${id}`);
const operationsFile = new URL('operations.json', folder);
const operationsText = JSON.stringify(operations, null, 2) + '\n';
if (checking) {
  if ((await readFile(operationsFile, 'utf8')).replaceAll('\r\n', '\n') !== operationsText)
    throw new Error(`Operation contracts are stale: ${operationsFile.pathname}`);
} else await writeFile(operationsFile, operationsText);
console.log(
  checking
    ? 'Plugin schemas and operations are up to date.'
    : 'Generated plugin, pack, selection and operation schemas.',
);
