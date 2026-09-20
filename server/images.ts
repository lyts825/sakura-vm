import { existsSync, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA, IMAGE, AppError } from './model.ts';
import { Jobs } from './jobs.ts';

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
export function distroInfo(id: string = 'alpine') {
  if (!Object.hasOwn(distributions, id)) throw new AppError('未知发行版');
  return distributions[id as Distro];
}
export function checksumFor(text: string, filename: string) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64,128})\s+\*?(?:\.\/)?(.+)$/.exec(line.trim());
    if (match?.[2] === filename) return match[1];
  }
  throw new AppError('官方校验清单中未找到镜像', 502);
}
export class Images {
  jobs = new Jobs();
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
  prepare(id: string) {
    const info = distroInfo(id);
    if (!info.url) throw new AppError('Alpine 镜像请通过 npm run setup 准备');
    if (existsSync(info.file)) throw new AppError('镜像已准备好');
    return this.jobs.start(id, async (log, signal) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
      await mkdir(dirname(info.file), { recursive: true });
      const temp = `${info.file}.${randomUUID()}.part`;
      try {
        log('读取官方校验清单…\n');
        const sums = await fetch(info.sums, { signal: timeout });
        if (!sums.ok) throw new Error(`校验清单下载失败：${sums.status}`);
        const expected = checksumFor(await sums.text(), info.url.split('/').at(-1)!);
        const response = await fetch(info.url, { signal: timeout });
        if (!response.ok || !response.body) throw new Error(`镜像下载失败：${response.status}`);
        const hash = createHash(info.algorithm);
        let size = 0,
          reported = 0;
        await pipeline(
          Readable.fromWeb(response.body as any),
          new Transform({
            transform(chunk, _encoding, cb) {
              size += chunk.length;
              if (size > 4 * 1024 ** 3) return cb(new Error('镜像超过 4 GiB'));
              hash.update(chunk);
              if (size - reported >= 32 * 1024 ** 2) {
                reported = size;
                log(`已下载 ${Math.round(size / 1024 ** 2)} MiB\n`);
              }
              cb(null, chunk);
            },
          }),
          createWriteStream(temp, { flags: 'wx' }),
          { signal: timeout },
        );
        if (hash.digest('hex') !== expected) throw new Error('镜像校验失败，请重试');
        await rename(temp, info.file);
        await writeFile(
          `${info.file}.source.json`,
          JSON.stringify(
            {
              url: info.url,
              algorithm: info.algorithm,
              checksum: expected,
              downloadedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
        log('校验通过，镜像已就绪。\n');
      } finally {
        await rm(temp, { force: true });
      }
    });
  }
}
