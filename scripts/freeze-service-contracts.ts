/** 将指定服务版本的独立接口冻结为摘要化发布基线，验证版本与 Git 修订后写入不可覆盖的记录。
 * Freeze a specified independent service version as a hashed release baseline after version/Git revision checks, using non-overwriting records. */
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
/** 只冻结指定提交中的声明闭包，核对 package 版本和历史兼容性后独占写入摘要基线；失败移除本次未完成文件。
 * Freeze only declarations from the specified commit, verify package version/history compatibility and exclusively write the hashed baseline, removing this incomplete file on failure. */
export async function freezeServiceRelease(release: string, revision: string, root = process.cwd()) {
  if (!serviceReleaseVersion.test(release) || !/^[a-f0-9]{7,40}$/i.test(revision))
    throw new Error('Freeze requires --release <semver> and --commit <existing Git commit hash>');
  /** 在指定仓库运行有输出上限的 Git 只读命令，隐藏窗口，失败直接抛错。
   * Run bounded-output read-only Git commands in the designated repository with hidden windows, propagating failure. */
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  root = resolve(git('rev-parse', '--show-toplevel').trim());
  const commit = git('rev-parse', '--verify', revision + '^{commit}').trim();
  const tracked = new Set(git('ls-tree', '-r', '--name-only', '-z', commit).split('\0').filter(Boolean));
  const texts = new Map<string, string>();
  /** 把源绝对路径规范为仓库相对斜线路径，供 Git tree/source map 共用。
   * Normalize source paths to repository-relative slash paths shared by Git tree/source maps. */
  const projectPath = (file: string) => relative(root, resolve(file)).replaceAll('\\', '/');
  /** 只读取指定 commit 跟踪文件并缓存文本，未跟踪返回 undefined，不读取工作区改动。
   * Read/cache only tracked files from the specified commit, returning undefined for others without reading working-tree changes. */
  const readCommitted = (file: string) => {
    const path = projectPath(file);
    if (!tracked.has(path)) return;
    if (!texts.has(path)) texts.set(path, git('show', commit + ':' + path));
    return texts.get(path)!;
  };
  /** 要求指定提交中存在源文件，缺失抛出明确冻结失败，成功返回文本。
   * Require source presence in the commit and throw explicit freeze failure when absent, otherwise return text. */
  const readRequired = (path: string) => {
    const text = readCommitted(resolve(root, path));
    if (text === undefined) throw new Error('Committed release source is missing: ' + path);
    return text;
  };
  const manifest = JSON.parse(readRequired('package.json')) as { version?: unknown };
  if (manifest.version !== release)
    throw new Error('Committed package version does not match release: ' + release);
  /** 判定源码是否处于仓库且不在 node_modules，用于选择冻结输入或外部类型依赖。
   * Determine whether a path is repository source outside node_modules to select frozen inputs versus external types. */
  const inProject = (file: string) => {
    const path = relative(root, resolve(file));
    return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + win32.sep) && !path.startsWith('../') &&
      projectPath(file) !== 'node_modules' && !projectPath(file).startsWith('node_modules/');
  };
  const host: ts.ModuleResolutionHost = {
    /** 仓库文件按指定提交 tree 查询，外部依赖按真实系统查询，避免工作区文件影响冻结。
     * Query repository existence from the commit tree and external dependencies from the filesystem, excluding working-tree influence. */
    fileExists: file => inProject(file) ? tracked.has(projectPath(file)) : ts.sys.fileExists(file),
    /** 仓库源从提交快照读取，外部依赖用 TS 系统 host 读取。
     * Read repository sources from commit snapshots and external dependencies through the TS system host. */
    readFile: file => inProject(file) ? readCommitted(file) : ts.sys.readFile(file),
    /** 仓库目录按 tree 前缀判断，外部目录委托系统，保持提交闭包解析一致。
     * Infer repository directories from tree prefixes and delegate external paths to the system for consistent commit resolution. */
    directoryExists: directory => inProject(directory) ? projectPath(directory) === '' ||
      [...tracked].some(file => file.startsWith(projectPath(directory) + '/')) : ts.sys.directoryExists(directory),
    /** 向冻结编译 host 返回已核实仓库根，稳定相对导入解析。
     * Return the verified repository root to the freeze compiler host for stable relative resolution. */
    getCurrentDirectory: () => root,
  };
  const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), host.readFile!);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent({ ...config.config, files: [SERVICE_CONTRACT_ENTRY], include: [], exclude: [] },
    { ...ts.sys, fileExists: host.fileExists, readFile: host.readFile! }, root);
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const files: Record<string, string> = {};
  /** 只接受独立声明路径，登记后递归 import/reference，重复路径跳过以闭合快照。
   * Accept independent declaration paths only, register/traverse imports/references and skip repeats to close the snapshot. */
  function visitFile(path: string) {
    if (Object.hasOwn(files, path)) return;
    if (!isServiceDeclarationPath(path)) throw new Error('Committed service contracts cannot import implementations: ' + path);
    const text = files[path] = readRequired(path);
    const file = ts.createSourceFile(resolve(root, path), text, ts.ScriptTarget.Latest, true);
    /** 拒绝绝对/私有包入口，按提交 host 解析相对声明并继续遍历，缺失或实现路径拒绝。
     * Reject absolute/private package entries, resolve declarations through the commit host and refuse absent/implementation paths. */
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
    /** 提取 AST 中各种导入/require 形式并调用统一边界检查，递归避免隐藏依赖。
     * Extract import/require forms and apply common boundary checks recursively to expose hidden dependencies. */
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
