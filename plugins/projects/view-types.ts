/**
 * 模块职责（中文）：“项目工作区”插件的界面视图类型（ProjectView、Project、ProjectList、ProjectRuntime、DirectoryMigrationView），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for project configuration, identities and running services from published operation responses.
 * 详细范围（中文）：公开入口包括 ProjectView, Project, ProjectList, ProjectRuntime, DirectoryMigrationView；职责覆盖从已公开操作响应派生项目配置、账号与运行服务的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ProjectView, Project, ProjectList, ProjectRuntime, DirectoryMigrationView. The scope covers deriving UI data views for project configuration, identities and running services from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type ProjectView = OperationResponse<'projects.legacy.get.vms.vmId.project'>;
export type Project = ProjectView['project'];
export type ProjectList = OperationResponse<'projects.legacy.get.vms.vmId.projects'>;
export type ProjectRuntime = OperationResponse<'projects.legacy.get.vms.vmId.project-runtime'>;
export type DirectoryMigrationView = OperationResponse<'projects.legacy.get.vms.vmId.project-directory-migration'>;
