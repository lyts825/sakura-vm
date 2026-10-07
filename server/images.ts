/**
 * 模块职责：声明受支持的发行版镜像并下载校验，按客户机架构选择对应镜像来源。
 * Module purpose: Declares, downloads and verifies supported guest images by architecture and distribution.
 */
import { networkFor } from './network/index.ts';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA, IMAGE } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { writeStore } from './local-store.ts';
import { Jobs } from './jobs.ts';
import { storageRuntime, storageGrowth } from './storage-runtime.ts';

const { fetch } = networkFor('core:images');

export const distributions = {
  alpine: {
    name: 'Alpine 3.23',
    file: IMAGE,
    minimumMemory: 256,
    minimumDisk: 2,
    url: '',
    sums: '',
    algorithm: 'sha512',
  },
  debian: {
    name: 'Debian 12',
    file: join(process.env.SAKURA_IMAGE_DIR || join(DATA, 'images'), 'debian-12.qcow2'),
    minimumMemory: 1024,
    minimumDisk: 4,
    url: 'https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2',
    sums: 'https://cloud.debian.org/images/cloud/bookworm/latest/SHA512SUMS',
    algorithm: 'sha512',
  },
  'debian-arm64': {
    name: 'Debian 12 ARM64',
    file: join(process.env.SAKURA_IMAGE_DIR || join(DATA, 'images'), 'debian-12-arm64.qcow2'),
    minimumMemory: 1024,
    minimumDisk: 4,
    url: 'https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-arm64.qcow2',
    sums: 'https://cloud.debian.org/images/cloud/bookworm/latest/SHA512SUMS',
    algorithm: 'sha512',
  },
  ubuntu: {
    name: 'Ubuntu 24.04 LTS',
    file: join(process.env.SAKURA_IMAGE_DIR || join(DATA, 'images'), 'ubuntu-24.04.qcow2'),
    minimumMemory: 1024,
    minimumDisk: 4,
    url: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
    sums: 'https://cloud-images.ubuntu.com/noble/current/SHA256SUMS',
    algorithm: 'sha256',
  },
} as const;
export type Distro = keyof typeof distributions;
/**
 * 入口 / Entry: distroInfo.
 * 功能：在声明受支持的发行版镜像并下载校验中，执行此领域的具体处理步骤并返回其结果；本入口产生 `distributions[key as Distro]` 供上层消费（`images.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `images.ts`; this entry produces `distributions[key as Distro]` for its caller. Module context: Declares, downloads and verifies supported guest images by architecture and distribution.
 * 输入 / Inputs: id: string default='alpine'; architecture: string default='x86_64'
 * 输出 / Returns: `distributions[key as Distro]`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `architecture !== 'x86_64' && architecture !== 'aarch64'`; `!Object.hasOwn(distributions, key)`; 异常 / errors `new AppError('未知客户机架构')`; `new AppError('未知发行版或架构')`.
 */
export function distroInfo(id: string = 'alpine', architecture: string = 'x86_64') {
  if (architecture !== 'x86_64' && architecture !== 'aarch64') throw new AppError('未知客户机架构');
  const key = architecture === 'aarch64' ? `${id}-arm64` : id;
  if (!Object.hasOwn(distributions, key)) throw new AppError('未知发行版或架构');
  return distributions[key as Distro];
}
/**
 * 入口 / Entry: checksumFor.
 * 功能：在声明受支持的发行版镜像并下载校验中，核对调用资格、输入或资源归属；本入口产生 `match[1]` 供上层消费（`images.ts`）。
 * Purpose: Checks admission, input or resource ownership in `images.ts`; this entry produces `match[1]` for its caller. Module context: Declares, downloads and verifies supported guest images by architecture and distribution.
 * 处理：通过 `text.split`, `inline.exec`, `line.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `text.split`, `inline.exec`, `line.trim`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `match?.[2] === filename`.
 * 输入 / Inputs: text: string; filename: string
 * 输出 / Returns: `match[1]`.
 * 副作用 / Effects: `inline.exec`.
 * 拒绝 / Refusals: 异常 / errors `new AppError('官方校验清单中未找到镜像', 502)`.
 */
export function checksumFor(text: string, filename: string) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64,128})\s+\*?(?:\.\/)?(.+)$/.exec(line.trim());
    if (match?.[2] === filename) return match[1];
  }
  throw new AppError('官方校验清单中未找到镜像', 502);
}
export class Images {
  jobs = new Jobs('images');
  /**
   * 入口 / Entry: Images.list.
   * 功能：从当前输入或状态计算 `Object.entries(distributions).map(([id, info]) => ({ id, name: info.name, ready: existsSync(info.file), minimumMemory: info.m…`，供调用方后续验证或使用。
   * Purpose: Computes `Object.entries(distributions).map(([id, info]) => ({ id, name: info.name, ready: existsSync(info.file), minimumMemory: info.m…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `Object.entries(distributions).map(([id, info]) => ({ id, name: info.name, ready: existsSync(info.file), minimumMemory: info.m…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  list() {
    return Object.entries(distributions).map(([id, info]) => ({
      id,
      name: info.name,
      ready: existsSync(info.file),
      minimumMemory: info.minimumMemory,
      minimumDisk: info.minimumDisk,
      job: this.jobs.view(id),
    }));
  }
  /**
   * 入口 / Entry: Images.prepare.
   * 功能：为所选发行版和架构下载镜像，验证校验和并发布可复用本地镜像。
   * Purpose: Downloads the selected distribution/architecture image, verifies its checksum and publishes reusable local content.
   * 设计：已有文件可复用；下载暂存受截止、存储和取消约束，摘要通过后才替换最终镜像，失败清理 part 文件。
   * Design: Existing images can be reused; staged downloads obey deadline/storage/cancellation and publish only after checksum validation, cleaning failed parts.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.jobs.start( id, async (log, signal, update) => { const timeout = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * …`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `!info.url`; `existsSync(info.file)`; 异常 / errors `new AppError('Alpine 镜像请通过 npm run setup 准备')`; `new AppError('镜像已准备好')`.
   */
  prepare(id: string) {
    const info = distroInfo(id);
    if (!info.url) throw new AppError('Alpine 镜像请通过 npm run setup 准备');
    if (existsSync(info.file)) throw new AppError('镜像已准备好');
    /**
     * 入口 / Entry: Images.prepare.callback@89.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal; update
     * 输出 / Returns: `storageRuntime.run( { owner: 'core:images', taskId: 'image:' + id, label: 'Download verified image', mode: 'write', paths: [i…`.
     * 副作用 / Effects: `AbortSignal.any`; `AbortSignal.timeout`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.jobs.start(
      id,
      async (log, signal, update) => {
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
        /**
         * 入口 / Entry: Images.prepare.callback@103.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
         * 输入 / Inputs: lease
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `mkdir`; `fetch`; `chunks.push`; `createHash`; `createWriteStream`; 更新 / updates `sumBytes`.
         * 拒绝 / Refusals: 条件 / conditions `!sums.ok`; `!sums.body`; `sumBytes > 1024 ** 2`; 异常 / errors `new Error(`校验清单下载失败：${sums.status}`)`; `new Error('校验清单缺失')`.
         * 收尾：退出 try 区域时始终执行 `try { await rm(temp, { force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`；这些步骤也适用于异常退出。
         * Finalization: Leaving the try region always executes `try { await rm(temp, { force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`; these steps also apply to exceptional exits.
         * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
         */
        return storageRuntime.run(
          {
            owner: 'core:images',
            taskId: 'image:' + id,
            label: 'Download verified image',
            mode: 'write',
            paths: [info.file],
            dynamicTemporary: [info.file],
            buffers: 3 * 1024 ** 2,
            files: 3,
            signal: timeout,
          },
          async (lease) => {
            await mkdir(dirname(info.file), { recursive: true });
            const temp = `${info.file}.${randomUUID()}.part`;
            try {
              log('读取官方校验清单…\n');
              const sums = await fetch(info.sums, { signal: timeout });
              if (!sums.ok) throw new Error(`校验清单下载失败：${sums.status}`);
              if (!sums.body) throw new Error('校验清单缺失');
              const chunks: Buffer[] = [];
              let sumBytes = 0;
              for await (const chunk of Readable.fromWeb(sums.body as any)) {
                sumBytes += (chunk as Buffer).length;
                if (sumBytes > 1024 ** 2) throw new Error('校验清单超过 1 MiB');
                chunks.push(chunk as Buffer);
              }
              const expected = checksumFor(
                Buffer.concat(chunks).toString('utf8'),
                info.url.split('/').at(-1)!,
              );
              const response = await fetch(info.url, { signal: timeout });
              if (!response.ok || !response.body) throw new Error(`镜像下载失败：${response.status}`);
              const hash = createHash(info.algorithm);
              const total = Number(response.headers.get('content-length'));
              let size = 0,
                reported = 0;
              await pipeline(
                Readable.fromWeb(response.body as any),
                new Transform({
                  /**
                   * 入口 / Entry: Images.prepare.transform.
                   * 功能：在声明受支持的发行版镜像并下载校验中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cb(new Error('镜像超过 4 GiB'))` 供上层消费（`Images`）。
                   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Images`; this entry produces `cb(new Error('镜像超过 4 GiB'))` for its caller. Module context: Declares, downloads and verifies supported guest images by architecture and distribution.
                   * 处理：通过 `cb`, `hash.update`, `log`, `update` 协调依赖；下列分支决定是否继续、返回或拒绝。
                   * Processing: Coordinates its dependencies through `cb`, `hash.update`, `log`, `update`; the branches below determine continuation, return or refusal.
                   * 分支 / Branches: `size > 4 * 1024 ** 3`; `size - reported >= 32 * 1024 ** 2`.
                   * 输入 / Inputs: chunk; _encoding; cb
                   * 输出 / Returns: `cb(new Error('镜像超过 4 GiB'))`.
                   * 副作用 / Effects: `hash.update`; `update`; 更新 / updates `size`, `reported`.
                   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                   */
                  transform(chunk, _encoding, cb) {
                    size += chunk.length;
                    if (size > 4 * 1024 ** 3) return cb(new Error('镜像超过 4 GiB'));
                    hash.update(chunk);
                    if (size - reported >= 32 * 1024 ** 2) {
                      reported = size;
                      log(`已下载 ${Math.round(size / 1024 ** 2)} MiB\n`);
                      update('下载镜像', total > 0 ? (size / total) * 95 : undefined);
                    }
                    cb(null, chunk);
                  },
                }),
                storageGrowth(lease, temp, 4 * 1024 ** 3),
                createWriteStream(temp, { flags: 'wx' }),
                { signal: timeout },
              );
              if (hash.digest('hex') !== expected) throw new Error('镜像校验失败，请重试');
              await rename(temp, info.file);
              await writeStore(`${info.file}.source.json`, {
                url: info.url,
                algorithm: info.algorithm,
                checksum: expected,
                downloadedAt: new Date().toISOString(),
              });
              log('校验通过，镜像已就绪。\n');
            } finally {
              try {
                await rm(temp, { force: true });
              } catch (error) {
                lease.cleanupPending(error);
                throw error;
              }
            }
          },
        );
      },
      { title: `下载 ${info.name}`, action: 'prepare' },
    );
  }
}
