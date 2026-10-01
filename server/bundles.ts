import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError, DATA, createSchema, vmDir, type VMRecord } from './model.ts';
import type { Machines } from './machines.ts';
import { projectSchema } from './workspaces.ts';
import { projectIdSchema, projectIndexSchema } from './project-catalog.ts';
import ssh2 from 'ssh2';
import { ByteRate } from './byte-rate.ts';
import { bundleSignatureSchema, verifySignedManifest, type SignedBundles } from './signed-bundles.ts';
import { diskEncryptionSchema, encryptedImageOptions,
  qemuSecretObject } from './disk-encryption.ts';
import { Secrets } from './secrets.ts';
import { DesktopBindings, desktopBindingSchema } from './desktop-binding.ts';
import { x11ClipboardConfiguration } from './x11-clipboard.ts';
import { writeStore } from './local-store.ts';
import type { TrustedBootService } from './trusted-boot-service.ts';
import { decodeTrustedBootArchive, encodeTrustedBootArchive, trustedBootArchiveSchema,
  type TrustedBootFiles } from './trusted-boot-archive.ts';

const MAGIC = Buffer.from('SAKURA01');
const MAX_BUNDLE = 32 * 1024 ** 3;
export const MAX_BUNDLE_MANIFEST = 8 * 1024 ** 2;
const manifestSchema = z
  .object({
    version: z.literal(1),
    config: createSchema,
    project: projectSchema.optional(),
    projects: z
      .object({
        active: z.string().regex(/^(default|[a-f0-9]{16})$/),
        projects: z
          .array(z.object({ id: projectIdSchema, name: z.string().trim().min(1).max(64) }).strict())
          .min(1)
          .max(20),
        configs: z.record(z.string(), projectSchema),
      })
      .strict()
      .refine(
        (value) =>
          new Set(value.projects.map((entry) => entry.id)).size === value.projects.length &&
          value.projects.some((entry) => entry.id === 'default') &&
          value.projects.some((entry) => entry.id === value.active),
        '项目目录损坏',
      )
      .optional(),
    pendingResize: z.boolean().default(false),
    diskEncryption: diskEncryptionSchema.optional(),
    trustedBoot: trustedBootArchiveSchema.optional(),
    desktopBinding: desktopBindingSchema.optional(),
    x11Clipboard: x11ClipboardConfiguration.optional(),
    waylandClipboard: x11ClipboardConfiguration.optional(),
    key: z.string().max(16384),
    seed: z.string().max(262144),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    signature: bundleSignatureSchema.optional(),
  })
  .strict();
export function validateDiskHeader(header: Buffer, allowEncryption = false) {
  if (
    header.length < 104 ||
    header.readUInt32BE(0) !== 0x514649fb ||
    ![2, 3].includes(header.readUInt32BE(4))
  )
    throw new AppError('需要 QCOW2 磁盘');
  if (header.readBigUInt64BE(8) !== 0n || header.readUInt32BE(16) !== 0)
    throw new AppError('导入磁盘不能依赖外部基础镜像');
  if (header.readUInt32BE(32) !== (allowEncryption ? 2 : 0))
    throw new AppError('磁盘加密格式与导入清单不一致');
  if (header.readUInt32BE(4) === 3 && (header.readBigUInt64BE(72) & 4n) !== 0n)
    throw new AppError('不支持外部数据文件');
  if (header.readBigUInt64BE(24) > 128n * 1024n ** 3n) throw new AppError('虚拟磁盘不能超过 128 GiB');
}
export class Bundles {
  private trustedBoot?: TrustedBootService;
  constructor(
    private machines: Machines,
    private signatures?: SignedBundles,
  ) {}
  setTrustedBoot(service: TrustedBootService) { this.trustedBoot = service; }
  private async project(id: string) {
    try {
      return projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  private async x11Clipboard(id: string, transport: 'x11' | 'wayland' = 'x11') {
    try {
      return x11ClipboardConfiguration.parse(JSON.parse(await readFile(join(vmDir(id), `${transport}-clipboard.json`), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  private async projectCatalog(id: string) {
    try {
      const index = projectIndexSchema.parse(
        JSON.parse(await readFile(join(vmDir(id), 'projects.json'), 'utf8')),
      );
      const configs: Record<string, ReturnType<typeof projectSchema.parse>> = {};
      for (const entry of index.projects) {
        const file = entry.id === 'default' ? 'project.json' : `project-${entry.id}.json`;
        try {
          configs[entry.id] = projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), file), 'utf8')));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return { active: index.active, projects: index.projects, configs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  private async temp() {
    await mkdir(join(DATA, 'transfers'), { recursive: true });
    return mkdtemp(join(DATA, 'transfers', 'bundle-'));
  }
  async export(id: string, target: Writable, headers: () => void, signal?: AbortSignal,
    bytesPerSecond = 0, snapshotId?: string) {
    return this.machines.locked(id, async () => {
      this.machines.requireStopped(id);
      const vm = this.machines.get(id);
      const snapshot = snapshotId ? vm.snapshots.find((item) => item.id === snapshotId) : undefined;
      if (snapshotId && !snapshot) throw new AppError('快照不存在', 404);
      const trustedBoot = await this.trustedBoot?.capture(id, snapshotId);
      const dir = await this.temp();
      try {
        const disk = join(dir, 'disk.qcow2');
        if (vm.diskEncryption)
          await this.machines.withDiskSecret(vm, (secret) => this.machines.engine.run(
            'sakura-img', ['convert', '--object', qemuSecretObject(secret),
              '--image-opts', '-O', 'qcow2',
              '-o', 'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
              ...(snapshotId ? ['-l', snapshotId] : []),
              encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
              disk], { timeoutMs: 1800000, signal }));
        else await this.machines.engine.run('sakura-img',
          ['convert', '-f', 'qcow2', '-O', 'qcow2',
            ...(snapshotId ? ['-l', snapshotId] : []), join(vmDir(id), 'disk.qcow2'), disk],
          { timeoutMs: 1800000, signal });
        signal?.throwIfAborted();
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(disk)) {
          signal?.throwIfAborted();
          hash.update(chunk);
        }
        const {
          name,
          memoryMiB,
          cpus,
          diskGiB,
          accelerator,
          forwards,
          distro,
          architecture,
          template,
          hardware,
          firmware,
          pendingResize,
        } = this.machines.get(id);
        const identity = await this.machines.snapshotIdentity(id, snapshotId);
        const unsigned = manifestSchema.parse({
          version: 1,
          desktopBinding: await new DesktopBindings(this.machines).read(id) || undefined,
          x11Clipboard: await this.x11Clipboard(id),
          waylandClipboard: await this.x11Clipboard(id, 'wayland'),
          config: { name, memoryMiB, cpus, diskGiB: snapshot?.diskGiB || diskGiB,
            accelerator, forwards, distro, architecture, template, hardware, firmware },
          project: await this.project(id),
          projects: await this.projectCatalog(id),
          ...((snapshot ? snapshot.pendingResize : pendingResize) ? { pendingResize: true } : {}),
          ...(vm.diskEncryption ? { diskEncryption: vm.diskEncryption } : {}),
          ...(trustedBoot ? { trustedBoot: encodeTrustedBootArchive(trustedBoot) } : {}),
          key: identity.key,
          seed: identity.seed.toString('base64'),
          sha256: hash.digest('hex'),
        });
        const manifest = Buffer.from(JSON.stringify(this.signatures?.signManifest(unsigned) || unsigned));
        if (manifest.length > MAX_BUNDLE_MANIFEST ||
            (await stat(disk)).size + manifest.length + 12 > MAX_BUNDLE)
          throw new AppError('当前导出包超过大小上限');
        const length = Buffer.alloc(4);
        length.writeUInt32BE(manifest.length);
        signal?.throwIfAborted();
        headers();
        async function* contents() {
          yield MAGIC;
          yield length;
          yield manifest;
          yield* createReadStream(disk);
        }
        await pipeline(
          Readable.from(contents()),
          new ByteRate(bytesPerSecond).stream(signal || new AbortController().signal),
          target,
          { signal },
        );
        return unsigned.sha256;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
  async import(name: string, source: Readable, signal?: AbortSignal, beforeAdopt?: () => void,
    migrationOrigin?: VMRecord['migrationOrigin']) {
    return this.importCore(name, source, signal, beforeAdopt, false, migrationOrigin);
  }
  async importExternal(name: string, source: Readable, signal?: AbortSignal) {
    return this.importCore(name, source, signal, undefined, true);
  }
  private async importCore(
    name: string,
    source: Readable,
    signal?: AbortSignal,
    beforeAdopt?: () => void,
    external = false,
    migrationOrigin?: VMRecord['migrationOrigin'],
  ) {
    return this.withContents(source, signal, async (disk, manifest, seed, trustedBoot) => {
      if (trustedBoot && !this.trustedBoot)
        throw new AppError('TPM 状态恢复服务不可用', 503);
      const publish = async () => {
        signal?.throwIfAborted();
        beforeAdopt?.();
        const adopted = await this.machines.adopt(
          { ...manifest.config, name, forwards: [] },
          disk,
          manifest.key,
          seed,
          manifest.project,
          manifest.pendingResize,
          manifest.projects,
          migrationOrigin ? { ...migrationOrigin, diskSha256: manifest.sha256 } : undefined,
          manifest.diskEncryption,
        );
        if (manifest.desktopBinding) {
          try { await writeStore(join(vmDir(adopted.id), 'desktop-binding.json'), manifest.desktopBinding); }
          catch (error) { await this.machines.delete(adopted.id); throw error; }
        }
        if (manifest.x11Clipboard) {
          try { await writeStore(join(vmDir(adopted.id), 'x11-clipboard.json'), manifest.x11Clipboard); }
          catch (error) { await this.machines.delete(adopted.id); throw error; }
        }
        if (manifest.waylandClipboard) {
          try { await writeStore(join(vmDir(adopted.id), 'wayland-clipboard.json'), manifest.waylandClipboard); }
          catch (error) { await this.machines.delete(adopted.id); throw error; }
        }
        if (trustedBoot) {
          try { await this.trustedBoot!.restore(adopted.id, trustedBoot); }
          catch (error) {
            await this.machines.delete(adopted.id);
            throw error;
          }
        }
        return adopted;
      };
      return external && this.signatures
        ? this.signatures.withAuthorizedExternal(manifest.signature, publish)
        : publish();
    });
  }
  /** A verified standalone disk exists only for the duration of the callback. */
  async withDisk<T>(source: Readable, signal: AbortSignal,
    work: (disk: string, diskEncryption?: VMRecord['diskEncryption']) => Promise<T>) {
    return this.withContents(source, signal,
      (disk, manifest) => work(disk, manifest.diskEncryption));
  }
  private async withContents<T>(
    source: Readable,
    signal: AbortSignal | undefined,
    work: (disk: string, manifest: z.infer<typeof manifestSchema>, seed: Buffer,
      trustedBoot?: TrustedBootFiles) => Promise<T>,
  ) {
    signal?.throwIfAborted();
    const dir = await this.temp();
    const disk = join(dir, 'disk.qcow2');
    try {
      let prefix = Buffer.alloc(0),
        manifest: z.infer<typeof manifestSchema> | undefined,
        total = 0;
      const hash = createHash('sha256');
      await pipeline(
        source,
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            total += chunk.length;
            if (total > MAX_BUNDLE) return cb(new AppError('导入包超过 32 GiB', 413));
            if (!manifest) {
              prefix = Buffer.concat([prefix, chunk]);
              if (prefix.length < 12) return cb();
              if (!prefix.subarray(0, 8).equals(MAGIC)) return cb(new AppError('不是 Sakura 导出文件'));
              const length = prefix.readUInt32BE(8);
              if (length > MAX_BUNDLE_MANIFEST || length < 2)
                return cb(new AppError('无效的导入清单'));
              if (prefix.length < 12 + length) return cb();
              try {
                manifest = manifestSchema.parse(
                  JSON.parse(prefix.subarray(12, 12 + length).toString('utf8')),
                );
              } catch {
                return cb(new AppError('导入清单损坏'));
              }
              chunk = prefix.subarray(12 + length);
              prefix = Buffer.alloc(0);
            }
            hash.update(chunk);
            cb(null, chunk);
          },
        }),
        createWriteStream(disk, { flags: 'wx', mode: 0o600 }),
        { signal },
      );
      signal?.throwIfAborted();
      if (!manifest || hash.digest('hex') !== manifest.sha256)
        throw new AppError('导入包不完整或磁盘校验失败');
      verifySignedManifest(manifest);
      const trustedBoot = manifest.trustedBoot
        ? decodeTrustedBootArchive(manifest.trustedBoot) : undefined;
      const handle = await open(disk, 'r');
      try {
        const b = Buffer.alloc(104);
        await handle.read(b, 0, b.length, 0);
        validateDiskHeader(b, !!manifest.diskEncryption);
      } finally {
        await handle.close();
      }
      const info = JSON.parse(
        await this.machines.engine.run('sakura-img', ['info', '-f', 'qcow2', '--output=json', disk], {
          signal,
        }),
      );
      if (info['backing-filename'] || info['format-specific']?.data?.['data-file'])
        throw new AppError('导入磁盘含外部依赖');
      if (!!info.encrypted !== !!manifest.diskEncryption)
        throw new AppError('磁盘加密状态与导入清单不一致');
      const key = manifest.key;
      const parsedKey = ssh2.utils.parseKey(key);
      const identity = Array.isArray(parsedKey) ? parsedKey[0] : parsedKey;
      if (!identity || identity instanceof Error || !identity.getPrivatePEM())
        throw new AppError('导入包缺少有效实例身份私钥');
      const seed = Buffer.from(manifest.seed, 'base64');
      if (seed.length < 34816 || seed.toString('ascii', 32769, 32774) !== 'CD001')
        throw new AppError('初始化镜像已损坏');
      signal?.throwIfAborted();
      return await work(disk, manifest, seed, trustedBoot);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async clone(id: string, name: string, snapshot?: string, signal?: AbortSignal) {
    return this.machines.locked(id, async () => {
      signal?.throwIfAborted();
      this.machines.requireStopped(id);
      const vm = this.machines.get(id);
      const shot = snapshot ? vm.snapshots.find((s) => s.id === snapshot) : undefined;
      if (snapshot && !shot) throw new AppError('快照不存在', 404);
      const trustedBoot = await this.trustedBoot?.capture(id, snapshot);
      const dir = await this.temp();
      try {
        const disk = join(dir, 'disk.qcow2');
        if (vm.diskEncryption)
          await this.machines.withDiskSecret(vm, (secret) => this.machines.engine.run(
            'sakura-img', ['convert', '--object', qemuSecretObject(secret),
              '--image-opts', '-O', 'qcow2',
              '-o', 'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
              ...(snapshot ? ['-l', snapshot] : []),
              encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
              disk], { timeoutMs: 1800000, signal }));
        else await this.machines.engine.run('sakura-img', [
          'convert', '-f', 'qcow2', '-O', 'qcow2',
          ...(snapshot ? ['-l', snapshot] : []), join(vmDir(id), 'disk.qcow2'), disk,
        ], { timeoutMs: 1800000, signal });
        const identity = await this.machines.snapshotIdentity(id, snapshot);
        const { memoryMiB, cpus, diskGiB, accelerator, distro, template, hardware, firmware,
          storagePoolId } = vm;
        const project = await this.project(id);
        const projects = await this.projectCatalog(id);
        const desktopBinding = await new DesktopBindings(this.machines).read(id);
        const x11Clipboard = await this.x11Clipboard(id);
        const waylandClipboard = await this.x11Clipboard(id, 'wayland');
        signal?.throwIfAborted();
        const adopted = await this.machines.adopt(
          {
            name,
            memoryMiB,
            cpus,
            diskGiB: shot?.diskGiB || diskGiB,
            accelerator,
            distro,
            template,
            hardware,
            firmware,
            storagePoolId,
            forwards: [],
          },
          disk,
          identity.key,
          identity.seed,
          project,
          !!(shot ? shot.pendingResize : vm.pendingResize),
          projects,
          undefined,
          vm.diskEncryption,
          snapshot && !vm.diskEncryption
            ? { sourceVmId: id, snapshotId: snapshot, createdAt: new Date().toISOString() }
            : undefined,
        );
        if (desktopBinding) {
          try { await writeStore(join(vmDir(adopted.id), 'desktop-binding.json'), desktopBinding); }
          catch (error) { await this.machines.delete(adopted.id); throw error; }
        }
        if (x11Clipboard) {
          try { await writeStore(join(vmDir(adopted.id), 'x11-clipboard.json'), x11Clipboard); }
          catch (error) { await this.machines.delete(adopted.id); throw error; }
        }
        if (waylandClipboard) {
          try { await writeStore(join(vmDir(adopted.id), 'wayland-clipboard.json'), waylandClipboard); }
          catch (error) { await this.machines.delete(adopted.id); throw error; }
        }
        if (vm.diskEncryption) {
          const secrets = new Secrets(this.machines);
          await secrets.save(adopted.id, { name: vm.diskEncryption.secretName,
            value: await secrets.value(id, vm.diskEncryption.secretName) });
        }
        if (trustedBoot) {
          try { await this.trustedBoot!.restore(adopted.id, trustedBoot); }
          catch (error) {
            await this.machines.delete(adopted.id);
            throw error;
          }
        }
        return adopted;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}
