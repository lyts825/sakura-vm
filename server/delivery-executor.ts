/** 保持交付执行入口兼容，复用固定身份、分块传输与原实例清理。
 * Preserve the delivery entry point over the shared owned-project executor. */
export { ProjectTaskExecutor as DeliveryExecutor } from './project-task-executor.ts';
export type { TaskSpace as DeliverySpace } from './project-task-executor.ts';
