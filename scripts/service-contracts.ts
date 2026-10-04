import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, isAbsolute, relative, resolve, win32 } from 'node:path';
import ts from 'typescript';

// Only independent contract declarations are inputs. Implementations never enlarge this registry.
const sourcePath = 'server/service-contracts/v1.ts';
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, '.');
const program = ts.createProgram([sourcePath], parsed.options);
const checker = program.getTypeChecker();
const source = program.getSourceFile(sourcePath)!;
const contractRoot = realpathSync(resolve('server/service-contracts'));
const sharedRoot = realpathSync(resolve('shared'));
const inside = (root: string, path: string) => {
  const pathFromRoot = relative(root, path);
  return !isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith('..' + win32.sep) &&
    !pathFromRoot.startsWith('../');
};
/** Contract imports use owned declarations, shared DTOs, or public package entry points. */
export function assertServiceContractImport(specifier: string, containingFile = sourcePath): string | undefined {
  if (isAbsolute(specifier) || win32.isAbsolute(specifier) || /^[a-z]:/i.test(specifier) || specifier.includes('\\'))
    throw new Error('Public service contracts cannot use absolute paths: ' + specifier);
  if (isBuiltin(specifier)) return;
  if (!specifier.startsWith('.')) {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i.test(specifier))
      throw new Error('Public service contracts require public package entry points: ' + specifier);
    const imported = ts.resolveModuleName(specifier, resolve(containingFile), parsed.options, ts.sys).resolvedModule;
    if (!imported?.isExternalLibraryImport)
      throw new Error('Public service contract package import is not an external package: ' + specifier);
    return;
  }
  const imported = ts.resolveModuleName(specifier, resolve(containingFile), parsed.options, ts.sys).resolvedModule;
  if (!imported) throw new Error('Public service contract import cannot be resolved: ' + specifier);
  const path = realpathSync(imported.resolvedFileName);
  if (!inside(contractRoot, path) && !inside(sharedRoot, path))
    throw new Error('Public service contracts cannot import implementations or escape their directory: ' + specifier);
  return path;
}
export function assertIndependentServiceContracts(entry: ts.SourceFile, inputs = program) {
  const inspected = new Set<ts.SourceFile>();
  const inspectImport = (specifier: string, file: ts.SourceFile) => {
    const path = assertServiceContractImport(specifier, file.fileName);
    if (path && inside(contractRoot, path)) {
      const dependency = inputs.getSourceFile(path) || inputs.getSourceFiles().find(candidate => resolve(candidate.fileName) === path);
      if (!dependency) throw new Error('Public service contract source is missing: ' + path);
      independentSource(dependency);
    }
  };
  function independentSource(file: ts.SourceFile) {
    if (inspected.has(file)) return;
    inspected.add(file);
    independent(file, file);
    for (const reference of file.referencedFiles) {
      const specifier = reference.fileName;
      inspectImport(specifier.startsWith('.') || isAbsolute(specifier) || win32.isAbsolute(specifier)
        ? specifier : './' + specifier, file);
    }
  }
  function independent(node: ts.Node, file: ts.SourceFile) {
    const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier
      : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal
      : ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression
      : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) ? node.arguments[0] : undefined;
    if (specifier && ts.isStringLiteral(specifier)) inspectImport(specifier.text, file);
    ts.forEachChild(node, child => independent(child, file));
  }
  independentSource(entry);
}
assertIndependentServiceContracts(source);
const descriptors: Record<string, { id: string; version: number; members: string[]; optional?: string[]; methods?: string[]; properties?: Record<string, string>; returns?: Record<string, string> }> = {};
const known = new Map<ts.Type, string>();
const assigned = new Map<ts.Type, string>();
const idFor = (name: string) => 'sakura.service.' + name.replace(/V1$/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() + '.v1';
for (const node of source.statements)
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    known.set(checker.getTypeAtLocation(node), idFor(node.name.text));
function underlying(type: ts.Type): ts.Type | undefined {
  if (type.isUnion()) {
    const choices = type.types.filter((item) => !(item.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
    if (choices.length !== 1) return;
    return underlying(choices[0]);
  }
  const promise = type.symbol?.name === 'Promise' ? checker.getTypeArguments(type as ts.TypeReference)[0] : undefined;
  if (promise) return underlying(promise);
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const element = checker.getTypeArguments(type as ts.TypeReference)[0];
    return element && underlying(element);
  }
  return type;
}
function shape(raw: ts.Type, suggested: string, force = false): string | undefined {
  const type = underlying(raw);
  if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) return;
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length) return;
  const members = type.getProperties();
  const named = known.get(type);
  const mapped = type.aliasSymbol && ['Readonly', 'Pick', 'Omit', 'Partial', 'Required'].includes(type.aliasSymbol.name);
  if (!named && !mapped && type.symbol?.declarations?.some((declaration) => declaration.getSourceFile() !== source)) return;
  if (!force && !members.some((member) => {
    const value = checker.getTypeOfSymbolAtLocation(member, source);
    return checker.getSignaturesOfType(value, ts.SignatureKind.Call).length > 0;
  })) return;
  const id = named || suggested;
  if (assigned.has(type)) return assigned.get(type);
  if (descriptors[id]) return id;
  assigned.set(type, id);
  const descriptor = descriptors[id] = { id, version: 1, members: members.map((member) => member.name).sort() } as (typeof descriptors)[string];
  const optional = members.filter((member) => member.flags & ts.SymbolFlags.Optional).map((member) => member.name).sort();
  if (optional.length) descriptor.optional = optional;
  const methods = members.filter((member) => checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(member, source), ts.SignatureKind.Call).length).map((member) => member.name).sort();
  if (methods.length) descriptor.methods = methods;
  const properties: Record<string, string> = {}, returns: Record<string, string> = {};
  for (const member of members) {
    const value = checker.getTypeOfSymbolAtLocation(member, source);
    const call = checker.getSignaturesOfType(value, ts.SignatureKind.Call)[0];
    const nested = shape(call ? checker.getReturnTypeOfSignature(call) : value, id + '/' + member.name);
    if (nested) (call ? returns : properties)[member.name] = nested;
  }
  if (Object.keys(properties).length) descriptor.properties = properties;
  if (Object.keys(returns).length) descriptor.returns = returns;
  return id;
}
for (const node of source.statements) {
  if (!ts.isInterfaceDeclaration(node)) continue;
  shape(checker.getTypeAtLocation(node), idFor(node.name.text), true);
}
const content = '// Generated from independent versioned interfaces by scripts/service-contracts.ts.\n' +
  "import type { ServiceContract } from './service-ref.ts';\n\n" +
  'export const PUBLIC_SERVICE_CONTRACTS: Readonly<Record<string, ServiceContract<any>>> = ' +
  JSON.stringify(Object.fromEntries(Object.entries(descriptors).sort(([a], [b]) => a.localeCompare(b))), null, 2) + ';\n';
const target = 'server/public-service-members.ts';
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== content)
    throw new Error('Service descriptors are stale: npx tsx scripts/service-contracts.ts');
} else await writeFile(target, content);
console.log(`Verified ${Object.keys(descriptors).length} explicit versioned service descriptors.`);
