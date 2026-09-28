import { isUtf8 } from 'node:buffer';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { AppError, DATA, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import { Jobs } from './jobs.ts';
import { quote } from './files.ts';
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

function decodeBase64(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new AppError('文件清单包含无效路径编码', 409);
  const bytes = Buffer.from(value, 'base64');
  if (!isUtf8(bytes)) throw new AppError('文件清单包含非 UTF-8 路径，无法安全展示差异', 409);
  return bytes.toString('utf8');
}

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
  constructor(private machines: Machines) {}

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
    return this.jobs.start(
      id,
      async (log, signal, update, saveResult) => {
        const incident = new AbortController();
        const lockdown = (target: string) => {
          if (target === id) incident.abort(new AppError('实例已应急锁定，快照比较中止', 423));
        };
        const operationSignal = AbortSignal.any([signal, incident.signal]);
        const tempRoot = join(DATA, 'plugins', 'snapshots');
        await mkdir(tempRoot, { recursive: true });
        const temp = await mkdtemp(join(tempRoot, 'diff-'));
        this.machines.on('incident-lockdown', lockdown);
        try {
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

  async close() {
    this.closed = true;
    await this.jobs.close();
  }
}
