/** 检查插件源码的 manifest、服务与路由契约使用，核对声明能力与实际实现的对应关系。
 * Inspect browser/server plugin entry declarations and public service capabilities to enforce independent source contracts. */
import { isBuiltin } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import { staticString } from './network-boundaries.ts';

/** 生成规范工作区相对源码标签，供插件所属和诊断共用。
 * Produce normalized workspace-relative source labels for ownership and diagnostics. */
const label = (file: string) => relative(process.cwd(), resolve(file)).replaceAll('\\', '/');
/** 从明确 plugins/<id>/ 路径提取插件 owner，其他源不冒充插件。
 * Extract ownership from explicit plugins/<id>/ paths, leaving other sources unowned. */
const owner = (file: string) => /^plugins\/([^/]+)\//.exec(label(file))?.[1];
/** 判断符号是否来自历史兼容服务 getter，供官方插件源码拒绝隐式服务依赖。
 * Detect symbols from legacy compatibility getters so official plugins cannot hide service dependencies. */
const compatibilityMember = (symbol: ts.Symbol | undefined) => symbol?.declarations?.some(
  declaration => label(declaration.getSourceFile().fileName) === 'server/plugin-services.ts',
);

/** Repository authoring rules supplement the runtime broker; they do not change API 5. */
/** 核对客户端贡献和 manifest 精确一致，并检查浏览器依赖及服务器显式 ServiceRef 边界，返回去重诊断。
 * Validate exact client contribution/manifest agreement and browser/server explicit-ServiceRef boundaries, returning deduplicated diagnostics. */
export function pluginSourceContractErrors(program: ts.Program, catalog: readonly PluginManifest[]): string[] {
  const checker = program.getTypeChecker();
  const errors: string[] = [];
  /** 附带源文件与一基行号累计边界诊断，不中断遍历，以便一次报告全部违规。
   * Accumulate boundary diagnostics with source path/one-based line without stopping traversal, reporting all violations together. */
  const report = (node: ts.Node, message: string) => {
    const file = node.getSourceFile();
    errors.push(`${label(file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${message}`);
  };
  /** 优先按相对源码候选解析 import，再用 TS 模块解析，未找到返回 undefined。
   * Resolve relative source candidates first, then TS modules, returning undefined when absent. */
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
  /** 遍历源码收集静态/类型/动态 import 和 require 的来源节点与 specifier。
   * Collect source nodes/specifiers for static/type/dynamic imports and require throughout the AST. */
  const imports = (file: ts.SourceFile) => {
    const found: { node: ts.Node; specifier: string }[] = [];
    /** 递归检查 import 形式或兼容 getter/解构使用，保留具体源节点用于精确诊断。
     * Recursively inspect import forms or compatibility getter/destructuring uses, retaining source nodes for precise diagnostics. */
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
  /** 遍历插件浏览器依赖闭包一次，拒绝 Node builtin/服务端实现，只继续自有 shared/plugin 源。
   * Walk plugin-browser dependency closure once, rejecting Node/server imports and continuing only owned shared/plugin sources. */
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
  /** 核对服务器跨插件依赖直接声明且仅通过 public services.ts，再检查本插件对兼容服务的访问。
   * Require declared direct cross-plugin dependencies through public services.ts and inspect own compatibility-service access. */
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
    /** 递归检查 import 形式或兼容 getter/解构使用，保留具体源节点用于精确诊断。
     * Recursively inspect import forms or compatibility getter/destructuring uses, retaining source nodes for precise diagnostics. */
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

/** 建立插件源码 program 并调用契约检查，配置或边界诊断失败一次抛出全部问题。
 * Build the plugin-source program and throw all configuration/boundary diagnostics together. */
export function assertPluginSourceContracts(catalog: readonly PluginManifest[]) {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, '.');
  const files = ts.sys.readDirectory(resolve('plugins'), ['.ts', '.tsx']);
  const program = ts.createProgram(files, parsed.options);
  const errors = pluginSourceContractErrors(program, catalog);
  if (errors.length) throw new Error(errors.join('\n'));
}
