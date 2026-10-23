/** 公开的交付存储服务。Public delivery storage services. */
import type { DeliveryScope, DeliveryFile, DeliveryManifest, DeliveryDefinition } from '../../shared/contracts/delivery-common.ts';
import type { DeliveryCleanupPlan, DeliveryInputPlan, DeliveryInputSnapshot, DeliveryUpload } from '../../shared/contracts/delivery-storage.ts';

export interface DeliveryArtifactsV1 {
  /** 读取 scope 内的清单；不依赖源实例运行。List manifests in scope independently of source VM liveness. */
  list(scope: DeliveryScope): Promise<DeliveryManifest[]>;
  /** 按 scope 和 ID 读取清单。Read the manifest by scope and ID. */
  get(scope: DeliveryScope, manifestId: string): Promise<DeliveryManifest>;
  /** 为已知摘要和长度创建上传记录。Create an upload record for a known digest and byte length. */
  begin(scope: DeliveryScope, input: { sha256: string; bytes: number }): Promise<DeliveryUpload>;
  /** 在准确 offset 写入 Base64 分块，返回下一偏移。Write a Base64 chunk at the exact offset and return the next offset. */
  chunk(scope: DeliveryScope, uploadId: string, offset: number, data: string): Promise<{ offset: number }>;
  /** 完成全部内容核验并返回不可变 blob 身份。Finish full-content verification and return the immutable blob identity. */
  complete(scope: DeliveryScope, uploadId: string): Promise<{ blobId: string; sha256: string; bytes: number }>;
  /** 读取有界分块；整次下载由 openRead/closeRead 保持清单存活。Read a bounded chunk; openRead/closeRead retain the manifest across the complete download. */
  read(scope: DeliveryScope, blobId: string, offset: number, length: number): Promise<{ data: string; offset: number; eof: boolean; sha256: string }>;
  /** 建立有绝对截止时间的下载保护，调用方须在 finally 关闭。Create download protection with an absolute deadline; callers close it in finally. */
  openRead(scope: DeliveryScope, manifestId: string): Promise<{ token: string; expiresAt: string }>;
  /** 释放本项目的下载保护；重复关闭可安全返回。Release this project's download protection; repeated closure may safely return. */
  closeRead(scope: DeliveryScope, token: string): Promise<{ closed: true }>;
  /** 将完整文件清单封存为不可变摘要。Seal a complete file list under an immutable digest. */
  seal(scope: DeliveryScope, input: { label: string; kind: DeliveryManifest['kind']; files: DeliveryFile[] }): Promise<DeliveryManifest>;
  /** 添加持久业务引用，供调用域承担释放责任。Add a persistent business reference whose release belongs to the calling domain. */
  retain(scope: DeliveryScope, manifestId: string, reference: string): Promise<void>;
  /** 返回业务引用，不将临时下载租约当作接收审批。Return business references without treating temporary download leases as import acceptance. */
  references(scope: DeliveryScope, manifestId: string): Promise<string[]>;
  /** 仅释放指定业务引用，不直接删除内容。Release only the specified business reference without deleting content directly. */
  release(scope: DeliveryScope, manifestId: string, reference: string): Promise<void>;
  /** 复核清单的完整内容，返回已核验摘要。Verify complete manifest content and return its verified digest. */
  verify(scope: DeliveryScope, manifestId: string): Promise<{ verified: true; digest: string }>;
  /** 生成含保护项及未完成状态的一次性清理预览。Prepare a single-use cleanup preview including protected and incomplete records. */
  cleanupPlan(scope: DeliveryScope): Promise<DeliveryCleanupPlan>;
  /** 消费当前修订的计划；未确认的物理清理须保留记录。Consume a plan for the current revision; unconfirmed physical cleanup retains its record. */
  cleanup(scope: DeliveryScope, token: string): Promise<{ manifests: number; blobs: number; bytes: number }>;
}
export interface DeliveryInputsV1 {
  /** 读取项目的持久输入快照。List persistent input snapshots for the project. */
  list(scope: DeliveryScope): Promise<DeliveryInputSnapshot[]>;
  /** 读取项目内指定输入；不要求源实例仍运行。Read the selected project input without requiring a live source VM. */
  get(scope: DeliveryScope, id: string): Promise<DeliveryInputSnapshot>;
  /** 在源项目生成完整文件及环境预览，支持取消。Preview all selected source files and the environment in the source project, with cancellation. */
  preview(scope: DeliveryScope, input: { definition: DeliveryDefinition; reviewedDraft?: boolean }, signal?: AbortSignal): Promise<DeliveryInputPlan>;
  /** 消费预览令牌，复核后封存源码与定义，支持取消。Consume a preview token and recheck before sealing source and definition, with cancellation. */
  capture(scope: DeliveryScope, input: { token: string }, signal?: AbortSignal): Promise<DeliveryInputSnapshot>;
  /** 比较两个输入的文件摘要、权限与定义。Compare file digests, modes and definitions between two inputs. */
  compare(scope: DeliveryScope, leftId: string, rightId: string): Promise<{ added: string[]; removed: string[]; changed: string[]; definitionChanged: boolean }>;
}
