/** 新建受管执行空间；只向新目录写入已封存字节，命令以项目 UID 运行。 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type {
  DeliveryScope,
  DeliveryEnvironment,
  DeliveryManifest,
  DeliveryFile,
} from '../shared/contracts/delivery-common.ts';
import { deliveryPathSchema } from '../shared/contracts/delivery-common.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import { projectSchema, type Project } from './project-config.ts';
import { distroInfo } from './images.ts';
import { quote } from './shell.ts';
import { AppError } from '../shared/errors.ts';
import { ftpStat } from './files.ts';

export type DeliverySpace = {
  vmId: string;
  createdAt: string;
  project: Project;
  environment: DeliveryEnvironment;
  imageSha256: string;
  live: NonNullable<ReturnType<VmAccess['live']['get']>>;
  uid: number;
  gid: number;
};
export class DeliveryExecutor {
  constructor(
    readonly machines: VmAccess,
    private workspaces: WorkspacesV1,
    private artifacts: DeliveryArtifactsV1,
  ) {}
  /** 核对本地基础镜像与固定摘要。 Verifies the prepared local base image and pinned digest. */
  async available(environment: DeliveryEnvironment) {
    const image = distroInfo(environment.distro, environment.architecture),
      info = await lstat(image.file);
    if (!info.isFile() || info.isSymbolicLink()) throw new AppError('基础镜像必须是已准备的普通文件', 409);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(image.file)) hash.update(chunk);
    const imageSha256 = hash.digest('hex');
    if (environment.imageSha256 && environment.imageSha256 !== imageSha256)
      throw new AppError('基础镜像摘要与固定输入不一致', 409);
    return { image, imageSha256 };
  }
  /** 创建原生命周期管理的新 VM，并预留受保护项目 UID。 Creates a managed fresh VM and reserves its protected project UID. */
  async create(
    environment: DeliveryEnvironment,
    lifetimeMinutes: number,
    signal: AbortSignal,
    record: (vmId: string, createdAt: string) => Promise<void>,
  ): Promise<DeliverySpace> {
    const { image, imageSha256 } = await this.available(environment);
    signal.throwIfAborted();
    const vm = await this.machines.create(
      {
        name: 'delivery-' + randomUUID().slice(0, 8),
        distro: environment.distro,
        architecture: environment.architecture,
        template: 'none',
        memoryMiB: Math.max(image.minimumMemory, 512),
        cpus: 1,
        diskGiB: Math.max(image.minimumDisk, 4),
        forwards: [],
      },
      {
        network: environment.network,
        onExpire: 'delete',
        storage: 'discard-on-stop',
        expiresAt: new Date(Date.now() + lifetimeMinutes * 60_000).toISOString(),
      },
    );
    await record(vm.id, vm.createdAt);
    await this.machines.start(vm.id);
    const deadline = Date.now() + 240_000;
    while (this.machines.state(vm.id) === 'starting' && Date.now() < deadline)
      await delay(100, undefined, { signal });
    if (this.machines.state(vm.id) !== 'running') throw new AppError('交付实例启动失败或超时', 409);
    const current = await this.available(environment);
    if (current.imageSha256 !== imageSha256) throw new AppError('启动期间基础镜像发生变化', 409);
    const project = projectSchema.parse({
      directory: '/workspace/delivery',
      environment: environment.publicEnvironment,
    });
    await this.workspaces.save(vm.id, project);
    const live = this.machines.live.get(vm.id)!;
    if (environment.network === 'isolated') {
      const tools = await this.machines.exec(
        vm.id,
        'for tool in python3 cc ip openssl useradd groupadd nft; do command -v "$tool" >/dev/null || exit 1; done',
        15_000,
        signal,
      );
      if (tools.code !== 0)
        throw new AppError(
          '隔离镜像缺少项目账号基础工具（Python 3、C 编译器、iproute2、OpenSSL、shadow、nftables）；请先准备镜像，或审阅后在交付定义中允许 NAT 依赖准备。未自动开启网络。',
          409,
          'DELIVERY_IMAGE_NOT_READY',
        );
    }
    const created = await this.machines.exec(
      vm.id,
      'set -eu\nmkdir -p /workspace\nchmod 755 /workspace\ntest ! -e /workspace/delivery\nmkdir -m 700 /workspace/delivery',
      30_000,
      signal,
    );
    if (created.code !== 0) throw new AppError('交付专用目录创建失败：' + created.stderr, 409);
    const scopes = new ProjectRunScopes(this.machines),
      identity = await scopes.reserve(vm.id, project, signal);
    // This root command uses only generated paths and host-owned numeric identities, before project code exists.
    const made = await this.machines.exec(
      vm.id,
      `chown ${identity.uid}:${identity.gid} /workspace/delivery`,
      30_000,
      signal,
    );
    if (made.code !== 0) throw new AppError('交付专用目录创建失败：' + made.stderr, 409);
    await scopes.identity(vm.id, project, signal);
    return {
      vmId: vm.id,
      createdAt: vm.createdAt,
      project,
      environment,
      imageSha256,
      live,
      uid: identity.uid,
      gid: identity.gid,
    };
  }
  /** 检查原 VM 与原运行身份，拒绝替代实例。 Rejects replaced VM or live-run identities. */
  check(space: DeliverySpace, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (
      this.machines.get(space.vmId).createdAt !== space.createdAt ||
      this.machines.live.get(space.vmId) !== space.live
    )
      throw new AppError('原交付实例运行身份已变化', 409, 'DELIVERY_IDENTITY_CHANGED');
  }
  /** 分块核对并写入封存字节；项目代码尚未运行。 Stages verified sealed bytes before any project code runs. */
  async stage(space: DeliverySpace, scope: DeliveryScope, manifest: DeliveryManifest, signal: AbortSignal) {
    await this.artifacts.verify(scope, manifest.id);
    const directories = new Set(['/workspace/delivery']);
    await this.machines.sftp(
      space.vmId,
      async (ftp) => {
        for (const file of manifest.files) {
          this.check(space, signal);
          deliveryPathSchema.parse(file.path);
          let parent = '/workspace/delivery';
          for (const part of file.path.split('/').slice(0, -1)) {
            parent += '/' + part;
            if (!directories.has(parent)) {
              await new Promise<void>((resolve, reject) =>
                ftp.mkdir(parent, { mode: 0o700 }, (error) => (error ? reject(error) : resolve())),
              );
              await new Promise<void>((resolve, reject) =>
                ftp.chown(parent, space.uid, space.gid, (error) => (error ? reject(error) : resolve())),
              );
              directories.add(parent);
            }
          }
          const path = '/workspace/delivery/' + file.path;
          const handle = await new Promise<Buffer>((resolve, reject) =>
            ftp.open(path, 'wx', { mode: file.mode & 0o777 }, (error, value) =>
              error ? reject(error) : resolve(value),
            ),
          );
          const hash = createHash('sha256');
          let offset = 0;
          try {
            while (offset < file.bytes) {
              this.check(space, signal);
              const part = await this.artifacts.read(
                scope,
                file.blobId,
                offset,
                Math.min(512 * 1024, file.bytes - offset),
              );
              const data = Buffer.from(part.data, 'base64');
              if (!data.length || data.length > file.bytes - offset)
                throw new AppError('制品分块长度不正确', 409);
              hash.update(data);
              await new Promise<void>((resolve, reject) =>
                ftp.write(handle, data, 0, data.length, offset, (error) =>
                  error ? reject(error) : resolve(),
                ),
              );
              offset += data.length;
            }
            if (hash.digest('hex') !== file.sha256) throw new AppError('输入制品摘要核对失败', 409);
            await new Promise<void>((resolve, reject) =>
              ftp.fchown(handle, space.uid, space.gid, (error) => (error ? reject(error) : resolve())),
            );
          } finally {
            await new Promise<void>((resolve, reject) =>
              ftp.close(handle, (error) => (error ? reject(error) : resolve())),
            );
          }
        }
      },
      signal,
    );
  }
  /** 沿用项目身份执行和进程回收约束。 Executes through the existing project-identity lifecycle. */
  async command(
    space: DeliverySpace,
    command: string,
    timeoutSeconds: number,
    signal: AbortSignal,
    log?: (text: string) => void,
  ) {
    this.check(space, signal);
    return projectIdentityTask(
      this.machines,
      space.vmId,
      space.project,
      { command, environment: space.environment.publicEnvironment },
      signal,
      log,
      timeoutSeconds * 1000,
      undefined,
      undefined,
      { expectedLive: space.live },
    );
  }
  /** 以实际 UID、架构和运行时探测形成环境证据。 Records observed UID, architecture, and runtime evidence. */
  async environment(space: DeliverySpace, signal: AbortSignal) {
    const result = await this.command(
      space,
      'printf "arch="; uname -m; printf "uid="; id -u; printf "node=%s\\n" "$(node --version 2>/dev/null || true)"; printf "python=%s\\n" "$(python3 --version 2>/dev/null || true)"',
      30,
      signal,
    );
    if (result.code !== 0 || !result.stdout.includes('uid=' + space.uid + '\n'))
      throw new AppError('项目身份核验失败', 409);
    const wanted = space.environment;
    if (!result.stdout.includes('arch=' + wanted.architecture + '\n'))
      throw new AppError('客户机架构不匹配', 409);
    if (wanted.nodeVersion && !result.stdout.includes('node=' + wanted.nodeVersion + '\n'))
      throw new AppError('Node 运行时版本不匹配', 409);
    if (wanted.pythonVersion && !result.stdout.includes('python=Python ' + wanted.pythonVersion + '\n'))
      throw new AppError('Python 运行时版本不匹配', 409);
    return `image=${space.imageSha256}\n${result.stdout}`;
  }
  /** 只采集声明的普通文件，拒绝链接和超限产物。 Collects declared regular files with link and size guards. */
  async collect(
    space: DeliverySpace,
    scope: DeliveryScope,
    paths: string[],
    kind: 'output' | 'report',
    label: string,
    signal: AbortSignal,
  ) {
    const files: DeliveryFile[] = [];
    let total = 0;
    await this.machines.sftp(
      space.vmId,
      async (ftp) => {
        const visit = async (path: string, depth = 0): Promise<void> => {
          this.check(space, signal);
          deliveryPathSchema.parse(path);
          if (depth > 32 || files.length >= 10000) throw new AppError('产物目录超过边界', 413);
          const full = '/workspace/delivery/' + path;
          // lstat every ancestor, including explicitly selected nested files.
          let parent = '/workspace/delivery';
          for (const part of path.split('/').slice(0, -1)) {
            parent += '/' + part;
            const st = await ftpStat(ftp, parent);
            if (!st?.isDirectory()) throw new AppError('产物上级不是普通目录', 409);
          }
          const info = await ftpStat(ftp, full);
          if (!info) throw new AppError('缺少要求的产物：' + path, 409);
          if (info.isDirectory()) {
            const entries = await new Promise<import('ssh2').FileEntry[]>((resolve, reject) =>
              ftp.readdir(full, (error, entries) => (error ? reject(error) : resolve(entries))),
            );
            for (const entry of entries) await visit(path + '/' + entry.filename, depth + 1);
            return;
          }
          if (!info.isFile() || info.size > 1024 ** 3 || (total += info.size) > 2 * 1024 ** 3)
            throw new AppError('产物包含链接、特殊文件或超限文件', 409);
          if (files.some((file) => file.path.toLowerCase() === path.toLowerCase()))
            throw new AppError('产物路径重叠或大小写冲突', 409);
          const proof = await this.command(
            space,
            'test "$(stat -c %h -- ' + quote(full) + ')" = 1 && sha256sum -- ' + quote(full),
            60,
            signal,
          );
          const sha256 = proof.stdout.slice(0, 64);
          if (proof.code !== 0 || !/^[a-f0-9]{64}$/.test(sha256))
            throw new AppError('产物硬链接或摘要核对失败', 409);
          const upload = await this.artifacts.begin(scope, { sha256, bytes: info.size });
          const handle = await new Promise<Buffer>((resolve, reject) =>
            ftp.open(full, 'r', (error, value) => (error ? reject(error) : resolve(value))),
          );
          try {
            let offset = 0;
            while (offset < info.size) {
              this.check(space, signal);
              const buffer = Buffer.alloc(Math.min(512 * 1024, info.size - offset));
              const length = await new Promise<number>((resolve, reject) =>
                ftp.read(handle, buffer, 0, buffer.length, offset, (error, read) =>
                  error ? reject(error) : resolve(read),
                ),
              );
              if (!length) throw new AppError('产物读取中发生变化', 409);
              await this.artifacts.chunk(
                scope,
                upload.id,
                offset,
                buffer.subarray(0, length).toString('base64'),
              );
              offset += length;
            }
          } finally {
            await new Promise<void>((resolve, reject) =>
              ftp.close(handle, (error) => (error ? reject(error) : resolve())),
            );
          }
          files.push({ path, ...(await this.artifacts.complete(scope, upload.id)), mode: info.mode & 0o777 });
        };
        for (const path of paths) await visit(path);
      },
      signal,
    );
    return this.artifacts.seal(scope, { label, kind, files });
  }
  /** 只回收原 VM；目录或进程清理未确认时拒绝成功。 Cleans only the original VM and fails if removal is unverified. */
  async destroy(vmId: string, createdAt: string) {
    if (!this.machines.records.has(vmId)) {
      if (this.machines.live.has(vmId))
        throw new AppError('实例目录缺失但原宿主进程尚未释放', 503, 'EXECUTION_CLEANUP_PENDING');
      return;
    }
    if (this.machines.get(vmId).createdAt !== createdAt || !this.machines.get(vmId).sandbox)
      throw new AppError('原交付实例身份不匹配，拒绝清理替代资源', 409);
    await this.machines.terminateSandbox(vmId);
    if (this.machines.records.has(vmId)) {
      if (this.machines.get(vmId).createdAt !== createdAt || this.machines.live.has(vmId))
        throw new AppError('原交付实例释放未确认', 503);
      await this.machines.delete(vmId);
    }
    if (this.machines.records.has(vmId) || this.machines.live.has(vmId))
      throw new AppError('原交付实例回收未确认', 503);
  }
}
