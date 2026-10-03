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
const moduleName = (value: string) => value.replace(/^node:/, '');

export function staticString(node: ts.Node | undefined): string | undefined {
  if (!node) return;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left),
      right = staticString(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
}

function propertyName(node: ts.Node) {
  return ts.isIdentifier(node)
    ? node.text
    : ts.isComputedPropertyName(node)
      ? staticString(node.expression)
      : staticString(node);
}

function inType(node: ts.Node) {
  for (let parent: ts.Node | undefined = node; parent; parent = parent.parent)
    if (ts.isTypeNode(parent)) return true;
  return false;
}

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
export function networkBoundaryErrors(file: string, source: ts.SourceFile): string[] {
  file = file.replaceAll('\\', '/');
  if (file.startsWith('server/network/')) return [];
  const errors: string[] = [];
  const report = (node: ts.Node, message: string) =>
    errors.push(
      `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`,
    );
  // Bind this file only: an injected fetch parameter does not exempt globals in
  // another lexical scope. Dependencies are traversed by the architecture gate.
  const options = { noLib: true, noResolve: true, allowJs: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === source.fileName ? source : undefined);
  const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
  const declarations = (node: ts.Identifier) =>
    (ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node)
    )?.declarations || [];
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
