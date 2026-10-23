// Generated from independent versioned interfaces by scripts/service-contracts.ts.
// 公开服务能力目录：仅由独立版本接口生成成员、方法及嵌套返回关系，供服务代理校验能力边界。
// Public service capabilities: derive members/methods/nested returns only from independent versioned interfaces for broker capability checks.
import type { ServiceContract } from './service-ref.ts';

/** 以稳定服务 ID 索引能力描述；members/optional/methods 限制公开访问，properties/returns 指向嵌套服务关系，描述数据不直接执行方法。
 * Index capabilities by stable service ID; members/optional/methods bound public access and properties/returns identify nested services. Descriptor data does not execute methods. */
export const PUBLIC_SERVICE_CONTRACTS: Readonly<Record<string, ServiceContract<any>>> = {
  "sakura.service.access-control.v1": {
    "id": "sakura.service.access-control.v1",
    "version": 1,
    "members": [
      "addPasskey",
      "authorize",
      "cancelHandoff",
      "changeOwnerPassword",
      "completeFederatedLogin",
      "completePasskeyLogin",
      "createHandoff",
      "createMember",
      "createViewer",
      "enable",
      "enabled",
      "getPasskey",
      "login",
      "logout",
      "passkeysFor",
      "redeemHandoff",
      "registeredPasskeysFor",
      "removeMember",
      "removePasskey",
      "removeViewer",
      "revokeAll",
      "revokeFederatedCredential",
      "status",
      "users"
    ],
    "methods": [
      "addPasskey",
      "authorize",
      "cancelHandoff",
      "changeOwnerPassword",
      "completeFederatedLogin",
      "completePasskeyLogin",
      "createHandoff",
      "createMember",
      "createViewer",
      "enable",
      "getPasskey",
      "login",
      "logout",
      "passkeysFor",
      "redeemHandoff",
      "registeredPasskeysFor",
      "removeMember",
      "removePasskey",
      "removeViewer",
      "revokeAll",
      "revokeFederatedCredential",
      "status",
      "users"
    ]
  },
  "sakura.service.acme-renewal.v1": {
    "id": "sakura.service.acme-renewal.v1",
    "version": 1,
    "members": [
      "check",
      "run",
      "save",
      "tick",
      "view"
    ],
    "methods": [
      "check",
      "run",
      "save",
      "tick",
      "view"
    ]
  },
  "sakura.service.automation-rules.v1": {
    "id": "sakura.service.automation-rules.v1",
    "version": 1,
    "members": [
      "configure",
      "tick",
      "view"
    ],
    "methods": [
      "configure",
      "tick",
      "view"
    ]
  },
  "sakura.service.backup-recovery.v1": {
    "id": "sakura.service.backup-recovery.v1",
    "version": 1,
    "members": [
      "artifact",
      "jobs",
      "run",
      "view"
    ],
    "methods": [
      "artifact",
      "run",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.backups.v1": {
    "id": "sakura.service.backups.v1",
    "version": 1,
    "members": [
      "downloadable",
      "jobs",
      "operate",
      "policy",
      "recoverTicket",
      "recoveryTickets",
      "run",
      "tick",
      "view",
      "withVerifiedFile"
    ],
    "methods": [
      "downloadable",
      "operate",
      "policy",
      "recoverTicket",
      "recoveryTickets",
      "run",
      "tick",
      "view",
      "withVerifiedFile"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.browser-extensions.v1": {
    "id": "sakura.service.browser-extensions.v1",
    "version": 1,
    "members": [
      "authorize",
      "connect",
      "createPairing",
      "list",
      "revoke",
      "revokeAll"
    ],
    "methods": [
      "authorize",
      "connect",
      "createPairing",
      "list",
      "revoke",
      "revokeAll"
    ]
  },
  "sakura.service.browser-ide.v1": {
    "id": "sakura.service.browser-ide.v1",
    "version": 1,
    "members": [
      "link",
      "run",
      "view"
    ],
    "methods": [
      "link",
      "run",
      "view"
    ]
  },
  "sakura.service.build-farm.v1": {
    "id": "sakura.service.build-farm.v1",
    "version": 1,
    "members": [
      "action",
      "jobs",
      "projects",
      "view"
    ],
    "methods": [
      "action",
      "projects",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.bundles.v1": {
    "id": "sakura.service.bundles.v1",
    "version": 1,
    "members": [
      "clone",
      "export",
      "import",
      "importExternal",
      "withDisk",
      "withExportBudget"
    ],
    "methods": [
      "clone",
      "export",
      "import",
      "importExternal",
      "withDisk",
      "withExportBudget"
    ]
  },
  "sakura.service.capability-checks.v1": {
    "id": "sakura.service.capability-checks.v1",
    "version": 1,
    "members": [
      "accountModeReady",
      "acmeAllowed",
      "mobileCheck",
      "mutation",
      "passkeyCheck",
      "remoteAuditCheck",
      "scoreHosts",
      "sharedDesktopCheck",
      "sharedTerminalCheck"
    ],
    "methods": [
      "accountModeReady",
      "acmeAllowed",
      "mobileCheck",
      "mutation",
      "passkeyCheck",
      "remoteAuditCheck",
      "scoreHosts",
      "sharedDesktopCheck",
      "sharedTerminalCheck"
    ]
  },
  "sakura.service.change-approvals.v1": {
    "id": "sakura.service.change-approvals.v1",
    "version": 1,
    "members": [
      "apply",
      "create",
      "decide",
      "list"
    ],
    "methods": [
      "apply",
      "create",
      "decide",
      "list"
    ]
  },
  "sakura.service.code-intelligence.v1": {
    "id": "sakura.service.code-intelligence.v1",
    "version": 1,
    "members": [
      "diagnose"
    ],
    "methods": [
      "diagnose"
    ]
  },
  "sakura.service.cold-migrations.v1": {
    "id": "sakura.service.cold-migrations.v1",
    "version": 1,
    "members": [
      "preview",
      "previewDrain",
      "recoverTicket",
      "recoveryTickets",
      "run",
      "runDrain",
      "view"
    ],
    "methods": [
      "preview",
      "previewDrain",
      "recoverTicket",
      "recoveryTickets",
      "run",
      "runDrain",
      "view"
    ]
  },
  "sakura.service.command-presets.v1": {
    "id": "sakura.service.command-presets.v1",
    "version": 1,
    "members": [
      "jobs",
      "list",
      "remove",
      "run",
      "save"
    ],
    "methods": [
      "list",
      "remove",
      "run",
      "save"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.community-plugins.v1": {
    "id": "sakura.service.community-plugins.v1",
    "version": 1,
    "members": [
      "action",
      "invokeRoute",
      "recoverCleanup",
      "tick",
      "view"
    ],
    "methods": [
      "action",
      "invokeRoute",
      "recoverCleanup",
      "tick",
      "view"
    ]
  },
  "sakura.service.containers.v1": {
    "id": "sakura.service.containers.v1",
    "version": 1,
    "members": [
      "jobs",
      "logs",
      "privateDatabase",
      "run",
      "templateMetadata",
      "view"
    ],
    "methods": [
      "logs",
      "privateDatabase",
      "run",
      "templateMetadata",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.data-migration.v1": {
    "id": "sakura.service.data-migration.v1",
    "version": 1,
    "members": [
      "blocked",
      "cancelActivation",
      "jobs",
      "plan",
      "start",
      "view"
    ],
    "methods": [
      "cancelActivation",
      "plan",
      "start",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.debug-adapter.v1": {
    "id": "sakura.service.debug-adapter.v1",
    "version": 1,
    "members": [
      "command",
      "expand",
      "inspect",
      "install",
      "setBreakpoints",
      "start",
      "status",
      "stop"
    ],
    "methods": [
      "command",
      "expand",
      "inspect",
      "install",
      "setBreakpoints",
      "start",
      "status",
      "stop"
    ]
  },
  "sakura.service.delivery-artifacts.v1": {
    "id": "sakura.service.delivery-artifacts.v1",
    "version": 1,
    "members": [
      "begin",
      "chunk",
      "cleanup",
      "cleanupPlan",
      "closeRead",
      "complete",
      "get",
      "list",
      "openRead",
      "read",
      "references",
      "release",
      "retain",
      "seal",
      "verify"
    ],
    "methods": [
      "begin",
      "chunk",
      "cleanup",
      "cleanupPlan",
      "closeRead",
      "complete",
      "get",
      "list",
      "openRead",
      "read",
      "references",
      "release",
      "retain",
      "seal",
      "verify"
    ]
  },
  "sakura.service.delivery-gates.v1": {
    "id": "sakura.service.delivery-gates.v1",
    "version": 1,
    "members": [
      "assertCurrent",
      "evaluate",
      "savePolicy",
      "view"
    ],
    "methods": [
      "assertCurrent",
      "evaluate",
      "savePolicy",
      "view"
    ]
  },
  "sakura.service.delivery-inputs.v1": {
    "id": "sakura.service.delivery-inputs.v1",
    "version": 1,
    "members": [
      "capture",
      "compare",
      "get",
      "list",
      "preview"
    ],
    "methods": [
      "capture",
      "compare",
      "get",
      "list",
      "preview"
    ]
  },
  "sakura.service.delivery-previews.v1": {
    "id": "sakura.service.delivery-previews.v1",
    "version": 1,
    "members": [
      "get",
      "health",
      "list",
      "recover",
      "start",
      "stop"
    ],
    "methods": [
      "get",
      "health",
      "list",
      "recover",
      "start",
      "stop"
    ]
  },
  "sakura.service.delivery-releases.v1": {
    "id": "sakura.service.delivery-releases.v1",
    "version": 1,
    "members": [
      "acceptImport",
      "candidate",
      "changeStatus",
      "channel",
      "createCandidate",
      "export",
      "importPackage",
      "register",
      "trust",
      "view"
    ],
    "methods": [
      "acceptImport",
      "candidate",
      "changeStatus",
      "channel",
      "createCandidate",
      "export",
      "importPackage",
      "register",
      "trust",
      "view"
    ]
  },
  "sakura.service.delivery-reports.v1": {
    "id": "sakura.service.delivery-reports.v1",
    "version": 1,
    "members": [
      "compare",
      "get",
      "ingest",
      "view"
    ],
    "methods": [
      "compare",
      "get",
      "ingest",
      "view"
    ]
  },
  "sakura.service.delivery-runners.v1": {
    "id": "sakura.service.delivery-runners.v1",
    "version": 1,
    "members": [
      "cancel",
      "get",
      "list",
      "recover",
      "start"
    ],
    "methods": [
      "cancel",
      "get",
      "list",
      "recover",
      "start"
    ]
  },
  "sakura.service.delivery-workbench.v1": {
    "id": "sakura.service.delivery-workbench.v1",
    "version": 1,
    "members": [
      "archive",
      "copy",
      "previewImport",
      "save",
      "view"
    ],
    "methods": [
      "archive",
      "copy",
      "previewImport",
      "save",
      "view"
    ]
  },
  "sakura.service.desktops.v1": {
    "id": "sakura.service.desktops.v1",
    "version": 1,
    "members": [
      "apps",
      "attach",
      "clipboard",
      "installIme",
      "start",
      "stop",
      "view",
      "waylandClipboard"
    ],
    "methods": [
      "attach",
      "installIme",
      "start",
      "stop",
      "view"
    ],
    "properties": {
      "apps": "sakura.service.single-app-windows.v1",
      "clipboard": "sakura.service.x11clipboard.v1",
      "waylandClipboard": "sakura.service.wayland-clipboard.v1"
    }
  },
  "sakura.service.disaster-recovery-drill.v1": {
    "id": "sakura.service.disaster-recovery-drill.v1",
    "version": 1,
    "members": [
      "run",
      "status"
    ],
    "methods": [
      "run",
      "status"
    ]
  },
  "sakura.service.disk-imports.v1": {
    "id": "sakura.service.disk-imports.v1",
    "version": 1,
    "members": [
      "import"
    ],
    "methods": [
      "import"
    ]
  },
  "sakura.service.downloads.v1": {
    "id": "sakura.service.downloads.v1",
    "version": 1,
    "members": [
      "issue",
      "issueLocal",
      "issueStream",
      "jobs",
      "route",
      "send"
    ],
    "methods": [
      "issue",
      "issueLocal",
      "issueStream",
      "route",
      "send"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.extended-features.v1": {
    "id": "sakura.service.extended-features.v1",
    "version": 1,
    "members": [
      "action",
      "catalog",
      "configure",
      "jobs",
      "view"
    ],
    "methods": [
      "action",
      "catalog",
      "configure",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.feature-rollouts.v1": {
    "id": "sakura.service.feature-rollouts.v1",
    "version": 1,
    "members": [
      "configure",
      "decision",
      "view"
    ],
    "methods": [
      "configure",
      "decision",
      "view"
    ]
  },
  "sakura.service.feature-scheduler.v1": {
    "id": "sakura.service.feature-scheduler.v1",
    "version": 1,
    "members": []
  },
  "sakura.service.feature-suite.v1": {
    "id": "sakura.service.feature-suite.v1",
    "version": 1,
    "members": [
      "acknowledge",
      "action",
      "alertEvents",
      "applyPreset",
      "catalog",
      "dev",
      "discoverPorts",
      "diskAnalysis",
      "enableBackground",
      "feature",
      "jobs",
      "memoryTarget",
      "networkTest",
      "package",
      "packageWorkbench",
      "sample",
      "search",
      "securityScan",
      "tick",
      "update",
      "view"
    ],
    "methods": [
      "acknowledge",
      "action",
      "alertEvents",
      "applyPreset",
      "catalog",
      "dev",
      "discoverPorts",
      "diskAnalysis",
      "enableBackground",
      "feature",
      "memoryTarget",
      "networkTest",
      "package",
      "sample",
      "search",
      "securityScan",
      "tick",
      "update",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1",
      "packageWorkbench": "sakura.service.package-workbench.v1"
    }
  },
  "sakura.service.file-history.v1": {
    "id": "sakura.service.file-history.v1",
    "version": 1,
    "members": [
      "capture",
      "content",
      "list",
      "purge",
      "restore",
      "trash"
    ],
    "methods": [
      "capture",
      "content",
      "list",
      "purge",
      "restore",
      "trash"
    ]
  },
  "sakura.service.file-locks.v1": {
    "id": "sakura.service.file-locks.v1",
    "version": 1,
    "members": [
      "acquire",
      "clear",
      "release",
      "renew",
      "view",
      "withMutation"
    ],
    "methods": [
      "acquire",
      "clear",
      "release",
      "renew",
      "view",
      "withMutation"
    ]
  },
  "sakura.service.files.v1": {
    "id": "sakura.service.files.v1",
    "version": 1,
    "members": [
      "chunk",
      "download",
      "info",
      "operation",
      "preview",
      "trash",
      "upload",
      "uploads"
    ],
    "optional": [
      "trash"
    ],
    "methods": [
      "chunk",
      "download",
      "info",
      "operation",
      "preview",
      "upload"
    ],
    "properties": {
      "uploads": "sakura.service.resumable-uploads.v1"
    }
  },
  "sakura.service.fleet-policy-rollouts.v1": {
    "id": "sakura.service.fleet-policy-rollouts.v1",
    "version": 1,
    "members": [
      "configure",
      "view"
    ],
    "methods": [
      "configure",
      "view"
    ]
  },
  "sakura.service.folder-sync.v1": {
    "id": "sakura.service.folder-sync.v1",
    "version": 1,
    "members": [
      "config",
      "jobs",
      "mergePreview",
      "preview",
      "queue",
      "recoverTicket",
      "recoveryTickets",
      "rollback",
      "run",
      "save",
      "tick",
      "view"
    ],
    "methods": [
      "config",
      "mergePreview",
      "preview",
      "queue",
      "recoverTicket",
      "recoveryTickets",
      "rollback",
      "run",
      "save",
      "tick",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.git-workbench.v1": {
    "id": "sakura.service.git-workbench.v1",
    "version": 1,
    "members": [
      "conflictChoices",
      "diff",
      "jobs",
      "mergeInputs",
      "run",
      "view"
    ],
    "methods": [
      "conflictChoices",
      "diff",
      "mergeInputs",
      "run",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.golden-images.v1": {
    "id": "sakura.service.golden-images.v1",
    "version": 1,
    "members": [
      "action",
      "jobs",
      "view"
    ],
    "methods": [
      "action",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.gpu-profiles.v1": {
    "id": "sakura.service.gpu-profiles.v1",
    "version": 1,
    "members": [
      "action",
      "view"
    ],
    "methods": [
      "action",
      "view"
    ]
  },
  "sakura.service.graph-api.v1": {
    "id": "sakura.service.graph-api.v1",
    "version": 1,
    "members": [
      "query"
    ],
    "methods": [
      "query"
    ]
  },
  "sakura.service.ha-failure-monitor.v1": {
    "id": "sakura.service.ha-failure-monitor.v1",
    "version": 1,
    "members": [
      "reconfigure",
      "sample",
      "view"
    ],
    "methods": [
      "reconfigure",
      "sample",
      "view"
    ]
  },
  "sakura.service.ha-host-failover.v1": {
    "id": "sakura.service.ha-host-failover.v1",
    "version": 1,
    "members": [
      "authorizeStart",
      "configured",
      "disarm",
      "rejoin",
      "sample",
      "view",
      "witnessStatus"
    ],
    "methods": [
      "authorizeStart",
      "configured",
      "disarm",
      "rejoin",
      "sample",
      "view",
      "witnessStatus"
    ]
  },
  "sakura.service.ha-local-failovers.v1": {
    "id": "sakura.service.ha-local-failovers.v1",
    "version": 1,
    "members": [
      "hasObservedLive",
      "rejoin",
      "sample",
      "view"
    ],
    "methods": [
      "hasObservedLive",
      "rejoin",
      "sample",
      "view"
    ]
  },
  "sakura.service.host-mounts.v1": {
    "id": "sakura.service.host-mounts.v1",
    "version": 1,
    "members": [
      "action",
      "view"
    ],
    "methods": [
      "action",
      "view"
    ]
  },
  "sakura.service.host-peers.v1": {
    "id": "sakura.service.host-peers.v1",
    "version": 1,
    "members": [
      "abortLiveTarget",
      "activateImport",
      "activateReplica",
      "checkImportActivation",
      "checkReplicaActivation",
      "closeMigrationSession",
      "completeLiveTarget",
      "configure",
      "importStatus",
      "inspectLiveTarget",
      "matchesMigrationSession",
      "openMigrationForward",
      "prepareLiveTarget",
      "publishRollout",
      "refresh",
      "registerMigrationSession",
      "retireReplica",
      "rolloutStatus",
      "score",
      "status",
      "targetMigrationQmp",
      "upload",
      "view"
    ],
    "methods": [
      "abortLiveTarget",
      "activateImport",
      "activateReplica",
      "checkImportActivation",
      "checkReplicaActivation",
      "closeMigrationSession",
      "completeLiveTarget",
      "configure",
      "importStatus",
      "inspectLiveTarget",
      "matchesMigrationSession",
      "openMigrationForward",
      "prepareLiveTarget",
      "publishRollout",
      "refresh",
      "registerMigrationSession",
      "retireReplica",
      "rolloutStatus",
      "score",
      "status",
      "targetMigrationQmp",
      "upload",
      "view"
    ],
    "returns": {
      "openMigrationForward": "sakura.service.host-peers.v1/openMigrationForward"
    }
  },
  "sakura.service.host-peers.v1/openMigrationForward": {
    "id": "sakura.service.host-peers.v1/openMigrationForward",
    "version": 1,
    "members": [
      "close",
      "port"
    ],
    "methods": [
      "close"
    ]
  },
  "sakura.service.http-ingress.v1": {
    "id": "sakura.service.http-ingress.v1",
    "version": 1,
    "members": [
      "action",
      "aliasNames",
      "view"
    ],
    "methods": [
      "action",
      "aliasNames",
      "view"
    ]
  },
  "sakura.service.ide.v1": {
    "id": "sakura.service.ide.v1",
    "version": 1,
    "members": [
      "install",
      "profile",
      "stop",
      "update",
      "view"
    ],
    "methods": [
      "install",
      "profile",
      "stop",
      "update",
      "view"
    ]
  },
  "sakura.service.images.v1": {
    "id": "sakura.service.images.v1",
    "version": 1,
    "members": [
      "jobs",
      "list",
      "prepare"
    ],
    "methods": [
      "list",
      "prepare"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.ingress-certificates.v1": {
    "id": "sakura.service.ingress-certificates.v1",
    "version": 1,
    "members": [
      "action",
      "ensure",
      "onChange",
      "rotate",
      "tlsOptions",
      "view"
    ],
    "methods": [
      "action",
      "ensure",
      "onChange",
      "rotate",
      "tlsOptions",
      "view"
    ]
  },
  "sakura.service.jit-privileges.v1": {
    "id": "sakura.service.jit-privileges.v1",
    "version": 1,
    "members": [
      "create",
      "decide",
      "execute",
      "list"
    ],
    "methods": [
      "create",
      "decide",
      "execute",
      "list"
    ]
  },
  "sakura.service.jobs.v1": {
    "id": "sakura.service.jobs.v1",
    "version": 1,
    "members": [
      "cancel",
      "clearCompletedLogs",
      "close",
      "flush",
      "get",
      "list",
      "persistenceError",
      "resolveCleanup",
      "result",
      "start",
      "track",
      "view",
      "wait"
    ],
    "optional": [
      "persistenceError"
    ],
    "methods": [
      "cancel",
      "clearCompletedLogs",
      "close",
      "flush",
      "get",
      "list",
      "resolveCleanup",
      "result",
      "start",
      "track",
      "view",
      "wait"
    ]
  },
  "sakura.service.language-services.v1": {
    "id": "sakura.service.language-services.v1",
    "version": 1,
    "members": [
      "apply",
      "execute",
      "install",
      "status",
      "stop"
    ],
    "methods": [
      "apply",
      "execute",
      "install",
      "status",
      "stop"
    ]
  },
  "sakura.service.live-migration-receiver.v1": {
    "id": "sakura.service.live-migration-receiver.v1",
    "version": 1,
    "members": [
      "abort",
      "complete",
      "prepare",
      "status",
      "verifiedStatus"
    ],
    "methods": [
      "abort",
      "complete",
      "prepare",
      "status",
      "verifiedStatus"
    ]
  },
  "sakura.service.local-aliases.v1": {
    "id": "sakura.service.local-aliases.v1",
    "version": 1,
    "members": [
      "action",
      "refresh",
      "view"
    ],
    "methods": [
      "action",
      "refresh",
      "view"
    ]
  },
  "sakura.service.local-assistant.v1": {
    "id": "sakura.service.local-assistant.v1",
    "version": 1,
    "members": [
      "configure",
      "generate",
      "models",
      "preview",
      "revoke",
      "view"
    ],
    "methods": [
      "configure",
      "generate",
      "models",
      "preview",
      "revoke",
      "view"
    ]
  },
  "sakura.service.log-retention.v1": {
    "id": "sakura.service.log-retention.v1",
    "version": 1,
    "members": [
      "cleanupExecute",
      "cleanupSnapshot",
      "preview",
      "save",
      "sweep",
      "view"
    ],
    "methods": [
      "cleanupExecute",
      "cleanupSnapshot",
      "preview",
      "save",
      "sweep",
      "view"
    ]
  },
  "sakura.service.maintenance.v1": {
    "id": "sakura.service.maintenance.v1",
    "version": 1,
    "members": [
      "compact",
      "diagnose",
      "diskPolicy",
      "diskRun",
      "diskView",
      "finishResize",
      "jobs",
      "report",
      "resize",
      "storage",
      "tick"
    ],
    "methods": [
      "compact",
      "diagnose",
      "diskPolicy",
      "diskRun",
      "diskView",
      "finishResize",
      "report",
      "resize",
      "storage",
      "tick"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.media-devices.v1": {
    "id": "sakura.service.media-devices.v1",
    "version": 1,
    "members": [
      "action",
      "view"
    ],
    "methods": [
      "action",
      "view"
    ]
  },
  "sakura.service.memory-reclaim.v1": {
    "id": "sakura.service.memory-reclaim.v1",
    "version": 1,
    "members": [
      "action",
      "sample",
      "view"
    ],
    "methods": [
      "action",
      "sample",
      "view"
    ]
  },
  "sakura.service.metrics.v1": {
    "id": "sakura.service.metrics.v1",
    "version": 1,
    "members": [
      "forget",
      "sample"
    ],
    "methods": [
      "forget",
      "sample"
    ]
  },
  "sakura.service.mobile-companion.v1": {
    "id": "sakura.service.mobile-companion.v1",
    "version": 1,
    "members": [
      "action",
      "handle",
      "revokeAll",
      "view"
    ],
    "methods": [
      "action",
      "handle",
      "revokeAll",
      "view"
    ]
  },
  "sakura.service.native-clipboard.v1": {
    "id": "sakura.service.native-clipboard.v1",
    "version": 1,
    "members": [
      "action",
      "view"
    ],
    "methods": [
      "action",
      "view"
    ]
  },
  "sakura.service.native-integration.v1": {
    "id": "sakura.service.native-integration.v1",
    "version": 1,
    "members": [
      "action",
      "revoke",
      "view"
    ],
    "methods": [
      "action",
      "revoke",
      "view"
    ]
  },
  "sakura.service.network-profiles.v1": {
    "id": "sakura.service.network-profiles.v1",
    "version": 1,
    "members": [
      "apply",
      "environment",
      "jobs",
      "preview",
      "profiles",
      "removeProfile",
      "restore",
      "saveProfile",
      "state",
      "test"
    ],
    "methods": [
      "apply",
      "environment",
      "preview",
      "profiles",
      "removeProfile",
      "restore",
      "saveProfile",
      "state",
      "test"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.next-features.v1": {
    "id": "sakura.service.next-features.v1",
    "version": 1,
    "members": [
      "acmeRenewal",
      "action",
      "browserIdeLink",
      "catalog",
      "configure",
      "haFailureMonitor",
      "haPolicies",
      "jobs",
      "notebookLink",
      "serviceMesh",
      "storageTiering",
      "teamTemplates",
      "view",
      "vtpmEnrollment"
    ],
    "methods": [
      "action",
      "browserIdeLink",
      "catalog",
      "configure",
      "haPolicies",
      "notebookLink",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1",
      "storageTiering": "sakura.service.storage-tiering.v1",
      "serviceMesh": "sakura.service.service-mesh.v1",
      "vtpmEnrollment": "sakura.service.vtpm-enrollment.v1",
      "acmeRenewal": "sakura.service.acme-renewal.v1",
      "teamTemplates": "sakura.service.team-templates.v1",
      "haFailureMonitor": "sakura.service.ha-failure-monitor.v1"
    }
  },
  "sakura.service.notebook-environments.v1": {
    "id": "sakura.service.notebook-environments.v1",
    "version": 1,
    "members": [
      "link",
      "run",
      "view"
    ],
    "methods": [
      "link",
      "run",
      "view"
    ]
  },
  "sakura.service.package-workbench.v1": {
    "id": "sakura.service.package-workbench.v1",
    "version": 1,
    "members": [
      "action",
      "query"
    ],
    "methods": [
      "action",
      "query"
    ]
  },
  "sakura.service.passkeys.v1": {
    "id": "sakura.service.passkeys.v1",
    "version": 1,
    "members": [
      "beginAuthentication",
      "beginRegistration",
      "beginUnlock",
      "finishAuthentication",
      "finishRegistration",
      "finishUnlock"
    ],
    "methods": [
      "beginAuthentication",
      "beginRegistration",
      "beginUnlock",
      "finishAuthentication",
      "finishRegistration",
      "finishUnlock"
    ]
  },
  "sakura.service.pipelines.v1": {
    "id": "sakura.service.pipelines.v1",
    "version": 1,
    "members": [
      "artifact",
      "jobs",
      "list",
      "remove",
      "run",
      "runs",
      "save",
      "view"
    ],
    "methods": [
      "artifact",
      "list",
      "remove",
      "run",
      "runs",
      "save",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.policy-bundles.v1": {
    "id": "sakura.service.policy-bundles.v1",
    "version": 1,
    "members": [
      "action",
      "apply",
      "export",
      "keys",
      "preview"
    ],
    "methods": [
      "action",
      "apply",
      "export",
      "keys",
      "preview"
    ]
  },
  "sakura.service.prepared-project.v1": {
    "id": "sakura.service.prepared-project.v1",
    "version": 1,
    "members": [
      "captured",
      "command",
      "networkIsolation",
      "projectId",
      "release",
      "signal",
      "terminalId"
    ],
    "optional": [
      "captured",
      "signal",
      "terminalId"
    ],
    "methods": [
      "release"
    ]
  },
  "sakura.service.process-interop.v1": {
    "id": "sakura.service.process-interop.v1",
    "version": 1,
    "members": [
      "action",
      "guest"
    ],
    "methods": [
      "action",
      "guest"
    ]
  },
  "sakura.service.project-catalog.v1": {
    "id": "sakura.service.project-catalog.v1",
    "version": 1,
    "members": [
      "create",
      "current",
      "inScope",
      "key",
      "list",
      "readCommittedList",
      "update",
      "with"
    ],
    "methods": [
      "create",
      "current",
      "inScope",
      "key",
      "list",
      "readCommittedList",
      "update",
      "with"
    ]
  },
  "sakura.service.project-execution.v1": {
    "id": "sakura.service.project-execution.v1",
    "version": 1,
    "members": [
      "run"
    ],
    "methods": [
      "run"
    ]
  },
  "sakura.service.project-files.v1": {
    "id": "sakura.service.project-files.v1",
    "version": 1,
    "members": [
      "scan"
    ],
    "methods": [
      "scan"
    ]
  },
  "sakura.service.project-permissions.v1": {
    "id": "sakura.service.project-permissions.v1",
    "version": 1,
    "members": [
      "accessible",
      "configure",
      "liveApprover",
      "require",
      "requireCommitted",
      "requiresApproval",
      "revokeMember",
      "revokeVm",
      "version",
      "view"
    ],
    "methods": [
      "accessible",
      "configure",
      "liveApprover",
      "require",
      "requireCommitted",
      "requiresApproval",
      "revokeMember",
      "revokeVm",
      "version",
      "view"
    ]
  },
  "sakura.service.project-preparation.v1": {
    "id": "sakura.service.project-preparation.v1",
    "version": 1,
    "members": [
      "close",
      "hasTerminal",
      "prepare",
      "prepareTask",
      "retain",
      "serial",
      "signal",
      "workspaces"
    ],
    "methods": [
      "close",
      "hasTerminal",
      "prepare",
      "prepareTask",
      "retain",
      "serial"
    ],
    "properties": {
      "workspaces": "sakura.service.project-terminals.v1/workspaces"
    },
    "returns": {
      "prepareTask": "sakura.service.prepared-project.v1"
    }
  },
  "sakura.service.project-terminals.v1": {
    "id": "sakura.service.project-terminals.v1",
    "version": 1,
    "members": [
      "close",
      "preparation",
      "prepare",
      "prepareTask",
      "stop",
      "validate",
      "workspaces"
    ],
    "methods": [
      "close",
      "prepare",
      "prepareTask",
      "stop",
      "validate"
    ],
    "properties": {
      "workspaces": "sakura.service.project-terminals.v1/workspaces",
      "preparation": "sakura.service.project-preparation.v1"
    },
    "returns": {
      "prepareTask": "sakura.service.prepared-project.v1",
      "prepare": "sakura.service.prepared-project.v1"
    }
  },
  "sakura.service.project-terminals.v1/workspaces": {
    "id": "sakura.service.project-terminals.v1/workspaces",
    "version": 1,
    "members": [
      "beforeAction",
      "beforeConfigChange",
      "config",
      "dependencyDownloadAuthentication",
      "jobs",
      "metrics",
      "networkEnvironment",
      "onConfigChange",
      "projects",
      "readCommittedConfig",
      "repositoryDownloadAuthentication",
      "resolveProject",
      "resolvedConfig",
      "run",
      "runtime",
      "save",
      "view"
    ],
    "methods": [
      "beforeAction",
      "beforeConfigChange",
      "config",
      "dependencyDownloadAuthentication",
      "metrics",
      "networkEnvironment",
      "onConfigChange",
      "readCommittedConfig",
      "repositoryDownloadAuthentication",
      "resolveProject",
      "resolvedConfig",
      "run",
      "runtime",
      "save",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1",
      "projects": "sakura.service.project-catalog.v1"
    }
  },
  "sakura.service.recipes.v1": {
    "id": "sakura.service.recipes.v1",
    "version": 1,
    "members": [
      "apply",
      "applyPlan",
      "create",
      "export",
      "preview",
      "read",
      "write"
    ],
    "methods": [
      "apply",
      "applyPlan",
      "create",
      "export",
      "preview",
      "read",
      "write"
    ]
  },
  "sakura.service.recovery-catalog.v1": {
    "id": "sakura.service.recovery-catalog.v1",
    "version": 1,
    "members": [
      "close",
      "diagnostics",
      "rebuild",
      "refresh",
      "retry",
      "view"
    ],
    "methods": [
      "close",
      "diagnostics",
      "rebuild",
      "refresh",
      "retry",
      "view"
    ]
  },
  "sakura.service.remote-audit-lock.v1": {
    "id": "sakura.service.remote-audit-lock.v1",
    "version": 1,
    "members": [
      "configure",
      "disable",
      "status",
      "sync",
      "verify"
    ],
    "methods": [
      "configure",
      "disable",
      "status",
      "sync",
      "verify"
    ]
  },
  "sakura.service.repair-sessions.v1": {
    "id": "sakura.service.repair-sessions.v1",
    "version": 1,
    "members": [
      "apply",
      "cancel",
      "generate",
      "preview",
      "validate",
      "view"
    ],
    "methods": [
      "apply",
      "cancel",
      "generate",
      "preview",
      "validate",
      "view"
    ]
  },
  "sakura.service.rescue.v1": {
    "id": "sakura.service.rescue.v1",
    "version": 1,
    "members": [
      "artifact",
      "jobs",
      "run",
      "view"
    ],
    "methods": [
      "artifact",
      "run",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.resource-scope.v1": {
    "id": "sakura.service.resource-scope.v1",
    "version": 1,
    "members": [
      "child",
      "close",
      "defer",
      "own",
      "retryCleanup",
      "signal"
    ],
    "methods": [
      "child",
      "close",
      "defer",
      "own",
      "retryCleanup"
    ],
    "returns": {
      "child": "sakura.service.resource-scope.v1"
    }
  },
  "sakura.service.resumable-uploads.v1": {
    "id": "sakura.service.resumable-uploads.v1",
    "version": 1,
    "members": [
      "chunk",
      "commit",
      "create",
      "remove",
      "view"
    ],
    "methods": [
      "chunk",
      "commit",
      "create",
      "remove",
      "view"
    ]
  },
  "sakura.service.runtime-versions.v1": {
    "id": "sakura.service.runtime-versions.v1",
    "version": 1,
    "members": [
      "inspect",
      "install",
      "jobs",
      "probe",
      "select",
      "view"
    ],
    "methods": [
      "inspect",
      "install",
      "probe",
      "select",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.sandboxes.v1": {
    "id": "sakura.service.sandboxes.v1",
    "version": 1,
    "members": [
      "artifact",
      "control",
      "create",
      "jobs",
      "list",
      "run",
      "view"
    ],
    "methods": [
      "artifact",
      "control",
      "create",
      "list",
      "run",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.secrets.v1": {
    "id": "sakura.service.secrets.v1",
    "version": 1,
    "members": [
      "list",
      "remove",
      "resolve",
      "rotation",
      "save",
      "setRotation",
      "value"
    ],
    "methods": [
      "list",
      "remove",
      "resolve",
      "rotation",
      "save",
      "setRotation",
      "value"
    ]
  },
  "sakura.service.service-health.v1": {
    "id": "sakura.service.service-health.v1",
    "version": 1,
    "members": [
      "expect",
      "jobs",
      "observed",
      "tick",
      "view"
    ],
    "methods": [
      "expect",
      "observed",
      "tick",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.service-mesh.v1": {
    "id": "sakura.service.service-mesh.v1",
    "version": 1,
    "members": [
      "action",
      "assertNoRunning",
      "configure",
      "status"
    ],
    "methods": [
      "action",
      "assertNoRunning",
      "configure",
      "status"
    ]
  },
  "sakura.service.session-lock.v1": {
    "id": "sakura.service.session-lock.v1",
    "version": 1,
    "members": [
      "activity",
      "configure",
      "getGeneration",
      "lock",
      "requireUnlocked",
      "unlock",
      "unlockWithPasskey",
      "view"
    ],
    "methods": [
      "activity",
      "configure",
      "getGeneration",
      "lock",
      "requireUnlocked",
      "unlock",
      "unlockWithPasskey",
      "view"
    ]
  },
  "sakura.service.signed-bundles.v1": {
    "id": "sakura.service.signed-bundles.v1",
    "version": 1,
    "members": [
      "action",
      "authorizeExternal",
      "signManifest",
      "view",
      "withAuthorizedExternal"
    ],
    "methods": [
      "action",
      "authorizeExternal",
      "signManifest",
      "view",
      "withAuthorizedExternal"
    ]
  },
  "sakura.service.single-app-windows.v1": {
    "id": "sakura.service.single-app-windows.v1",
    "version": 1,
    "members": [
      "clipboardPolicies",
      "connectionCommand",
      "list",
      "onSessionInvalidated",
      "port",
      "removeClipboardPolicy",
      "saveClipboardPolicy",
      "start",
      "stop"
    ],
    "methods": [
      "clipboardPolicies",
      "connectionCommand",
      "list",
      "onSessionInvalidated",
      "port",
      "removeClipboardPolicy",
      "saveClipboardPolicy",
      "start",
      "stop"
    ]
  },
  "sakura.service.single-sign-on.v1": {
    "id": "sakura.service.single-sign-on.v1",
    "version": 1,
    "members": [
      "begin",
      "cancelPending",
      "completeOidc",
      "completeSaml",
      "configureOidc",
      "configureSaml",
      "disable",
      "pendingOrigin",
      "providers",
      "unlink",
      "view"
    ],
    "methods": [
      "begin",
      "cancelPending",
      "completeOidc",
      "completeSaml",
      "configureOidc",
      "configureSaml",
      "disable",
      "pendingOrigin",
      "providers",
      "unlink",
      "view"
    ]
  },
  "sakura.service.snapshot-diff.v1": {
    "id": "sakura.service.snapshot-diff.v1",
    "version": 1,
    "members": [
      "jobs",
      "run",
      "view"
    ],
    "methods": [
      "run",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.snapshot-merge.v1": {
    "id": "sakura.service.snapshot-merge.v1",
    "version": 1,
    "members": [
      "jobs",
      "run",
      "view"
    ],
    "methods": [
      "run",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.snapshot-replications.v1": {
    "id": "sakura.service.snapshot-replications.v1",
    "version": 1,
    "members": [
      "preview",
      "run",
      "view"
    ],
    "methods": [
      "preview",
      "run",
      "view"
    ]
  },
  "sakura.service.storage-runtime.v1": {
    "id": "sakura.service.storage-runtime.v1",
    "version": 1,
    "members": [
      "acquire",
      "run"
    ],
    "methods": [
      "acquire",
      "run"
    ],
    "returns": {
      "acquire": "sakura.service.storage-runtime.v1/acquire"
    }
  },
  "sakura.service.storage-runtime.v1/acquire": {
    "id": "sakura.service.storage-runtime.v1/acquire",
    "version": 1,
    "members": [
      "assertActive",
      "cleanupPending",
      "id",
      "pendingCleanup",
      "release",
      "releaseTemporary",
      "reserveTemporary",
      "transfer"
    ],
    "methods": [
      "assertActive",
      "cleanupPending",
      "release",
      "releaseTemporary",
      "reserveTemporary",
      "transfer"
    ]
  },
  "sakura.service.storage-tiering.v1": {
    "id": "sakura.service.storage-tiering.v1",
    "version": 1,
    "members": [
      "run",
      "tick",
      "view"
    ],
    "methods": [
      "run",
      "tick",
      "view"
    ]
  },
  "sakura.service.team-templates.v1": {
    "id": "sakura.service.team-templates.v1",
    "version": 1,
    "members": [
      "action"
    ],
    "methods": [
      "action"
    ]
  },
  "sakura.service.terminal-sharing.v1": {
    "id": "sakura.service.terminal-sharing.v1",
    "version": 1,
    "members": [
      "create",
      "find",
      "list",
      "revoke",
      "revokeViewer"
    ],
    "methods": [
      "create",
      "find",
      "list",
      "revoke",
      "revokeViewer"
    ]
  },
  "sakura.service.toolchains.v1": {
    "id": "sakura.service.toolchains.v1",
    "version": 1,
    "members": [
      "install",
      "jobs",
      "view"
    ],
    "methods": [
      "install",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.trusted-boot-service.v1": {
    "id": "sakura.service.trusted-boot-service.v1",
    "version": 1,
    "members": [
      "action",
      "capture",
      "restore",
      "view"
    ],
    "methods": [
      "action",
      "capture",
      "restore",
      "view"
    ]
  },
  "sakura.service.trusted-updates.v1": {
    "id": "sakura.service.trusted-updates.v1",
    "version": 1,
    "members": [
      "action",
      "close",
      "view"
    ],
    "methods": [
      "action",
      "close",
      "view"
    ]
  },
  "sakura.service.usb-hotplug.v1": {
    "id": "sakura.service.usb-hotplug.v1",
    "version": 1,
    "members": [
      "action",
      "reconcile",
      "view"
    ],
    "methods": [
      "action",
      "reconcile",
      "view"
    ]
  },
  "sakura.service.virtio-fs-shares.v1": {
    "id": "sakura.service.virtio-fs-shares.v1",
    "version": 1,
    "members": [
      "action",
      "view"
    ],
    "methods": [
      "action",
      "view"
    ]
  },
  "sakura.service.vm-lifetime.v1": {
    "id": "sakura.service.vm-lifetime.v1",
    "version": 1,
    "members": [
      "abort",
      "active",
      "admitting",
      "advanceExecution",
      "assert",
      "barrier",
      "capture",
      "close",
      "end",
      "enter",
      "exclusive",
      "lastObservedBootId",
      "observeBoot",
      "own",
      "resources",
      "setNetwork",
      "signal",
      "vmId",
      "vmProcessId"
    ],
    "methods": [
      "advanceExecution",
      "assert",
      "barrier",
      "capture",
      "close",
      "end",
      "enter",
      "exclusive",
      "observeBoot",
      "own",
      "setNetwork"
    ],
    "properties": {
      "resources": "sakura.service.resource-scope.v1"
    },
    "returns": {
      "enter": "sakura.service.vm-lifetime.v1/enter"
    }
  },
  "sakura.service.vm-lifetime.v1/enter": {
    "id": "sakura.service.vm-lifetime.v1/enter",
    "version": 1,
    "members": [
      "cleanupPending",
      "release",
      "signal"
    ],
    "methods": [
      "cleanupPending",
      "release"
    ]
  },
  "sakura.service.vtpm-enrollment.v1": {
    "id": "sakura.service.vtpm-enrollment.v1",
    "version": 1,
    "members": [
      "action",
      "status"
    ],
    "methods": [
      "action",
      "status"
    ]
  },
  "sakura.service.wayland-clipboard.v1": {
    "id": "sakura.service.wayland-clipboard.v1",
    "version": 1,
    "members": [
      "action",
      "install",
      "jobs",
      "retireDesktop",
      "view"
    ],
    "methods": [
      "action",
      "install",
      "retireDesktop",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  },
  "sakura.service.webhooks.v1": {
    "id": "sakura.service.webhooks.v1",
    "version": 1,
    "members": [
      "collect",
      "configure",
      "tick",
      "view"
    ],
    "methods": [
      "collect",
      "configure",
      "tick",
      "view"
    ]
  },
  "sakura.service.workspaces.v1": {
    "id": "sakura.service.workspaces.v1",
    "version": 1,
    "members": [
      "beforeAction",
      "beforeConfigChange",
      "config",
      "dependencyDownloadAuthentication",
      "jobs",
      "metrics",
      "networkEnvironment",
      "onConfigChange",
      "projects",
      "readCommittedConfig",
      "repositoryDownloadAuthentication",
      "resolveProject",
      "resolvedConfig",
      "run",
      "runtime",
      "save",
      "view"
    ],
    "methods": [
      "beforeAction",
      "beforeConfigChange",
      "config",
      "dependencyDownloadAuthentication",
      "metrics",
      "networkEnvironment",
      "onConfigChange",
      "readCommittedConfig",
      "repositoryDownloadAuthentication",
      "resolveProject",
      "resolvedConfig",
      "run",
      "runtime",
      "save",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1",
      "projects": "sakura.service.project-catalog.v1"
    }
  },
  "sakura.service.x11clipboard.v1": {
    "id": "sakura.service.x11clipboard.v1",
    "version": 1,
    "members": [
      "action",
      "install",
      "jobs",
      "retireDesktop",
      "view"
    ],
    "methods": [
      "action",
      "install",
      "retireDesktop",
      "view"
    ],
    "properties": {
      "jobs": "sakura.service.jobs.v1"
    }
  }
};
