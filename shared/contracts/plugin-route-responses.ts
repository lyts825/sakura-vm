/**
 * 模块职责（中文）：把插件 HTTP 路由标识映射到响应 Schema 和传输模式，供运行时校验与客户端契约生成使用。
 * Module responsibility (English): mapping exact plugin routes to response schemas and transport modes.
 * 详细范围（中文）：公开入口包括 automationGetFeatureSuiteResponseSchema, automationGetVmsVmIdAdvancedResponseSchema, automationPutVmsVmIdAdvancedResponseSchema, automationPostVmsVmIdAdvancedResponseSchema, automationGetVmsVmIdPackagesResponseSchema, automationPostVmsVmIdPackagesResponseSchema, automationPostVmsVmIdSuspendResponseSchema, backupsGetVmsVmIdBackupsResponseSchema, backupsPutVmsVmIdBackupsResponseSchema, backupsPostVmsVmIdBackupsResponseSchema, backupsPostVmsVmIdBackupDownloadResponseSchema, codeChecksGetVmsVmIdCodeDiagnosticsResponseSchema, codeChecksGetVmsVmIdLanguageServiceResponseSchema, codeChecksPostVmsVmIdLanguageServiceResponseSchema, codeChecksGetVmsVmIdDebuggerResponseSchema, codeChecksPostVmsVmIdDebuggerResponseSchema；职责覆盖精确插件路由到响应 Schema 和传输模式的映射，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include automationGetFeatureSuiteResponseSchema, automationGetVmsVmIdAdvancedResponseSchema, automationPutVmsVmIdAdvancedResponseSchema, automationPostVmsVmIdAdvancedResponseSchema, automationGetVmsVmIdPackagesResponseSchema, automationPostVmsVmIdPackagesResponseSchema, automationPostVmsVmIdSuspendResponseSchema, backupsGetVmsVmIdBackupsResponseSchema, backupsPutVmsVmIdBackupsResponseSchema, backupsPostVmsVmIdBackupsResponseSchema, backupsPostVmsVmIdBackupDownloadResponseSchema, codeChecksGetVmsVmIdCodeDiagnosticsResponseSchema, codeChecksGetVmsVmIdLanguageServiceResponseSchema, codeChecksPostVmsVmIdLanguageServiceResponseSchema, codeChecksGetVmsVmIdDebuggerResponseSchema, codeChecksPostVmsVmIdDebuggerResponseSchema. The scope covers mapping exact plugin routes to response schemas and transport modes. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';
import { cleanupProvidersSchema, cleanupPreviewSchema, cleanupResultSchema } from './cleanup-plan.ts';
import { recipePlanSchema } from './recipe-plan.ts';
import { repairSessionSchema, repairActionResponseSchema } from './repair-session.ts';
import { deliveryHttpResponses } from './delivery-http.ts';
import { foundryHttpResponses } from './foundry-http.ts';
import { appRouteResponses } from './app-http.ts';
import { dataHttpResponses } from './data-http.ts';
import { knowledgeHttpResponses } from './knowledge-http.ts';
import { supplyHttpResponses } from './supply-http.ts';
import { resilienceHttpResponses } from './resilience-http-registry.ts';
import { integrationHttpResponses } from './integration-http-registry.ts';
import type { HttpResponseContract } from './http-response.ts';
import { jsonValueSchema } from './json-values.ts';
import { jobViewSchema, vmViewSchema } from './core-dtos.ts';
import {
  capabilityResultSchema,
  featureSettingSchema,
  operationJsonSchema,
  filePreviewSchema,
  fileListingSchema,
  fileOperationSchema,
  debuggerVariablesSchema,
  languageResultSchema,
  dockerContainerSchema,
  dockerImageSchema,
  dockerVolumeSchema,
} from './plugin-response-dtos.ts';

/** Explicit public wire DTOs. Optional values represent omission during JSON serialization.
 * Dynamic feature options, adapter results and external protocol fields contain JSON values. */
export const automationGetFeatureSuiteResponseSchema = z
  .object({
    features: z.array(
      z
        .object({
          id: z.union([
            z.literal('image-import'),
            z.literal('golden-images'),
            z.literal('multi-arch'),
            z.literal('power-schedules'),
            z.literal('idle-shutdown'),
            z.literal('dynamic-memory'),
            z.literal('online-snapshots'),
            z.literal('snapshot-diff'),
            z.literal('disk-maintenance'),
            z.literal('resource-presets'),
            z.literal('windows-mount'),
            z.literal('file-drop'),
            z.literal('workspace-search'),
            z.literal('disk-analyzer'),
            z.literal('resumable-transfer'),
            z.literal('three-way-sync'),
            z.literal('directory-history'),
            z.literal('binary-preview'),
            z.literal('language-services'),
            z.literal('debug-adapter'),
            z.literal('test-explorer'),
            z.literal('format-lint'),
            z.literal('git-worktrees'),
            z.literal('merge-editor'),
            z.literal('dependency-report'),
            z.literal('runtime-matrix'),
            z.literal('package-manager'),
            z.literal('reproducible-env'),
            z.literal('dev-container'),
            z.literal('browser-preview'),
            z.literal('database-presets'),
            z.literal('ai-assistant'),
            z.literal('port-discovery'),
            z.literal('reverse-proxy'),
            z.literal('network-profiles'),
            z.literal('vpn-integration'),
            z.literal('network-diagnostics'),
            z.literal('package-cache'),
            z.literal('service-dashboard'),
            z.literal('gpu-acceleration'),
            z.literal('audio-video'),
            z.literal('single-app-windows'),
            z.literal('process-interop'),
            z.literal('native-integration'),
            z.literal('multi-monitor'),
            z.literal('metrics-history'),
            z.literal('alerts'),
            z.literal('security-scan'),
            z.literal('rbac-sharing'),
            z.literal('plugin-api'),
          ]),
          name: z.string(),
          category: z.string(),
          priority: z.string(),
          summary: z.string(),
          state: z.union([z.literal('available'), z.literal('experimental'), z.literal('planned')]),
          implemented: z.boolean(),
        })
        .strict(),
    ),
    capabilities: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          scope: z.union([z.literal('suite'), z.literal('extended'), z.literal('next')]),
          example: z.record(z.string(), jsonValueSchema),
          note: z.string(),
          requiresGuest: z.boolean(),
          writes: z.boolean(),
          schema: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    presets: z
      .object({
        light: z
          .object({ name: z.literal('轻量命令行'), memoryMiB: z.literal(512), cpus: z.literal(1) })
          .strict(),
        development: z
          .object({ name: z.literal('日常开发'), memoryMiB: z.literal(2048), cpus: z.literal(2) })
          .strict(),
        build: z
          .object({ name: z.literal('编译构建'), memoryMiB: z.literal(4096), cpus: z.literal(4) })
          .strict(),
        desktop: z
          .object({ name: z.literal('图形桌面'), memoryMiB: z.literal(2048), cpus: z.literal(2) })
          .strict(),
      })
      .strict(),
    generatedAt: z.string(),
  })
  .strict();

export const automationGetVmsVmIdAdvancedResponseSchema = z
  .object({
    projectId: z.string(),
    settings: z
      .object({
        schedule: z
          .object({
            enabled: z.boolean(),
            idleMinutes: z.number(),
            idleAction: z.literal('stop'),
            startAt: z.string().optional(),
            stopAt: z.string().optional(),
          })
          .strict(),
        alerts: z
          .object({
            enabled: z.boolean(),
            cpuPercent: z.number(),
            memoryPercent: z.number(),
            diskPercent: z.number(),
            cooldownMinutes: z.number(),
            taskFailures: z.boolean(),
            serviceFailures: z.boolean(),
            secretRotation: z.boolean(),
          })
          .strict(),
        updatedAt: z.string(),
      })
      .strict(),
    history: z.array(
      z
        .object({
          sampledAt: z.string(),
          cpuPercent: z.number(),
          memoryUsed: z.number(),
          memoryTotal: z.number(),
          diskUsed: z.number(),
          diskTotal: z.number(),
          networkReceivedBytes: z.union([z.null(), z.number()]).optional(),
          networkTransmittedBytes: z.union([z.null(), z.number()]).optional(),
          networkReceiveBytesPerSecond: z.union([z.null(), z.number()]).optional(),
          networkTransmitBytesPerSecond: z.union([z.null(), z.number()]).optional(),
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          id: z.string(),
          vmId: z.string(),
          kind: z.union([
            z.literal('cpu'),
            z.literal('memory'),
            z.literal('secret'),
            z.literal('backup'),
            z.literal('disk'),
            z.literal('service'),
            z.literal('task'),
          ]),
          message: z.string(),
          createdAt: z.string(),
          acknowledged: z.boolean(),
          projectId: z.string().optional(),
          jobId: z.string().optional(),
        })
        .strict(),
    ),
    job: z.union([z.null(), jobViewSchema]),
    devJob: z.union([z.null(), jobViewSchema]),
    presets: z
      .object({
        light: z
          .object({ name: z.literal('轻量命令行'), memoryMiB: z.literal(512), cpus: z.literal(1) })
          .strict(),
        development: z
          .object({ name: z.literal('日常开发'), memoryMiB: z.literal(2048), cpus: z.literal(2) })
          .strict(),
        build: z
          .object({ name: z.literal('编译构建'), memoryMiB: z.literal(4096), cpus: z.literal(4) })
          .strict(),
        desktop: z
          .object({ name: z.literal('图形桌面'), memoryMiB: z.literal(2048), cpus: z.literal(2) })
          .strict(),
      })
      .strict(),
    features: z.array(
      z
        .object({
          id: z.union([
            z.literal('image-import'),
            z.literal('golden-images'),
            z.literal('multi-arch'),
            z.literal('power-schedules'),
            z.literal('idle-shutdown'),
            z.literal('dynamic-memory'),
            z.literal('online-snapshots'),
            z.literal('snapshot-diff'),
            z.literal('disk-maintenance'),
            z.literal('resource-presets'),
            z.literal('windows-mount'),
            z.literal('file-drop'),
            z.literal('workspace-search'),
            z.literal('disk-analyzer'),
            z.literal('resumable-transfer'),
            z.literal('three-way-sync'),
            z.literal('directory-history'),
            z.literal('binary-preview'),
            z.literal('language-services'),
            z.literal('debug-adapter'),
            z.literal('test-explorer'),
            z.literal('format-lint'),
            z.literal('git-worktrees'),
            z.literal('merge-editor'),
            z.literal('dependency-report'),
            z.literal('runtime-matrix'),
            z.literal('package-manager'),
            z.literal('reproducible-env'),
            z.literal('dev-container'),
            z.literal('browser-preview'),
            z.literal('database-presets'),
            z.literal('ai-assistant'),
            z.literal('port-discovery'),
            z.literal('reverse-proxy'),
            z.literal('network-profiles'),
            z.literal('vpn-integration'),
            z.literal('network-diagnostics'),
            z.literal('package-cache'),
            z.literal('service-dashboard'),
            z.literal('gpu-acceleration'),
            z.literal('audio-video'),
            z.literal('single-app-windows'),
            z.literal('process-interop'),
            z.literal('native-integration'),
            z.literal('multi-monitor'),
            z.literal('metrics-history'),
            z.literal('alerts'),
            z.literal('security-scan'),
            z.literal('rbac-sharing'),
            z.literal('plugin-api'),
          ]),
          name: z.string(),
          category: z.string(),
          priority: z.string(),
          summary: z.string(),
          state: z.union([z.literal('available'), z.literal('experimental'), z.literal('planned')]),
          implemented: z.boolean(),
        })
        .strict(),
    ),
    featureRuns: z.array(
      z
        .object({
          featureId: z.union([
            z.literal('image-import'),
            z.literal('golden-images'),
            z.literal('multi-arch'),
            z.literal('power-schedules'),
            z.literal('idle-shutdown'),
            z.literal('dynamic-memory'),
            z.literal('online-snapshots'),
            z.literal('snapshot-diff'),
            z.literal('disk-maintenance'),
            z.literal('resource-presets'),
            z.literal('windows-mount'),
            z.literal('file-drop'),
            z.literal('workspace-search'),
            z.literal('disk-analyzer'),
            z.literal('resumable-transfer'),
            z.literal('three-way-sync'),
            z.literal('directory-history'),
            z.literal('binary-preview'),
            z.literal('language-services'),
            z.literal('debug-adapter'),
            z.literal('test-explorer'),
            z.literal('format-lint'),
            z.literal('git-worktrees'),
            z.literal('merge-editor'),
            z.literal('dependency-report'),
            z.literal('runtime-matrix'),
            z.literal('package-manager'),
            z.literal('reproducible-env'),
            z.literal('dev-container'),
            z.literal('browser-preview'),
            z.literal('database-presets'),
            z.literal('ai-assistant'),
            z.literal('port-discovery'),
            z.literal('reverse-proxy'),
            z.literal('network-profiles'),
            z.literal('vpn-integration'),
            z.literal('network-diagnostics'),
            z.literal('package-cache'),
            z.literal('service-dashboard'),
            z.literal('gpu-acceleration'),
            z.literal('audio-video'),
            z.literal('single-app-windows'),
            z.literal('process-interop'),
            z.literal('native-integration'),
            z.literal('multi-monitor'),
            z.literal('metrics-history'),
            z.literal('alerts'),
            z.literal('security-scan'),
            z.literal('rbac-sharing'),
            z.literal('plugin-api'),
          ]),
          startedAt: z.string(),
          finishedAt: z.string(),
          result: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    capabilities: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          scope: z.union([z.literal('suite'), z.literal('extended'), z.literal('next')]),
          example: z.record(z.string(), jsonValueSchema),
          note: z.string(),
          requiresGuest: z.boolean(),
          writes: z.boolean(),
          schema: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    capabilityJobs: z.array(jobViewSchema),
  })
  .strict();

export const automationPutVmsVmIdAdvancedResponseSchema = z
  .object({
    schedule: z
      .object({
        enabled: z.boolean(),
        idleMinutes: z.number(),
        idleAction: z.literal('stop'),
        startAt: z.string().optional(),
        stopAt: z.string().optional(),
      })
      .strict(),
    alerts: z
      .object({
        enabled: z.boolean(),
        cpuPercent: z.number(),
        memoryPercent: z.number(),
        diskPercent: z.number(),
        cooldownMinutes: z.number(),
        taskFailures: z.boolean(),
        serviceFailures: z.boolean(),
        secretRotation: z.boolean(),
      })
      .strict(),
    updatedAt: z.string(),
  })
  .strict();

export const automationPostVmsVmIdAdvancedResponseSchema = z.union([
  capabilityResultSchema,
  vmViewSchema,
  z
    .object({
      id: z.string(),
      vmId: z.string(),
      kind: z.union([
        z.literal('cpu'),
        z.literal('memory'),
        z.literal('secret'),
        z.literal('backup'),
        z.literal('disk'),
        z.literal('service'),
        z.literal('task'),
      ]),
      message: z.string(),
      createdAt: z.string(),
      acknowledged: z.boolean(),
      projectId: z.string().optional(),
      jobId: z.string().optional(),
    })
    .strict(),
  jobViewSchema,
  z
    .object({
      message: z.string(),
      reason: z.string().optional(),
      ready: z.boolean(),
      executed: z.boolean(),
      enabled: z.boolean(),
      installed: z.boolean(),
      programs: z.array(
        z
          .object({
            programId: z.string(),
            executable: z.string(),
            fixedArgs: z.array(z.string()),
            sha256: z.string(),
          })
          .strict(),
      ),
    })
    .strict(),
  z.object({ ready: z.boolean(), executed: z.boolean(), programId: z.string(), sha256: z.string() }).strict(),
  z.object({ ready: z.boolean(), executed: z.boolean(), programId: z.string() }).strict(),
  z.object({ ready: z.boolean(), executed: z.boolean(), enabled: z.boolean() }).strict(),
  z
    .object({
      ready: z.boolean(),
      executed: z.boolean(),
      installed: z.boolean(),
      reason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ready: z.boolean(),
      executed: z.boolean(),
      enabled: z.boolean(),
      installed: z.boolean(),
      command: z.string(),
    })
    .strict(),
  z
    .object({
      ready: z.boolean(),
      executed: z.boolean(),
      featureId: z.union([
        z.literal('resource-presets'),
        z.literal('workspace-search'),
        z.literal('disk-analyzer'),
        z.literal('directory-history'),
        z.literal('format-lint'),
        z.literal('git-worktrees'),
        z.literal('dependency-report'),
        z.literal('runtime-matrix'),
        z.literal('reproducible-env'),
        z.literal('network-diagnostics'),
        z.literal('gpu-acceleration'),
        z.literal('process-interop'),
        z.literal('ipv6'),
        z.literal('gpu-compute-passthrough'),
        z.literal('pci-usb-passthrough'),
        z.literal('vtpm-key-enrollment'),
        z.literal('service-mesh'),
        z.literal('syscall-profile'),
        z.literal('ssh-agent-forward'),
        z.literal('gpg-agent-forward'),
        z.literal('acme-renewal'),
        z.literal('team-templates'),
        z.literal('wireguard-overlay'),
        z.literal('object-backup'),
        z.literal('project-quota'),
        z.literal('guest-quota'),
        z.literal('storage-pools'),
        z.literal('storage-tiering'),
        z.literal('disaster-recovery-drill'),
        z.literal('authenticated-ide-preview'),
        z.literal('notebook-environment'),
        z.literal('cross-host-snapshots'),
        z.literal('maintenance-drain'),
        z.literal('cold-migration'),
        z.literal('ebpf-profiler'),
        z.literal('flamegraph'),
        z.literal('network-emulation'),
        z.literal('network-quota'),
        z.literal('egress-policy'),
        z.literal('nat-hairpin'),
        z.literal('power-aware-schedule'),
        z.literal('host-disk-health'),
        z.literal('availability-report'),
        z.literal('global-dedup'),
        z.literal('audit-log'),
        z.literal('otel-tracing'),
        z.literal('dependency-bot'),
        z.literal('cpu-topology'),
        z.literal('device-profiles'),
        z.literal('resource-reservation'),
        z.literal('vcpu-hotplug'),
        z.literal('memory-hotplug'),
        z.literal('crash-loop-guard'),
        z.literal('maintenance-windows'),
        z.literal('schema-panels'),
        z.literal('compliance-evidence'),
        z.literal('proxy-pac'),
        z.literal('build-cache'),
        z.literal('branch-preview'),
        z.literal('onboarding-checklist'),
        z.literal('review-threads'),
        z.literal('patch-bundle'),
        z.literal('environment-recreate'),
        z.literal('editor-profiles'),
        z.literal('metrics-export'),
        z.literal('event-timeline'),
        z.literal('activity-digest'),
        z.literal('slo-dashboard'),
        z.literal('error-budget'),
        z.literal('capacity-forecast'),
        z.literal('anomaly-detection'),
        z.literal('log-index'),
        z.literal('test-sharding'),
        z.literal('review-comments'),
        z.literal('command-forms'),
        z.literal('vm-dependency-start'),
        z.literal('environment-parity'),
        z.literal('test-matrix'),
        z.literal('cross-vm-copy'),
        z.literal('network-topology'),
        z.literal('packet-capture'),
        z.literal('reverse-tunnel'),
        z.literal('code-search-index'),
        z.literal('language-server-catalog'),
        z.literal('pii-classification'),
      ]),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      ready: z.boolean(),
      executed: z.boolean(),
      preview: z
        .object({
          interface: z.string(),
          egressKbps: z.number(),
          burstKiB: z.number(),
          latencyMs: z.number(),
          maxTcpConnections: z.number(),
          newTcpConnectionsPerSecond: z.number(),
          connectionBurst: z.number(),
        })
        .strict(),
      previous: z.string(),
      current: z.string(),
      active: z.boolean(),
      connectionPolicyActive: z.boolean(),
      featureId: z.literal('network-quota'),
    })
    .strict(),
  z
    .object({
      ready: z.boolean(),
      executed: z.boolean(),
      preview: z
        .object({
          interface: z.string(),
          egressKbps: z.number(),
          burstKiB: z.number(),
          latencyMs: z.number(),
          maxTcpConnections: z.number(),
          newTcpConnectionsPerSecond: z.number(),
          connectionBurst: z.number(),
        })
        .strict(),
      current: z.string(),
      active: z.boolean(),
      connectionControlsAvailable: z.boolean(),
      connectionPolicyActive: z.boolean(),
      connectionRules: z.array(
        z
          .object({
            family: z.union([z.literal('iptables'), z.literal('ip6tables')]),
            interface: z.string(),
            chain: z.string(),
            rules: z.array(z.string()).optional(),
          })
          .strict(),
      ),
      featureId: z.literal('network-quota'),
    })
    .strict(),
  z
    .object({
      active: z.boolean(),
      persistent: z.boolean(),
      fstabEntry: z.union([z.null(), z.string()]),
      mount: z.union([z.null(), z.string()]),
      capacityMiB: z.union([z.null(), z.number()]),
      usedMiB: z.union([z.null(), z.number()]),
      availableMiB: z.union([z.null(), z.number()]),
      ready: z.boolean(),
      executed: z.boolean(),
      projectId: z.string(),
      directory: z.string(),
      limitMiB: z.number(),
      featureId: z.literal('project-quota'),
    })
    .strict(),
  z
    .object({
      reason: z.string().optional(),
      active: z.boolean(),
      persistent: z.boolean(),
      fstabEntry: z.union([z.null(), z.string()]),
      mount: z.union([z.null(), z.string()]),
      capacityMiB: z.union([z.null(), z.number()]),
      usedMiB: z.union([z.null(), z.number()]),
      availableMiB: z.union([z.null(), z.number()]),
      ready: z.boolean(),
      executed: z.boolean(),
      projectId: z.string(),
      directory: z.string(),
      limitMiB: z.union([z.null(), z.number()]),
      phase: z.string(),
      featureId: z.literal('project-quota'),
    })
    .strict(),
  z
    .object({
      ready: z.boolean(),
      executed: z.boolean(),
      projectId: z.string(),
      directory: z.string(),
      uid: z.number(),
      hardMiB: z.number(),
      active: z.boolean(),
      report: z.string(),
      featureId: z.literal('guest-quota'),
    })
    .strict(),
  z
    .object({
      ready: z.boolean(),
      active: z.boolean(),
      missing: z.array(z.string()),
      report: z.string(),
      reason: z.string().optional(),
      executed: z.boolean(),
      projectId: z.string(),
      directory: z.string(),
      uid: z.number(),
      projectLimitMiB: z.union([z.null(), z.number()]),
      featureId: z.literal('guest-quota'),
    })
    .strict(),
  z
    .object({
      ready: z.boolean(),
      executed: z.boolean(),
      preview: z
        .object({ interface: z.string(), allowedDestinations: z.array(z.string()), ipv6: z.string() })
        .strict(),
      active: z.boolean(),
      removed: z.number(),
      featureId: z.literal('egress-policy'),
    })
    .strict(),
  z
    .object({
      reason: z.string().optional(),
      cleanupWarnings: z.array(z.string()).optional(),
      ready: z.boolean(),
      executed: z.boolean(),
      preview: z
        .object({ interface: z.string(), allowedDestinations: z.array(z.string()), ipv6: z.string() })
        .strict(),
      active: z.boolean(),
      rules: z.array(
        z
          .object({
            family: z.union([z.literal('iptables'), z.literal('ip6tables')]),
            interface: z.string(),
            chain: z.string(),
            rules: z.array(z.string()).optional(),
          })
          .strict(),
      ),
      featureId: z.literal('egress-policy'),
    })
    .strict(),
  z
    .object({
      reason: z.string().optional(),
      ready: z.boolean(),
      executed: z.boolean(),
      preview: z
        .object({
          forwards: z.array(
            z
              .object({
                name: z.string().optional(),
                hostPort: z.number(),
                guestPort: z.number(),
                guestAddress: z.string(),
              })
              .strict(),
          ),
          selected: z
            .object({
              name: z.string().optional(),
              hostPort: z.number(),
              guestPort: z.number(),
              guestAddress: z.string(),
            })
            .strict()
            .optional(),
          guestAddress: z.string(),
        })
        .strict(),
      exitCode: z.number(),
      checkedAt: z.string(),
      featureId: z.literal('nat-hairpin'),
    })
    .strict(),
  z
    .object({
      cpuPercent: z.number(),
      memoryUsed: z.number(),
      memoryTotal: z.number(),
      diskUsed: z.number(),
      diskTotal: z.number(),
      networkReceivedBytes: z.union([z.null(), z.number()]),
      networkTransmittedBytes: z.union([z.null(), z.number()]),
      networkInterfaces: z.array(
        z.object({ name: z.string(), receivedBytes: z.number(), transmittedBytes: z.number() }).strict(),
      ),
      networkReceiveBytesPerSecond: z.union([z.null(), z.number()]),
      networkTransmitBytesPerSecond: z.union([z.null(), z.number()]),
      processes: z.array(z.object({ name: z.string(), memory: z.number() }).strict()),
      uptime: z.number(),
      sampledAt: z.string(),
    })
    .strict(),
  z
    .object({
      path: z.string(),
      entries: z.array(z.object({ path: z.string(), bytes: z.number() }).strict()),
      checkedAt: z.string(),
    })
    .strict(),
  z
    .object({ query: z.string(), path: z.string(), content: z.boolean(), matches: z.array(z.string()) })
    .strict(),
  z.object({ target: z.string(), output: z.string(), code: z.number() }).strict(),
  z.object({ ports: z.array(z.number()) }).strict(),
  z
    .object({
      checkedAt: z.string(),
      findings: z.array(z.string()),
      output: z.string(),
      code: z.number(),
      vulnerabilityScan: z
        .object({
          source: z.literal('OSV'),
          status: z.union([z.literal('complete'), z.literal('unavailable')]),
          ecosystem: z.union([z.null(), z.string()]),
          packagesChecked: z.number(),
          affectedPackages: z.number(),
          vulnerabilityCount: z.number(),
          matches: z.array(
            z.object({ name: z.string(), version: z.string(), ids: z.array(z.string()) }).strict(),
          ),
          error: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);

export const automationGetVmsVmIdPackagesResponseSchema = z
  .object({
    vmId: z.string(),
    mode: z.union([z.literal('installed'), z.literal('updates'), z.literal('search')]),
    manager: z.union([z.literal('apk'), z.literal('apt')]),
    query: z.string(),
    page: z.number(),
    total: z.number(),
    items: z.array(
      z
        .object({
          name: z.string(),
          version: z.string(),
          description: z.string().optional(),
          installedVersion: z.string().optional(),
          availableVersion: z.string().optional(),
        })
        .strict(),
    ),
    hasMore: z.boolean(),
    warning: z.string(),
  })
  .strict();

export const automationPostVmsVmIdPackagesResponseSchema = z.union([
  z.object({ job: jobViewSchema }).strict(),
  z
    .object({
      token: z.string(),
      expiresAt: z.number(),
      manager: z.union([z.literal('apk'), z.literal('apt')]),
      plan: z.string(),
      change: z.union([
        z.literal('remove'),
        z.literal('install'),
        z.literal('upgrade'),
        z.literal('upgrade-all'),
      ]),
      name: z.union([z.null(), z.string()]),
    })
    .strict(),
]);

export const automationPostVmsVmIdSuspendResponseSchema = vmViewSchema;

export const backupsGetVmsVmIdBackupsResponseSchema = z
  .object({
    bytes: z.number(),
    job: z.union([z.null(), jobViewSchema]),
    waitingForShutdown: z.boolean(),
    maintenance: z.boolean(),
    policy: z
      .object({
        enabled: z.boolean(),
        intervalHours: z.number(),
        keep: z.number(),
        maxGiB: z.number(),
        lockDays: z.number().optional(),
        deduplicate: z.boolean().optional(),
        bandwidthMiBps: z.number().optional(),
        directory: z.string().optional(),
        passwordSecret: z.string().optional(),
      })
      .strict(),
    items: z.array(
      z
        .object({
          id: z.string(),
          createdAt: z.string(),
          bytes: z.number(),
          checksum: z.string(),
          verifiedAt: z.string().optional(),
          error: z.string().optional(),
          directory: z.string().optional(),
          encrypted: z.boolean().optional(),
          passwordSecret: z.string().optional(),
          retainUntil: z.string().optional(),
          storage: z.literal('blocks').optional(),
        })
        .strict(),
    ),
    lastSuccess: z.string().optional(),
  })
  .strict();

export const backupsPutVmsVmIdBackupsResponseSchema = z
  .object({
    policy: z
      .object({
        enabled: z.boolean(),
        intervalHours: z.number(),
        keep: z.number(),
        maxGiB: z.number(),
        lockDays: z.number().optional(),
        deduplicate: z.boolean().optional(),
        bandwidthMiBps: z.number().optional(),
        directory: z.string().optional(),
        passwordSecret: z.string().optional(),
      })
      .strict(),
    items: z.array(
      z
        .object({
          id: z.string(),
          createdAt: z.string(),
          bytes: z.number(),
          checksum: z.string(),
          verifiedAt: z.string().optional(),
          error: z.string().optional(),
          directory: z.string().optional(),
          encrypted: z.boolean().optional(),
          passwordSecret: z.string().optional(),
          retainUntil: z.string().optional(),
          storage: z.literal('blocks').optional(),
        })
        .strict(),
    ),
    lastSuccess: z.string().optional(),
  })
  .strict();

export const backupsPostVmsVmIdBackupsResponseSchema = z.union([
  jobViewSchema,
  z.union([jobViewSchema, z.object({ ok: z.boolean() }).strict()]),
]);

export const backupsPostVmsVmIdBackupDownloadResponseSchema = z
  .object({ url: z.string(), expiresAt: z.number() })
  .strict();

export const codeChecksGetVmsVmIdCodeDiagnosticsResponseSchema = z
  .object({
    path: z.string(),
    diagnostics: z.array(
      z
        .object({
          severity: z.union([z.literal('error'), z.literal('info'), z.literal('warning')]),
          message: z.string(),
          line: z.number().optional(),
          column: z.number().optional(),
        })
        .strict(),
    ),
    supported: z.boolean(),
  })
  .strict();

export const codeChecksGetVmsVmIdLanguageServiceResponseSchema = z
  .object({
    language: z.string(),
    installed: z.boolean(),
    supported: z.boolean(),
    pending: z.array(
      z
        .object({
          token: z.string(),
          phase: z.union([
            z.literal('active'),
            z.literal('review'),
            z.literal('intent'),
            z.literal('closed'),
          ]),
          needsReview: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const codeChecksPostVmsVmIdLanguageServiceResponseSchema = z.union([
  z.object({ installed: z.boolean(), languages: z.array(z.string()) }).strict(),
  z.object({ stopped: z.boolean() }).strict(),
  z
    .object({
      files: z.array(z.object({ path: z.string(), content: z.string(), version: z.string() }).strict()),
    })
    .strict(),
  languageResultSchema,
]);

export const codeChecksGetVmsVmIdDebuggerResponseSchema = z.union([
  z
    .object({
      active: z.boolean(),
      needsReview: z.boolean(),
      error: z.string(),
      token: z.string(),
      state: z.union([
        z.literal('running'),
        z.literal('error'),
        z.literal('stopped'),
        z.literal('starting'),
        z.literal('terminated'),
      ]),
      path: z.string(),
      directory: z.string(),
      reason: z.string(),
      threadId: z.number(),
      selectedFrame: z.number(),
      output: z.string(),
      breakpoints: z.array(
        z.object({ line: z.number(), verified: z.boolean(), message: z.string().optional() }).strict(),
      ),
      frames: z.array(
        z
          .object({
            id: z.number(),
            name: z.string(),
            path: z.string(),
            line: z.number(),
            column: z.number(),
          })
          .strict(),
      ),
      variables: z.array(
        z
          .object({ name: z.string(), value: z.string(), type: z.string(), variablesReference: z.number() })
          .strict(),
      ),
      startedAt: z.string(),
      installed: z.boolean(),
    })
    .strict(),
  z
    .object({
      installed: z.boolean(),
      active: z.boolean(),
      token: z.string(),
      state: z.literal('error'),
      needsReview: z.boolean(),
      error: z.string(),
      pending: z.array(
        z
          .object({
            token: z.string(),
            projectId: z.string(),
            phase: z.union([
              z.literal('active'),
              z.literal('review'),
              z.literal('intent'),
              z.literal('closed'),
            ]),
          })
          .strict(),
      ),
    })
    .strict(),
  z.object({ installed: z.boolean(), active: z.boolean() }).strict(),
]);

export const codeChecksPostVmsVmIdDebuggerResponseSchema = z.union([
  z.object({ installed: z.boolean() }).strict(),
  z
    .object({
      active: z.boolean(),
      token: z.string(),
      state: z.union([
        z.literal('running'),
        z.literal('error'),
        z.literal('stopped'),
        z.literal('starting'),
        z.literal('terminated'),
      ]),
      path: z.string(),
      directory: z.string(),
      reason: z.string(),
      threadId: z.number(),
      selectedFrame: z.number(),
      output: z.string(),
      breakpoints: z.array(
        z.object({ line: z.number(), verified: z.boolean(), message: z.string().optional() }).strict(),
      ),
      frames: z.array(
        z
          .object({
            id: z.number(),
            name: z.string(),
            path: z.string(),
            line: z.number(),
            column: z.number(),
          })
          .strict(),
      ),
      variables: z.array(
        z
          .object({ name: z.string(), value: z.string(), type: z.string(), variablesReference: z.number() })
          .strict(),
      ),
      error: z.string(),
      startedAt: z.string(),
      needsReview: z.boolean(),
    })
    .strict(),
  z.object({ active: z.boolean(), stopped: z.boolean(), output: z.string() }).strict(),
  debuggerVariablesSchema,
]);

export const containersGetVmsVmIdContainersResponseSchema = z.union([
  z.object({ log: z.string() }).strict(),
  z
    .object({
      id: z.string(),
      version: z.string(),
      name: z.string(),
      description: z.string(),
      documentationURL: z.string(),
      reference: z.string(),
      sourceMatched: z.boolean(),
      imageVariant: z
        .object({ default: z.string(), choices: z.array(z.string()) })
        .strict()
        .optional(),
      optionalPaths: z.array(z.string()),
      files: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      supported: z.boolean(),
      installed: z.boolean(),
      containers: z.array(z.never()),
      images: z.array(z.never()),
      volumes: z.array(z.never()),
      files: z.array(z.never()),
      job: z.union([z.null(), jobViewSchema]),
    })
    .strict(),
  z
    .object({
      supported: z.boolean(),
      installed: z.boolean(),
      available: z.boolean(),
      privateNetwork: z.boolean(),
      containers: z.array(z.never()),
      images: z.array(z.never()),
      volumes: z.array(z.never()),
      files: z.array(z.never()),
      job: z.union([z.null(), jobViewSchema]),
      error: z.string(),
    })
    .strict(),
  z
    .object({
      supported: z.boolean(),
      installed: z.boolean(),
      available: z.boolean(),
      runtime: z
        .object({
          present: z.boolean(),
          running: z.boolean(),
          valid: z.boolean(),
          reason: z.union([z.null(), z.string()]),
          runId: z.union([z.null(), z.string()]),
          containers: z.number(),
        })
        .strict(),
      privateNetwork: z.boolean(),
      error: z.string().optional(),
      containers: z.array(z.never()),
      images: z.array(z.never()),
      volumes: z.array(z.never()),
      files: z.array(z.never()),
      devcontainer: z.union([
        z.object({ cliInstalled: z.boolean(), files: z.array(z.never()), error: z.string() }).strict(),
        z
          .object({ cliInstalled: z.boolean(), version: z.string().optional(), files: z.array(z.string()) })
          .strict(),
      ]),
      templates: z.tuple([
        z
          .object({
            id: z.literal('debian'),
            name: z.literal('Debian'),
            description: z.literal('通用 Debian 开发环境'),
          })
          .strict(),
        z
          .object({
            id: z.literal('javascript-node'),
            name: z.literal('Node.js'),
            description: z.literal('Node.js 与 JavaScript'),
          })
          .strict(),
        z
          .object({
            id: z.literal('python'),
            name: z.literal('Python'),
            description: z.literal('Python 3 开发环境'),
          })
          .strict(),
        z
          .object({ id: z.literal('go'), name: z.literal('Go'), description: z.literal('Go 开发环境') })
          .strict(),
        z
          .object({ id: z.literal('rust'), name: z.literal('Rust'), description: z.literal('Rust 开发环境') })
          .strict(),
      ]),
      job: z.union([z.null(), jobViewSchema]),
    })
    .strict(),
  z
    .object({
      supported: z.boolean(),
      installed: z.boolean(),
      available: z.boolean(),
      error: z.string(),
      containers: z.array(z.never()),
      images: z.array(z.never()),
      volumes: z.array(z.never()),
      files: z.array(z.never()),
      job: z.union([z.null(), jobViewSchema]),
    })
    .strict(),
  z
    .object({
      supported: z.boolean(),
      installed: z.boolean(),
      available: z.boolean(),
      privateNetwork: z.boolean(),
      runtime: z
        .object({
          present: z.boolean(),
          running: z.boolean(),
          valid: z.boolean(),
          reason: z.union([z.null(), z.string()]),
          runId: z.union([z.null(), z.string()]),
          containers: z.number(),
        })
        .strict()
        .optional(),
      version: z.string(),
      compose: z.string(),
      containers: z.array(dockerContainerSchema),
      images: z.array(dockerImageSchema),
      volumes: z.array(dockerVolumeSchema),
      files: z.array(z.string()),
      devcontainer: z.union([
        z.object({ cliInstalled: z.boolean(), files: z.array(z.never()), error: z.string() }).strict(),
        z
          .object({ cliInstalled: z.boolean(), version: z.string().optional(), files: z.array(z.string()) })
          .strict(),
      ]),
      templates: z.tuple([
        z
          .object({
            id: z.literal('debian'),
            name: z.literal('Debian'),
            description: z.literal('通用 Debian 开发环境'),
          })
          .strict(),
        z
          .object({
            id: z.literal('javascript-node'),
            name: z.literal('Node.js'),
            description: z.literal('Node.js 与 JavaScript'),
          })
          .strict(),
        z
          .object({
            id: z.literal('python'),
            name: z.literal('Python'),
            description: z.literal('Python 3 开发环境'),
          })
          .strict(),
        z
          .object({ id: z.literal('go'), name: z.literal('Go'), description: z.literal('Go 开发环境') })
          .strict(),
        z
          .object({ id: z.literal('rust'), name: z.literal('Rust'), description: z.literal('Rust 开发环境') })
          .strict(),
      ]),
      job: z.union([z.null(), jobViewSchema]),
    })
    .strict(),
]);

export const containersPostVmsVmIdContainersResponseSchema = jobViewSchema;

export const desktopGetVmsVmIdDesktopResponseSchema = z
  .object({
    status: z.union([
      z.literal('error'),
      z.literal('stopped'),
      z.literal('starting'),
      z.literal('ready'),
      z.literal('unavailable'),
      z.literal('not-installed'),
      z.literal('installing'),
    ]),
    log: z.string(),
    error: z.string().optional(),
    preferences: z
      .object({
        sessionType: z.union([z.literal('auto'), z.literal('x11'), z.literal('wayland')]),
        resolution: z.union([
          z.literal('1280x800'),
          z.literal('1440x900'),
          z.literal('1600x1000'),
          z.literal('1920x1080'),
        ]),
        monitorLayout: z.union([
          z.literal('single'),
          z.literal('dual-horizontal'),
          z.literal('dual-vertical'),
        ]),
        scale: z.number(),
        theme: z.union([
          z.literal('sakura'),
          z.literal('midnight'),
          z.literal('paper'),
          z.literal('lavender'),
        ]),
        wallpaper: z.union([
          z.literal('sakura'),
          z.literal('midnight'),
          z.literal('paper'),
          z.literal('plain'),
        ]),
        accent: z.string(),
        panel: z.union([z.literal('bottom'), z.literal('top'), z.literal('floating')]),
        autoHidePanel: z.boolean(),
        animations: z.boolean(),
      })
      .strict()
      .optional(),
    projectId: z.string().optional(),
    directory: z.string().optional(),
    networkIsolation: z.union([z.literal('host'), z.literal('private')]).optional(),
    bindingMismatch: z.boolean().optional(),
    cleanupPending: z.boolean().optional(),
  })
  .strict();

export const desktopPostVmsVmIdDesktopResponseSchema = z.union([
  z.object({ stopped: z.boolean() }).strict(),
  z
    .object({
      status: z.union([
        z.literal('error'),
        z.literal('stopped'),
        z.literal('starting'),
        z.literal('ready'),
        z.literal('unavailable'),
        z.literal('not-installed'),
        z.literal('installing'),
      ]),
      log: z.string(),
      error: z.string().optional(),
      preferences: z
        .object({
          sessionType: z.union([z.literal('auto'), z.literal('x11'), z.literal('wayland')]),
          resolution: z.union([
            z.literal('1280x800'),
            z.literal('1440x900'),
            z.literal('1600x1000'),
            z.literal('1920x1080'),
          ]),
          monitorLayout: z.union([
            z.literal('single'),
            z.literal('dual-horizontal'),
            z.literal('dual-vertical'),
          ]),
          scale: z.number(),
          theme: z.union([
            z.literal('sakura'),
            z.literal('midnight'),
            z.literal('paper'),
            z.literal('lavender'),
          ]),
          wallpaper: z.union([
            z.literal('sakura'),
            z.literal('midnight'),
            z.literal('paper'),
            z.literal('plain'),
          ]),
          accent: z.string(),
          panel: z.union([z.literal('bottom'), z.literal('top'), z.literal('floating')]),
          autoHidePanel: z.boolean(),
          animations: z.boolean(),
        })
        .strict()
        .optional(),
      projectId: z.string().optional(),
      directory: z.string().optional(),
      networkIsolation: z.union([z.literal('host'), z.literal('private')]).optional(),
      bindingMismatch: z.boolean().optional(),
      cleanupPending: z.boolean().optional(),
    })
    .strict(),
]);

export const desktopGetVmsVmIdSingleAppResponseSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          id: z.string(),
          vmId: z.string(),
          program: z.string(),
          display: z.number(),
          port: z.number(),
          resolution: z.string(),
          clipboard: z.object({ copy: z.boolean(), paste: z.boolean() }).strict(),
          startedAt: z.string(),
          password: z.string(),
          dataDirectory: z.string(),
          revoked: z.boolean(),
          cleanupPending: z.boolean(),
          status: z.union([
            z.literal('running'),
            z.literal('cleanup-pending'),
            z.literal('stopped'),
            z.literal('preparing'),
            z.literal('relaunch-required'),
            z.literal('review-required'),
          ]),
          projectId: z.string().optional(),
          networkIsolation: z.union([z.literal('host'), z.literal('private')]).optional(),
          projectOwner: z.object({ uid: z.number(), user: z.string() }).strict().optional(),
          applicationOwner: z.object({ uid: z.number(), user: z.string() }).strict().optional(),
          lastError: z.string().optional(),
        })
        .strict(),
    ),
    clipboardPolicies: z.record(z.string(), z.object({ copy: z.boolean(), paste: z.boolean() }).strict()),
  })
  .strict();

export const desktopPostVmsVmIdSingleAppResponseSchema = z.union([
  z
    .object({
      id: z.string(),
      vmId: z.string(),
      program: z.string(),
      display: z.number(),
      port: z.number(),
      resolution: z.string(),
      clipboard: z.object({ copy: z.boolean(), paste: z.boolean() }).strict(),
      startedAt: z.string(),
      password: z.string(),
      dataDirectory: z.string(),
      revoked: z.boolean(),
      cleanupPending: z.boolean(),
      status: z.union([
        z.literal('running'),
        z.literal('cleanup-pending'),
        z.literal('stopped'),
        z.literal('preparing'),
        z.literal('relaunch-required'),
        z.literal('review-required'),
      ]),
      projectId: z.string().optional(),
      networkIsolation: z.union([z.literal('host'), z.literal('private')]).optional(),
      projectOwner: z.object({ uid: z.number(), user: z.string() }).strict().optional(),
      applicationOwner: z.object({ uid: z.number(), user: z.string() }).strict().optional(),
      lastError: z.string().optional(),
    })
    .strict(),
  z.object({ stopped: z.boolean() }).strict(),
  z
    .object({ program: z.string(), clipboard: z.object({ copy: z.boolean(), paste: z.boolean() }).strict() })
    .strict(),
  z.object({ removed: z.boolean(), program: z.string() }).strict(),
]);

export const desktopGetVmsVmIdImeResponseSchema = z.union([z.null(), jobViewSchema]);

export const extensionsGetExtendedFeaturesResponseSchema = z
  .object({
    features: z.array(
      z
        .object({
          id: z.union([
            z.literal('ipv6'),
            z.literal('syscall-profile'),
            z.literal('ssh-agent-forward'),
            z.literal('gpg-agent-forward'),
            z.literal('project-quota'),
            z.literal('guest-quota'),
            z.literal('network-quota'),
            z.literal('egress-policy'),
            z.literal('power-aware-schedule'),
            z.literal('availability-report'),
            z.literal('audit-log'),
            z.literal('cpu-topology'),
            z.literal('device-profiles'),
            z.literal('resource-reservation'),
            z.literal('crash-loop-guard'),
            z.literal('maintenance-windows'),
            z.literal('patch-bundle'),
            z.literal('environment-recreate'),
            z.literal('editor-profiles'),
            z.literal('metrics-export'),
            z.literal('event-timeline'),
            z.literal('anomaly-detection'),
            z.literal('review-comments'),
            z.literal('command-forms'),
            z.literal('vm-dependency-start'),
            z.literal('environment-parity'),
            z.literal('test-matrix'),
            z.literal('cross-vm-copy'),
            z.literal('packet-capture'),
            z.literal('reverse-tunnel'),
            z.literal('vm-suspend'),
            z.literal('rescue-boot'),
            z.literal('qemu-commandline'),
            z.literal('guest-clock-policy'),
            z.literal('disk-encryption'),
            z.literal('qcow2-scrub'),
            z.literal('backup-dedup'),
            z.literal('cow-workspace'),
            z.literal('archive-wizard'),
            z.literal('posix-acl'),
            z.literal('secure-erase'),
            z.literal('hash-manifest'),
            z.literal('watch-sync'),
            z.literal('sync-window'),
            z.literal('rename-detection'),
            z.literal('case-conflict-report'),
            z.literal('sync-queue'),
            z.literal('path-sync-policy'),
            z.literal('sync-rollback'),
            z.literal('merge-drivers'),
            z.literal('multi-host-view'),
            z.literal('project-onboarding'),
            z.literal('task-import'),
            z.literal('env-schema'),
            z.literal('shell-profiles'),
            z.literal('toolchain-check'),
            z.literal('bootstrap-dry-run'),
            z.literal('project-template-pack'),
            z.literal('git-stash'),
            z.literal('git-reflog'),
            z.literal('git-rebase'),
            z.literal('git-bisect'),
            z.literal('git-cherry-pick'),
            z.literal('git-policy'),
            z.literal('precommit-secrets'),
            z.literal('code-ownership'),
            z.literal('flaky-tests'),
            z.literal('coverage-history'),
            z.literal('benchmark-regression'),
            z.literal('sbom'),
            z.literal('license-report'),
            z.literal('release-gates'),
            z.literal('artifact-provenance'),
            z.literal('changelog'),
            z.literal('reproducible-build'),
            z.literal('static-routes'),
            z.literal('network-isolation'),
            z.literal('local-dns-alias'),
            z.literal('tpm-secure-boot'),
            z.literal('hello-unlock'),
            z.literal('session-lock'),
            z.literal('clipboard-redaction'),
            z.literal('secret-rotation'),
            z.literal('signed-bundles'),
            z.literal('immutable-backups'),
            z.literal('command-risk'),
            z.literal('process-history'),
            z.literal('disk-io-metrics'),
            z.literal('network-metrics'),
            z.literal('runbooks'),
            z.literal('multi-host-health'),
            z.literal('explorer-integration'),
            z.literal('terminal-layouts'),
            z.literal('shortcut-editor'),
            z.literal('command-macros'),
            z.literal('offline-pwa'),
            z.literal('accessibility-audit'),
            z.literal('locale-packs'),
            z.literal('self-update'),
            z.literal('api-explorer'),
          ]),
          name: z.string(),
          category: z.string(),
          priority: z.string(),
          summary: z.string(),
          state: z.union([z.literal('available'), z.literal('experimental'), z.literal('planned')]),
        })
        .strict(),
    ),
    operations: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          feature: z.string(),
          example: z.record(z.string(), jsonValueSchema),
          note: z.string(),
          writes: z.boolean(),
          schema: operationJsonSchema,
        })
        .strict(),
    ),
    capabilities: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          scope: z.union([z.literal('suite'), z.literal('extended'), z.literal('next')]),
          example: z.record(z.string(), jsonValueSchema),
          note: z.string(),
          requiresGuest: z.boolean(),
          writes: z.boolean(),
          schema: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    count: z.number(),
    generatedAt: z.string(),
  })
  .strict();

export const extensionsGetVmsVmIdExtendedFeaturesResponseSchema = z
  .object({
    projectId: z.string(),
    features: z.array(
      z
        .object({
          id: z.union([
            z.literal('ipv6'),
            z.literal('syscall-profile'),
            z.literal('ssh-agent-forward'),
            z.literal('gpg-agent-forward'),
            z.literal('project-quota'),
            z.literal('guest-quota'),
            z.literal('network-quota'),
            z.literal('egress-policy'),
            z.literal('power-aware-schedule'),
            z.literal('availability-report'),
            z.literal('audit-log'),
            z.literal('cpu-topology'),
            z.literal('device-profiles'),
            z.literal('resource-reservation'),
            z.literal('crash-loop-guard'),
            z.literal('maintenance-windows'),
            z.literal('patch-bundle'),
            z.literal('environment-recreate'),
            z.literal('editor-profiles'),
            z.literal('metrics-export'),
            z.literal('event-timeline'),
            z.literal('anomaly-detection'),
            z.literal('review-comments'),
            z.literal('command-forms'),
            z.literal('vm-dependency-start'),
            z.literal('environment-parity'),
            z.literal('test-matrix'),
            z.literal('cross-vm-copy'),
            z.literal('packet-capture'),
            z.literal('reverse-tunnel'),
            z.literal('vm-suspend'),
            z.literal('rescue-boot'),
            z.literal('qemu-commandline'),
            z.literal('guest-clock-policy'),
            z.literal('disk-encryption'),
            z.literal('qcow2-scrub'),
            z.literal('backup-dedup'),
            z.literal('cow-workspace'),
            z.literal('archive-wizard'),
            z.literal('posix-acl'),
            z.literal('secure-erase'),
            z.literal('hash-manifest'),
            z.literal('watch-sync'),
            z.literal('sync-window'),
            z.literal('rename-detection'),
            z.literal('case-conflict-report'),
            z.literal('sync-queue'),
            z.literal('path-sync-policy'),
            z.literal('sync-rollback'),
            z.literal('merge-drivers'),
            z.literal('multi-host-view'),
            z.literal('project-onboarding'),
            z.literal('task-import'),
            z.literal('env-schema'),
            z.literal('shell-profiles'),
            z.literal('toolchain-check'),
            z.literal('bootstrap-dry-run'),
            z.literal('project-template-pack'),
            z.literal('git-stash'),
            z.literal('git-reflog'),
            z.literal('git-rebase'),
            z.literal('git-bisect'),
            z.literal('git-cherry-pick'),
            z.literal('git-policy'),
            z.literal('precommit-secrets'),
            z.literal('code-ownership'),
            z.literal('flaky-tests'),
            z.literal('coverage-history'),
            z.literal('benchmark-regression'),
            z.literal('sbom'),
            z.literal('license-report'),
            z.literal('release-gates'),
            z.literal('artifact-provenance'),
            z.literal('changelog'),
            z.literal('reproducible-build'),
            z.literal('static-routes'),
            z.literal('network-isolation'),
            z.literal('local-dns-alias'),
            z.literal('tpm-secure-boot'),
            z.literal('hello-unlock'),
            z.literal('session-lock'),
            z.literal('clipboard-redaction'),
            z.literal('secret-rotation'),
            z.literal('signed-bundles'),
            z.literal('immutable-backups'),
            z.literal('command-risk'),
            z.literal('process-history'),
            z.literal('disk-io-metrics'),
            z.literal('network-metrics'),
            z.literal('runbooks'),
            z.literal('multi-host-health'),
            z.literal('explorer-integration'),
            z.literal('terminal-layouts'),
            z.literal('shortcut-editor'),
            z.literal('command-macros'),
            z.literal('offline-pwa'),
            z.literal('accessibility-audit'),
            z.literal('locale-packs'),
            z.literal('self-update'),
            z.literal('api-explorer'),
          ]),
          name: z.string(),
          category: z.string(),
          priority: z.string(),
          summary: z.string(),
          state: z.union([z.literal('available'), z.literal('experimental'), z.literal('planned')]),
        })
        .strict(),
    ),
    operations: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          feature: z.string(),
          example: z.record(z.string(), jsonValueSchema),
          note: z.string(),
          writes: z.boolean(),
          schema: operationJsonSchema,
        })
        .strict(),
    ),
    capabilities: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          scope: z.union([z.literal('suite'), z.literal('extended'), z.literal('next')]),
          example: z.record(z.string(), jsonValueSchema),
          note: z.string(),
          requiresGuest: z.boolean(),
          writes: z.boolean(),
          schema: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    settings: z.record(
      z.string(),
      z
        .object({
          enabled: z.boolean(),
          options: z.record(z.string(), jsonValueSchema),
          updatedAt: z.string(),
        })
        .strict(),
    ),
    manifest: z
      .object({ createdAt: z.string(), path: z.string(), entries: z.number(), checksum: z.string() })
      .strict()
      .optional(),
    executions: z.array(
      z
        .object({
          featureId: z.union([
            z.literal('ipv6'),
            z.literal('syscall-profile'),
            z.literal('ssh-agent-forward'),
            z.literal('gpg-agent-forward'),
            z.literal('project-quota'),
            z.literal('guest-quota'),
            z.literal('network-quota'),
            z.literal('egress-policy'),
            z.literal('power-aware-schedule'),
            z.literal('availability-report'),
            z.literal('audit-log'),
            z.literal('cpu-topology'),
            z.literal('device-profiles'),
            z.literal('resource-reservation'),
            z.literal('crash-loop-guard'),
            z.literal('maintenance-windows'),
            z.literal('patch-bundle'),
            z.literal('environment-recreate'),
            z.literal('editor-profiles'),
            z.literal('metrics-export'),
            z.literal('event-timeline'),
            z.literal('anomaly-detection'),
            z.literal('review-comments'),
            z.literal('command-forms'),
            z.literal('vm-dependency-start'),
            z.literal('environment-parity'),
            z.literal('test-matrix'),
            z.literal('cross-vm-copy'),
            z.literal('packet-capture'),
            z.literal('reverse-tunnel'),
            z.literal('vm-suspend'),
            z.literal('rescue-boot'),
            z.literal('qemu-commandline'),
            z.literal('guest-clock-policy'),
            z.literal('disk-encryption'),
            z.literal('qcow2-scrub'),
            z.literal('backup-dedup'),
            z.literal('cow-workspace'),
            z.literal('archive-wizard'),
            z.literal('posix-acl'),
            z.literal('secure-erase'),
            z.literal('hash-manifest'),
            z.literal('watch-sync'),
            z.literal('sync-window'),
            z.literal('rename-detection'),
            z.literal('case-conflict-report'),
            z.literal('sync-queue'),
            z.literal('path-sync-policy'),
            z.literal('sync-rollback'),
            z.literal('merge-drivers'),
            z.literal('multi-host-view'),
            z.literal('project-onboarding'),
            z.literal('task-import'),
            z.literal('env-schema'),
            z.literal('shell-profiles'),
            z.literal('toolchain-check'),
            z.literal('bootstrap-dry-run'),
            z.literal('project-template-pack'),
            z.literal('git-stash'),
            z.literal('git-reflog'),
            z.literal('git-rebase'),
            z.literal('git-bisect'),
            z.literal('git-cherry-pick'),
            z.literal('git-policy'),
            z.literal('precommit-secrets'),
            z.literal('code-ownership'),
            z.literal('flaky-tests'),
            z.literal('coverage-history'),
            z.literal('benchmark-regression'),
            z.literal('sbom'),
            z.literal('license-report'),
            z.literal('release-gates'),
            z.literal('artifact-provenance'),
            z.literal('changelog'),
            z.literal('reproducible-build'),
            z.literal('static-routes'),
            z.literal('network-isolation'),
            z.literal('local-dns-alias'),
            z.literal('tpm-secure-boot'),
            z.literal('hello-unlock'),
            z.literal('session-lock'),
            z.literal('clipboard-redaction'),
            z.literal('secret-rotation'),
            z.literal('signed-bundles'),
            z.literal('immutable-backups'),
            z.literal('command-risk'),
            z.literal('process-history'),
            z.literal('disk-io-metrics'),
            z.literal('network-metrics'),
            z.literal('runbooks'),
            z.literal('multi-host-health'),
            z.literal('explorer-integration'),
            z.literal('terminal-layouts'),
            z.literal('shortcut-editor'),
            z.literal('command-macros'),
            z.literal('offline-pwa'),
            z.literal('accessibility-audit'),
            z.literal('locale-packs'),
            z.literal('self-update'),
            z.literal('api-explorer'),
          ]),
          action: z.union([z.literal('check'), z.literal('run')]),
          startedAt: z.string(),
          finishedAt: z.string(),
          ready: z.boolean(),
          result: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    jobs: z.array(jobViewSchema),
  })
  .strict();

export const extensionsPostVmsVmIdExtendedFeaturesResponseSchema = z.union([
  jobViewSchema,
  z
    .object({ enabled: z.boolean(), options: z.record(z.string(), jsonValueSchema), updatedAt: z.string() })
    .strict(),
  z.object({ ready: z.boolean() }).catchall(jsonValueSchema),
]);

export const filesGetVmsVmIdFilesResponseSchema = fileListingSchema;

export const filesGetVmsVmIdFileResponseSchema = z
  .object({ content: z.string(), version: z.string() })
  .strict();

export const filesPutVmsVmIdFileResponseSchema = z.object({ ok: z.boolean(), version: z.string() }).strict();

export const filesGetVmsVmIdFileLockResponseSchema = z
  .object({ path: z.string(), locked: z.boolean(), expiresAt: z.union([z.null(), z.string()]) })
  .strict();

export const filesPostVmsVmIdFileLockResponseSchema = z.union([
  z.object({ path: z.string(), token: z.string(), expiresAt: z.string() }).strict(),
  z.union([
    z.object({ path: z.string(), expiresAt: z.string() }).strict(),
    z.object({ released: z.string() }).strict(),
  ]),
]);

export const filesGetVmsVmIdHistoryResponseSchema = z.union([
  z
    .object({
      entry: z
        .object({
          id: z.string(),
          path: z.string(),
          kind: z.union([z.literal('version'), z.literal('trash')]),
          createdAt: z.string(),
          bytes: z.number(),
          ready: z.boolean(),
          version: z.string().optional(),
        })
        .strict(),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      items: z.array(
        z
          .object({
            id: z.string(),
            path: z.string(),
            kind: z.union([z.literal('version'), z.literal('trash')]),
            createdAt: z.string(),
            bytes: z.number(),
            ready: z.boolean(),
            version: z.string().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
]);

export const filesPostVmsVmIdHistoryResponseSchema = z.union([
  z.object({ ok: z.boolean(), path: z.string() }).strict(),
  z.object({ ok: z.boolean() }).strict(),
]);

export const filesPutVmsVmIdTransferResponseSchema = z.object({ bytes: z.number() }).strict();

export const filesPostVmsVmIdFileOperationResponseSchema = fileOperationSchema;

export const filesGetVmsVmIdUploadsResponseSchema = z
  .object({
    received: z.array(z.number()),
    chunkBytes: z.number(),
    path: z.string(),
    size: z.number(),
    chunks: z.array(z.string()),
    overwrite: z.boolean(),
    id: z.string(),
    vmId: z.string(),
    fingerprint: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    completed: z.object({ bytes: z.number(), sha256: z.string() }).strict().optional(),
    committing: z.object({ bytes: z.number(), sha256: z.string() }).strict().optional(),
  })
  .strict();

export const filesPostVmsVmIdUploadsResponseSchema = z.union([
  z
    .object({
      received: z.array(z.number()),
      chunkBytes: z.number(),
      path: z.string(),
      size: z.number(),
      chunks: z.array(z.string()),
      overwrite: z.boolean(),
      id: z.string(),
      vmId: z.string(),
      fingerprint: z.string(),
      createdAt: z.string(),
      expiresAt: z.string(),
      completed: z.object({ bytes: z.number(), sha256: z.string() }).strict().optional(),
      committing: z.object({ bytes: z.number(), sha256: z.string() }).strict().optional(),
    })
    .strict(),
  z.object({ bytes: z.number(), sha256: z.string() }).strict(),
]);

export const filesPutVmsVmIdUploadsResponseSchema = z
  .object({ index: z.number(), bytes: z.number() })
  .strict();

export const filesDeleteVmsVmIdUploadsResponseSchema = z.object({ removed: z.boolean() }).strict();

export const filesGetVmsVmIdFilePreviewResponseSchema = filePreviewSchema;

export const filesGetVmsVmIdDownloadChunksResponseSchema = z.union([
  z.object({ index: z.number(), bytes: z.number(), data: z.string(), sha256: z.string() }).strict(),
  z
    .object({
      path: z.string(),
      size: z.number(),
      chunkBytes: z.number(),
      sha256: z.string(),
      chunks: z.array(z.string()),
    })
    .strict(),
]);

export const gitGetVmsVmIdGitResponseSchema = z.union([
  z
    .object({
      path: z.string(),
      base: z.object({ mode: z.string(), oid: z.string() }).strict().nullable(),
      ours: z.object({ mode: z.string(), oid: z.string() }).strict().nullable(),
      theirs: z.object({ mode: z.string(), oid: z.string() }).strict().nullable(),
      worktree: z.string(),
      expectedIndex: z.string(),
      expectedWorktree: z.string(),
    })
    .strict(),
  z
    .object({
      path: z.string(),
      base: z.string(),
      ours: z.string(),
      theirs: z.string(),
      expectedVersion: z.string(),
      expectedIndex: z.string(),
    })
    .strict(),
  z.object({ diff: z.string(), truncated: z.boolean() }).strict(),
  z
    .object({
      projectId: z.string(),
      repository: z.boolean(),
      error: z.string(),
      changes: z.array(z.never()),
      branches: z.array(z.never()),
      history: z.array(z.never()),
      job: z.union([z.null(), jobViewSchema]),
    })
    .strict(),
  z
    .object({
      projectId: z.string(),
      repository: z.boolean(),
      branch: z.string(),
      detached: z.boolean(),
      hasCommits: z.boolean(),
      changes: z.array(
        z
          .object({
            path: z.string(),
            previous: z.string().optional(),
            index: z.string(),
            worktree: z.string(),
          })
          .strict(),
      ),
      conflicts: z.array(z.string()),
      operation: z.union([z.null(), z.string()]),
      upstream: z.union([
        z.null(),
        z.object({ name: z.string(), remote: z.string(), branch: z.string() }).strict(),
      ]),
      branches: z.array(z.string()),
      history: z.array(
        z
          .object({
            id: z.string(),
            short: z.string(),
            subject: z.string(),
            author: z.string(),
            date: z.string(),
          })
          .strict(),
      ),
      remotes: z.array(z.object({ name: z.string(), url: z.string(), kind: z.string() }).strict()),
      divergence: z.array(z.number()),
      job: z.union([z.null(), jobViewSchema]),
    })
    .strict(),
]);

export const ideGetVmsVmIdIdeResponseSchema = z.union([
  z
    .object({
      supported: z.boolean(),
      running: z.boolean(),
      vscodeSupported: z.boolean(),
      alias: z.string(),
      config: z.string(),
      command: z.string(),
      url: z.string(),
    })
    .strict(),
  z
    .object({
      supported: z.boolean(),
      vscodeSupported: z.boolean(),
      running: z.boolean(),
      projectScoped: z.boolean(),
      projectId: z.string(),
      networkIsolation: z.union([z.literal('host'), z.literal('private')]),
      runtime: z
        .object({
          present: z.boolean(),
          running: z.boolean(),
          valid: z.boolean(),
          processes: z.number(),
          reason: z.union([z.null(), z.string()]),
          daemon: z
            .object({ pid: z.number(), startTicks: z.string(), bootId: z.string(), cgroupName: z.string() })
            .strict()
            .optional(),
        })
        .strict(),
      alias: z.string(),
      config: z.string(),
      command: z.string(),
      sshCommand: z.string(),
      url: z.string(),
    })
    .strict(),
]);

export const imagesGetImagesResponseSchema = z.array(
  z
    .object({
      id: z.string(),
      name: z.union([
        z.literal('Alpine 3.23'),
        z.literal('Debian 12'),
        z.literal('Debian 12 ARM64'),
        z.literal('Ubuntu 24.04 LTS'),
      ]),
      ready: z.boolean(),
      minimumMemory: z.union([z.literal(256), z.literal(1024)]),
      minimumDisk: z.union([z.literal(2), z.literal(4)]),
      job: z.union([z.null(), jobViewSchema]),
    })
    .strict(),
);

export const imagesPostImageImportResponseSchema = z
  .object({
    vm: vmViewSchema,
    source: z
      .object({
        member: z.string().optional(),
        format: z.union([z.literal('raw'), z.literal('vmdk'), z.literal('vhdx'), z.literal('ova')]),
        bytes: z.number(),
        sha256: z.string(),
        virtualBytes: z.number(),
      })
      .strict(),
  })
  .strict();

export const libraryPostVmsBatchResponseSchema = z
  .object({
    results: z.array(
      z.union([
        z.object({ id: z.string(), ok: z.boolean() }).strict(),
        z.object({ id: z.string(), ok: z.boolean(), error: z.string() }).strict(),
      ]),
    ),
  })
  .strict();

export const maintenanceGetStorageResponseSchema = z
  .object({
    total: z.number(),
    available: z.number(),
    images: z.array(
      z
        .object({
          id: z.string(),
          name: z.union([
            z.literal('Alpine 3.23'),
            z.literal('Debian 12'),
            z.literal('Debian 12 ARM64'),
            z.literal('Ubuntu 24.04 LTS'),
          ]),
          bytes: z.number(),
        })
        .strict(),
    ),
    backupBytes: z.number(),
    deduplicatedBackups: z
      .object({
        backups: z.number(),
        logicalBytes: z.number(),
        physicalBytes: z.number(),
        referencedBytes: z.number(),
        savedBytes: z.number(),
        orphanBytes: z.number(),
        reclaimedBytes: z.number(),
        chunkCount: z.number(),
        blockSize: z.number(),
      })
      .strict(),
    machines: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          bytes: z.number(),
          capacity: z.number(),
          snapshots: z.number(),
          pendingResize: z.boolean(),
        })
        .strict(),
    ),
    warning: z.string(),
  })
  .strict();

export const maintenanceGetVmsVmIdDiagnosticsResponseSchema = z
  .object({
    report: z.union([
      z.null(),
      z
        .object({
          createdAt: z.string(),
          checks: z.array(
            z
              .object({
                name: z.string(),
                status: z.union([
                  z.literal('error'),
                  z.literal('warning'),
                  z.literal('ok'),
                  z.literal('skip'),
                ]),
                detail: z.string(),
                suggestion: z.string().optional(),
              })
              .strict(),
          ),
          log: z.string(),
        })
        .strict(),
    ]),
    job: z.union([z.null(), jobViewSchema]),
  })
  .strict();

export const maintenancePostVmsVmIdResizeResponseSchema = z.union([jobViewSchema.optional(), jobViewSchema]);

export const maintenanceGetVmsVmIdDiskMaintenanceResponseSchema = z
  .object({
    job: z.union([z.null(), jobViewSchema]),
    maintenance: z.boolean(),
    policy: z
      .object({
        enabled: z.boolean(),
        intervalHours: z.number(),
        mode: z.union([z.literal('trim'), z.literal('compact'), z.literal('both')]),
        compress: z.boolean(),
      })
      .strict(),
    attempts: z
      .object({
        trim: z
          .object({
            startedAt: z.string(),
            finishedAt: z.string().optional(),
            error: z.string().optional(),
            result: z.record(z.string(), jsonValueSchema).optional(),
          })
          .strict()
          .optional(),
        compact: z
          .object({
            startedAt: z.string(),
            finishedAt: z.string().optional(),
            error: z.string().optional(),
            result: z.record(z.string(), jsonValueSchema).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    successes: z.object({ trim: z.string().optional(), compact: z.string().optional() }).strict(),
  })
  .strict();

export const maintenancePutVmsVmIdDiskMaintenanceResponseSchema = z
  .object({
    policy: z
      .object({
        enabled: z.boolean(),
        intervalHours: z.number(),
        mode: z.union([z.literal('trim'), z.literal('compact'), z.literal('both')]),
        compress: z.boolean(),
      })
      .strict(),
    attempts: z
      .object({
        trim: z
          .object({
            startedAt: z.string(),
            finishedAt: z.string().optional(),
            error: z.string().optional(),
            result: z.record(z.string(), jsonValueSchema).optional(),
          })
          .strict()
          .optional(),
        compact: z
          .object({
            startedAt: z.string(),
            finishedAt: z.string().optional(),
            error: z.string().optional(),
            result: z.record(z.string(), jsonValueSchema).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    successes: z.object({ trim: z.string().optional(), compact: z.string().optional() }).strict(),
  })
  .strict();

export const migrationGetMigrationResponseSchema = z
  .object({
    source: z.string(),
    target: z.string().optional(),
    restartRequired: z.boolean(),
    blocked: z.boolean(),
    job: z.union([z.null(), jobViewSchema]),
    previous: z.null(),
  })
  .strict();

export const migrationPostMigrationResponseSchema = z.union([
  z
    .object({
      source: z.string(),
      target: z.string().optional(),
      restartRequired: z.boolean(),
      blocked: z.boolean(),
      job: z.union([z.null(), jobViewSchema]),
      previous: z.null(),
    })
    .strict(),
  z
    .object({
      source: z.string(),
      target: z.string(),
      bytes: z.number(),
      available: z.number(),
      count: z.number(),
      token: z.string(),
    })
    .strict(),
  jobViewSchema,
]);

export const networkGetNetworkProfilesResponseSchema = z.array(
  z
    .object({
      id: z.string(),
      name: z.string(),
      config: z
        .object({
          dnsServers: z.array(z.string()),
          dnsDomains: z.array(z.string()),
          dnssec: z.union([
            z.literal('no'),
            z.literal('yes'),
            z.literal('inherit'),
            z.literal('allow-downgrade'),
          ]),
          httpProxy: z.string(),
          httpsProxy: z.string(),
          noProxy: z.string(),
          npmRegistry: z.string(),
          pipIndex: z.string(),
          apkMirror: z.string(),
          aptMirror: z.string(),
          aptSecurityMirror: z.string(),
          forwards: z
            .array(z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict())
            .optional(),
          dependencyDownloads: z
            .object({
              npm: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
              pip: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
              git: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      updatedAt: z.string(),
    })
    .strict(),
);

export const networkPostNetworkProfilesResponseSchema = z
  .object({
    id: z.string(),
    updatedAt: z.string(),
    name: z.string(),
    config: z
      .object({
        dnsServers: z.array(z.string()),
        dnsDomains: z.array(z.string()),
        dnssec: z.union([
          z.literal('no'),
          z.literal('yes'),
          z.literal('inherit'),
          z.literal('allow-downgrade'),
        ]),
        httpProxy: z.string(),
        httpsProxy: z.string(),
        noProxy: z.string(),
        npmRegistry: z.string(),
        pipIndex: z.string(),
        apkMirror: z.string(),
        aptMirror: z.string(),
        aptSecurityMirror: z.string(),
        forwards: z
          .array(z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict())
          .optional(),
        dependencyDownloads: z
          .object({
            npm: z
              .union([
                z
                  .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                  .strict(),
                z
                  .object({
                    kind: z.literal('basic'),
                    endpoint: z.string(),
                    username: z.string(),
                    passwordSecret: z.string(),
                  })
                  .strict(),
              ])
              .optional(),
            pip: z
              .union([
                z
                  .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                  .strict(),
                z
                  .object({
                    kind: z.literal('basic'),
                    endpoint: z.string(),
                    username: z.string(),
                    passwordSecret: z.string(),
                  })
                  .strict(),
              ])
              .optional(),
            git: z
              .union([
                z
                  .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                  .strict(),
                z
                  .object({
                    kind: z.literal('basic'),
                    endpoint: z.string(),
                    username: z.string(),
                    passwordSecret: z.string(),
                  })
                  .strict(),
              ])
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export const networkDeleteNetworkProfilesResponseSchema = z.object({ removed: z.string() }).strict();

export const networkGetVmsVmIdNetworkResponseSchema = z
  .object({
    job: z.union([z.null(), jobViewSchema]),
    config: z
      .object({
        dnsServers: z.array(z.string()),
        dnsDomains: z.array(z.string()),
        dnssec: z.union([
          z.literal('no'),
          z.literal('yes'),
          z.literal('inherit'),
          z.literal('allow-downgrade'),
        ]),
        httpProxy: z.string(),
        httpsProxy: z.string(),
        noProxy: z.string(),
        npmRegistry: z.string(),
        pipIndex: z.string(),
        apkMirror: z.string(),
        aptMirror: z.string(),
        aptSecurityMirror: z.string(),
        forwards: z
          .array(z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict())
          .optional(),
        dependencyDownloads: z
          .object({
            npm: z
              .union([
                z
                  .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                  .strict(),
                z
                  .object({
                    kind: z.literal('basic'),
                    endpoint: z.string(),
                    username: z.string(),
                    passwordSecret: z.string(),
                  })
                  .strict(),
              ])
              .optional(),
            pip: z
              .union([
                z
                  .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                  .strict(),
                z
                  .object({
                    kind: z.literal('basic'),
                    endpoint: z.string(),
                    username: z.string(),
                    passwordSecret: z.string(),
                  })
                  .strict(),
              ])
              .optional(),
            git: z
              .union([
                z
                  .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                  .strict(),
                z
                  .object({
                    kind: z.literal('basic'),
                    endpoint: z.string(),
                    username: z.string(),
                    passwordSecret: z.string(),
                  })
                  .strict(),
              ])
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    changes: z.array(
      z.object({ path: z.string(), before: z.union([z.null(), z.string()]), after: z.string() }).strict(),
    ),
    forwards: z
      .object({
        before: z.array(
          z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict(),
        ),
        after: z.array(
          z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict(),
        ),
      })
      .strict()
      .optional(),
    dnsBackend: z.literal('resolved').optional(),
    resolverLink: z.object({ before: z.string(), after: z.string() }).strict().optional(),
    appliedAt: z.string().optional(),
  })
  .strict();

export const networkPostVmsVmIdNetworkResponseSchema = z.union([
  jobViewSchema,
  z
    .object({
      config: z
        .object({
          dnsServers: z.array(z.string()),
          dnsDomains: z.array(z.string()),
          dnssec: z.union([
            z.literal('no'),
            z.literal('yes'),
            z.literal('inherit'),
            z.literal('allow-downgrade'),
          ]),
          httpProxy: z.string(),
          httpsProxy: z.string(),
          noProxy: z.string(),
          npmRegistry: z.string(),
          pipIndex: z.string(),
          apkMirror: z.string(),
          aptMirror: z.string(),
          aptSecurityMirror: z.string(),
          forwards: z
            .array(z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict())
            .optional(),
          dependencyDownloads: z
            .object({
              npm: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
              pip: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
              git: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      changes: z.array(
        z.object({ path: z.string(), before: z.union([z.null(), z.string()]), after: z.string() }).strict(),
      ),
      forwards: z
        .object({
          before: z.array(
            z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict(),
          ),
          after: z.array(
            z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict(),
          ),
        })
        .strict()
        .optional(),
      dnsBackend: z.literal('resolved').optional(),
      resolverLink: z.object({ before: z.string(), after: z.string() }).strict().optional(),
      token: z.string(),
    })
    .strict(),
  z
    .object({
      config: z
        .object({
          dnsServers: z.array(z.string()),
          dnsDomains: z.array(z.string()),
          dnssec: z.union([
            z.literal('no'),
            z.literal('yes'),
            z.literal('inherit'),
            z.literal('allow-downgrade'),
          ]),
          httpProxy: z.string(),
          httpsProxy: z.string(),
          noProxy: z.string(),
          npmRegistry: z.string(),
          pipIndex: z.string(),
          apkMirror: z.string(),
          aptMirror: z.string(),
          aptSecurityMirror: z.string(),
          forwards: z
            .array(z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict())
            .optional(),
          dependencyDownloads: z
            .object({
              npm: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
              pip: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
              git: z
                .union([
                  z
                    .object({ kind: z.literal('bearer'), endpoint: z.string(), tokenSecret: z.string() })
                    .strict(),
                  z
                    .object({
                      kind: z.literal('basic'),
                      endpoint: z.string(),
                      username: z.string(),
                      passwordSecret: z.string(),
                    })
                    .strict(),
                ])
                .optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      changes: z.array(
        z.object({ path: z.string(), before: z.union([z.null(), z.string()]), after: z.string() }).strict(),
      ),
      forwards: z
        .object({
          before: z.array(
            z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict(),
          ),
          after: z.array(
            z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict(),
          ),
        })
        .strict()
        .optional(),
      dnsBackend: z.literal('resolved').optional(),
      resolverLink: z.object({ before: z.string(), after: z.string() }).strict().optional(),
      appliedAt: z.string().optional(),
    })
    .strict(),
]);

export const networkGetVmsVmIdServicesResponseSchema = z
  .object({
    forwards: z.array(
      z
        .object({ listening: z.boolean(), host: z.number(), guest: z.number(), name: z.string().optional() })
        .strict(),
    ),
    listening: z.array(z.number()),
  })
  .strict();

const pipelineStepResponseSchema = z.object({ name: z.string(), command: z.string(), timeout: z.number(),
  id: z.string().optional(), dependsOn: z.array(z.string()).optional(), rerunnable: z.boolean().optional() }).strict();
export const pipelinesGetVmsVmIdPipelinesResponseSchema = z
  .object({
    projectId: z.string(),
    pipelines: z.array(
      z
        .object({
          name: z.string(),
          steps: z.array(pipelineStepResponseSchema),
          maxConcurrency: z.number().optional(),
          inputs: z.array(z.string()).optional(),
          artifacts: z.array(z.string()),
          id: z.string(),
        })
        .strict(),
    ),
    runs: z.array(
      z
        .object({
          id: z.string(),
          pipelineId: z.string(),
          sourceRunId: z.string().optional(),
          selectedStepIds: z.array(z.string()).optional(),
          fingerprint: z.string().optional(),
          rerunUnavailable: z.string().optional(),
          name: z.string(),
          projectId: z.string(),
          startedAt: z.string(),
          finishedAt: z.string().optional(),
          status: z.union([
            z.literal('running'),
            z.literal('error'),
            z.literal('cancelled'),
            z.literal('interrupted'),
            z.literal('done'),
          ]),
          error: z.string().optional(),
          errorCode: z.string().optional(),
          steps: z.array(
            z
              .object({
                name: z.string(),
                id: z.string().optional(),
                dependsOn: z.array(z.string()).optional(),
                blockedReason: z.string().optional(),
                status: z.union([
                  z.literal('running'),
                  z.literal('error'),
                  z.literal('cancelled'),
                  z.literal('done'),
                  z.literal('pending'),
                ]),
                startedAt: z.string().optional(),
                finishedAt: z.string().optional(),
                code: z.number().optional(),
                errorCode: z.string().optional(),
                log: z.string(),
              })
              .strict(),
          ),
          artifacts: z.array(z.object({ name: z.string(), bytes: z.number(), index: z.number() }).strict()),
        })
        .strict(),
    ),
    job: z.union([z.null(), jobViewSchema]),
  })
  .strict();

export const pipelinesPutVmsVmIdPipelinesResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    steps: z.array(pipelineStepResponseSchema),
    maxConcurrency: z.number().optional(),
    inputs: z.array(z.string()).optional(),
    artifacts: z.array(z.string()),
  })
  .strict();

export const pipelinesDeleteVmsVmIdPipelinesResponseSchema = z.object({ ok: z.boolean() }).strict();

export const platformGetNextFeaturesResponseSchema = z
  .object({
    features: z.array(
      z
        .object({
          id: z.union([
            z.literal('process-interop'),
            z.literal('gpu-compute-passthrough'),
            z.literal('pci-usb-passthrough'),
            z.literal('vtpm-key-enrollment'),
            z.literal('service-mesh'),
            z.literal('acme-renewal'),
            z.literal('team-templates'),
            z.literal('wireguard-overlay'),
            z.literal('object-backup'),
            z.literal('storage-pools'),
            z.literal('storage-tiering'),
            z.literal('disaster-recovery-drill'),
            z.literal('authenticated-ide-preview'),
            z.literal('notebook-environment'),
            z.literal('cross-host-snapshots'),
            z.literal('maintenance-drain'),
            z.literal('cold-migration'),
            z.literal('ebpf-profiler'),
            z.literal('flamegraph'),
            z.literal('network-emulation'),
            z.literal('nat-hairpin'),
            z.literal('host-disk-health'),
            z.literal('global-dedup'),
            z.literal('otel-tracing'),
            z.literal('dependency-bot'),
            z.literal('vcpu-hotplug'),
            z.literal('memory-hotplug'),
            z.literal('schema-panels'),
            z.literal('compliance-evidence'),
            z.literal('proxy-pac'),
            z.literal('build-cache'),
            z.literal('branch-preview'),
            z.literal('onboarding-checklist'),
            z.literal('review-threads'),
            z.literal('activity-digest'),
            z.literal('slo-dashboard'),
            z.literal('error-budget'),
            z.literal('capacity-forecast'),
            z.literal('log-index'),
            z.literal('test-sharding'),
            z.literal('network-topology'),
            z.literal('code-search-index'),
            z.literal('language-server-catalog'),
            z.literal('pii-classification'),
            z.literal('host-pairing'),
            z.literal('host-cert-rotation'),
            z.literal('multi-host-inventory'),
            z.literal('live-migration'),
            z.literal('resource-scheduler'),
            z.literal('ha-failover'),
            z.literal('fleet-policy-rollout'),
            z.literal('uefi-ovmf'),
            z.literal('gpu-vgpu-profiles'),
            z.literal('nested-virtualization'),
            z.literal('virtio-fs'),
            z.literal('virtual-media-devices'),
            z.literal('hardware-compatibility'),
            z.literal('snapshot-merge'),
            z.literal('file-level-restore'),
            z.literal('backup-throttle'),
            z.literal('rpo-rto-planner'),
            z.literal('private-dns-dnssec'),
            z.literal('http-ingress'),
            z.literal('mtls-policy'),
            z.literal('passkey-webauthn'),
            z.literal('oidc-saml'),
            z.literal('custom-rbac'),
            z.literal('jit-privilege'),
            z.literal('dual-approval'),
            z.literal('signed-policy-bundles'),
            z.literal('remote-audit-lock'),
            z.literal('incident-lockdown'),
            z.literal('log-retention'),
            z.literal('alert-routing'),
            z.literal('auto-remediation'),
            z.literal('build-farm'),
            z.literal('devcontainer-marketplace'),
            z.literal('local-ai-assistant'),
            z.literal('natural-command-planner'),
            z.literal('shared-terminal'),
            z.literal('shared-desktop-view'),
            z.literal('session-handoff'),
            z.literal('file-locks'),
            z.literal('project-permissions'),
            z.literal('change-approval'),
            z.literal('host-drive-policy'),
            z.literal('file-associations'),
            z.literal('clipboard-policy'),
            z.literal('media-passthrough'),
            z.literal('usb-hotplug'),
            z.literal('desktop-recording'),
            z.literal('plugin-marketplace'),
            z.literal('signed-plugin-sandbox'),
            z.literal('graphql-api'),
            z.literal('webhook-events'),
            z.literal('automation-dsl'),
            z.literal('mobile-companion'),
            z.literal('browser-extension'),
            z.literal('tray-companion'),
            z.literal('feature-rollout'),
          ]),
          name: z.string(),
          category: z.string(),
          priority: z.string(),
          summary: z.string(),
          state: z.union([z.literal('available'), z.literal('experimental'), z.literal('planned')]),
        })
        .strict(),
    ),
    capabilities: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          scope: z.union([z.literal('suite'), z.literal('extended'), z.literal('next')]),
          example: z.record(z.string(), jsonValueSchema),
          note: z.string(),
          requiresGuest: z.boolean(),
          writes: z.boolean(),
          schema: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    count: z.number(),
    generatedAt: z.string(),
  })
  .strict();

export const platformGetVmsVmIdNextFeaturesResponseSchema = z
  .object({
    projectId: z.string(),
    features: z.array(
      z
        .object({
          id: z.union([
            z.literal('process-interop'),
            z.literal('gpu-compute-passthrough'),
            z.literal('pci-usb-passthrough'),
            z.literal('vtpm-key-enrollment'),
            z.literal('service-mesh'),
            z.literal('acme-renewal'),
            z.literal('team-templates'),
            z.literal('wireguard-overlay'),
            z.literal('object-backup'),
            z.literal('storage-pools'),
            z.literal('storage-tiering'),
            z.literal('disaster-recovery-drill'),
            z.literal('authenticated-ide-preview'),
            z.literal('notebook-environment'),
            z.literal('cross-host-snapshots'),
            z.literal('maintenance-drain'),
            z.literal('cold-migration'),
            z.literal('ebpf-profiler'),
            z.literal('flamegraph'),
            z.literal('network-emulation'),
            z.literal('nat-hairpin'),
            z.literal('host-disk-health'),
            z.literal('global-dedup'),
            z.literal('otel-tracing'),
            z.literal('dependency-bot'),
            z.literal('vcpu-hotplug'),
            z.literal('memory-hotplug'),
            z.literal('schema-panels'),
            z.literal('compliance-evidence'),
            z.literal('proxy-pac'),
            z.literal('build-cache'),
            z.literal('branch-preview'),
            z.literal('onboarding-checklist'),
            z.literal('review-threads'),
            z.literal('activity-digest'),
            z.literal('slo-dashboard'),
            z.literal('error-budget'),
            z.literal('capacity-forecast'),
            z.literal('log-index'),
            z.literal('test-sharding'),
            z.literal('network-topology'),
            z.literal('code-search-index'),
            z.literal('language-server-catalog'),
            z.literal('pii-classification'),
            z.literal('host-pairing'),
            z.literal('host-cert-rotation'),
            z.literal('multi-host-inventory'),
            z.literal('live-migration'),
            z.literal('resource-scheduler'),
            z.literal('ha-failover'),
            z.literal('fleet-policy-rollout'),
            z.literal('uefi-ovmf'),
            z.literal('gpu-vgpu-profiles'),
            z.literal('nested-virtualization'),
            z.literal('virtio-fs'),
            z.literal('virtual-media-devices'),
            z.literal('hardware-compatibility'),
            z.literal('snapshot-merge'),
            z.literal('file-level-restore'),
            z.literal('backup-throttle'),
            z.literal('rpo-rto-planner'),
            z.literal('private-dns-dnssec'),
            z.literal('http-ingress'),
            z.literal('mtls-policy'),
            z.literal('passkey-webauthn'),
            z.literal('oidc-saml'),
            z.literal('custom-rbac'),
            z.literal('jit-privilege'),
            z.literal('dual-approval'),
            z.literal('signed-policy-bundles'),
            z.literal('remote-audit-lock'),
            z.literal('incident-lockdown'),
            z.literal('log-retention'),
            z.literal('alert-routing'),
            z.literal('auto-remediation'),
            z.literal('build-farm'),
            z.literal('devcontainer-marketplace'),
            z.literal('local-ai-assistant'),
            z.literal('natural-command-planner'),
            z.literal('shared-terminal'),
            z.literal('shared-desktop-view'),
            z.literal('session-handoff'),
            z.literal('file-locks'),
            z.literal('project-permissions'),
            z.literal('change-approval'),
            z.literal('host-drive-policy'),
            z.literal('file-associations'),
            z.literal('clipboard-policy'),
            z.literal('media-passthrough'),
            z.literal('usb-hotplug'),
            z.literal('desktop-recording'),
            z.literal('plugin-marketplace'),
            z.literal('signed-plugin-sandbox'),
            z.literal('graphql-api'),
            z.literal('webhook-events'),
            z.literal('automation-dsl'),
            z.literal('mobile-companion'),
            z.literal('browser-extension'),
            z.literal('tray-companion'),
            z.literal('feature-rollout'),
          ]),
          name: z.string(),
          category: z.string(),
          priority: z.string(),
          summary: z.string(),
          state: z.union([z.literal('available'), z.literal('experimental'), z.literal('planned')]),
        })
        .strict(),
    ),
    capabilities: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          scope: z.union([z.literal('suite'), z.literal('extended'), z.literal('next')]),
          example: z.record(z.string(), jsonValueSchema),
          note: z.string(),
          requiresGuest: z.boolean(),
          writes: z.boolean(),
          schema: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    settings: z.record(
      z.string(),
      z
        .object({
          enabled: z.boolean(),
          options: z.record(z.string(), jsonValueSchema),
          updatedAt: z.string(),
        })
        .strict(),
    ),
    records: z.record(z.string(), jsonValueSchema),
    haFailoverMonitor: z.union([
      z.null(),
      z
        .object({
          suspected: z.boolean(),
          sampleIntervalSeconds: z.number(),
          armed: z.boolean(),
          consecutiveFailures: z.number(),
          observedState: z.union([
            z.literal('running'),
            z.literal('error'),
            z.literal('stopped'),
            z.literal('starting'),
            z.literal('paused'),
            z.literal('stopping'),
          ]),
          observedAt: z.string(),
          policyVersion: z.string().optional(),
          lastHealthyAt: z.string().optional(),
          suspectedAt: z.string().optional(),
        })
        .strict(),
    ]),
    haPromotion: z.union([
      z.null(),
      z
        .object({
          peerId: z.string(),
          targetHostId: z.string(),
          transferId: z.string(),
          remoteVmId: z.string(),
          snapshotId: z.string(),
          sha256: z.string(),
          fencedAt: z.string(),
          status: z.union([z.literal('fenced'), z.literal('accepted')]),
          updatedAt: z.string(),
          error: z.string().optional(),
        })
        .strict(),
    ]),
    haLocalFailover: z.union([z.null(), z.object({ error: z.union([z.null(), z.string()]) }).strict()]),
    haHostFailover: z.union([
      z.null(),
      z
        .object({
          configured: z.boolean(),
          armed: z.boolean(),
          phase: z.union([z.null(), z.string()]),
          targetVmId: z.union([z.null(), z.string()]),
          failback: z.union([z.null(), z.literal('pending'), z.literal('completed')]),
          recoveryHeld: z.boolean(),
          statusPending: z.boolean(),
          error: z.union([z.null(), z.string()]),
        })
        .strict(),
    ]),
    executions: z.array(
      z
        .object({
          featureId: z.union([
            z.literal('process-interop'),
            z.literal('gpu-compute-passthrough'),
            z.literal('pci-usb-passthrough'),
            z.literal('vtpm-key-enrollment'),
            z.literal('service-mesh'),
            z.literal('acme-renewal'),
            z.literal('team-templates'),
            z.literal('wireguard-overlay'),
            z.literal('object-backup'),
            z.literal('storage-pools'),
            z.literal('storage-tiering'),
            z.literal('disaster-recovery-drill'),
            z.literal('authenticated-ide-preview'),
            z.literal('notebook-environment'),
            z.literal('cross-host-snapshots'),
            z.literal('maintenance-drain'),
            z.literal('cold-migration'),
            z.literal('ebpf-profiler'),
            z.literal('flamegraph'),
            z.literal('network-emulation'),
            z.literal('nat-hairpin'),
            z.literal('host-disk-health'),
            z.literal('global-dedup'),
            z.literal('otel-tracing'),
            z.literal('dependency-bot'),
            z.literal('vcpu-hotplug'),
            z.literal('memory-hotplug'),
            z.literal('schema-panels'),
            z.literal('compliance-evidence'),
            z.literal('proxy-pac'),
            z.literal('build-cache'),
            z.literal('branch-preview'),
            z.literal('onboarding-checklist'),
            z.literal('review-threads'),
            z.literal('activity-digest'),
            z.literal('slo-dashboard'),
            z.literal('error-budget'),
            z.literal('capacity-forecast'),
            z.literal('log-index'),
            z.literal('test-sharding'),
            z.literal('network-topology'),
            z.literal('code-search-index'),
            z.literal('language-server-catalog'),
            z.literal('pii-classification'),
            z.literal('host-pairing'),
            z.literal('host-cert-rotation'),
            z.literal('multi-host-inventory'),
            z.literal('live-migration'),
            z.literal('resource-scheduler'),
            z.literal('ha-failover'),
            z.literal('fleet-policy-rollout'),
            z.literal('uefi-ovmf'),
            z.literal('gpu-vgpu-profiles'),
            z.literal('nested-virtualization'),
            z.literal('virtio-fs'),
            z.literal('virtual-media-devices'),
            z.literal('hardware-compatibility'),
            z.literal('snapshot-merge'),
            z.literal('file-level-restore'),
            z.literal('backup-throttle'),
            z.literal('rpo-rto-planner'),
            z.literal('private-dns-dnssec'),
            z.literal('http-ingress'),
            z.literal('mtls-policy'),
            z.literal('passkey-webauthn'),
            z.literal('oidc-saml'),
            z.literal('custom-rbac'),
            z.literal('jit-privilege'),
            z.literal('dual-approval'),
            z.literal('signed-policy-bundles'),
            z.literal('remote-audit-lock'),
            z.literal('incident-lockdown'),
            z.literal('log-retention'),
            z.literal('alert-routing'),
            z.literal('auto-remediation'),
            z.literal('build-farm'),
            z.literal('devcontainer-marketplace'),
            z.literal('local-ai-assistant'),
            z.literal('natural-command-planner'),
            z.literal('shared-terminal'),
            z.literal('shared-desktop-view'),
            z.literal('session-handoff'),
            z.literal('file-locks'),
            z.literal('project-permissions'),
            z.literal('change-approval'),
            z.literal('host-drive-policy'),
            z.literal('file-associations'),
            z.literal('clipboard-policy'),
            z.literal('media-passthrough'),
            z.literal('usb-hotplug'),
            z.literal('desktop-recording'),
            z.literal('plugin-marketplace'),
            z.literal('signed-plugin-sandbox'),
            z.literal('graphql-api'),
            z.literal('webhook-events'),
            z.literal('automation-dsl'),
            z.literal('mobile-companion'),
            z.literal('browser-extension'),
            z.literal('tray-companion'),
            z.literal('feature-rollout'),
          ]),
          action: z.union([z.literal('check'), z.literal('run')]),
          startedAt: z.string(),
          finishedAt: z.string(),
          ready: z.boolean(),
          executed: z.boolean(),
          result: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    jobs: z.array(jobViewSchema),
  })
  .strict();

export const platformPostVmsVmIdNextFeaturesResponseSchema = z.union([
  jobViewSchema,
  featureSettingSchema,
  capabilityResultSchema,
]);

export const projectSearchGetVmsVmIdProjectFilesResponseSchema = z
  .object({
    root: z.string(),
    files: z.array(z.object({ path: z.string(), directory: z.boolean(), size: z.number() }).strict()),
    matches: z.array(z.object({ path: z.string(), line: z.number(), text: z.string() }).strict()),
    scanned: z.number(),
    truncated: z.boolean(),
  })
  .strict();

export const projectsGetVmsVmIdProjectsResponseSchema = z
  .object({ active: z.string(), projects: z.array(z.object({ id: z.string(), name: z.string() }).strict()) })
  .strict();

export const projectsGetVmsVmIdProjectResponseSchema = z
  .object({
    project: z
      .object({
        directory: z.string(),
        template: z.union([z.literal('none'), z.literal('node'), z.literal('python'), z.literal('rust')]),
        repository: z.string(),
        setup: z.string(),
        command: z.string(),
        previewPort: z.number().optional(),
        networkIsolation: z.union([z.literal('host'), z.literal('private')]).optional(),
        environment: z.record(z.string(), z.string()).optional(),
        secrets: z.record(z.string(), z.string()).optional(),
        runtimes: z
          .object({ python: z.string().optional(), node: z.string().optional() })
          .strict()
          .optional(),
        services: z
          .array(
            z
              .object({
                name: z.string(),
                command: z.string(),
                dependsOn: z.array(z.string()),
                ready: z.string(),
                timeout: z.number(),
                environment: z.record(z.string(), z.string()).optional(),
                secrets: z.record(z.string(), z.string()).optional(),
                health: z
                  .object({
                    command: z.string(),
                    interval: z.number(),
                    timeout: z.number(),
                    failures: z.number(),
                    restart: z.boolean(),
                    maxRestarts: z.number(),
                    backoff: z.number(),
                  })
                  .strict()
                  .optional(),
              })
              .strict(),
          )
          .optional(),
        _workspace: z.string().optional(),
      })
      .strict(),
    version: z.string(),
    projectId: z.string(),
    job: z.union([z.null(), jobViewSchema]),
  })
  .strict();

export const projectsPutVmsVmIdProjectResponseSchema = z
  .object({
    directory: z.string(),
    template: z.union([z.literal('none'), z.literal('node'), z.literal('python'), z.literal('rust')]),
    repository: z.string(),
    setup: z.string(),
    command: z.string(),
    previewPort: z.number().optional(),
    networkIsolation: z.union([z.literal('host'), z.literal('private')]).optional(),
    environment: z.record(z.string(), z.string()).optional(),
    secrets: z.record(z.string(), z.string()).optional(),
    runtimes: z.object({ python: z.string().optional(), node: z.string().optional() }).strict().optional(),
    services: z
      .array(
        z
          .object({
            name: z.string(),
            command: z.string(),
            dependsOn: z.array(z.string()),
            ready: z.string(),
            timeout: z.number(),
            environment: z.record(z.string(), z.string()).optional(),
            secrets: z.record(z.string(), z.string()).optional(),
            health: z
              .object({
                command: z.string(),
                interval: z.number(),
                timeout: z.number(),
                failures: z.number(),
                restart: z.boolean(),
                maxRestarts: z.number(),
                backoff: z.number(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const projectsGetVmsVmIdProjectRuntimeResponseSchema = z
  .object({
    status: z.string(),
    log: z.string(),
    services: z
      .array(z.object({ name: z.string(), status: z.string(), log: z.string() }).strict())
      .optional(),
    main: z.object({ status: z.string() }).strict().optional(),
  })
  .strict();

export const projectsGetVmsVmIdProjectDirectoryMigrationResponseSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string(),
    plan: z.union([
      z.null(),
      z
        .object({
          version: z.literal(1),
          proposal: z
            .object({
              version: z.literal(1),
              planId: z.string(),
              createdAt: z.string(),
              vmId: z.string(),
              projectId: z.string(),
              bootId: z.string(),
              identity: z
                .object({
                  version: z.literal(1),
                  phase: z.union([z.literal('active'), z.literal('intent')]),
                  registryId: z.string(),
                  projectId: z.string(),
                  identityId: z.string(),
                  revision: z.number(),
                  account: z.string(),
                  uid: z.number(),
                  gid: z.number(),
                  home: z.string(),
                  directory: z.string(),
                  directoryDevice: z.string(),
                  directoryInode: z.string(),
                  homeDevice: z.string(),
                  homeInode: z.string(),
                  networkIsolation: z.union([z.literal('host'), z.literal('private')]),
                })
                .strict(),
              directory: z.string(),
              networkIsolation: z.union([z.literal('host'), z.literal('private')]),
              configSha256: z.string(),
              projectsSha256: z.string(),
              policy: z.literal('private-owner-v1'),
              entries: z.array(
                z
                  .object({
                    path: z.string(),
                    kind: z.union([z.literal('file'), z.literal('directory')]),
                    device: z.string(),
                    inode: z.string(),
                    mountId: z.string(),
                    filesystemId: z.string(),
                    uid: z.number(),
                    gid: z.number(),
                    mode: z.number(),
                    links: z.number(),
                    size: z.number(),
                    mtimeNs: z.string(),
                    ctimeNs: z.string(),
                    sha256: z.union([z.null(), z.string()]),
                    targetMode: z.number(),
                  })
                  .strict(),
              ),
              summary: z.object({ files: z.number(), directories: z.number(), bytes: z.number() }).strict(),
            })
            .strict(),
          sha256: z.string(),
          state: z.union([
            z.literal('failed'),
            z.literal('preview'),
            z.literal('applying'),
            z.literal('directory-applied'),
            z.literal('applied'),
          ]),
          completed: z.array(z.string()),
          attempt: z.union([z.null(), z.string()]),
          lastError: z.union([
            z.null(),
            z.object({ code: z.string(), path: z.string().optional() }).strict(),
          ]),
          activatedIdentity: z.union([
            z.null(),
            z
              .object({
                version: z.literal(1),
                phase: z.union([z.literal('active'), z.literal('intent')]),
                registryId: z.string(),
                projectId: z.string(),
                identityId: z.string(),
                revision: z.number(),
                account: z.string(),
                uid: z.number(),
                gid: z.number(),
                home: z.string(),
                directory: z.string(),
                directoryDevice: z.string(),
                directoryInode: z.string(),
                homeDevice: z.string(),
                homeInode: z.string(),
                networkIsolation: z.union([z.literal('host'), z.literal('private')]),
              })
              .strict(),
          ]),
        })
        .strict(),
    ]),
    lastFailure: z.union([
      z.null(),
      z.object({ code: z.string(), path: z.string().optional(), at: z.string() }).strict(),
    ]),
  })
  .strict();

export const recipesGetVmsVmIdRecipeResponseSchema = z
  .object({
    version: z.literal(1),
    resources: z
      .object({
        cpus: z.number().optional(),
        memoryMiB: z.number().optional(),
        diskGiB: z.number().optional(),
        accelerator: z.union([z.literal('auto'), z.literal('tcg'), z.literal('whpx')]).optional(),
        distro: z.union([z.literal('alpine'), z.literal('debian'), z.literal('ubuntu')]).optional(),
        template: z
          .union([z.literal('none'), z.literal('node'), z.literal('python'), z.literal('rust')])
          .optional(),
        forwards: z
          .array(z.object({ host: z.number(), guest: z.number(), name: z.string().optional() }).strict())
          .optional(),
      })
      .strict(),
    project: z
      .object({
        directory: z.string(),
        template: z.union([z.literal('none'), z.literal('node'), z.literal('python'), z.literal('rust')]),
        repository: z.string(),
        setup: z.string(),
        command: z.string(),
        previewPort: z.number().optional(),
        networkIsolation: z.union([z.literal('host'), z.literal('private')]).optional(),
        environment: z.record(z.string(), z.string()).optional(),
        secrets: z.record(z.string(), z.string()).optional(),
        runtimes: z
          .object({ python: z.string().optional(), node: z.string().optional() })
          .strict()
          .optional(),
        services: z
          .array(
            z
              .object({
                name: z.string(),
                command: z.string(),
                dependsOn: z.array(z.string()),
                ready: z.string(),
                timeout: z.number(),
                environment: z.record(z.string(), z.string()).optional(),
                secrets: z.record(z.string(), z.string()).optional(),
                health: z
                  .object({
                    command: z.string(),
                    interval: z.number(),
                    timeout: z.number(),
                    failures: z.number(),
                    restart: z.boolean(),
                    maxRestarts: z.number(),
                    backoff: z.number(),
                  })
                  .strict()
                  .optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
  })
  .strict();

export const runtimesGetVmsVmIdRuntimesResponseSchema = z
  .object({
    selected: z.object({ python: z.string().optional(), node: z.string().optional() }).strict(),
    declared: z.object({ node: z.string().optional(), python: z.string().optional() }).strict(),
    actual: z.object({ node: z.string(), python: z.string() }).strict(),
    mismatches: z.array(z.union([z.literal('node'), z.literal('python')])),
    probe: z
      .object({
        errorCode: z.string().optional(),
        state: z.union([
          z.literal('running'),
          z.literal('failed'),
          z.literal('stale'),
          z.literal('unprobed'),
          z.literal('cached'),
        ]),
        checkedAt: z.union([z.null(), z.string()]),
        configVersion: z.union([z.null(), z.string()]),
        bootId: z.union([z.null(), z.string()]),
      })
      .strict(),
    job: z.union([z.null(), jobViewSchema]),
  })
  .strict();

export const runtimesPostVmsVmIdRuntimesResponseSchema = z.union([
  z
    .object({
      selected: z.object({ python: z.string().optional(), node: z.string().optional() }).strict(),
      declared: z.object({ node: z.string().optional(), python: z.string().optional() }).strict(),
      actual: z.object({ node: z.string(), python: z.string() }).strict(),
      mismatches: z.array(z.union([z.literal('node'), z.literal('python')])),
      probe: z
        .object({
          errorCode: z.string().optional(),
          state: z.union([
            z.literal('running'),
            z.literal('failed'),
            z.literal('stale'),
            z.literal('unprobed'),
            z.literal('cached'),
          ]),
          checkedAt: z.union([z.null(), z.string()]),
          configVersion: z.union([z.null(), z.string()]),
          bootId: z.union([z.null(), z.string()]),
        })
        .strict(),
      job: z.union([z.null(), jobViewSchema]),
    })
    .strict(),
  z
    .object({
      directory: z.string(),
      template: z.union([z.literal('none'), z.literal('node'), z.literal('python'), z.literal('rust')]),
      repository: z.string(),
      setup: z.string(),
      command: z.string(),
      previewPort: z.number().optional(),
      networkIsolation: z.union([z.literal('host'), z.literal('private')]).optional(),
      environment: z.record(z.string(), z.string()).optional(),
      secrets: z.record(z.string(), z.string()).optional(),
      runtimes: z.object({ python: z.string().optional(), node: z.string().optional() }).strict().optional(),
      services: z
        .array(
          z
            .object({
              name: z.string(),
              command: z.string(),
              dependsOn: z.array(z.string()),
              ready: z.string(),
              timeout: z.number(),
              environment: z.record(z.string(), z.string()).optional(),
              secrets: z.record(z.string(), z.string()).optional(),
              health: z
                .object({
                  command: z.string(),
                  interval: z.number(),
                  timeout: z.number(),
                  failures: z.number(),
                  restart: z.boolean(),
                  maxRestarts: z.number(),
                  backoff: z.number(),
                })
                .strict()
                .optional(),
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
  jobViewSchema,
]);

export const secretsGetVmsVmIdSecretsResponseSchema = z
  .object({ items: z.array(z.object({ name: z.string(), updatedAt: z.string() }).strict()) })
  .strict();

export const secretsPutVmsVmIdSecretsResponseSchema = z.array(
  z.object({ name: z.string(), updatedAt: z.string() }).strict(),
);

export const secretsGetVmsVmIdSecretRotationResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          name: z.string(),
          lastChangedAt: z.string(),
          policy: z
            .object({ enabled: z.boolean(), maxAgeDays: z.number(), remindBeforeDays: z.number() })
            .strict(),
          ageDays: z.union([z.null(), z.number()]),
          dueAt: z.union([z.null(), z.string()]),
          daysRemaining: z.union([z.null(), z.number()]),
          status: z.union([
            z.literal('unknown'),
            z.literal('current'),
            z.literal('disabled'),
            z.literal('due-soon'),
            z.literal('overdue'),
          ]),
        })
        .strict(),
    ),
  })
  .strict();

export const serviceHealthGetVmsVmIdHealthResponseSchema = z
  .object({
    services: z.array(
      z
        .object({
          name: z.string(),
          desired: z.boolean(),
          status: z.union([
            z.literal('stopped'),
            z.literal('healthy'),
            z.literal('unhealthy'),
            z.literal('waiting'),
            z.literal('restarting'),
            z.literal('exhausted'),
          ]),
          failures: z.number(),
          restarts: z.number(),
          checkedAt: z.string().optional(),
          nextCheck: z.number(),
          error: z.string().optional(),
        })
        .strict(),
    ),
    job: z.union([z.null(), jobViewSchema]),
  })
  .strict();

export const snapshotsPostVmsVmIdSnapshotsResponseSchema = z
  .object({
    stateFingerprint: z.string().optional(),
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    diskGiB: z.number(),
    pendingResize: z.boolean(),
    consistency: z.union([z.literal('vmstate'), z.literal('offline'), z.literal('filesystem')]),
  })
  .strict();

export const syncGetVmsVmIdSyncResponseSchema = z
  .object({
    projectId: z.string(),
    config: z.union([
      z.null(),
      z
        .object({
          host: z.string(),
          guest: z.string(),
          auto: z.boolean(),
          mergeText: z.boolean().optional(),
          detectRenames: z.boolean().optional(),
          rollback: z.boolean().optional(),
          watch: z.boolean().optional(),
          policies: z
            .array(
              z
                .object({
                  pattern: z.string(),
                  direction: z.union([
                    z.literal('readonly'),
                    z.literal('push'),
                    z.literal('both'),
                    z.literal('pull'),
                  ]),
                  guestMode: z.string().optional(),
                })
                .strict(),
            )
            .optional(),
          drivers: z
            .array(
              z
                .object({
                  pattern: z.string(),
                  mode: z.union([
                    z.literal('manual'),
                    z.literal('keep-both'),
                    z.literal('prefer-host'),
                    z.literal('prefer-guest'),
                    z.literal('merge-text'),
                  ]),
                })
                .strict(),
            )
            .optional(),
          window: z
            .object({ days: z.array(z.number()), start: z.string(), end: z.string(), timeZone: z.string() })
            .strict()
            .optional(),
          bandwidthMiBps: z.number().optional(),
          ignore: z.array(z.string()).optional(),
        })
        .strict(),
    ]),
    job: z.union([z.null(), jobViewSchema]),
    queue: z.union([
      z.null(),
      z
        .object({
          id: z.string(),
          requestedAt: z.string(),
          attempts: z.number(),
          nextAttemptAt: z.number(),
          jobId: z.string().optional(),
          lastError: z.string().optional(),
        })
        .strict(),
    ]),
    maintenance: z.boolean(),
    history: z.array(
      z
        .object({
          error: z.string().optional(),
          status: z.union([
            z.literal('failed'),
            z.literal('done'),
            z.literal('pending'),
            z.literal('rolled-back'),
          ]),
          id: z.string(),
          bytes: z.number(),
          createdAt: z.string(),
          changes: z.number(),
        })
        .strict(),
    ),
    watching: z.union([
      z.null(),
      z
        .object({
          host: z.union([z.literal('watching'), z.literal('polling')]),
          guest: z.union([z.literal('offline'), z.literal('watching'), z.literal('polling')]),
          reason: z.string().optional(),
          lastEvent: z.string().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const syncPutVmsVmIdSyncResponseSchema = z
  .object({
    host: z.string(),
    guest: z.string(),
    auto: z.boolean(),
    mergeText: z.boolean().optional(),
    detectRenames: z.boolean().optional(),
    rollback: z.boolean().optional(),
    watch: z.boolean().optional(),
    policies: z
      .array(
        z
          .object({
            pattern: z.string(),
            direction: z.union([
              z.literal('readonly'),
              z.literal('push'),
              z.literal('both'),
              z.literal('pull'),
            ]),
            guestMode: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    drivers: z
      .array(
        z
          .object({
            pattern: z.string(),
            mode: z.union([
              z.literal('manual'),
              z.literal('keep-both'),
              z.literal('prefer-host'),
              z.literal('prefer-guest'),
              z.literal('merge-text'),
            ]),
          })
          .strict(),
      )
      .optional(),
    window: z
      .object({ days: z.array(z.number()), start: z.string(), end: z.string(), timeZone: z.string() })
      .strict()
      .optional(),
    bandwidthMiBps: z.number().optional(),
    ignore: z.array(z.string()).optional(),
  })
  .strict();

export const syncPostVmsVmIdSyncPreviewResponseSchema = z
  .object({
    token: z.string(),
    changes: z.array(
      z
        .object({
          path: z.string(),
          from: z.string().optional(),
          driver: z
            .union([
              z.literal('manual'),
              z.literal('keep-both'),
              z.literal('prefer-host'),
              z.literal('prefer-guest'),
              z.literal('merge-text'),
            ])
            .optional(),
          suggestedDecision: z
            .union([
              z.literal('push'),
              z.literal('merge'),
              z.literal('both'),
              z.literal('skip'),
              z.literal('pull'),
            ])
            .optional(),
          action: z.union([
            z.literal('push'),
            z.literal('skip'),
            z.literal('pull'),
            z.literal('delete-host'),
            z.literal('delete-guest'),
            z.literal('conflict'),
            z.literal('mkdir-host'),
            z.literal('mkdir-guest'),
            z.literal('rename-host'),
            z.literal('rename-guest'),
          ]),
        })
        .strict(),
    ),
    unchanged: z.number(),
  })
  .strict();

export const syncPostVmsVmIdSyncMergeResponseSchema = z
  .object({ path: z.string(), token: z.string(), base: z.string(), ours: z.string(), theirs: z.string() })
  .strict();

export const syncPostVmsVmIdSyncQueueResponseSchema = z
  .object({
    queue: z.union([
      z.null(),
      z
        .object({
          id: z.string(),
          requestedAt: z.string(),
          attempts: z.number(),
          nextAttemptAt: z.number(),
          jobId: z.string().optional(),
          lastError: z.string().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const terminalWorkspacePostVmsVmIdTerminalSessionResponseSchema = z
  .object({ ok: z.boolean(), projectId: z.string() })
  .strict();

export const toolchainsGetVmsVmIdToolsResponseSchema = z
  .object({
    tools: z.array(
      z
        .object({
          id: z.string(),
          name: z.union([
            z.literal('Go'),
            z.literal('Git'),
            z.literal('Node.js / npm'),
            z.literal('Python / pip'),
            z.literal('Rust / Cargo'),
            z.literal('Java JDK'),
            z.literal('PHP'),
          ]),
          installed: z.boolean(),
          version: z.string(),
          required: z.boolean(),
        })
        .strict(),
    ),
    job: z.union([z.null(), jobViewSchema]),
  })
  .strict();

import { rescueArtifactSchema } from '../rescue.ts';
import { sandboxArtifactSchema, sandboxPolicySchema } from '../sandbox.ts';
import { goldenEntrySchema, goldenResultSchema } from '../golden-images.ts';
import { ingressViewSchema } from '../http-ingress.ts';
import { certificateViewSchema } from '../ingress-certificates.ts';
import { localAliasViewSchema } from '../local-aliases.ts';
import {
  clipboardViewSchema,
  clipboardActionSchema,
  signedBundleViewSchema,
} from './plugin-response-dtos.ts';

const commandPresetSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    command: z.string(),
    parameters: z.array(z.object({ name: z.string(), value: z.string() }).strict()),
  })
  .strict();
const runListSchema = z
  .object({ runs: z.array(jobViewSchema), persistenceError: z.string().optional() })
  .strict();
const sandboxVmViewSchema = vmViewSchema.extend({
  sandbox: sandboxPolicySchema,
  expired: z.boolean(),
});
const snapshotMergeViewSchema = runListSchema.extend({
  branchOrigin: z
    .object({ sourceVmId: z.string(), snapshotId: z.string(), createdAt: z.string() })
    .strict()
    .optional(),
  sourceName: z.string().optional(),
});
const goldenViewSchema = z
  .object({
    templates: z.array(goldenEntrySchema),
    issues: z.array(z.object({ id: z.uuid(), error: z.string() }).strict()),
    limits: z.object({ count: z.number(), bytes: z.number(), imageBytes: z.number() }).strict(),
    job: jobViewSchema.nullable(),
    persistenceError: z.string().optional(),
  })
  .strict();
const metricsResponseSchema = z
  .object({
    cpuPercent: z.number(),
    memoryUsed: z.number(),
    memoryTotal: z.number(),
    diskUsed: z.number(),
    diskTotal: z.number(),
    uptime: z.number(),
    sampledAt: z.string(),
    networkReceivedBytes: z.number().nullable(),
    networkTransmittedBytes: z.number().nullable(),
    networkInterfaces: z.array(
      z.object({ name: z.string(), receivedBytes: z.number(), transmittedBytes: z.number() }).strict(),
    ),
    networkReceiveBytesPerSecond: z.number().nullable(),
    networkTransmitBytesPerSecond: z.number().nullable(),
    processes: z.array(z.object({ name: z.string(), memory: z.number() }).strict()),
  })
  .strict();

const typedPluginResponses = {
  'backups.recovery-view': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: runListSchema,
  },
  'backups.recovery-run': { kind: 'json', statuses: [202], media: 'application/json', schema: jobViewSchema },
  'backups.recovery-artifact': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: rescueArtifactSchema,
  },
  'commands.list': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: z
      .object({ projectId: z.string(), presets: z.array(commandPresetSchema), job: jobViewSchema.nullable() })
      .strict(),
  },
  'commands.save': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: z.array(commandPresetSchema),
  },
  'commands.remove': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: z.array(commandPresetSchema),
  },
  'commands.run': { kind: 'json', statuses: [202], media: 'application/json', schema: jobViewSchema },
  'desktop.x11-clipboard-get': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: clipboardViewSchema,
  },
  'desktop.x11-clipboard-action': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: clipboardActionSchema,
  },
  'desktop.wayland-clipboard-get': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: clipboardViewSchema,
  },
  'desktop.wayland-clipboard-action': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: clipboardActionSchema,
  },
  'metrics.sample': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: metricsResponseSchema,
  },
  'network.ingress-certificate-view': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: certificateViewSchema,
  },
  'network.ingress-certificate-action': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: certificateViewSchema,
  },
  'network.ingress-view': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: ingressViewSchema,
  },
  'network.ingress-action': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: ingressViewSchema,
  },
  'network.local-aliases-view': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: localAliasViewSchema,
  },
  'network.local-aliases-action': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: localAliasViewSchema,
  },
  'platform.browser-ide-link': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: z.object({ url: z.url(), password: z.string().length(64), expiresAt: z.iso.datetime() }).strict(),
  },
  'platform.notebook-link': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: z.object({ provider: z.enum(['jupyter', 'marimo']), url: z.url() }).strict(),
  },
  'sandbox.artifact': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: sandboxArtifactSchema.extend({ base64: z.string() }).strict(),
  },
  'sandbox.list': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: z
      .object({
        sandboxes: z.array(sandboxVmViewSchema),
        runs: z.array(jobViewSchema),
        persistenceError: z.string().optional(),
      })
      .strict(),
  },
  'sandbox.create': {
    kind: 'json',
    statuses: [201],
    media: 'application/json',
    schema: sandboxVmViewSchema,
  },
  'sandbox.inspect': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: sandboxVmViewSchema,
  },
  'sandbox.control': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: z.object({ ok: z.literal(true) }).strict(),
  },
  'sandbox.destroy': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: z.object({ ok: z.literal(true) }).strict(),
  },
  'sandbox.run': { kind: 'json', statuses: [202], media: 'application/json', schema: jobViewSchema },
  'snapshots.snapshot-merge-view': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: snapshotMergeViewSchema,
  },
  'snapshots.snapshot-merge-run': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: jobViewSchema,
  },
  'snapshots.snapshot-diff-view': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: runListSchema,
  },
  'snapshots.snapshot-diff-run': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: jobViewSchema,
  },
  'snapshots.signed-bundles-view': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: signedBundleViewSchema,
  },
  'snapshots.signed-bundles-action': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: signedBundleViewSchema,
  },
  'snapshots.rescue-view': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: runListSchema,
  },
  'snapshots.rescue-artifact': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: rescueArtifactSchema,
  },
  'snapshots.rescue-run': { kind: 'json', statuses: [202], media: 'application/json', schema: jobViewSchema },
  'snapshots.golden-list': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: goldenViewSchema,
  },
  'snapshots.golden-action': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: goldenResultSchema,
  },
} as const satisfies Record<string, HttpResponseContract>;

export const pluginRouteResponses = {
  'automation.legacy.get.feature-suite': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationGetFeatureSuiteResponseSchema,
  },
  'automation.legacy.get.vms.vmId.advanced': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationGetVmsVmIdAdvancedResponseSchema,
  },
  'automation.legacy.put.vms.vmId.advanced': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationPutVmsVmIdAdvancedResponseSchema,
  },
  'automation.legacy.post.vms.vmId.advanced': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: automationPostVmsVmIdAdvancedResponseSchema,
  },
  'automation.legacy.get.vms.vmId.packages': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationGetVmsVmIdPackagesResponseSchema,
  },
  'automation.legacy.post.vms.vmId.packages': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: automationPostVmsVmIdPackagesResponseSchema,
  },
  'automation.legacy.post.vms.vmId.suspend': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'automation.legacy.post.vms.vmId.resume': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'backups.legacy.get.vms.vmId.backups': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: backupsGetVmsVmIdBackupsResponseSchema,
  },
  'backups.legacy.put.vms.vmId.backups': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: backupsPutVmsVmIdBackupsResponseSchema,
  },
  'backups.legacy.post.vms.vmId.backups': {
    kind: 'json',
    statuses: [200, 202],
    media: 'application/json',
    schema: backupsPostVmsVmIdBackupsResponseSchema,
  },
  'backups.legacy.post.vms.vmId.backup-download': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: backupsPostVmsVmIdBackupDownloadResponseSchema,
  },
  'code-checks.legacy.get.vms.vmId.code-diagnostics': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: codeChecksGetVmsVmIdCodeDiagnosticsResponseSchema,
  },
  'code-checks.legacy.get.vms.vmId.language-service': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: codeChecksGetVmsVmIdLanguageServiceResponseSchema,
  },
  'code-checks.legacy.post.vms.vmId.language-service': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: codeChecksPostVmsVmIdLanguageServiceResponseSchema,
  },
  'code-checks.legacy.get.vms.vmId.debugger': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: codeChecksGetVmsVmIdDebuggerResponseSchema,
  },
  'code-checks.legacy.post.vms.vmId.debugger': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: codeChecksPostVmsVmIdDebuggerResponseSchema,
  },
  'containers.legacy.get.vms.vmId.containers': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: containersGetVmsVmIdContainersResponseSchema,
  },
  'containers.legacy.post.vms.vmId.containers': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'desktop.legacy.get.vms.vmId.desktop': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: desktopGetVmsVmIdDesktopResponseSchema,
  },
  'desktop.legacy.post.vms.vmId.desktop': {
    kind: 'json',
    statuses: [200, 202],
    media: 'application/json',
    schema: desktopPostVmsVmIdDesktopResponseSchema,
  },
  'desktop.legacy.get.vms.vmId.single-app': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: desktopGetVmsVmIdSingleAppResponseSchema,
  },
  'desktop.legacy.post.vms.vmId.single-app': {
    kind: 'json',
    statuses: [200, 201],
    media: 'application/json',
    schema: desktopPostVmsVmIdSingleAppResponseSchema,
  },
  'desktop.legacy.get.vms.vmId.ime': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: desktopGetVmsVmIdImeResponseSchema,
  },
  'desktop.legacy.post.vms.vmId.ime': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'extensions.legacy.get.extended-features': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: extensionsGetExtendedFeaturesResponseSchema,
  },
  'extensions.legacy.get.vms.vmId.extended-features': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: extensionsGetVmsVmIdExtendedFeaturesResponseSchema,
  },
  'extensions.legacy.post.vms.vmId.extended-features': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: extensionsPostVmsVmIdExtendedFeaturesResponseSchema,
  },
  'files.legacy.get.vms.vmId.files': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesGetVmsVmIdFilesResponseSchema,
  },
  'files.legacy.get.vms.vmId.file': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesGetVmsVmIdFileResponseSchema,
  },
  'files.legacy.put.vms.vmId.file': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesPutVmsVmIdFileResponseSchema,
  },
  'files.legacy.get.vms.vmId.file-lock': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesGetVmsVmIdFileLockResponseSchema,
  },
  'files.legacy.post.vms.vmId.file-lock': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesPostVmsVmIdFileLockResponseSchema,
  },
  'files.legacy.get.vms.vmId.history': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesGetVmsVmIdHistoryResponseSchema,
  },
  'files.legacy.post.vms.vmId.history': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesPostVmsVmIdHistoryResponseSchema,
  },
  'files.legacy.get.vms.vmId.transfer': {
    kind: 'binary',
    statuses: [200],
    media: 'application/octet-stream',
  },
  'files.legacy.put.vms.vmId.transfer': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesPutVmsVmIdTransferResponseSchema,
  },
  'files.legacy.post.vms.vmId.file-operation': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesPostVmsVmIdFileOperationResponseSchema,
  },
  'files.legacy.get.vms.vmId.uploads': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesGetVmsVmIdUploadsResponseSchema,
  },
  'files.legacy.post.vms.vmId.uploads': {
    kind: 'json',
    statuses: [200, 201],
    media: 'application/json',
    schema: filesPostVmsVmIdUploadsResponseSchema,
  },
  'files.legacy.put.vms.vmId.uploads': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesPutVmsVmIdUploadsResponseSchema,
  },
  'files.legacy.delete.vms.vmId.uploads': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesDeleteVmsVmIdUploadsResponseSchema,
  },
  'files.legacy.get.vms.vmId.file-preview': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesGetVmsVmIdFilePreviewResponseSchema,
  },
  'files.legacy.get.vms.vmId.download-chunks': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: filesGetVmsVmIdDownloadChunksResponseSchema,
  },
  'git.legacy.get.vms.vmId.git': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: gitGetVmsVmIdGitResponseSchema,
  },
  'git.legacy.post.vms.vmId.git': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'ide.legacy.get.vms.vmId.ide': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: ideGetVmsVmIdIdeResponseSchema,
  },
  'ide.legacy.post.vms.vmId.ide': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: ideGetVmsVmIdIdeResponseSchema,
  },
  'images.legacy.get.images': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: imagesGetImagesResponseSchema,
  },
  'images.legacy.post.images.imageId': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'images.legacy.post.image-import': {
    kind: 'json',
    statuses: [201],
    media: 'application/json',
    schema: imagesPostImageImportResponseSchema,
  },
  'library.legacy.post.vms.batch': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: libraryPostVmsBatchResponseSchema,
  },
  'library.legacy.put.vms.vmId.organization': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'maintenance.legacy.get.storage': {
    kind: 'json', statuses: [200], media: 'application/json', schema: maintenanceGetStorageResponseSchema,
  },
  'maintenance.cleanup.providers': {
    kind: 'json', statuses: [200], media: 'application/json', schema: cleanupProvidersSchema,
  },
  'maintenance.cleanup.preview': {
    kind: 'json', statuses: [200], media: 'application/json', schema: cleanupPreviewSchema,
  },
  'maintenance.cleanup.execute': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: cleanupResultSchema,
  },
  'maintenance.legacy.get.vms.vmId.diagnostics': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: maintenanceGetVmsVmIdDiagnosticsResponseSchema,
  },
  'maintenance.legacy.post.vms.vmId.diagnostics': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'maintenance.legacy.post.vms.vmId.resize': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: maintenancePostVmsVmIdResizeResponseSchema,
  },
  'maintenance.legacy.post.vms.vmId.compact': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'maintenance.legacy.get.vms.vmId.disk-maintenance': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: maintenanceGetVmsVmIdDiskMaintenanceResponseSchema,
  },
  'maintenance.legacy.put.vms.vmId.disk-maintenance': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: maintenancePutVmsVmIdDiskMaintenanceResponseSchema,
  },
  'maintenance.legacy.post.vms.vmId.disk-maintenance': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'migration.legacy.get.migration': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: migrationGetMigrationResponseSchema,
  },
  'migration.legacy.post.migration': {
    kind: 'json',
    statuses: [200, 202],
    media: 'application/json',
    schema: migrationPostMigrationResponseSchema,
  },
  'network.legacy.get.network-profiles': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: networkGetNetworkProfilesResponseSchema,
  },
  'network.legacy.post.network-profiles': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: networkPostNetworkProfilesResponseSchema,
  },
  'network.legacy.delete.network-profiles': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: networkDeleteNetworkProfilesResponseSchema,
  },
  'network.legacy.get.vms.vmId.network': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: networkGetVmsVmIdNetworkResponseSchema,
  },
  'network.legacy.post.vms.vmId.network': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: networkPostVmsVmIdNetworkResponseSchema,
  },
  'network.legacy.get.vms.vmId.services': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: networkGetVmsVmIdServicesResponseSchema,
  },
  'network.legacy.patch.vms.vmId.services': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'pipelines.legacy.get.vms.vmId.pipelines': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: pipelinesGetVmsVmIdPipelinesResponseSchema,
  },
  'pipelines.legacy.put.vms.vmId.pipelines': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: pipelinesPutVmsVmIdPipelinesResponseSchema,
  },
  'pipelines.legacy.delete.vms.vmId.pipelines': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: pipelinesDeleteVmsVmIdPipelinesResponseSchema,
  },
  'pipelines.legacy.post.vms.vmId.pipelines': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'pipelines.legacy.post.vms.vmId.pipeline-artifact': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: backupsPostVmsVmIdBackupDownloadResponseSchema,
  },
  'platform.legacy.get.next-features': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: platformGetNextFeaturesResponseSchema,
  },
  'platform.legacy.get.vms.vmId.next-features': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: platformGetVmsVmIdNextFeaturesResponseSchema,
  },
  'platform.legacy.post.vms.vmId.next-features': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: platformPostVmsVmIdNextFeaturesResponseSchema,
  },
  'project-search.legacy.get.vms.vmId.project-files': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectSearchGetVmsVmIdProjectFilesResponseSchema,
  },
  'projects.legacy.get.vms.vmId.projects': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectsGetVmsVmIdProjectsResponseSchema,
  },
  'projects.legacy.post.vms.vmId.projects': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectsGetVmsVmIdProjectsResponseSchema,
  },
  'projects.legacy.get.vms.vmId.project': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectsGetVmsVmIdProjectResponseSchema,
  },
  'projects.legacy.put.vms.vmId.project': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectsPutVmsVmIdProjectResponseSchema,
  },
  'projects.legacy.post.vms.vmId.project': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'projects.legacy.get.vms.vmId.project-runtime': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectsGetVmsVmIdProjectRuntimeResponseSchema,
  },
  'projects.legacy.get.vms.vmId.project-directory-migration': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectsGetVmsVmIdProjectDirectoryMigrationResponseSchema,
  },
  'projects.legacy.post.vms.vmId.project-directory-migration': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectsGetVmsVmIdProjectDirectoryMigrationResponseSchema,
  },
  'recipes.legacy.post.recipes': {
    kind: 'json',
    statuses: [201],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'recipes.post.vms.vmId.recipe.plan': {
    kind: 'json', statuses: [200], media: 'application/json', schema: recipePlanSchema,
  },
  'repair.view': { kind: 'json', statuses: [200], media: 'application/json', schema: repairSessionSchema },
  ...deliveryHttpResponses,
  ...foundryHttpResponses,
  ...Object.fromEntries<HttpResponseContract>(Object.entries({ ...appRouteResponses, ...dataHttpResponses, ...knowledgeHttpResponses, ...resilienceHttpResponses, ...integrationHttpResponses, ...supplyHttpResponses }).map(([key, schema]) => [key, { kind: 'json' as const, statuses: [200], media: 'application/json', schema }])),
  'repair.act': { kind: 'json', statuses: [200], media: 'application/json', schema: repairActionResponseSchema },
  'recipes.post.vms.vmId.recipe.apply-plan': {
    kind: 'json', statuses: [200], media: 'application/json', schema: projectsGetVmsVmIdProjectResponseSchema,
  },
  'recipes.legacy.get.vms.vmId.recipe': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: recipesGetVmsVmIdRecipeResponseSchema,
  },
  'recipes.legacy.put.vms.vmId.recipe': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: projectsGetVmsVmIdProjectResponseSchema,
  },
  'recipes.legacy.post.vms.vmId.recipe': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: recipesGetVmsVmIdRecipeResponseSchema,
  },
  'runtimes.legacy.get.vms.vmId.runtimes': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: runtimesGetVmsVmIdRuntimesResponseSchema,
  },
  'runtimes.legacy.post.vms.vmId.runtimes': {
    kind: 'json',
    statuses: [200, 202],
    media: 'application/json',
    schema: runtimesPostVmsVmIdRuntimesResponseSchema,
  },
  'secrets.legacy.get.vms.vmId.secrets': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: secretsGetVmsVmIdSecretsResponseSchema,
  },
  'secrets.legacy.put.vms.vmId.secrets': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: secretsPutVmsVmIdSecretsResponseSchema,
  },
  'secrets.legacy.delete.vms.vmId.secrets': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: secretsPutVmsVmIdSecretsResponseSchema,
  },
  'secrets.legacy.get.vms.vmId.secret-rotation': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: secretsGetVmsVmIdSecretRotationResponseSchema,
  },
  'secrets.legacy.patch.vms.vmId.secret-rotation': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: secretsGetVmsVmIdSecretRotationResponseSchema,
  },
  'service-health.legacy.get.vms.vmId.health': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: serviceHealthGetVmsVmIdHealthResponseSchema,
  },
  'snapshots.legacy.post.import': {
    kind: 'json',
    statuses: [201],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'snapshots.legacy.post.vms.vmId.snapshots': {
    kind: 'json',
    statuses: [201],
    media: 'application/json',
    schema: snapshotsPostVmsVmIdSnapshotsResponseSchema,
  },
  'snapshots.legacy.patch.vms.vmId.snapshots.snapshotId': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'snapshots.legacy.delete.vms.vmId.snapshots.snapshotId': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'snapshots.legacy.post.vms.vmId.snapshots.snapshotId.restore': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'snapshots.legacy.get.vms.vmId.export': {
    kind: 'binary',
    statuses: [200],
    media: 'application/octet-stream',
  },
  'snapshots.legacy.post.vms.vmId.clone': {
    kind: 'json',
    statuses: [201],
    media: 'application/json',
    schema: automationPostVmsVmIdSuspendResponseSchema,
  },
  'sync.legacy.get.vms.vmId.sync': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: syncGetVmsVmIdSyncResponseSchema,
  },
  'sync.legacy.put.vms.vmId.sync': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: syncPutVmsVmIdSyncResponseSchema,
  },
  'sync.legacy.post.vms.vmId.sync': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'sync.legacy.post.vms.vmId.sync-preview': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: syncPostVmsVmIdSyncPreviewResponseSchema,
  },
  'sync.legacy.post.vms.vmId.sync-merge': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: syncPostVmsVmIdSyncMergeResponseSchema,
  },
  'sync.legacy.post.vms.vmId.sync-queue': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: syncPostVmsVmIdSyncQueueResponseSchema,
  },
  'sync.legacy.delete.vms.vmId.sync-queue': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: syncPostVmsVmIdSyncQueueResponseSchema,
  },
  'sync.legacy.post.vms.vmId.sync-rollback': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'terminal-workspace.legacy.post.vms.vmId.terminal-session': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: terminalWorkspacePostVmsVmIdTerminalSessionResponseSchema,
  },
  'toolchains.legacy.get.vms.vmId.tools': {
    kind: 'json',
    statuses: [200],
    media: 'application/json',
    schema: toolchainsGetVmsVmIdToolsResponseSchema,
  },
  'toolchains.legacy.post.vms.vmId.tools': {
    kind: 'json',
    statuses: [202],
    media: 'application/json',
    schema: containersPostVmsVmIdContainersResponseSchema,
  },
  'transfers.legacy.post.vms.vmId.download': {
    kind: 'json',
    statuses: [201],
    media: 'application/json',
    schema: backupsPostVmsVmIdBackupDownloadResponseSchema,
  },
  ...typedPluginResponses,
} as const satisfies Record<string, HttpResponseContract>;

/**
 * 中文：筛选指定插件命名空间的响应描述，移除插件前缀形成局部操作名映射，不混入其他插件契约。
 * English: Filter response descriptions to the specified plugin namespace and strip its prefix for local operation keys without mixing other plugins' contracts.
 * 中文：输入：pluginId：签名所示 string 业务值
 * English: Inputs: pluginId: the string domain value in the signature
 * 中文：结果：Record<string, HttpResponseContract>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Record<string, HttpResponseContract> carrying the described computation/transport result; throwing branches do not provide success
 */
export function pluginResponseContracts(pluginId: string): Record<string, HttpResponseContract> {
  return Object.fromEntries(
    Object.entries(pluginRouteResponses)
      .filter(([id]) => id.startsWith(pluginId + '.'))
      .map(([id, response]) => [id.slice(pluginId.length + 1), response]),
  );
}
