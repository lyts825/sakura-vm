/**
 * 模块职责：维护独立于实现的 V1 公共服务接口；成员变化属于显式契约修订，初始化仍由提供者负责。
 */
import type WebSocket from 'ws';
import type { DomainRecoveryTicket } from '../../shared/contracts/domain-recovery.ts';
import type { RecoveryView, RecoveryDiagnostics, RecoveryCatalogView } from '../../shared/contracts/recovery.ts';

/** JSON Schema data published by the operation catalog; Zod's builder and metadata stay private. */
export type OperationJsonSchemaV1 = {
  [keyword: string]: unknown;
  $schema?: string; $id?: string; $ref?: string; $anchor?: string; $comment?: string;
  $defs?: Record<string, OperationJsonSchemaV1>;
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' |
    Array<'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'>;
  properties?: Record<string, OperationJsonSchemaV1 | boolean>;
  patternProperties?: Record<string, OperationJsonSchemaV1 | boolean>;
  additionalProperties?: OperationJsonSchemaV1 | boolean;
  required?: string[];
  items?: OperationJsonSchemaV1 | boolean | Array<OperationJsonSchemaV1 | boolean>;
  prefixItems?: Array<OperationJsonSchemaV1 | boolean>;
  allOf?: OperationJsonSchemaV1[]; anyOf?: OperationJsonSchemaV1[]; oneOf?: OperationJsonSchemaV1[];
  not?: OperationJsonSchemaV1 | boolean;
  enum?: unknown[]; const?: unknown; default?: unknown;
  minimum?: number; maximum?: number; exclusiveMinimum?: number | boolean; exclusiveMaximum?: number | boolean;
  multipleOf?: number; minLength?: number; maxLength?: number; pattern?: string; format?: string;
  minItems?: number; maxItems?: number; uniqueItems?: boolean;
  minProperties?: number; maxProperties?: number;
  title?: string; description?: string; examples?: unknown[];
  deprecated?: boolean; readOnly?: boolean; writeOnly?: boolean;
};

/** Version 1 public service contracts. Owned independently of service implementations.
 * Changes to these declarations are intentional contract revisions. Initialization stays with providers. */

export interface FeatureSuiteV1 {
  readonly "jobs": JobsV1;
  readonly "packageWorkbench": PackageWorkbenchV1;
  "enableBackground": () => () => void;
  "catalog": () => Promise<{
    features: import("../../shared/catalogs/automation.ts").FeatureCatalogItem[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    presets: {
        readonly light: {
            readonly name: "轻量命令行";
            readonly memoryMiB: 512;
            readonly cpus: 1;
        };
        readonly development: {
            readonly name: "日常开发";
            readonly memoryMiB: 2048;
            readonly cpus: 2;
        };
        readonly build: {
            readonly name: "编译构建";
            readonly memoryMiB: 4096;
            readonly cpus: 4;
        };
        readonly desktop: {
            readonly name: "图形桌面";
            readonly memoryMiB: 2048;
            readonly cpus: 2;
        };
    };
    generatedAt: string;
}>;
  "alertEvents": () => Promise<AlertEventV1[]>;
  "view": (id: string, limit?: number) => Promise<{
    projectId: string;
    settings: {
        schedule: {
            enabled: boolean;
            idleMinutes: number;
            idleAction: "stop";
            startAt?: string | undefined;
            stopAt?: string | undefined;
        };
        alerts: {
            enabled: boolean;
            cpuPercent: number;
            memoryPercent: number;
            diskPercent: number;
            cooldownMinutes: number;
            taskFailures: boolean;
            serviceFailures: boolean;
            secretRotation: boolean;
        };
        updatedAt: string;
    };
    history: MetricPointV1[];
    events: AlertEventV1[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    devJob: import("../../shared/contracts/jobs.ts").JobView | null;
    presets: {
        readonly light: {
            readonly name: "轻量命令行";
            readonly memoryMiB: 512;
            readonly cpus: 1;
        };
        readonly development: {
            readonly name: "日常开发";
            readonly memoryMiB: 2048;
            readonly cpus: 2;
        };
        readonly build: {
            readonly name: "编译构建";
            readonly memoryMiB: 4096;
            readonly cpus: 4;
        };
        readonly desktop: {
            readonly name: "图形桌面";
            readonly memoryMiB: 2048;
            readonly cpus: 2;
        };
    };
    features: import("../../shared/catalogs/automation.ts").FeatureCatalogItem[];
    featureRuns: {
        featureId: "image-import" | "golden-images" | "multi-arch" | "power-schedules" | "idle-shutdown" | "dynamic-memory" | "online-snapshots" | "snapshot-diff" | "disk-maintenance" | "resource-presets" | "windows-mount" | "file-drop" | "workspace-search" | "disk-analyzer" | "resumable-transfer" | "three-way-sync" | "directory-history" | "binary-preview" | "language-services" | "debug-adapter" | "test-explorer" | "format-lint" | "git-worktrees" | "merge-editor" | "dependency-report" | "runtime-matrix" | "package-manager" | "reproducible-env" | "dev-container" | "browser-preview" | "database-presets" | "ai-assistant" | "port-discovery" | "reverse-proxy" | "network-profiles" | "vpn-integration" | "network-diagnostics" | "package-cache" | "service-dashboard" | "gpu-acceleration" | "audio-video" | "single-app-windows" | "process-interop" | "native-integration" | "multi-monitor" | "metrics-history" | "alerts" | "security-scan" | "rbac-sharing" | "plugin-api";
        startedAt: string;
        finishedAt: string;
        result: Record<string, unknown>;
    }[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    capabilityJobs: import("../../shared/contracts/jobs.ts").JobView[];
}>;
  "feature": (id: string, input: {
    featureId: "image-import" | "golden-images" | "multi-arch" | "power-schedules" | "idle-shutdown" | "dynamic-memory" | "online-snapshots" | "snapshot-diff" | "disk-maintenance" | "resource-presets" | "windows-mount" | "file-drop" | "workspace-search" | "disk-analyzer" | "resumable-transfer" | "three-way-sync" | "directory-history" | "binary-preview" | "language-services" | "debug-adapter" | "test-explorer" | "format-lint" | "git-worktrees" | "merge-editor" | "dependency-report" | "runtime-matrix" | "package-manager" | "reproducible-env" | "dev-container" | "browser-preview" | "database-presets" | "ai-assistant" | "port-discovery" | "reverse-proxy" | "network-profiles" | "vpn-integration" | "network-diagnostics" | "package-cache" | "service-dashboard" | "gpu-acceleration" | "audio-video" | "single-app-windows" | "process-interop" | "native-integration" | "multi-monitor" | "metrics-history" | "alerts" | "security-scan" | "rbac-sharing" | "plugin-api";
    action: "check" | "run";
    options?: Record<string, unknown> | undefined;
}, signal?: AbortSignal | undefined) => Promise<Record<string, unknown> | import("../../shared/contracts/jobs.ts").JobView | {
    message: string;
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    programs: {
        programId: string;
        executable: string;
        fixedArgs: string[];
        sha256: string;
    }[];
    programId?: undefined;
    sha256?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256: string;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256?: undefined;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    programId?: undefined;
    sha256?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    installed: boolean;
    reason: string | undefined;
    programId?: undefined;
    sha256?: undefined;
    enabled?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    command: string;
    programId?: undefined;
    sha256?: undefined;
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    featureId: "ipv6" | "resource-presets" | "workspace-search" | "disk-analyzer" | "directory-history" | "format-lint" | "git-worktrees" | "dependency-report" | "runtime-matrix" | "reproducible-env" | "network-diagnostics" | "gpu-acceleration" | "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "syscall-profile" | "ssh-agent-forward" | "gpg-agent-forward" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "project-quota" | "guest-quota" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "network-quota" | "egress-policy" | "nat-hairpin" | "power-aware-schedule" | "host-disk-health" | "availability-report" | "global-dedup" | "audit-log" | "otel-tracing" | "dependency-bot" | "cpu-topology" | "device-profiles" | "resource-reservation" | "vcpu-hotplug" | "memory-hotplug" | "crash-loop-guard" | "maintenance-windows" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "patch-bundle" | "environment-recreate" | "editor-profiles" | "metrics-export" | "event-timeline" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "anomaly-detection" | "log-index" | "test-sharding" | "review-comments" | "command-forms" | "vm-dependency-start" | "environment-parity" | "test-matrix" | "cross-vm-copy" | "network-topology" | "packet-capture" | "reverse-tunnel" | "code-search-index" | "language-server-catalog" | "pii-classification";
    reason: string;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    previous: string;
    current: string;
    active: boolean;
    connectionPolicyActive: boolean;
    featureId: "network-quota";
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    current: string;
    active: boolean;
    connectionControlsAvailable: boolean;
    connectionPolicyActive: boolean;
    connectionRules: JumpV1[];
    reason?: undefined;
    featureId: "network-quota";
} | {
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number;
    reason?: undefined;
    featureId: "project-quota";
} | {
    reason?: string | undefined;
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number | null;
    phase: string;
    featureId: "project-quota";
} | {
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    hardMiB: number;
    active: boolean;
    report: string;
    reason: undefined;
    featureId: "guest-quota";
} | {
    ready: boolean;
    active: boolean;
    missing: string[];
    report: string;
    reason: string | undefined;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    projectLimitMiB: number | null;
    featureId: "guest-quota";
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    removed: number;
    featureId: "egress-policy";
    reason?: undefined;
} | {
    reason?: string | undefined;
    cleanupWarnings?: string[] | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    rules: JumpV1[];
    removed?: undefined;
    featureId: "egress-policy";
} | {
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        forwards: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        }[];
        selected: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        } | undefined;
        guestAddress: string;
    };
    exitCode: number;
    checkedAt: string;
    featureId: "nat-hairpin";
}>;
  "update": (id: string, input: unknown) => Promise<{
    schedule: {
        enabled: boolean;
        idleMinutes: number;
        idleAction: "stop";
        startAt?: string | undefined;
        stopAt?: string | undefined;
    };
    alerts: {
        enabled: boolean;
        cpuPercent: number;
        memoryPercent: number;
        diskPercent: number;
        cooldownMinutes: number;
        taskFailures: boolean;
        serviceFailures: boolean;
        secretRotation: boolean;
    };
    updatedAt: string;
}>;
  "sample": (id: string) => Promise<{
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes: number | null;
    networkTransmittedBytes: number | null;
    networkInterfaces: {
        name: string;
        receivedBytes: number;
        transmittedBytes: number;
    }[];
    networkReceiveBytesPerSecond: number | null;
    networkTransmitBytesPerSecond: number | null;
    processes: {
        name: string;
        memory: number;
    }[];
    uptime: number;
    sampledAt: string;
}>;
  "memoryTarget": (id: string, memoryMiB: number) => Promise<import("../../shared/contracts/vm.ts").VMView>;
  "applyPreset": (id: string, preset: "light" | "development" | "build" | "desktop") => Promise<import("../../shared/contracts/vm.ts").VMView>;
  "diskAnalysis": (id: string, input: {
    path?: string | undefined;
}, signal?: AbortSignal | undefined) => Promise<{
    path: string;
    entries: {
        path: string;
        bytes: number;
    }[];
    checkedAt: string;
}>;
  "dev": (id: string, input: Omit<{
    action: "dev";
    operation: "format" | "lint" | "dependencies" | "test" | "database" | "test-discover" | "lock" | "lock-check" | "install-locked" | "prefetch-dependencies" | "install-cached-dependencies" | "worktree-list" | "worktree-add" | "worktree-remove";
    branch?: string | undefined;
    path?: string | undefined;
    database?: "postgres" | "redis" | "mysql" | undefined;
    name?: string | undefined;
    port?: number | undefined;
    password?: string | undefined;
    manager?: "npm" | "pip" | undefined;
}, "action">, signal?: AbortSignal | undefined) => import("../../shared/contracts/jobs.ts").JobView;
  "acknowledge": (id: string, eventId: string) => Promise<AlertEventV1>;
  "search": (id: string, input: {
    query: string;
    path?: string | undefined;
    content?: boolean | undefined;
}, signal?: AbortSignal | undefined) => Promise<{
    query: string;
    path: string;
    content: boolean;
    matches: string[];
}>;
  "package": (id: string, input: Omit<{
    action: "package";
    operation: "list" | "update" | "remove" | "install" | "search" | "upgrade" | "upgrade-all" | "cache-list" | "cache-prefetch" | "cache-install" | "cache-clear";
    name?: string | undefined;
}, "action">, signal?: AbortSignal | undefined) => import("../../shared/contracts/jobs.ts").JobView;
  "networkTest": (id: string, target: string, signal?: AbortSignal | undefined) => Promise<{
    target: string;
    output: string;
    code: number;
}>;
  "discoverPorts": (id: string, signal?: AbortSignal | undefined) => Promise<{
    ports: number[];
}>;
  "securityScan": (id: string, signal?: AbortSignal | undefined) => Promise<{
    checkedAt: string;
    findings: string[];
    output: string;
    code: number;
    vulnerabilityScan: VulnerabilityScanV1;
}>;
  "action": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<AlertEventV1 | Record<string, unknown> | import("../../shared/contracts/jobs.ts").JobView | {
    message: string;
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    programs: {
        programId: string;
        executable: string;
        fixedArgs: string[];
        sha256: string;
    }[];
    programId?: undefined;
    sha256?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256: string;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256?: undefined;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    programId?: undefined;
    sha256?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    installed: boolean;
    reason: string | undefined;
    programId?: undefined;
    sha256?: undefined;
    enabled?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    command: string;
    programId?: undefined;
    sha256?: undefined;
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    featureId: "ipv6" | "resource-presets" | "workspace-search" | "disk-analyzer" | "directory-history" | "format-lint" | "git-worktrees" | "dependency-report" | "runtime-matrix" | "reproducible-env" | "network-diagnostics" | "gpu-acceleration" | "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "syscall-profile" | "ssh-agent-forward" | "gpg-agent-forward" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "project-quota" | "guest-quota" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "network-quota" | "egress-policy" | "nat-hairpin" | "power-aware-schedule" | "host-disk-health" | "availability-report" | "global-dedup" | "audit-log" | "otel-tracing" | "dependency-bot" | "cpu-topology" | "device-profiles" | "resource-reservation" | "vcpu-hotplug" | "memory-hotplug" | "crash-loop-guard" | "maintenance-windows" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "patch-bundle" | "environment-recreate" | "editor-profiles" | "metrics-export" | "event-timeline" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "anomaly-detection" | "log-index" | "test-sharding" | "review-comments" | "command-forms" | "vm-dependency-start" | "environment-parity" | "test-matrix" | "cross-vm-copy" | "network-topology" | "packet-capture" | "reverse-tunnel" | "code-search-index" | "language-server-catalog" | "pii-classification";
    reason: string;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    previous: string;
    current: string;
    active: boolean;
    connectionPolicyActive: boolean;
    featureId: "network-quota";
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    current: string;
    active: boolean;
    connectionControlsAvailable: boolean;
    connectionPolicyActive: boolean;
    connectionRules: JumpV1[];
    reason?: undefined;
    featureId: "network-quota";
} | {
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number;
    reason?: undefined;
    featureId: "project-quota";
} | {
    reason?: string | undefined;
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number | null;
    phase: string;
    featureId: "project-quota";
} | {
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    hardMiB: number;
    active: boolean;
    report: string;
    reason: undefined;
    featureId: "guest-quota";
} | {
    ready: boolean;
    active: boolean;
    missing: string[];
    report: string;
    reason: string | undefined;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    projectLimitMiB: number | null;
    featureId: "guest-quota";
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    removed: number;
    featureId: "egress-policy";
    reason?: undefined;
} | {
    reason?: string | undefined;
    cleanupWarnings?: string[] | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    rules: JumpV1[];
    removed?: undefined;
    featureId: "egress-policy";
} | {
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        forwards: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        }[];
        selected: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        } | undefined;
        guestAddress: string;
    };
    exitCode: number;
    checkedAt: string;
    featureId: "nat-hairpin";
} | {
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes: number | null;
    networkTransmittedBytes: number | null;
    networkInterfaces: {
        name: string;
        receivedBytes: number;
        transmittedBytes: number;
    }[];
    networkReceiveBytesPerSecond: number | null;
    networkTransmitBytesPerSecond: number | null;
    processes: {
        name: string;
        memory: number;
    }[];
    uptime: number;
    sampledAt: string;
} | import("../../shared/contracts/vm.ts").VMView | {
    path: string;
    entries: {
        path: string;
        bytes: number;
    }[];
    checkedAt: string;
} | {
    query: string;
    path: string;
    content: boolean;
    matches: string[];
} | {
    target: string;
    output: string;
    code: number;
} | {
    ports: number[];
} | {
    checkedAt: string;
    findings: string[];
    output: string;
    code: number;
    vulnerabilityScan: VulnerabilityScanV1;
}>;
  "tick": () => Promise<void>;
}

export interface FeatureSchedulerV1 {

}

export interface BackupsV1 {
  "recoveryTickets": () => Promise<DomainRecoveryTicket[]>;
  "recoverTicket": (ticket: DomainRecoveryTicket) => Promise<void>;
  readonly "jobs": JobsV1;
  "downloadable": (id: string, backupId: string) => Promise<BackupDownloadV1>;
  "view": (id: string) => Promise<{
    bytes: number;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    waitingForShutdown: boolean;
    maintenance: boolean;
    policy: {
        enabled: boolean;
        intervalHours: number;
        keep: number;
        maxGiB: number;
        lockDays?: number | undefined;
        deduplicate?: boolean | undefined;
        bandwidthMiBps?: number | undefined;
        directory?: string | undefined;
        passwordSecret?: string | undefined;
    };
    items: BackupRecordV1[];
    lastSuccess?: string | undefined;
}>;
  "policy": (id: string, value: unknown) => Promise<BackupStateV1>;
  "tick": (now?: number, signal?: AbortSignal | undefined) => Promise<void>;
  "run": (id: string, password?: string | undefined) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  "operate": (id: string, backupId: string, action: "delete" | "restore" | "verify", name?: string | undefined, password?: string | undefined) => Promise<import("../../shared/contracts/jobs.ts").JobView | {
    ok: boolean;
}>;
  "withVerifiedFile": <T>(id: string, backupId: string, password: string | undefined, signal: AbortSignal, work: (file: string, lease: {
    id: string;
    release: () => void;
    assertActive: (checkSignal?: boolean) => void;
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    releaseTemporary: (path: string) => Promise<void>;
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    transfer: (owner: string) => void;
}, sourceFile: string) => Promise<T>, options?: {
    extraBuffers?: number | undefined;
    writes?: boolean | undefined;
    writePaths?: readonly string[] | undefined;
}) => Promise<T>;
}

export interface BackupRecoveryV1 {
  readonly "jobs": JobsV1;
  "view": (id: string) => {
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    persistenceError: string | undefined;
};
  "artifact": (id: string, run: string, artifact: string) => Promise<{
    base64: string;
    id: string;
    name: string;
    path: string;
    bytes: number;
    sha256: string;
}>;
  "run": (id: string, input: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface CodeIntelligenceV1 {
  "diagnose": (id: string, path: string, signal?: AbortSignal | undefined) => Promise<{
    path: string;
    diagnostics: DiagnosticV1[];
    supported: boolean;
}>;
}

export interface LanguageServicesV1 {
  "status": (id: string, path: string, signal?: AbortSignal | undefined) => Promise<{
    language: string;
    installed: boolean;
    supported: boolean;
    pending: {
        token: string;
        phase: "active" | "review" | "intent" | "closed";
        needsReview: boolean;
    }[];
}>;
  "install": (id: string, signal?: AbortSignal | undefined) => Promise<{
    installed: boolean;
    languages: string[];
}>;
  readonly "execute": {
    (id: string, input: {
        action: "completion";
        path: string;
        content: string;
        position: import("../../shared/language-service.ts").LspPosition;
    }, signal?: AbortSignal | undefined): Promise<{
        path: string;
        items: {
            label: string;
            detail: string;
            insertText: string;
            range: import("../../shared/language-service.ts").LspRange | null;
        }[];
    }>;
    (id: string, input: {
        action: "definition";
        path: string;
        content: string;
        position: import("../../shared/language-service.ts").LspPosition;
    }, signal?: AbortSignal | undefined): Promise<{
        path: string;
        locations: {
            path: string;
            line: number;
            column: number;
        }[];
    }>;
    (id: string, input: {
        action: "diagnostics";
        path: string;
        content: string;
    }, signal?: AbortSignal | undefined): Promise<{
        path: string;
        received: boolean;
        diagnostics: {
            severity: string;
            message: string;
            line: number;
            column: number;
        }[];
    }>;
    (id: string, input: {
        action: "rename";
        path: string;
        content: string;
        position: import("../../shared/language-service.ts").LspPosition;
        newName: string;
        version: string;
    }, signal?: AbortSignal | undefined): Promise<{
        token: string;
        files: {
            path: string;
            before: string;
            after: string;
        }[];
    }>;
    (id: string, input: {
        action: "diagnostics" | "completion" | "definition" | "rename";
        path: string;
        content: string;
        position?: import("../../shared/language-service.ts").LspPosition | undefined;
        newName?: string | undefined;
        version?: string | undefined;
    }, signal?: AbortSignal | undefined): Promise<any>;
};
  "apply": (id: string, token: string, lockToken?: string | undefined) => Promise<{
    files: {
        path: string;
        content: string;
        version: string;
    }[];
}>;
  "stop": (id: string, token: string) => Promise<{
    stopped: boolean;
}>;
}

export interface DebugAdapterV1 {
  "status": (id: string, signal?: AbortSignal | undefined) => Promise<{
    active: boolean;
    needsReview: boolean;
    error: string;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    startedAt: string;
    installed: boolean;
    pending?: undefined;
} | {
    installed: boolean;
    active: boolean;
    token: string;
    state: "error";
    needsReview: boolean;
    error: string;
    pending: {
        token: string;
        projectId: string;
        phase: "active" | "review" | "intent" | "closed";
    }[];
} | {
    installed: boolean;
    active: boolean;
    token?: undefined;
    state?: undefined;
    needsReview?: undefined;
    error?: undefined;
    pending?: undefined;
}>;
  "install": (id: string, signal?: AbortSignal | undefined) => Promise<{
    installed: boolean;
}>;
  "start": (id: string, input: {
    path: string;
    breakpoints: number[];
    stopOnEntry?: boolean | undefined;
    args?: string[] | undefined;
}, signal?: AbortSignal | undefined) => Promise<{
    active: boolean;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    error: string;
    startedAt: string;
    needsReview: boolean;
}>;
  "command": (id: string, token: string, action: "next" | "continue" | "stepIn" | "stepOut" | "pause", signal?: AbortSignal | undefined) => Promise<{
    active: boolean;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    error: string;
    startedAt: string;
    needsReview: boolean;
}>;
  "setBreakpoints": (id: string, token: string, input: number[]) => Promise<{
    active: boolean;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    error: string;
    startedAt: string;
    needsReview: boolean;
}>;
  "inspect": (id: string, token: string, frameId: number) => Promise<{
    active: boolean;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    error: string;
    startedAt: string;
    needsReview: boolean;
}>;
  "expand": (id: string, token: string, reference: number) => Promise<{
    variables: any;
}>;
  "stop": (id: string, token: string) => Promise<{
    active: boolean;
    stopped: boolean;
    output: string;
}>;
}

export interface CommandPresetsV1 {
  readonly "jobs": JobsV1;
  "list": (id: string) => Promise<{
    name: string;
    command: string;
    parameters: {
        name: string;
        value: string;
    }[];
    id: string;
}[]>;
  "save": (id: string, input: unknown) => Promise<{
    name: string;
    command: string;
    parameters: {
        name: string;
        value: string;
    }[];
    id: string;
}[]>;
  "remove": (id: string, presetId: string) => Promise<{
    name: string;
    command: string;
    parameters: {
        name: string;
        value: string;
    }[];
    id: string;
}[]>;
  "run": (id: string, presetId: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface ContainersV1 {
  readonly "jobs": JobsV1;
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<{
    supported: boolean;
    installed: boolean;
    containers: never[];
    images: never[];
    volumes: never[];
    files: never[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    available?: undefined;
    privateNetwork?: undefined;
    error?: undefined;
    runtime?: undefined;
    devcontainer?: undefined;
    templates?: undefined;
    version?: undefined;
    compose?: undefined;
} | {
    supported: boolean;
    installed: boolean;
    available: boolean;
    privateNetwork: boolean;
    containers: never[];
    images: never[];
    volumes: never[];
    files: never[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    error: string;
    runtime?: undefined;
    devcontainer?: undefined;
    templates?: undefined;
    version?: undefined;
    compose?: undefined;
} | {
    supported: boolean;
    installed: boolean;
    available: boolean;
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        reason: string | null;
        runId: string | null;
        containers: number;
    };
    privateNetwork: boolean;
    error: string | undefined;
    containers: never[];
    images: never[];
    volumes: never[];
    files: never[];
    devcontainer: {
        cliInstalled: boolean;
        files: never[];
        error: string;
        version?: undefined;
    } | {
        cliInstalled: boolean;
        version: string | undefined;
        files: string[];
        error?: undefined;
    };
    templates: readonly [{
        readonly id: "debian";
        readonly name: "Debian";
        readonly description: "通用 Debian 开发环境";
    }, {
        readonly id: "javascript-node";
        readonly name: "Node.js";
        readonly description: "Node.js 与 JavaScript";
    }, {
        readonly id: "python";
        readonly name: "Python";
        readonly description: "Python 3 开发环境";
    }, {
        readonly id: "go";
        readonly name: "Go";
        readonly description: "Go 开发环境";
    }, {
        readonly id: "rust";
        readonly name: "Rust";
        readonly description: "Rust 开发环境";
    }];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    version?: undefined;
    compose?: undefined;
} | {
    supported: boolean;
    installed: boolean;
    available: boolean;
    error: string;
    containers: never[];
    images: never[];
    volumes: never[];
    files: never[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    privateNetwork?: undefined;
    runtime?: undefined;
    devcontainer?: undefined;
    templates?: undefined;
    version?: undefined;
    compose?: undefined;
} | {
    supported: boolean;
    installed: boolean;
    available: boolean;
    privateNetwork: boolean;
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        reason: string | null;
        runId: string | null;
        containers: number;
    } | undefined;
    version: string;
    compose: string;
    containers: any[];
    images: any[];
    volumes: any[];
    files: string[];
    devcontainer: {
        cliInstalled: boolean;
        files: never[];
        error: string;
        version?: undefined;
    } | {
        cliInstalled: boolean;
        version: string | undefined;
        files: string[];
        error?: undefined;
    };
    templates: readonly [{
        readonly id: "debian";
        readonly name: "Debian";
        readonly description: "通用 Debian 开发环境";
    }, {
        readonly id: "javascript-node";
        readonly name: "Node.js";
        readonly description: "Node.js 与 JavaScript";
    }, {
        readonly id: "python";
        readonly name: "Python";
        readonly description: "Python 3 开发环境";
    }, {
        readonly id: "go";
        readonly name: "Go";
        readonly description: "Go 开发环境";
    }, {
        readonly id: "rust";
        readonly name: "Rust";
        readonly description: "Rust 开发环境";
    }];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    error?: undefined;
}>;
  "templateMetadata": (id: string, input: string, version?: string | undefined, signal?: AbortSignal | undefined) => Promise<{
    id: string;
    version: string;
    name: string;
    description: string;
    documentationURL: string;
    reference: string;
    sourceMatched: boolean;
    imageVariant: {
        default: string;
        choices: string[];
    } | undefined;
    optionalPaths: string[];
    files: string[];
}>;
  "logs": (id: string, target: string, signal?: AbortSignal | undefined) => Promise<{
    log: string;
}>;
  "run": (id: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  "privateDatabase": (id: string, input: {
    database: "postgres" | "redis" | "mysql";
    password: string;
    name?: string | undefined;
    port?: number | undefined;
}, signal: AbortSignal, log: (text: string) => void) => Promise<void>;
}

export interface DesktopsV1 {
  readonly "apps": SingleAppWindowsV1;
  readonly "clipboard": X11ClipboardV1;
  readonly "waylandClipboard": WaylandClipboardV1;
  "stop": (id: string) => Promise<{
    stopped: boolean;
}>;
  "view": (id: string, bound?: boolean) => Promise<import("../../shared/contracts/vm.ts").DesktopView>;
  "start": (id: string, action: "start" | "install" | "configure", input?: Partial<{
    sessionType: "auto" | "x11" | "wayland";
    resolution: "1280x800" | "1440x900" | "1600x1000" | "1920x1080";
    monitorLayout: "single" | "dual-horizontal" | "dual-vertical";
    scale: number;
    theme: "sakura" | "midnight" | "paper" | "lavender";
    wallpaper: "sakura" | "midnight" | "paper" | "plain";
    accent: string;
    panel: "bottom" | "top" | "floating";
    autoHidePanel: boolean;
    animations: boolean;
}> | undefined) => import("../../shared/contracts/vm.ts").DesktopView;
  "installIme": (id: string, signal: AbortSignal, log: (line: string) => void) => Promise<{
    stdout: string;
    stderr: string;
    code: number;
}>;
  "attach": (id: string, socket: WebSocket, readOnly?: boolean, port?: number, appSession?: string | undefined, projectId?: string | null | undefined) => Promise<void>;
}

export interface JobsV1 {
  readonly "persistenceError"?: string | undefined;
  "flush": () => Promise<void>;
  "list": () => import("../../shared/contracts/jobs.ts").JobView[];
  "view": (key: string) => import("../../shared/contracts/jobs.ts").JobView | null;
  "get": (id: string) => import("../../shared/contracts/jobs.ts").JobView | undefined;
  "resolveCleanup": (id: string) => Promise<void>;
  "clearCompletedLogs": (entries: {
    id: string;
    signature: string;
}[], at: string) => Promise<{
    removedLogs: number;
    removedBytes: number;
}>;
  "result": (id: string) => Promise<any>;
  "start": (key: string, work: WorkV1, meta?: import("../../shared/contracts/jobs.ts").JobMeta) => import("../../shared/contracts/jobs.ts").JobView;
  "track": <T>(key: string, work: (log: (s: string) => void, signal: AbortSignal, update: import("../../shared/contracts/jobs.ts").JobUpdate) => Promise<T>, meta?: import("../../shared/contracts/jobs.ts").JobMeta, external?: AbortSignal | undefined) => Promise<T>;
  "cancel": (key: string, reason?: unknown) => void;
  "wait": (key: string) => Promise<void>;
  "close": () => Promise<void>;
}

export interface X11ClipboardV1 {
  readonly "jobs": JobsV1;
  "retireDesktop": (id: string, proof: {
    version: 1;
    identity: {
        version: 1;
        phase: "active" | "intent";
        registryId: string;
        projectId: string;
        identityId: string;
        revision: number;
        account: string;
        uid: number;
        gid: number;
        home: string;
        directory: string;
        directoryDevice: string;
        directoryInode: string;
        homeDevice: string;
        homeInode: string;
        networkIsolation: "host" | "private";
    };
    run: {
        version: 1;
        phase: "active" | "closed";
        mode: "independent" | "inherit-current";
        registryId: string;
        identityId: string;
        projectId: string;
        runId: string;
        revision: number;
        bootId: string;
        build: string;
        networkDevice: string;
        networkInode: string;
        cgroupDevice: string;
        cgroupInode: string;
        cgroupName: string;
        namespace: string;
    } | null;
    record: {
        name: "desktop";
        session: string;
        version: 1;
        projectId: string;
        runId: string;
        bootId: string;
        scopeName: string;
        inode: string | null;
        binding: string;
        phase: "running" | "prepared" | "stopped" | "intent";
        sessionId: string | null;
        paneId: string | null;
        panePid: number | null;
        paneStartTicks: string | null;
    };
    sha256: string;
    runtime: string;
    endpoint: {
        plasmaPid: number;
        plasmaCreated: string;
        vncPid: number;
        vncCreated: string;
        runtimeDevice: string;
        runtimeInode: string;
        xauthDevice: string;
        xauthInode: string;
        xauthSha256: string;
        readyDevice: string;
        readyInode: string;
        nestedX11?: {
            display: string;
            xauthPath: string;
            xauthDevice: string;
            xauthInode: string;
            xauthSha256: string;
            socketPath: string;
            socketDevice: string;
            socketInode: string;
            kernelInode: string;
            peerPid: number;
            peerCreated: string;
            peerImage: "/usr/bin/Xwayland" | "/usr/bin/kwin_wayland" | "/usr/bin/kwin_wayland_wrapper";
        } | undefined;
    } | null;
    build: string;
}) => Promise<void>;
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<import("../../shared/x11-clipboard.ts").X11ClipboardView>;
  "install": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
  "action": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<unknown>;
}

export interface WaylandClipboardV1 {
  readonly "jobs": JobsV1;
  "retireDesktop": (id: string, proof: {
    version: 1;
    identity: {
        version: 1;
        phase: "active" | "intent";
        registryId: string;
        projectId: string;
        identityId: string;
        revision: number;
        account: string;
        uid: number;
        gid: number;
        home: string;
        directory: string;
        directoryDevice: string;
        directoryInode: string;
        homeDevice: string;
        homeInode: string;
        networkIsolation: "host" | "private";
    };
    run: {
        version: 1;
        phase: "active" | "closed";
        mode: "independent" | "inherit-current";
        registryId: string;
        identityId: string;
        projectId: string;
        runId: string;
        revision: number;
        bootId: string;
        build: string;
        networkDevice: string;
        networkInode: string;
        cgroupDevice: string;
        cgroupInode: string;
        cgroupName: string;
        namespace: string;
    } | null;
    record: {
        name: "desktop";
        session: string;
        version: 1;
        projectId: string;
        runId: string;
        bootId: string;
        scopeName: string;
        inode: string | null;
        binding: string;
        phase: "running" | "prepared" | "stopped" | "intent";
        sessionId: string | null;
        paneId: string | null;
        panePid: number | null;
        paneStartTicks: string | null;
    };
    sha256: string;
    runtime: string;
    endpoint: {
        plasmaPid: number;
        plasmaCreated: string;
        vncPid: number;
        vncCreated: string;
        runtimeDevice: string;
        runtimeInode: string;
        xauthDevice: string;
        xauthInode: string;
        xauthSha256: string;
        readyDevice: string;
        readyInode: string;
        nestedX11?: {
            display: string;
            xauthPath: string;
            xauthDevice: string;
            xauthInode: string;
            xauthSha256: string;
            socketPath: string;
            socketDevice: string;
            socketInode: string;
            kernelInode: string;
            peerPid: number;
            peerCreated: string;
            peerImage: "/usr/bin/Xwayland" | "/usr/bin/kwin_wayland" | "/usr/bin/kwin_wayland_wrapper";
        } | undefined;
    } | null;
    build: string;
}) => Promise<void>;
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<import("../../shared/x11-clipboard.ts").X11ClipboardView>;
  "install": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
  "action": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<unknown>;
}

export interface ExtendedFeaturesV1 {
  readonly "jobs": JobsV1;
  "catalog": () => Promise<{
    features: import("../../shared/catalogs/engineering.ts").ExtendedFeature[];
    operations: {
        id: string;
        name: string;
        feature: string;
        example: Record<string, unknown>;
        note: string;
        writes: boolean;
        schema: OperationJsonSchemaV1;
    }[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    count: number;
    generatedAt: string;
}>;
  "view": (id: string) => Promise<{
    projectId: string;
    features: import("../../shared/catalogs/engineering.ts").ExtendedFeature[];
    operations: {
        id: string;
        name: string;
        feature: string;
        example: Record<string, unknown>;
        note: string;
        writes: boolean;
        schema: OperationJsonSchemaV1;
    }[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    settings: Record<string, FeatureSettingV1>;
    manifest: {
        createdAt: string;
        path: string;
        entries: number;
        checksum: string;
    };
    executions: FeatureExecutionV1[];
    jobs: import("../../shared/contracts/jobs.ts").JobView[];
}>;
  "configure": (id: string, input: unknown) => Promise<FeatureSettingV1>;
  "action": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<import("../../shared/contracts/jobs.ts").JobView | FeatureSettingV1 | (Record<string, unknown> & {
    ready: boolean;
})>;
}

export interface FilesV1 {
  readonly "uploads": ResumableUploadsV1;
  readonly "trash"?: ((id: string, path: string, recursive: boolean) => Promise<unknown>) | undefined;
  "info": (id: string, path: string) => Promise<{
    size: number;
}>;
  "chunk": (id: string, path: string, index: number, signal: AbortSignal) => Promise<{
    index: number;
    bytes: number;
    data: string;
    sha256: string;
}>;
  "preview": (id: string, path: string, signal?: AbortSignal | undefined) => Promise<PreviewV1>;
  "upload": (id: string, path: string, source: import("stream").Readable, overwrite?: boolean, signal?: AbortSignal | undefined, expectedVersion?: string | undefined) => Promise<{
    bytes: number;
}>;
  "download": (id: string, path: string, target: import("stream").Writable, headers: (size: number) => void, signal?: AbortSignal | undefined) => Promise<void>;
  "operation": (id: string, action: "delete" | "rename" | "mkdir", path: string, destination?: string | undefined, recursive?: boolean) => Promise<unknown>;
}

export interface FileHistoryV1 {
  "list": (id: string, path?: string | undefined) => Promise<{
    id: string;
    path: string;
    kind: "version" | "trash";
    createdAt: string;
    bytes: number;
    ready: boolean;
    version?: string | undefined;
}[]>;
  "capture": (id: string, path: string, ftp: import("ssh2").SFTPWrapper, signal?: AbortSignal | undefined) => Promise<void>;
  "trash": (id: string, path: string, recursive?: boolean) => Promise<{
    ok: boolean;
    historyId: string;
}>;
  "content": (id: string, key: string) => Promise<{
    entry: {
        id: string;
        path: string;
        kind: "version" | "trash";
        createdAt: string;
        bytes: number;
        ready: boolean;
        version?: string | undefined;
    };
    content: string;
}>;
  "restore": (id: string, key: string, expectedVersion?: string | undefined) => Promise<{
    ok: boolean;
    path: string;
}>;
  "purge": (id: string, key: string) => Promise<{
    ok: boolean;
}>;
}

export interface FileLocksV1 {
  "view": (id: string, input: string) => {
    path: string;
    locked: boolean;
    expiresAt: string | null;
};
  "acquire": (id: string, input: string) => Promise<{
    path: string;
    token: `${string}-${string}-${string}-${string}-${string}`;
    expiresAt: string;
}>;
  "renew": (id: string, input: string, token: string) => Promise<{
    path: string;
    expiresAt: string;
}>;
  "release": (id: string, input: string, token: string) => Promise<{
    released: string;
}>;
  "withMutation": <T>(id: string, inputs: string[], token: string | undefined, action: () => Promise<T>) => Promise<T>;
  "clear": () => void;
}

export interface GitWorkbenchV1 {
  readonly "jobs": JobsV1;
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<{
    projectId: string;
    repository: boolean;
    error: string;
    changes: never[];
    branches: never[];
    history: never[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    branch?: undefined;
    detached?: undefined;
    hasCommits?: undefined;
    conflicts?: undefined;
    operation?: undefined;
    upstream?: undefined;
    remotes?: undefined;
    divergence?: undefined;
} | {
    projectId: string;
    repository: boolean;
    branch: string;
    detached: boolean;
    hasCommits: boolean;
    changes: import("../../shared/git.ts").GitChange[];
    conflicts: string[];
    operation: string | null;
    upstream: import("../../shared/git.ts").GitUpstream | null;
    branches: string[];
    history: {
        id: string;
        short: string;
        subject: string;
        author: string;
        date: string;
    }[];
    remotes: {
        name: string;
        url: string;
        kind: string;
    }[];
    divergence: number[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    error?: undefined;
}>;
  "diff": (id: string, path: string, staged: boolean, signal?: AbortSignal | undefined) => Promise<{
    diff: string;
    truncated: boolean;
}>;
  "mergeInputs": (id: string, path: string, signal?: AbortSignal | undefined, project?: ProjectV1 | undefined) => Promise<{
    path: string;
    base: string;
    ours: string;
    theirs: string;
    expectedVersion: string;
    expectedIndex: string;
}>;
  "conflictChoices": (id: string, path: string, signal?: AbortSignal | undefined, project?: ProjectV1 | undefined) => Promise<{
    path: string;
    base: {
        mode: string;
        oid: string;
    };
    ours: {
        mode: string;
        oid: string;
    };
    theirs: {
        mode: string;
        oid: string;
    };
    worktree: string;
    expectedIndex: string;
    expectedWorktree: string;
}>;
  "run": (id: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface IdeV1 {
  "profile": (id: string, signal?: AbortSignal | undefined, client?: "jetbrains" | "openssh") => Promise<{
    hostKeyVerification?: "project-and-endpoint" | undefined;
    alias: string;
    host: string;
    port: number;
    username: string;
    directory: string;
    identityFile: string;
    knownHostsFile: string;
    hostKeyAlias: string;
    projectScoped: boolean;
    projectId: string;
    vscodeSupported: boolean;
    networkIsolation: "host" | "private";
    config: string;
}>;
  "update": () => Promise<void>;
  "view": (id: string) => Promise<{
    supported: boolean;
    running: boolean;
    vscodeSupported: boolean;
    alias: string;
    config: string;
    command: string;
    url: string;
    projectScoped?: undefined;
    projectId?: undefined;
    networkIsolation?: undefined;
    runtime?: undefined;
    sshCommand?: undefined;
} | {
    supported: boolean;
    vscodeSupported: boolean;
    running: boolean;
    projectScoped: boolean;
    projectId: string;
    networkIsolation: "host" | "private";
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        processes: number;
        reason: string | null;
        daemon?: {
            pid: number;
            startTicks: string;
            bootId: string;
            cgroupName: string;
        } | undefined;
    };
    alias: string;
    config: string;
    command: string;
    sshCommand: string;
    url: string;
}>;
  "install": (id: string, signal?: AbortSignal | undefined) => Promise<{
    supported: boolean;
    running: boolean;
    vscodeSupported: boolean;
    alias: string;
    config: string;
    command: string;
    url: string;
    projectScoped?: undefined;
    projectId?: undefined;
    networkIsolation?: undefined;
    runtime?: undefined;
    sshCommand?: undefined;
} | {
    supported: boolean;
    vscodeSupported: boolean;
    running: boolean;
    projectScoped: boolean;
    projectId: string;
    networkIsolation: "host" | "private";
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        processes: number;
        reason: string | null;
        daemon?: {
            pid: number;
            startTicks: string;
            bootId: string;
            cgroupName: string;
        } | undefined;
    };
    alias: string;
    config: string;
    command: string;
    sshCommand: string;
    url: string;
}>;
  "stop": (id: string) => Promise<{
    supported: boolean;
    running: boolean;
    vscodeSupported: boolean;
    alias: string;
    config: string;
    command: string;
    url: string;
    projectScoped?: undefined;
    projectId?: undefined;
    networkIsolation?: undefined;
    runtime?: undefined;
    sshCommand?: undefined;
} | {
    supported: boolean;
    vscodeSupported: boolean;
    running: boolean;
    projectScoped: boolean;
    projectId: string;
    networkIsolation: "host" | "private";
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        processes: number;
        reason: string | null;
        daemon?: {
            pid: number;
            startTicks: string;
            bootId: string;
            cgroupName: string;
        } | undefined;
    };
    alias: string;
    config: string;
    command: string;
    sshCommand: string;
    url: string;
}>;
}

export interface ImagesV1 {
  readonly "jobs": JobsV1;
  "list": () => {
    id: string;
    name: "Alpine 3.23" | "Debian 12" | "Debian 12 ARM64" | "Ubuntu 24.04 LTS";
    ready: boolean;
    minimumMemory: 256 | 1024;
    minimumDisk: 2 | 4;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}[];
  "prepare": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface DiskImportsV1 {
  "import": (input: unknown, source: import("stream").Readable, signal?: AbortSignal | undefined) => Promise<{
    vm: import("../../shared/contracts/vm.ts").VMView;
    source: {
        member?: string | undefined;
        format: "raw" | "vmdk" | "vhdx" | "ova";
        bytes: number;
        sha256: string;
        virtualBytes: any;
    };
}>;
}

export interface MaintenanceV1 {
  readonly "jobs": JobsV1;
  "storage": () => Promise<{
    total: number;
    available: number;
    images: {
        id: string;
        name: "Alpine 3.23" | "Debian 12" | "Debian 12 ARM64" | "Ubuntu 24.04 LTS";
        bytes: number;
    }[];
    backupBytes: number;
    deduplicatedBackups: {
        backups: number;
        logicalBytes: number;
        physicalBytes: number;
        referencedBytes: number;
        savedBytes: number;
        orphanBytes: number;
        reclaimedBytes: number;
        chunkCount: number;
        blockSize: number;
    };
    machines: {
        id: string;
        name: string;
        bytes: number;
        capacity: number;
        snapshots: number;
        pendingResize: boolean;
    }[];
    warning: string;
}>;
  "compact": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
  "diskView": (id: string) => Promise<{
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    maintenance: boolean;
    policy: {
        enabled: boolean;
        intervalHours: number;
        mode: "trim" | "compact" | "both";
        compress: boolean;
    };
    attempts: Partial<Record<DiskOperationV1, AttemptV1>>;
    successes: Partial<Record<DiskOperationV1, string>>;
}>;
  "diskPolicy": (id: string, input: unknown) => Promise<DiskMaintenanceStateV1>;
  "diskRun": (id: string, operation: DiskOperationV1) => import("../../shared/contracts/jobs.ts").JobView;
  "tick": (now?: number) => Promise<void>;
  "report": (id: string) => {
    createdAt: string;
    checks: DiagnosticCheckV1[];
    log: string;
} | null;
  "diagnose": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
  "resize": (id: string, size: number) => import("../../shared/contracts/jobs.ts").JobView;
  "finishResize": (id: string) => import("../../shared/contracts/jobs.ts").JobView | undefined;
}

export interface MetricsV1 {
  "forget": (id: string) => void;
  "sample": (id: string) => Promise<{
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes: number | null;
    networkTransmittedBytes: number | null;
    networkInterfaces: {
        name: string;
        receivedBytes: number;
        transmittedBytes: number;
    }[];
    networkReceiveBytesPerSecond: number | null;
    networkTransmitBytesPerSecond: number | null;
    processes: {
        name: string;
        memory: number;
    }[];
    uptime: number;
    sampledAt: string;
}>;
}

export interface DataMigrationV1 {
  readonly "jobs": JobsV1;
  readonly "blocked": boolean;
  "view": () => Promise<{
    source: string;
    target: string | undefined;
    restartRequired: boolean;
    blocked: boolean;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    previous: null;
}>;
  "plan": (input: string) => Promise<{
    source: string;
    target: string;
    bytes: number;
    available: number;
    count: number;
    token: string;
    files: MigrationFileV1[];
}>;
  "start": (input: string, token: string) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  "cancelActivation": () => Promise<{
    source: string;
    target: string | undefined;
    restartRequired: boolean;
    blocked: boolean;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    previous: null;
}>;
}

export interface NetworkProfilesV1 {
  readonly "jobs": JobsV1;
  "state": (id: string) => Promise<{
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    changes: NetworkChangeV1[];
    forwards?: ForwardChangeV1 | undefined;
    dnsBackend?: "resolved" | undefined;
    resolverLink?: {
        before: string;
        after: string;
    } | undefined;
    appliedAt?: string | undefined;
}>;
  "profiles": () => Promise<{
    id: string;
    name: string;
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    updatedAt: string;
}[]>;
  "saveProfile": (input: unknown) => Promise<{
    id: string;
    updatedAt: string;
    name: string;
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
}>;
  "removeProfile": (id: string) => Promise<{
    removed: string;
}>;
  "environment": (id: string) => Promise<Record<string, string>>;
  "preview": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<{
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    changes: NetworkChangeV1[];
    forwards: {
        before: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[];
        after: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[];
    } | undefined;
    dnsBackend: "resolved" | undefined;
    resolverLink: {
        before: string;
        after: string;
    } | undefined;
    token: string;
}>;
  "apply": (id: string, input: unknown, token: string) => Promise<NetworkStateV1>;
  "restore": (id: string) => Promise<{
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    changes: NetworkChangeV1[];
    forwards?: ForwardChangeV1 | undefined;
    dnsBackend?: "resolved" | undefined;
    resolverLink?: {
        before: string;
        after: string;
    } | undefined;
    appliedAt?: string | undefined;
}>;
  "test": (id: string, input: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface IngressCertificatesV1 {
  "view": () => {
    policy: {
        autoRotate: boolean;
        renewBeforeDays: number;
    };
    certificate: {
        pem: string;
        fingerprint256: string;
        validFrom: string;
        validTo: string;
        generatedAt: string;
    } | null;
    nextRotationAt: string | null;
    rotationError?: string | undefined;
};
  "tlsOptions": () => {
    key: string;
    cert: string;
};
  "onChange": (listener: (certificate: {
    key: string;
    cert: string;
    generatedAt: string;
}) => void) => () => boolean;
  "ensure": (domainAliases?: boolean) => Promise<{
    key: string;
    cert: string;
}>;
  "action": (input: unknown) => Promise<{
    policy: {
        autoRotate: boolean;
        renewBeforeDays: number;
    };
    certificate: {
        pem: string;
        fingerprint256: string;
        validFrom: string;
        validTo: string;
        generatedAt: string;
    } | null;
    nextRotationAt: string | null;
    rotationError?: string | undefined;
}>;
  "rotate": () => Promise<{
    policy: {
        autoRotate: boolean;
        renewBeforeDays: number;
    };
    certificate: {
        pem: string;
        fingerprint256: string;
        validFrom: string;
        validTo: string;
        generatedAt: string;
    } | null;
    nextRotationAt: string | null;
    rotationError?: string | undefined;
}>;
}

export interface HttpIngressV1 {
  "view": () => {
    entries: {
        name: string;
        protocol: "https" | "http";
        domainAlias: boolean;
        listenPort: number;
        pathPrefix: string;
        vmId: string;
        upstreamPort: number;
        healthPath: string;
        stripPrefix: boolean;
        clientAuth: {
            currentPem: string;
            currentCaPem?: string | undefined;
            replacementPem?: string | undefined;
            replacementCaPem?: string | undefined;
            rotateAt?: string | undefined;
        } | null;
        id: string;
        createdAt: string;
        updatedAt: string;
        health: {
            status: "stopped" | "healthy" | "unhealthy" | "unconfigured" | "checking";
            checkedAt?: string | undefined;
            httpStatus?: number | undefined;
            error?: string | undefined;
        };
        url: string;
    }[];
    listenerErrors: Record<string, string>;
};
  "aliasNames": () => string[];
  "action": (input: unknown) => Promise<{
    entries: {
        name: string;
        protocol: "https" | "http";
        domainAlias: boolean;
        listenPort: number;
        pathPrefix: string;
        vmId: string;
        upstreamPort: number;
        healthPath: string;
        stripPrefix: boolean;
        clientAuth: {
            currentPem: string;
            currentCaPem?: string | undefined;
            replacementPem?: string | undefined;
            replacementCaPem?: string | undefined;
            rotateAt?: string | undefined;
        } | null;
        id: string;
        createdAt: string;
        updatedAt: string;
        health: {
            status: "stopped" | "healthy" | "unhealthy" | "unconfigured" | "checking";
            checkedAt?: string | undefined;
            httpStatus?: number | undefined;
            error?: string | undefined;
        };
        url: string;
    }[];
    listenerErrors: Record<string, string>;
}>;
}

export interface LocalAliasesV1 {
  "view": () => Promise<{
    enabled: boolean;
    supported: boolean;
    aliases: string[];
    installed: string[];
    missing: string[];
    stale: string[];
    error?: string | undefined;
}>;
  "refresh": () => Promise<void>;
  "action": (input: unknown) => Promise<{
    enabled: boolean;
    supported: boolean;
    aliases: string[];
    installed: string[];
    missing: string[];
    stale: string[];
    error?: string | undefined;
}>;
}

export interface PipelinesV1 {
  readonly "jobs": JobsV1;
  "list": (id: string) => Promise<PipelineV1[]>;
  "save": (id: string, input: unknown) => Promise<{
    id: string;
    name: string;
    steps: {
        name: string;
        command: string;
        timeout: number;
    }[];
    artifacts: string[];
}>;
  "remove": (id: string, key: string) => Promise<{
    ok: boolean;
}>;
  "runs": (id: string) => Promise<PipelineRunV1[]>;
  "view": (id: string) => Promise<{
    projectId: string;
    pipelines: PipelineV1[];
    runs: PipelineRunV1[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  "run": (id: string, pipelineId: string) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  "artifact": (id: string, runId: string, index: number) => Promise<{
    file: string;
    name: string;
}>;
}

export interface NextFeaturesV1 {
  readonly "jobs": JobsV1;
  readonly "storageTiering": StorageTieringV1;
  readonly "serviceMesh": ServiceMeshV1;
  readonly "vtpmEnrollment": VtpmEnrollmentV1;
  readonly "acmeRenewal": AcmeRenewalV1;
  readonly "teamTemplates": TeamTemplatesV1;
  readonly "haFailureMonitor": HaFailureMonitorV1;
  "haPolicies": () => Promise<{
    [k: string]: NextSettingV1;
}>;
  "notebookLink": (id: string) => Promise<{
    provider: "jupyter" | "marimo";
    url: string;
}>;
  "browserIdeLink": (id: string) => Promise<{
    url: string;
    password: string;
    expiresAt: string;
}>;
  "catalog": () => Promise<{
    features: import("../../shared/catalogs/platform.ts").NextFeature[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    count: number;
    generatedAt: string;
}>;
  "view": (id: string) => Promise<{
    projectId: string;
    features: import("../../shared/catalogs/platform.ts").NextFeature[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    settings: {
        [x: string]: NextSettingV1;
    };
    records: Record<string, unknown>;
    haFailoverMonitor: {
        suspected: boolean;
        sampleIntervalSeconds: number;
        armed: boolean;
        consecutiveFailures: number;
        observedState: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
        observedAt: string;
        policyVersion?: string | undefined;
        lastHealthyAt?: string | undefined;
        suspectedAt?: string | undefined;
    } | null;
    haPromotion: {
        peerId: string;
        targetHostId: string;
        transferId: string;
        remoteVmId: string;
        snapshotId: string;
        sha256: string;
        fencedAt: string;
        status: "fenced" | "accepted";
        updatedAt: string;
        error?: string | undefined;
    } | null;
    haLocalFailover: {
        error: string | null;
    } | null;
    haHostFailover: {
        configured: boolean;
        armed: boolean;
        phase: string | null;
        targetVmId: string | null;
        failback: "pending" | "completed" | null;
        recoveryHeld: boolean;
        statusPending: boolean;
        error: string | null;
    } | null;
    executions: NextExecutionV1[];
    jobs: import("../../shared/contracts/jobs.ts").JobView[];
}>;
  "configure": (id: string, input: unknown) => Promise<NextSettingV1 | {
    enabled: boolean;
    options: {
        intervalHours: number;
    };
    updatedAt: string;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
}>;
  "action": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<import("../../shared/contracts/jobs.ts").JobView | {
    ready: boolean;
    executed: boolean;
    featureId: "ipv6" | "resource-presets" | "workspace-search" | "disk-analyzer" | "directory-history" | "format-lint" | "git-worktrees" | "dependency-report" | "runtime-matrix" | "reproducible-env" | "network-diagnostics" | "gpu-acceleration" | "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "syscall-profile" | "ssh-agent-forward" | "gpg-agent-forward" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "project-quota" | "guest-quota" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "network-quota" | "egress-policy" | "nat-hairpin" | "power-aware-schedule" | "host-disk-health" | "availability-report" | "global-dedup" | "audit-log" | "otel-tracing" | "dependency-bot" | "cpu-topology" | "device-profiles" | "resource-reservation" | "vcpu-hotplug" | "memory-hotplug" | "crash-loop-guard" | "maintenance-windows" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "patch-bundle" | "environment-recreate" | "editor-profiles" | "metrics-export" | "event-timeline" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "anomaly-detection" | "log-index" | "test-sharding" | "review-comments" | "command-forms" | "vm-dependency-start" | "environment-parity" | "test-matrix" | "cross-vm-copy" | "network-topology" | "packet-capture" | "reverse-tunnel" | "code-search-index" | "language-server-catalog" | "pii-classification";
    reason: string;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    previous: string;
    current: string;
    active: boolean;
    connectionPolicyActive: boolean;
    featureId: "network-quota";
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    current: string;
    active: boolean;
    connectionControlsAvailable: boolean;
    connectionPolicyActive: boolean;
    connectionRules: JumpV1[];
    reason?: undefined;
    featureId: "network-quota";
} | {
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number;
    reason?: undefined;
    featureId: "project-quota";
} | {
    reason?: string | undefined;
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number | null;
    phase: string;
    featureId: "project-quota";
} | {
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    hardMiB: number;
    active: boolean;
    report: string;
    reason: undefined;
    featureId: "guest-quota";
} | {
    ready: boolean;
    active: boolean;
    missing: string[];
    report: string;
    reason: string | undefined;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    projectLimitMiB: number | null;
    featureId: "guest-quota";
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    removed: number;
    featureId: "egress-policy";
    reason?: undefined;
} | {
    reason?: string | undefined;
    cleanupWarnings?: string[] | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    rules: JumpV1[];
    removed?: undefined;
    featureId: "egress-policy";
} | {
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        forwards: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        }[];
        selected: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        } | undefined;
        guestAddress: string;
    };
    exitCode: number;
    checkedAt: string;
    featureId: "nat-hairpin";
} | NextSettingV1 | {
    enabled: boolean;
    options: {
        intervalHours: number;
    };
    updatedAt: string;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
} | {
    ready: boolean;
    executed: boolean;
    retiredRemoteVmId: string;
    message: string;
} | {
    message: string;
    released?: boolean | undefined;
    retiredRemoteVmId?: string | undefined;
    failback?: "pending" | "completed" | undefined;
    recovered?: boolean | undefined;
    retiredVmIds?: string[] | undefined;
    ready: boolean;
    executed: boolean;
} | {
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    configVersion: string;
    networkIsolation: "host" | "private";
    message: string;
    stdout: string;
    stderr: string;
    code: number;
} | {
    code: number;
    stdout: string;
    stderr: string;
    ready: boolean;
    executed: boolean;
    profile: "restricted" | "networkless";
    timedOut: boolean;
    projectId: string;
    directory: string;
    networkIsolation: "host" | "private";
} | {
    ready: boolean;
    executed: boolean;
    reason: string;
    code: number;
} | {
    clipped: boolean;
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    samples: number;
    frameCount: number;
    topFrames: {
        name: string;
        count: number;
    }[];
    durationSeconds: number;
    frequencyHz: number;
    code: number;
    ready: boolean;
    executed: boolean;
} | {
    samples: number;
    stackCount: number;
    clipped: boolean;
    topSymbols: {
        name: string;
        count: number;
        percent: number;
    }[];
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    durationSeconds: number;
    frequencyHz: number;
    code: number;
    ready: boolean;
    executed: boolean;
} | {
    sha256: string;
    bytes: number;
    code: number;
    ready: boolean;
    executed: boolean;
    source: string;
    target: string;
} | {
    ready: boolean;
    executed: boolean;
    code: number;
    error?: string | undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    policy: {
        enabled: boolean;
        allowBatteryStarts: boolean;
        minimumBatteryPercent: number;
        stopBelowPercent: number;
    };
    sample: PowerSampleV1;
    decision: {
        allowStart: boolean;
        stop: boolean;
        reason: string;
    };
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    capacity: {
        freePercent: number | null;
        totalBytes: number;
        availableBytes: number;
    };
    thresholds: {
        minimumFreeGiB: number;
        minimumFreePercent: number;
        maximumTemperatureC: number;
        maximumWearPercent: number;
    };
    findings: {
        severity: "unknown" | "warning" | "critical";
        message: string;
        disk?: number | undefined;
    }[];
    status: string;
    volume: {
        health: string;
        operational: string[];
        filesystem: string;
    } | null;
    volumeError: string | null;
    disks: {
        number: number;
        name: string;
        bus: string;
        health: string;
        operational: string[];
        counters: {
            temperatureC: number | null;
            maximumTemperatureC: number | null;
            wearPercent: number | null;
            powerOnHours: number | null;
            readErrorsUncorrected: number | null;
            writeErrorsUncorrected: number | null;
        } | null;
        countersError: string | null;
    }[];
    checkedAt: string;
    directory: string;
    provider: string;
    code: number;
    ready: boolean;
    executed: boolean;
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    from: string;
    to: string;
    availablePercent: number | null;
    coveragePercent: number;
    observedSeconds: number;
    unknownSeconds: number;
    durationsSeconds: {
        [k: string]: number;
    };
    lastObservedAt: string | null;
    lastStatus: "error" | "unknown" | "running" | "stopped" | "starting" | "paused" | "stopping" | "unreachable";
    intervals: {
        start: string;
        end: string;
        status: "error" | "unknown" | "running" | "stopped" | "starting" | "paused" | "stopping" | "unreachable";
        seconds: number;
    }[];
    basis: string;
    code: number;
    ready: boolean;
    executed: boolean;
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    valid: true;
    sequence: number;
    hash: string;
    records: {
        sequence: number;
        previous: string;
        event: {
            time: string;
            kind: "job" | "request" | "connection";
            phase: "start" | "end";
            traceId: string;
            spanId: string;
            name: string;
            parentSpanId?: string | undefined;
            vmId?: string | undefined;
            projectId?: string | undefined;
            status?: number | undefined;
            jobId?: string | undefined;
            actorId?: string | undefined;
        };
        hash: string;
    }[];
    bytes: number;
    code: number;
    ready: boolean;
    executed: boolean;
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    policy: {
        enabled: boolean;
        windows: {
            days: number[];
            start: string;
            end: string;
            timeZone: string;
        }[];
    };
    active: boolean;
    sample?: undefined;
    decision?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    totalMatches: number;
    truncated: boolean;
    results: Record<string, any>[];
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    order: string[];
    started: string[];
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    results: Record<string, unknown>[];
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    equal: boolean;
    results: Record<string, unknown>[];
    differences: {
        vmId: unknown;
        projectId: unknown;
        fields: string[];
    }[];
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    order?: undefined;
    started?: undefined;
} | {
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    publishers: number;
    sources: number;
    installed: number;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
    executed: false;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    message: string;
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    executed: boolean;
    configPath: string;
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    records: {
        rotateDueAt: string;
        overdue: boolean;
        dueSoon: boolean;
        fingerprint: string;
        label: string;
        enrolledAt: string;
        rotateAfterDays: number;
        updatedAt: string;
    }[];
    overdueCount: number;
    dueSoonCount: number;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    usbController: boolean;
    pciHostSupported: boolean;
    message: string;
    device?: undefined;
    prerequisitesMet?: undefined;
    checks?: undefined;
    nextAction?: undefined;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    device: {
        kind: "usb";
        vendorId: number;
        productId: number;
    };
    prerequisitesMet: boolean;
    checks: {
        guestUsbController: boolean;
        hostDevicePresent: null;
        exclusiveAccess: null;
        guestDriver: null;
        linuxHost?: undefined;
        guestArchitecture?: undefined;
        iommuGroup?: undefined;
        groupMembers?: undefined;
    };
    nextAction: string | null;
    reason: string;
    message: string;
    usbController?: undefined;
    pciHostSupported?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    device: {
        kind: "pci";
        address: string;
    };
    prerequisitesMet: boolean;
    checks: {
        linuxHost: boolean;
        guestArchitecture: "x86_64" | "aarch64";
        hostDevicePresent: boolean;
        iommuGroup: string | null;
        groupMembers: {
            address: string;
            driver: string;
        }[];
        guestUsbController?: undefined;
        exclusiveAccess?: undefined;
        guestDriver?: undefined;
    };
    reason: string;
    message: string;
    usbController?: undefined;
    pciHostSupported?: undefined;
    nextAction?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    provider: "auto" | "cuda" | "rocm";
    reason: string;
    cuda?: undefined;
    rocm?: undefined;
    checkedAt?: undefined;
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    provider: "auto" | "cuda" | "rocm";
    cuda: ProbeV1 | null;
    rocm: ProbeV1 | null;
    checkedAt: string;
    message: string;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    vmId: string;
    vmName: string;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    audio: "none" | "hda-duplex";
    audioBackend: "none" | "dsound";
    support: Record<"none" | "dsound", AudioBackendSupportV1>;
    guest: {
        audio: string;
        video: string;
        error?: string | undefined;
    } | null;
    usb: {
        ready: boolean;
        hostDevices: string;
        hostError: string;
        rules: {
            id: string;
            vmId: string;
            vendorId: number;
            productId: number;
            createdAt: string;
            mediaKind?: "camera" | "microphone" | "headset" | undefined;
        }[];
        configured: DeviceV1[];
        events: {
            id: string;
            vmId: string;
            operation: "attach" | "detach";
            deviceId: string;
            vendorId: number;
            productId: number;
            source: "rule" | "manual";
            status: "failed" | "configured" | "requested";
            at: string;
            error?: string | undefined;
        }[];
    };
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    reason?: string | undefined;
    message: string;
    branchOrigin?: {
        sourceVmId: string;
        snapshotId: string;
        createdAt: string;
    } | undefined;
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    requirements: {
        cpus: number;
        memoryMiB: number;
    };
    scoredAt: string;
    candidates: {
        id: string;
        name: string;
        source: "local" | "peer";
        eligible: boolean;
        score: number | null;
        components: {
            memory: number;
            cpuLoad: number;
            instanceDensity: number;
        };
        reasons: string[];
        status: {
            version: 1;
            id: string;
            name: string;
            platform: string;
            arch: string;
            cpus: number;
            memoryTotal: number;
            memoryFree: number;
            load: number[];
            vmCount: number;
            runningVms: number;
            checkedAt: string;
        } | null;
        observedAt: number | null;
    }[];
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    sourceVmId: string;
    targetHostId: string;
    targetVmId: string;
    transferId: `${string}-${string}-${string}-${string}-${string}`;
    targetStatus: "running";
    sourceRetained: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    planned: boolean;
    sourceVmId: string;
    targetHostId: string | null;
    checkedAt: string;
    qemu: unknown;
    migration: unknown;
    candidates: {
        id: string;
        name: string;
        eligible: boolean;
        reasons: string[];
        platform: string | undefined;
        arch: string | undefined;
    }[];
    blockers: string[];
    steps: string[];
    reason: string;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    blockers: string[];
    reason: string;
    monitor: {
        suspected: boolean;
        sampleIntervalSeconds: number;
        armed: boolean;
        consecutiveFailures: number;
        observedState: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
        observedAt: string;
        policyVersion?: string | undefined;
        lastHealthyAt?: string | undefined;
        suspectedAt?: string | undefined;
    } | null;
    promotion: {
        peerId: string;
        targetHostId: string;
        transferId: string;
        remoteVmId: string;
        snapshotId: string;
        sha256: string;
        fencedAt: string;
        status: "fenced" | "accepted";
        updatedAt: string;
        error?: string | undefined;
    } | null;
    localFailover: {
        error: string | null;
    } | null;
    hostFailover: {
        configured: boolean;
        armed: boolean;
        phase: string | null;
        targetVmId: string | null;
        failback: "pending" | "completed" | null;
        recoveryHeld: boolean;
        statusPending: boolean;
        error: string | null;
    } | null;
    witness: {
        phase?: string | undefined;
        armed?: boolean | undefined;
        lastHeartbeatAt?: number | undefined;
        targetVmId?: string | null | undefined;
        targetHostId?: string | undefined;
        failureThreshold?: number | undefined;
        error?: string | null | undefined;
        failback?: {
            phase: "pending" | "completed";
            retiredVmId: string;
            requestedAt: number;
            completedAt: number | null;
        } | null | undefined;
        recoveryHeld?: boolean | undefined;
        recoveredRetiredVmIds?: string[] | undefined;
        configured: boolean;
    } | null;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    executed: boolean;
    checkedAt: string;
    localProcessReady: boolean;
    hostPlanReady: boolean;
    processObservedInSession: boolean;
    failureSuspected: boolean;
    policy: {
        failureThreshold: number;
        maxReplicaAgeMinutes: number;
        autoProcessFailover: boolean;
        autoHostFailover: boolean;
        targetHostId?: string | undefined;
    };
    source: {
        vmId: string;
        state: import("../../shared/contracts/vm.ts").VMStatus;
    };
    target: {
        hostId: string;
        name: string;
        eligible: boolean;
        reasons: string[];
        observedAt: number | null;
    } | null;
    replica: {
        transferId: string;
        peerId: string;
        snapshotId: string;
        remoteVmId: string | undefined;
        sha256: string | undefined;
        replicatedAt: string;
        ageMinutes: number | null;
        receiptVerified: boolean;
        standbyStatus: "error" | "running" | "stopped" | "starting" | "paused" | "stopping" | null;
    } | null;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    attached: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    checkedAt: string;
    host: {
        platform: NodeJS.Platform;
        qemuVirtioFs: boolean;
        qemuNineP: boolean;
        sharedMemory: boolean;
        virtiofsd: boolean;
    };
    guest: {
        virtioFsDriver: boolean;
        ninePDriver: boolean;
        mounts: {
            path: string;
            type: string;
            tag: string;
        }[];
    } | null;
    blockers: string[];
    reason: string;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    remoteId: string;
    metadata: {
        version: 1;
        sourceVmId: string;
        backupId: string;
        bytes: number;
        sha256: string;
        encrypted: boolean;
        createdAt: string;
        passwordSecret?: string | undefined;
        retainUntil?: string | undefined;
    };
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    remoteId: string;
    metadata: {
        version: 1;
        sourceVmId: string;
        backupId: string;
        bytes: number;
        sha256: string;
        encrypted: boolean;
        createdAt: string;
        passwordSecret?: string | undefined;
        retainUntil?: string | undefined;
    };
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    restoredVmId?: string | undefined;
    restoredName?: string | undefined;
    ready: boolean;
    executed: boolean;
    remoteId: string | undefined;
    verified: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    target?: {
        bucket: string;
        region: string;
        prefix: string;
        credentialSecret: string;
        autoUpload: boolean;
        endpoint?: string | undefined;
    } | undefined;
    sync?: {
        mirrored: Record<string, string>;
        lastAttemptAt?: string | undefined;
        lastSuccessAt?: string | undefined;
        lastError?: string | undefined;
    } | undefined;
    ready: boolean;
    executed: boolean;
    reason: string;
    entries?: undefined;
    remoteId?: undefined;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        credentialSecret: string;
        autoUpload: boolean;
        endpoint?: string | undefined;
    };
    sync?: undefined;
    entries?: undefined;
    remoteId?: undefined;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        credentialSecret: string;
        autoUpload: boolean;
        endpoint?: string | undefined;
    };
    sync: {
        mirrored: Record<string, string>;
        lastAttemptAt?: string | undefined;
        lastSuccessAt?: string | undefined;
        lastError?: string | undefined;
    };
    entries?: undefined;
    remoteId?: undefined;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        credentialSecret: string;
        autoUpload: boolean;
        endpoint?: string | undefined;
    };
    entries: {
        remoteId: string;
        metadata: {
            version: 1;
            sourceVmId: string;
            backupId: string;
            bytes: number;
            sha256: string;
            encrypted: boolean;
            createdAt: string;
            passwordSecret?: string | undefined;
            retainUntil?: string | undefined;
        };
    }[];
    sync?: undefined;
    remoteId?: undefined;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    remoteId: string;
    deleted: boolean;
    target?: undefined;
    sync?: undefined;
    entries?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    programs: {
        programId: string;
        executable: string;
        fixedArgs: string[];
        sha256: string;
    }[];
    programId?: undefined;
    sha256?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256: string;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256?: undefined;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    programId?: undefined;
    sha256?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    installed: boolean;
    reason: string | undefined;
    programId?: undefined;
    sha256?: undefined;
    enabled?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    command: string;
    programId?: undefined;
    sha256?: undefined;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    secret: string | undefined;
    publicKey: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    status: {
        active: boolean;
    };
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    config: {
        address: string;
        listenPort: number;
        privateKeySecret: string;
        peers: {
            publicKey: string;
            allowedIPs: string[];
            keepaliveSeconds: number;
            endpoint?: string | undefined;
        }[];
        enabled: boolean;
    };
    status?: undefined;
    lastAutoError?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    unchanged: boolean;
    template: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        createdAt: string;
        updatedAt: string;
    };
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    template: {
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        fingerprint: string;
        version: number;
        updatedAt: string;
        id: string;
        name: string;
        createdAt: string;
    };
    unchanged?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    deleted: string;
    templateId?: undefined;
    vmId?: undefined;
    vm?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    templateId: string;
    vmId: string;
    vm: import("../../shared/contracts/vm.ts").VMView;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    templates: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        createdAt: string;
        updatedAt: string;
    }[];
    name?: undefined;
    fingerprint?: undefined;
    previousFingerprint?: undefined;
    content?: undefined;
    excluded?: undefined;
    template?: undefined;
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    name: string;
    fingerprint: string;
    previousFingerprint: string | undefined;
    content: {
        resources: {
            cpus: number;
            memoryMiB: number;
            diskGiB: number;
            accelerator: "auto" | "tcg" | "whpx";
            distro: "alpine" | "debian" | "ubuntu";
            firmware: "bios" | "uefi";
            template: "none" | "node" | "python" | "rust";
            architecture?: "x86_64" | "aarch64" | undefined;
        };
        project: {
            directory: "/workspace";
            template: "none" | "node" | "python" | "rust";
            repository: string;
            previewPort?: number | undefined;
            networkIsolation?: "host" | "private" | undefined;
            runtimes?: {
                python?: string | undefined;
                node?: string | undefined;
            } | undefined;
        };
    };
    excluded: string[];
    templates?: undefined;
    template?: undefined;
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    template: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        createdAt: string;
        updatedAt: string;
    };
    message: string | undefined;
    templates?: undefined;
    name?: undefined;
    fingerprint?: undefined;
    previousFingerprint?: undefined;
    content?: undefined;
    excluded?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    ready: boolean;
    registered: number;
    reason?: string | undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    ready: boolean;
    devices: number;
    reason?: string | undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    ready: boolean;
    configured: boolean;
    anchoredSequence: number;
    reason?: string | undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        enabled: boolean;
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    phase: string;
    transferId: string;
    sourceVmId: string;
    remoteVmId: string;
    targetHostId: string;
    sourceRemoved: boolean;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    targetStart?: {
        id: string;
        status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
    } | undefined;
    message?: string | undefined;
    ready: boolean;
    executed: boolean;
    phase: string;
    transferId: string;
    sourceVmId: string;
    remoteVmId: string;
    targetHostId: string;
    sourceRemoved: boolean;
    queuePersisted: boolean;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    reason: string;
    queue: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        fingerprint: {
            recordHash: string;
            diskSize: number;
            diskMtimeMs: number;
        };
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
    target?: undefined;
    fingerprint?: undefined;
    sourceRemovalRequested?: undefined;
    targetStartRequested?: undefined;
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    target: {
        id: string;
        name: string;
        hostId: string;
        score: number | null;
    };
    fingerprint: MigrationFingerprintV1;
    sourceRemovalRequested: boolean;
    targetStartRequested: boolean;
    queue: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        fingerprint: {
            recordHash: string;
            diskSize: number;
            diskMtimeMs: number;
        };
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
    message: string;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    phase: string;
    completed: {
        sourceVmId: string;
        name: string;
        targetName: string;
        remoteVmId: string;
        sourceRemoved: boolean;
    }[];
    remainingSourceVms: number;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    ready: boolean;
    executed: boolean;
    machines: ({
        remoteVmId: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    } | {
        reason: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    })[];
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    reason: string;
    ready: boolean;
    executed: boolean;
    machines: ({
        remoteVmId: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    } | {
        reason: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    })[];
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    transferId: string;
    sourceVmId: string;
    snapshotId: string;
    remoteVmId: string;
    targetHostId: string;
    sha256: string | undefined;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    snapshot: {
        id: string;
        name: string;
        createdAt: string;
    };
    target: {
        id: string;
        hostId: string;
        name: string;
    };
    existingRemoteVmId: string | undefined;
    existingSha256: string | undefined;
    message: string;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    message: string;
    installed?: boolean | undefined;
    projectId?: string | undefined;
    provider?: "jupyter" | "marimo" | undefined;
    session?: {
        provider: "jupyter" | "marimo";
        status: string;
        hostPort: number;
        guestPort: number;
        directory?: string | undefined;
        startedAt?: string | undefined;
        needsReview?: boolean | undefined;
    } | null | undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    supported: boolean;
    installed: boolean;
    projectId: string;
    session: {
        directory: string;
        hostPort: number;
        guestPort: number;
        startedAt: string;
        expiresAt: string;
        status: string;
        needsReview: boolean;
    } | null;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    session: {
        status: string;
        hostPort: number;
        guestPort: number;
        expiresAt: string;
    };
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    currentPoolId: string | null;
    pendingCleanup: {
        vmId: string;
        sourcePoolId: string;
        targetPoolId: string;
        addedAt: string;
    }[];
    pools: {
        id: string;
        name: string;
        root: string;
        createdAt: string;
        available: boolean;
        totalBytes: number | null;
        freeBytes: number | null;
        allocatedBytes: number;
        vms: {
            id: string;
            name: string;
            diskBytes: number;
        }[];
    }[];
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    backups: {
        id: string;
        createdAt: string;
        bytes: number;
        encrypted: boolean | undefined;
        storage: "blocks" | undefined;
        verifiedAt: string | null;
    }[];
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    cleanupError?: string | undefined;
    error?: string | undefined;
    restoreMs: number | null;
    bootMs: number | null;
    totalMs: number;
    restoredName: string;
    temporaryVmId: string | null;
    temporaryVmRemoved: boolean;
    probeSha256?: string | undefined;
    ready: boolean;
    executed: boolean;
    backupId: string;
    probePath: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    checkedAt: string;
    qemuVersion: string;
    host: {
        platform: NodeJS.Platform;
        arch: NodeJS.Architecture;
    };
    probes: {
        devices: boolean;
        accelerators: boolean;
        machines: boolean;
    };
    matrix: {
        devices: RowV1[];
        accelerators: RowV1[];
        machines: RowV1[];
    };
    current: {
        accelerator: "tcg" | "whpx";
        networkCard: "virtio-net-pci" | "e1000";
        graphics: "none" | "virtio-gpu" | "virgl";
        selectedDevices: string[];
        cpuTopology: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | null;
        memoryHotplug: {
            maxMiB: number;
            slots: number;
        } | null;
        compatible: boolean;
        issues: string[];
    };
    limitation: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    support: {
        available: boolean;
        codeBytes: number | null;
        varsBytes: number | null;
        reason: string | null;
    };
    selected: "bios" | "uefi";
    message: string | null;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    forwards: {
        host: number;
        guest: number;
        name?: string | undefined;
    }[];
    message: string;
    support?: undefined;
    selected?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        delayMs: number;
        jitterMs: number;
        lossPercent: number;
    };
    reason: string;
    current?: undefined;
    netemActive?: undefined;
    previous?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        delayMs: number;
        jitterMs: number;
        lossPercent: number;
    };
    current: string;
    netemActive: boolean;
    reason?: undefined;
    previous?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        delayMs: number;
        jitterMs: number;
        lossPercent: number;
    };
    previous: string;
    current: string;
    netemActive: boolean;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    reason: string;
    exitCode: number;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    source: string;
    nameservers: string[];
    searchDomains: string[];
    routingDomains: string[];
    dnssecTools: string[];
    dnssecState: string | null;
    dnssecValidation: "not-verified";
    ready: boolean;
    executed: boolean;
    checkedAt: string;
    reason?: undefined;
    exitCode?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    cpuExtension: string | null;
    kvmDevice: boolean;
    nestedCandidate: boolean;
    kernel: string;
    accelerator: "tcg" | "whpx" | null;
    checkedAt: string;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    locked: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: string;
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    reason: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    plan: {
        rpoMinutes: number;
        rtoMinutes: number;
        retentionDays: number;
        backupGiB: number;
        bandwidthMbps: number;
        backupIntervalMinutes: number;
    };
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    probePassed: boolean;
    reason: string;
    output?: undefined;
    exitCode?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    record: unknown;
    reason: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
}>;
}

export interface ProjectFilesV1 {
  "scan": (id: string, query?: string, content?: boolean, signal?: AbortSignal | undefined) => Promise<{
    root: string;
    files: ProjectFileV1[];
    matches: SearchMatchV1[];
    scanned: number;
    truncated: boolean;
}>;
}

export interface WorkspacesV1 {
  readonly "jobs": JobsV1;
  readonly "projects": ProjectCatalogV1;
  "beforeAction": (hook: (id: string, action: "start" | "stop", service?: string | undefined) => Promise<(success: boolean) => void>) => () => void;
  "onConfigChange": (listener: () => Promise<void>) => () => void;
  "beforeConfigChange": (guard: (id: string, previous: ProjectV1, next: ProjectV1) => Promise<void>) => () => void;
  "config": (id: string) => Promise<ProjectV1>;
  "readCommittedConfig": (id: string) => Promise<ProjectV1>;
  "networkEnvironment": (id: string) => Promise<{}>;
  "dependencyDownloadAuthentication": (id: string, manager: "npm" | "pip") => Promise<ResolvedDependencyAuthenticationV1 | undefined>;
  "repositoryDownloadAuthentication": (id: string, repository: string) => Promise<ResolvedDependencyAuthenticationV1 | undefined>;
  "resolvedConfig": (id: string) => Promise<ProjectV1>;
  "resolveProject": (id: string, project: ProjectV1) => Promise<ProjectV1>;
  "save": (id: string, input: unknown, allowedDirectory?: string | undefined, expectedVersion?: string | undefined, commitGuard?: (() => void) | undefined) => Promise<{
    directory: string;
    template: "none" | "node" | "python" | "rust";
    repository: string;
    setup: string;
    command: string;
    previewPort?: number | undefined;
    networkIsolation?: "host" | "private" | undefined;
    environment?: Record<string, string> | undefined;
    secrets?: Record<string, string> | undefined;
    runtimes?: {
        python?: string | undefined;
        node?: string | undefined;
    } | undefined;
    services?: {
        name: string;
        command: string;
        dependsOn: string[];
        ready: string;
        timeout: number;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        health?: {
            command: string;
            interval: number;
            timeout: number;
            failures: number;
            restart: boolean;
            maxRestarts: number;
            backoff: number;
        } | undefined;
    }[] | undefined;
}>;
  "view": (id: string) => Promise<{
    project: ProjectV1;
    version: string;
    projectId: string;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  "run": (id: string, action: "start" | "stop" | "setup" | "terminal", service?: string | undefined, automatic?: boolean) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  "runtime": (id: string, signal?: AbortSignal | undefined) => Promise<ProjectRuntimeV1>;
  "metrics": (id: string) => Promise<{
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes: number | null;
    networkTransmittedBytes: number | null;
    networkInterfaces: {
        name: string;
        receivedBytes: number;
        transmittedBytes: number;
    }[];
    networkReceiveBytesPerSecond: number | null;
    networkTransmitBytesPerSecond: number | null;
    processes: {
        name: string;
        memory: number;
    }[];
    uptime: number;
    sampledAt: string;
}>;
}

export interface RecipesV1 {
  "export": (id: string) => Promise<{
    version: 1;
    resources: {
        cpus?: number | undefined;
        memoryMiB?: number | undefined;
        diskGiB?: number | undefined;
        accelerator?: "auto" | "tcg" | "whpx" | undefined;
        distro?: "alpine" | "debian" | "ubuntu" | undefined;
        template?: "none" | "node" | "python" | "rust" | undefined;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
    };
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
}>;
  "read": (id: string) => Promise<{
    version: 1;
    resources: {
        cpus?: number | undefined;
        memoryMiB?: number | undefined;
        diskGiB?: number | undefined;
        accelerator?: "auto" | "tcg" | "whpx" | undefined;
        distro?: "alpine" | "debian" | "ubuntu" | undefined;
        template?: "none" | "node" | "python" | "rust" | undefined;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
    };
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
}>;
  "write": (id: string) => Promise<{
    version: 1;
    resources: {
        cpus?: number | undefined;
        memoryMiB?: number | undefined;
        diskGiB?: number | undefined;
        accelerator?: "auto" | "tcg" | "whpx" | undefined;
        distro?: "alpine" | "debian" | "ubuntu" | undefined;
        template?: "none" | "node" | "python" | "rust" | undefined;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
    };
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
}>;
  "create": (name: string, value: unknown) => Promise<import("../../shared/contracts/vm.ts").VMView>;
  "apply": (id: string, input: unknown) => Promise<{
    project: ProjectV1;
    version: string;
    projectId: string;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
}

export interface RuntimeVersionsV1 {
  readonly "jobs": JobsV1;
  "probe": (id: string, signal?: AbortSignal | undefined) => Promise<{
    selected: {
        python?: string | undefined;
        node?: string | undefined;
    };
    declared: {
        node?: string | undefined;
        python?: string | undefined;
    };
    actual: {
        node: string;
        python: string;
    };
    mismatches: ("node" | "python")[];
    probe: {
        errorCode?: string | undefined;
        state: RuntimeProbeStateV1;
        checkedAt: string | null;
        configVersion: string | null;
        bootId: string | null;
    };
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  "inspect": (id: string, project: ProjectV1, signal?: AbortSignal | undefined) => Promise<{
    node: string;
    python: string;
}>;
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<{
    selected: {
        python?: string | undefined;
        node?: string | undefined;
    };
    declared: {
        node?: string | undefined;
        python?: string | undefined;
    };
    actual: {
        node: string;
        python: string;
    };
    mismatches: ("node" | "python")[];
    probe: {
        errorCode?: string | undefined;
        state: RuntimeProbeStateV1;
        checkedAt: string | null;
        configVersion: string | null;
        bootId: string | null;
    };
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  "select": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<{
    directory: string;
    template: "none" | "node" | "python" | "rust";
    repository: string;
    setup: string;
    command: string;
    previewPort?: number | undefined;
    networkIsolation?: "host" | "private" | undefined;
    environment?: Record<string, string> | undefined;
    secrets?: Record<string, string> | undefined;
    runtimes?: {
        python?: string | undefined;
        node?: string | undefined;
    } | undefined;
    services?: {
        name: string;
        command: string;
        dependsOn: string[];
        ready: string;
        timeout: number;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        health?: {
            command: string;
            interval: number;
            timeout: number;
            failures: number;
            restart: boolean;
            maxRestarts: number;
            backoff: number;
        } | undefined;
    }[] | undefined;
}>;
  "install": (id: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface SandboxesV1 {
  readonly "jobs": JobsV1;
  "artifact": (runId: string, artifactId: string) => Promise<{
    base64: string;
    id: string;
    name: string;
    path: string;
    bytes: number;
    sha256: string;
}>;
  "view": (id: string) => Promise<SandboxViewV1>;
  "list": () => Promise<SandboxOverviewV1>;
  "create": (input: unknown) => Promise<SandboxViewV1>;
  "control": (id: string, action: "start" | "stop" | "destroy") => Promise<{
    ok: true;
}>;
  "run": (id: string, input: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface SecretsV1 {
  "list": (id: string) => Promise<{
    name: string;
    updatedAt: string;
}[]>;
  "rotation": (id: string) => Promise<SecretRotationItemV1[]>;
  "setRotation": (id: string, input: unknown) => Promise<SecretRotationItemV1[]>;
  "save": (id: string, input: unknown) => Promise<{
    name: string;
    updatedAt: string;
}[]>;
  "remove": (id: string, name: string) => Promise<{
    name: string;
    updatedAt: string;
}[]>;
  "value": (id: string, name: string) => Promise<string>;
  "resolve": (id: string, refs?: Record<string, string>) => Promise<any>;
}

export interface ServiceHealthV1 {
  readonly "jobs": JobsV1;
  "expect": (id: string, action: "start" | "stop", service?: string | undefined) => Promise<(success: boolean) => void>;
  "view": (id: string) => Promise<{
    services: HealthViewV1[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  "observed": (id: string) => {
    projectId: string;
    name: string;
    desired: boolean;
    status: "stopped" | "healthy" | "unhealthy" | "waiting" | "restarting" | "exhausted";
    failures: number;
    restarts: number;
    checkedAt?: string | undefined;
    nextCheck: number;
    error?: string | undefined;
}[];
  "tick": (now?: number) => Promise<void>;
}

export interface BundlesV1 {
  "export": (id: string, target: import("stream").Writable, headers: () => void, signal?: AbortSignal | undefined, bytesPerSecond?: number, snapshotId?: string | undefined, onCleanupError?: ((error: unknown) => void) | undefined) => Promise<string>;
  "withExportBudget": <T>(id: string, signal: AbortSignal, work: (diskBytes: number, exportFile: (target: import("stream").Writable, headers: () => void, bytesPerSecond?: number | undefined, onCleanupError?: ((error: unknown) => void) | undefined) => Promise<string>) => Promise<T>, storage?: StorageRuntimeV1, snapshotId?: string | undefined) => Promise<T>;
  "import": (name: string, source: import("stream").Readable, signal?: AbortSignal | undefined, beforeAdopt?: (() => void) | undefined, migrationOrigin?: {
    sourceHostId: string;
    transferId: string;
    targetName: string;
    sourceVmId?: string | undefined;
    snapshotId?: string | undefined;
    diskSha256?: string | undefined;
} | undefined, onCleanupError?: ((error: unknown) => void) | undefined, lease?: {
    id: string;
    release: () => void;
    assertActive: (checkSignal?: boolean) => void;
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    releaseTemporary: (path: string) => Promise<void>;
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    transfer: (owner: string) => void;
} | undefined) => Promise<import("../../shared/contracts/vm.ts").VMView>;
  "importExternal": (name: string, source: import("stream").Readable, signal?: AbortSignal | undefined, lease?: {
    id: string;
    release: () => void;
    assertActive: (checkSignal?: boolean) => void;
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    releaseTemporary: (path: string) => Promise<void>;
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    transfer: (owner: string) => void;
} | undefined) => Promise<import("../../shared/contracts/vm.ts").VMView>;
  "withDisk": <T>(source: import("stream").Readable, signal: AbortSignal, work: (disk: string, diskEncryption?: import("../../shared/contracts/vm.ts").DiskEncryptionConfig | undefined) => Promise<T>, lease?: {
    id: string;
    release: () => void;
    assertActive: (checkSignal?: boolean) => void;
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    releaseTemporary: (path: string) => Promise<void>;
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    transfer: (owner: string) => void;
} | undefined) => Promise<T>;
  "clone": (id: string, name: string, snapshot?: string | undefined, signal?: AbortSignal | undefined) => Promise<import("../../shared/contracts/vm.ts").VMView>;
}

export interface SignedBundlesV1 {
  "view": () => {
    revision: number;
    requireTrustedOnImport: boolean;
    localKey: {
        name: string;
        fingerprint: string;
        publicKey: string;
    } | null;
    trustedKeys: {
        name: string;
        fingerprint: string;
        publicKey: string;
    }[];
};
  "signManifest": <T extends Record<string, unknown>>(manifest: T) => T & {
    signature?: {
        algorithm: "Ed25519";
        publicKey: string;
        value: string;
    } | undefined;
};
  "authorizeExternal": (signature?: {
    algorithm: "Ed25519";
    publicKey: string;
    value: string;
} | undefined) => void;
  "withAuthorizedExternal": <T>(signature: {
    algorithm: "Ed25519";
    publicKey: string;
    value: string;
} | undefined, publish: () => Promise<T>) => Promise<T>;
  "action": (input: unknown) => Promise<{
    revision: number;
    requireTrustedOnImport: boolean;
    localKey: {
        name: string;
        fingerprint: string;
        publicKey: string;
    } | null;
    trustedKeys: {
        name: string;
        fingerprint: string;
        publicKey: string;
    }[];
}>;
}

export interface GoldenImagesV1 {
  readonly "jobs": JobsV1;
  "view": () => Promise<{
    templates: {
        version: 1;
        id: string;
        name: string;
        note: string;
        createdAt: string;
        sourceId: string;
        sourceName: string;
        distro: "alpine" | "debian" | "ubuntu";
        diskGiB: number;
        bytes: number;
        sha256: string;
        architecture?: "x86_64" | "aarch64" | undefined;
    }[];
    issues: {
        id: string;
        error: string;
    }[];
    limits: {
        count: number;
        bytes: number;
        imageBytes: number;
    };
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    persistenceError: string | undefined;
}>;
  "action": (raw: unknown, signal?: AbortSignal | undefined) => Promise<{
    kind: "template" | "vm" | "verified" | "deleted";
    id: string;
}>;
}

export interface RescueV1 {
  readonly "jobs": JobsV1;
  "view": (id: string) => {
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    persistenceError: string | undefined;
};
  "artifact": (id: string, run: string, artifact: string) => Promise<{
    base64: string;
    id: string;
    name: string;
    path: string;
    bytes: number;
    sha256: string;
}>;
  "run": (id: string, input: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface SnapshotDiffV1 {
  readonly "jobs": JobsV1;
  "view": (id: string) => {
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    persistenceError: string | undefined;
};
  "run": (id: string, raw: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface SnapshotMergeV1 {
  readonly "jobs": JobsV1;
  "view": (id: string) => {
    persistenceError?: string | undefined;
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    sourceName?: string | undefined;
    branchOrigin?: {
        sourceVmId: string;
        snapshotId: string;
        createdAt: string;
    } | undefined;
};
  "run": (id: string, raw: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface FolderSyncV1 {
  "recoveryTickets": () => Promise<DomainRecoveryTicket[]>;
  "recoverTicket": (ticket: DomainRecoveryTicket) => Promise<void>;
  readonly "jobs": JobsV1;
  "config": (id: string) => Promise<{
    host: string;
    guest: string;
    auto: boolean;
    mergeText?: boolean | undefined;
    detectRenames?: boolean | undefined;
    rollback?: boolean | undefined;
    watch?: boolean | undefined;
    policies?: {
        pattern: string;
        direction: "readonly" | "push" | "pull" | "both";
        guestMode?: string | undefined;
    }[] | undefined;
    drivers?: {
        pattern: string;
        mode: "manual" | "keep-both" | "prefer-host" | "prefer-guest" | "merge-text";
    }[] | undefined;
    window?: {
        days: number[];
        start: string;
        end: string;
        timeZone: string;
    } | undefined;
    bandwidthMiBps?: number | undefined;
    ignore?: string[] | undefined;
} | null>;
  "save": (id: string, input: unknown) => Promise<{
    host: string;
    guest: string;
    auto: boolean;
    mergeText?: boolean | undefined;
    detectRenames?: boolean | undefined;
    rollback?: boolean | undefined;
    watch?: boolean | undefined;
    policies?: {
        pattern: string;
        direction: "readonly" | "push" | "pull" | "both";
        guestMode?: string | undefined;
    }[] | undefined;
    drivers?: {
        pattern: string;
        mode: "manual" | "keep-both" | "prefer-host" | "prefer-guest" | "merge-text";
    }[] | undefined;
    window?: {
        days: number[];
        start: string;
        end: string;
        timeZone: string;
    } | undefined;
    bandwidthMiBps?: number | undefined;
    ignore?: string[] | undefined;
}>;
  "view": (id: string) => Promise<{
    projectId: string;
    config: {
        host: string;
        guest: string;
        auto: boolean;
        mergeText?: boolean | undefined;
        detectRenames?: boolean | undefined;
        rollback?: boolean | undefined;
        watch?: boolean | undefined;
        policies?: {
            pattern: string;
            direction: "readonly" | "push" | "pull" | "both";
            guestMode?: string | undefined;
        }[] | undefined;
        drivers?: {
            pattern: string;
            mode: "manual" | "keep-both" | "prefer-host" | "prefer-guest" | "merge-text";
        }[] | undefined;
        window?: {
            days: number[];
            start: string;
            end: string;
            timeZone: string;
        } | undefined;
        bandwidthMiBps?: number | undefined;
        ignore?: string[] | undefined;
    } | null;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    queue: {
        id: string;
        requestedAt: string;
        attempts: number;
        nextAttemptAt: number;
        jobId?: string | undefined;
        lastError?: string | undefined;
    } | null;
    maintenance: boolean;
    history: SyncHistoryViewV1[];
    watching: SyncWatchViewV1 | null;
}>;
  "queue": (id: string, cancel?: boolean) => Promise<{
    id: string;
    requestedAt: string;
    attempts: number;
    nextAttemptAt: number;
    jobId?: string | undefined;
    lastError?: string | undefined;
} | null>;
  "tick": (now?: number, signal?: AbortSignal | undefined) => Promise<void>;
  "preview": (id: string, signal?: AbortSignal) => Promise<SyncPreviewV1>;
  "mergePreview": (id: string, inputPath: string, token: string, signal?: AbortSignal) => Promise<{
    path: string;
    token: string;
    base: string;
    ours: string;
    theirs: string;
}>;
  "run": (id: string, direction: "push" | "pull" | "both", token?: string | undefined, decisions?: SyncDecisionsV1, merges?: SyncManualMergesV1) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  "rollback": (id: string, checkpoint: string) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface ProjectTerminalsV1 {
  "workspaces": Readonly<Pick<WorkspacesV1, "view" | "jobs" | "projects" | "beforeAction" | "onConfigChange" | "beforeConfigChange" | "config" | "readCommittedConfig" | "networkEnvironment" | "dependencyDownloadAuthentication" | "repositoryDownloadAuthentication" | "resolvedConfig" | "resolveProject" | "save" | "run" | "runtime" | "metrics">>;
  "preparation": ProjectPreparationV1;
  "prepareTask": (id: string, projectId: string | null | undefined, signal?: AbortSignal | undefined, options?: {
    verifyOnly?: boolean | undefined;
}) => Promise<PreparedProjectV1>;
  "prepare": (id: string, projectId: string | null | undefined, session?: string | null | undefined, readOnly?: boolean, signal?: AbortSignal | undefined, expectedTerminalId?: string | undefined, options?: {
    mode?: "task" | undefined;
    verifyOnly?: boolean | undefined;
}) => Promise<PreparedProjectV1>;
  "validate": (id: string, projectId: string | undefined, session: string) => Promise<{
    projectId: string;
    terminalId: string;
}>;
  "stop": (id: string, projectId: string, session?: string | undefined, signal?: AbortSignal | undefined) => Promise<void>;
  "close": () => Promise<void>;
}

export interface ToolchainsV1 {
  readonly "jobs": JobsV1;
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<{
    tools: {
        id: string;
        name: "Go" | "Git" | "Node.js / npm" | "Python / pip" | "Rust / Cargo" | "Java JDK" | "PHP";
        installed: boolean;
        version: string;
        required: boolean;
    }[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  "install": (id: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface DownloadsV1 {
  readonly "jobs": JobsV1;
  "issue": (id: string, input: unknown) => Promise<{
    url: string;
    expiresAt: number;
}>;
  "issueLocal": (id: string, file: {
    path: string;
    name: string;
}) => Promise<{
    url: string;
    expiresAt: number;
}>;
  "issueStream": (id: string, content: StreamDownloadV1 & {
    name: string;
}) => {
    url: string;
    expiresAt: number;
};
  "route": (req: import("http").IncomingMessage, res: import("http").ServerResponse<import("http").IncomingMessage>, url: URL) => Promise<boolean>;
  "send": (target: DownloadTargetV1, res: import("http").ServerResponse<import("http").IncomingMessage>) => Promise<void>;
}

export interface SessionLockV1 {
  "view": () => import("../../shared/session-lock.ts").SessionLockView;
  "getGeneration": () => number;
  "requireUnlocked": () => void;
  "activity": () => import("../../shared/session-lock.ts").SessionLockView;
  "lock": () => import("../../shared/session-lock.ts").SessionLockView;
  "configure": (input: unknown) => Promise<import("../../shared/session-lock.ts").SessionLockView>;
  "unlock": (input: unknown) => Promise<import("../../shared/session-lock.ts").SessionLockView>;
  "unlockWithPasskey": (expectedGeneration: number) => Promise<import("../../shared/session-lock.ts").SessionLockView>;
}

export interface AccessControlV1 {
  readonly "enabled": boolean;
  "status": () => {
    enabled: boolean;
};
  "users": () => {
    id: string;
    username: string;
    role: "member" | "owner" | "viewer";
    vmIds: string[];
    expiresAt: number | null;
    createdAt: string;
}[];
  "passkeysFor": (accountId: string) => {
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt?: string | undefined;
}[];
  "registeredPasskeysFor": (accountId: string) => {
    id: string;
    publicKey: string;
    counter: number;
    transports: string[];
    name: string;
    createdAt: string;
    lastUsedAt?: string | undefined;
}[];
  "getPasskey": (id: string) => {
    user: {
        id: string;
        username: string;
        role: "member" | "owner" | "viewer";
        credential: {
            salt: string;
            hash: string;
        };
        vmIds: string[];
        expiresAt: number | null;
        createdAt: string;
        passkeys: {
            id: string;
            publicKey: string;
            counter: number;
            transports: string[];
            name: string;
            createdAt: string;
            lastUsedAt?: string | undefined;
        }[];
    };
    key: {
        id: string;
        publicKey: string;
        counter: number;
        transports: string[];
        name: string;
        createdAt: string;
        lastUsedAt?: string | undefined;
    };
} | null;
  "enable": (input: unknown) => Promise<{
    enabled: boolean;
}>;
  "login": (input: unknown) => Promise<{
    token: string;
    principal: PrincipalV1;
}>;
  "completeFederatedLogin": (accountId: string, credentialId: string) => Promise<{
    token: string;
    principal: PrincipalV1;
}>;
  "revokeFederatedCredential": (credentialId: string) => number;
  "authorize": (value: unknown) => PrincipalV1;
  "logout": (value: unknown) => {
    ok: boolean;
};
  "revokeAll": () => void;
  "createHandoff": (sourceToken: unknown) => Promise<{
    code: string;
    expiresAt: number;
}>;
  "cancelHandoff": (sourceToken: unknown) => {
    cancelled: boolean;
};
  "redeemHandoff": (input: unknown) => Promise<{
    sourceToken: string;
    token: string;
    principal: PrincipalV1;
}>;
  "createViewer": (input: unknown) => Promise<{
    id: string;
    username: string;
    role: "member" | "owner" | "viewer";
    vmIds: string[];
    expiresAt: number | null;
    createdAt: string;
}>;
  "createMember": (input: unknown) => Promise<{
    id: string;
    username: string;
    role: "member" | "owner" | "viewer";
    vmIds: string[];
    expiresAt: number | null;
    createdAt: string;
}>;
  "removeViewer": (id: string) => Promise<{
    removed: string;
}>;
  "removeMember": (id: string) => Promise<{
    removed: string;
}>;
  "addPasskey": (accountId: string, input: unknown) => Promise<{
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt?: string | undefined;
}>;
  "removePasskey": (accountId: string, id: string) => Promise<{
    removed: string;
}>;
  "completePasskeyLogin": (accountId: string, id: string, previousCounter: number, newCounter: number) => Promise<{
    token: string;
    principal: PrincipalV1;
}>;
  "changeOwnerPassword": (input: unknown) => Promise<{
    changed: boolean;
}>;
}

export interface PasskeysV1 {
  "beginRegistration": (principal: PrincipalV1, input: unknown) => Promise<{
    ceremonyId: string;
    options: import("@simplewebauthn/server").PublicKeyCredentialCreationOptionsJSON;
}>;
  "finishRegistration": (principal: PrincipalV1, input: unknown) => Promise<{
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt?: string | undefined;
}>;
  "beginAuthentication": () => Promise<{
    ceremonyId: string;
    options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON;
}>;
  "beginUnlock": (lockGeneration: number) => Promise<{
    ceremonyId: string;
    options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON;
}>;
  "finishAuthentication": (input: unknown) => Promise<{
    token: string;
    principal: PrincipalV1;
}>;
  "finishUnlock": (input: unknown) => Promise<{
    login: {
        token: string;
        principal: PrincipalV1;
    };
    lockGeneration: number | undefined;
}>;
}

export interface SingleSignOnV1 {
  "cancelPending": () => void;
  "pendingOrigin": (providerId: "oidc" | "saml", state: string) => string | null;
  "providers": () => {
    oidc: boolean;
    saml: boolean;
};
  "view": (accountId?: string | undefined) => {
    oidc: {
        issuer: string;
        clientId: string;
        authMethod: "none" | "client_secret_basic" | "client_secret_post";
        hasSecret: boolean;
    } | undefined;
    saml: {
        issuer: string;
        entryPoint: string;
        fingerprints: string[];
    } | undefined;
    callbackUrl: string;
    samlCallbackUrl: string;
    serviceProviderId: string;
    bindings: {
        id: string;
        provider: "oidc" | "saml";
        accountId: string;
        issuer: string;
        subject: string;
        createdAt: string;
    }[];
};
  "configureOidc": (raw: unknown) => Promise<{
    oidc: {
        issuer: string;
        clientId: string;
        authMethod: "none" | "client_secret_basic" | "client_secret_post";
        hasSecret: boolean;
    } | undefined;
    saml: {
        issuer: string;
        entryPoint: string;
        fingerprints: string[];
    } | undefined;
    callbackUrl: string;
    samlCallbackUrl: string;
    serviceProviderId: string;
    bindings: {
        id: string;
        provider: "oidc" | "saml";
        accountId: string;
        issuer: string;
        subject: string;
        createdAt: string;
    }[];
}>;
  "configureSaml": (raw: unknown) => Promise<{
    oidc: {
        issuer: string;
        clientId: string;
        authMethod: "none" | "client_secret_basic" | "client_secret_post";
        hasSecret: boolean;
    } | undefined;
    saml: {
        issuer: string;
        entryPoint: string;
        fingerprints: string[];
    } | undefined;
    callbackUrl: string;
    samlCallbackUrl: string;
    serviceProviderId: string;
    bindings: {
        id: string;
        provider: "oidc" | "saml";
        accountId: string;
        issuer: string;
        subject: string;
        createdAt: string;
    }[];
}>;
  "disable": (providerId: "oidc" | "saml") => Promise<{
    oidc: {
        issuer: string;
        clientId: string;
        authMethod: "none" | "client_secret_basic" | "client_secret_post";
        hasSecret: boolean;
    } | undefined;
    saml: {
        issuer: string;
        entryPoint: string;
        fingerprints: string[];
    } | undefined;
    callbackUrl: string;
    samlCallbackUrl: string;
    serviceProviderId: string;
    bindings: {
        id: string;
        provider: "oidc" | "saml";
        accountId: string;
        issuer: string;
        subject: string;
        createdAt: string;
    }[];
}>;
  "begin": (raw: unknown, sourceToken?: string | undefined) => Promise<{
    redirect: string;
    state: string;
    expiresAt: number;
}>;
  "completeOidc": (callback: URL) => Promise<{
    origin: string;
    state: string;
    result: {
        token: string;
        principal: PrincipalV1;
    } | {
        linked: boolean;
        binding: {
            createdAt: string;
            issuer: string;
            subject: string;
            id: `${string}-${string}-${string}-${string}-${string}`;
            provider: "oidc" | "saml";
            accountId: string;
        };
    };
}>;
  "completeSaml": (input: {
    SAMLResponse: string;
    RelayState: string;
}) => Promise<{
    origin: string;
    state: string;
    result: {
        token: string;
        principal: PrincipalV1;
    } | {
        linked: boolean;
        binding: {
            createdAt: string;
            issuer: string;
            subject: string;
            id: `${string}-${string}-${string}-${string}-${string}`;
            provider: "oidc" | "saml";
            accountId: string;
        };
    };
}>;
  "unlink": (accountId: string, providerId: "oidc" | "saml") => Promise<{
    removed: number;
}>;
}

export interface TerminalSharingV1 {
  "list": (accountId?: string | undefined, vmId?: string | undefined, projectId?: string | undefined) => {
    id: string;
    vmId: string;
    session: string;
    viewerId: string;
    createdAt: string;
    expiresAt: number;
    projectId?: string | undefined;
    terminalId?: string | undefined;
}[];
  "find": (viewerId: string, vmId: string, session: string, projectId?: string | null | undefined) => {
    id: string;
    vmId: string;
    session: string;
    viewerId: string;
    createdAt: string;
    expiresAt: number;
    projectId?: string | undefined;
    terminalId?: string | undefined;
} | null;
  "create": (input: unknown) => Promise<{
    id: string;
    vmId: string;
    session: string;
    viewerId: string;
    createdAt: string;
    expiresAt: number;
    projectId?: string | undefined;
    terminalId?: string | undefined;
}>;
  "revoke": (id: string) => Promise<{
    revoked: string;
}>;
  "revokeViewer": (viewerId: string) => Promise<void>;
}

export interface JitPrivilegesV1 {
  "list": (principal: PrincipalV1) => {
    status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed";
    id: string;
    viewerId: string;
    vmId: string;
    operation: "start" | "stop";
    reason: string;
    createdAt: number;
    requestExpiresAt: number;
    approvedBy?: string | undefined;
    approvedAt?: number | undefined;
    expiresAt?: number | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}[];
  "create": (principal: PrincipalV1, input: unknown) => Promise<{
    status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed";
    id: string;
    viewerId: string;
    vmId: string;
    operation: "start" | "stop";
    reason: string;
    createdAt: number;
    requestExpiresAt: number;
    approvedBy?: string | undefined;
    approvedAt?: number | undefined;
    expiresAt?: number | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
  "decide": (principal: PrincipalV1, id: string, input: unknown) => Promise<{
    status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed";
    id: string;
    viewerId: string;
    vmId: string;
    operation: "start" | "stop";
    reason: string;
    createdAt: number;
    requestExpiresAt: number;
    approvedBy?: string | undefined;
    approvedAt?: number | undefined;
    expiresAt?: number | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
  "execute": (principal: PrincipalV1, id: string) => Promise<{
    status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed";
    id: string;
    viewerId: string;
    vmId: string;
    operation: "start" | "stop";
    reason: string;
    createdAt: number;
    requestExpiresAt: number;
    approvedBy?: string | undefined;
    approvedAt?: number | undefined;
    expiresAt?: number | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
}

export interface BrowserExtensionsV1 {
  "list": (ownerId: string) => {
    connected: boolean;
    expired: boolean;
    permissions: string[];
    id: string;
    origin: string;
    ownerId: string;
    createdAt: number;
    expiresAt: number;
    lastSeenAt?: number | undefined;
}[];
  "createPairing": (ownerId: string) => {
    code: string;
    expiresAt: number;
    permissions: string[];
};
  "connect": (originValue: unknown, input: unknown) => Promise<{
    token: string;
    id: string;
    expiresAt: number;
    permissions: string[];
}>;
  "authorize": (originValue: unknown, token: unknown) => {
    id: string;
    expiresAt: number;
    permissions: string[];
};
  "revoke": (ownerId: string, id: string) => Promise<{
    revoked: string;
}>;
  "revokeAll": () => Promise<void>;
}

export interface RemoteAuditLockV1 {
  "status": () => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
  "configure": (input: unknown, signal?: AbortSignal | undefined) => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
  "disable": () => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
  "verify": (signal?: AbortSignal | undefined) => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
  "sync": (signal?: AbortSignal | undefined) => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
}

export interface FeatureRolloutsV1 {
  "decision": (id: string, draft?: {
    pluginId: string;
    enabled: boolean;
    percentage: number;
    cohortVersion: string;
} | undefined) => {
    policy?: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
    } | undefined;
    pluginId: string;
    allowed: boolean;
    bucket: number | null;
};
  "view": () => {
    hostId: string;
    plugins: {
        policy?: {
            pluginId: string;
            enabled: boolean;
            percentage: number;
            cohortVersion: string;
        } | undefined;
        pluginId: string;
        allowed: boolean;
        bucket: number | null;
        id: string;
        name: string;
    }[];
    policies: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
        revision: number;
        updatedAt: number;
    }[];
};
  "configure": (input: unknown) => Promise<{
    policy?: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
    } | undefined;
    pluginId: string;
    allowed: boolean;
    bucket: number | null;
} | {
    hostId: string;
    plugins: {
        policy?: {
            pluginId: string;
            enabled: boolean;
            percentage: number;
            cohortVersion: string;
        } | undefined;
        pluginId: string;
        allowed: boolean;
        bucket: number | null;
        id: string;
        name: string;
    }[];
    policies: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
        revision: number;
        updatedAt: number;
    }[];
}>;
}

export interface ProjectExecutionV1 {
  "run": (id: string, input: unknown, projectId?: string | null | undefined, signal?: AbortSignal | undefined) => Promise<{
    stdout: string;
    stderr: string;
    code: number;
    scope: "instance";
} | {
    scope: "project";
    projectId: string;
    directory: string;
    networkIsolation: "host" | "private";
    stdout: string;
    stderr: string;
    code: number;
}>;
}

export interface UsbHotplugV1 {
  "reconcile": () => Promise<void>;
  "view": (vmId: string) => Promise<{
    ready: boolean;
    hostDevices: string;
    hostError: string;
    rules: {
        id: string;
        vmId: string;
        vendorId: number;
        productId: number;
        createdAt: string;
        mediaKind?: "camera" | "microphone" | "headset" | undefined;
    }[];
    configured: DeviceV1[];
    events: {
        id: string;
        vmId: string;
        operation: "attach" | "detach";
        deviceId: string;
        vendorId: number;
        productId: number;
        source: "rule" | "manual";
        status: "failed" | "configured" | "requested";
        at: string;
        error?: string | undefined;
    }[];
}>;
  "action": (vmId: string, input: unknown) => Promise<{
    ready: boolean;
    hostDevices: string;
    hostError: string;
    rules: {
        id: string;
        vmId: string;
        vendorId: number;
        productId: number;
        createdAt: string;
        mediaKind?: "camera" | "microphone" | "headset" | undefined;
    }[];
    configured: DeviceV1[];
    events: {
        id: string;
        vmId: string;
        operation: "attach" | "detach";
        deviceId: string;
        vendorId: number;
        productId: number;
        source: "rule" | "manual";
        status: "failed" | "configured" | "requested";
        at: string;
        error?: string | undefined;
    }[];
}>;
}

export interface MediaDevicesV1 {
  "view": (id: string) => Promise<{
    vmId: string;
    vmName: string;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    audio: "none" | "hda-duplex";
    audioBackend: "none" | "dsound";
    support: Record<"none" | "dsound", AudioBackendSupportV1>;
    guest: {
        audio: string;
        video: string;
        error?: string | undefined;
    } | null;
    usb: {
        ready: boolean;
        hostDevices: string;
        hostError: string;
        rules: {
            id: string;
            vmId: string;
            vendorId: number;
            productId: number;
            createdAt: string;
            mediaKind?: "camera" | "microphone" | "headset" | undefined;
        }[];
        configured: DeviceV1[];
        events: {
            id: string;
            vmId: string;
            operation: "attach" | "detach";
            deviceId: string;
            vendorId: number;
            productId: number;
            source: "rule" | "manual";
            status: "failed" | "configured" | "requested";
            at: string;
            error?: string | undefined;
        }[];
    };
}>;
  "action": (id: string, input: unknown) => Promise<{
    vmId: string;
    vmName: string;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    audio: "none" | "hda-duplex";
    audioBackend: "none" | "dsound";
    support: Record<"none" | "dsound", AudioBackendSupportV1>;
    guest: {
        audio: string;
        video: string;
        error?: string | undefined;
    } | null;
    usb: {
        ready: boolean;
        hostDevices: string;
        hostError: string;
        rules: {
            id: string;
            vmId: string;
            vendorId: number;
            productId: number;
            createdAt: string;
            mediaKind?: "camera" | "microphone" | "headset" | undefined;
        }[];
        configured: DeviceV1[];
        events: {
            id: string;
            vmId: string;
            operation: "attach" | "detach";
            deviceId: string;
            vendorId: number;
            productId: number;
            source: "rule" | "manual";
            status: "failed" | "configured" | "requested";
            at: string;
            error?: string | undefined;
        }[];
    };
} | {
    ready: boolean;
    reasons: string[];
    vmId: string;
    vmName: string;
    mode: "host" | "off" | "virtual";
    before: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    after: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    previewToken: string;
    memoryMiB: number;
    architecture: "x86_64" | "aarch64" | undefined;
    qemuAudioArguments: string[];
}>;
}

export interface MemoryReclaimV1 {
  "view": (id: string) => Promise<{
    policy: {
        enabled: boolean;
        minMiB: number;
    };
    effectiveMinMiB: number;
    currentTargetMiB: number;
    observation: ObservationV1 | null;
}>;
  "action": (id: string, raw: unknown) => Promise<{
    policy: {
        enabled: boolean;
        minMiB: number;
    };
    effectiveMinMiB: number;
    currentTargetMiB: number;
    observation: ObservationV1 | null;
}>;
  "sample": (id: string) => Promise<void>;
}

export interface HostMountsV1 {
  "view": (id: string) => Promise<{
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    running: boolean;
    mounted: boolean;
    observation: HostMountObservationV1 | null;
}>;
  "action": (id: string, raw: unknown) => Promise<{
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    running: boolean;
    mounted: boolean;
    observation: HostMountObservationV1 | null;
}>;
}

export interface VirtioFsSharesV1 {
  "view": (id: string) => Promise<{
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    tag: string;
    stopped: boolean;
    running: boolean;
    attached: boolean;
    mounted: boolean;
    observation: VirtioFsObservationV1 | null;
}>;
  "action": (id: string, raw: unknown) => Promise<{
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    tag: string;
    stopped: boolean;
    running: boolean;
    attached: boolean;
    mounted: boolean;
    observation: VirtioFsObservationV1 | null;
}>;
}

export interface TrustedBootServiceV1 {
  "capture": (id: string, snapshotId?: string | undefined) => Promise<TrustedBootFilesV1 | undefined>;
  "restore": (id: string, snapshot: TrustedBootFilesV1) => Promise<void>;
  "view": (id: string) => Promise<{
    policy: {
        enabled: boolean;
    };
    stopped: boolean;
    attached: boolean;
}>;
  "action": (id: string, raw: unknown) => Promise<{
    policy: {
        enabled: boolean;
    };
    stopped: boolean;
    attached: boolean;
} | {
    policy: {
        enabled: boolean;
    };
    ready: boolean;
    executed: boolean;
    firmware: "bios" | "uefi";
    host: {
        secureFirmware: boolean;
        varsTemplate: boolean;
        smm: boolean;
        tpmBackend: boolean;
        swtpm: boolean;
        rebootAction: boolean;
    };
    guest: {
        efi: boolean;
        secureBootEnabled: boolean | null;
        setupMode: boolean | null;
        tpmDevicePresent: boolean;
    } | null;
    observed: boolean;
    reason: string | null;
}>;
}

export interface GpuProfilesV1 {
  "view": () => Promise<{
    profiles: {
        name: string;
        graphics: "virtio-gpu" | "virgl";
        outputs: number;
        width: number;
        height: number;
        hostMemoryMiB: number;
        minVmMemoryMiB: number;
        id: string;
        revision: number;
        createdAt: string;
        updatedAt: string;
    }[];
    support: Record<"virtio-gpu" | "virgl", GpuBackendSupportV1>;
    assignments: {
        vmName: string | null;
        drifted: boolean;
        vmId: string;
        profileId: string;
        profileName: string;
        profileRevision: number;
        hardwareHash: string;
        appliedAt: string;
    }[];
}>;
  "action": (input: unknown) => Promise<{
    name: string;
    graphics: "virtio-gpu" | "virgl";
    outputs: number;
    width: number;
    height: number;
    hostMemoryMiB: number;
    minVmMemoryMiB: number;
    id: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
} | {
    ready: boolean;
    reasons: string[];
    vmId: string;
    vmName: string;
    profileId: string;
    profileRevision: number;
    previewToken: string;
    before: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    memoryMiB: number;
    architecture: "x86_64" | "aarch64" | undefined;
    after: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    qemuDeviceArguments: string[];
} | {
    removed: string;
} | {
    hardware: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    vmId: string;
    profileId: string;
    profileName: string;
    profileRevision: number;
    hardwareHash: string;
    appliedAt: string;
    removed?: undefined;
}>;
}

export interface BuildFarmV1 {
  readonly "jobs": JobsV1;
  "view": () => {
    nodes: {
        vmName: string | null;
        status: string;
        busy: number;
        vmId: string;
        slots: number;
        labels: string[];
        enabled: boolean;
        projectId?: string | undefined;
    }[];
    tasks: {
        job: import("../../shared/contracts/jobs.ts").JobView | null;
        name: string;
        command: string;
        labels: string[];
        timeoutSeconds: number;
        id: string;
        status: "error" | "cancelled" | "interrupted" | "running" | "done" | "queued";
        createdAt: string;
        cwd?: string | undefined;
        retryOf?: string | undefined;
        vmId?: string | undefined;
        jobId?: string | undefined;
        startedAt?: string | undefined;
        finishedAt?: string | undefined;
        error?: string | undefined;
        errorCode?: string | undefined;
        projectId?: string | undefined;
        directory?: string | undefined;
        projectDirectory?: string | undefined;
        configVersion?: string | undefined;
        networkIsolation?: "host" | "private" | undefined;
    }[];
    persistenceError: string | undefined;
};
  "projects": (vmId: string) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
    vmId: string;
}>;
  "action": (input: unknown) => Promise<{
    name: string;
    command: string;
    labels: string[];
    timeoutSeconds: number;
    id: string;
    status: "error" | "cancelled" | "interrupted" | "running" | "done" | "queued";
    createdAt: string;
    cwd?: string | undefined;
    retryOf?: string | undefined;
    vmId?: string | undefined;
    jobId?: string | undefined;
    startedAt?: string | undefined;
    finishedAt?: string | undefined;
    error?: string | undefined;
    errorCode?: string | undefined;
    projectId?: string | undefined;
    directory?: string | undefined;
    projectDirectory?: string | undefined;
    configVersion?: string | undefined;
    networkIsolation?: "host" | "private" | undefined;
} | {
    projectId: string;
    vmId: string;
    slots: number;
    labels: string[];
    enabled: boolean;
} | {
    removed: string;
}>;
}

export interface ProjectPermissionsV1 {
  "view": (vmId: string, projectId: string) => Promise<{
    version: string;
    roles: {
        id: string;
        name: string;
        permissions: ("write" | "read" | "execute" | "approve")[];
    }[];
    grants: {
        accountId: string;
        roleId: string;
    }[];
    approvalRequired: boolean;
    vmId: string;
    projectId: string;
}>;
  "version": (vmId: string, projectId: string) => string;
  "configure": (vmId: string, projectId: string, input: unknown, expectedVersion?: string | undefined) => Promise<{
    version: string;
    vmId: string;
    projectId: string;
    roles: {
        id: string;
        name: string;
        permissions: ("write" | "read" | "execute" | "approve")[];
    }[];
    grants: {
        accountId: string;
        roleId: string;
    }[];
    approvalRequired: boolean;
    revision: number;
}>;
  "accessible": (principal: PrincipalV1) => Promise<{
    vmId: string;
    vmName: string;
    projectId: string;
    projectName: string;
    roleId: string;
    permissions: ("write" | "read" | "execute" | "approve")[];
    approvalRequired: boolean;
}[]>;
  "require": (principal: PrincipalV1, vmId: string, projectId: string, required: "write" | "read" | "execute" | "approve") => Promise<void>;
  "requireCommitted": (principal: PrincipalV1, vmId: string, projectId: string, required: "write" | "read" | "execute" | "approve") => Promise<void>;
  "requiresApproval": (vmId: string, projectId: string) => boolean;
  "liveApprover": (accountId: string, vmId: string, projectId: string) => Promise<boolean>;
  "revokeMember": (accountId: string) => Promise<void>;
  "revokeVm": (vmId: string) => Promise<void>;
}

export interface PolicyBundlesV1 {
  "keys": () => {
    revision: number;
    localKey: {
        name: string;
        fingerprint: string;
        publicKey: string;
    };
    trustedKeys: {
        name: string;
        fingerprint: string;
        publicKey: string;
    }[];
};
  "action": (input: unknown) => Promise<{
    revision: number;
    localKey: {
        name: string;
        fingerprint: string;
        publicKey: string;
    };
    trustedKeys: {
        name: string;
        fingerprint: string;
        publicKey: string;
    }[];
}>;
  "export": (vmId: string, projectId: string) => Promise<{
    format: "sakura-project-policy/v1";
    source: {
        vmId: string;
        projectId: string;
    };
    policy: {
        roles: {
            id: string;
            name: string;
            permissions: ("write" | "read" | "execute" | "approve")[];
        }[];
        grants: {
            accountId: string;
            roleId: string;
        }[];
        approvalRequired: boolean;
    };
    signature: {
        algorithm: "Ed25519";
        publicKey: string;
        value: string;
    };
}>;
  "preview": (input: unknown, target: unknown) => Promise<{
    source: {
        vmId: string;
        projectId: string;
    };
    target: {
        vmId: string;
        projectId: string;
    };
    signer: string;
    trusted: boolean;
    expectedVersion: string;
    current: {
        roles: {
            id: string;
            name: string;
            permissions: ("write" | "read" | "execute" | "approve")[];
        }[];
        grants: {
            accountId: string;
            roleId: string;
        }[];
        approvalRequired: boolean;
    };
    proposed: {
        roles: {
            id: string;
            name: string;
            permissions: ("write" | "read" | "execute" | "approve")[];
        }[];
        grants: {
            accountId: string;
            roleId: string;
        }[];
        approvalRequired: boolean;
    };
}>;
  "apply": (input: unknown) => Promise<{
    signer: string;
    source: {
        vmId: string;
        projectId: string;
    };
    policy: {
        version: string;
        vmId: string;
        projectId: string;
        roles: {
            id: string;
            name: string;
            permissions: ("write" | "read" | "execute" | "approve")[];
        }[];
        grants: {
            accountId: string;
            roleId: string;
        }[];
        approvalRequired: boolean;
        revision: number;
    };
}>;
}

export interface ChangeApprovalsV1 {
  "list": (principal: PrincipalV1) => Promise<{
    status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed";
    id: string;
    vmId: string;
    projectId: string;
    requesterId: string;
    summary: string;
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
    expectedVersion: string;
    createdAt: number;
    expiresAt: number;
    approvedBy?: string | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}[]>;
  "create": (principal: PrincipalV1, input: unknown) => Promise<{
    status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed";
    id: string;
    vmId: string;
    projectId: string;
    requesterId: string;
    summary: string;
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
    expectedVersion: string;
    createdAt: number;
    expiresAt: number;
    approvedBy?: string | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
  "decide": (principal: PrincipalV1, id: string, input: unknown) => Promise<{
    status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed";
    id: string;
    vmId: string;
    projectId: string;
    requesterId: string;
    summary: string;
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
    expectedVersion: string;
    createdAt: number;
    expiresAt: number;
    approvedBy?: string | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
  "apply": (principal: PrincipalV1, id: string) => Promise<{
    status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed";
    id: string;
    vmId: string;
    projectId: string;
    requesterId: string;
    summary: string;
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
    expectedVersion: string;
    createdAt: number;
    expiresAt: number;
    approvedBy?: string | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
}

export interface ProcessInteropV1 {
  "action": (id: string, options: unknown, phase: "check" | "run", signal?: AbortSignal | undefined) => Promise<{
    message: string;
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    programs: {
        programId: string;
        executable: string;
        fixedArgs: string[];
        sha256: string;
    }[];
    programId?: undefined;
    sha256?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256: string;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256?: undefined;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    programId?: undefined;
    sha256?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    installed: boolean;
    reason: string | undefined;
    programId?: undefined;
    sha256?: undefined;
    enabled?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    command: string;
    programId?: undefined;
    sha256?: undefined;
    reason?: undefined;
}>;
  "guest": (request: unknown, token: string | undefined, signal?: AbortSignal | undefined) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    programId: string;
}>;
}

export interface HostPeersV1 {
  "registerMigrationSession": (requesterId: string, ports: Record<MigrationChannelV1, number> & {
    sessionId?: string | undefined;
    qmp?: number | undefined;
    targetDiskNode?: string | undefined;
    targetVmId?: string | undefined;
    transferId?: string | undefined;
}) => `${string}-${string}-${string}-${string}-${string}`;
  "matchesMigrationSession": (id: string, requesterId: string, targetVmId: string, transferId: string) => boolean;
  "closeMigrationSession": (id: string) => void;
  "openMigrationForward": (peerId: string, sessionId: string, channel: MigrationChannelV1) => Promise<{
    port: number;
    close: () => Promise<void>;
}>;
  "targetMigrationQmp": (peerId: string, sessionId: string, command: string, args?: Record<string, unknown> | undefined, timeoutMs?: number) => Promise<unknown>;
  "prepareLiveTarget": (peerId: string, raw: unknown) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationPrepareReceipt>;
  "completeLiveTarget": (peerId: string, raw: unknown) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>;
  "abortLiveTarget": (peerId: string, raw: unknown) => Promise<{
    targetVmId: string;
    aborted: true;
}>;
  "inspectLiveTarget": (peerId: string, raw: unknown) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>;
  "rolloutStatus": (peerId: string) => Promise<{
    hostId: string;
    policies: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
        revision: number;
        updatedAt: number;
    }[];
}>;
  "publishRollout": (peerId: string, input: unknown) => Promise<{
    hostId: string;
    policies: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
        revision: number;
        updatedAt: number;
    }[];
}>;
  "importStatus": (peerId: string, transferId: string) => Promise<{
    id: string;
    name: string;
    sha256?: string | undefined;
    sourceVmId?: string | undefined;
    snapshotId?: string | undefined;
} | null>;
  "activateImport": (peerId: string, input: unknown) => Promise<{
    id: string;
    status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
}>;
  "checkImportActivation": (peerId: string, input: unknown) => Promise<{
    ready: true;
    id: string;
    status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
}>;
  "checkReplicaActivation": (peerId: string, input: unknown) => Promise<{
    ready: true;
    id: string;
    status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
}>;
  "activateReplica": (peerId: string, input: unknown) => Promise<{
    id: string;
    status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
}>;
  "retireReplica": (peerId: string, input: unknown) => Promise<{
    id: string;
    retired: true;
}>;
  "view": () => {
    hostId: string;
    name: string;
    fingerprint: string;
    listener: {
        error?: string | undefined;
        active: boolean;
        enabled: boolean;
        host: "127.0.0.1" | "0.0.0.0";
        port: number;
    };
    pairing: {
        value: string;
        expiresAt: number;
    } | null;
    incoming: {
        id: string;
        requesterId: string;
        name: string;
        createdAt: number;
        allowImport: boolean;
        allowPolicy: boolean;
        allowActivate: boolean;
        allowFailover: boolean;
    }[];
    outbound: {
        observation: HostPeersObservationV1 | null;
        id: string;
        remoteId: string;
        name: string;
        url: string;
        fingerprint: string;
        createdAt: number;
    }[];
};
  "status": () => Promise<{
    version: 1;
    id: string;
    name: string;
    platform: string;
    arch: string;
    cpus: number;
    memoryTotal: number;
    memoryFree: number;
    load: number[];
    vmCount: number;
    runningVms: number;
    checkedAt: string;
}>;
  "score": (input: unknown) => Promise<{
    requirements: {
        cpus: number;
        memoryMiB: number;
    };
    scoredAt: string;
    candidates: {
        id: string;
        name: string;
        source: "local" | "peer";
        eligible: boolean;
        score: number | null;
        components: {
            memory: number;
            cpuLoad: number;
            instanceDensity: number;
        };
        reasons: string[];
        status: {
            version: 1;
            id: string;
            name: string;
            platform: string;
            arch: string;
            cpus: number;
            memoryTotal: number;
            memoryFree: number;
            load: number[];
            vmCount: number;
            runningVms: number;
            checkedAt: string;
        } | null;
        observedAt: number | null;
    }[];
}>;
  "upload": (peerId: string, transferId: string, name: string, produce: (target: import("stream").Writable, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal, origin?: {
    sourceVmId: string;
    snapshotId: string;
} | undefined) => Promise<{
    id: string;
    name: string;
    sha256?: string | undefined;
    sourceVmId?: string | undefined;
    snapshotId?: string | undefined;
}>;
  "configure": (input: unknown) => Promise<{
    requirements: {
        cpus: number;
        memoryMiB: number;
    };
    scoredAt: string;
    candidates: {
        id: string;
        name: string;
        source: "local" | "peer";
        eligible: boolean;
        score: number | null;
        components: {
            memory: number;
            cpuLoad: number;
            instanceDensity: number;
        };
        reasons: string[];
        status: {
            version: 1;
            id: string;
            name: string;
            platform: string;
            arch: string;
            cpus: number;
            memoryTotal: number;
            memoryFree: number;
            load: number[];
            vmCount: number;
            runningVms: number;
            checkedAt: string;
        } | null;
        observedAt: number | null;
    }[];
} | {
    hostId: string;
    name: string;
    fingerprint: string;
    listener: {
        error?: string | undefined;
        active: boolean;
        enabled: boolean;
        host: "127.0.0.1" | "0.0.0.0";
        port: number;
    };
    pairing: {
        value: string;
        expiresAt: number;
    } | null;
    incoming: {
        id: string;
        requesterId: string;
        name: string;
        createdAt: number;
        allowImport: boolean;
        allowPolicy: boolean;
        allowActivate: boolean;
        allowFailover: boolean;
    }[];
    outbound: {
        observation: HostPeersObservationV1 | null;
        id: string;
        remoteId: string;
        name: string;
        url: string;
        fingerprint: string;
        createdAt: number;
    }[];
}>;
  "refresh": () => Promise<void>;
}

export interface MobileCompanionV1 {
  "view": (ownerId: string) => {
    devices: {
        expired: boolean;
        connected: boolean;
        id: string;
        name: string;
        ownerId: string;
        policy: {
            enabled: boolean;
            vmIds: string[];
            kinds: ("cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task")[];
        };
        createdAt: number;
        expiresAt: number;
        lastSeenAt?: number | undefined;
    }[];
};
  "action": (ownerId: string, input: unknown) => Promise<{
    devices: {
        expired: boolean;
        connected: boolean;
        id: string;
        name: string;
        ownerId: string;
        policy: {
            enabled: boolean;
            vmIds: string[];
            kinds: ("cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task")[];
        };
        createdAt: number;
        expiresAt: number;
        lastSeenAt?: number | undefined;
    }[];
} | {
    code: string;
    expiresAt: number;
}>;
  "handle": (request: import("http").IncomingMessage, response: import("http").ServerResponse<import("http").IncomingMessage>) => Promise<void>;
  "revokeAll": () => Promise<void>;
}

export interface LiveMigrationReceiverV1 {
  "prepare": (input: PrepareInputV1) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationPrepareReceipt>;
  "status": (input: {
    requesterId: string;
    transferId: string;
    targetVmId: string;
}) => import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus;
  "verifiedStatus": (input: { requesterId: string; transferId: string; targetVmId: string }) =>
    Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>;
  "complete": (input: {
    requesterId: string;
    transferId: string;
    targetVmId: string;
    sessionId: string;
}) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>;
  "abort": (input: {
    requesterId: string;
    transferId: string;
    targetVmId: string;
    sessionId: string;
    sourceRunning: true;
}) => Promise<{
    targetVmId: string;
    aborted: true;
}>;
}

export interface FleetPolicyRolloutsV1 {
  "view": () => {
    batches: {
        id: string;
        revision: number;
        policy: {
            pluginId: string;
            enabled: boolean;
            percentage: number;
            cohortVersion: string;
        };
        targets: {
            peerId: string;
            hostId: string;
            name: string;
            beforeRevision: number;
            state: "failed" | "pending" | "applied";
            error?: string | undefined;
            appliedAt?: string | undefined;
        }[];
        createdAt: string;
        updatedAt: string;
    }[];
};
  "configure": (input: unknown) => Promise<{
    id: string;
    revision: number;
    policy: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
    };
    targets: {
        peerId: string;
        hostId: string;
        name: string;
        beforeRevision: number;
        state: "failed" | "pending" | "applied";
        error?: string | undefined;
        appliedAt?: string | undefined;
    }[];
    createdAt: string;
    updatedAt: string;
}>;
}

export interface NotebookEnvironmentsV1 {
  "view": (id: string, input?: unknown, signal?: AbortSignal | undefined) => Promise<{
    ready: boolean;
    executed: boolean;
    installed: boolean;
    projectId: string;
    session: {
        provider: "jupyter" | "marimo";
        directory: string;
        guestPort: number;
        hostPort: number;
        status: string;
        startedAt: string;
        needsReview: boolean;
    } | null;
    message: string;
}>;
  "run": (id: string, input: unknown, signal: AbortSignal, log: (line: string) => void) => Promise<NotebookResponseV1>;
  "link": (id: string) => Promise<{
    provider: "jupyter" | "marimo";
    url: string;
}>;
}

export interface BrowserIdeV1 {
  "view": (id: string, input?: unknown, signal?: AbortSignal | undefined) => Promise<{
    ready: boolean;
    executed: boolean;
    supported: boolean;
    installed: boolean;
    projectId: string;
    session: {
        directory: string;
        hostPort: number;
        guestPort: number;
        startedAt: string;
        expiresAt: string;
        status: string;
        needsReview: boolean;
    } | null;
    message: string;
}>;
  "run": (id: string, input: unknown, signal: AbortSignal, log: (line: string) => void) => Promise<{
    ready: boolean;
    executed: boolean;
    supported: boolean;
    installed: boolean;
    projectId: string;
    session: {
        directory: string;
        hostPort: number;
        guestPort: number;
        startedAt: string;
        expiresAt: string;
        status: string;
        needsReview: boolean;
    } | null;
    message: string;
} | {
    ready: boolean;
    executed: boolean;
    session: {
        status: string;
        hostPort: number;
        guestPort: number;
        expiresAt: string;
    };
    message: string;
} | {
    ready: boolean;
    executed: boolean;
    installed: boolean;
    message: string;
    session?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    session: null;
    message: string;
    installed?: undefined;
}>;
  "link": (id: string) => Promise<{
    url: string;
    password: string;
    expiresAt: string;
}>;
}

export interface ColdMigrationsV1 {
  "recoveryTickets": () => Promise<DomainRecoveryTicket[]>;
  "recoverTicket": (ticket: DomainRecoveryTicket) => Promise<void>;
  "view": () => {
    enabled: boolean;
    entries: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
};
  "preview": (id: string, input: unknown) => Promise<{
    ready: boolean;
    executed: boolean;
    reason: string;
    queue: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        fingerprint: {
            recordHash: string;
            diskSize: number;
            diskMtimeMs: number;
        };
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
    target?: undefined;
    fingerprint?: undefined;
    sourceRemovalRequested?: undefined;
    targetStartRequested?: undefined;
    message?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    target: {
        id: string;
        name: string;
        hostId: string;
        score: number | null;
    };
    fingerprint: MigrationFingerprintV1;
    sourceRemovalRequested: boolean;
    targetStartRequested: boolean;
    queue: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        fingerprint: {
            recordHash: string;
            diskSize: number;
            diskMtimeMs: number;
        };
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
    message: string;
    reason?: undefined;
}>;
  "run": (id: string, input: unknown, signal: AbortSignal) => Promise<{
    ready: boolean;
    executed: boolean;
    phase: string;
    transferId: string;
    sourceVmId: string;
    remoteVmId: string;
    targetHostId: string;
    sourceRemoved: boolean;
    message: string;
} | {
    targetStart?: {
        id: string;
        status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
    } | undefined;
    message?: string | undefined;
    ready: boolean;
    executed: boolean;
    phase: string;
    transferId: string;
    sourceVmId: string;
    remoteVmId: string;
    targetHostId: string;
    sourceRemoved: boolean;
    queuePersisted: boolean;
}>;
  "previewDrain": (input: unknown) => Promise<{
    message: string;
    ready: boolean;
    executed: boolean;
    machines: ({
        remoteVmId: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    } | {
        reason: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    })[];
} | {
    reason: string;
    ready: boolean;
    executed: boolean;
    machines: ({
        remoteVmId: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    } | {
        reason: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    })[];
}>;
  "runDrain": (input: unknown, signal: AbortSignal) => Promise<{
    ready: boolean;
    executed: boolean;
    phase: string;
    completed: {
        sourceVmId: string;
        name: string;
        targetName: string;
        remoteVmId: string;
        sourceRemoved: boolean;
    }[];
    remainingSourceVms: number;
    message: string;
}>;
}

export interface SnapshotReplicationsV1 {
  "view": () => {
    enabled: boolean;
    entries: {
        vmId: string;
        snapshotId: string;
        peerId: string;
        transferId: string;
        targetName: string;
        sourceFingerprint: string;
        status: "queued" | "review" | "transferring" | "replicated";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        sha256?: string | undefined;
        sourceSha256?: string | undefined;
        error?: string | undefined;
    }[];
};
  "preview": (id: string, input: unknown) => Promise<{
    ready: boolean;
    executed: boolean;
    reason: string;
    snapshot?: undefined;
    target?: undefined;
    existingRemoteVmId?: undefined;
    existingSha256?: undefined;
    message?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    snapshot: {
        id: string;
        name: string;
        createdAt: string;
    };
    target: {
        id: string;
        hostId: string;
        name: string;
    };
    existingRemoteVmId: string | undefined;
    existingSha256: string | undefined;
    message: string;
    reason?: undefined;
}>;
  "run": (id: string, input: unknown, signal: AbortSignal) => Promise<{
    ready: boolean;
    executed: boolean;
    transferId: string;
    sourceVmId: string;
    snapshotId: string;
    remoteVmId: string;
    targetHostId: string;
    sha256: string | undefined;
    message: string;
}>;
}

export interface HaHostFailoverV1 {
  "configured": () => boolean;
  "view": (id: string) => {
    configured: boolean;
    armed: boolean;
    phase: string | null;
    targetVmId: string | null;
    failback: "pending" | "completed" | null;
    recoveryHeld: boolean;
    statusPending: boolean;
    error: string | null;
};
  "authorizeStart": (id: string) => Promise<void>;
  "disarm": (id: string, failureThreshold: number) => Promise<void>;
  "sample": () => Promise<void>;
  "witnessStatus": (id: string) => Promise<{
    phase?: string | undefined;
    armed?: boolean | undefined;
    lastHeartbeatAt?: number | undefined;
    targetVmId?: string | null | undefined;
    targetHostId?: string | undefined;
    failureThreshold?: number | undefined;
    error?: string | null | undefined;
    failback?: {
        phase: "pending" | "completed";
        retiredVmId: string;
        requestedAt: number;
        completedAt: number | null;
    } | null | undefined;
    recoveryHeld?: boolean | undefined;
    recoveredRetiredVmIds?: string[] | undefined;
    configured: boolean;
}>;
  "rejoin": (id: string, dataReconciled: boolean) => Promise<{
    message: string;
    released?: boolean | undefined;
    retiredRemoteVmId?: string | undefined;
    failback?: "pending" | "completed" | undefined;
    recovered?: boolean | undefined;
    retiredVmIds?: string[] | undefined;
    ready: boolean;
    executed: boolean;
}>;
}

export interface HaLocalFailoversV1 {
  "view": (id: string) => {
    error: string | null;
};
  "hasObservedLive": (id: string) => boolean;
  "sample": () => Promise<void>;
  "rejoin": (id: string, dataReconciled: boolean) => Promise<{
    ready: boolean;
    executed: boolean;
    retiredRemoteVmId: string;
    message: string;
}>;
}

export interface DisasterRecoveryDrillV1 {
  "status": (id: string) => Promise<{
    backups: {
        id: string;
        createdAt: string;
        bytes: number;
        encrypted: boolean | undefined;
        storage: "blocks" | undefined;
        verifiedAt: string | null;
    }[];
}>;
  "run": (id: string, input: unknown, action: "check" | "run", signal?: AbortSignal | undefined, log?: (line: string) => void) => Promise<{
    ready: boolean;
    executed: boolean;
    backups: {
        id: string;
        createdAt: string;
        bytes: number;
        encrypted: boolean | undefined;
        storage: "blocks" | undefined;
        verifiedAt: string | null;
    }[];
} | {
    cleanupError?: string | undefined;
    error?: string | undefined;
    restoreMs: number | null;
    bootMs: number | null;
    totalMs: number;
    restoredName: string;
    temporaryVmId: string | null;
    temporaryVmRemoved: boolean;
    probeSha256?: string | undefined;
    ready: boolean;
    executed: boolean;
    backupId: string;
    probePath: string;
}>;
}

export interface NativeIntegrationV1 {
  "view": () => Promise<import("../../shared/native-integration.ts").NativeView>;
  "revoke": () => void;
  "action": (input: unknown) => Promise<import("../../shared/native-integration.ts").NativeView | import("../../shared/native-integration.ts").NativeHandoff | {
    ticket: `${string}-${string}-${string}-${string}-${string}`;
    url: string;
    opened?: undefined;
    target?: undefined;
    path?: undefined;
} | {
    opened: boolean;
    target: "editor" | "explorer";
    path: string;
    ticket?: undefined;
    url?: undefined;
}>;
}

export interface NativeClipboardV1 {
  "view": () => import("../../shared/native-clipboard.ts").NativeClipboardView;
  "action": (value: unknown) => Promise<import("../../shared/native-clipboard.ts").NativeClipboardView | {
    process: {
        pid: number;
        created: string;
        image: string;
        bits: 0 | 32 | 64;
    };
    view: import("../../shared/native-clipboard.ts").NativeClipboardView;
} | {
    image: string;
    sha256: string;
}>;
}

export interface LocalAssistantV1 {
  "view": () => import("../../shared/assistant.ts").AssistantView;
  "revoke": () => void;
  "configure": (version: number, input: unknown) => Promise<import("../../shared/assistant.ts").AssistantView>;
  "preview": (input: unknown) => import("../../shared/assistant.ts").AssistantPreview;
  "models": (signal?: AbortSignal | undefined) => Promise<{
    models: {
        name: string;
        size: number;
    }[];
}>;
  "generate": (id: string, signal?: AbortSignal | undefined) => Promise<import("../../shared/assistant.ts").AssistantResult>;
}

export interface CommunityPluginsV1 {
  readonly recoverCleanup: (pluginId: string, generation: string) => Promise<void>;
  "view": () => {
    publishers: {
        fingerprint: string;
        name: string;
        addedAt: number;
    }[];
    sources: {
        id: string;
        name: string;
        url: string;
        addedAt: number;
    }[];
    installed: {
        name: string;
        id: string;
        sha256: string;
        version: string;
        schemaVersion: 1;
        signature: string;
        description: string;
        publisher: string;
        sourceId: string;
        installedAt: number;
        extensions?: {
            routes: {
                id: string;
                name: string;
            }[];
            panels: {
                id: string;
                title: string;
                description: string;
                routeId: string;
                fields: {
                    key: string;
                    label: string;
                    type: "number" | "boolean" | "text";
                    required: boolean;
                }[];
            }[];
        } | undefined;
        phase?: "running" | "cleanup-pending" | "draining" | undefined;
        generation?: string | undefined;
    }[];
    catalogs: Record<string, {
        schemaVersion: 1;
        id: string;
        name: string;
        description: string;
        version: string;
        sha256: string;
        publisher: string;
        signature: string;
        wasmUrl: string;
        extensions?: {
            routes: {
                id: string;
                name: string;
            }[];
            panels: {
                id: string;
                title: string;
                description: string;
                routeId: string;
                fields: {
                    key: string;
                    label: string;
                    type: "number" | "boolean" | "text";
                    required: boolean;
                }[];
            }[];
        } | undefined;
    }[]>;
    problems: Record<string, string>;
    subscriptions: {
        pluginId: string;
        types: ("job.finished" | "alert.raised")[];
        enabled: boolean;
        activeSince: number;
        updatedAt: number;
    }[];
    schedules: {
        pluginId: string;
        intervalMinutes: number;
        enabled: boolean;
        nextRunAt: number;
        updatedAt: number;
    }[];
    deliveries: {
        id: string;
        pluginId: string;
        event: {
            id: string;
            type: "test" | "job.finished" | "alert.raised";
            occurredAt: string;
            tags: string[];
            vmId?: string | undefined;
            projectId?: string | undefined;
            jobId?: string | undefined;
            scope?: string | undefined;
            status?: "error" | "cancelled" | "interrupted" | "done" | undefined;
            kind?: "cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task" | undefined;
        } | {
            id: string;
            type: "plugin.timer";
            occurredAt: string;
            tags: [];
        };
        status: "failed" | "done" | "pending";
        processedAt?: number | undefined;
        error?: string | undefined;
        resultPreview?: string | undefined;
    }[];
    eventError: string | undefined;
    runtime: {
        version: number;
        instances: import("../../shared/contracts/plugin-runtime.ts").PluginInstanceView[];
    };
};
  "action": (raw: unknown) => Promise<{
    publishers: {
        fingerprint: string;
        name: string;
        addedAt: number;
    }[];
    sources: {
        id: string;
        name: string;
        url: string;
        addedAt: number;
    }[];
    installed: {
        name: string;
        id: string;
        sha256: string;
        version: string;
        schemaVersion: 1;
        signature: string;
        description: string;
        publisher: string;
        sourceId: string;
        installedAt: number;
        extensions?: {
            routes: {
                id: string;
                name: string;
            }[];
            panels: {
                id: string;
                title: string;
                description: string;
                routeId: string;
                fields: {
                    key: string;
                    label: string;
                    type: "number" | "boolean" | "text";
                    required: boolean;
                }[];
            }[];
        } | undefined;
        phase?: "running" | "cleanup-pending" | "draining" | undefined;
        generation?: string | undefined;
    }[];
    catalogs: Record<string, {
        schemaVersion: 1;
        id: string;
        name: string;
        description: string;
        version: string;
        sha256: string;
        publisher: string;
        signature: string;
        wasmUrl: string;
        extensions?: {
            routes: {
                id: string;
                name: string;
            }[];
            panels: {
                id: string;
                title: string;
                description: string;
                routeId: string;
                fields: {
                    key: string;
                    label: string;
                    type: "number" | "boolean" | "text";
                    required: boolean;
                }[];
            }[];
        } | undefined;
    }[]>;
    problems: Record<string, string>;
    subscriptions: {
        pluginId: string;
        types: ("job.finished" | "alert.raised")[];
        enabled: boolean;
        activeSince: number;
        updatedAt: number;
    }[];
    schedules: {
        pluginId: string;
        intervalMinutes: number;
        enabled: boolean;
        nextRunAt: number;
        updatedAt: number;
    }[];
    deliveries: {
        id: string;
        pluginId: string;
        event: {
            id: string;
            type: "test" | "job.finished" | "alert.raised";
            occurredAt: string;
            tags: string[];
            vmId?: string | undefined;
            projectId?: string | undefined;
            jobId?: string | undefined;
            scope?: string | undefined;
            status?: "error" | "cancelled" | "interrupted" | "done" | undefined;
            kind?: "cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task" | undefined;
        } | {
            id: string;
            type: "plugin.timer";
            occurredAt: string;
            tags: [];
        };
        status: "failed" | "done" | "pending";
        processedAt?: number | undefined;
        error?: string | undefined;
        resultPreview?: string | undefined;
    }[];
    eventError: string | undefined;
    runtime: {
        version: number;
        instances: import("../../shared/contracts/plugin-runtime.ts").PluginInstanceView[];
    };
} | {
    pluginId: string;
    version: string;
    result: unknown;
}>;
  "invokeRoute": (rawPluginId: string, rawRouteId: string, body: unknown) => Promise<{
    pluginId: string;
    version: string;
    result: unknown;
}>;
  "tick": () => Promise<void>;
}

export interface WebhooksV1 {
  "view": () => import("../../shared/webhooks.ts").WebhookView;
  "configure": (input: unknown) => Promise<{
    secret?: string | undefined;
    subscriptions: import("../../shared/webhooks.ts").WebhookSubscription[];
    deliveries: import("../../shared/webhooks.ts").WebhookDelivery[];
    error?: string | undefined;
    collecting: boolean;
    limits: {
        subscriptions: number;
        pending: number;
        history: number;
        attempts: number;
        sourceHours: number;
    };
}>;
  "collect": () => Promise<void>;
  "tick": () => Promise<void>;
}

export interface AutomationRulesV1 {
  "view": () => AutomationViewV1;
  "configure": (input: unknown) => Promise<AutomationViewV1 | {
    matches: {
        event: import("../../shared/webhooks.ts").WebhookEvent;
        targetVmId: string | null;
        action: "start" | "stop" | "suspend" | "resume" | "runbook";
        wouldExecute: boolean;
    }[];
    approval?: string | undefined;
    rule: {
        name: string;
        enabled: boolean;
        previewOnly: boolean;
        filter: {
            types: ("job.finished" | "alert.raised")[];
            vmIds: string[];
            projectIds: string[];
            tags: string[];
            statuses: ("error" | "cancelled" | "interrupted" | "done")[];
            kinds: ("cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task")[];
        };
        action: "start" | "stop" | "suspend" | "resume" | "runbook";
        steps: {
            name: string;
            command: string;
            timeout: number;
        }[];
        cooldownSeconds: number;
        id: string;
        version: number;
        createdAt: number;
        activeSince: number;
        updatedAt: number;
    };
}>;
  "tick": () => Promise<void>;
}

export interface LogRetentionV1 {
  "view": () => import("../../shared/log-retention.ts").LogRetentionView;
  "preview": (input: unknown) => {
    token: string;
    stores: number;
    completedLogs: number;
    completedBytes: number;
    protectedLogs: number;
    protectedBytes: number;
    removeLogs: number;
    removeBytes: number;
    expiredLogs: number;
    capacityLogs: number;
    remainingBytes: number;
};
  "save": (input: unknown, token: string) => Promise<import("../../shared/log-retention.ts").LogRetentionView>;
  "sweep": () => Promise<import("../../shared/log-retention.ts").LogRetentionView>;
}

export interface GraphApiV1 {
  "query": (input: unknown, external?: AbortSignal | undefined) => Promise<{
    status: number;
    body: import("graphql").FormattedExecutionResult<Record<string, unknown>, Record<string, unknown>>;
}>;
}

export interface PackageWorkbenchV1 {
  "query": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<{
    vmId: string;
    mode: "installed" | "updates" | "search";
    manager: "apk" | "apt";
    query: string;
    page: number;
    total: number;
    items: ItemV1[];
    hasMore: boolean;
    warning: string;
}>;
  "action": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<{
    job: unknown;
    token?: undefined;
    expiresAt?: undefined;
    manager?: undefined;
    plan?: undefined;
    change?: undefined;
    name?: undefined;
} | {
    token: `${string}-${string}-${string}-${string}-${string}`;
    expiresAt: number;
    manager: "apk" | "apt";
    plan: string;
    change: "remove" | "install" | "upgrade" | "upgrade-all";
    name: string | null;
    job?: undefined;
}>;
}

export type AlertEventV1 = {
    id: string;
    vmId: string;
    kind: "cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task";
    message: string;
    createdAt: string;
    acknowledged: boolean;
    projectId?: string | undefined;
    jobId?: string | undefined;
};

export type MetricPointV1 = {
    sampledAt: string;
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes?: number | null | undefined;
    networkTransmittedBytes?: number | null | undefined;
    networkReceiveBytesPerSecond?: number | null | undefined;
    networkTransmitBytesPerSecond?: number | null | undefined;
};

export type JumpV1 = {
    family: FamilyV1;
    interface: string;
    chain: string;
    rules?: string[] | undefined;
};

export type VulnerabilityScanV1 = {
    source: "OSV";
    status: "complete" | "unavailable";
    ecosystem: string | null;
    packagesChecked: number;
    affectedPackages: number;
    vulnerabilityCount: number;
    matches: VulnerabilityMatchV1[];
    error?: string | undefined;
};

export type BackupDownloadV1 = {
    type: "file";
    path: string;
    name: string;
} | {
    type: "stream";
    name: string;
    bytes: number;
    write: (output: import("stream").Writable, signal: AbortSignal) => Promise<void>;
};

export type BackupRecordV1 = {
    id: string;
    createdAt: string;
    bytes: number;
    checksum: string;
    verifiedAt?: string | undefined;
    error?: string | undefined;
    directory?: string | undefined;
    encrypted?: boolean | undefined;
    passwordSecret?: string | undefined;
    retainUntil?: string | undefined;
    storage?: "blocks" | undefined;
};

export type BackupStateV1 = {
    policy: {
        enabled: boolean;
        intervalHours: number;
        keep: number;
        maxGiB: number;
        lockDays?: number | undefined;
        deduplicate?: boolean | undefined;
        bandwidthMiBps?: number | undefined;
        directory?: string | undefined;
        passwordSecret?: string | undefined;
    };
    items: BackupRecordV1[];
    lastSuccess?: string | undefined;
};

export type DiagnosticV1 = {
    severity: "error" | "info" | "warning";
    message: string;
    line?: number | undefined;
    column?: number | undefined;
};

export type FrameV1 = {
    id: number;
    name: string;
    path: string;
    line: number;
    column: number;
};

export type VariableV1 = {
    name: string;
    value: string;
    type: string;
    variablesReference: number;
};

export interface SingleAppWindowsV1 {
  "onSessionInvalidated": (id: string, sessionId: string, listener: () => void) => () => void;
  "clipboardPolicies": (id: string) => Promise<Record<string, {
    copy: boolean;
    paste: boolean;
}>>;
  "saveClipboardPolicy": (id: string, program: string, raw: unknown) => Promise<{
    program: string;
    clipboard: {
        copy: boolean;
        paste: boolean;
    };
}>;
  "removeClipboardPolicy": (id: string, program: string) => Promise<{
    removed: boolean;
    program: string;
}>;
  "list": (id: string) => Promise<{
    id: string;
    vmId: string;
    program: string;
    display: number;
    port: number;
    resolution: string;
    clipboard: {
        copy: boolean;
        paste: boolean;
    };
    startedAt: string;
    password: string;
    dataDirectory: string;
    revoked: boolean;
    cleanupPending: boolean;
    status: "running" | "cleanup-pending" | "preparing" | "stopped" | "relaunch-required" | "review-required";
    projectId?: string | undefined;
    networkIsolation?: "host" | "private" | undefined;
    projectOwner?: {
        uid: number;
        user: string;
    } | undefined;
    applicationOwner?: {
        uid: number;
        user: string;
    } | undefined;
    lastError?: string | undefined;
}[]>;
  "port": (id: string, sessionId: string) => Promise<number>;
  "connectionCommand": (id: string, sessionId: string, port: number) => Promise<string>;
  "start": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<{
    id: string;
    vmId: string;
    program: string;
    display: number;
    port: number;
    resolution: string;
    clipboard: {
        copy: boolean;
        paste: boolean;
    };
    startedAt: string;
    password: string;
    dataDirectory: string;
    revoked: boolean;
    cleanupPending: boolean;
    status: "running" | "cleanup-pending" | "preparing" | "stopped" | "relaunch-required" | "review-required";
    projectId?: string | undefined;
    networkIsolation?: "host" | "private" | undefined;
    projectOwner?: {
        uid: number;
        user: string;
    } | undefined;
    applicationOwner?: {
        uid: number;
        user: string;
    } | undefined;
    lastError?: string | undefined;
}>;
  "stop": (id: string, sessionId: string) => Promise<{
    stopped: boolean;
}>;
}

export type WorkV1 = (log: (text: string) => void, signal: AbortSignal, update: import("../../shared/contracts/jobs.ts").JobUpdate, result: (value: unknown) => Promise<void>) => Promise<void>;

export type FeatureSettingV1 = {
    enabled: boolean;
    options: Record<string, unknown>;
    updatedAt: string;
};

export type FeatureExecutionV1 = {
    featureId: "ipv6" | "syscall-profile" | "ssh-agent-forward" | "gpg-agent-forward" | "project-quota" | "guest-quota" | "network-quota" | "egress-policy" | "power-aware-schedule" | "availability-report" | "audit-log" | "cpu-topology" | "device-profiles" | "resource-reservation" | "crash-loop-guard" | "maintenance-windows" | "patch-bundle" | "environment-recreate" | "editor-profiles" | "metrics-export" | "event-timeline" | "anomaly-detection" | "review-comments" | "command-forms" | "vm-dependency-start" | "environment-parity" | "test-matrix" | "cross-vm-copy" | "packet-capture" | "reverse-tunnel" | "archive-wizard" | "hash-manifest" | "case-conflict-report" | "task-import" | "project-onboarding" | "env-schema" | "shell-profiles" | "toolchain-check" | "bootstrap-dry-run" | "project-template-pack" | "git-stash" | "git-reflog" | "git-cherry-pick" | "git-bisect" | "git-rebase" | "git-policy" | "precommit-secrets" | "code-ownership" | "flaky-tests" | "coverage-history" | "benchmark-regression" | "sbom" | "license-report" | "release-gates" | "artifact-provenance" | "changelog" | "reproducible-build" | "posix-acl" | "guest-clock-policy" | "static-routes" | "process-history" | "disk-io-metrics" | "network-metrics" | "command-risk" | "command-macros" | "runbooks" | "session-lock" | "vm-suspend" | "rescue-boot" | "qemu-commandline" | "disk-encryption" | "qcow2-scrub" | "backup-dedup" | "cow-workspace" | "secure-erase" | "watch-sync" | "sync-window" | "rename-detection" | "sync-queue" | "path-sync-policy" | "sync-rollback" | "merge-drivers" | "multi-host-view" | "network-isolation" | "local-dns-alias" | "tpm-secure-boot" | "hello-unlock" | "clipboard-redaction" | "secret-rotation" | "signed-bundles" | "immutable-backups" | "multi-host-health" | "explorer-integration" | "terminal-layouts" | "shortcut-editor" | "offline-pwa" | "accessibility-audit" | "locale-packs" | "self-update" | "api-explorer";
    action: "check" | "run";
    startedAt: string;
    finishedAt: string;
    ready: boolean;
    result: Record<string, unknown>;
};

export interface ResumableUploadsV1 {
  "create": (vmId: string, input: unknown) => Promise<{
    received: number[];
    chunkBytes: number;
    path: string;
    size: number;
    chunks: string[];
    overwrite: boolean;
    id: string;
    vmId: string;
    fingerprint: string;
    createdAt: string;
    expiresAt: string;
    completed?: {
        bytes: number;
        sha256: string;
    } | undefined;
    committing?: {
        bytes: number;
        sha256: string;
    } | undefined;
}>;
  "view": (vmId: string, id: string) => Promise<{
    received: number[];
    chunkBytes: number;
    path: string;
    size: number;
    chunks: string[];
    overwrite: boolean;
    id: string;
    vmId: string;
    fingerprint: string;
    createdAt: string;
    expiresAt: string;
    completed?: {
        bytes: number;
        sha256: string;
    } | undefined;
    committing?: {
        bytes: number;
        sha256: string;
    } | undefined;
}>;
  "chunk": (vmId: string, id: string, index: number, input: import("stream").Readable, signal: AbortSignal) => Promise<{
    index: number;
    bytes: number;
}>;
  "commit": (vmId: string, id: string, signal: AbortSignal) => Promise<{
    bytes: number;
    sha256: string;
}>;
  "remove": (vmId: string, id: string) => Promise<{
    removed: boolean;
}>;
}

export type PreviewV1 = {
    [key: string]: unknown;
    kind: string;
    name: string;
    size: number;
};

export type ProjectV1 = {
    directory: string;
    template: "none" | "node" | "python" | "rust";
    repository: string;
    setup: string;
    command: string;
    previewPort?: number | undefined;
    networkIsolation?: "host" | "private" | undefined;
    environment?: Record<string, string> | undefined;
    secrets?: Record<string, string> | undefined;
    runtimes?: {
        python?: string | undefined;
        node?: string | undefined;
    } | undefined;
    services?: {
        name: string;
        command: string;
        dependsOn: string[];
        ready: string;
        timeout: number;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        health?: {
            command: string;
            interval: number;
            timeout: number;
            failures: number;
            restart: boolean;
            maxRestarts: number;
            backoff: number;
        } | undefined;
    }[] | undefined;
} & {
    _workspace?: string | undefined;
};

export type DiskOperationV1 = "trim" | "compact";

export type AttemptV1 = {
    startedAt: string;
    finishedAt?: string | undefined;
    error?: string | undefined;
    result?: Record<string, unknown> | undefined;
};

export type DiskMaintenanceStateV1 = {
    policy: {
        enabled: boolean;
        intervalHours: number;
        mode: "trim" | "compact" | "both";
        compress: boolean;
    };
    attempts: Partial<Record<DiskOperationV1, AttemptV1>>;
    successes: Partial<Record<DiskOperationV1, string>>;
};

export type DiagnosticCheckV1 = {
    name: string;
    status: "error" | "ok" | "skip" | "warning";
    detail: string;
    suggestion?: string | undefined;
};

export type MigrationFileV1 = {
    path: string;
    bytes: number;
    modified: number;
};

export type NetworkChangeV1 = {
    path: string;
    before: string | null;
    after: string;
};

export type ForwardChangeV1 = {
    before: {
        host: number;
        guest: number;
        name?: string | undefined;
    }[];
    after: {
        host: number;
        guest: number;
        name?: string | undefined;
    }[];
};

export type NetworkStateV1 = {
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    changes: NetworkChangeV1[];
    forwards?: ForwardChangeV1 | undefined;
    dnsBackend?: "resolved" | undefined;
    resolverLink?: {
        before: string;
        after: string;
    } | undefined;
    appliedAt?: string | undefined;
};

export type PipelineV1 = {
    name: string;
    steps: {
        name: string;
        command: string;
        timeout: number;
    }[];
    artifacts: string[];
    id?: string | undefined;
} & {
    id: string;
};

export type PipelineRunV1 = {
    id: string;
    pipelineId: string;
    name: string;
    projectId: string;
    startedAt: string;
    finishedAt?: string | undefined;
    status: "error" | "cancelled" | "interrupted" | "running" | "done";
    error?: string | undefined;
    errorCode?: string | undefined;
    steps: {
        name: string;
        status: "error" | "cancelled" | "running" | "done" | "pending";
        startedAt?: string | undefined;
        finishedAt?: string | undefined;
        code?: number | undefined;
        errorCode?: string | undefined;
        log: string;
    }[];
    artifacts: {
        name: string;
        bytes: number;
        index: number;
    }[];
};

export interface StorageTieringV1 {
  "view": (id?: string | undefined) => Promise<{
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
}>;
  "tick": (signal?: AbortSignal | undefined) => Promise<void>;
  "run": (id: string, input: unknown, action: "check" | "run", signal?: AbortSignal | undefined, log?: (text: string) => void) => Promise<{
    ready: boolean;
    executed: boolean;
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
} | {
    ready: boolean;
    executed: boolean;
    applied: {
        warning?: string | undefined;
        moved: boolean;
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | {
        warning?: string | undefined;
        moved: boolean;
        cleanupPending: boolean;
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    };
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
} | {
    ready: boolean;
    executed: boolean;
    rebalance: {
        moved: number;
        failed: number;
        entries: {
            vmId: string;
            name: string;
            from: string;
            to: string;
            at: string;
            status: "failed" | "moved";
            error?: string | undefined;
        }[];
    };
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
}>;
}

export interface ServiceMeshV1 {
  "status": (id: string, signal?: AbortSignal | undefined) => Promise<{
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
    executed: false;
}>;
  "assertNoRunning": (id: string) => Promise<void>;
  "configure": <T>(id: string, enabled: boolean, save: () => Promise<T>) => Promise<T>;
  "action": (id: string, raw: unknown, action: "check" | "run", signal?: AbortSignal | undefined) => Promise<{
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
    executed: false;
} | {
    ready: boolean;
    executed: boolean;
    message: string;
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
} | {
    executed: boolean;
    configPath: string;
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
}>;
}

export interface VtpmEnrollmentV1 {
  "status": (id: string, at?: Date) => {
    ready: boolean;
    executed: boolean;
    records: {
        rotateDueAt: string;
        overdue: boolean;
        dueSoon: boolean;
        fingerprint: string;
        label: string;
        enrolledAt: string;
        rotateAfterDays: number;
        updatedAt: string;
    }[];
    overdueCount: number;
    dueSoonCount: number;
    message: string;
};
  "action": (id: string, raw: unknown, action: "check" | "run") => Promise<{
    ready: boolean;
    executed: boolean;
    records: {
        rotateDueAt: string;
        overdue: boolean;
        dueSoon: boolean;
        fingerprint: string;
        label: string;
        enrolledAt: string;
        rotateAfterDays: number;
        updatedAt: string;
    }[];
    overdueCount: number;
    dueSoonCount: number;
    message: string;
}>;
}

export interface AcmeRenewalV1 {
  "view": (id: string) => {
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
};
  "save": (id: string, input: unknown) => Promise<{
    ready: boolean;
    executed: boolean;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
}>;
  "check": (id: string, signal?: AbortSignal | undefined) => Promise<{
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
}>;
  "run": (id: string, input: unknown, action: "check" | "run", signal?: AbortSignal | undefined) => Promise<{
    ready: boolean;
    executed: boolean;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
}>;
  "tick": () => Promise<void>;
}

export interface TeamTemplatesV1 {
  "action": (id: string, input: unknown, action: "check" | "run") => Promise<{
    ready: boolean;
    executed: boolean;
    unchanged: boolean;
    template: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        createdAt: string;
        updatedAt: string;
    };
} | {
    ready: boolean;
    executed: boolean;
    template: {
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        fingerprint: string;
        version: number;
        updatedAt: string;
        id: string;
        name: string;
        createdAt: string;
    };
    unchanged?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    deleted: string;
    templateId?: undefined;
    vmId?: undefined;
    vm?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    templateId: string;
    vmId: string;
    vm: import("../../shared/contracts/vm.ts").VMView;
    deleted?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    templates: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        createdAt: string;
        updatedAt: string;
    }[];
    name?: undefined;
    fingerprint?: undefined;
    previousFingerprint?: undefined;
    content?: undefined;
    excluded?: undefined;
    template?: undefined;
    message?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    name: string;
    fingerprint: string;
    previousFingerprint: string | undefined;
    content: {
        resources: {
            cpus: number;
            memoryMiB: number;
            diskGiB: number;
            accelerator: "auto" | "tcg" | "whpx";
            distro: "alpine" | "debian" | "ubuntu";
            firmware: "bios" | "uefi";
            template: "none" | "node" | "python" | "rust";
            architecture?: "x86_64" | "aarch64" | undefined;
        };
        project: {
            directory: "/workspace";
            template: "none" | "node" | "python" | "rust";
            repository: string;
            previewPort?: number | undefined;
            networkIsolation?: "host" | "private" | undefined;
            runtimes?: {
                python?: string | undefined;
                node?: string | undefined;
            } | undefined;
        };
    };
    excluded: string[];
    templates?: undefined;
    template?: undefined;
    message?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    template: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        createdAt: string;
        updatedAt: string;
    };
    message: string | undefined;
    templates?: undefined;
    name?: undefined;
    fingerprint?: undefined;
    previousFingerprint?: undefined;
    content?: undefined;
    excluded?: undefined;
}>;
}

export interface HaFailureMonitorV1 {
  "sample": () => Promise<void>;
  "reconfigure": (id: string) => Promise<void>;
  "view": (id: string) => {
    suspected: boolean;
    sampleIntervalSeconds: number;
    armed: boolean;
    consecutiveFailures: number;
    observedState: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
    observedAt: string;
    policyVersion?: string | undefined;
    lastHealthyAt?: string | undefined;
    suspectedAt?: string | undefined;
} | null;
}

export type NextSettingV1 = {
    enabled: boolean;
    options: Record<string, unknown>;
    updatedAt: string;
};

export type NextExecutionV1 = {
    featureId: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
    action: "check" | "run";
    startedAt: string;
    finishedAt: string;
    ready: boolean;
    executed: boolean;
    result: Record<string, unknown>;
};

export type PowerSampleV1 = {
    checkedAt: string;
    onAC: boolean | null;
    batteryPresent: boolean | null;
    batteryPercent: number | null;
    error?: string | undefined;
};

export type ProbeV1 = {
    available: boolean;
    devices: string[];
    deviceNodes: boolean;
    diagnostic?: string | undefined;
};

export type AudioBackendSupportV1 = {
    available: boolean;
    reason?: string | undefined;
};

export type DeviceV1 = {
    id: string;
    vendorId: number;
    productId: number;
    ruleId?: string | undefined;
};

export type MigrationFingerprintV1 = {
    recordHash: string;
    diskSize: number;
    diskMtimeMs: number;
};

export type RowV1 = {
    id: string;
    name: string;
    available: boolean;
    evidence: string;
    reason?: string | undefined;
};

export type ProjectFileV1 = {
    path: string;
    directory: boolean;
    size: number;
};

export type SearchMatchV1 = {
    path: string;
    line: number;
    text: string;
};

export interface ProjectCatalogV1 {
  "current": (id: string) => string;
  "key": (id: string) => string;
  "list": (id: string) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
}>;
  "readCommittedList": (id: string) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
}>;
  "with": <T>(id: string, requested: string | null | undefined, action: () => Promise<T>) => Promise<T>;
  "inScope": <T>(id: string, projectId: string, action: () => T) => T;
  "create": (id: string, name: string, initialize: () => Promise<void>) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
}>;
  "update": (id: string, project: string, name?: string | undefined) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
}>;
}

export type ResolvedDependencyAuthenticationV1 = {
    endpoint: string;
    authorization: string;
    privateValues: string[];
};

export type ProjectRuntimeV1 = {
    status: string;
    log: string;
    services?: {
        name: string;
        status: string;
        log: string;
    }[] | undefined;
    main?: {
        status: string;
    } | undefined;
};

export type RuntimeProbeStateV1 = "failed" | "running" | "stale" | "unprobed" | "cached";

export type SandboxViewV1 = {
    name: string;
    memoryMiB: number;
    cpus: number;
    diskGiB: number;
    accelerator: "auto" | "tcg" | "whpx";
    forwards: {
        host: number;
        guest: number;
        name?: string | undefined;
    }[];
    storagePoolId?: string | undefined;
    firmware?: "bios" | "uefi" | undefined;
    distro?: "alpine" | "debian" | "ubuntu" | undefined;
    architecture?: "x86_64" | "aarch64" | undefined;
    template?: "none" | "node" | "python" | "rust" | undefined;
    hardware?: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    } | undefined;
} & {
    id: string;
    diskEncryption?: import("../../shared/contracts/vm.ts").DiskEncryptionConfig | undefined;
    sandbox?: {
        network: "isolated" | "nat";
        expiresAt: string;
        onExpire: "stop" | "delete";
        storage?: "persistent" | "discard-on-stop" | undefined;
    } | undefined;
    rescueOf?: string | undefined;
    createdAt: string;
    snapshots: import("../../shared/contracts/vm.ts").Snapshot[];
    bootstrapped?: boolean | undefined;
    lastUsedAt?: string | undefined;
    lastError?: string | undefined;
    organization?: {
        group: string;
        tags: string[];
        favorite: boolean;
    } | undefined;
    pendingResize?: boolean | undefined;
    migrationOrigin?: {
        sourceHostId: string;
        transferId: string;
        targetName: string;
        sourceVmId?: string | undefined;
        snapshotId?: string | undefined;
        diskSha256?: string | undefined;
    } | undefined;
    haPromotion?: {
        peerId: string;
        targetHostId: string;
        transferId: string;
        remoteVmId: string;
        snapshotId: string;
        sha256: string;
        fencedAt: string;
        status: "fenced" | "accepted";
        updatedAt: string;
        error?: string | undefined;
    } | undefined;
    haRetirement?: {
        sourceHostId: string;
        transferId: string;
        sourceVmId: string;
        snapshotId: string;
        sha256: string;
        retiredAt: string;
    } | undefined;
    haWitnessEnrollment?: {
        targetHostId: string;
        failureThreshold: number;
        registeredAt: string;
    } | undefined;
    liveMigrationFence?: import('../../shared/contracts/vm.ts').LiveMigrationFence | undefined;
    liveMigrationOrigin?: import('../../shared/contracts/vm.ts').LiveMigrationOrigin | undefined;
    branchOrigin?: {
        sourceVmId: string;
        snapshotId: string;
        createdAt: string;
    } | undefined;
    mergeOrigin?: {
        branchVmId: string;
        targetVmId: string;
        snapshotId: string;
        path: string;
        mergedAt: string;
        appliedFiles: number;
    } | undefined;
} & {
    activeAccelerator?: "tcg" | "whpx" | undefined;
    memoryTargetMiB?: number | undefined;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    poweredOn: boolean;
    startedAt?: string | undefined;
    diskBytes: number;
} & {
    sandbox: {
        network: "isolated" | "nat";
        expiresAt: string;
        onExpire: "stop" | "delete";
        storage?: "persistent" | "discard-on-stop" | undefined;
    };
    expired: boolean;
};

export type SandboxOverviewV1 = {
    sandboxes: SandboxViewV1[];
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    persistenceError?: string | undefined;
};

export type SecretRotationItemV1 = {
    name: string;
    lastChangedAt: string;
    policy: {
        enabled: boolean;
        maxAgeDays: number;
        remindBeforeDays: number;
    };
    ageDays: number | null;
    dueAt: string | null;
    daysRemaining: number | null;
    status: "unknown" | "current" | "disabled" | "due-soon" | "overdue";
};

export type HealthViewV1 = {
    name: string;
    desired: boolean;
    status: "stopped" | "healthy" | "unhealthy" | "waiting" | "restarting" | "exhausted";
    failures: number;
    restarts: number;
    checkedAt?: string | undefined;
    nextCheck: number;
    error?: string | undefined;
};

export interface StorageRuntimeV1 {
  "acquire": (request: StorageRequestV1) => Promise<{
    id: string;
    release: () => void;
    assertActive: (checkSignal?: boolean) => void;
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    releaseTemporary: (path: string) => Promise<void>;
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    transfer: (owner: string) => void;
}>;
  "run": <T>(request: StorageRequestV1, work: (lease: {
    id: string;
    release: () => void;
    assertActive: (checkSignal?: boolean) => void;
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    releaseTemporary: (path: string) => Promise<void>;
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    transfer: (owner: string) => void;
}) => Promise<T>) => Promise<T>;
}

export type SyncHistoryViewV1 = Pick<{
    id: string;
    createdAt: string;
    host: string;
    guest: string;
    status: "failed" | "done" | "pending" | "rolled-back";
    bytes: number;
    entries: {
        side: "host" | "guest";
        path: string;
        before: {
            sha: string;
            mode: number;
            uid?: number | undefined;
            gid?: number | undefined;
        } | null;
        after: string | null;
    }[];
    state: string | null;
    base: string | null;
    error?: string | undefined;
    afterState?: string | null | undefined;
    afterBase?: string | null | undefined;
}, "error" | "id" | "bytes" | "status" | "createdAt"> & {
    changes: number;
};

export type SyncWatchViewV1 = {
    host: "watching" | "polling";
    guest: "watching" | "polling" | "offline";
    reason?: string | undefined;
    lastEvent?: string | undefined;
};

export type SyncPreviewV1 = {
    token: string;
    changes: SyncChangeV1[];
    unchanged: number;
};

export type SyncDecisionsV1 = {
    [x: string]: "push" | "pull" | "skip" | "merge" | "both" | "manual" | "delete-host" | "delete-guest" | "restore-host" | "restore-guest";
};

export type SyncManualMergesV1 = {
    [x: string]: string;
};

export interface ProjectPreparationV1 {
  readonly "workspaces": Readonly<Pick<WorkspacesV1, "view" | "jobs" | "projects" | "beforeAction" | "onConfigChange" | "beforeConfigChange" | "config" | "readCommittedConfig" | "networkEnvironment" | "dependencyDownloadAuthentication" | "repositoryDownloadAuthentication" | "resolvedConfig" | "resolveProject" | "save" | "run" | "runtime" | "metrics">>;
  readonly "signal": AbortSignal;
  "serial": <T>(id: string, signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  "hasTerminal": (vmId: string, terminalId: string) => boolean;
  "prepare": <T>(id: string, projectId: string | null | undefined, signal: AbortSignal | undefined, options: {
    task: boolean;
    readOnly?: boolean | undefined;
    verifyOnly?: boolean | undefined;
}, action: (context: PreparationContextV1) => Promise<T>) => Promise<T>;
  "retain": (context: PreparationContextV1, task: boolean, terminalId?: string | undefined, stop?: (() => Promise<void>) | undefined) => () => void | Promise<void>;
  "prepareTask": (id: string, projectId: string | null | undefined, signal?: AbortSignal | undefined, options?: {
    verifyOnly?: boolean | undefined;
}) => Promise<PreparedProjectV1>;
  "close": () => Promise<void>;
}

export type PreparedProjectV1 = {
    command: string;
    projectId: string;
    networkIsolation: string;
    terminalId?: string | undefined;
    release: () => void | Promise<void>;
    signal?: AbortSignal | undefined;
    captured?: {
        project: ProjectV1;
        configVersion: string;
        live: Readonly<Pick<LiveV1, "error" | "accelerator" | "status" | "incoming" | "startedAt" | "sshPort" | "qmpPort" | "agentPort" | "serialPort" | "memoryTargetMiB">> & {
            readonly abort: Readonly<Pick<AbortController, "signal">>;
        };
        identity?: Readonly<{
            vmId: string;
            vmProcessId: string;
            executionGeneration: string;
            bootId?: string | undefined;
            networkGeneration?: string | undefined;
        }> | undefined;
    } | undefined;
};

export type StreamDownloadV1 = {
    bytes: number;
    write: (output: import("stream").Writable, signal: AbortSignal) => Promise<void>;
};

export type DownloadTargetV1 = ({
    type: "file";
    path: string;
} | {
    type: "export";
} | {
    type: "local";
    path: string;
} | ({
    type: "stream";
} & StreamDownloadV1)) & {
    id: string;
    name: string;
};

export type PrincipalV1 = Pick<{
    id: string;
    username: string;
    role: "member" | "owner" | "viewer";
    credential: {
        salt: string;
        hash: string;
    };
    vmIds: string[];
    expiresAt: number | null;
    createdAt: string;
    passkeys: {
        id: string;
        publicKey: string;
        counter: number;
        transports: string[];
        name: string;
        createdAt: string;
        lastUsedAt?: string | undefined;
    }[];
}, "id" | "username" | "role" | "vmIds"> & {
    expiresAt: number;
};

export type ObservationV1 = {
    at: string;
    totalMiB: number;
    availableMiB: number;
    targetMiB: number;
    decision: "restore" | "shrink" | "hold" | "disabled";
    reason: string;
    error?: string | undefined;
};

export type HostMountObservationV1 = {
    at: string;
    mounted: boolean;
    error?: string | undefined;
};

export type VirtioFsObservationV1 = {
    at: string;
    mounted: boolean;
    error?: string | undefined;
};

export type TrustedBootFilesV1 = {
    enabled: boolean;
    files: {
        name: string;
        data: Buffer<ArrayBufferLike>;
    }[];
};

export type GpuBackendSupportV1 = {
    available: boolean;
    reason?: string | undefined;
};

export type MigrationChannelV1 = "state" | "disk";

export type HostPeersObservationV1 = {
    status?: {
        version: 1;
        id: string;
        name: string;
        platform: string;
        arch: string;
        cpus: number;
        memoryTotal: number;
        memoryFree: number;
        load: number[];
        vmCount: number;
        runningVms: number;
        checkedAt: string;
    } | undefined;
    error?: string | undefined;
    checkedAt: number;
    lastSuccessAt?: number | undefined;
};

export type PrepareInputV1 = {
    requesterId: string;
    transferId: string;
    sourceVmId: string;
    completionProtocol?: 1;
    config: {
        name: string;
        memoryMiB: number;
        cpus: number;
        diskGiB: number;
        accelerator: "auto" | "tcg" | "whpx";
        forwards: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[];
        storagePoolId?: string | undefined;
        firmware?: "bios" | "uefi" | undefined;
        distro?: "alpine" | "debian" | "ubuntu" | undefined;
        architecture?: "x86_64" | "aarch64" | undefined;
        template?: "none" | "node" | "python" | "rust" | undefined;
        hardware?: {
            cpu?: {
                sockets: number;
                cores: number;
                threads: number;
                numa?: {
                    memoryMiB: number;
                    cpus: number[];
                }[] | undefined;
            } | undefined;
            devices?: {
                graphics: "none" | "virtio-gpu" | "virgl";
                networkCard: "virtio-net-pci" | "e1000";
                randomDevice: boolean;
                balloon: boolean;
                diskCache: "none" | "writeback" | "writethrough";
                discard: boolean;
                graphicsOutputs?: number | undefined;
                graphicsWidth?: number | undefined;
                graphicsHeight?: number | undefined;
                graphicsMemoryMiB?: number | undefined;
                audio?: "none" | "hda-duplex" | undefined;
                audioBackend?: "none" | "dsound" | undefined;
            } | undefined;
            memory?: {
                maxMiB: number;
                slots: number;
            } | undefined;
            ipv6?: boolean | undefined;
        } | undefined;
    };
    key: string;
    seed: Buffer<ArrayBufferLike>;
    projects?: {
        active: string;
        projects: {
            id: string;
            name: string;
        }[];
        configs: Record<string, {
            directory: string;
            template: "none" | "node" | "python" | "rust";
            repository: string;
            setup: string;
            command: string;
            previewPort?: number | undefined;
            networkIsolation?: "host" | "private" | undefined;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            runtimes?: {
                python?: string | undefined;
                node?: string | undefined;
            } | undefined;
            services?: {
                name: string;
                command: string;
                dependsOn: string[];
                ready: string;
                timeout: number;
                environment?: Record<string, string> | undefined;
                secrets?: Record<string, string> | undefined;
                health?: {
                    command: string;
                    interval: number;
                    timeout: number;
                    failures: number;
                    restart: boolean;
                    maxRestarts: number;
                    backoff: number;
                } | undefined;
            }[] | undefined;
        }>;
    } | undefined;
    organization?: {
        group: string;
        tags: string[];
        favorite: boolean;
    } | undefined;
};

export type NotebookResponseV1 = {
    ready: boolean;
    executed: boolean;
    message: string;
    installed?: boolean | undefined;
    projectId?: string | undefined;
    provider?: "jupyter" | "marimo" | undefined;
    session?: {
        provider: "jupyter" | "marimo";
        status: string;
        hostPort: number;
        guestPort: number;
        directory?: string | undefined;
        startedAt?: string | undefined;
        needsReview?: boolean | undefined;
    } | null | undefined;
};

export type AutomationViewV1 = {
    rules: {
        name: string;
        enabled: boolean;
        previewOnly: boolean;
        filter: {
            types: ("job.finished" | "alert.raised")[];
            vmIds: string[];
            projectIds: string[];
            tags: string[];
            statuses: ("error" | "cancelled" | "interrupted" | "done")[];
            kinds: ("cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task")[];
        };
        action: "start" | "stop" | "suspend" | "resume" | "runbook";
        steps: {
            name: string;
            command: string;
            timeout: number;
        }[];
        cooldownSeconds: number;
        id: string;
        version: number;
        createdAt: number;
        activeSince: number;
        updatedAt: number;
    }[];
    executions: {
        id: string;
        ruleId: string;
        ruleVersion: number;
        eventId: string;
        action: "start" | "stop" | "suspend" | "resume" | "runbook";
        status: "failed" | "done" | "preview" | "pending" | "skipped";
        startedAt: number;
        vmId?: string | undefined;
        finishedAt?: number | undefined;
        reason?: string | undefined;
        steps?: {
            name: string;
            code: number;
        }[] | undefined;
    }[];
    error?: string | undefined;
    collecting: boolean;
    limits: {
        rules: number;
        history: number;
        observed: number;
        dailyActions: number;
    };
};

export type ItemV1 = {
    name: string;
    version: string;
    description?: string | undefined;
    installedVersion?: string | undefined;
    availableVersion?: string | undefined;
};

export type FamilyV1 = "iptables" | "ip6tables";

export type VulnerabilityMatchV1 = PackageVersionV1 & {
    ids: string[];
};

export type StorageRequestV1 = {
    owner: string;
    taskId: string;
    label: string;
    paths: readonly string[];
    mode: "write" | "read";
    transfer?: "outbound" | undefined;
    buffers: number;
    files: number;
    temporary?: readonly {
        path: string;
        bytes: number;
    }[] | undefined;
    temporaryPhases?: readonly (readonly {
        path: string;
        bytes: number;
    }[])[] | undefined;
    dynamicTemporary?: readonly string[] | undefined;
    lane?: "interactive" | "background" | "control" | undefined;
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
};

export type SyncChangeV1 = {
    path: string;
    from?: string | undefined;
    driver?: "manual" | "keep-both" | "prefer-host" | "prefer-guest" | "merge-text" | undefined;
    suggestedDecision?: "push" | "pull" | "skip" | "merge" | "both" | undefined;
    action: "push" | "pull" | "skip" | "delete-host" | "delete-guest" | "conflict" | "mkdir-host" | "mkdir-guest" | "rename-host" | "rename-guest";
};

export type PreparationContextV1 = {
    id: string;
    scope: string;
    project: ProjectV1;
    version: string;
    live: Readonly<Pick<LiveV1, "error" | "accelerator" | "status" | "incoming" | "startedAt" | "sshPort" | "qmpPort" | "agentPort" | "serialPort" | "memoryTargetMiB">> & {
        readonly abort: Readonly<Pick<AbortController, "signal">>;
    };
    abort: AbortSignal;
    identity?: Readonly<{
        vmId: string;
        vmProcessId: string;
        executionGeneration: string;
        bootId?: string | undefined;
        networkGeneration?: string | undefined;
    }> | undefined;
};

export type LiveV1 = {
    lifetime?: VmLifetimeV1 | undefined;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    incoming?: boolean | undefined;
    accelerator: "tcg" | "whpx";
    startedAt: string;
    sshPort: number;
    qmpPort: number;
    agentPort: number;
    serialPort: number;
    network?: VmNetworkLeaseV1 | undefined;
    abort: AbortController;
    bootAbort: AbortController;
    bootstrapKnown?: boolean | undefined;
    serialConnected?: boolean | undefined;
    serialReady?: boolean | undefined;
    serialTail?: string | undefined;
    done: Promise<void>;
    bootDone?: Promise<void> | undefined;
    allowInitialReset?: boolean | undefined;
    serial?: import("net").Socket | undefined;
    clients: Set<import("ssh2").Client>;
    memoryTargetMiB?: number | undefined;
    error?: string | undefined;
};

export type PackageVersionV1 = {
    name: string;
    version: string;
};

export interface VmLifetimeV1 {
  readonly "vmProcessId": `${string}-${string}-${string}-${string}-${string}`;
  readonly "resources": ResourceScopeV1;
  readonly "vmId": string;
  readonly "abort": AbortController;
  readonly "signal": AbortSignal;
  readonly "lastObservedBootId": string | undefined;
  readonly "active": number;
  readonly "admitting": boolean;
  "capture": () => Readonly<{
    vmId: string;
    vmProcessId: string;
    executionGeneration: string;
    bootId?: string | undefined;
    networkGeneration?: string | undefined;
}>;
  "assert": (identity: Readonly<{
    vmId: string;
    vmProcessId: string;
    executionGeneration: string;
    bootId?: string | undefined;
    networkGeneration?: string | undefined;
}>) => void;
  "observeBoot": (bootId: string) => void;
  "advanceExecution": () => Readonly<{
    vmId: string;
    vmProcessId: string;
    executionGeneration: string;
    bootId?: string | undefined;
    networkGeneration?: string | undefined;
}>;
  "setNetwork": (lease: VmNetworkLeaseV1) => Promise<void>;
  "own": <T extends {
    close(): unknown;
}>(name: string, resource: T, order?: number) => Promise<T>;
  "enter": (identity?: Readonly<{
    vmId: string;
    vmProcessId: string;
    executionGeneration: string;
    bootId?: string | undefined;
    networkGeneration?: string | undefined;
}>, options?: {
    persistent?: boolean | undefined;
}) => {
    signal: AbortSignal;
    release: () => void;
    cleanupPending: (error: unknown) => void;
};
  "exclusive": <T>(work: () => Promise<T>, allowFailed?: boolean) => Promise<T>;
  "barrier": <T>(work: () => Promise<T>, cancel?: boolean, allowFailed?: boolean) => Promise<T>;
  "end": (reason?: unknown) => void;
  "close": () => Promise<void>;
}

export type VmNetworkLeaseV1 = {
    readonly vmId: string;
    readonly generation: string;
    readonly netdev: string;
    readonly policy: Readonly<{
        isolated: boolean;
        ipv6: boolean;
        forwards: readonly {
            host: number;
            guest: number;
        }[];
    }>;
    readonly signal: AbortSignal;
    readonly connected: boolean;
    readonly resources?: Readonly<{
        worker: string;
        backend?: string | undefined;
    }> | undefined;
    setConnected(connected: boolean): Promise<void>;
    forward(verb: "remove" | "add", port: {
        host: number;
        guest: number;
    }): Promise<void>;
    renew(generation: string): Promise<VmNetworkLeaseV1>;
    close(): Promise<void>;
};

export interface ResourceScopeV1 {
  readonly "signal": AbortSignal;
  "defer": (name: string, dispose: () => unknown, order?: number, requires?: readonly string[]) => () => void;
  "own": <T extends {
    close(): unknown;
}>(name: string, value: T, order?: number) => T;
  "child": (name: string, order?: number, owner?: string) => ResourceScopeV1;
  "retryCleanup": () => Promise<void>;
  "close": () => Promise<void>;
}

export interface CapabilityChecksV1 {
  acmeAllowed(): boolean;
  mutation(delta: number): void;
  scoreHosts(input: unknown): ReturnType<HostPeersV1['score']>;
  sharedDesktopCheck(id: string): Promise<{ ready: boolean; reason?: string }>;
  sharedTerminalCheck(id: string): Promise<{ ready: boolean; reason?: string }>;
  passkeyCheck(): { ready: boolean; registered: number; reason?: string };
  accountModeReady(): boolean;
  mobileCheck(): { ready: boolean; devices: number; reason?: string };
  remoteAuditCheck(): Promise<{ ready: boolean; configured: boolean; anchoredSequence: number; reason?: string }>;
}

/** Management access keeps the domain's recovery authority behind its versioned interface. */
export interface RecoveryCatalogV1 {
  refresh(): Promise<RecoveryView[]>;
  view(): RecoveryView[];
  diagnostics(): RecoveryDiagnostics;
  retry(input: unknown): Promise<RecoveryView>;
  rebuild(input: unknown): Promise<RecoveryCatalogView>;
  close(): Promise<void>;
}
