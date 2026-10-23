/** Notebook V2 只操作登记的分析实例，不改变活动项目。 Explicit notebook targets without active-project switching. */
import type { NotebookEnvironmentsV1 } from './service-contracts/v1.ts';
type ScopedNotebooks = {
  run: (
    id: string,
    input: unknown,
    signal: AbortSignal,
    log: (line: string) => void,
    projectId?: string,
    offline?: boolean,
  ) => ReturnType<NotebookEnvironmentsV1['run']>;
  link: (id: string, projectId?: string) => ReturnType<NotebookEnvironmentsV1['link']>;
};
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type {
  NotebookEnvironmentsV2,
  DataNotebookTarget,
} from './service-contracts/data-notebook-sessions.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import { quote } from './shell.ts';
import { AppError } from '../shared/errors.ts';
export class DataNotebookSessions implements NotebookEnvironmentsV2 {
  constructor(
    private notebooks: () => NotebookEnvironmentsV1,
    private machines: VmAccess,
    private workspaces: WorkspacesV1,
    private images: ImageAssetsV1,
  ) {}
  private async check(target: DataNotebookTarget) {
    if (target.projectId !== 'default' || target.receipt.owner !== 'data-notebooks:' + target.sessionId)
      throw new AppError('Notebook 归属不符', 403);
    const own = (await this.images.owned(target.receipt.owner)).find((r) => r.token === target.receipt.token);
    if (
      !own ||
      own.vmId !== target.receipt.vmId ||
      own.createdAt !== target.receipt.createdAt ||
      own.cleanup === 'confirmed' ||
      this.machines.get(own.vmId).createdAt !== own.createdAt
    )
      throw new AppError('Notebook 原分析实例身份已变化', 409, 'DATA_NOTEBOOK_IDENTITY');
    return own;
  }
  async start(target: DataNotebookTarget, signal = new AbortController().signal) {
    const own = await this.check(target);
    await this.workspaces.projects.inScope(own.vmId, target.projectId, async () => {
      const project = await this.workspaces.config(own.vmId);
      if (project.directory !== '/workspace/data-lab') throw new AppError('Notebook 分析目录不符', 409);
      const identity = await new ProjectRunScopes(this.machines).identity(own.vmId, project, signal);
      const marker = {
        version: 1,
        provider: 'jupyter',
        registryId: identity.registryId,
        identityId: identity.identityId,
        revision: identity.revision,
        uid: identity.uid,
        gid: identity.gid,
        directoryDevice: identity.directoryDevice,
        directoryInode: identity.directoryInode,
      };
      const command =
        'set -eu\ntest -x /opt/sakura-data/bin/jupyter\nmkdir -p .sakura/notebooks/jupyter\nif test ! -d .sakura/notebooks/jupyter/venv; then cp -a /opt/sakura-data .sakura/notebooks/jupyter/venv; fi\nprintf %s ' +
        quote(JSON.stringify(marker)) +
        ' > .sakura/notebooks/jupyter/identity.json';
      const result = await projectIdentityTask(
        this.machines,
        own.vmId,
        project,
        { command, environment: {} },
        signal,
        undefined,
        120000,
      );
      if (result.code !== 0)
        throw new AppError('离线 Notebook 环境未准备，不自动联网安装', 409, 'DATA_NOTEBOOK_NOT_READY');
    });
    await this.check(target);
    const result = await (this.notebooks() as ScopedNotebooks).run(
      own.vmId,
      { mode: 'start', provider: 'jupyter', hostPort: target.hostPort, guestPort: target.guestPort },
      signal,
      () => {},
      target.projectId,
      true,
    );
    if (!result.ready) throw new AppError('Notebook 未就绪', 409);
    return { ready: true, sessionId: target.sessionId };
  }
  async stop(target: DataNotebookTarget, signal = new AbortController().signal): Promise<{ stopped: true }> {
    await this.check(target);
    await (this.notebooks() as ScopedNotebooks).run(
      target.receipt.vmId,
      { mode: 'stop', provider: 'jupyter', hostPort: target.hostPort, guestPort: target.guestPort },
      signal,
      () => {},
      target.projectId,
      true,
    );
    return { stopped: true };
  }
  async link(target: DataNotebookTarget) {
    await this.check(target);
    const result = await (this.notebooks() as ScopedNotebooks).link(target.receipt.vmId, target.projectId);
    return { url: result.url, sessionId: target.sessionId };
  }
}
