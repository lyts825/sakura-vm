/** AST 资源访问检查，要求服务源码通过已声明的资源入口操作受约束文件和运行时对象。
 * Inspect imports and resource operations against ownership/type rules and report unmediated or embedded-resource access. */
import ts from 'typescript';
import { staticString } from './network-boundaries.ts';

const processes = new Set(['server/host-process.ts', 'server/process-supervisor.ts', 'server/network/host-pool.ts']);
// These are protocol/authority deadlines, not ordinary periodic business jobs.
const protocolTimers = new Set(['server/ha-host-failover.ts',
  'server/ha-local-failovers.ts', 'server/ha-witness-server.ts', 'server/machines.ts',
  'server/domains/sandbox-lifetimes.ts',
  'server/network/host-pool.ts', 'server/session-lock.ts']);
// Exclusive creation and domain recovery receipts have their own publication rules.
const receipts = new Set(['server/ha-witness-drill.ts', 'server/ha-witness-core.ts',
  'server/ha-witness-lock.ts', 'server/ha-witness-maintenance.ts', 'server/machines.ts',
  'server/domains/vm-disk-encryption.ts',
  'server/domains/vm-snapshots.ts',
  'server/project-service-scope.ts', 'server/storage-pools.ts', 'server/trusted-boot-service.ts',
  'server/local-store.ts', 'server/metadata-store.ts']);
/** 规范 node: 模块前缀，统一资源 API 禁用判断。
 * Normalize node: prefixes for consistent forbidden resource-API detection. */
const moduleName = (name: string) => name.replace(/^node:/, '');

/** Source enforcement for reviewed runtime adapters, not a sandbox for arbitrary code. */
/** 按源码身份检查文件/进程/服务资源访问，防止公开边界直接获取实现所有权，返回源诊断。
 * Check file/process/service resource access by source identity, preventing public boundaries from directly obtaining implementation ownership. */
export function resourceBoundaryErrors(file: string, source: ts.SourceFile): string[] {
  file = file.replaceAll('\\', '/');
  if (!file.startsWith('server/') && !file.startsWith('plugins/')) return [];
  if (/^plugins\/[^/]+\/client\./.test(file)) return [];
  const errors: string[] = [], fileWriters = new Set(['writeFile', 'writeFileSync']);
  const requireFactories = new Set(['createRequire']), loaders = new Set(['require']);
  /** 附带源文件与一基行号累计边界诊断，不中断遍历，以便一次报告全部违规。
   * Accumulate boundary diagnostics with source path/one-based line without stopping traversal, reporting all violations together. */
  const report = (node: ts.Node, message: string) => errors.push(
    `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);
  /** 沿 AST 父链区分纯类型位置，避免把声明引用误判为资源取得。
   * Distinguish type-only positions through AST ancestry to avoid treating declarations as resource acquisition. */
  const isType = (node: ts.Node) => {
    for (let parent: ts.Node | undefined = node; parent; parent = parent.parent)
      if (ts.isTypeNode(parent)) return true;
    return false;
  };
  /** 按模块与访问成员判断是否为当前边界禁止的资源操作。
   * Determine whether a module/member access is a forbidden resource operation for the current boundary. */
  const forbidden = (specifier: string, names?: string[]) => {
    const module = moduleName(specifier);
    if (module === 'child_process' && !processes.has(file)) return 'Host processes must use the managed process adapters';
    if (module === 'worker_threads' && file !== 'server/compute-runtime.ts' && (!names || names.includes('Worker')))
      return 'Worker construction belongs to ComputeRuntime';
    if (['timers', 'timers/promises'].includes(module) && !protocolTimers.has(file) && (!names || names.includes('setInterval')))
      return 'Periodic work must use Scheduler';
    if (module === '@aws-sdk/lib-storage') return 'Multipart uploads must use the bounded object-upload adapter';
    if (file.startsWith('plugins/') && (/^(?:fs|fs\/promises|child_process|worker_threads)$/.test(module) ||
        /(?:^|\/)server\/(?:host-runtime(?:\/|$)|network(?:\/|$)|host-process\.|compute-runtime\.|storage-runtime\.)/.test(specifier)))
      return 'Plugins must obtain resource capabilities from their plugin scope';
  };
  /** 递归识别导入表达式的 JSON 资源声明，防止隐式静态资源绕过 owner。
   * Recursively identify JSON resource imports so implicit static resources cannot bypass ownership. */
  const containsJson = (node: ts.Node): boolean => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'JSON' &&
        node.expression.name.text === 'stringify') return true;
    return ts.forEachChild(node, containsJson) || false;
  };
  /** 扫描 import/require、成员访问与资源构造，跳过纯类型并累计所有违规。
   * Scan imports/require/member access/resource construction, skipping type-only uses and accumulating violations. */
  function visit(node: ts.Node) {
    if (isType(node)) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = staticString(node.moduleSpecifier);
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      if (clause?.isTypeOnly || (ts.isExportDeclaration(node) && node.isTypeOnly)) return;
      const bindings = clause?.namedBindings;
      const exports = ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause : undefined;
      const elements = bindings && ts.isNamedImports(bindings) ? bindings.elements : exports?.elements;
      const names = elements && !clause?.name ? elements.filter((entry) => !entry.isTypeOnly).map((entry) => (entry.propertyName || entry.name).text) : undefined;
      if (names && !names.length) return;
      if (specifier) {
        const error = forbidden(specifier, names);
        if (error) report(node, error);
        if (['fs', 'fs/promises'].includes(moduleName(specifier)) && bindings && ts.isNamedImports(bindings))
          for (const entry of bindings.elements)
            if (['writeFile', 'writeFileSync'].includes((entry.propertyName || entry.name).text)) fileWriters.add(entry.name.text);
        if (moduleName(specifier) === 'module' && bindings && ts.isNamedImports(bindings))
          for (const entry of bindings.elements)
            if ((entry.propertyName || entry.name).text === 'createRequire') requireFactories.add(entry.name.text);
      }
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = staticString(node.moduleReference.expression), error = specifier && forbidden(specifier);
      if (error) report(node, error);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const create = node.initializer.expression;
      if ((ts.isIdentifier(create) && requireFactories.has(create.text)) ||
          (ts.isPropertyAccessExpression(create) && create.name.text === 'createRequire')) loaders.add(node.name.text);
    }
    if (ts.isCallExpression(node)) {
      const specifier = staticString(node.arguments[0]);
      if (specifier && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && loaders.has(node.expression.text)) ||
          (ts.isPropertyAccessExpression(node.expression) && ['require', 'getBuiltinModule'].includes(node.expression.name.text)))) {
        const error = forbidden(specifier); if (error) report(node, error);
      }
      const name = ts.isIdentifier(node.expression) ? node.expression.text :
        ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      if (!receipts.has(file) && name && fileWriters.has(name) && node.arguments[1] && containsJson(node.arguments[1]))
        report(node, 'JSON publication must use MetadataStore/local-store or a reviewed domain receipt adapter');
    }
    if (ts.isIdentifier(node) && node.text === 'setInterval' && !protocolTimers.has(file)) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        if (['globalThis', 'global'].includes(parent.expression.getText(source))) report(node, 'Periodic work must use Scheduler');
      } else if (!ts.isImportSpecifier(parent) && !ts.isPropertyAssignment(parent) && !ts.isMethodDeclaration(parent))
        report(node, 'Periodic work must use Scheduler');
    }
    if (ts.isElementAccessExpression(node) && staticString(node.argumentExpression) === 'setInterval' &&
        ['globalThis', 'global'].includes(node.expression.getText(source)) && !protocolTimers.has(file))
      report(node, 'Periodic work must use Scheduler');
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}
