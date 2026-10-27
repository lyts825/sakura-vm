/** 插件源码的 AST 边界检查，约束服务访问、跨插件依赖及只允许的公开能力入口。
 * Inspect runtime imports/loaders against plugin ownership rules and report cross-plugin or shared-scope violations. */
import ts from 'typescript';
import { posix } from 'node:path';
import { staticString } from './network-boundaries.ts';

// Host adapters consume the implementation; domain services consume VmAccess.
const hostAdapters = new Set([
  'server/application.ts',
  'server/application-services.ts',
  'server/http-machines.ts',
  'server/plugin-capabilities.ts',
  'server/plugin-manager.ts',
  'server/plugin-runtime.ts',
  'server/system-services.ts',
  'server/terminal-backend.ts',
  'server/vm-access.ts',
  'server/vm-transport.ts',
]);
/** 按插件 owner 与入口规则检查 AST 依赖/loader，阻止跨插件实现或公共层接管插件资源。
 * Check AST dependencies/loaders against plugin ownership/entry rules, excluding cross-plugin implementations or shared resource adoption. */
export function pluginBoundaryErrors(file: string, source: ts.SourceFile): string[] {
  file = file.replaceAll('\\', '/');
  if (!file.startsWith('server/') && !file.startsWith('plugins/')) return [];
  const errors: string[] = [];
  const requireFactories = new Set(['createRequire']);
  const loaders = new Set(['require']);
  const moduleObjects = new Set(['module']);
  /** 附带源文件与一基行号累计边界诊断，不中断遍历，以便一次报告全部违规。
   * Accumulate boundary diagnostics with source path/one-based line without stopping traversal, reporting all violations together. */
  const report = (node: ts.Node, message: string) =>
    errors.push(
      `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`,
    );
  /** 规范相对导入并核对调用方和目标插件 owner，报告不受允许的跨边界依赖。
   * Normalize relative imports and compare source/target owners, reporting forbidden cross-boundary dependencies. */
  const dependency = (node: ts.Node, specifier: string | undefined, names?: string[]) => {
    if (!specifier) return;
    specifier = specifier.replaceAll('\\', '/');
    const path = posix.normalize(specifier.startsWith('.')
      ? posix.join(posix.dirname(file), specifier) : specifier).replace(/\.[cm]?[jt]sx?$/, '');
    if (path.startsWith('server/application/') && !/^server\/application(?:[./-])/.test(file))
      report(node, 'Only application composition modules may import service assembly stages');
    if (
      /(?:^|\/)machines$/.test(path) &&
      !hostAdapters.has(file) &&
      (!names || names.includes('Machines'))
    )
      report(node, 'Domain services must use the instance-bound VmAccess interface');
    if (
      file.startsWith('plugins/') &&
      /(?:^|\/)server\/(?:paths|plugin-(?:runtime|manager|authority|scope|capabilities|metadata)|vm-(?:reference|access)|live-migration-proof|system-services|service-broker)$/.test(path)
    )
      report(node, 'Plugin entries may not import host authority or filesystem resolution adapters');
    if (file.startsWith('plugins/') && /(?:^|\/)server\/live-migration-runner$/.test(path) &&
      (!names || names.includes('registerLiveMigrationCompletionPort')))
      report(node, 'Plugin entries may not import host migration proof registration');
  };
  /** 识别动态模块加载的 require 来源，防止别名加载器绕过插件规则。
   * Identify require origins in dynamic loading so aliases cannot bypass plugin rules. */
  const moduleRequire = (expression: ts.Expression) => ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'require' && ts.isIdentifier(expression.expression) &&
    moduleObjects.has(expression.expression.text);
  /** 预收集模块加载别名与绑定，供 AST 主遍历核实实际入口。
   * Precollect loader aliases/bindings for the main AST pass to verify actual entry points. */
  function collectLoaders(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ['module', 'node:module'].includes(staticString(node.moduleSpecifier) || '')) {
      const clause = node.importClause, bindings = clause?.namedBindings;
      if (clause?.name) moduleObjects.add(clause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) moduleObjects.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const item of bindings.elements)
          if ((item.propertyName || item.name).text === 'createRequire') requireFactories.add(item.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = node.initializer;
      if (ts.isIdentifier(value)) {
        if (loaders.has(value.text)) loaders.add(node.name.text);
        if (requireFactories.has(value.text)) requireFactories.add(node.name.text);
        if (moduleObjects.has(value.text)) moduleObjects.add(node.name.text);
      }
      if (moduleRequire(value)) loaders.add(node.name.text);
      if (ts.isPropertyAccessExpression(value) && value.name.text === 'createRequire') requireFactories.add(node.name.text);
      if (ts.isCallExpression(value)) {
        const factory = value.expression;
        if (ts.isIdentifier(factory) && requireFactories.has(factory.text) ||
          ts.isPropertyAccessExpression(factory) && factory.name.text === 'createRequire') loaders.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectLoaders);
  }
  // A route may reference a loader declared later, or an alias chain in another lexical block.
  let count = -1;
  while (count !== requireFactories.size + loaders.size + moduleObjects.size) {
    count = requireFactories.size + loaders.size + moduleObjects.size;
    collectLoaders(source);
  }
  /** 遍历静态与动态加载及 owner 相关访问，统一检查插件边界并继续全部子节点。
   * Traverse static/dynamic loads and owner-related access, applying plugin rules to all children. */
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const path = staticString(node.moduleSpecifier);
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
      const elements =
        bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
          ? bindings.elements
          : undefined;
      dependency(node, path, elements?.map(item => (item.propertyName || item.name).text));
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      dependency(node, staticString(node.moduleReference.expression));
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      dependency(node, staticString(node.argument.literal),
        node.qualifier && ts.isIdentifier(node.qualifier) ? [node.qualifier.text] : undefined);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && loaders.has(node.expression.text) ||
      ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'require')) {
      const path = staticString(node.arguments[0]);
      const loading = node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ts.isIdentifier(node.expression) && loaders.has(node.expression.text) || moduleRequire(node.expression);
      if (loading && !path && file.startsWith('plugins/'))
        report(node, 'Plugin module dependencies must use statically declared paths');
      else dependency(node, path);
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'fileBeforeReplace')
      report(node, 'Single global hooks must use managed interceptor registrations');
    if (
      file.startsWith('plugins/') &&
      ts.isPropertyAccessExpression(node) &&
      ['machines', 'compat', 'dataFile', 'extraJobStores'].includes(node.name.text)
    )
      report(node, 'Plugin contexts expose only public services and instance capabilities');
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'ProjectTerminals' && file !== 'server/terminal-backend.ts')
        report(node, 'Project terminals must use the shared provider and independently owned handles');
      if (node.expression.text === 'Jobs') {
        let scoped = false;
        for (let parent = node.parent; parent; parent = parent.parent)
          if (ts.isClassDeclaration(parent) || ts.isFunctionLike(parent)) {
            scoped = true;
            break;
          }
        if (!scoped)
          report(node, 'Jobs must be constructed inside an instance activation or owned domain service');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}
