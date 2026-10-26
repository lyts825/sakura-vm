/** 每个计算接口只绑定一个包；不开放packId参数。 */
import type {SeventhComputePortV1} from "../../shared/contracts/seventh-common.ts";
export interface BatchQualityComputeV1 extends SeventhComputePortV1 {}
export interface LineageGraphComputeV1 extends SeventhComputePortV1 {}
export interface EntityMatchingComputeV1 extends SeventhComputePortV1 {}
export interface TemporalSeriesComputeV1 extends SeventhComputePortV1 {}
export interface VectorGeometryComputeV1 extends SeventhComputePortV1 {}
export interface RelationGraphComputeV1 extends SeventhComputePortV1 {}
export interface ControlledExperimentComputeV1 extends SeventhComputePortV1 {}
export interface FeatureTransformComputeV1 extends SeventhComputePortV1 {}
export interface ClassicalTrainingSessionsV1 extends SeventhComputePortV1 {}
export interface ConstraintSolveSessionsV1 extends SeventhComputePortV1 {}
export interface DocumentExtractionSessionsV1 extends SeventhComputePortV1 {}
export interface DesignSystemCompileV1 extends SeventhComputePortV1 {}
export interface FormDefinitionEvaluateV1 extends SeventhComputePortV1 {}
export interface NotificationRenderComputeV1 extends SeventhComputePortV1 {}
export interface ScheduleModelComputeV1 extends SeventhComputePortV1 {}
export interface ExtensionTrialRuntimeV1 extends SeventhComputePortV1 {}
export interface DependencyConstraintComputeV1 extends SeventhComputePortV1 {}
export interface ReplicaModelComputeV1 extends SeventhComputePortV1 {}
