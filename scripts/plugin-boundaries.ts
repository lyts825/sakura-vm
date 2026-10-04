import ts from 'typescript';
import { staticString } from './network-boundaries.ts';

// Host adapters consume the implementation; domain services consume VmAccess.
const hostAdapters = new Set([
  'server/application.ts',
  'server/http-machines.ts',
  'server/plugin-capabilities.ts',
  'server/plugin-manager.ts',
  'server/plugin-runtime.ts',
  'server/system-services.ts',
  'server/terminal-backend.ts',
  'server/vm-access.ts',
  'server/vm-transport.ts',
]);
export function pluginBoundaryErrors(file: string, source: ts.SourceFile): string[] {
  file = file.replaceAll('\\', '/');
  if (!file.startsWith('server/') && !/^plugins\/[^/]+\/(?:server|services)\.ts$/.test(file)) return [];
  const errors: string[] = [];
  const report = (node: ts.Node, message: string) =>
    errors.push(
      `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`,
    );
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const path = staticString(node.moduleSpecifier) || '';
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
      const elements =
        bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
          ? bindings.elements
          : undefined;
      if (
        /\/machines(?:\.ts)?$/.test(path) &&
        !hostAdapters.has(file) &&
        (!elements || elements.some((item) => (item.propertyName || item.name).text === 'Machines'))
      )
        report(node, 'Domain services must use the instance-bound VmAccess interface');
      if (
        file.startsWith('plugins/') &&
        /\/server\/(?:paths|plugin-(?:runtime|manager|authority|scope|capabilities|metadata)|vm-(?:reference|access)|system-services|service-broker)(?:\.ts)?$/.test(
          path,
        )
      )
        report(node, 'Plugin entries may not import host authority or filesystem resolution adapters');
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
