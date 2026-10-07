/** 读取已发布服务接口基线，构建独立 TypeScript 比较程序并检查双向形状与方法兼容性。 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, basename } from 'node:path';
import ts from 'typescript';

export type ServiceReleaseBaseline = {
  release: string; commit: string; entry: string; digest: string;
  /** Frozen declaration inputs include transitive shared DTOs and inferred schema types. */
  files: Record<string, string>;
};
export const serviceBaselineDigest = (files: Record<string, string>) => createHash('sha256')
  .update(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))))
  .digest('hex');

export const SERVICE_RELEASE_DIRECTORY = 'server/service-contracts/releases';
export const SERVICE_CONTRACT_ENTRY = 'server/service-contracts/v1.ts';
export const serviceReleaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
export const isServiceDeclarationPath = (file: string) =>
  !file.includes('\\') && !file.split('/').some(part => part === '' || part === '.' || part === '..') &&
  (file.startsWith('shared/') || file.startsWith('server/service-contracts/')) && /\.[cm]?tsx?$/.test(file);

/** Every release remains an input; ordinary checks never create or update snapshots. */
export async function readServiceReleaseBaselines(directory = SERVICE_RELEASE_DIRECTORY): Promise<ServiceReleaseBaseline[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name));
  if (!files.some(file => file.name === '2.1.0.json'))
    throw new Error('Missing released service baseline: 2.1.0.json');
  const baselines: ServiceReleaseBaseline[] = [];
  for (const file of files) {
    if (!file.isFile()) throw new Error('Released service baseline must be a regular file: ' + file.name);
    const value: unknown = JSON.parse(await readFile(resolve(directory, file.name), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid released service baseline metadata: ' + file.name);
    const snapshot = value as ServiceReleaseBaseline;
    if (typeof snapshot.release !== 'string' || !serviceReleaseVersion.test(snapshot.release) ||
      basename(file.name, '.json') !== snapshot.release || typeof snapshot.commit !== 'string' ||
      !/^[a-f0-9]{40}$/.test(snapshot.commit) || snapshot.entry !== SERVICE_CONTRACT_ENTRY ||
      !snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files) ||
      Object.entries(snapshot.files).some(([path, text]) => !isServiceDeclarationPath(path) || typeof text !== 'string'))
      throw new Error('Invalid released service baseline metadata or filename/release mismatch: ' + file.name);
    if (!Object.hasOwn(snapshot.files, snapshot.entry))
      throw new Error('Missing released service baseline entry: ' + file.name);
    if (snapshot.digest !== serviceBaselineDigest(snapshot.files))
      throw new Error('Released service signature baseline digest does not match: ' + snapshot.release);
    baselines.push(snapshot);
  }
  return baselines;
}

/** Method declarations are checked as function properties to avoid TypeScript method bivariance. */
export function strictMethods(file: ts.SourceFile): ts.SourceFile {
  const transformed = ts.transform(file, [context => root => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isMethodSignature(node)) return ts.factory.createPropertySignature(node.modifiers, node.name,
        node.questionToken, ts.factory.createFunctionTypeNode(node.typeParameters, node.parameters, node.type!));
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  const text = ts.createPrinter().printFile(transformed.transformed[0]);
  transformed.dispose();
  return ts.createSourceFile(file.fileName, text, ts.ScriptTarget.Latest, true);
}

export function createServiceCompatibilityProgram(currentEntry: string, baseline: ServiceReleaseBaseline,
  options: ts.CompilerOptions, overrides: ReadonlyMap<string, string> = new Map()) {
  if (serviceBaselineDigest(baseline.files) !== baseline.digest)
    throw new Error('Released service signature baseline digest does not match: ' + baseline.release);
  const base = resolve('.service-contract-release', baseline.release);
  const snapshots = new Map(Object.entries(baseline.files).map(([file, text]) => [resolve(base, file), text]));
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), source = host.getSourceFile.bind(host);
  host.readFile = file => overrides.get(resolve(file)) ?? snapshots.get(resolve(file)) ?? read(file);
  host.fileExists = file => overrides.has(resolve(file)) || snapshots.has(resolve(file)) || exists(file);
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = directory => [...snapshots.keys(), ...overrides.keys()]
    .some(file => file.startsWith(resolve(directory) + '\\') || file.startsWith(resolve(directory) + '/')) || !!directoryExists?.(directory);
  host.getSourceFile = (file, language, onError, shouldCreate) => {
    const path = resolve(file), text = overrides.get(path) ?? snapshots.get(path);
    const input = text === undefined ? source(file, language, onError, shouldCreate) :
      ts.createSourceFile(file, text, language, true);
    return input && (path === resolve(currentEntry) || snapshots.has(path)) ? strictMethods(input) : input;
  };
  const baselineEntry = resolve(base, baseline.entry);
  return { program: ts.createProgram([resolve(currentEntry), baselineEntry], options, host), baselineEntry };
}

/** In addition to assignability, retain every named DTO field, including optional fields. */
export function serviceCompatibilityErrors(program: ts.Program, currentEntry: string, baselineEntry: string): string[] {
  const checker = program.getTypeChecker(), current = program.getSourceFile(resolve(currentEntry))!,
    previous = program.getSourceFile(resolve(baselineEntry))!, errors: string[] = [];
  const declarations = (source: ts.SourceFile) => new Map(source.statements
    .filter((node): node is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    .map(node => [node.name.text, checker.getTypeAtLocation(node)]));
  const before = declarations(previous), after = declarations(current);
  const retained = (old: ts.Type, next: ts.Type, path: string, seen: Map<ts.Type, Set<ts.Type>>) => {
    if (seen.get(old)?.has(next)) return;
    if (!seen.has(old)) seen.set(old, new Set());
    seen.get(old)!.add(next);
    if (!(old.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) &&
      next.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
      errors.push(path + ': released type was replaced by an opaque any/unknown declaration'); return;
    }
    // Pair discriminated alternatives through assignability. Parameter widening can introduce alternatives.
    if (old.isUnion() || next.isUnion()) {
      for (const choice of old.isUnion() ? old.types : [old]) {
        const alternatives = next.isUnion() ? next.types : [next];
        const match = alternatives.find(value => checker.isTypeAssignableTo(choice, value) && checker.isTypeAssignableTo(value, choice)) ||
          alternatives.find(value => checker.isTypeAssignableTo(value, choice)) ||
          alternatives.find(value => checker.isTypeAssignableTo(choice, value));
        if (match) retained(choice, match, path, seen);
      }
      return;
    }
    if (old.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter) ||
      next.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) return;
    if (!(old.flags & ts.TypeFlags.Object) || !(next.flags & ts.TypeFlags.Object)) return;
    const oldArguments = old.flags & ts.TypeFlags.Object && (old as ts.TypeReference).typeArguments;
    const nextArguments = next.flags & ts.TypeFlags.Object && (next as ts.TypeReference).typeArguments;
    if (oldArguments && nextArguments) {
      oldArguments.forEach((value, index) => { if (nextArguments[index]) retained(value, nextArguments[index], path + '<' + index + '>', seen); });
    }
    if (checker.isArrayType(old) || checker.isTupleType(old)) return;
    const owned = (type: ts.Type) => [...(type.symbol?.declarations || []), ...(type.aliasSymbol?.declarations || [])].some(node => {
      const name = relative(process.cwd(), node.getSourceFile().fileName).replaceAll('\\', '/');
      return name.startsWith('shared/') || name.startsWith('server/service-contracts/') || name.startsWith('.service-contract-release/');
    }) || (!type.symbol && type.getProperties().length > 0);
    // Package objects (streams, sockets, AbortSignal) are checked by TypeScript assignability.
    if (owned(old)) for (const member of old.getProperties()) {
      const replacement = next.getProperty(member.name);
      if (!replacement) { errors.push(path + '.' + member.name + ': released field or method was removed'); continue; }
      retained(checker.getTypeOfSymbolAtLocation(member, previous),
        checker.getTypeOfSymbolAtLocation(replacement, current), path + '.' + member.name, seen);
    }
    const oldCalls = checker.getSignaturesOfType(old, ts.SignatureKind.Call), nextCalls = checker.getSignaturesOfType(next, ts.SignatureKind.Call);
    for (let index = 0; index < oldCalls.length; index++) {
      const signature = oldCalls[index], replacement = nextCalls[index] || nextCalls[0];
      if (!replacement) continue; // Assignability reports the incompatible call signature.
      signature.parameters.forEach((parameter, at) => {
        const nextParameter = replacement.parameters[at];
        if (nextParameter) retained(checker.getTypeOfSymbolAtLocation(parameter, previous),
          checker.getTypeOfSymbolAtLocation(nextParameter, current), path + '(argument ' + at + ')', seen);
      });
      retained(checker.getReturnTypeOfSignature(signature), checker.getReturnTypeOfSignature(replacement), path + '(return)', seen);
    }
  };
  for (const [name, old] of before) {
    const next = after.get(name);
    if (!next) { errors.push(name + ': released V1 declaration was removed'); continue; }
    if (!checker.isTypeAssignableTo(next, old)) errors.push(name + ': incompatible released V1 signature (parameters must accept old inputs and returns must preserve old outputs)');
    retained(old, next, name, new Map());
  }
  return errors;
}

export function assertServiceBaselineCompatibility(entry: string, options: ts.CompilerOptions,
  baseline: ServiceReleaseBaseline, overrides: ReadonlyMap<string, string> = new Map()) {
  const inputs = createServiceCompatibilityProgram(entry, baseline, options, overrides);
  const diagnostics = inputs.program.getSemanticDiagnostics().filter(item => item.file &&
    (item.file.fileName.includes('.service-contract-release') || resolve(item.file.fileName) === resolve(entry)));
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
  const errors = serviceCompatibilityErrors(inputs.program, entry, inputs.baselineEntry);
  if (errors.length) throw new Error('Released service compatibility violations (' + baseline.release + '):\n' + errors.join('\n'));
}

export async function assertReleasedServiceCompatibility(entry: string, options: ts.CompilerOptions,
  settings: { directory?: string; overrides?: ReadonlyMap<string, string> } = {}) {
  for (const baseline of await readServiceReleaseBaselines(settings.directory))
    assertServiceBaselineCompatibility(entry, options, baseline, settings.overrides);
}
