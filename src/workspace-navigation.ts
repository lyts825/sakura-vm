import type { VMStatus, VMView } from '../server/model';

export type WorkspaceTarget = { id?: string; page?: string; tab?: string };

export type WorkspaceCommandAction =
  'create' | 'start' | 'stop' | 'suspend' | 'resume' | 'delete' | 'navigate';

export type WorkspaceCommandDefinition = {
  key: string;
  title: string;
  detail: string;
  keywords: string[];
  action: WorkspaceCommandAction;
  target?: WorkspaceTarget;
  disabled?: boolean;
};

const statusLabel: Record<VMStatus, string> = {
  running: '运行中',
  paused: '已暂停',
  stopped: '已停止',
  starting: '启动中',
  stopping: '停止中',
  error: '需要检查',
};

const isBusy = (status: VMStatus) => status === 'starting' || status === 'stopping';

/**
 * Build the commands that are specific to the local Linux workspaces.
 *
 * The definitions contain no callbacks. The app supplies the callbacks so the
 * same list can be rendered and exercised without coupling this navigation
 * model to React or the network layer.
 */
export function workspaceCommandDefinitions({
  vms,
  currentId,
  canCreate = true,
  busy = false,
}: {
  vms: Pick<VMView, 'id' | 'name' | 'status'>[];
  currentId?: string;
  canCreate?: boolean;
  busy?: boolean;
}): WorkspaceCommandDefinition[] {
  const current = vms.find((item) => item.id === currentId);
  const commands: WorkspaceCommandDefinition[] = [
    {
      key: 'workspace:create',
      title: '创建新的 Linux 空间',
      detail: canCreate ? '工作空间 · 新建' : '工作空间 · 请先准备镜像',
      keywords: ['创建', '新建', '添加', 'create', 'new', 'workspace', 'linux'],
      action: 'create',
      disabled: !canCreate || busy,
    },
    {
      key: 'workspace:manage',
      title: '管理工作空间',
      detail: '实例管理 · 分组、标签与批量操作',
      keywords: ['管理', '实例', '分组', '标签', 'library', 'manage'],
      action: 'navigate',
      target: { page: 'library' },
    },
  ];

  if (current) {
    const identity = `${current.name} · ${statusLabel[current.status]}`;
    const currentBusy = busy || isBusy(current.status);
    if (current.status === 'stopped' || current.status === 'error') {
      commands.push({
        key: `workspace:${current.id}:start`,
        title: `启动 ${current.name}`,
        detail: identity,
        keywords: ['启动', '开始', 'start', current.name],
        action: 'start',
        target: { id: current.id },
        disabled: currentBusy,
      });
    }
    if (current.status === 'running') {
      commands.push(
        {
          key: `workspace:${current.id}:suspend`,
          title: `暂停 ${current.name}`,
          detail: identity,
          keywords: ['暂停', '挂起', 'suspend', 'pause', current.name],
          action: 'suspend',
          target: { id: current.id },
          disabled: currentBusy,
        },
        {
          key: `workspace:${current.id}:stop`,
          title: `停止 ${current.name}`,
          detail: identity,
          keywords: ['停止', '关闭', 'stop', current.name],
          action: 'stop',
          target: { id: current.id },
          disabled: currentBusy,
        },
      );
    }
    if (current.status === 'paused') {
      commands.push({
        key: `workspace:${current.id}:resume`,
        title: `恢复 ${current.name}`,
        detail: identity,
        keywords: ['恢复', '继续', 'resume', current.name],
        action: 'resume',
        target: { id: current.id },
        disabled: currentBusy,
      });
    }
    commands.push(
      {
        key: `workspace:${current.id}:config`,
        title: `配置 ${current.name}`,
        detail: '当前工作空间 · 资源与端口',
        keywords: ['配置', '设置', '资源', '端口', 'config', 'settings', current.name],
        action: 'navigate',
        target: { id: current.id, page: 'workspace', tab: 'config' },
      },
      {
        key: `workspace:${current.id}:delete`,
        title: `删除 ${current.name}`,
        detail: '当前工作空间 · 需要确认',
        keywords: ['删除', '移除', 'delete', 'remove', current.name],
        action: 'delete',
        target: { id: current.id },
        disabled: !['stopped', 'error'].includes(current.status) || currentBusy,
      },
    );
  }

  commands.push(
    ...vms.map((item) => ({
      key: `workspace:${item.id}:switch`,
      title: `切换到 ${item.name}`,
      detail: `${item.id === currentId ? '当前工作空间' : '工作空间'} · ${statusLabel[item.status]}`,
      keywords: ['切换', '打开', 'switch', 'open', item.name],
      action: 'navigate' as const,
      target: { id: item.id, page: 'workspace' },
    })),
  );
  return commands;
}
