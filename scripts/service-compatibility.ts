/** 读取已发布服务接口基线，构建独立 TypeScript 比较程序并检查双向形状与方法兼容性。
 * Read released interface baselines and build an independent TypeScript comparison program for bidirectional shape/method compatibility. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, basename } from 'node:path';
import ts from 'typescript';

export type ServiceReleaseBaseline = {
  release: string; commit: string; entry: string; digest: string;
  /** Frozen declaration inputs include transitive shared DTOs and inferred schema types. */
  files: Record<string, string>;
};
/** 按文件路径排序后对完整源码映射做 SHA-256，绑定传递声明闭包的实际字节。
 * SHA-256 the sorted full source map to bind all transitive declaration bytes. */
export const serviceBaselineDigest = (files: Record<string, string>) => createHash('sha256')
  .update(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))))
  .digest('hex');

export const SERVICE_RELEASE_DIRECTORY = 'server/service-contracts/releases';
export const SERVICE_CONTRACT_ENTRY = 'server/service-contracts/v1.ts';
export const serviceReleaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
/** 仅接受 shared 或独立服务契约目录下无点段的 TS 声明源路径。
 * Accept only dot-segment-free TS declaration sources under shared or independent service contracts. */
export const isServiceDeclarationPath = (file: string) =>
  !file.includes('\\') && !file.split('/').some(part => part === '' || part === '.' || part === '..') &&
  (file.startsWith('shared/') || file.startsWith('server/service-contracts/')) && /\.[cm]?tsx?$/.test(file);

/** Every release remains an input; ordinary checks never create or update snapshots. */
/** 读取所有发布基线并核对必要首版、文件名/版本、提交、声明路径与摘要，普通检查不改历史。
 * Read all release baselines and verify initial baseline/name/version/commit/declaration paths/hashes without changing history. */
export async function readServiceReleaseBaselines(directory = SERVICE_RELEASE_DIRECTORY): Promise<ServiceReleaseBaseline[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name));
  if (!files.some(file => file.name === '2.1.0.json'))
    throw new Error('Missing released service baseline: 2.1.0.json');
  const baselines: ServiceReleaseBaseline[] = [];
  for (const file of files) {
    if (!file.isFile()) throw new Error('Released service baseline must be a regular file: ' + file.name);
    const value: unknown = JSON.parse(await readFile(resolve(directory, file.name), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid released service baseline metadata: ' + file.name);
    const snapshot = value as ServiceReleaseBaseline;
    if (typeof snapshot.release !== 'string' || !serviceReleaseVersion.test(snapshot.release) ||
      basename(file.name, '.json') !== snapshot.release || typeof snapshot.commit !== 'string' ||
      !/^[a-f0-9]{40}$/.test(snapshot.commit) || snapshot.entry !== SERVICE_CONTRACT_ENTRY ||
      !snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files) ||
      Object.entries(snapshot.files).some(([path, text]) => !isServiceDeclarationPath(path) || typeof text !== 'string'))
      throw new Error('Invalid released service baseline metadata or filename/release mismatch: ' + file.name);
    if (!Object.hasOwn(snapshot.files, snapshot.entry))
      throw new Error('Missing released service baseline entry: ' + file.name);
    if (snapshot.digest !== serviceBaselineDigest(snapshot.files))
      throw new Error('Released service signature baseline digest does not match: ' + snapshot.release);
    baselines.push(snapshot);
  }
  return baselines;
}

/** Method declarations are checked as function properties to avoid TypeScript method bivariance. */
/** 在内存把方法签名转为函数属性以启用严格参数逆变，打印后重建 AST，原源码不改。
 * Transform method signatures to function properties in memory for strict parameter variance, print/reparse and preserve original sources. */
export function strictMethods(file: ts.SourceFile): ts.SourceFile {
  const transformed = ts.transform(file, [context => root => {
    /** 递归转换 MethodSignature，保留其他子节点结构，供严格兼容性 program 使用。
     * Recursively transform MethodSignature while retaining other children for strict compatibility programs. */
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isMethodSignature(node)) return ts.factory.createPropertySignature(node.modifiers, node.name,
        node.questionToken, ts.factory.createFunctionTypeNode(node.typeParameters, node.parameters, node.type!));
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  const text = ts.createPrinter().printFile(transformed.transformed[0]);
  transformed.dispose();
  return ts.createSourceFile(file.fileName, text, ts.ScriptTarget.Latest, true);
}

/** 把发布快照映射到虚拟独立目录，叠加显式 overrides 与真实依赖，比较前对当前/快照方法严格化。
 * Map released snapshots to a virtual separate directory with explicit overrides/real dependencies and strictify current/snapshot methods for comparison. */
export function createServiceCompatibilityProgram(currentEntry: string, baseline: ServiceReleaseBaseline,
  options: ts.CompilerOptions, overrides: ReadonlyMap<string, string> = new Map()) {
  if (serviceBaselineDigest(baseline.files) !== baseline.digest)
    throw new Error('Released service signature baseline digest does not match: ' + baseline.release);
  const base = resolve('.service-contract-release', baseline.release);
  const snapshots = new Map(Object.entries(baseline.files).map(([file, text]) => [resolve(base, file), text]));
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), source = host.getSourceFile.bind(host);
  host.readFile = /** 编译器读文件时依次使用本轮覆盖、基线快照和真实文件，保证候选声明与冻结服务视图一致。
 * Compiler file reads prefer current overrides, then baseline snapshots, then real files, keeping candidate declarations consistent with the frozen service view. */ file => overrides.get(resolve(file)) ?? snapshots.get(resolve(file)) ?? read(file);
  host.fileExists = /** 编译器存在性检查同时识别虚拟覆盖、冻结快照和真实磁盘文件，避免尚未落盘的候选被误判为缺失。
 * Compiler existence checks recognize virtual overrides, frozen snapshots and real disk files so unwritten candidates are not treated as missing. */ file => overrides.has(resolve(file)) || snapshots.has(resolve(file)) || exists(file);
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = /** 把包含虚拟覆盖或基线快照的目录判为存在，再回退原 host，支持不写磁盘的候选类型检查。
 * Treat directories containing virtual overrides/baseline snapshots as existing before falling back to the original host, supporting candidate type checking without disk writes. */ directory => [...snapshots.keys(), ...overrides.keys()]
    .some(file => file.startsWith(resolve(directory) + '\\') || file.startsWith(resolve(directory) + '/')) || !!directoryExists?.(directory);
  host.getSourceFile = /** 按规范路径创建覆盖/快照源文件，仅对当前入口和冻结来源启用严格方法投影；其他依赖保留原 host 行为，隔离候选兼容性检查。
 * Create override/snapshot source files by canonical path and apply strict method projection only to the current entry/frozen sources; retain original-host behavior for other dependencies to isolate candidate compatibility checks. */ (file, language, onError, shouldCreate) => {
    const path = resolve(file), text = overrides.get(path) ?? snapshots.get(path);
    const input = text === undefined ? source(file, language, onError, shouldCreate) :
      ts.createSourceFile(file, text, language, true);
    return input && (path === resolve(currentEntry) || snapshots.has(path)) ? strictMethods(input) : input;
  };
  const baselineEntry = resolve(base, baseline.entry);
  return { program: ts.createProgram([resolve(currentEntry), baselineEntry], options, host), baselineEntry };
}

/** In addition to assignability, retain every named DTO field, including optional fields. */
/** 检查当前类型能承接旧输入/输出，并递归保留所有旧 DTO 字段包括可选字段；返回全部不兼容诊断。
 * Check that current types preserve old inputs/outputs and recursively retain every old DTO field including optional ones, returning incompatibilities. */
export function serviceCompatibilityErrors(program: ts.Program, currentEntry: string, baselineEntry: string): string[] {
  const checker = program.getTypeChecker(), current = program.getSourceFile(resolve(currentEntry))!,
    previous = program.getSourceFile(resolve(baselineEntry))!, errors: string[] = [];
  /** 索引源文件顶层 interface/type 名称及已检查类型，供前后版本配对。
   * Index top-level interface/type names and checked types for version pairing. */
  const declarations = (source: ts.SourceFile) => new Map(source.statements
    .filter((node): node is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    .map(node => [node.name.text, checker.getTypeAtLocation(node)]));
  const before = declarations(previous), after = declarations(current);
  /** 按旧/新类型对递归核对字段、参数、返回与泛型包装，seen 防循环并拒绝降级到 any/unknown。
   * Recursively compare paired fields/parameters/returns/generic wrappers with cycle tracking, rejecting degradation to any/unknown. */
  const retained = (old: ts.Type, next: ts.Type, path: string, seen: Map<ts.Type, Set<ts.Type>>) => {
    if (seen.get(old)?.has(next)) return;
    if (!seen.has(old)) seen.set(old, new Set());
    seen.get(old)!.add(next);
    if (!(old.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) &&
      next.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
      errors.push(path + ': released type was replaced by an opaque any/unknown declaration'); return;
    }
    // Pair discriminated alternatives through assignability. Parameter widening can introduce alternatives.
    if (old.isUnion() || next.isUnion()) {
      for (const choice of old.isUnion() ? old.types : [old]) {
        const alternatives = next.isUnion() ? next.types : [next];
        const match = alternatives.find(value => checker.isTypeAssignableTo(choice, value) && checker.isTypeAssignableTo(value, choice)) ||
          alternatives.find(value => checker.isTypeAssignableTo(value, choice)) ||
          alternatives.find(value => checker.isTypeAssignableTo(choice, value));
        if (match) retained(choice, match, path, seen);
      }
      return;
    }
    if (old.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter) ||
      next.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) return;
    if (!(old.flags & ts.TypeFlags.Object) || !(next.flags & ts.TypeFlags.Object)) return;
    const oldArguments = old.flags & ts.TypeFlags.Object && (old as ts.TypeReference).typeArguments;
    const nextArguments = next.flags & ts.TypeFlags.Object && (next as ts.TypeReference).typeArguments;
    if (oldArguments && nextArguments) {
      oldArguments.forEach((value, index) => { if (nextArguments[index]) retained(value, nextArguments[index], path + '<' + index + '>', seen); });
    }
    if (checker.isArrayType(old) || checker.isTupleType(old)) return;
    /** 判断类型来自自有声明/发布快照或匿名 DTO，外部 stream/socket 等只用 TS assignability 检查。
     * Identify owned declarations/release snapshots/anonymous DTOs; external stream/socket types use TS assignability only. */
    const owned = (type: ts.Type) => [...(type.symbol?.declarations || []), ...(type.aliasSymbol?.declarations || [])].some(node => {
      const name = relative(process.cwd(), node.getSourceFile().fileName).replaceAll('\\', '/');
      return name.startsWith('shared/') || name.startsWith('server/service-contracts/') || name.startsWith('.service-contract-release/');
    }) || (!type.symbol && type.getProperties().length > 0);
    // Package objects (streams, sockets, AbortSignal) are checked by TypeScript assignability.
    if (owned(old)) for (const member of old.getProperties()) {
      const replacement = next.getProperty(member.name);
      if (!replacement) { errors.push(path + '.' + member.name + ': released field or method was removed'); continue; }
      retained(checker.getTypeOfSymbolAtLocation(member, previous),
        checker.getTypeOfSymbolAtLocation(replacement, current), path + '.' + member.name, seen);
    }
    const oldCalls = checker.getSignaturesOfType(old, ts.SignatureKind.Call), nextCalls = checker.getSignaturesOfType(next, ts.SignatureKind.Call);
    for (let index = 0; index < oldCalls.length; index++) {
      const signature = oldCalls[index], replacement = nextCalls[index] || nextCalls[0];
      if (!replacement) continue; // Assignability reports the incompatible call signature.
      signature.parameters.forEach((parameter, at) => {
        const nextParameter = replacement.parameters[at];
        if (nextParameter) retained(checker.getTypeOfSymbolAtLocation(parameter, previous),
          checker.getTypeOfSymbolAtLocation(nextParameter, current), path + '(argument ' + at + ')', seen);
      });
      retained(checker.getReturnTypeOfSignature(signature), checker.getReturnTypeOfSignature(replacement), path + '(return)', seen);
    }
  };
  for (const [name, old] of before) {
    const next = after.get(name);
    if (!next) { errors.push(name + ': released V1 declaration was removed'); continue; }
    if (!checker.isTypeAssignableTo(next, old)) errors.push(name + ': incompatible released V1 signature (parameters must accept old inputs and returns must preserve old outputs)');
    retained(old, next, name, new Map());
  }
  return errors;
}

/** 构建独立比较 program，先拒绝源码语义诊断再拒绝兼容错误，不发布任何基线。
 * Build the independent comparison program and reject semantic/compatibility diagnostics without publishing baselines. */
export function assertServiceBaselineCompatibility(entry: string, options: ts.CompilerOptions,
  baseline: ServiceReleaseBaseline, overrides: ReadonlyMap<string, string> = new Map()) {
  const inputs = createServiceCompatibilityProgram(entry, baseline, options, overrides);
  const diagnostics = inputs.program.getSemanticDiagnostics().filter(item => item.file &&
    (item.file.fileName.includes('.service-contract-release') || resolve(item.file.fileName) === resolve(entry)));
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    /** 诊断 host 保留输入文件名，避免格式化时改变快照身份。
     * Preserve supplied filenames in the diagnostic host without altering snapshot identity. */
    getCanonicalFileName: file => file, /** 返回当前工作区以格式化编译器诊断路径。
 * Return the current workspace for compiler diagnostic path formatting. */ getCurrentDirectory: () => process.cwd(), /** 统一诊断输出换行为 LF，稳定跨平台日志。
 * Use LF for deterministic cross-platform diagnostic output. */ getNewLine: () => '\n',
  }));
  const errors = serviceCompatibilityErrors(inputs.program, entry, inputs.baselineEntry);
  if (errors.length) throw new Error('Released service compatibility violations (' + baseline.release + '):\n' + errors.join('\n'));
}

/** 逐个验证全部已发布基线与当前入口兼容，settings 可指定目录/显式源覆盖，不修改历史。
 * Compare the current entry against every released baseline with optional directory/source overrides, preserving history. */
export async function assertReleasedServiceCompatibility(entry: string, options: ts.CompilerOptions,
  settings: { directory?: string; overrides?: ReadonlyMap<string, string> } = {}) {
  for (const baseline of await readServiceReleaseBaselines(settings.directory))
    assertServiceBaselineCompatibility(entry, options, baseline, settings.overrides);
}
