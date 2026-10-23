/**
 * 模块职责（中文）：核心 API 响应 DTO 的运行时 Schema，供响应契约、文档和客户端类型生成复用。
 * Module responsibility (English): runtime schemas for core API response DTOs.
 * 详细范围（中文）：公开入口包括 jobView_executionVariant0Schema, jobViewSchema, accountUsersSchema, passkeyListSchema, accountCreateSchema, accountRemoveSchema, accountEnableSchema, accountPasswordSchema, passkeyRegistration_options_authenticatorSelectionVariant0Schema, passkeyRegisteredSchema, ssoProvidersSchema, ssoViewSchema, ssoStartSchema, ssoUnlinkSchema, terminalSharesSchema, terminalShareSchema；职责覆盖核心 API 响应 DTO 的运行时 Schema，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include jobView_executionVariant0Schema, jobViewSchema, accountUsersSchema, passkeyListSchema, accountCreateSchema, accountRemoveSchema, accountEnableSchema, accountPasswordSchema, passkeyRegistration_options_authenticatorSelectionVariant0Schema, passkeyRegisteredSchema, ssoProvidersSchema, ssoViewSchema, ssoStartSchema, ssoUnlinkSchema, terminalSharesSchema, terminalShareSchema. The scope covers runtime schemas for core API response DTOs. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';
import { haPromotionSchema, haRetirementSchema, haWitnessEnrollmentSchema, liveMigrationFenceSchema, liveMigrationOriginSchema } from './vm.ts';

/** Public controller wire DTOs. Optional properties reflect JSON omission of undefined values. */
export const jobView_executionVariant0Schema = z.object({
  "command": z.string(),
  "cwd": z.string(),
  "timeoutSeconds": z.number(),
  "requestedArtifacts": z.array(z.string()),
  "artifacts": z.array(z.object({
    "id": z.string(),
    "name": z.string(),
    "path": z.string(),
    "bytes": z.number(),
    "sha256": z.string(),
  }).strict()),
  "timings": z.object({
    "bootMs": z.number().optional(),
    "commandMs": z.number().optional(),
    "artifactsMs": z.number().optional(),
    "shutdownMs": z.number().optional(),
    "totalMs": z.number().optional(),
  }).strict(),
  "exitCode": z.number().optional(),
  "outcome": z.union([z.literal("success"), z.literal("failed"), z.literal("timeout"), z.literal("cancelled"), z.literal("expired"), z.literal("interrupted")]).optional(),
}).strict();

export const jobViewSchema = z.object({
  "correlationId": z.uuid().optional(),
  "title": z.string().optional(),
  "vmId": z.string().optional(),
  "action": z.string().optional(),
  "projectId": z.string().optional(),
  "execution": jobView_executionVariant0Schema.optional(),
  "owner": z.string().optional(),
  "lane": z.union([z.literal("interactive"), z.literal("background"), z.literal("control")]).optional(),
  "admissionTimeoutMs": z.number().optional(),
  "id": z.string().optional(),
  "key": z.string().optional(),
  "scope": z.string().optional(),
  "status": z.union([z.literal("error"), z.literal("cancelled"), z.literal("interrupted"), z.literal("running"), z.literal("done")]),
  "admission": z.union([z.literal("running"), z.literal("queued"), z.literal("cancelling"), z.literal("cleanup-pending")]).optional(),
  "queuedAt": z.string().optional(),
  "executionStartedAt": z.string().optional(),
  "resourceWait": z.object({
    "resource": z.string(),
    "reason": z.string(),
    "since": z.string(),
  }).strict().optional(),
  "resourceLeaseId": z.string().optional(),
  "cleanupLeaseId": z.string().optional(),
  "cleanupResolvedAt": z.string().optional(),
  "delegatedFrom": z.string().optional(),
  "log": z.string(),
  "error": z.string().optional(),
  "errorCode": z.string().optional(),
  "startedAt": z.string(),
  "finishedAt": z.string().optional(),
  "phase": z.string().optional(),
  "progress": z.number().optional(),
  "result": z.object({
    "bytes": z.number(),
    "sha256": z.string(),
  }).strict().optional(),
  "logPruned": z.object({
    "at": z.string(),
    "bytes": z.number(),
  }).strict().optional(),
}).strict();

/** Wire DTO for the explicitly versioned AccessControlV1.users contract. */
export const accountUsersSchema = z.array(z.object({
  "id": z.string(),
  "username": z.string(),
  "role": z.union([z.literal("member"), z.literal("owner"), z.literal("viewer")]),
  "vmIds": z.array(z.string()),
  "expiresAt": z.union([z.null(), z.number()]),
  "createdAt": z.string(),
}).strict());

/** Wire DTO for the explicitly versioned AccessControlV1.passkeysFor contract. */
export const passkeyListSchema = z.array(z.object({
  "id": z.string(),
  "name": z.string(),
  "createdAt": z.string(),
  "lastUsedAt": z.string().optional(),
}).strict());

/** Wire DTO for the explicitly versioned AccessControlV1.createMember contract. */
export const accountCreateSchema = z.object({
  "id": z.string(),
  "username": z.string(),
  "role": z.union([z.literal("member"), z.literal("owner"), z.literal("viewer")]),
  "vmIds": z.array(z.string()),
  "expiresAt": z.union([z.null(), z.number()]),
  "createdAt": z.string(),
}).strict();

/** Wire DTO for the explicitly versioned AccessControlV1.removeMember contract. */
export const accountRemoveSchema = z.object({
  "removed": z.string(),
}).strict();

/** Wire DTO for the explicitly versioned AccessControlV1.enable contract. */
export const accountEnableSchema = z.object({
  "enabled": z.boolean(),
}).strict();

/** Wire DTO for the explicitly versioned AccessControlV1.changeOwnerPassword contract. */
export const accountPasswordSchema = z.object({
  "changed": z.boolean(),
}).strict();

export const passkeyRegistration_options_authenticatorSelectionVariant0Schema = z.object({
  "authenticatorAttachment": z.union([z.literal("cross-platform"), z.literal("platform")]).optional(),
  "requireResidentKey": z.union([z.literal(false), z.literal(true)]).optional(),
  "residentKey": z.union([z.literal("discouraged"), z.literal("preferred"), z.literal("required")]).optional(),
  "userVerification": z.union([z.literal("discouraged"), z.literal("preferred"), z.literal("required")]).optional(),
}).strict();

/** Wire DTO for the explicitly versioned PasskeysV1.finishRegistration contract. */
export const passkeyRegisteredSchema = z.object({
  "id": z.string(),
  "name": z.string(),
  "createdAt": z.string(),
  "lastUsedAt": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned SingleSignOnV1.providers contract. */
export const ssoProvidersSchema = z.object({
  "oidc": z.boolean(),
  "saml": z.boolean(),
}).strict();

export const ssoViewSchema = z.object({
  "oidc": z.object({
    "issuer": z.string(),
    "clientId": z.string(),
    "authMethod": z.union([z.literal("none"), z.literal("client_secret_basic"), z.literal("client_secret_post")]),
    "hasSecret": z.boolean(),
  }).strict().optional(),
  "saml": z.object({
    "issuer": z.string(),
    "entryPoint": z.string(),
    "fingerprints": z.array(z.string()),
  }).strict().optional(),
  "callbackUrl": z.string(),
  "samlCallbackUrl": z.string(),
  "serviceProviderId": z.string(),
  "bindings": z.array(z.object({
    "id": z.string(),
    "provider": z.union([z.literal("oidc"), z.literal("saml")]),
    "accountId": z.string(),
    "issuer": z.string(),
    "subject": z.string(),
    "createdAt": z.string(),
  }).strict()),
}).strict();

/** Wire DTO for the explicitly versioned SingleSignOnV1.begin contract. */
export const ssoStartSchema = z.object({
  "redirect": z.string(),
  "state": z.string(),
  "expiresAt": z.number(),
}).strict();

/** Wire DTO for the explicitly versioned SingleSignOnV1.unlink contract. */
export const ssoUnlinkSchema = z.object({
  "removed": z.number(),
}).strict();

/** Wire DTO for the explicitly versioned TerminalSharingV1.list contract. */
export const terminalSharesSchema = z.array(z.object({
  "id": z.string(),
  "vmId": z.string(),
  "session": z.string(),
  "viewerId": z.string(),
  "createdAt": z.string(),
  "expiresAt": z.number(),
  "projectId": z.string().optional(),
  "terminalId": z.string().optional(),
}).strict());

/** Wire DTO for the explicitly versioned TerminalSharingV1.create contract. */
export const terminalShareSchema = z.object({
  "id": z.string(),
  "vmId": z.string(),
  "session": z.string(),
  "viewerId": z.string(),
  "createdAt": z.string(),
  "expiresAt": z.number(),
  "projectId": z.string().optional(),
  "terminalId": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned TerminalSharingV1.revoke contract. */
export const terminalShareRevokedSchema = z.object({
  "revoked": z.string(),
}).strict();

export const jitList__Schema = z.object({
  "status": z.union([z.literal("failed"), z.literal("expired"), z.literal("pending"), z.literal("completed"), z.literal("revoked"), z.literal("approved"), z.literal("denied"), z.literal("claimed")]),
  "id": z.string(),
  "viewerId": z.string(),
  "vmId": z.string(),
  "operation": z.union([z.literal("start"), z.literal("stop")]),
  "reason": z.string(),
  "createdAt": z.number(),
  "requestExpiresAt": z.number(),
  "approvedBy": z.string().optional(),
  "approvedAt": z.number().optional(),
  "expiresAt": z.number().optional(),
  "decidedAt": z.number().optional(),
  "claimedAt": z.number().optional(),
  "finishedAt": z.number().optional(),
  "error": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned JitPrivilegesV1.list contract. */
export const jitListSchema = z.array(jitList__Schema);

/** Wire DTO for the explicitly versioned JitPrivilegesV1.create contract. */
export const jitRequestSchema = jitList__Schema;

/** Wire DTO for the explicitly versioned BrowserExtensionsV1.list contract. */
export const extensionConnectionsSchema = z.array(z.object({
  "connected": z.boolean(),
  "expired": z.boolean(),
  "permissions": z.array(z.string()),
  "id": z.string(),
  "origin": z.string(),
  "ownerId": z.string(),
  "createdAt": z.number(),
  "expiresAt": z.number(),
  "lastSeenAt": z.number().optional(),
}).strict());

/** Wire DTO for the explicitly versioned BrowserExtensionsV1.createPairing contract. */
export const extensionPairingSchema = z.object({
  "code": z.string(),
  "expiresAt": z.number(),
  "permissions": z.array(z.string()),
}).strict();

/** Wire DTO for the explicitly versioned BrowserExtensionsV1.connect contract. */
export const extensionConnectedSchema = z.object({
  "token": z.string(),
  "id": z.string(),
  "expiresAt": z.number(),
  "permissions": z.array(z.string()),
}).strict();

/** Wire DTO for the explicitly versioned BrowserExtensionsV1.revoke contract. */
export const extensionRevokedSchema = z.object({
  "revoked": z.string(),
}).strict();

export const remoteAuditSchema = z.object({
  "hostId": z.string(),
  "target": z.union([z.null(), z.object({
    "bucket": z.string(),
    "region": z.string(),
    "prefix": z.string(),
    "retentionDays": z.number(),
    "endpoint": z.string().optional(),
  }).strict()]),
  "last": z.object({
    "key": z.string(),
    "versionId": z.string(),
    "sequence": z.number(),
    "hash": z.string(),
    "retainUntil": z.string(),
  }).strict().optional(),
  "local": z.union([z.object({
    "valid": z.boolean(),
    "sequence": z.number(),
    "hash": z.string(),
  }).strict(), z.object({
    "valid": z.boolean(),
    "error": z.string(),
  }).strict()]),
  "protected": z.boolean(),
  "caughtUp": z.boolean(),
  "lastAttemptAt": z.string().optional(),
  "lastVerifiedAt": z.string().optional(),
  "lastError": z.string().optional(),
}).strict();

export const rolloutsSchema = z.object({
  "hostId": z.string(),
  "plugins": z.array(z.object({
    "policy": z.object({
      "pluginId": z.string(),
      "enabled": z.boolean(),
      "percentage": z.number(),
      "cohortVersion": z.string(),
    }).strict().optional(),
    "pluginId": z.string(),
    "allowed": z.boolean(),
    "bucket": z.union([z.null(), z.number()]),
    "id": z.string(),
    "name": z.string(),
  }).strict()),
  "policies": z.array(z.object({
    "pluginId": z.string(),
    "enabled": z.boolean(),
    "percentage": z.number(),
    "cohortVersion": z.string(),
    "revision": z.number(),
    "updatedAt": z.number(),
  }).strict()),
}).strict();

/** Wire DTO for the explicitly versioned FeatureRolloutsV1.configure contract. */
export const rolloutConfiguredSchema = z.union([z.object({
  "policy": z.object({
    "pluginId": z.string(),
    "enabled": z.boolean(),
    "percentage": z.number(),
    "cohortVersion": z.string(),
  }).strict().optional(),
  "pluginId": z.string(),
  "allowed": z.boolean(),
  "bucket": z.union([z.null(), z.number()]),
}).strict(), rolloutsSchema]);

export const usbView_events__Schema = z.object({
  "id": z.string(),
  "vmId": z.string(),
  "operation": z.union([z.literal("attach"), z.literal("detach")]),
  "deviceId": z.string(),
  "vendorId": z.number(),
  "productId": z.number(),
  "source": z.union([z.literal("rule"), z.literal("manual")]),
  "status": z.union([z.literal("failed"), z.literal("configured"), z.literal("requested")]),
  "at": z.string(),
  "error": z.string().optional(),
}).strict();

export const usbViewSchema = z.object({
  "ready": z.boolean(),
  "hostDevices": z.string(),
  "hostError": z.string(),
  "rules": z.array(z.object({
    "id": z.string(),
    "vmId": z.string(),
    "vendorId": z.number(),
    "productId": z.number(),
    "createdAt": z.string(),
    "mediaKind": z.union([z.literal("camera"), z.literal("microphone"), z.literal("headset")]).optional(),
  }).strict()),
  "configured": z.array(z.object({
    "id": z.string(),
    "vendorId": z.number(),
    "productId": z.number(),
    "ruleId": z.string().optional(),
  }).strict()),
  "events": z.array(usbView_events__Schema),
}).strict();

/** Wire DTO for the explicitly versioned UsbHotplugV1.action contract. */
export const usbActionSchema = usbViewSchema;

export const mediaViewSchema = z.object({
  "vmId": z.string(),
  "vmName": z.string(),
  "status": z.union([z.literal("error"), z.literal("running"), z.literal("stopped"), z.literal("starting"), z.literal("paused"), z.literal("stopping")]),
  "audio": z.union([z.literal("none"), z.literal("hda-duplex")]),
  "audioBackend": z.union([z.literal("none"), z.literal("dsound")]),
  "support": z.object({
    "none": z.object({
      "available": z.boolean(),
      "reason": z.string().optional(),
    }).strict(),
    "dsound": z.object({
      "available": z.boolean(),
      "reason": z.string().optional(),
    }).strict(),
  }).strict(),
  "guest": z.union([z.null(), z.object({
    "audio": z.string(),
    "video": z.string(),
    "error": z.string().optional(),
  }).strict()]),
  "usb": usbViewSchema,
}).strict();

export const mediaActionVariant1_before_devicesVariant0Schema = z.object({
  "graphics": z.union([z.literal("none"), z.literal("virtio-gpu"), z.literal("virgl")]),
  "networkCard": z.union([z.literal("virtio-net-pci"), z.literal("e1000")]),
  "randomDevice": z.boolean(),
  "balloon": z.boolean(),
  "diskCache": z.union([z.literal("none"), z.literal("writeback"), z.literal("writethrough")]),
  "discard": z.boolean(),
  "graphicsOutputs": z.number().optional(),
  "graphicsWidth": z.number().optional(),
  "graphicsHeight": z.number().optional(),
  "graphicsMemoryMiB": z.number().optional(),
  "audio": z.union([z.literal("none"), z.literal("hda-duplex")]).optional(),
  "audioBackend": z.union([z.literal("none"), z.literal("dsound")]).optional(),
}).strict();

export const mediaActionVariant1_beforeSchema = z.object({
  "cpu": z.object({
    "sockets": z.number(),
    "cores": z.number(),
    "threads": z.number(),
    "numa": z.array(z.object({
      "memoryMiB": z.number(),
      "cpus": z.array(z.number()),
    }).strict()).optional(),
  }).strict().optional(),
  "devices": mediaActionVariant1_before_devicesVariant0Schema.optional(),
  "memory": z.object({
    "maxMiB": z.number(),
    "slots": z.number(),
  }).strict().optional(),
  "ipv6": z.union([z.literal(false), z.literal(true)]).optional(),
}).strict();

export const mediaActionVariant1Schema = z.object({
  "ready": z.boolean(),
  "reasons": z.array(z.string()),
  "vmId": z.string(),
  "vmName": z.string(),
  "mode": z.union([z.literal("host"), z.literal("off"), z.literal("virtual")]),
  "before": mediaActionVariant1_beforeSchema,
  "after": mediaActionVariant1_beforeSchema,
  "previewToken": z.string(),
  "memoryMiB": z.number(),
  "architecture": z.union([z.literal("x86_64"), z.literal("aarch64")]).optional(),
  "qemuAudioArguments": z.array(z.string()),
}).strict();

/** Wire DTO for the explicitly versioned MediaDevicesV1.action contract. */
export const mediaActionSchema = z.union([mediaViewSchema, mediaActionVariant1Schema]);

export const memoryViewSchema = z.object({
  "policy": z.object({
    "enabled": z.boolean(),
    "minMiB": z.number(),
  }).strict(),
  "effectiveMinMiB": z.number(),
  "currentTargetMiB": z.number(),
  "observation": z.union([z.null(), z.object({
    "at": z.string(),
    "totalMiB": z.number(),
    "availableMiB": z.number(),
    "targetMiB": z.number(),
    "decision": z.union([z.literal("restore"), z.literal("shrink"), z.literal("hold"), z.literal("disabled")]),
    "reason": z.string(),
    "error": z.string().optional(),
  }).strict()]),
}).strict();

/** Wire DTO for the explicitly versioned MemoryReclaimV1.action contract. */
export const memoryActionSchema = memoryViewSchema;

/** Wire DTO for the explicitly versioned HostMountsV1.view contract. */
export const hostMountViewSchema = z.object({
  "policy": z.object({
    "enabled": z.boolean(),
    "hostPath": z.string(),
    "readOnly": z.boolean(),
  }).strict(),
  "guestPath": z.string(),
  "running": z.boolean(),
  "mounted": z.boolean(),
  "observation": z.union([z.null(), z.object({
    "at": z.string(),
    "mounted": z.boolean(),
    "error": z.string().optional(),
  }).strict()]),
}).strict();

/** Wire DTO for the explicitly versioned HostMountsV1.action contract. */
export const hostMountActionSchema = z.object({
  "policy": z.object({
    "enabled": z.boolean(),
    "hostPath": z.string(),
    "readOnly": z.boolean(),
  }).strict(),
  "guestPath": z.string(),
  "running": z.boolean(),
  "mounted": z.boolean(),
  "observation": z.union([z.null(), z.object({
    "at": z.string(),
    "mounted": z.boolean(),
    "error": z.string().optional(),
  }).strict()]),
}).strict();

export const virtioFsViewSchema = z.object({
  "policy": z.object({
    "enabled": z.boolean(),
    "hostPath": z.string(),
    "readOnly": z.boolean(),
  }).strict(),
  "guestPath": z.string(),
  "tag": z.string(),
  "stopped": z.boolean(),
  "running": z.boolean(),
  "attached": z.boolean(),
  "mounted": z.boolean(),
  "observation": z.union([z.null(), z.object({
    "at": z.string(),
    "mounted": z.boolean(),
    "error": z.string().optional(),
  }).strict()]),
}).strict();

/** Wire DTO for the explicitly versioned VirtioFsSharesV1.action contract. */
export const virtioFsActionSchema = virtioFsViewSchema;

/** Wire DTO for the explicitly versioned TrustedBootServiceV1.view contract. */
export const trustedBootViewSchema = z.object({
  "policy": z.object({
    "enabled": z.boolean(),
  }).strict(),
  "stopped": z.boolean(),
  "attached": z.boolean(),
}).strict();

export const trustedBootActionVariant1Schema = z.object({
  "policy": z.object({
    "enabled": z.boolean(),
  }).strict(),
  "ready": z.boolean(),
  "executed": z.boolean(),
  "firmware": z.union([z.literal("bios"), z.literal("uefi")]),
  "host": z.object({
    "secureFirmware": z.boolean(),
    "varsTemplate": z.boolean(),
    "smm": z.boolean(),
    "tpmBackend": z.boolean(),
    "swtpm": z.boolean(),
    "rebootAction": z.boolean(),
  }).strict(),
  "guest": z.union([z.null(), z.object({
    "efi": z.boolean(),
    "secureBootEnabled": z.union([z.null(), z.literal(false), z.literal(true)]),
    "setupMode": z.union([z.null(), z.literal(false), z.literal(true)]),
    "tpmDevicePresent": z.boolean(),
  }).strict()]),
  "observed": z.boolean(),
  "reason": z.union([z.null(), z.string()]),
}).strict();

/** Wire DTO for the explicitly versioned TrustedBootServiceV1.action contract. */
export const trustedBootActionSchema = z.union([z.object({
  "policy": z.object({
    "enabled": z.boolean(),
  }).strict(),
  "stopped": z.boolean(),
  "attached": z.boolean(),
}).strict(), trustedBootActionVariant1Schema]);

export const gpuViewSchema = z.object({
  "profiles": z.array(z.object({
    "name": z.string(),
    "graphics": z.union([z.literal("virtio-gpu"), z.literal("virgl")]),
    "outputs": z.number(),
    "width": z.number(),
    "height": z.number(),
    "hostMemoryMiB": z.number(),
    "minVmMemoryMiB": z.number(),
    "id": z.string(),
    "revision": z.number(),
    "createdAt": z.string(),
    "updatedAt": z.string(),
  }).strict()),
  "support": z.object({
    "virtio-gpu": z.object({
      "available": z.boolean(),
      "reason": z.string().optional(),
    }).strict(),
    "virgl": z.object({
      "available": z.boolean(),
      "reason": z.string().optional(),
    }).strict(),
  }).strict(),
  "assignments": z.array(z.object({
    "vmName": z.union([z.null(), z.string()]),
    "drifted": z.boolean(),
    "vmId": z.string(),
    "profileId": z.string(),
    "profileName": z.string(),
    "profileRevision": z.number(),
    "hardwareHash": z.string(),
    "appliedAt": z.string(),
  }).strict()),
}).strict();

export const gpuActionVariant1Schema = z.object({
  "ready": z.boolean(),
  "reasons": z.array(z.string()),
  "vmId": z.string(),
  "vmName": z.string(),
  "profileId": z.string(),
  "profileRevision": z.number(),
  "previewToken": z.string(),
  "before": mediaActionVariant1_beforeSchema,
  "memoryMiB": z.number(),
  "architecture": z.union([z.literal("x86_64"), z.literal("aarch64")]).optional(),
  "after": mediaActionVariant1_beforeSchema,
  "qemuDeviceArguments": z.array(z.string()),
}).strict();

/** Wire DTO for the explicitly versioned GpuProfilesV1.action contract. */
export const gpuActionSchema = z.union([z.object({
  "name": z.string(),
  "graphics": z.union([z.literal("virtio-gpu"), z.literal("virgl")]),
  "outputs": z.number(),
  "width": z.number(),
  "height": z.number(),
  "hostMemoryMiB": z.number(),
  "minVmMemoryMiB": z.number(),
  "id": z.string(),
  "revision": z.number(),
  "createdAt": z.string(),
  "updatedAt": z.string(),
}).strict(), gpuActionVariant1Schema, z.object({
  "removed": z.string(),
}).strict(), z.object({
  "hardware": mediaActionVariant1_beforeSchema,
  "vmId": z.string(),
  "profileId": z.string(),
  "profileName": z.string(),
  "profileRevision": z.number(),
  "hardwareHash": z.string(),
  "appliedAt": z.string(),
}).strict()]);

export const buildFarm_tasks__Schema = z.object({
  "job": z.union([z.null(), jobViewSchema]),
  "name": z.string(),
  "command": z.string(),
  "labels": z.array(z.string()),
  "timeoutSeconds": z.number(),
  "id": z.string(),
  "status": z.union([z.literal("error"), z.literal("cancelled"), z.literal("interrupted"), z.literal("running"), z.literal("done"), z.literal("queued")]),
  "createdAt": z.string(),
  "cwd": z.string().optional(),
  "retryOf": z.string().optional(),
  "vmId": z.string().optional(),
  "jobId": z.string().optional(),
  "startedAt": z.string().optional(),
  "finishedAt": z.string().optional(),
  "error": z.string().optional(),
  "errorCode": z.string().optional(),
  "projectId": z.string().optional(),
  "directory": z.string().optional(),
  "projectDirectory": z.string().optional(),
  "configVersion": z.string().optional(),
  "networkIsolation": z.union([z.literal("host"), z.literal("private")]).optional(),
}).strict();

/** Wire DTO for the explicitly versioned BuildFarmV1.view contract. */
export const buildFarmSchema = z.object({
  "nodes": z.array(z.object({
    "vmName": z.union([z.null(), z.string()]),
    "status": z.string(),
    "busy": z.number(),
    "vmId": z.string(),
    "slots": z.number(),
    "labels": z.array(z.string()),
    "enabled": z.boolean(),
    "projectId": z.string().optional(),
  }).strict()),
  "tasks": z.array(buildFarm_tasks__Schema),
  "persistenceError": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned BuildFarmV1.projects contract. */
export const buildFarmProjectsSchema = z.object({
  "active": z.string(),
  "projects": z.array(z.object({
    "id": z.string(),
    "name": z.string(),
  }).strict()),
  "vmId": z.string(),
}).strict();

export const buildFarmActionVariant0Schema = z.object({
  "name": z.string(),
  "command": z.string(),
  "labels": z.array(z.string()),
  "timeoutSeconds": z.number(),
  "id": z.string(),
  "status": z.union([z.literal("error"), z.literal("cancelled"), z.literal("interrupted"), z.literal("running"), z.literal("done"), z.literal("queued")]),
  "createdAt": z.string(),
  "cwd": z.string().optional(),
  "retryOf": z.string().optional(),
  "vmId": z.string().optional(),
  "jobId": z.string().optional(),
  "startedAt": z.string().optional(),
  "finishedAt": z.string().optional(),
  "error": z.string().optional(),
  "errorCode": z.string().optional(),
  "projectId": z.string().optional(),
  "directory": z.string().optional(),
  "projectDirectory": z.string().optional(),
  "configVersion": z.string().optional(),
  "networkIsolation": z.union([z.literal("host"), z.literal("private")]).optional(),
}).strict();

/** Wire DTO for the explicitly versioned BuildFarmV1.action contract. */
export const buildFarmActionSchema = z.union([buildFarmActionVariant0Schema, z.object({
  "projectId": z.string(),
  "vmId": z.string(),
  "slots": z.number(),
  "labels": z.array(z.string()),
  "enabled": z.boolean(),
}).strict(), z.object({
  "removed": z.string(),
}).strict()]);

export const projectPermissionsSchema = z.object({
  "version": z.string(),
  "roles": z.array(z.object({
    "id": z.string(),
    "name": z.string(),
    "permissions": z.array(z.union([z.literal("write"), z.literal("read"), z.literal("execute"), z.literal("approve")])),
  }).strict()),
  "grants": z.array(z.object({
    "accountId": z.string(),
    "roleId": z.string(),
  }).strict()),
  "approvalRequired": z.boolean(),
  "vmId": z.string(),
  "projectId": z.string(),
}).strict();

export const projectPermissionsConfiguredSchema = z.object({
  "version": z.string(),
  "vmId": z.string(),
  "projectId": z.string(),
  "roles": z.array(z.object({
    "id": z.string(),
    "name": z.string(),
    "permissions": z.array(z.union([z.literal("write"), z.literal("read"), z.literal("execute"), z.literal("approve")])),
  }).strict()),
  "grants": z.array(z.object({
    "accountId": z.string(),
    "roleId": z.string(),
  }).strict()),
  "approvalRequired": z.boolean(),
  "revision": z.number(),
}).strict();

/** Wire DTO for the explicitly versioned PolicyBundlesV1.keys contract. */
export const policyKeysSchema = z.object({
  "revision": z.number(),
  "localKey": z.object({
    "name": z.string(),
    "fingerprint": z.string(),
    "publicKey": z.string(),
  }).strict(),
  "trustedKeys": z.array(z.object({
    "name": z.string(),
    "fingerprint": z.string(),
    "publicKey": z.string(),
  }).strict()),
}).strict();

/** Wire DTO for the explicitly versioned PolicyBundlesV1.action contract. */
export const policyKeyActionSchema = z.object({
  "revision": z.number(),
  "localKey": z.object({
    "name": z.string(),
    "fingerprint": z.string(),
    "publicKey": z.string(),
  }).strict(),
  "trustedKeys": z.array(z.object({
    "name": z.string(),
    "fingerprint": z.string(),
    "publicKey": z.string(),
  }).strict()),
}).strict();

export const policyExportSchema = z.object({
  "format": z.literal("sakura-project-policy/v1"),
  "source": z.object({
    "vmId": z.string(),
    "projectId": z.string(),
  }).strict(),
  "policy": z.object({
    "roles": z.array(z.object({
      "id": z.string(),
      "name": z.string(),
      "permissions": z.array(z.union([z.literal("write"), z.literal("read"), z.literal("execute"), z.literal("approve")])),
    }).strict()),
    "grants": z.array(z.object({
      "accountId": z.string(),
      "roleId": z.string(),
    }).strict()),
    "approvalRequired": z.boolean(),
  }).strict(),
  "signature": z.object({
    "algorithm": z.literal("Ed25519"),
    "publicKey": z.string(),
    "value": z.string(),
  }).strict(),
}).strict();

export const policyPreviewSchema = z.object({
  "source": z.object({
    "vmId": z.string(),
    "projectId": z.string(),
  }).strict(),
  "target": z.object({
    "vmId": z.string(),
    "projectId": z.string(),
  }).strict(),
  "signer": z.string(),
  "trusted": z.boolean(),
  "expectedVersion": z.string(),
  "current": z.object({
    "roles": z.array(z.object({
      "id": z.string(),
      "name": z.string(),
      "permissions": z.array(z.union([z.literal("write"), z.literal("read"), z.literal("execute"), z.literal("approve")])),
    }).strict()),
    "grants": z.array(z.object({
      "accountId": z.string(),
      "roleId": z.string(),
    }).strict()),
    "approvalRequired": z.boolean(),
  }).strict(),
  "proposed": z.object({
    "roles": z.array(z.object({
      "id": z.string(),
      "name": z.string(),
      "permissions": z.array(z.union([z.literal("write"), z.literal("read"), z.literal("execute"), z.literal("approve")])),
    }).strict()),
    "grants": z.array(z.object({
      "accountId": z.string(),
      "roleId": z.string(),
    }).strict()),
    "approvalRequired": z.boolean(),
  }).strict(),
}).strict();

/** Wire DTO for the explicitly versioned PolicyBundlesV1.apply contract. */
export const policyAppliedSchema = z.object({
  "signer": z.string(),
  "source": z.object({
    "vmId": z.string(),
    "projectId": z.string(),
  }).strict(),
  "policy": projectPermissionsConfiguredSchema,
}).strict();

export const changes___project_servicesVariant0__Schema = z.object({
  "name": z.string(),
  "command": z.string(),
  "dependsOn": z.array(z.string()),
  "ready": z.string(),
  "timeout": z.number(),
  "environment": z.record(z.string(), z.string()).optional(),
  "secrets": z.record(z.string(), z.string()).optional(),
  "health": z.object({
    "command": z.string(),
    "interval": z.number(),
    "timeout": z.number(),
    "failures": z.number(),
    "restart": z.boolean(),
    "maxRestarts": z.number(),
    "backoff": z.number(),
  }).strict().optional(),
}).strict();

export const changes___projectSchema = z.object({
  "directory": z.string(),
  "template": z.union([z.literal("none"), z.literal("node"), z.literal("python"), z.literal("rust")]),
  "repository": z.string(),
  "setup": z.string(),
  "command": z.string(),
  "previewPort": z.number().optional(),
  "networkIsolation": z.union([z.literal("host"), z.literal("private")]).optional(),
  "environment": z.record(z.string(), z.string()).optional(),
  "secrets": z.record(z.string(), z.string()).optional(),
  "runtimes": z.object({
    "python": z.string().optional(),
    "node": z.string().optional(),
  }).strict().optional(),
  "services": z.array(changes___project_servicesVariant0__Schema).optional(),
}).strict();

export const changes__Schema = z.object({
  "status": z.union([z.literal("failed"), z.literal("expired"), z.literal("pending"), z.literal("approved"), z.literal("denied"), z.literal("claimed"), z.literal("applied")]),
  "id": z.string(),
  "vmId": z.string(),
  "projectId": z.string(),
  "requesterId": z.string(),
  "summary": z.string(),
  "project": changes___projectSchema,
  "expectedVersion": z.string(),
  "createdAt": z.number(),
  "expiresAt": z.number(),
  "approvedBy": z.string().optional(),
  "decidedAt": z.number().optional(),
  "claimedAt": z.number().optional(),
  "finishedAt": z.number().optional(),
  "error": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned ChangeApprovalsV1.list contract. */
export const changesSchema = z.array(changes__Schema);

/** Wire DTO for the explicitly versioned ChangeApprovalsV1.create contract. */
export const changeCreateSchema = changes__Schema;

/** Wire DTO for the explicitly versioned ChangeApprovalsV1.decide contract. */
export const changeDecisionSchema = changes__Schema;

/** Wire DTO for the explicitly versioned ChangeApprovalsV1.apply contract. */
export const changeAppliedSchema = changes__Schema;

/** Wire DTO for the explicitly versioned ProcessInteropV1.guest contract. */
export const guestInteropSchema = z.object({
  "exitCode": z.number(),
  "stdout": z.string(),
  "stderr": z.string(),
  "programId": z.string(),
}).strict();

export const hostPeers_outbound___observationVariant1Schema = z.object({
  "status": z.object({
    "version": z.literal(1),
    "id": z.string(),
    "name": z.string(),
    "platform": z.string(),
    "arch": z.string(),
    "cpus": z.number(),
    "memoryTotal": z.number(),
    "memoryFree": z.number(),
    "load": z.array(z.number()),
    "vmCount": z.number(),
    "runningVms": z.number(),
    "checkedAt": z.string(),
  }).strict().optional(),
  "error": z.string().optional(),
  "checkedAt": z.number(),
  "lastSuccessAt": z.number().optional(),
}).strict();

export const hostPeersSchema = z.object({
  "hostId": z.string(),
  "name": z.string(),
  "fingerprint": z.string(),
  "listener": z.object({
    "error": z.string().optional(),
    "active": z.boolean(),
    "enabled": z.boolean(),
    "host": z.union([z.literal("127.0.0.1"), z.literal("0.0.0.0")]),
    "port": z.number(),
  }).strict(),
  "pairing": z.union([z.null(), z.object({
    "value": z.string(),
    "expiresAt": z.number(),
  }).strict()]),
  "incoming": z.array(z.object({
    "id": z.string(),
    "requesterId": z.string(),
    "name": z.string(),
    "createdAt": z.number(),
    "allowImport": z.boolean(),
    "allowPolicy": z.boolean(),
    "allowActivate": z.boolean(),
    "allowFailover": z.boolean(),
  }).strict()),
  "outbound": z.array(z.object({
    "observation": z.union([z.null(), hostPeers_outbound___observationVariant1Schema]),
    "id": z.string(),
    "remoteId": z.string(),
    "name": z.string(),
    "url": z.string(),
    "fingerprint": z.string(),
    "createdAt": z.number(),
  }).strict()),
}).strict();

/** Wire DTO for the explicitly versioned HostPeersV1.status contract. */
export const hostStatusSchema = z.object({
  "version": z.literal(1),
  "id": z.string(),
  "name": z.string(),
  "platform": z.string(),
  "arch": z.string(),
  "cpus": z.number(),
  "memoryTotal": z.number(),
  "memoryFree": z.number(),
  "load": z.array(z.number()),
  "vmCount": z.number(),
  "runningVms": z.number(),
  "checkedAt": z.string(),
}).strict();

export const hostPeersConfiguredVariant0_candidates__Schema = z.object({
  "id": z.string(),
  "name": z.string(),
  "source": z.union([z.literal("local"), z.literal("peer")]),
  "eligible": z.boolean(),
  "score": z.union([z.null(), z.number()]),
  "components": z.object({
    "memory": z.number(),
    "cpuLoad": z.number(),
    "instanceDensity": z.number(),
  }).strict(),
  "reasons": z.array(z.string()),
  "status": z.union([z.null(), z.object({
    "version": z.literal(1),
    "id": z.string(),
    "name": z.string(),
    "platform": z.string(),
    "arch": z.string(),
    "cpus": z.number(),
    "memoryTotal": z.number(),
    "memoryFree": z.number(),
    "load": z.array(z.number()),
    "vmCount": z.number(),
    "runningVms": z.number(),
    "checkedAt": z.string(),
  }).strict()]),
  "observedAt": z.union([z.null(), z.number()]),
}).strict();

/** Wire DTO for the explicitly versioned HostPeersV1.configure contract. */
export const hostPeersConfiguredSchema = z.union([z.object({
  "requirements": z.object({
    "cpus": z.number(),
    "memoryMiB": z.number(),
  }).strict(),
  "scoredAt": z.string(),
  "candidates": z.array(hostPeersConfiguredVariant0_candidates__Schema),
}).strict(), hostPeersSchema]);

export const mobileView_devices__Schema = z.object({
  "expired": z.boolean(),
  "connected": z.boolean(),
  "id": z.string(),
  "name": z.string(),
  "ownerId": z.string(),
  "policy": z.object({
    "enabled": z.boolean(),
    "vmIds": z.array(z.string()),
    "kinds": z.array(z.union([z.literal("cpu"), z.literal("memory"), z.literal("secret"), z.literal("backup"), z.literal("disk"), z.literal("service"), z.literal("task")])),
  }).strict(),
  "createdAt": z.number(),
  "expiresAt": z.number(),
  "lastSeenAt": z.number().optional(),
}).strict();

/** Wire DTO for the explicitly versioned MobileCompanionV1.view contract. */
export const mobileViewSchema = z.object({
  "devices": z.array(mobileView_devices__Schema),
}).strict();

/** Wire DTO for the explicitly versioned MobileCompanionV1.action contract. */
export const mobileActionSchema = z.union([z.object({
  "devices": z.array(mobileView_devices__Schema),
}).strict(), z.object({
  "code": z.string(),
  "expiresAt": z.number(),
}).strict()]);

export const fleetView_batches__Schema = z.object({
  "id": z.string(),
  "revision": z.number(),
  "policy": z.object({
    "pluginId": z.string(),
    "enabled": z.boolean(),
    "percentage": z.number(),
    "cohortVersion": z.string(),
  }).strict(),
  "targets": z.array(z.object({
    "peerId": z.string(),
    "hostId": z.string(),
    "name": z.string(),
    "beforeRevision": z.number(),
    "state": z.union([z.literal("failed"), z.literal("pending"), z.literal("applied")]),
    "error": z.string().optional(),
    "appliedAt": z.string().optional(),
  }).strict()),
  "createdAt": z.string(),
  "updatedAt": z.string(),
}).strict();

/** Wire DTO for the explicitly versioned FleetPolicyRolloutsV1.view contract. */
export const fleetViewSchema = z.object({
  "batches": z.array(fleetView_batches__Schema),
}).strict();

/** Wire DTO for the explicitly versioned FleetPolicyRolloutsV1.configure contract. */
export const fleetConfiguredSchema = fleetView_batches__Schema;

export const coldMigrationsSchema = z.object({
  "enabled": z.boolean(),
  "entries": z.array(z.object({
    "vmId": z.string(),
    "transferId": z.string(),
    "peerId": z.string(),
    "targetName": z.string(),
    "status": z.union([z.literal("queued"), z.literal("review"), z.literal("transferring"), z.literal("copied"), z.literal("moved")]),
    "createdAt": z.string(),
    "updatedAt": z.string(),
    "remoteVmId": z.string().optional(),
    "error": z.string().optional(),
  }).strict()),
}).strict();

export const snapshotReplications_entries__Schema = z.object({
  "vmId": z.string(),
  "snapshotId": z.string(),
  "peerId": z.string(),
  "transferId": z.string(),
  "targetName": z.string(),
  "sourceFingerprint": z.string(),
  "status": z.union([z.literal("queued"), z.literal("review"), z.literal("transferring"), z.literal("replicated")]),
  "createdAt": z.string(),
  "updatedAt": z.string(),
  "remoteVmId": z.string().optional(),
  "sha256": z.string().optional(),
  "sourceSha256": z.string().optional(),
  "error": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned SnapshotReplicationsV1.view contract. */
export const snapshotReplicationsSchema = z.object({
  "enabled": z.boolean(),
  "entries": z.array(snapshotReplications_entries__Schema),
}).strict();

export const nativeViewSchema = z.object({
  "supported": z.boolean(),
  "version": z.number(),
  "settings": z.object({
    "contextMenu": z.boolean(),
    "editor": z.union([z.literal("notepad"), z.literal("vscode")]),
    "associations": z.array(z.object({
      "extension": z.string(),
      "vmId": z.string(),
      "projectId": z.string(),
    }).strict()),
  }).strict(),
  "pending": z.boolean(),
  "mappings": z.array(z.object({
    "vmId": z.string(),
    "projectId": z.string(),
    "name": z.string(),
    "host": z.string(),
    "guest": z.string(),
  }).strict()),
}).strict();

/** Wire DTO for the explicitly versioned NativeIntegrationV1.action contract. */
export const nativeActionSchema = z.union([nativeViewSchema, z.object({
  "vmId": z.string(),
  "projectId": z.string(),
  "path": z.string(),
  "directory": z.boolean(),
}).strict(), z.object({
  "ticket": z.string(),
  "url": z.string(),
}).strict(), z.object({
  "opened": z.boolean(),
  "target": z.union([z.literal("editor"), z.literal("explorer")]),
  "path": z.string(),
}).strict()]);

export const clipboardView_processes__Schema = z.object({
  "pid": z.number(),
  "created": z.string(),
  "image": z.string(),
  "bits": z.union([z.literal(0), z.literal(32), z.literal(64)]),
  "inheritance": z.object({
    "application": z.object({
      "image": z.string(),
      "sha256": z.string(),
    }).strict(),
    "parent": z.object({
      "pid": z.number(),
      "created": z.string(),
    }).strict(),
  }).strict().optional(),
  "state": z.union([z.literal("error"), z.literal("disabled"), z.literal("enforced")]),
  "error": z.string().optional(),
  "blockedCopy": z.number(),
  "blockedPaste": z.number(),
}).strict();

export const clipboardViewSchema = z.object({
  "version": z.number(),
  "supported": z.boolean(),
  "ready": z.boolean(),
  "settings": z.object({
    "enabled": z.boolean(),
    "applications": z.array(z.object({
      "image": z.string(),
      "sha256": z.string(),
      "rule": z.object({
        "copy": z.boolean(),
        "paste": z.boolean(),
        "files": z.boolean(),
        "sensitive": z.boolean(),
        "maxTextBytes": z.number(),
      }).strict(),
    }).strict()),
  }).strict(),
  "available": z.array(z.object({
    "pid": z.number(),
    "created": z.string(),
    "image": z.string(),
    "bits": z.union([z.literal(0), z.literal(32), z.literal(64)]),
  }).strict()),
  "processes": z.array(clipboardView_processes__Schema),
  "lastScan": z.string().optional(),
  "error": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned NativeClipboardV1.action contract. */
export const clipboardActionSchema = z.union([clipboardViewSchema, z.object({
  "process": z.object({
    "pid": z.number(),
    "created": z.string(),
    "image": z.string(),
    "bits": z.union([z.literal(0), z.literal(32), z.literal(64)]),
  }).strict(),
  "view": clipboardViewSchema,
}).strict(), z.object({
  "image": z.string(),
  "sha256": z.string(),
}).strict()]);

/** Wire DTO for the explicitly versioned LocalAssistantV1.view contract. */
export const assistantViewSchema = z.object({
  "version": z.number(),
  "settings": z.object({
    "enabled": z.boolean(),
    "endpoint": z.string(),
    "model": z.string(),
    "timeoutSeconds": z.number(),
    "maxTokens": z.number(),
  }).strict(),
  "busy": z.boolean(),
}).strict();

/** Wire DTO for the explicitly versioned LocalAssistantV1.preview contract. */
export const assistantPreviewSchema = z.object({
  "id": z.string(),
  "mode": z.union([z.literal("ask"), z.literal("explain"), z.literal("tests"), z.literal("fix"), z.literal("plan")]),
  "content": z.string(),
  "redactions": z.number(),
  "expiresAt": z.number(),
  "model": z.string(),
  "endpoint": z.string(),
}).strict();

/** Wire DTO for the explicitly versioned LocalAssistantV1.models contract. */
export const assistantModelsSchema = z.object({
  "models": z.array(z.object({
    "name": z.string(),
    "size": z.number(),
  }).strict()),
}).strict();

export const assistantGeneratedSchema = z.object({
  "mode": z.union([z.literal("ask"), z.literal("explain"), z.literal("tests"), z.literal("fix"), z.literal("plan")]),
  "model": z.string(),
  "content": z.string(),
  "plan": z.object({
    "goal": z.string(),
    "assumptions": z.array(z.string()),
    "steps": z.array(z.object({
      "purpose": z.string(),
      "command": z.string(),
      "risk": z.union([z.literal("read"), z.literal("change"), z.literal("destructive")]),
      "verify": z.string(),
    }).strict()),
  }).strict().optional(),
  "generatedAt": z.string(),
  "truncated": z.boolean(),
}).strict();

export const communityView_installed___extensionsVariant0Schema = z.object({
  "routes": z.array(z.object({
    "id": z.string(),
    "name": z.string(),
  }).strict()),
  "panels": z.array(z.object({
    "id": z.string(),
    "title": z.string(),
    "description": z.string(),
    "routeId": z.string(),
    "fields": z.array(z.object({
      "key": z.string(),
      "label": z.string(),
      "type": z.union([z.literal("number"), z.literal("boolean"), z.literal("text")]),
      "required": z.boolean(),
    }).strict()),
  }).strict()),
}).strict();

export const communityView_installed__Schema = z.object({
  "name": z.string(),
  "id": z.string(),
  "sha256": z.string(),
  "version": z.string(),
  "schemaVersion": z.literal(1),
  "signature": z.string(),
  "description": z.string(),
  "publisher": z.string(),
  "sourceId": z.string(),
  "installedAt": z.number(),
  "extensions": communityView_installed___extensionsVariant0Schema.optional(),
  "phase": z.union([z.literal("running"), z.literal("cleanup-pending"), z.literal("draining")]).optional(),
  "generation": z.string().optional(),
}).strict();

export const communityView_deliveries___eventVariant0Schema = z.object({
  "id": z.string(),
  "type": z.union([z.literal("job.finished"), z.literal("alert.raised"), z.literal("test")]),
  "occurredAt": z.string(),
  "tags": z.array(z.string()),
  "vmId": z.string().optional(),
  "projectId": z.string().optional(),
  "jobId": z.string().optional(),
  "scope": z.string().optional(),
  "status": z.union([z.literal("error"), z.literal("cancelled"), z.literal("interrupted"), z.literal("done")]).optional(),
  "kind": z.union([z.literal("cpu"), z.literal("memory"), z.literal("secret"), z.literal("backup"), z.literal("disk"), z.literal("service"), z.literal("task")]).optional(),
}).strict();

export const communityView_deliveries__Schema = z.object({
  "id": z.string(),
  "pluginId": z.string(),
  "event": z.union([communityView_deliveries___eventVariant0Schema, z.object({
    "id": z.string(),
    "type": z.literal("plugin.timer"),
    "occurredAt": z.string(),
    "tags": z.tuple([]),
  }).strict()]),
  "status": z.union([z.literal("failed"), z.literal("done"), z.literal("pending")]),
  "processedAt": z.number().optional(),
  "error": z.string().optional(),
  "resultPreview": z.string().optional(),
}).strict();

export const communityView_runtime_instances__Schema = z.object({
  "identity": z.string(),
  "source": z.union([z.literal("official"), z.literal("community"), z.literal("system")]),
  "pluginId": z.string(),
  "version": z.string(),
  "artifactDigest": z.string(),
  "generation": z.string(),
  "permissions": z.array(z.string()),
  "desired": z.boolean(),
  "phase": z.union([z.literal("failed"), z.literal("running"), z.literal("cleanup-pending"), z.literal("draining"), z.literal("activating"), z.literal("inactive"), z.literal("skipped")]),
  "activationMs": z.number(),
  "error": z.string().optional(),
  "resourceId": z.string().optional(),
  "contributions": z.array(z.object({
    "kind": z.union([z.literal("http"), z.literal("operation"), z.literal("socket"), z.literal("page"), z.literal("tab"), z.literal("developmentSection"), z.literal("job-retry"), z.literal("jobs"), z.literal("schedule"), z.literal("event"), z.literal("interceptor"), z.literal("panel")]),
    "id": z.string(),
    "target": z.string(),
  }).strict()).optional(),
}).strict();

export const communityViewSchema = z.object({
  "publishers": z.array(z.object({
    "fingerprint": z.string(),
    "name": z.string(),
    "addedAt": z.number(),
  }).strict()),
  "sources": z.array(z.object({
    "id": z.string(),
    "name": z.string(),
    "url": z.string(),
    "addedAt": z.number(),
  }).strict()),
  "installed": z.array(communityView_installed__Schema),
  "catalogs": z.record(z.string(), z.array(z.object({
    "schemaVersion": z.literal(1),
    "id": z.string(),
    "name": z.string(),
    "description": z.string(),
    "version": z.string(),
    "sha256": z.string(),
    "publisher": z.string(),
    "signature": z.string(),
    "wasmUrl": z.string(),
    "extensions": communityView_installed___extensionsVariant0Schema.optional(),
  }).strict())),
  "problems": z.record(z.string(), z.string()),
  "subscriptions": z.array(z.object({
    "pluginId": z.string(),
    "types": z.array(z.union([z.literal("job.finished"), z.literal("alert.raised")])),
    "enabled": z.boolean(),
    "activeSince": z.number(),
    "updatedAt": z.number(),
  }).strict()),
  "schedules": z.array(z.object({
    "pluginId": z.string(),
    "intervalMinutes": z.number(),
    "enabled": z.boolean(),
    "nextRunAt": z.number(),
    "updatedAt": z.number(),
  }).strict()),
  "deliveries": z.array(communityView_deliveries__Schema),
  "eventError": z.string().optional(),
  "runtime": z.object({
    "version": z.number(),
    "instances": z.array(communityView_runtime_instances__Schema),
  }).strict(),
}).strict();

export const webhookView_subscriptions__Schema = z.object({
  "types": z.array(z.union([z.literal("job.finished"), z.literal("alert.raised")])),
  "vmIds": z.array(z.string()),
  "projectIds": z.array(z.string()),
  "tags": z.array(z.string()),
  "statuses": z.array(z.union([z.literal("error"), z.literal("cancelled"), z.literal("interrupted"), z.literal("done")])),
  "kinds": z.array(z.union([z.literal("cpu"), z.literal("memory"), z.literal("secret"), z.literal("backup"), z.literal("disk"), z.literal("service"), z.literal("task")])),
  "id": z.string(),
  "name": z.string(),
  "url": z.string(),
  "enabled": z.boolean(),
  "version": z.number(),
  "createdAt": z.number(),
  "hasSecret": z.boolean(),
}).strict();

export const webhookView_deliveries___eventSchema = z.object({
  "id": z.string(),
  "type": z.union([z.literal("job.finished"), z.literal("alert.raised"), z.literal("test")]),
  "occurredAt": z.string(),
  "vmId": z.string().optional(),
  "projectId": z.string().optional(),
  "jobId": z.string().optional(),
  "scope": z.string().optional(),
  "status": z.union([z.literal("error"), z.literal("cancelled"), z.literal("interrupted"), z.literal("done")]).optional(),
  "kind": z.union([z.literal("cpu"), z.literal("memory"), z.literal("secret"), z.literal("backup"), z.literal("disk"), z.literal("service"), z.literal("task")]).optional(),
  "tags": z.array(z.string()),
}).strict();

export const webhookView_deliveries__Schema = z.object({
  "id": z.string(),
  "subscriptionId": z.string(),
  "version": z.number(),
  "event": webhookView_deliveries___eventSchema,
  "status": z.union([z.literal("failed"), z.literal("cancelled"), z.literal("pending"), z.literal("sending"), z.literal("delivered")]),
  "attempts": z.number(),
  "nextAttemptAt": z.number(),
  "updatedAt": z.number(),
  "httpStatus": z.number().optional(),
  "error": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned WebhooksV1.view contract. */
export const webhookViewSchema = z.object({
  "subscriptions": z.array(webhookView_subscriptions__Schema),
  "deliveries": z.array(webhookView_deliveries__Schema),
  "error": z.string().optional(),
  "collecting": z.boolean(),
  "limits": z.object({
    "subscriptions": z.number(),
    "pending": z.number(),
    "history": z.number(),
    "attempts": z.number(),
    "sourceHours": z.number(),
  }).strict(),
}).strict();

export const webhookConfiguredSchema = z.object({
  "secret": z.string().optional(),
  "subscriptions": z.array(webhookView_subscriptions__Schema),
  "deliveries": z.array(webhookView_deliveries__Schema),
  "error": z.string().optional(),
  "collecting": z.boolean(),
  "limits": z.object({
    "subscriptions": z.number(),
    "pending": z.number(),
    "history": z.number(),
    "attempts": z.number(),
    "sourceHours": z.number(),
  }).strict(),
}).strict();

export const automationView_rules___filterSchema = z.object({
  "types": z.array(z.union([z.literal("job.finished"), z.literal("alert.raised")])),
  "vmIds": z.array(z.string()),
  "projectIds": z.array(z.string()),
  "tags": z.array(z.string()),
  "statuses": z.array(z.union([z.literal("error"), z.literal("cancelled"), z.literal("interrupted"), z.literal("done")])),
  "kinds": z.array(z.union([z.literal("cpu"), z.literal("memory"), z.literal("secret"), z.literal("backup"), z.literal("disk"), z.literal("service"), z.literal("task")])),
}).strict();

export const automationView_rules__Schema = z.object({
  "name": z.string(),
  "enabled": z.boolean(),
  "previewOnly": z.boolean(),
  "filter": automationView_rules___filterSchema,
  "action": z.union([z.literal("start"), z.literal("stop"), z.literal("suspend"), z.literal("resume"), z.literal("runbook")]),
  "steps": z.array(z.object({
    "name": z.string(),
    "command": z.string(),
    "timeout": z.number(),
  }).strict()),
  "cooldownSeconds": z.number(),
  "id": z.string(),
  "version": z.number(),
  "createdAt": z.number(),
  "activeSince": z.number(),
  "updatedAt": z.number(),
}).strict();

export const automationView_executions__Schema = z.object({
  "id": z.string(),
  "ruleId": z.string(),
  "ruleVersion": z.number(),
  "eventId": z.string(),
  "action": z.union([z.literal("start"), z.literal("stop"), z.literal("suspend"), z.literal("resume"), z.literal("runbook")]),
  "status": z.union([z.literal("failed"), z.literal("done"), z.literal("pending"), z.literal("skipped"), z.literal("preview")]),
  "startedAt": z.number(),
  "vmId": z.string().optional(),
  "finishedAt": z.number().optional(),
  "reason": z.string().optional(),
  "steps": z.array(z.object({
    "name": z.string(),
    "code": z.number(),
  }).strict()).optional(),
}).strict();

/** Wire DTO for the explicitly versioned AutomationRulesV1.view contract. */
export const automationViewSchema = z.object({
  "rules": z.array(automationView_rules__Schema),
  "executions": z.array(automationView_executions__Schema),
  "error": z.string().optional(),
  "collecting": z.boolean(),
  "limits": z.object({
    "rules": z.number(),
    "history": z.number(),
    "observed": z.number(),
    "dailyActions": z.number(),
  }).strict(),
}).strict();

export const automationConfiguredVariant1Schema = z.object({
  "matches": z.array(z.object({
    "event": webhookView_deliveries___eventSchema,
    "targetVmId": z.union([z.null(), z.string()]),
    "action": z.union([z.literal("start"), z.literal("stop"), z.literal("suspend"), z.literal("resume"), z.literal("runbook")]),
    "wouldExecute": z.boolean(),
  }).strict()),
  "approval": z.string().optional(),
  "rule": automationView_rules__Schema,
}).strict();

/** Wire DTO for the explicitly versioned AutomationRulesV1.configure contract. */
export const automationConfiguredSchema = z.union([z.object({
  "rules": z.array(automationView_rules__Schema),
  "executions": z.array(automationView_executions__Schema),
  "error": z.string().optional(),
  "collecting": z.boolean(),
  "limits": z.object({
    "rules": z.number(),
    "history": z.number(),
    "observed": z.number(),
    "dailyActions": z.number(),
  }).strict(),
}).strict(), automationConfiguredVariant1Schema]);

export const retentionViewSchema = z.object({
  "policy": z.object({
    "enabled": z.boolean(),
    "days": z.number(),
    "maxMiB": z.number(),
  }).strict(),
  "summary": z.object({
    "stores": z.number(),
    "completedLogs": z.number(),
    "completedBytes": z.number(),
    "protectedLogs": z.number(),
    "protectedBytes": z.number(),
    "removeLogs": z.number(),
    "removeBytes": z.number(),
    "expiredLogs": z.number(),
    "capacityLogs": z.number(),
    "remainingBytes": z.number(),
  }).strict(),
  "lastRun": z.object({
    "at": z.string(),
    "removedLogs": z.number(),
    "removedBytes": z.number(),
  }).strict().optional(),
  "warning": z.string().optional(),
}).strict();

/** Wire DTO for the explicitly versioned LogRetentionV1.preview contract. */
export const retentionPreviewSchema = z.object({
  "token": z.string(),
  "stores": z.number(),
  "completedLogs": z.number(),
  "completedBytes": z.number(),
  "protectedLogs": z.number(),
  "protectedBytes": z.number(),
  "removeLogs": z.number(),
  "removeBytes": z.number(),
  "expiredLogs": z.number(),
  "capacityLogs": z.number(),
  "remainingBytes": z.number(),
}).strict();

/** Wire DTO for the explicitly versioned JobsV1.list contract. */
export const jobsSchema = z.array(jobViewSchema);

/** Wire DTO for the explicitly versioned JobsV1.start contract. */
export const jobSchema = jobViewSchema;

export const vmViewSchema = z.object({
  "name": z.string(),
  "memoryMiB": z.number(),
  "cpus": z.number(),
  "diskGiB": z.number(),
  "accelerator": z.union([z.literal("auto"), z.literal("tcg"), z.literal("whpx")]),
  "forwards": z.array(z.object({
    "host": z.number(),
    "guest": z.number(),
    "name": z.string().optional(),
  }).strict()),
  "storagePoolId": z.string().optional(),
  "firmware": z.union([z.literal("bios"), z.literal("uefi")]).optional(),
  "distro": z.union([z.literal("alpine"), z.literal("debian"), z.literal("ubuntu")]).optional(),
  "architecture": z.union([z.literal("x86_64"), z.literal("aarch64")]).optional(),
  "template": z.union([z.literal("none"), z.literal("node"), z.literal("python"), z.literal("rust")]).optional(),
  "hardware": mediaActionVariant1_beforeSchema.optional(),
  "id": z.string(),
  "diskEncryption": z.object({
    "format": z.literal("luks"),
    "secretName": z.string(),
  }).strict().optional(),
  "sandbox": z.object({
    "network": z.union([z.literal("isolated"), z.literal("nat")]),
    "expiresAt": z.string(),
    "onExpire": z.union([z.literal("stop"), z.literal("delete")]),
    "storage": z.union([z.literal("persistent"), z.literal("discard-on-stop")]).optional(),
  }).strict().optional(),
  "rescueOf": z.string().optional(),
  "createdAt": z.string(),
  "snapshots": z.array(z.object({
    "id": z.string(),
    "name": z.string(),
    "createdAt": z.string(),
    "note": z.string().optional(),
    "diskGiB": z.number().optional(),
    "pendingResize": z.union([z.literal(false), z.literal(true)]).optional(),
    "consistency": z.union([z.literal("offline"), z.literal("filesystem"), z.literal("vmstate")]).optional(),
    "stateFingerprint": z.string().optional(),
  }).strict()),
  "bootstrapped": z.union([z.literal(false), z.literal(true)]).optional(),
  "lastUsedAt": z.string().optional(),
  "lastError": z.string().optional(),
  "organization": z.object({
    "group": z.string(),
    "tags": z.array(z.string()),
    "favorite": z.boolean(),
  }).strict().optional(),
  "pendingResize": z.union([z.literal(false), z.literal(true)]).optional(),
  "migrationOrigin": z.object({
    "sourceHostId": z.string(),
    "transferId": z.string(),
    "targetName": z.string(),
    "sourceVmId": z.string().optional(),
    "snapshotId": z.string().optional(),
    "diskSha256": z.string().optional(),
  }).strict().optional(),
  "haPromotion": haPromotionSchema.optional(),
  "haRetirement": haRetirementSchema.optional(),
  "haWitnessEnrollment": haWitnessEnrollmentSchema.optional(),
  "liveMigrationFence": liveMigrationFenceSchema.optional(),
  "liveMigrationOrigin": liveMigrationOriginSchema.optional(),
  "branchOrigin": z.object({
    "sourceVmId": z.string(),
    "snapshotId": z.string(),
    "createdAt": z.string(),
  }).strict().optional(),
  "mergeOrigin": z.object({
    "branchVmId": z.string(),
    "targetVmId": z.string(),
    "snapshotId": z.string(),
    "path": z.string(),
    "mergedAt": z.string(),
    "appliedFiles": z.number(),
  }).strict().optional(),
  "activeAccelerator": z.union([z.literal("tcg"), z.literal("whpx")]).optional(),
  "memoryTargetMiB": z.number().optional(),
  "status": z.union([z.literal("error"), z.literal("running"), z.literal("stopped"), z.literal("starting"), z.literal("paused"), z.literal("stopping")]),
  "poweredOn": z.boolean(),
  "startedAt": z.string().optional(),
  "diskBytes": z.number(),
}).strict();

export const pluginStatus_plugins___contributes_routes___policySchema = z.object({
  "access": z.union([z.literal("socket"), z.literal("guest"), z.literal("controller"), z.literal("public"), z.literal("download-ticket"), z.literal("extension")]),
  "roles": z.array(z.union([z.literal("member"), z.literal("owner"), z.literal("viewer")])),
  "projectScoped": z.boolean(),
  "identity": z.union([z.literal("host"), z.literal("lifecycle"), z.literal("fixed-vm")]),
  "maintenance": z.union([z.literal("allow"), z.literal("block")]),
  "transport": z.union([z.literal("json"), z.literal("binary"), z.literal("form"), z.literal("websocket")]),
  "mutating": z.boolean(),
  "session": z.union([z.literal("required"), z.literal("allow-locked")]),
  "vmLock": z.union([z.literal("allow-locked"), z.literal("require-unlocked")]),
  "projectBinding": z.union([z.literal("none"), z.literal("query"), z.literal("input-scope"), z.literal("legacy-terminal-grant")]),
  "approval": z.union([z.literal("none"), z.literal("project-change")]),
  "extensionAuth": z.union([z.literal("none"), z.literal("account"), z.literal("paired"), z.literal("preflight")]),
  "projectPermission": z.union([z.literal("write"), z.literal("read"), z.literal("execute"), z.literal("approve")]).optional(),
  "socketChannel": z.union([z.literal("events"), z.literal("terminal"), z.literal("terminal-view"), z.literal("logs"), z.literal("desktop"), z.literal("desktop-view")]).optional(),
  "executionOwner": z.string().optional(),
  "sessionOwner": z.string().optional(),
}).strict();

export const pluginStatus_plugins___contributesSchema = z.object({
  "http": z.array(z.object({
    "path": z.string(),
    "methods": z.array(z.union([z.literal("GET"), z.literal("POST"), z.literal("PUT"), z.literal("PATCH"), z.literal("DELETE")])),
    "projectScoped": z.boolean(),
  }).strict()),
  "routes": z.array(z.object({
    "id": z.string(),
    "path": z.string(),
    "method": z.union([z.literal("GET"), z.literal("POST"), z.literal("PUT"), z.literal("PATCH"), z.literal("DELETE")]),
    "policy": pluginStatus_plugins___contributes_routes___policySchema,
    "handler": z.union([z.literal("operation"), z.literal("route")]),
    "status": z.number(),
  }).strict()),
  "operations": z.array(z.object({
    "id": z.string(),
    "path": z.string(),
    "method": z.union([z.literal("GET"), z.literal("POST"), z.literal("PUT"), z.literal("PATCH"), z.literal("DELETE")]),
    "status": z.number(),
  }).strict()),
  "sockets": z.array(z.union([z.literal("desktop"), z.literal("terminal-session")])),
  "pages": z.array(z.string()),
  "tabs": z.array(z.string()),
  "developmentSections": z.array(z.string()),
  "managed": z.array(z.union([z.literal("job-retry"), z.literal("jobs"), z.literal("schedule"), z.literal("event"), z.literal("interceptor")])),
}).strict();

export const pluginStatus_plugins__Schema = z.object({
  "schemaVersion": z.literal(1),
  "kind": z.literal("plugin"),
  "id": z.string(),
  "name": z.string(),
  "description": z.string(),
  "version": z.string(),
  "apiVersion": z.number(),
  "category": z.union([z.literal("foundation"), z.literal("workspace"), z.literal("development"), z.literal("operations"), z.literal("experimental")]),
  "experimental": z.boolean(),
  "requires": z.array(z.object({
    "id": z.string(),
    "version": z.string(),
  }).strict()),
  "optional": z.array(z.object({
    "id": z.string(),
    "version": z.string(),
  }).strict()),
  "services": z.array(z.string()),
  "systemDependencies": z.array(z.string()),
  "lifecycle": z.object({
    "activateMs": z.number(),
    "closeMs": z.number(),
  }).strict(),
  "contributes": pluginStatus_plugins___contributesSchema,
}).strict();

export const pluginStatusSchema = z.object({
  "selection": z.object({
    "schemaVersion": z.literal(3),
    "plugins": z.array(z.string()),
    "packs": z.array(z.string()),
  }).strict(),
  "active": z.array(z.string()),
  "planned": z.array(z.string()),
  "reasons": z.record(z.string(), z.array(z.object({
    "kind": z.union([z.literal("plugin"), z.literal("pack")]),
    "id": z.string(),
  }).strict())),
  "migrations": z.array(z.string()),
  "restartRequired": z.boolean(),
  "errors": z.record(z.string(), z.string()),
  "lifecycle": z.record(z.string(), z.object({
    "phase": z.union([z.literal("failed"), z.literal("skipped"), z.literal("active")]),
    "activationMs": z.number(),
  }).strict()),
  "plugins": z.array(pluginStatus_plugins__Schema),
  "packs": z.array(z.object({
    "schemaVersion": z.literal(1),
    "kind": z.literal("pack"),
    "id": z.string(),
    "name": z.string(),
    "description": z.string(),
    "version": z.string(),
    "members": z.array(z.object({
      "kind": z.union([z.literal("plugin"), z.literal("pack")]),
      "id": z.string(),
      "version": z.string(),
    }).strict()),
    "replacesPlugins": z.array(z.string()),
  }).strict()),
  "runtime": z.object({
    "version": z.number(),
    "instances": z.array(communityView_runtime_instances__Schema),
  }).strict().optional(),
}).strict();
