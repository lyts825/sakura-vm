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
