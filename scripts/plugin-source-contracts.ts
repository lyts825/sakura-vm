import { isBuiltin } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import { staticString } from './network-boundaries.ts';

const label = (file: string) => relative(process.cwd(), resolve(file)).replaceAll('\\', '/');
const owner = (file: string) => /^plugins\/([^/]+)\//.exec(label(file))?.[1];
const compatibilityMember = (symbol: ts.Symbol | undefined) => symbol?.declarations?.some(
  declaration => label(declaration.getSourceFile().fileName) === 'server/plugin-services.ts',
);

/** Repository authoring rules supplement the runtime broker; they do not change API 5. */
export function pluginSourceContractErrors(program: ts.Program, catalog: readonly PluginManifest[]): string[] {
  const checker = program.getTypeChecker();
  const errors: string[] = [];
  const report = (node: ts.Node, message: string) => {
    const file = node.getSourceFile();
    errors.push(`${label(file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${message}`);
  };
  const target = (file: ts.SourceFile, specifier: string) => {
    if (specifier.startsWith('.')) {
      const base = resolve(dirname(file.fileName), specifier);
      for (const path of [base, base.replace(/\.js$/, '.ts'), base + '.ts', base + '.tsx', resolve(base, 'index.ts')]) {
        const source = program.getSourceFile(path);
        if (source) return source;
      }
    }
    const path = ts.resolveModuleName(specifier, file.fileName, program.getCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName;
    return path ? program.getSourceFile(path) : undefined;
  };
  const imports = (file: ts.SourceFile) => {
    const found: { node: ts.Node; specifier: string }[] = [];
    function visit(node: ts.Node) {
      const value = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal
        : ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression
        : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          ts.isIdentifier(node.expression) && node.expression.text === 'require') ? node.arguments[0] : undefined;
      if (value && ts.isStringLiteralLike(value)) found.push({ node, specifier: value.text });
      ts.forEachChild(node, visit);
    }
    visit(file);
    return found;
  };
  const browserVisited = new Set<ts.SourceFile>();
  function browser(file: ts.SourceFile) {
    if (browserVisited.has(file)) return;
    browserVisited.add(file);
    for (const { node, specifier } of imports(file)) {
      const dependency = target(file, specifier);
      if (isBuiltin(specifier) || dependency && label(dependency.fileName).startsWith('server/'))
        report(node, 'Plugin browser modules must use shared wire contracts, not server implementations or Node.js types');
      else if (dependency && /^(?:plugins|shared)\//.test(label(dependency.fileName))) browser(dependency);
    }
  }
  const serverVisited = new Set<ts.SourceFile>();
  function server(file: ts.SourceFile) {
    if (serverVisited.has(file)) return;
    serverVisited.add(file);
    const pluginId = owner(file.fileName)!;
    const manifest = catalog.find(item => item.id === pluginId);
    const declared = new Set([pluginId, ...(manifest?.requires || []).map(item => item.id),
      ...(manifest?.optional || []).map(item => item.id)]);
    for (const { node, specifier } of imports(file)) {
      const dependency = target(file, specifier);
      if (!dependency) continue;
      const dependencyOwner = owner(dependency.fileName);
      if (!dependencyOwner) continue;
      if (dependencyOwner !== pluginId) {
        if (!declared.has(dependencyOwner)) report(node, `Plugin service dependency must be declared directly: ${dependencyOwner}`);
        if (label(dependency.fileName) !== `plugins/${dependencyOwner}/services.ts`)
          report(node, 'Server plugins may import another plugin only through its public services.ts references');
      } else server(dependency);
    }
    function visit(node: ts.Node) {
      if (ts.isPropertyAccessExpression(node) && compatibilityMember(checker.getSymbolAtLocation(node.name)))
        report(node, 'Official plugin entries must resolve services explicitly with use/optional(ServiceRef)');
      if (ts.isElementAccessExpression(node)) {
        const type = checker.getTypeAtLocation(node.expression);
        const key = staticString(node.argumentExpression);
        if (key !== undefined ? compatibilityMember(type.getProperty(key))
          : type.getProperties().some(compatibilityMember))
          report(node, 'Official plugin entries must resolve services explicitly with use/optional(ServiceRef)');
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const type = checker.getTypeAtLocation(node.parent);
        const property = node.propertyName || node.name;
        const key = ts.isComputedPropertyName(property) ? staticString(property.expression)
          : ts.isIdentifier(property) ? property.text : staticString(property);
        if (key !== undefined ? compatibilityMember(type.getProperty(key))
          : ts.isComputedPropertyName(property) && type.getProperties().some(compatibilityMember))
          report(node, 'Official plugin entries may not destructure compatibility service getters');
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  for (const manifest of catalog) {
    const entry = program.getSourceFile(resolve('plugins', manifest.id, 'server.ts'));
    if (entry) server(entry);
    const client = program.getSourceFile(resolve('plugins', manifest.id, 'client.tsx'));
    const expected = {
      tabs: manifest.contributes.tabs.filter(id => id !== 'development'),
      pages: manifest.contributes.pages,
      developmentSections: manifest.contributes.developmentSections,
    };
    if (!client) {
      if (Object.values(expected).some(items => items.length)) errors.push(`${manifest.id}: missing client.tsx contributions`);
      continue;
    }
    browser(client);
    const symbol = checker.getSymbolAtLocation(client);
    const exports = symbol ? checker.getExportsOfModule(symbol) : [];
    for (const [kind, ids] of Object.entries(expected)) {
      const exported = exports.find(item => item.name === kind);
      const type = exported ? checker.getTypeOfSymbolAtLocation(exported, client) : undefined;
      const actual = type?.getProperties().map(item => item.name).sort() || [];
      if (JSON.stringify(actual) !== JSON.stringify([...ids].sort()) || type && checker.getIndexTypeOfType(type, ts.IndexKind.String))
        report(client, `Client ${kind} must match manifest contributions exactly (expected: ${ids.join(', ')}; actual: ${actual.join(', ')})`);
      for (const component of type?.getProperties() || []) {
        const componentType = checker.getTypeOfSymbolAtLocation(component, client);
        if (!componentType.getCallSignatures().length && !componentType.getConstructSignatures().length)
          report(component.valueDeclaration || client, `Client contribution ${kind}.${component.name} must be a component`);
      }
    }
  }
  return [...new Set(errors)];
}

export function assertPluginSourceContracts(catalog: readonly PluginManifest[]) {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, '.');
  const files = ts.sys.readDirectory(resolve('plugins'), ['.ts', '.tsx']);
  const program = ts.createProgram(files, parsed.options);
  const errors = pluginSourceContractErrors(program, catalog);
  if (errors.length) throw new Error(errors.join('\n'));
}
