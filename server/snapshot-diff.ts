/**
 * 模块职责：在只读快照中生成文件清单并比较差异，限制挂载范围与路径编码。
 * Module purpose: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding.
 */
import { isUtf8 } from 'node:buffer';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import type { VmSnapshotInspectionPort } from './vm-ports.ts';
import { Jobs } from './jobs.ts';
import { quote } from './shell.ts';
import { rescueSetup } from './rescue.ts';
import {
  snapshotDiffInputSchema,
  type SnapshotDiffFile,
  type SnapshotDiffInput,
  type SnapshotDiffResult,
} from '../shared/snapshot-diff.ts';

const MAX_FILES = 5000;
const SCAN_TIMEOUT_MS = 10 * 60_000;
const CONVERT_TIMEOUT_MS = 30 * 60_000;

/** Paths are base64 encoded in the guest so even newlines in filenames remain unambiguous. */
/**
 * 入口 / Entry: snapshotManifestCommand.
 * 功能：从当前输入或状态计算 ``set -eu root=${quote(root)} if ! test -e "$root" && ! test -L "$root"; then echo MISSING; exit 0; fi resolved=$(readlink -f …`，供调用方后续验证或使用。
 * Purpose: Computes ``set -eu root=${quote(root)} if ! test -e "$root" && ! test -L "$root"; then echo MISSING; exit 0; fi resolved=$(readlink -f …` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: mount: '/mnt/source' | '/mnt/compare' | '/mnt/target'; path: string
 * 输出 / Returns: ``set -eu root=${quote(root)} if ! test -e "$root" && ! test -L "$root"; then echo MISSING; exit 0; fi resolved=$(readlink -f …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function snapshotManifestCommand(mount: '/mnt/source' | '/mnt/compare' | '/mnt/target', path: string) {
  const root = mount + (path === '/' ? '' : path);
  return `set -eu
root=${quote(root)}
if ! test -e "$root" && ! test -L "$root"; then echo MISSING; exit 0; fi
resolved=$(readlink -f "$root")
case "$resolved" in ${quote(mount)}|${quote(mount + '/')}*) ;; *) echo '比较路径越过只读挂载点' >&2; exit 1 ;; esac
find "$root" -xdev \\( -type f -o -type l \\) -exec sh -c '
  for file do
    name=$(printf %s "$file" | base64 | tr -d "\\n")
    if test -L "$file"; then
      target=$(readlink -n "$file" | base64 | tr -d "\\n")
      printf "L\\t%s\\t%s\\n" "$name" "$target"
    else
      bytes=$(stat -c %s "$file")
      digest=$(sha256sum < "$file")
      digest=\${digest%% *}
      printf "F\\t%s\\t%s\\t%s\\n" "$name" "$bytes" "$digest"
    fi
  done
' sh {} +`;
}

/**
 * 入口 / Entry: decodeBase64.
 * 功能：在在只读快照中生成文件清单并比较差异中，转换协议或持久数据表示并保持调用边界；本入口产生 `bytes.toString('utf8')` 供上层消费（`snapshot-diff.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `snapshot-diff.ts`; this entry produces `bytes.toString('utf8')` for its caller. Module context: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding.
 * 处理：通过 `inline.test`, `isUtf8`, `bytes.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `isUtf8`, `bytes.toString`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `bytes.toString('utf8')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)`; `!isUtf8(bytes)`; 异常 / errors `new AppError('文件清单包含无效路径编码', 409)`; `new AppError('文件清单包含非 UTF-8 路径，无法安全展示差异', 409)`.
 */
function decodeBase64(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new AppError('文件清单包含无效路径编码', 409);
  const bytes = Buffer.from(value, 'base64');
  if (!isUtf8(bytes)) throw new AppError('文件清单包含非 UTF-8 路径，无法安全展示差异', 409);
  return bytes.toString('utf8');
}

/**
 * 入口 / Entry: parseSnapshotManifest.
 * 功能：在在只读快照中生成文件清单并比较差异中，转换协议或持久数据表示并保持调用边界；本入口产生 `files` 供上层消费（`snapshot-diff.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `snapshot-diff.ts`; this entry produces `files` for its caller. Module context: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding.
 * 处理：通过 `output.trim`, `output.split`, `line.split`, `decodeBase64` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `output.trim`, `output.split`, `line.split`, `decodeBase64`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `output.trim() === 'MISSING'`; `!line`; `fields[0] === 'L'`.
 * 输入 / Inputs: output: string; mount: '/mnt/source' | '/mnt/compare' | '/mnt/target'
 * 输出 / Returns: `files`.
 * 副作用 / Effects: `fullPath.startsWith`; `files.set`.
 * 拒绝 / Refusals: 条件 / conditions `(fields[0] === 'F' && fields.length !== 4) || (fields[0] === 'L' && fields.length !== 3)`; `fields[0] !== 'F' && fields[0] !== 'L'`; `!fullPath.startsWith(mount + '/')`; 异常 / errors `new AppError('文件清单格式损坏', 409)`; `new AppError('文件清单路径越过只读挂载点', 409)`.
 */
export function parseSnapshotManifest(output: string,
  mount: '/mnt/source' | '/mnt/compare' | '/mnt/target') {
  const files = new Map<string, SnapshotDiffFile>();
  if (output.trim() === 'MISSING') return files;
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split('\t');
    if ((fields[0] === 'F' && fields.length !== 4) || (fields[0] === 'L' && fields.length !== 3))
      throw new AppError('文件清单格式损坏', 409);
    if (fields[0] !== 'F' && fields[0] !== 'L') throw new AppError('文件清单格式损坏', 409);
    const fullPath = decodeBase64(fields[1]);
    if (!fullPath.startsWith(mount + '/')) throw new AppError('文件清单路径越过只读挂载点', 409);
    const path = fullPath.slice(mount.length);
    if (files.has(path)) throw new AppError('文件清单包含重复路径', 409);
    if (files.size >= MAX_FILES) throw new AppError(`文件超过 ${MAX_FILES} 个，请缩小比较范围`, 413);
    if (fields[0] === 'L') {
      files.set(path, { path, type: 'symlink', target: decodeBase64(fields[2]) });
    } else {
      const bytes = Number(fields[2]);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || !/^[a-f0-9]{64}$/.test(fields[3]))
        throw new AppError('文件清单校验信息无效', 409);
      files.set(path, { path, type: 'file', bytes, sha256: fields[3] });
    }
  }
  return files;
}

/**
 * 入口 / Entry: compareSnapshotManifests.
 * 功能：在在只读快照中生成文件清单并比较差异中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ from: input.from, to: input.to, partition: input.partition, path: input.path, diskChanged, counts: { before: before.size, a…` 供上层消费（`snapshot-diff.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `snapshot-diff.ts`; this entry produces `{ from: input.from, to: input.to, partition: input.partition, path: input.path, diskChanged, counts: { before: before.size, a…` for its caller. Module context: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding.
 * 处理：通过 `before.get`, `added.push`, `modified.push`, `after.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `before.get`, `added.push`, `modified.push`, `after.has`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!previous`; `previous.type !== file.type || previous.bytes !== file.bytes || previous.sha256 !== file.sha256 || p…`; `!after.has(path)`.
 * 输入 / Inputs: before: Map<string, SnapshotDiffFile>; after: Map<string, SnapshotDiffFile>; input: SnapshotDiffInput; diskChanged: boolean
 * 输出 / Returns: SnapshotDiffResult；结果来自 / values from `{ from: input.from, to: input.to, partition: input.partition, path: input.path, diskChanged, counts: { before: before.size, a…`.
 * 副作用 / Effects: `added.push`; `modified.push`; `removed.push`; `added.sort`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function compareSnapshotManifests(
  before: Map<string, SnapshotDiffFile>,
  after: Map<string, SnapshotDiffFile>,
  input: SnapshotDiffInput,
  diskChanged: boolean,
): SnapshotDiffResult {
  const added: SnapshotDiffFile[] = [],
    removed: SnapshotDiffFile[] = [];
  const modified: SnapshotDiffResult['modified'] = [];
  for (const [path, file] of after) {
    const previous = before.get(path);
    if (!previous) added.push(file);
    else if (
      previous.type !== file.type ||
      previous.bytes !== file.bytes ||
      previous.sha256 !== file.sha256 ||
      previous.target !== file.target
    )
      modified.push({ path, before: previous, after: file });
  }
  for (const [path, file] of before) if (!after.has(path)) removed.push(file);
  added.sort((a, b) => a.path.localeCompare(b.path));
  removed.sort((a, b) => a.path.localeCompare(b.path));
  modified.sort((a, b) => a.path.localeCompare(b.path));
  return {
    from: input.from,
    to: input.to,
    partition: input.partition,
    path: input.path,
    diskChanged,
    counts: {
      before: before.size,
      after: after.size,
      added: added.length,
      removed: removed.length,
      modified: modified.length,
    },
    added,
    removed,
    modified,
    checkedAt: new Date().toISOString(),
  };
}

export class SnapshotDiff {
  readonly jobs = new Jobs('snapshot-diff');
  private closed = false;
  /**
   * 入口 / Entry: SnapshotDiff.constructor.
   * 功能：建立 SnapshotDiff 的在只读快照中生成文件清单并比较差异上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SnapshotDiff context for this module's responsibility: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: VmSnapshotInspectionPort
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: VmSnapshotInspectionPort) {}

  /**
   * 入口 / Entry: SnapshotDiff.view.
   * 功能：在在只读快照中生成文件清单并比较差异中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ runs: this.jobs .list() .filter((job) => job.vmId === id) .slice(0, 20), persistenceError: this.jobs.persistenceError, }` 供上层消费（`SnapshotDiff`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SnapshotDiff`; this entry produces `{ runs: this.jobs .list() .filter((job) => job.vmId === id) .slice(0, 20), persistenceError: this.jobs.persistenceError, }` for its caller. Module context: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding.
   * 处理：通过 `this.machines.get`, `this.jobs.list().filter().slice`, `this.jobs.list().filter`, `this.jobs.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.jobs.list().filter().slice`, `this.jobs.list().filter`, `this.jobs.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ runs: this.jobs .list() .filter((job) => job.vmId === id) .slice(0, 20), persistenceError: this.jobs.persistenceError, }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(id: string) {
    this.machines.get(id);
    return {
      runs: this.jobs
        .list()
        .filter((job) => job.vmId === id)
        .slice(0, 20),
      persistenceError: this.jobs.persistenceError,
    };
  }

  /**
   * 入口 / Entry: SnapshotDiff.run.
   * 功能：校验快照选择并在只读救援挂载中生成和比较文件清单。
   * Purpose: Validates snapshot selections and compares manifests from read-only rescue mounts.
   * 设计：停止实例与快照身份先核对，挂载和输出有界；任务结束关闭原救援附件和暂存目录。
   * Design: Stopped-VM/snapshot proof precedes bounded mounts/output; completion closes original rescue attachments and staging.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `this.jobs.start( id, async (log, signal, update, saveResult) => { const incident = new AbortController(); const lockdown = (t…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `vm.sandbox`; `this.machines.isBusy(id)`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('临时实例不能比较快照', 409)`.
   */
  run(id: string, raw: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const input = snapshotDiffInputSchema.parse(raw);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    this.machines.requireStopped(id);
    if (vm.sandbox) throw new AppError('临时实例不能比较快照', 409);
    if (this.machines.isBusy(id)) throw new AppError('实例正在执行其他操作', 409);
    if (
      !vm.snapshots.some((shot) => shot.id === input.from) ||
      (input.to !== 'current' && !vm.snapshots.some((shot) => shot.id === input.to))
    )
      throw new AppError('快照不存在', 404);
    /**
     * 入口 / Entry: SnapshotDiff.run.callback@158.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal; update; saveResult
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `AbortSignal.any`; `mkdir`; `AbortSignal.timeout`; `saveResult`; `basename().startsWith`.
     * 拒绝 / Refusals: 条件 / conditions `signal.aborted`; `(error as Error).name === 'TimeoutError'`; `dirname(temp) !== resolve(tempRoot) || !basename(temp).startsWith('diff-')`; 异常 / errors `error`; `new AppError('快照比较超时，已清理临时系统', 408)`.
     * 收尾：退出 try 区域时始终执行 `this.machines.off('incident-lockdown', lockdown);`; `if (dirname(temp) !== resolve(tempRoot) || !basename(temp).startsWith('diff-')) throw new AppError('临时目录超出快照比较目录，拒绝清理', 500);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `this.machines.off('incident-lockdown', lockdown);`; `if (dirname(temp) !== resolve(tempRoot) || !basename(temp).startsWith('diff-')) throw new AppError('临时目录超出快照比较目录，拒绝清理', 500);`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (signal.aborted) throw error;`; `if ((error as Error).name === 'TimeoutError') throw new AppError('快照比较超时，已清理临时系统', 408);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (signal.aborted) throw error;`; `if ((error as Error).name === 'TimeoutError') throw new AppError('快照比较超时，已清理临时系统', 408);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.jobs.start(
      id,
      async (log, signal, update, saveResult) => {
        const incident = new AbortController();
        /**
         * 入口 / Entry: SnapshotDiff.run.lockdown.
         * 功能：在在只读快照中生成文件清单并比较差异中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SnapshotDiff`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `SnapshotDiff`; the calls and state transitions below complete the operation. Module context: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding.
         * 处理：通过 `incident.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `incident.abort`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `target === id`.
         * 输入 / Inputs: target: string
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `incident.abort`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const lockdown = (target: string) => {
          if (target === id) incident.abort(new AppError('实例已应急锁定，快照比较中止', 423));
        };
        const operationSignal = AbortSignal.any([signal, incident.signal]);
        const tempRoot = join(DATA, 'plugins', 'snapshots');
        await mkdir(tempRoot, { recursive: true });
        const temp = await mkdtemp(join(tempRoot, 'diff-'));
        this.machines.on('incident-lockdown', lockdown);
        try {
          /**
           * 入口 / Entry: SnapshotDiff.run.callback@169.
           * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
           * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `[before, after] as const`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `current.diskEncryption`; `!current.snapshots.some((shot) => shot.id === input.from) || (input.to !== 'current' && !current.snapshots.some((shot) => sho…`; 异常 / errors `new AppError('加密实例暂不支持快照文件差异提取', 409)`; `new AppError('快照已被删除', 404)`.
           */
          const [beforeDisk, afterDisk] = await this.machines.locked(id, async () => {
            this.machines.requireStopped(id);
            this.machines.requireUnlocked(id);
            operationSignal.throwIfAborted();
            const current = this.machines.get(id);
            if (current.diskEncryption)
              throw new AppError('加密实例暂不支持快照文件差异提取', 409);
            if (
              !current.snapshots.some((shot) => shot.id === input.from) ||
              (input.to !== 'current' && !current.snapshots.some((shot) => shot.id === input.to))
            )
              throw new AppError('快照已被删除', 404);
            const source = join(vmDir(id), 'disk.qcow2');
            /**
             * 入口 / Entry: SnapshotDiff.run.convert.
             * 功能：在在只读快照中生成文件清单并比较差异中，执行此领域的具体处理步骤并返回其结果；本入口产生 `target` 供上层消费（`SnapshotDiff`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `SnapshotDiff`; this entry produces `target` for its caller. Module context: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding.
             * 处理：通过 `update`, `join`, `this.machines.engine.run`, `operationSignal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `update`, `join`, `this.machines.engine.run`, `operationSignal.throwIfAborted`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: snapshot: string; label: string
             * 输出 / Returns: `target`.
             * 副作用 / Effects: `update`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            const convert = async (snapshot: string, label: string) => {
              update(`提取${label}快照磁盘`);
              const target = join(temp, label + '.qcow2');
              await this.machines.engine.run(
                'sakura-img',
                ['convert', '-f', 'qcow2', '-O', 'qcow2', '-l', snapshot, source, target],
                { signal: operationSignal, timeoutMs: CONVERT_TIMEOUT_MS },
              );
              operationSignal.throwIfAborted();
              return target;
            };
            const before = await convert(input.from, 'before');
            const after = input.to === 'current' ? source : await convert(input.to, 'after');
            return [before, after] as const;
          });
          const deadline = AbortSignal.timeout(SCAN_TIMEOUT_MS);
          const lifetime = AbortSignal.any([operationSignal, deadline]);
          /**
           * 入口 / Entry: SnapshotDiff.run.callback@203.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.withRescue）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.withRescue).
           * 输入 / Inputs: rescueId; active
           * 输出 / Returns: `compareSnapshotManifests(before, after, input, disk.code === 1)`.
           * 副作用 / Effects: `update`; `this.machines.exec`.
           * 拒绝 / Refusals: 条件 / conditions `prepared.code !== 0`; `left.code !== 0`; `right.code !== 0`; 异常 / errors `new AppError(prepared.stderr || '快照磁盘挂载失败，请检查分区编号', 409)`; `new AppError(left.stderr || '起点文件清单生成失败', 409)`.
           */
          const result = await this.machines.withRescue(
            id,
            lifetime,
            update,
            async (rescueId, active) => {
              for (const role of ['source', 'compare'] as const) {
                update(`只读挂载${role === 'source' ? '起点' : '终点'}磁盘`);
                const prepared = await this.machines.exec(
                  rescueId,
                  rescueSetup(input.partition, role),
                  30000,
                  active,
                );
                if (prepared.code !== 0)
                  throw new AppError(prepared.stderr || '快照磁盘挂载失败，请检查分区编号', 409);
              }
              update('计算起点文件清单');
              const left = await this.machines.exec(
                rescueId,
                snapshotManifestCommand('/mnt/source', input.path),
                SCAN_TIMEOUT_MS,
                active,
              );
              if (left.code !== 0) throw new AppError(left.stderr || '起点文件清单生成失败', 409);
              const before = parseSnapshotManifest(left.stdout, '/mnt/source');
              update('计算终点文件清单');
              const right = await this.machines.exec(
                rescueId,
                snapshotManifestCommand('/mnt/compare', input.path),
                SCAN_TIMEOUT_MS,
                active,
              );
              if (right.code !== 0) throw new AppError(right.stderr || '终点文件清单生成失败', 409);
              const after = parseSnapshotManifest(right.stdout, '/mnt/compare');
              update('比较虚拟磁盘内容');
              const disk = await this.machines.engine.runStatus(
                'sakura-img',
                ['compare', '-q', '-f', 'qcow2', '-F', 'qcow2', beforeDisk, afterDisk],
                { signal: active, timeoutMs: SCAN_TIMEOUT_MS },
              );
              if (disk.code !== 0 && disk.code !== 1)
                throw new AppError(disk.stderr || '虚拟磁盘比较失败', 409);
              return compareSnapshotManifests(before, after, input, disk.code === 1);
            },
            (text) => log(text),
            beforeDisk,
            afterDisk,
          );
          await saveResult(result);
          log(
            `文件：新增 ${result.counts.added}、删除 ${result.counts.removed}、修改 ${result.counts.modified}；磁盘内容${result.diskChanged ? '不同' : '相同'}。\n`,
          );
        } catch (error) {
          if (signal.aborted) throw error;
          if ((error as Error).name === 'TimeoutError')
            throw new AppError('快照比较超时，已清理临时系统', 408);
          throw error;
        } finally {
          this.machines.off('incident-lockdown', lockdown);
          if (dirname(temp) !== resolve(tempRoot) || !basename(temp).startsWith('diff-'))
            throw new AppError('临时目录超出快照比较目录，拒绝清理', 500);
          await rm(temp, { recursive: true, force: true });
        }
      },
      { vmId: id, title: vm.name + ' · 快照差异', action: 'snapshot-diff' },
    );
  }

  /**
   * 入口 / Entry: SnapshotDiff.close.
   * 功能：在在只读快照中生成文件清单并比较差异中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`SnapshotDiff`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SnapshotDiff`; the outcome is recorded in `this.closed`. Module context: Reads/compares readonly snapshot manifests with mount boundaries and valid path encoding.
   * 处理：通过 `this.jobs.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.jobs.close();
  }
}
