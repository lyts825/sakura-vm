import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Bundles } from '../../server/bundles.ts';
import type { SignedBundles } from '../../server/signed-bundles.ts';
import type { GoldenImages } from '../../server/golden-images.ts';
import type { Rescue } from '../../server/rescue.ts';
import type { SnapshotDiff } from '../../server/snapshot-diff.ts';
import type { SnapshotMerge } from '../../server/snapshot-merge.ts';

export const services = {
  bundles: serviceRef<ServiceInterface<Bundles>>('snapshots', 'bundles'),
  signedBundles: serviceRef<ServiceInterface<SignedBundles>>('snapshots', 'signedBundles'),
  goldenImages: serviceRef<ServiceInterface<GoldenImages>>('snapshots', 'goldenImages'),
  rescue: serviceRef<ServiceInterface<Rescue>>('snapshots', 'rescue'),
  snapshotDiff: serviceRef<ServiceInterface<SnapshotDiff>>('snapshots', 'snapshotDiff'),
  snapshotMerge: serviceRef<ServiceInterface<SnapshotMerge>>('snapshots', 'snapshotMerge'),
};
