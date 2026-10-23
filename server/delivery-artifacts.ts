/** 交付制品库兼容入口，存储实现由各领域按自己的元数据与权限实例化。
 * Compatibility exports for the shared, separately scoped artifact store. */
export { ArtifactStore as DeliveryArtifacts, artifactHash as deliveryHash, artifactPaths as deliveryPaths } from './artifact-store.ts';
