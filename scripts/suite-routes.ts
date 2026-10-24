/** 从逐方法校验器生成轻量清单元数据；--check 阻止过期的读写策略进入构建。 */
import { readFile, writeFile } from 'node:fs/promises';
import { supplyHttpSchemas } from '../shared/contracts/supply-http.ts';
import { localeHttpSchemas } from '../shared/contracts/locale-http.ts';
const suites = { supply: supplyHttpSchemas, locale: localeHttpSchemas };
const roots: { [K in keyof typeof suites]: keyof typeof suites[K] } = { supply: 'sources', locale: 'catalogs' };
for (const [prefix, domain] of Object.entries(roots)) {
  const domains = suites[prefix as keyof typeof suites] as Record<string, Record<string, unknown>>;
  const methods = domains[domain];
  if (!methods || !('createWorkspace' in methods) || !('hostCapacity' in methods))
    throw new Error(`Suite root capacity contract is missing: ${prefix}-${domain}`);
}
const checking = process.argv.includes('--check');
const registrySource =
  '/** 由 scripts/suite-routes.ts 生成的轻量领域路由索引。 */\n' +
  Object.keys(suites)
    .map((prefix) => `import { ${prefix}RouteMetadata } from './${prefix}-routes.generated.ts';`)
    .join('\n') +
  '\nexport const suiteRouteRegistry = {\n' +
  Object.keys(suites)
    .map((prefix) => `  ${prefix}: ${prefix}RouteMetadata,`)
    .join('\n') +
  '\n} as const;\nexport const suiteRootRegistry = ' +
  JSON.stringify(Object.fromEntries(Object.entries(roots).map(([prefix, domain]) => [prefix, prefix + '-' + domain])), null, 2) +
  ' as const;\n';
const registryTarget = new URL('../shared/contracts/suite-routes.registry.generated.ts', import.meta.url);
if (checking) {
  if ((await readFile(registryTarget, 'utf8')).replaceAll('\r\n', '\n') !== registrySource)
    throw new Error('Suite route registry is stale');
} else await writeFile(registryTarget, registrySource);
for (const [prefix, domains] of Object.entries(suites)) {
  const metadata = Object.fromEntries(
    Object.entries(domains as Record<string, Record<string, { read: boolean }>>).map(([domain, methods]) => [
      domain,
      Object.fromEntries(Object.entries(methods).map(([method, schema]) => [method, schema.read])),
    ]),
  );
  const source = `/** 由 scripts/suite-routes.ts 生成，禁止手工修改。 */\nimport { suiteRoutes, suiteHttp } from '../suite-routes.ts';\nexport const ${prefix}RouteMetadata = ${JSON.stringify(metadata, null, 2)} as const;\nexport type ${prefix[0].toUpperCase() + prefix.slice(1)}RouteDomain = keyof typeof ${prefix}RouteMetadata;\nexport const ${prefix}Routes = (domain: ${prefix[0].toUpperCase() + prefix.slice(1)}RouteDomain) => suiteRoutes('${prefix}', domain, ${prefix}RouteMetadata[domain]);\nexport const ${prefix}Http = (domain: ${prefix[0].toUpperCase() + prefix.slice(1)}RouteDomain) => suiteHttp('${prefix}', domain);\n`;
  const target = new URL(`../shared/contracts/${prefix}-routes.generated.ts`, import.meta.url);
  if (checking) {
    if ((await readFile(target, 'utf8')).replaceAll('\r\n', '\n') !== source)
      throw new Error(`Suite route metadata is stale: ${prefix}`);
  } else await writeFile(target, source);
}
const commands = Object.fromEntries(
  Object.entries(suites).map(([prefix, domains]) => [
    prefix,
    Object.fromEntries(
      Object.entries(domains as Record<string, Record<string, unknown>>).map(([domain, methods]) => [
        domain,
        Object.keys(methods).map((method) =>
          method.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()),
        ),
      ]),
    ),
  ]),
);
const commandSource = `/** 由 scripts/suite-routes.ts 生成的固定 CLI 动作；禁止手工修改。 */\nexport const suiteCommands = Object.freeze(${JSON.stringify(commands, null, 2)});\n`;
const commandTarget = new URL('./suite-commands.generated.mjs', import.meta.url);
if (checking) {
  if ((await readFile(commandTarget, 'utf8')).replaceAll('\r\n', '\n') !== commandSource)
    throw new Error('Suite CLI commands are stale');
} else await writeFile(commandTarget, commandSource);
console.log(
  `Suite route metadata ${checking ? 'verified' : 'generated'}: ${Object.keys(suites).join(', ')}.`,
);
