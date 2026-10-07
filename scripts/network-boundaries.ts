/** 通过 AST 检查直接网络 API、动态导入及包装器使用，要求网络能力遵循声明的受管理入口。
 * Inspect AST imports/aliases/value references to enforce the managed network adapter boundary and reject direct unowned network creation. */
import ts from 'typescript';

const modules = new Set([
  'net',
  'http',
  'https',
  'http2',
  'tls',
  'dgram',
  'dns',
  'dns/promises',
  'undici',
  'node-fetch',
  'cross-fetch',
  'axios',
  'got',
]);
const pure: Record<string, Set<string>> = {
  net: new Set(['isIP', 'isIPv4', 'isIPv6']),
  tls: new Set(['createSecureContext', 'TLSSocket', 'checkServerIdentity', 'rootCertificates']),
};
const globals = new Set(['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']);
const adapterModules = new Set(['ws', 'ssh2', '@aws-sdk/client-s3']);
/** 去掉 node: 前缀，将 builtin 与短模块名规范到相同网络禁用表。
 * Remove node: prefixes so builtin/short names share the forbidden-network table. */
const moduleName = (value: string) => value.replace(/^node:/, '');

/** 只从静态字符串 AST 提取值，动态表达式返回 undefined 交给调用者保守处理。
 * Extract only static string AST values, leaving dynamic expressions undefined for conservative handling. */
export function staticString(node: ts.Node | undefined): string | undefined {
  if (!node) return;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left),
      right = staticString(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
}

/** 从标识符、字面量或静态计算键取得成员名，无法证明的键返回 undefined。
 * Extract member names from identifiers/literals/static computed keys, returning undefined when unproven. */
function propertyName(node: ts.Node) {
  return ts.isIdentifier(node)
    ? node.text
    : ts.isComputedPropertyName(node)
      ? staticString(node.expression)
      : staticString(node);
}

/** 沿父链识别类型位置，区分声明引用与实际运行网络调用。
 * Inspect ancestry for type positions to distinguish declaration references from runtime network calls. */
function inType(node: ts.Node) {
  for (let parent: ts.Node | undefined = node; parent; parent = parent.parent)
    if (ts.isTypeNode(parent)) return true;
  return false;
}

/** 排除字段名、绑定/参数声明与类型引用，仅把实际值使用作为网络别名来源。
 * Exclude property names/bindings/parameters/type refs and identify actual value uses for network alias tracking. */
function valueReference(node: ts.Identifier) {
  const parent = node.parent;
  if (inType(node)) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node))
  )
    return false;
  return !('name' in parent && parent.name === node);
}

/** A repository source guard, not an OS sandbox or an arbitrary-code verifier. */
/** 分析网络 import/别名/构造调用，要求 socket、fetch、SSH/S3 走受管入口，并返回精确源诊断。
 * Analyze network imports/aliases/construction, requiring managed socket/fetch/SSH/S3 entry points and returning source diagnostics. */
export function networkBoundaryErrors(file: string, source: ts.SourceFile): string[] {
  file = file.replaceAll('\\', '/');
  if (file.startsWith('server/network/')) return [];
  const errors: string[] = [];
  /** 附带源文件与一基行号累计边界诊断，不中断遍历，以便一次报告全部违规。
   * Accumulate boundary diagnostics with source path/one-based line without stopping traversal, reporting all violations together. */
  const report = (node: ts.Node, message: string) =>
    errors.push(
      `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`,
    );
  // Bind this file only: an injected fetch parameter does not exempt globals in
  // another lexical scope. Dependencies are traversed by the architecture gate.
  const options = { noLib: true, noResolve: true, allowJs: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = /** 把语法分析器取源入口限定为当前文件，其他文件返回 undefined，边界审计无需引入依赖图中的外部实现。
 * Restrict the parser’s source lookup to this file and return undefined for others, keeping the boundary audit independent of external implementation graphs. */ (name) => (name === source.fileName ? source : undefined);
  const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
  /** 递归收集 import/变量来源，以便后续别名解析不依赖语句顺序。
   * Collect import/variable origins recursively so alias resolution does not depend on statement order. */
  const declarations = (node: ts.Identifier) =>
    (ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node)
    )?.declarations || [];
  /** 沿已登记标识符/属性/绑定追溯模块与成员来源，防环并保守处理不明值。
   * Trace module/member origin through registered identifiers/properties/bindings with cycle guards and conservative unknown handling. */
  function origin(
    node: ts.Expression,
    seen = new Set<ts.Node>(),
  ): { module: string; name: string } | undefined {
    if (seen.has(node)) return;
    seen.add(node);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
      return origin(node.expression, seen);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = origin(node.expression, seen);
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : staticString(node.argumentExpression);
      if (base && name && base.name === '*') return { module: base.module, name };
    }
    if (!ts.isIdentifier(node)) return;
    const bound = declarations(node);
    if (!bound.length && ['globalThis', 'global'].includes(node.text)) return { module: 'global', name: '*' };
    if (!bound.length && globals.has(node.text)) return { module: 'global', name: node.text };
    for (const declaration of bound) {
      if (ts.isImportSpecifier(declaration)) {
        const specifier = declaration.parent.parent.parent.moduleSpecifier;
        if (ts.isStringLiteralLike(specifier))
          return {
            module: moduleName(specifier.text),
            name: (declaration.propertyName || declaration.name).text,
          };
      }
      if (ts.isImportClause(declaration) || ts.isNamespaceImport(declaration)) {
        const specifier = (ts.isImportClause(declaration) ? declaration.parent : declaration.parent.parent)
          .moduleSpecifier;
        if (ts.isStringLiteralLike(specifier))
          return {
            module: moduleName(specifier.text),
            name: ts.isImportClause(declaration) && specifier.text === 'ws' ? 'WebSocket' : '*',
          };
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer)
        return origin(declaration.initializer, seen);
      if (ts.isBindingElement(declaration) && ts.isVariableDeclaration(declaration.parent.parent)) {
        const initializer = declaration.parent.parent.initializer;
        const base = initializer && origin(initializer, seen);
        const name = propertyName(declaration.propertyName || declaration.name);
        if (base?.name === '*' && name) return { module: base.module, name };
      }
    }
  }
  /** 识别静态 require/import 模块加载及返回别名，不能证明静态模块时保持拒绝边界。
   * Recognize static require/import loaders and result aliases, retaining refusal boundaries when static provenance is unproven. */
  function moduleLoader(expression: ts.Expression): boolean {
    if (
      expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(expression) && expression.text === 'require') ||
      (ts.isPropertyAccessExpression(expression) &&
        ['require', 'getBuiltinModule'].includes(expression.name.text))
    )
      return true;
    if (ts.isIdentifier(expression))
      for (const declaration of declarations(expression))
        if (
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer)
        ) {
          const factory = origin(declaration.initializer.expression);
          if (factory?.module === 'module' && factory.name === 'createRequire') return true;
        }
    return false;
  }
  /** 针对 builtin 网络与外部客户端模块核对当前文件是否为允许的受管实现。
   * Validate whether the current source may use a builtin network/external-client module as an allowed managed implementation. */
  const checkModule = (node: ts.ImportDeclaration | ts.ExportDeclaration) => {
    if (!node.moduleSpecifier || !ts.isStringLiteralLike(node.moduleSpecifier)) return;
    const module = moduleName(node.moduleSpecifier.text);
    if (!modules.has(module) && !(ts.isExportDeclaration(node) && adapterModules.has(module))) return;
    if (ts.isExportDeclaration(node)) {
      if (
        !node.isTypeOnly &&
        !(
          node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length &&
          node.exportClause.elements.every((entry) => entry.isTypeOnly)
        )
      )
        report(node, 'Network primitives must be provided by server/network');
      return;
    }
    if (node.importClause?.isTypeOnly) return;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || node.importClause?.name)
      return report(node, 'Direct network module import is forbidden; use networkFor');
    for (const entry of bindings.elements) {
      const name = (entry.propertyName || entry.name).text;
      if (!entry.isTypeOnly && !pure[module]?.has(name))
        report(entry, `Direct network primitive ${module}.${name}; use networkFor`);
    }
  };
  /** 递归检查网络值使用、构造及选项，要求 S3 显式凭据、WebSocketServer noServer 与受管 SSH sock。
   * Recursively inspect network uses/construction/options, requiring explicit S3 credentials, noServer WebSocket servers and managed SSH sockets. */
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) checkModule(node);
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = staticString(node.moduleReference.expression);
      if (specifier && modules.has(moduleName(specifier)))
        report(node, 'Direct network module import is forbidden; use networkFor');
    }
    if (ts.isCallExpression(node)) {
      const specifier = staticString(node.arguments[0]);
      if (
        moduleLoader(node.expression) &&
        specifier &&
        (modules.has(moduleName(specifier)) || adapterModules.has(moduleName(specifier)))
      )
        report(node, 'Dynamic network imports must remain inside server/network');
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !inType(node)) {
      const target = origin(node);
      if (target?.module === 'global' && globals.has(target.name))
        report(node, 'Global network primitive bypasses the network runtime');
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      origin(node.initializer)?.module === 'global'
    )
      for (const entry of node.name.elements)
        if (globals.has(propertyName(entry.propertyName || entry.name) || ''))
          report(entry, 'Global network primitive bypasses the network runtime');
    if (ts.isIdentifier(node) && globals.has(node.text) && valueReference(node) && !declarations(node).length)
      report(node, 'Unmanaged network primitive; inject networkFor(...).fetch or a managed socket');
    if (ts.isNewExpression(node)) {
      const target = origin(node.expression);
      const name = target?.name || node.expression.getText(source);
      if (name === 'S3Client') {
        const options = node.arguments?.[0];
        const properties = options && ts.isObjectLiteralExpression(options) ? options.properties : [];
        if (
          !properties.some(
            (entry) =>
              (ts.isShorthandPropertyAssignment(entry) && entry.name.text === 'requestHandler') ||
              (ts.isPropertyAssignment(entry) &&
                propertyName(entry.name) === 'requestHandler' &&
                ts.isCallExpression(entry.initializer) &&
                ts.isPropertyAccessExpression(entry.initializer.expression) &&
                entry.initializer.expression.name.text === 'requestHandler'),
          )
        )
          report(node, 'S3 clients require an explicit managed requestHandler()');
        if (
          !properties.some(
            (entry) =>
              (ts.isShorthandPropertyAssignment(entry) && entry.name.text === 'credentials') ||
              (ts.isPropertyAssignment(entry) &&
                propertyName(entry.name) === 'credentials' &&
                entry.initializer.kind !== ts.SyntaxKind.NullKeyword &&
                entry.initializer.getText(source) !== 'undefined'),
          )
        )
          report(
            node,
            'S3 clients require explicit credentials; the default provider chain can bypass managed networking',
          );
      }
      if (['WebSocket', 'Socket', 'TLSSocket', 'EventSource', 'XMLHttpRequest'].includes(name))
        report(node, 'Socket construction must remain inside server/network');
      if (target?.module === 'ws' && name === 'WebSocketServer') {
        const options = node.arguments?.[0];
        if (
          !options ||
          !ts.isObjectLiteralExpression(options) ||
          !options.properties.some(
            (entry) =>
              ts.isPropertyAssignment(entry) &&
              propertyName(entry.name) === 'noServer' &&
              entry.initializer.kind === ts.SyntaxKind.TrueKeyword,
          )
        )
          report(node, 'WebSocket servers must use noServer and the managed HTTP listener');
      }
      if (target?.module === 'ssh2' && name === 'Client' && file !== 'server/vm-transport.ts')
        report(node, 'VM SSH clients belong to vm-transport with a managed sock');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}
