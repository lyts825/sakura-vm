import type {
  ImageAsset,
  ImageRef,
  ImageCreate,
  ImageUpload,
  ImageLease,
  OwnedImageVm,
} from '../../shared/contracts/image-assets.ts';
/** 宿主拥有账本；插件停用不释放活动 VM 与持久引用。 */
export interface ImageAssetsV1 {
  list(): Promise<ImageAsset[]>;
  inspect(ref: ImageRef): Promise<ImageAsset>;
  verify(ref: ImageRef): Promise<ImageAsset>;
  prepareBuiltin(distro: ImageAsset['distro'], architecture: ImageAsset['architecture']): Promise<ImageAsset>;
  begin(
    input: Pick<ImageUpload, 'digest' | 'bytes' | 'distro' | 'architecture' | 'source'>,
  ): Promise<ImageUpload>;
  uploads(): Promise<ImageUpload[]>;
  discardUpload(id: string): Promise<void>;
  append(id: string, offset: number, data: string): Promise<ImageUpload>;
  finish(id: string): Promise<ImageAsset>;
  read(
    ref: ImageRef,
    token: string,
    offset: number,
    length: number,
  ): Promise<{ data: string; offset: number; eof: boolean }>;
  retain(ref: ImageRef, owner: string): Promise<void>;
  references(ref: ImageRef): Promise<string[]>;
  release(ref: ImageRef, owner: string): Promise<void>;
  acquire(ref: ImageRef, owner: string): Promise<ImageLease>;
  closeLease(token: string): Promise<void>;
  createOwnedVm(input: ImageCreate): Promise<OwnedImageVm>;
  owned(owner: string): Promise<OwnedImageVm[]>;
  destroyOwnedVm(receipt: OwnedImageVm): Promise<OwnedImageVm>;
  captureVm(vmId: string, createdAt: string): Promise<ImageAsset>;
  cleanupPlan(): Promise<{ token: string; assets: string[]; protected: string[] }>;
  cleanup(token: string): Promise<{ removed: number }>;
}
