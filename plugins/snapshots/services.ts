import { serviceRef } from '../../server/service-ref.ts';
import type { Bundles } from '../../server/bundles.ts';
import type { SignedBundles } from '../../server/signed-bundles.ts';
import type { GoldenImages } from '../../server/golden-images.ts';
import type { Rescue } from '../../server/rescue.ts';
import type { SnapshotDiff } from '../../server/snapshot-diff.ts';
import type { SnapshotMerge } from '../../server/snapshot-merge.ts';

export const services = {
  bundles: serviceRef<Bundles>('snapshots', 'bundles'),
  signedBundles: serviceRef<SignedBundles>('snapshots', 'signedBundles'),
  goldenImages: serviceRef<GoldenImages>('snapshots', 'goldenImages'),
  rescue: serviceRef<Rescue>('snapshots', 'rescue'),
  snapshotDiff: serviceRef<SnapshotDiff>('snapshots', 'snapshotDiff'),
  snapshotMerge: serviceRef<SnapshotMerge>('snapshots', 'snapshotMerge'),
};
