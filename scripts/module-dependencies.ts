/** 统一提取源码的运行依赖；急切依赖用于初始化环检查，完整依赖用于浏览器和资源边界。
 * Extract runtime dependencies once; eager edges drive initialization-cycle checks and all edges drive boundary checks. */
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { staticString } from './network-boundaries.ts';

export interface ModuleDependency {
  specifier: string | undefined;
  eager: boolean;
  node: ts.Node;
}

/** 忽略纯类型声明，收集静态导入、再导出、import-equals、动态 import 和 require。
 * Ignore type-only declarations and collect imports, re-exports, import-equals, dynamic imports and require calls. */
export function moduleDependencies(source: ts.SourceFile): ModuleDependency[] {
  const dependencies: ModuleDependency[] = [];
  const add = (node: ts.Node, value: ts.Expression | undefined, eager: boolean) => {
    dependencies.push({ node, specifier: staticString(value), eager });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause,
        bindings = clause?.namedBindings;
      if (
        !clause?.isTypeOnly &&
        !(
          bindings &&
          ts.isNamedImports(bindings) &&
          !clause?.name &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly)
        )
      )
        add(node, node.moduleSpecifier, true);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const bindings = node.exportClause;
      if (
        !node.isTypeOnly &&
        !(
          bindings &&
          ts.isNamedExports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly)
        )
      )
        add(node, node.moduleSpecifier, true);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node, node.moduleReference.expression, true);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      // Calls can run later inside callbacks; they are boundary edges, not static initialization edges.
      add(node, node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return dependencies;
}

/** 生成本地模块候选路径，支持 JS→TS 映射、ESM/CJS 扩展与目录入口。
 * Resolve local candidates including JS-to-TS mappings, ESM/CJS extensions and directory entry points. */
export function moduleCandidates(file: string, specifier: string): string[] {
  const base = resolve(dirname(file), specifier);
  const sourceExtension = base.replace(
    /\.(mjs|cjs|js)$/,
    (_, extension: string) => ({ mjs: '.mts', cjs: '.cts', js: '.ts' })[extension]!,
  );
  return [
    ...new Set([
      base,
      sourceExtension,
      base.replace(/\.js$/, '.tsx'),
      ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map((extension) => base + extension),
      ...[
        'index.ts',
        'index.tsx',
        'index.mts',
        'index.cts',
        'index.js',
        'index.jsx',
        'index.mjs',
        'index.cjs',
      ].map((entry) => resolve(base, entry)),
    ]),
  ];
}
