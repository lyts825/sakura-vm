/** 将指定服务版本的独立接口冻结为摘要化发布基线，验证版本与 Git 修订后写入不可覆盖的记录。 */
import { execFileSync } from 'node:child_process';
import { open, unlink } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { assertReleasedServiceCompatibility, assertServiceBaselineCompatibility, isServiceDeclarationPath,
  SERVICE_CONTRACT_ENTRY, SERVICE_RELEASE_DIRECTORY, serviceBaselineDigest, serviceReleaseVersion,
  type ServiceReleaseBaseline } from './service-compatibility.ts';

/** Explicit release action: snapshot committed sources, never the caller's working tree. */
export async function freezeServiceRelease(release: string, revision: string, root = process.cwd()) {
  if (!serviceReleaseVersion.test(release) || !/^[a-f0-9]{7,40}$/i.test(revision))
    throw new Error('Freeze requires --release <semver> and --commit <existing Git commit hash>');
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  root = resolve(git('rev-parse', '--show-toplevel').trim());
  const commit = git('rev-parse', '--verify', revision + '^{commit}').trim();
  const tracked = new Set(git('ls-tree', '-r', '--name-only', '-z', commit).split('\0').filter(Boolean));
  const texts = new Map<string, string>();
  const projectPath = (file: string) => relative(root, resolve(file)).replaceAll('\\', '/');
  const readCommitted = (file: string) => {
    const path = projectPath(file);
    if (!tracked.has(path)) return;
    if (!texts.has(path)) texts.set(path, git('show', commit + ':' + path));
    return texts.get(path)!;
  };
  const readRequired = (path: string) => {
    const text = readCommitted(resolve(root, path));
    if (text === undefined) throw new Error('Committed release source is missing: ' + path);
    return text;
  };
  const manifest = JSON.parse(readRequired('package.json')) as { version?: unknown };
  if (manifest.version !== release)
    throw new Error('Committed package version does not match release: ' + release);
  const inProject = (file: string) => {
    const path = relative(root, resolve(file));
    return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + win32.sep) && !path.startsWith('../') &&
      projectPath(file) !== 'node_modules' && !projectPath(file).startsWith('node_modules/');
  };
  const host: ts.ModuleResolutionHost = {
    fileExists: file => inProject(file) ? tracked.has(projectPath(file)) : ts.sys.fileExists(file),
    readFile: file => inProject(file) ? readCommitted(file) : ts.sys.readFile(file),
    directoryExists: directory => inProject(directory) ? projectPath(directory) === '' ||
      [...tracked].some(file => file.startsWith(projectPath(directory) + '/')) : ts.sys.directoryExists(directory),
    getCurrentDirectory: () => root,
  };
  const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), host.readFile!);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent({ ...config.config, files: [SERVICE_CONTRACT_ENTRY], include: [], exclude: [] },
    { ...ts.sys, fileExists: host.fileExists, readFile: host.readFile! }, root);
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const files: Record<string, string> = {};
  function visitFile(path: string) {
    if (Object.hasOwn(files, path)) return;
    if (!isServiceDeclarationPath(path)) throw new Error('Committed service contracts cannot import implementations: ' + path);
    const text = files[path] = readRequired(path);
    const file = ts.createSourceFile(resolve(root, path), text, ts.ScriptTarget.Latest, true);
    function visitImport(specifier: string) {
      if (isAbsolute(specifier) || win32.isAbsolute(specifier) || /^[a-z]:/i.test(specifier) || specifier.includes('\\'))
        throw new Error('Committed service contracts cannot import absolute paths: ' + specifier);
      if (isBuiltin(specifier)) return;
      if (!specifier.startsWith('.')) {
        if (!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i.test(specifier))
          throw new Error('Committed service contracts require public package entry points: ' + specifier);
        const imported = ts.resolveModuleName(specifier, file.fileName, parsed.options, host).resolvedModule;
        if (!imported?.isExternalLibraryImport)
          throw new Error('Committed service contract package import is not an external package: ' + specifier);
        return;
      }
      const imported = ts.resolveModuleName(specifier, file.fileName, parsed.options, host).resolvedModule;
      if (!imported) throw new Error('Committed service contract import cannot be resolved: ' + path + ' -> ' + specifier);
      visitFile(projectPath(imported.resolvedFileName));
    }
    function visit(node: ts.Node) {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal
        : ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression
        : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          ts.isIdentifier(node.expression) && node.expression.text === 'require') ? node.arguments[0] : undefined;
      if (specifier && ts.isStringLiteral(specifier)) visitImport(specifier.text);
      ts.forEachChild(node, visit);
    }
    for (const reference of file.referencedFiles)
      visitImport(reference.fileName.startsWith('.') ? reference.fileName : './' + reference.fileName);
    visit(file);
  }
  visitFile(SERVICE_CONTRACT_ENTRY);
  const snapshot: ServiceReleaseBaseline = { release, commit, entry: SERVICE_CONTRACT_ENTRY,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))), digest: serviceBaselineDigest(files) };
  const entry = resolve(root, snapshot.entry), overrides = new Map(Object.entries(files).map(([path, text]) => [resolve(root, path), text]));
  // Validate all captured declarations and all earlier releases before publishing the new file.
  assertServiceBaselineCompatibility(entry, parsed.options, snapshot, overrides);
  await assertReleasedServiceCompatibility(entry, parsed.options, { directory: resolve(root, SERVICE_RELEASE_DIRECTORY), overrides });
  const destination = resolve(root, SERVICE_RELEASE_DIRECTORY, release + '.json');
  const output = await open(destination, 'wx');
  try {
    await output.writeFile(JSON.stringify(snapshot, null, 2) + '\n');
    await output.sync();
  } catch (error) {
    await output.close();
    await unlink(destination);
    throw error;
  }
  await output.close();
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { release: { type: 'string' }, commit: { type: 'string' } }, allowPositionals: false });
  if (!values.release || !values.commit) throw new Error('Usage: npm run plugins:contracts:freeze -- --release <version> --commit <hash>');
  console.log('Frozen released service signatures: ' + await freezeServiceRelease(values.release, values.commit));
}
