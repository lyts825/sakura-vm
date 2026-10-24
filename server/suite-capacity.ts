/** 全包容量从原持久账本计算；根账本的核对与替换共享同一准入队列。 */
import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { suiteQuota } from '../shared/contracts/suite-common.ts';
import { suiteHostCapacity, type SuiteHostCapacity } from '../shared/contracts/suite-capacity.ts';
import { MetadataStore } from './metadata-store.ts';
import { serializedMetadata, metadataKey } from './metadata-queue.ts';
import { storageRuntime } from './storage-runtime.ts';
import { DATA } from './paths.ts';
import { suiteRouteRegistry, suiteRootRegistry } from '../shared/contracts/suite-routes.registry.generated.ts';

export type SuiteRootCapacitySpec = Readonly<{ pluginId: string; file: string; memberDirectories?: readonly string[] }>;
type Limits = { limit: number; recoveryReserve: number; packControl: number; rootBytes: number; rootControl: number };
type Quota = z.infer<typeof suiteQuota>;
type Measurement = { used: number; reserved: number; metadataBytes: number; retained: number; present: boolean; quota: Quota[] };
const budgetState = z.object({ schemaVersion: z.literal(1), quota: z.array(suiteQuota).max(50000) }).passthrough();
const fail = (code: string, message: string, status = 413): never => { throw new AppError(message, status, code); };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2));
const defaults: Limits = {
  limit: 8 * 1024 ** 3,
  recoveryReserve: 256 * 1024 ** 2,
  packControl: 32 * 1024 ** 2,
  rootBytes: 32 * 1024 ** 2,
  rootControl: 1024 ** 2,
};
export class SuiteCapacity {
  private readonly roots: readonly SuiteRootCapacitySpec[];
  private readonly stores: ReadonlyMap<string, MetadataStore<unknown>>;
  private readonly limits: Limits;
  private readonly gate: string;
  constructor(directory: string, roots: readonly SuiteRootCapacitySpec[], limits: Partial<Limits> = {}) {
    this.gate = join(resolve(directory), 'suite-capacity-admission');
    this.roots = roots.map((root) => ({
      ...root, file: resolve(root.file), memberDirectories: root.memberDirectories?.map((directory) => resolve(directory)),
    }));
    this.limits = { ...defaults, ...limits };
    const l = this.limits;
    if (Object.values(l).some((value) => !Number.isSafeInteger(value) || value < 0) ||
      l.limit <= l.recoveryReserve || l.rootBytes <= l.rootControl ||
      new Set(this.roots.map((root) => root.pluginId)).size !== roots.length ||
      new Set(this.roots.map((root) => metadataKey(root.file))).size !== roots.length)
      throw new Error('插件包宿主容量配置无效');
    this.stores = new Map(this.roots.map((root) => [root.pluginId, new MetadataStore(root.file, { fallback: () => null })]));
  }
  owns(pluginId: string, file: string): boolean {
    return this.roots.some((root) => root.pluginId === pluginId && metadataKey(root.file) === metadataKey(file));
  }
  private usage(value: unknown, metadataBytes: number, retained: number, present: boolean): Measurement {
    const quota = value === null ? [] : budgetState.parse(value).quota;
    const used = metadataBytes + quota.filter((row) => row.state === 'committed').reduce((sum, row) => sum + row.bytes, 0),
      reserved = retained + (present ? this.limits.packControl : 0) +
        quota.filter((row) => row.state === 'reserved').reduce((sum, row) => sum + row.bytes, 0);
    if (!Number.isSafeInteger(used) || !Number.isSafeInteger(reserved) || !Number.isSafeInteger(used + reserved))
      fail('SUITE_HOST_CAPACITY_UNKNOWN', '原容量账本的数值无法核对，保留原占用', 503);
    return {
      used, reserved,
      metadataBytes, retained, present, quota,
    };
  }
  private async regular(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > this.limits.rootBytes)
      fail('SUITE_HOST_CAPACITY_UNKNOWN', '根账本身份或大小无法核对，请保留原文件并恢复原账本', 503);
    return info;
  }
  private async measure(root: SuiteRootCapacitySpec, signal?: AbortSignal): Promise<Measurement> {
    signal?.throwIfAborted();
    let retained = 0, value: unknown = null, metadataBytes = 0, present = false, sawFile = false;
    let hasMaterialLedger = false;
    try {
      const names = await readdir(dirname(root.file));
      hasMaterialLedger = names.includes('uploads.json') || names.includes('materials');
      if (names.length > 4096) fail('SUITE_HOST_CAPACITY_UNKNOWN', '根账本目录超过核对预算，保留原文件', 503);
      const prefix = basename(root.file) + '.';
      for (const name of names) {
        if (!name.startsWith(prefix) || !/^[a-f0-9-]{36}\.tmp$/i.test(name.slice(prefix.length))) continue;
        signal?.throwIfAborted();
        retained += (await this.regular(join(dirname(root.file), name))).size;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      const before = await this.regular(root.file);
      sawFile = true;
      const snapshot = await this.stores.get(root.pluginId)!.read(signal),
        after = await this.regular(root.file);
      if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || snapshot.value === null)
        fail('SUITE_HOST_CAPACITY_UNKNOWN', '根账本在核对期间发生变化，请重试', 503);
      value = snapshot.value;
      metadataBytes = after.size;
      present = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (sawFile || hasMaterialLedger)
        fail('SUITE_HOST_CAPACITY_UNKNOWN', '根账本缺失而材料可能仍占用，不能释放原占用', 503);
      for (const directory of root.memberDirectories ?? []) {
        try {
          const names = await readdir(directory);
          if (names.some((name) => ['state.json', 'bytes.json', 'uploads.json', 'materials'].includes(name)))
            fail('SUITE_HOST_CAPACITY_UNKNOWN', '根账本缺失而领域材料仍存在，不能释放原占用', 503);
        } catch (inner) { if ((inner as NodeJS.ErrnoException).code !== 'ENOENT') throw inner; }
      }
    }
    return this.usage(value, metadataBytes, retained, present || retained > 0);
  }
  private async snapshot(signal?: AbortSignal) {
    const measured = new Map<string, Measurement>();
    for (const root of this.roots) {
      try { measured.set(root.pluginId, await this.measure(root, signal)); }
      catch (error) {
        if (signal?.aborted || error instanceof AppError) throw error;
        fail('SUITE_HOST_CAPACITY_UNKNOWN', `无法核对 ${root.pluginId} 的持久账本，保留原占用`, 503);
      }
    }
    return measured;
  }
  private summary(measured: ReadonlyMap<string, Measurement>): SuiteHostCapacity {
    const rows = [...measured.values()];
    return suiteHostCapacity.parse({
      used: rows.reduce((sum, row) => sum + row.used, 0),
      reserved: rows.reduce((sum, row) => sum + row.reserved, 0),
      retainedMetadataBytes: rows.reduce((sum, row) => sum + row.retained, 0),
      packs: rows.filter((row) => row.present).length,
      limit: this.limits.limit,
      ordinaryLimit: this.limits.limit - this.limits.recoveryReserve,
      recoveryReserve: this.limits.recoveryReserve,
    });
  }
  private io<T>(mode: 'read' | 'write', signal: AbortSignal | undefined, work: () => Promise<T>, temporary?: { path: string; bytes: number }) {
    return storageRuntime.run({
      owner: 'suite-capacity', taskId: randomUUID(), label: '插件包持久容量核对',
      paths: this.roots.map((root) => root.file), mode, buffers: this.limits.rootBytes,
      files: this.roots.length + 2, signal, lane: 'control', temporary: temporary ? [temporary] : [],
    }, work);
  }
  read(signal?: AbortSignal): Promise<SuiteHostCapacity> {
    return serializedMetadata(this.gate, false, () => this.io('read', signal, async () => this.summary(await this.snapshot(signal))));
  }
  publish<T, Value>(pluginId: string, file: string, value: Value, control: boolean, signal: AbortSignal | undefined, commit: (captured: Value) => Promise<T>): Promise<T> {
    if (!this.owns(pluginId, file)) return Promise.reject(new AppError('容量句柄不属于此根账本', 403, 'SUITE_HOST_CAPACITY_OWNER'));
    // 进入排队前捕获，避免调用方在批准和实际写入之间改变对象。
    const next = structuredClone(value), nextBytes = bytes(next);
    if (nextBytes > this.limits.rootBytes - (control ? 0 : this.limits.rootControl))
      return Promise.reject(new AppError('根账本容量不足，保留控制空间用于恢复', 413, 'SUITE_HOST_ROOT_LIMIT'));
    return serializedMetadata(this.gate, false, () => this.io('write', signal, async () => {
      const measured = await this.snapshot(signal), before = measured.get(pluginId)!, old = this.summary(measured),
        after = this.usage(next, nextBytes, before.retained, true);
      const active = new Map(before.quota.filter((row) => row.state !== 'released').map((row) => [row.id, row]));
      const noNewMaterial = after.quota.filter((row) => row.state !== 'released' && row.kind !== 'metadata').every((row) => {
        const prior = active.get(row.id);
        return prior && prior.kind === row.kind && row.bytes <= prior.bytes;
      });
      measured.set(pluginId, after);
      const current = this.summary(measured), total = current.used + current.reserved,
        oldTotal = old.used + old.reserved, peak = total + before.metadataBytes;
      if (peak > this.limits.limit ||
        (total > current.ordinaryLimit && total > oldTotal && !(control && noNewMaterial)))
        fail('SUITE_HOST_QUOTA_EXCEEDED', '所有新插件包的宿主总额度不足，请核对原占用并清理后重试');
      signal?.throwIfAborted();
      return commit(next);
    }, { path: file, bytes: nextBytes }));
  }
}

const rootIds = Object.values(suiteRootRegistry);
let shared: SuiteCapacity | undefined;
export function suiteCapacity() {
  if (!shared) {
    const configured = process.env.SAKURA_SUITE_CAPACITY_BYTES;
    const limit = configured === undefined ? defaults.limit : Number(configured);
    if (!Number.isSafeInteger(limit) || limit < 512 * 1024 ** 2 || limit > 1024 ** 4)
      throw new AppError('SAKURA_SUITE_CAPACITY_BYTES 必须为 512 MiB 到 1 TiB 的整数字节数', 503, 'SUITE_HOST_CAPACITY_CONFIG');
    shared = new SuiteCapacity(DATA, rootIds.map((pluginId) => {
      const prefix = pluginId.split('-')[0] as keyof typeof suiteRouteRegistry;
      return {
        pluginId, file: join(DATA, 'plugins', pluginId, 'state.json'),
        memberDirectories: Object.keys(suiteRouteRegistry[prefix]).map((domain) => join(DATA, 'plugins', prefix + '-' + domain)),
      };
    }), { limit });
  }
  return shared;
}
export function suiteCapacityFor(pluginId: string, file: string) {
  if (!(rootIds as readonly string[]).includes(pluginId) || basename(file) !== 'state.json') return undefined;
  const authority = suiteCapacity();
  return authority.owns(pluginId, file) ? authority : undefined;
}
