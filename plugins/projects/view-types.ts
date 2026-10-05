import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type ProjectView = OperationResponse<'projects.legacy.get.vms.vmId.project'>;
export type Project = ProjectView['project'];
export type ProjectList = OperationResponse<'projects.legacy.get.vms.vmId.projects'>;
export type ProjectRuntime = OperationResponse<'projects.legacy.get.vms.vmId.project-runtime'>;
export type DirectoryMigrationView = OperationResponse<'projects.legacy.get.vms.vmId.project-directory-migration'>;
