/** 两个原提供者分别拥有只读采集；目标暂限正在运行的 VM 及默认项目。 */
import type {
  IncidentSnapshotTarget,
  IncidentSnapshotBinding,
  IncidentSnapshot,
} from '../../shared/contracts/incident-snapshots.ts';
export interface IncidentSnapshotProvider {
  readSnapshot(target: IncidentSnapshotTarget): Promise<IncidentSnapshot>;
  verifySnapshot(binding: IncidentSnapshotBinding): Promise<{ confirmed: true }>;
}
export interface MetricsSnapshotsV1 extends IncidentSnapshotProvider {}
export interface HealthSnapshotsV1 extends IncidentSnapshotProvider {}
