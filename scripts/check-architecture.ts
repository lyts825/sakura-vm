import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { isBuiltin } from 'node:module';
import ts from 'typescript';
import { networkBoundaryErrors, staticString } from './network-boundaries.ts';
import { resourceBoundaryErrors } from './resource-boundaries.ts';

// Check eager value dependencies. Type imports and lazy plugin loading do not
// participate in module initialization and are deliberately excluded.
const roots = ['server', 'src', 'shared', 'plugins'];
const files = (
  await Promise.all(
    roots.map(async (root) =>
      (await readdir(root, { recursive: true }))
        .filter((name) => /\.[cm]?[jt]sx?$/.test(name))
        .map((name) => resolve(root, name)),
    ),
  )
).flat();
const known = new Set(files);
const label = (file: string) => relative(process.cwd(), file).replaceAll('\\', '/');
const graph = new Map<string, string[]>();
const builtins = new Map<string, string[]>();
const errors: string[] = [];
const sources = new Map<string, ts.SourceFile>();
for (const file of files) {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  sources.set(file, source);
  const edges: string[] = [];
  const nodeImports: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined;
    const bindings = clause?.namedBindings;
    if (clause?.isTypeOnly || (ts.isExportDeclaration(statement) && statement.isTypeOnly)) continue;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      !clause?.name &&
      bindings.elements.length &&
      bindings.elements.every((entry) => entry.isTypeOnly)
    )
      continue;
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.length &&
      statement.exportClause.elements.every((entry) => entry.isTypeOnly)
    )
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) {
      if (isBuiltin(specifier)) nodeImports.push(specifier);
      continue;
    }
    const base = resolve(dirname(file), specifier);
    const target = [
      base,
      ...['.ts', '.tsx', '.js', '.mjs', '.cjs'].map((extension) => base + extension),
      base.replace(/\.js$/, '.ts'),
      resolve(base, 'index.ts'),
      resolve(base, 'index.js'),
    ].find((candidate) => known.has(candidate));
    if (!target) continue;
    edges.push(target);
  }
  graph.set(file, edges);
  builtins.set(file, nodeImports);
}

// Follow client helper modules as well as entry points, so an intermediate
// plugin module cannot hide a browser-to-server dependency.
const browserVisited = new Set<string>();
function visitBrowser(file: string) {
  if (browserVisited.has(file)) return;
  browserVisited.add(file);
  for (const specifier of builtins.get(file) || [])
    errors.push(`${label(file)}: browser dependency on ${specifier}`);
  for (const target of graph.get(file) || []) {
    if (label(target).startsWith('server/'))
      errors.push(`${label(file)}: browser runtime dependency on ${label(target)}`);
    else visitBrowser(target);
  }
}
for (const file of files) {
  const name = label(file);
  if (name.startsWith('src/') || name.startsWith('shared/') || /^plugins\/[^/]+\/client\.tsx?$/.test(name))
    visitBrowser(file);
}

let next = 0;
const index = new Map<string, number>(),
  low = new Map<string, number>();
const stack: string[] = [],
  active = new Set<string>();
function visit(file: string) {
  index.set(file, next);
  low.set(file, next++);
  stack.push(file);
  active.add(file);
  for (const target of graph.get(file) || []) {
    if (!index.has(target)) {
      visit(target);
      low.set(file, Math.min(low.get(file)!, low.get(target)!));
    } else if (active.has(target)) low.set(file, Math.min(low.get(file)!, index.get(target)!));
  }
  if (low.get(file) !== index.get(file)) return;
  const component: string[] = [];
  let current: string;
  do {
    current = stack.pop()!;
    active.delete(current);
    component.push(label(current));
  } while (current !== file);
  if (component.length > 1 || graph.get(file)?.includes(file))
    errors.push(`Circular value dependencies: ${component.sort().join(', ')}`);
}
for (const file of files) if (!index.has(file)) visit(file);
// Unlike the initialization graph, network ownership also covers lazy imports,
// plugin server helpers, JS helpers, and every script shipped in the release.
const networkVisited = new Set<string>();
async function visitNetwork(file: string) {
  // Dependencies and generated bundles have their own adapter/build checks.
  // Scanning the compiled network core would also erase its source boundary.
  if (/^(?:\.vendor|\.sakura-server|\.sakura-witness|node_modules)\//.test(label(file))) return;
  if (networkVisited.has(file)) return;
  networkVisited.add(file);
  let source = sources.get(file);
  if (!source) {
    const code = await readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return undefined;
      throw error;
    });
    if (code === undefined) return;
    source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    sources.set(file, source);
  }
  errors.push(...networkBoundaryErrors(label(file), source));
  errors.push(...resourceBoundaryErrors(label(file), source));
  const dependencies: string[] = [];
  function collect(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
      (ts.isExportDeclaration(node) && !node.isTypeOnly)
    ) {
      const specifier = staticString(node.moduleSpecifier);
      if (specifier) dependencies.push(specifier);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = staticString(node.moduleReference.expression);
      if (specifier) dependencies.push(specifier);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const specifier = staticString(node.arguments[0]);
      if (specifier) dependencies.push(specifier);
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
  for (const specifier of dependencies) {
    if (!specifier.startsWith('.')) continue;
    const base = resolve(dirname(file), specifier);
    const candidates = [
      base,
      base.replace(/\.js$/, '.ts'),
      ...['.ts', '.tsx', '.js', '.mjs', '.cjs'].map((extension) => base + extension),
      resolve(base, 'index.ts'),
      resolve(base, 'index.js'),
    ];
    const knownTarget = candidates.find((candidate) => sources.has(candidate));
    if (knownTarget) await visitNetwork(knownTarget);
    else
      for (const candidate of new Set(candidates)) {
        if (!/\.[cm]?[jt]sx?$/.test(candidate)) continue;
        await visitNetwork(candidate);
        if (sources.has(candidate)) break;
      }
  }
}
for (const file of files)
  if (label(file).startsWith('server/') || /^plugins\/[^/]+\/server\./.test(label(file)))
    await visitNetwork(file);
// Read the packaging list, so a newly shipped helper cannot be forgotten here.
const packaging = await readFile('scripts/package-release.mjs', 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
const releaseScripts = new Set([
  'setup.mjs',
  'cli.mjs',
  'development-cli.mjs',
  'native-open.mjs',
  'self-update.mjs',
  'launch.mjs',
  'ha-witness.ts',
]);
const packageSource = ts.createSourceFile('package-release.mjs', packaging, ts.ScriptTarget.Latest, true);
function packagedScripts(node: ts.Node) {
  if (ts.isStringLiteralLike(node) && /^[a-z][a-z0-9-]*\.mjs$/.test(node.text)) releaseScripts.add(node.text);
  ts.forEachChild(node, packagedScripts);
}
packagedScripts(packageSource);
for (const name of releaseScripts) await visitNetwork(resolve('scripts', name));
if (errors.length) throw new Error(errors.join('\n'));
console.log(
  `Architecture verified: ${files.length} modules, no eager value dependency cycles, browser/server or managed-resource boundary violations.`,
);
