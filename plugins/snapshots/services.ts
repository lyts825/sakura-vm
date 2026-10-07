/**
 * 模块职责（中文）：“磁盘快照”插件的有类型服务引用（bundles、signedBundles、goldenImages、rescue、snapshotDiff、snapshotMerge），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 * Module responsibility (English): binding service names to public contracts for broker checks in snapshots, clones, rescue, golden images and signed bundles.
 * 详细范围（中文）：公开入口包括 services；职责覆盖将快照、克隆、救援、黄金镜像和签名包的服务名称绑定到公共契约，供宿主代理检查，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include services. The scope covers binding service names to public contracts for broker checks in snapshots, clones, rescue, golden images and signed bundles. Types, validation branches and cleanup paths define its data/behavior boundaries
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
