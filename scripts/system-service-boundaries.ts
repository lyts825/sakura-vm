/** 使用 TypeScript 类型检查器核对系统服务工厂与独立服务契约，约束返回类型和能力暴露。
 * Use checked types to enforce independent system-service factory contracts, return types and explicit dependency capabilities. */
import ts from 'typescript';
import { resolve } from 'node:path';
import { strictMethods } from './service-compatibility.ts';

/** Factory closures may carry scalar controls; service values must come from the declared resolver. */
/** 用已检查类型检测系统工厂隐式捕获服务、opaque 返回和别名调用，要求依赖来自生命周期 resolver。
 * Use checked types to detect captured services/opaque returns/aliased factory calls, requiring lifecycle-resolver dependencies. */
export function systemServiceFactoryErrors(source: ts.SourceFile, checker: ts.TypeChecker, contracts: readonly ts.Type[]) {
  const errors: string[] = [], inspected = new Set<ts.Symbol>();
  /** 附带源文件与一基行号累计边界诊断，不中断遍历，以便一次报告全部违规。
   * Accumulate boundary diagnostics with source path/one-based line without stopping traversal, reporting all violations together. */
  const report = (node: ts.Node, message: string) => errors.push(
    source.fileName + ':' + (source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1) + ': ' + message);
  const serviceTypes = contracts.filter(type => type.getProperties().some(member =>
    checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(member, source), ts.SignatureKind.Call).length));
  /** 递归识别服务契约或含服务成员对象，any/unknown 保守判为含服务，seen 防环并排除外部纯对象。
   * Recursively identify service contracts/containing objects, treat any/unknown conservatively and guard cycles/external plain types. */
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
  /** 判断节点为显式箭头或函数表达式，限定生命周期回调的可分析声明形式。
   * Recognize explicit arrow/function expressions as analyzable lifecycle callback declarations. */
  const inline = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
  /** 检查回调及其引用的局部 helper 是否捕获未声明服务，标量控制可保留，服务必须从 resolver 获取。
   * Check callbacks/referenced local helpers for undeclared service captures; scalar controls may remain but services must come from resolvers. */
  function callback(fn: ts.ArrowFunction | ts.FunctionExpression, origin: ts.Node = fn) {
    /** 区分声明名/类型与真实外部标识符引用，递归追查 helper 捕获并在原工厂位置报告。
     * Separate declaration/type names from actual external references, tracing helper captures and reporting at the original factory. */
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
            /** 递归核对系统工厂命名调用、显式对象/生命周期回调和 helper 服务捕获，禁止方法别名绕过 resolver。
             * Validate named factory calls/explicit objects/lifecycle callbacks/helper captures recursively, excluding aliases that bypass the resolver. */
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
  /** 递归核对系统工厂命名调用、显式对象/生命周期回调和 helper 服务捕获，禁止方法别名绕过 resolver。
   * Validate named factory calls/explicit objects/lifecycle callbacks/helper captures recursively, excluding aliases that bypass the resolver. */
  function visit(node: ts.Node) {
    /** 按类型识别非 this 的 SystemServices 值，用于限定工厂操作来源。
     * Identify non-this SystemServices values by checked type to bound factory provenance. */
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

/** 在内存严格化服务方法后编译所有实现，汇总工厂边界和绑定语义失败，不改变公开源。
 * Strictify service methods in memory and compile implementations, reporting factory/binding failures without altering public sources. */
export function assertSystemServiceFactories(files: readonly string[], options: ts.CompilerOptions,
  host: ts.CompilerHost = ts.createCompilerHost(options)) {
  const contractFile = resolve('server/service-contracts/v1.ts'), source = host.getSourceFile.bind(host);
  // A method-shaped contract is otherwise bivariant even with strictFunctionTypes.
  // Check implementations against function properties without rewriting public sources.
  host.getSourceFile = /** 保持编译器原 getSourceFile，仅对公共服务契约文件作严格方法投影，防止结构兼容把非法参数/返回变更隐藏。
 * Preserve compiler getSourceFile and project strict methods only for the public-service contract, preventing structural compatibility from hiding invalid parameter/result changes. */ (file, language, onError, fresh) => {
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
    /** 诊断格式器保留原文件名，便于定位工厂源。
     * Preserve original filenames for factory diagnostics. */
    getCanonicalFileName: file => file, /** 提供工作区路径用于 TS 诊断格式化。
 * Provide workspace paths for TS diagnostic formatting. */ getCurrentDirectory: () => process.cwd(), /** 固定 LF 诊断换行，保持跨平台输出一致。
 * Fix diagnostic newlines to LF for cross-platform consistency. */ getNewLine: () => '\n',
  }));
}
