import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { isBuiltin } from 'node:module';
import ts from 'typescript';

// Check eager value dependencies. Type imports and lazy plugin loading do not
// participate in module initialization and are deliberately excluded.
const roots = ['server', 'src', 'shared', 'plugins'];
const files = (
  await Promise.all(
    roots.map(async (root) =>
      (await readdir(root, { recursive: true }))
        .filter((name) => /\.tsx?$/.test(name))
        .map((name) => resolve(root, name)),
    ),
  )
).flat();
const known = new Set(files);
const label = (file: string) => relative(process.cwd(), file).replaceAll('\\', '/');
const graph = new Map<string, string[]>();
const builtins = new Map<string, string[]>();
const errors: string[] = [];
for (const file of files) {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
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
    const target = [base, base + '.ts', base + '.tsx', resolve(base, 'index.ts')].find((candidate) =>
      known.has(candidate),
    );
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
if (errors.length) throw new Error(errors.join('\n'));
console.log(
  `Architecture verified: ${files.length} modules, no eager value dependency cycles or browser/server boundary violations.`,
);
