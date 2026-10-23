/** 显式归属的 Notebook V2 契约。 Ownership-bound Notebook V2 contract. */
import type { OwnedImageVm } from '../../shared/contracts/image-assets.ts';
export type DataNotebookTarget = {
  receipt: OwnedImageVm;
  projectId: string;
  sessionId: string;
  hostPort: number;
  guestPort: number;
};
export interface NotebookEnvironmentsV2 {
  start(target: DataNotebookTarget, signal?: AbortSignal): Promise<{ ready: boolean; sessionId: string }>;
  stop(target: DataNotebookTarget, signal?: AbortSignal): Promise<{ stopped: true }>;
  link(target: DataNotebookTarget): Promise<{ url: string; sessionId: string }>;
}
