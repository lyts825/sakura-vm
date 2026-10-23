/** 隔离数据运行、固定环境和准确资源核销。 Isolated data execution and identity-bound cleanup. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';

import type { OwnedImageVm } from '../shared/contracts/image-assets.ts';
import type { DataScope, DataTask, DataEnvironment } from '../shared/contracts/data-common.ts';
import { dataPutBytes } from './data-store.ts';
import { ProjectTaskExecutor, type TaskSpace } from './project-task-executor.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { projectSchema } from './project-config.ts';
import { AppError } from '../shared/errors.ts';
const workerPath = fileURLToPath(new URL('./data-worker.py', import.meta.url));
export class DataExecutor extends ProjectTaskExecutor {
  constructor(
    private machineAccess: VmAccess,
    private workspaceAccess: WorkspacesV1,
    private artifactAccess: DeliveryArtifactsV1,
    private dataImages: ImageAssetsV1,
  ) {
    super(machineAccess, workspaceAccess, artifactAccess);
  }
  async createSpace(
    environment: DataEnvironment,
    owner: string,
    signal: AbortSignal,
    record: (receipt: OwnedImageVm) => Promise<void>,
    network: 'isolated' | 'nat' = 'isolated',
  ) {
    const asset = await this.dataImages.verify({ assetId: environment.assetId, digest: environment.digest });
    signal.throwIfAborted();
    const receipt = await this.dataImages.createOwnedVm({
      imageRef: { assetId: asset.id, digest: asset.digest },
      owner,
      name: 'data-' + randomUUID().slice(0, 8),
      memoryMiB: environment.memoryMiB,
      cpus: environment.cpus,
      network,
      persistent: false,
      lifetimeMinutes: Math.ceil(environment.timeoutSeconds / 60) + 10,
    });
    await record(receipt);
    await this.machineAccess.start(receipt.vmId);
    const deadline = Date.now() + 240000;
    while (this.machineAccess.state(receipt.vmId) === 'starting' && Date.now() < deadline)
      await delay(100, undefined, { signal });
    if (this.machineAccess.state(receipt.vmId) !== 'running')
      throw new AppError('数据实例启动失败', 409, 'DATA_VM_START');
    const project = projectSchema.parse({ directory: '/workspace/data-lab', environment: {} });
    await this.workspaceAccess.save(receipt.vmId, project);
    const tools = await this.machineAccess.exec(
      receipt.vmId,
      'for tool in python3 cc ip openssl useradd groupadd nft; do command -v "$tool" >/dev/null || exit 1; done',
      15000,
      signal,
    );
    if (tools.code !== 0 && network === 'isolated')
      throw new AppError('镜像缺少项目隔离工具，请先显式准备数据环境', 409, 'DATA_ENVIRONMENT_NOT_READY');
    const made = await this.machineAccess.exec(
      receipt.vmId,
      'set -eu\nmkdir -p /workspace\nchmod 755 /workspace\ntest ! -e /workspace/data-lab\nmkdir -m 700 /workspace/data-lab',
      30000,
      signal,
    );
    if (made.code !== 0) throw new AppError('数据目录已存在或创建失败', 409);
    const identity = await new ProjectRunScopes(this.machineAccess).reserve(receipt.vmId, project, signal);
    const changed = await this.machineAccess.exec(
      receipt.vmId,
      `chown ${identity.uid}:${identity.gid} /workspace/data-lab`,
      30000,
      signal,
    );
    if (changed.code !== 0) throw new AppError('数据账号目录准备失败', 409);
    const space: TaskSpace = {
      vmId: receipt.vmId,
      createdAt: receipt.createdAt,
      project,
      imageSha256: asset.digest,
      environment: { distro: asset.distro, architecture: asset.architecture, network, publicEnvironment: {} },
      live: this.machineAccess.live.get(receipt.vmId)!,
      uid: identity.uid,
      gid: identity.gid,
    };
    return { space, receipt };
  }
  async stageTask(scope: DataScope, space: TaskSpace, task: DataTask, runId: string, signal: AbortSignal) {
    const inputs: DataTask['inputs'] = [];
    let total = 0;
    for (let i = 0; i < task.inputs.length; i++) {
      const item = task.inputs[i],
        manifest = await this.artifactAccess.get(scope, item.manifest.id);
      if (manifest.digest !== item.manifest.digest) throw new AppError('输入清单已变化', 409);
      const files = item.files.map((path) => {
        const file = manifest.files.find((f) => f.path === path);
        if (!file) throw new AppError('输入分区缺失', 409);
        total += file.bytes;
        return { ...file, path: `inputs/${i}/${path}`, mode: 0o400 };
      });
      if (total > 1024 ** 3) throw new AppError('数据输入超过 1 GiB', 413);
      await this.artifactAccess.retain(scope, manifest.id, 'data:run:' + runId);
      const staged = await this.artifactAccess.seal(scope, { kind: 'source', label: '数据运行输入', files });
      await this.artifactAccess.retain(scope, staged.id, 'data:run:' + runId);
      await this.stage(space, scope, staged, signal);
      inputs.push({ ...item, manifest: staged, files: files.map((f) => f.path) });
    }
    const request = await dataPutBytes(
      this.artifactAccess,
      scope,
      'request.json',
      Buffer.from(JSON.stringify({ ...task, inputs })),
      'source',
    );
    await this.artifactAccess.retain(scope, request.id, 'data:run:' + runId);
    await this.stage(space, scope, request, signal);
    const worker = await dataPutBytes(
      this.artifactAccess,
      scope,
      'worker.py',
      await readFile(workerPath),
      'source',
    );
    await this.artifactAccess.retain(scope, worker.id, 'data:run:' + runId);
    await this.stage(space, scope, worker, signal);
    if (task.inputs.length) {
      const protectedInputs = await this.machineAccess.exec(
        space.vmId,
        'set -eu\nmount --bind /workspace/data-lab/inputs /workspace/data-lab/inputs\nmount -o remount,bind,ro,nosuid,nodev /workspace/data-lab/inputs',
        30000,
        signal,
      );
      if (protectedInputs.code !== 0)
        throw new AppError('数据输入只读挂载未确认', 409, 'DATA_INPUT_READONLY');
    }
  }
}
