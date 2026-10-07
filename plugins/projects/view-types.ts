/**
 * 模块职责：“项目工作区”插件的界面视图类型（ProjectView、Project、ProjectList、ProjectRuntime、DirectoryMigrationView），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type ProjectView = OperationResponse<'projects.legacy.get.vms.vmId.project'>;
export type Project = ProjectView['project'];
export type ProjectList = OperationResponse<'projects.legacy.get.vms.vmId.projects'>;
export type ProjectRuntime = OperationResponse<'projects.legacy.get.vms.vmId.project-runtime'>;
export type DirectoryMigrationView = OperationResponse<'projects.legacy.get.vms.vmId.project-directory-migration'>;
