import ts from 'typescript';
import { resolve } from 'node:path';
import { strictMethods } from './service-compatibility.ts';

/** Factory closures may carry scalar controls; service values must come from the declared resolver. */
export function systemServiceFactoryErrors(source: ts.SourceFile, checker: ts.TypeChecker, contracts: readonly ts.Type[]) {
  const errors: string[] = [], inspected = new Set<ts.Symbol>();
  const report = (node: ts.Node, message: string) => errors.push(
    source.fileName + ':' + (source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1) + ': ' + message);
  const serviceTypes = contracts.filter(type => type.getProperties().some(member =>
    checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(member, source), ts.SignatureKind.Call).length));
  const containsService = (type: ts.Type, seen = new Set<ts.Type>()): boolean => {
    if (seen.has(type)) return false;
    seen.add(type);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
    if (type.isUnionOrIntersection()) return type.types.some(value => containsService(value, seen));
    if (!(type.flags & ts.TypeFlags.Object) || checker.getSignaturesOfType(type, ts.SignatureKind.Call).length ||
      checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length) return false;
    if (serviceTypes.some(contract => checker.isTypeAssignableTo(type, contract))) return true;
    const declarations = type.symbol?.declarations || type.aliasSymbol?.declarations;
    if (declarations?.every(node => /[\\/]node_modules[\\/]|[\\/]typescript[\\/]lib[\\/]/.test(node.getSourceFile().fileName))) return false;
    return type.getProperties().some(member => containsService(checker.getTypeOfSymbolAtLocation(member, source), seen));
  };
  const inline = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
  function callback(fn: ts.ArrowFunction | ts.FunctionExpression, origin: ts.Node = fn) {
    const inspect = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        if ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node) || (ts.isVariableDeclaration(parent) && parent.name === node) ||
          ts.isTypeNode(parent)) return;
        const symbol = checker.getSymbolAtLocation(node);
        if (!symbol || symbol.declarations?.some(declaration => declaration.getSourceFile() === fn.getSourceFile() &&
          declaration.pos >= fn.pos && declaration.end <= fn.end)) return;
        // Named local callbacks cannot conceal a captured dependency.
        for (const declaration of symbol.declarations || []) {
          if (ts.isVariableDeclaration(declaration) && declaration.initializer && inline(declaration.initializer) && !inspected.has(symbol)) {
            inspected.add(symbol); callback(declaration.initializer, origin);
          }
          if (ts.isFunctionDeclaration(declaration) && declaration.body && !inspected.has(symbol)) {
            inspected.add(symbol);
            const visit = (child: ts.Node) => {
              if (ts.isIdentifier(child)) {
                const captured = checker.getSymbolAtLocation(child);
                if (captured && !captured.declarations?.some(item => item.getSourceFile() === declaration.getSourceFile() &&
                  item.pos >= declaration.pos && item.end <= declaration.end) && containsService(checker.getTypeAtLocation(child)))
                  report(origin, 'System factory helper captures a service dependency (' + child.text + '); resolve it from requires');
              }
              ts.forEachChild(child, visit);
            };
            visit(declaration.body);
          }
        }
        if (containsService(checker.getTypeAtLocation(node)))
          report(origin === fn ? node : origin, 'System factory captures a service dependency (' + node.text + '); resolve it from requires');
      }
      ts.forEachChild(node, inspect);
    };
    inspect(fn.body);
  }
  function visit(node: ts.Node) {
    const system = (value: ts.Expression) => value.kind !== ts.SyntaxKind.ThisKeyword &&
      checker.getTypeAtLocation(value).symbol?.name === 'SystemServices';
    if (ts.isPropertyAccessExpression(node) && system(node.expression) && ['start', 'register', 'construct'].includes(node.name.text) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node))
      report(node, 'System factory methods cannot be captured or aliased');
    if (ts.isElementAccessExpression(node) && system(node.expression))
      report(node, 'System factory access requires an explicit named method');
    if (ts.isVariableDeclaration(node) && node.initializer && system(node.initializer) && ts.isObjectBindingPattern(node.name) &&
      node.name.elements.some(member => ['start', 'register', 'construct'].includes((member.propertyName || member.name).getText(source))))
      report(node, 'System factory methods cannot be captured or aliased');
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      system(node.expression.expression)) {
      if (node.expression.name.text === 'construct') report(node, 'System factories must use the lifecycle resolver');
      if (['register', 'start'].includes(node.expression.name.text)) {
        const declaration = node.arguments[0];
        if (!declaration || !ts.isObjectLiteralExpression(declaration)) report(node, 'System factory declarations must be explicit object literals');
        else for (const member of declaration.properties) {
          if (ts.isSpreadAssignment(member) || ts.isShorthandPropertyAssignment(member) || !member.name || ts.isComputedPropertyName(member.name)) {
            report(member, 'System factory declarations cannot use spread, shorthand or computed members'); continue;
          }
          const name = ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name) ? member.name.text : undefined;
          if (!['create', 'initialize', 'dispose'].includes(name || '')) continue;
          if (!ts.isPropertyAssignment(member)) {
            report(member, 'System lifecycle callbacks require an inline function property'); continue;
          }
          if (!inline(member.initializer)) report(member, 'System lifecycle callbacks must explicitly receive the dependency resolver');
          else {
            if (name === 'create') {
              const signature = checker.getSignaturesOfType(checker.getTypeAtLocation(member.initializer), ts.SignatureKind.Call)[0];
              const result = signature && checker.getReturnTypeOfSignature(signature);
              const values = result?.symbol?.name === 'Promise' ? checker.getTypeArguments(result as ts.TypeReference) : result ? [result] : [];
              if (values.some(type => type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)))
                report(member, 'System factory returns an opaque type instead of a bound service implementation');
            }
            inspected.clear(); callback(member.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...new Set(errors)];
}

export function assertSystemServiceFactories(files: readonly string[], options: ts.CompilerOptions,
  host: ts.CompilerHost = ts.createCompilerHost(options)) {
  const contractFile = resolve('server/service-contracts/v1.ts'), source = host.getSourceFile.bind(host);
  // A method-shaped contract is otherwise bivariant even with strictFunctionTypes.
  // Check implementations against function properties without rewriting public sources.
  host.getSourceFile = (file, language, onError, fresh) => {
    const input = source(file, language, onError, fresh);
    return input && resolve(file) === contractFile ? strictMethods(input) : input;
  };
  const program = ts.createProgram([...files], options, host), checker = program.getTypeChecker();
  const declarations = program.getSourceFile(contractFile) || program.getSourceFile('server/service-contracts/v1.ts')!;
  const contracts = declarations.statements.filter(ts.isInterfaceDeclaration).map(node => checker.getTypeAtLocation(node));
  const errors = program.getSourceFiles().filter(source => {
    const file = resolve(source.fileName).replaceAll('\\', '/');
    return !file.includes('/node_modules/') && /\/(?:server|plugins)\//.test(file);
  }).flatMap(source => systemServiceFactoryErrors(source, checker, contracts));
  if (errors.length) throw new Error('System service dependency boundary violations:\n' + errors.join('\n'));
  const diagnostics = program.getSemanticDiagnostics().filter(item => item.file &&
    /\/(?:server|plugins)\//.test(resolve(item.file.fileName).replaceAll('\\', '/')));
  if (diagnostics.length) throw new Error('Service implementation bindings failed:\n' + ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
}
