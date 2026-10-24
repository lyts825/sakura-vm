/** 组合根账本与独立字节提供者；转发保留原服务句柄的消费者身份和权限检查。 */
import type { SuiteByteMaterialsV1, SuiteMaterialsV1, SuiteWorkspacePortV1 } from '../shared/contracts/suite-common.ts';

const workspaceMethods = {
  hostCapacity: true,
  quarantines: true,
  withQuarantine: true,
  retireQuarantine: true,
  createWorkspace: true,
  listWorkspaces: true,
  workspace: true,
  revokeWorkspace: true,
  reserve: true,
  settle: true,
  reconcileMetadata: true,
  capacity: true,
  acceptWorkspace: true,
} as const satisfies Record<keyof SuiteWorkspacePortV1, true>;

const materialMethods = {
  publications: true,
  previewPublicationRecovery: true,
  recoverPublication: true,
  list: true,
  get: true,
  save: true,
  seal: true,
  archive: true,
  retain: true,
  references: true,
  previewCleanup: true,
  cleanup: true,
  inspectPlan: true,
  previewRecovery: true,
  importRecord: true,
  policy: true,
  beginUpload: true,
  appendUpload: true,
  finishUpload: true,
  uploads: true,
  discardUpload: true,
  openRead: true,
  readLease: true,
  closeRead: true,
  readSource: true,
  planPolicy: true,
  applyPolicy: true,
} as const satisfies Record<keyof SuiteByteMaterialsV1, true>;

export function suiteMaterialsPort(
  workspace: SuiteWorkspacePortV1,
  materials: SuiteByteMaterialsV1,
): SuiteMaterialsV1 {
  const result: Record<string, unknown> = Object.create(null);
  const bind = <T extends object>(provider: T, methods: Readonly<Record<keyof T, true>>) => {
    for (const key of Object.keys(methods) as (keyof T)[]) {
      const method = provider[key];
      if (typeof method !== 'function') throw new Error('缺少原材料服务方法：' + String(key));
      result[String(key)] = method.bind(provider);
    }
  };
  bind(workspace, workspaceMethods);
  bind(materials, materialMethods);
  return Object.freeze(result) as unknown as SuiteMaterialsV1;
}
