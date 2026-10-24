/** V2 增加固定捕获，不改变 FilesV1。 Fixed project captures independent of FilesV1. */
import type {
  ProjectCaptureRequest,
  ProjectCapturePlan,
  ProjectCaptureReceipt,
} from '../../shared/contracts/files-capture.ts';
export interface FilesV2 {
  planCapture(request: ProjectCaptureRequest, signal?: AbortSignal): Promise<ProjectCapturePlan>;
  capture(input: { planToken: string }, signal?: AbortSignal): Promise<ProjectCaptureReceipt>;
  readCaptured(
    token: string,
    path: string,
    offset: number,
    length: number,
  ): Promise<{ data: string; offset: number; eof: boolean }>;
  releaseCapture(token: string): Promise<void>;
}
