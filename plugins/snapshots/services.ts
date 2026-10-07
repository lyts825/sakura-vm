/**
 * 模块职责：“磁盘快照”插件的有类型服务引用（bundles、signedBundles、goldenImages、rescue、snapshotDiff、snapshotMerge），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  bundles: serviceRef('snapshots', 'bundles', serviceContracts.Bundles),
  signedBundles: serviceRef('snapshots', 'signedBundles', serviceContracts.SignedBundles),
  goldenImages: serviceRef('snapshots', 'goldenImages', serviceContracts.GoldenImages),
  rescue: serviceRef('snapshots', 'rescue', serviceContracts.Rescue),
  snapshotDiff: serviceRef('snapshots', 'snapshotDiff', serviceContracts.SnapshotDiff),
  snapshotMerge: serviceRef('snapshots', 'snapshotMerge', serviceContracts.SnapshotMerge),
};
