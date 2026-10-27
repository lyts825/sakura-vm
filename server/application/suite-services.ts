/** 按已选插件注册计算、固定执行与演练提供者，在插件激活前完成依赖准备。
 * Register selected compute, fixed-execution and drill providers before plugin activation. */
import { SeventhComputePort } from '../seventh-compute.ts';
import { SeventhProtocolSessions, SeventhVirtualizationSessions } from '../seventh-combined-sessions.ts';
import { mediaExecutionProfile } from '../suite-media-profile.ts';
import { AppError } from '../../shared/errors.ts';
import { PreparedWorkerSessions } from '../prepared-worker-sessions.ts';
import { SuiteExecutionSessions } from '../suite-execution-sessions.ts';
import { legacySuiteExecutionSessions } from '../suite-execution-legacy.ts';
import { seventhScheduleExecutionProfile, seventhExtensionExecutionProfile, seventhProtocolExecutionProfile, seventhVirtualizationExecutionProfile } from '../seventh-engineering-profiles.ts';
import { browserExecutionProfile, databaseExecutionProfile, eventExecutionProfile, learningExecutionProfile } from '../suite-execution-profiles.ts';
import { suiteCapacity } from '../suite-capacity.ts';
import { EvaluationCalls } from '../evaluation-calls.ts';
import { MetadataStore } from '../metadata-store.ts';
import { DelegatedActions } from '../delegated-actions.ts';
import { preparedWorkerMetadata } from '../core-worker-metadata.ts';
import { createCoreDrillService } from '../core-drill-service.ts';
import { DATA } from '../paths.ts';
import { join } from 'node:path';
import { ClosePhase } from '../resource-scope.ts';
import type { SystemServices } from '../system-services.ts';

/** 按原顺序注册服务，依赖与清理由 SystemServices 持有；失败向启动入口传播。
 * Register services in their original order; SystemServices owns dependencies and cleanup, and startup failures propagate. */
export async function startSuiteServices(system: SystemServices, selectedPlugins: readonly string[]) {
  if (selectedPlugins.includes('incident-actions') || selectedPlugins.includes('flow-connectors')) {
    await system.start({
      id: 'delegatedActions', startup: 'required', requires: ['@delegatedProviders'],
      create: dependencies => new DelegatedActions(dependencies.get('@delegatedProviders')),
      initialize: () => {}, dispose: () => {}, disposePhase: ClosePhase.services,
    });
  }
// seventh-kernel-factories
  if(selectedPlugins.some(id=>id.startsWith('qualitydesk-')))await system.start({id:'batchQualityCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('data-quality-studio','core:batchQualityCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('lineageatlas-')))await system.start({id:'lineageGraphCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('lineage-atlas','core:lineageGraphCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('entitydesk-')))await system.start({id:'entityMatchingCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('entity-resolution-studio','core:entityMatchingCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('temporaldesk-')))await system.start({id:'temporalSeriesCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('temporal-data-studio','core:temporalSeriesCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('geodesk-')))await system.start({id:'vectorGeometryCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('geospatial-studio','core:vectorGeometryCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('graphdesk-')))await system.start({id:'relationGraphCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('graph-insight-studio','core:relationGraphCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('trialplan-')))await system.start({id:'controlledExperimentCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('experiment-planner','core:controlledExperimentCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('feat-')))await system.start({id:'featureTransformCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('feature-engineering-studio','core:featureTransformCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('ctrain-')))await system.start({id:'classicalTrainingSessions',startup:'required',requires:[],create:()=>new SeventhComputePort('classical-training-lab','core:classicalTrainingSessions'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('csolve-')))await system.start({id:'constraintSolveSessions',startup:'required',requires:[],create:()=>new SeventhComputePort('constraint-solver-studio','core:constraintSolveSessions'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('dextract-')))await system.start({id:'documentExtractionSessions',startup:'required',requires:[],create:()=>new SeventhComputePort('document-extraction-studio','core:documentExtractionSessions'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('dsys-')))await system.start({id:'designSystemCompile',startup:'required',requires:[],create:()=>new SeventhComputePort('design-system-studio','core:designSystemCompile'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('fform-')))await system.start({id:'formDefinitionEvaluate',startup:'required',requires:[],create:()=>new SeventhComputePort('form-flow-studio','core:formDefinitionEvaluate'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('ntpl-')))await system.start({id:'notificationRenderCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('notification-template-studio','core:notificationRenderCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('schedlab-')))await system.start({id:'scheduleModelCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('schedule-semantics-lab','core:scheduleModelCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('extforge-')))await system.start({id:'extensionTrialRuntime',startup:'required',requires:[],create:()=>new SeventhComputePort('extension-authoring-studio','core:extensionTrialRuntime'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('depsolve-')))await system.start({id:'dependencyConstraintCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('dependency-resolution-studio','core:dependencyConstraintCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('replab-')))await system.start({id:'replicaModelCompute',startup:'required',requires:[],create:()=>new SeventhComputePort('replica-sync-lab','core:replicaModelCompute'),initialize:()=>{},dispose:()=>{},disposePhase:ClosePhase.services});
// seventh-kernel-factories-end
  if(selectedPlugins.includes('schedlab-harness'))await system.start({id:'schedulerProbeSessions',startup:'required',requires:['@machines','@pluginDirectory','imageAssets'],create:dependencies=>new SuiteExecutionSessions(dependencies.vm(),dependencies.get('imageAssets'),dependencies.get('@pluginDirectory'),suiteCapacity(),seventhScheduleExecutionProfile,dependencies.executionCleanup()),initialize:value=>value.init(),dispose:value=>value?.close(),disposePhase:ClosePhase.services});
  if(selectedPlugins.includes('extforge-builds'))await system.start({id:'extensionBuildSessions',startup:'required',requires:['@machines','@pluginDirectory','imageAssets'],create:dependencies=>new SuiteExecutionSessions(dependencies.vm(),dependencies.get('imageAssets'),dependencies.get('@pluginDirectory'),suiteCapacity(),seventhExtensionExecutionProfile,dependencies.executionCleanup()),initialize:value=>value.init(),dispose:value=>value?.close(),disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('protostate-')))await system.start({id:'protocolScenarioSessions',startup:'required',requires:['@machines','@pluginDirectory','imageAssets'],create:dependencies=>new SeventhProtocolSessions(dependencies.vm(),dependencies.get('imageAssets'),dependencies.get('@pluginDirectory'),suiteCapacity(),seventhProtocolExecutionProfile,dependencies.executionCleanup()),initialize:value=>value.init(),dispose:value=>value?.close(),disposePhase:ClosePhase.services});
  if(selectedPlugins.some(id=>id.startsWith('virtservice-')))await system.start({id:'multiServiceVirtualizationSessions',startup:'required',requires:['@machines','@pluginDirectory','imageAssets'],create:dependencies=>new SeventhVirtualizationSessions(dependencies.vm(),dependencies.get('imageAssets'),dependencies.get('@pluginDirectory'),suiteCapacity(),seventhVirtualizationExecutionProfile,dependencies.executionCleanup()),initialize:value=>value.init(),dispose:value=>value?.close(),disposePhase:ClosePhase.services});
  if (selectedPlugins.includes('browser-runners')) {
    await system.start({
      id: 'browserSessions', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: dependencies => legacySuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), browserExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('database-fixtures')) {
    await system.start({
      id: 'databaseRehearsal', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: dependencies => legacySuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), databaseExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('media-workers') || selectedPlugins.includes('media-inspect')) {
    await system.start({
      id: 'mediaTasks', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: (dependencies) => legacySuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), mediaExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('learning-sessions')) {
    await system.start({
      id: 'learningToolSessions', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: (dependencies) => legacySuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), learningExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('event-brokers')) {
    await system.start({
      id: 'eventSessions', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: dependencies => legacySuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), eventExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.some(id => ['evaluation-endpoints', 'evaluation-runners', 'evaluation-scorers'].includes(id))) {
    await system.start({
      id: 'evaluationCalls', startup: 'required', requires: [],
      create: () => {
        const ledger = new MetadataStore<unknown>(join(DATA, 'evaluation-calls', 'receipts.json'), {fallback: () => []});
        return new EvaluationCalls({name: 'receipts', read: signal => ledger.read(signal), replace: (value, options) => ledger.replace(value, options)});
      },
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('integration-runners')) {
    await system.start({
      id: 'preparedWorkerSessions', startup: 'required', requires: ['@machines'], lateRequires: ['@plugins'],
      create: dependencies => new PreparedWorkerSessions(dependencies.vm(), () => {
        const workspaces = dependencies.late('@plugins').workspaces;
        if (!workspaces) throw new AppError('固定工具会话需要项目插件', 503, 'PROJECTS_UNAVAILABLE');
        return workspaces;
      }, preparedWorkerMetadata),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('resilience-fixtures')) {
    await system.start({
      id: 'drillSupervision', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'], lateRequires: ['@plugins'],
      create: dependencies => createCoreDrillService(dependencies.vm(), () => {
        const workspaces = dependencies.late('@plugins').workspaces;
        if (!workspaces) throw new AppError('演练监管需要项目插件', 503, 'PROJECTS_UNAVAILABLE');
        return workspaces;
      }, dependencies.get('@pluginDirectory')),
      initialize: () => {}, dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
}
