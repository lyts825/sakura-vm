/** 验证版本服务接口的独立性和历史兼容性，从类型检查器提取公开成员并生成服务能力目录。
 * Verify versioned interface independence/history compatibility and derive the public service-member capability catalog from checked types. */
import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, isAbsolute, relative, resolve, win32 } from 'node:path';
import ts from 'typescript';
import { assertReleasedServiceCompatibility } from './service-compatibility.ts';
import { assertSystemServiceFactories } from './system-service-boundaries.ts';

// Only independent contract declarations are inputs. Implementations never enlarge this registry.
const sourcePath = 'server/service-contracts/v1.ts';
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, '.');
const program = ts.createProgram([sourcePath], parsed.options);
const checker = program.getTypeChecker();
const source = program.getSourceFile(sourcePath)!;
const contractRoot = realpathSync(resolve('server/service-contracts'));
const sharedRoot = realpathSync(resolve('shared'));
/** 按相对路径核对目录包含关系，兼顾 Windows 路径分隔和绝对路径逃逸。
 * Check containment through relative paths, covering Windows separators and absolute-path escape. */
const inside = (root: string, path: string) => {
  const pathFromRoot = relative(root, path);
  return !isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith('..' + win32.sep) &&
    !pathFromRoot.startsWith('../');
};
/** Contract imports use owned declarations, shared DTOs, or public package entry points. */
/** 只允许独立声明、共享 DTO、builtin 或公开包入口，解析真实路径后拒绝实现导入/目录逃逸。
 * Allow only independent declarations/shared DTOs/builtins/public package entries, resolving real paths before excluding implementations/escape. */
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
/** 递归遍历契约导入与引用闭包，保持 visited 防环，确保生成输入不被实现能力隐式扩大。
 * Walk contract imports/references with cycle tracking so implementation code cannot implicitly enlarge generated capabilities. */
export function assertIndependentServiceContracts(entry: ts.SourceFile, inputs = program) {
  const inspected = new Set<ts.SourceFile>();
  /** 验证单个 specifier 的独立来源，加载其 program 源并继续闭包检查，缺失依赖抛错。
   * Validate one specifier’s independent provenance, locate its program source and continue closure checks, throwing on absent dependencies. */
  const inspectImport = (specifier: string, file: ts.SourceFile) => {
    const path = assertServiceContractImport(specifier, file.fileName);
    if (path && (inside(contractRoot, path) || inside(sharedRoot, path))) {
      const dependency = inputs.getSourceFile(path) || inputs.getSourceFiles().find(candidate => resolve(candidate.fileName) === path);
      if (!dependency) throw new Error('Public service contract source is missing: ' + path);
      independentSource(dependency);
    }
  };
  /** 每个源只检查一次，扫描 AST 和 triple-slash 文件引用，防止引用绕开导入边界。
   * Inspect each source once across AST and triple-slash references so references cannot bypass import boundaries. */
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
  /** 识别静态/类型/动态 import 与 require 并统一核对，再递归子节点。
   * Recognize static/type/dynamic imports and require for common validation, then traverse child nodes. */
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
// Generation never updates the released baseline. Incompatible V1 edits need a new contract version.
await assertReleasedServiceCompatibility(sourcePath, parsed.options);
assertSystemServiceFactories(parsed.fileNames, parsed.options);
const descriptors: Record<string, { id: string; version: number; members: string[]; optional?: string[]; methods?: string[]; properties?: Record<string, string>; returns?: Record<string, string> }> = {};
const known = new Map<ts.Type, string>();
const assigned = new Map<ts.Type, string>();
/** 从接口后缀生成独立服务版本；保留所有既有 V1 ID。
 * Derive independent service versions from interface suffixes while preserving existing V1 IDs. */
const idFor = (name: string) => {
  const version = name.match(/V([1-9][0-9]*)$/)?.[1] ?? '1';
  return 'sakura.service.' + name.replace(/V[1-9][0-9]*$/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() + '.v' + version;
};
for (const node of source.statements)
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    known.set(checker.getTypeAtLocation(node), idFor(node.name.text));
/** 剥离唯一非空联合、Promise 和数组/tuple 包装；多种有效联合无法唯一描述时返回 undefined。
 * Unwrap sole nonnull unions, Promise and array/tuple wrappers; return undefined when alternatives are ambiguous. */
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
/** 仅从独立已知服务形状递归生成字符串成员/可选项/方法及嵌套返回关系；先登记类型防环，过滤进程局部 unique-symbol 键。
 * Recursively derive string members/optional/method/nested-return relations only from independent known service shapes, preregistering against cycles and excluding process-local symbol keys. */
function shape(raw: ts.Type, suggested: string, force = false): string | undefined {
  const type = underlying(raw);
  if (!type || !(type.flags & ts.TypeFlags.Object) || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) return;
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length) return;
  // The broker publishes string keys. Compiler-generated unique-symbol IDs are process-local.
  const members = type.getProperties().filter(member => !member.name.startsWith('__@'));
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
  const descriptor = descriptors[id] = { id, version: Number(id.match(/\.v([1-9][0-9]*)(?:\/|$)/)?.[1] ?? 1), members: members.map((member) => member.name).sort() } as (typeof descriptors)[string];
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
  '// 公开服务能力目录：仅由独立版本接口生成成员、方法及嵌套返回关系，供服务代理校验能力边界。\n' +
  '// Public service capabilities: derive members/methods/nested returns only from independent versioned interfaces for broker capability checks.\n' +
  "import type { ServiceContract } from './service-ref.ts';\n\n" +
  '/** 以稳定服务 ID 索引能力描述；members/optional/methods 限制公开访问，properties/returns 指向嵌套服务关系，描述数据不直接执行方法。\n' +
  ' * Index capabilities by stable service ID; members/optional/methods bound public access and properties/returns identify nested services. Descriptor data does not execute methods. */\n' +
  'export const PUBLIC_SERVICE_CONTRACTS: Readonly<Record<string, ServiceContract<any>>> = ' +
  JSON.stringify(Object.fromEntries(Object.entries(descriptors).sort(([a], [b]) => a.localeCompare(b))), null, 2) + ';\n';
const target = 'server/public-service-members.ts';
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== content)
    throw new Error('Service descriptors are stale: npx tsx scripts/service-contracts.ts');
} else await writeFile(target, content);
console.log(`Verified ${Object.keys(descriptors).length} explicit versioned service descriptors.`);
