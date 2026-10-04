import { z } from 'zod';
import * as dto from './core-dtos.ts';
import { controllerResponses, sessionViewSchema } from './controller-api.ts';
import { hostRuntimeDiagnosticSchema, networkRuntimeDiagnosticSchema, operationDeclarationSchema } from './operations.ts';
import { recoveryViewSchema, recoveryListSchema } from './recovery.ts';
import { operationResultSchema } from './operation-results.ts';
import { jsonValueSchema } from './json-values.ts';
import type { HttpResponseContract } from './http-response.ts';

const ok = z.object({ ok: z.literal(true) }).strict();
const vmStatus = dto.vmViewSchema.shape.status;
const vmSummary = z.object({
  id: z.string(), name: z.string(), status: vmStatus,
  distro: z.enum(['alpine', 'debian', 'ubuntu']).optional(), cpus: z.number(), memoryMiB: z.number(), diskGiB: z.number()
}).strict();
const descriptor = z.object({
  id: z.string(), type: z.literal('public-key'),
  transports: z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).optional()
}).strict();
export const passkeyAuthenticationSchema = z.object({
  ceremonyId: z.string(), options: z.object({
    challenge: z.string(), rpId: z.string(), timeout: z.number(),
    userVerification: z.literal('required'), allowCredentials: z.array(descriptor).optional(),
  }).strict()
}).strict();
/** The controller always requests resident credentials, none attestation and credProps. */
export const passkeyRegistrationSchema = z.object({
  ceremonyId: z.string(), options: z.object({
    challenge: z.string(), rp: z.object({ name: z.string(), id: z.string() }).strict(),
    user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }).strict(),
    pubKeyCredParams: z.array(z.object({ alg: z.union([z.literal(-7), z.literal(-257)]), type: z.literal('public-key') }).strict()),
    timeout: z.number(), attestation: z.literal('none'), excludeCredentials: z.array(descriptor),
    authenticatorSelection: z.object({
      residentKey: z.literal('required'), userVerification: z.literal('required'),
      requireResidentKey: z.literal(true), authenticatorAttachment: z.literal('platform').optional()
    }).strict(),
    extensions: z.object({ credProps: z.literal(true) }).strict(), hints: z.array(z.enum(['security-key', 'client-device', 'hybrid'])),
  }).strict()
}).strict();

const storagePool = z.object({ id: z.string(), name: z.string(), root: z.string(), createdAt: z.string() }).strict();
const storageView = z.object({
  currentPoolId: z.string().nullable(), pendingCleanup: z.array(z.object({
    vmId: z.string(), sourcePoolId: z.string(), targetPoolId: z.string(), addedAt: z.string(),
  }).strict()), pools: z.array(storagePool.extend({
    available: z.boolean(), totalBytes: z.number().nullable(),
    freeBytes: z.number().nullable(), allocatedBytes: z.number(), vms: z.array(z.object({ id: z.string(), name: z.string(), diskBytes: z.number() }).strict()),
  }).strict())
}).strict();
const storageExecution = storageView.extend({ ready: z.literal(true), executed: z.boolean() }).strict();
export const storageActionSchema = z.union([
  storageExecution,
  storageExecution.extend({ created: storagePool }).strict(),
  storageExecution.extend({ removed: z.string() }).strict(),
  storageExecution.extend({ cleanup: z.object({ completed: z.array(z.string()), errors: z.array(z.object({ vmId: z.string(), message: z.string() }).strict()) }).strict() }).strict(),
  storageExecution.extend({ moved: z.object({ moved: z.boolean(), from: z.string(), to: z.string(), cleanupPending: z.boolean(), vm: dto.vmViewSchema }).strict() }).strict(),
]);

const auditEvent = z.object({
  time: z.string(), kind: z.enum(['request', 'job', 'connection']), phase: z.enum(['start', 'end']),
  traceId: z.string(), spanId: z.string(), parentSpanId: z.string().optional(), name: z.string(),
  vmId: z.string().optional(), projectId: z.string().optional(), status: z.number().optional(), jobId: z.string().optional(),
  actorId: z.string().optional(), pluginId: z.string().optional(), pluginInstanceId: z.string().optional(),
  pluginGeneration: z.string().optional(), operationId: z.string().optional(), recoveryId: z.string().optional(), durationMs: z.number().optional(),
}).strict();
const auditRecord = z.object({ sequence: z.number(), previous: z.string(), event: auditEvent, hash: z.string() }).strict();
export const auditResponseSchema = z.union([
  z.object({ valid: z.literal(true), sequence: z.number(), hash: z.string(), records: z.array(auditRecord), bytes: z.number() }).strict(),
  z.object({ valid: z.literal(false), records: z.array(auditRecord), error: z.string() }).strict(),
]);

export const monitorResponseSchema = z.object({
  version: z.literal(1), capturedAt: z.string(), host: z.string(), totalVms: z.number(), totalJobs: z.number(),
  vms: z.array(z.object({ id: z.string(), name: z.string(), status: vmStatus, cpus: z.number(), memoryMiB: z.number() }).strict()),
  jobs: z.array(z.object({
    id: z.string().optional(), vmId: z.string().optional(), scope: z.string(), action: z.string(),
    status: dto.jobViewSchema.shape.status, startedAt: z.string(), finishedAt: z.string().optional()
  }).strict()),
}).strict();
const graphqlLimits = z.object({
  queryBytes: z.number(), requestBytes: z.number(), tokens: z.number(), depth: z.number(),
  expandedSelections: z.number(), cost: z.number(), pageSize: z.number(), offset: z.number(), responseBytes: z.number(), timeoutMs: z.number(), concurrent: z.number()
}).strict();
/** GraphQL selection keys and vendor error extensions are JSON protocol extension fields. */
const graphqlEnvelope = z.object({
  data: z.record(z.string(), jsonValueSchema).nullable().optional(),
  errors: z.array(z.object({
    message: z.string(), locations: z.array(z.object({ line: z.number(), column: z.number() }).strict()).optional(),
    path: z.array(z.union([z.string(), z.number()])).optional(), extensions: z.record(z.string(), jsonValueSchema).optional()
  }).strict()).min(1).optional(),
  extensions: z.record(z.string(), jsonValueSchema).optional(),
}).strict();
export const graphqlResultSchema = z.union([
  graphqlEnvelope.extend({ data: z.record(z.string(), jsonValueSchema).nullable() }).strict(),
  graphqlEnvelope.extend({ errors: graphqlEnvelope.shape.errors.unwrap() }).strict(),
]);
const securityRequirement = z.record(z.string(), z.array(z.string()));
/** Schema values contain the JSON Schema vocabulary declared by the operation, including extension keywords. */
const documentSchema = z.record(z.string(), jsonValueSchema);
const content = z.record(z.string(), z.object({ schema: documentSchema }).strict());
const apiOperation = z.object({
  operationId: z.string(), summary: z.string(), description: z.string(), tags: z.array(z.string()),
  parameters: z.array(z.object({ name: z.string(), in: z.enum(['path', 'query', 'header']), required: z.boolean(), schema: documentSchema, description: z.string().optional() }).strict()),
  requestBody: z.object({ required: z.boolean(), content }).strict().optional(),
  responses: z.record(z.string(), z.object({ description: z.string(), content: content.optional() }).strict()),
  security: z.array(securityRequirement).optional(), 'x-sakura-enabled': z.boolean(), 'x-sakura-inspectable': z.boolean(),
  'x-sakura-contract': z.enum(['declared', 'partial']), 'x-sakura-operation': operationDeclarationSchema.optional(),
  'x-sakura-response': z.object({ kind: z.enum(['json', 'text', 'binary', 'event-stream', 'empty']) }).strict().optional(),
}).strict();
export const openApiResponseSchema = z.object({
  openapi: z.literal('3.1.1'), info: z.object({ title: z.string(), version: z.string(), description: z.string() }).strict(),
  servers: z.array(z.object({ url: z.string() }).strict()), security: z.array(securityRequirement),
  components: z.object({
    securitySchemes: z.record(z.string(), z.object({ type: z.literal('apiKey'), in: z.literal('header'), name: z.string() }).strict()),
    schemas: z.record(z.string(), documentSchema).optional()
  }).strict(),
  paths: z.record(z.string(), z.partialRecord(z.enum(['get', 'post', 'put', 'patch', 'delete', 'options']), apiOperation)),
  'x-sakura-operations': z.array(operationDeclarationSchema), 'x-sakura-catalog-version': z.number(),
  'x-sakura-route-prefixes': z.array(z.object({ owner: z.string(), path: z.string(), methods: z.array(z.string()), projectScoped: z.boolean(), enabled: z.boolean() }).strict()),
}).strict();
/** Signed WASM programs may return any JSON value, inside this controller-owned envelope. */
export const communityResultSchema = z.object({ pluginId: z.string(), version: z.string(), result: jsonValueSchema }).strict();

export const coreResponseSchemas: Readonly<Record<string, z.ZodType>> = {
  ...controllerResponses,
  'access.ssoProviders': dto.ssoProvidersSchema, 'access.ssoStart': dto.ssoStartSchema,
  'access.ssoView': dto.ssoViewSchema, 'access.ssoOidcConfigure': dto.ssoViewSchema, 'access.ssoOidcDisable': dto.ssoViewSchema,
  'access.ssoSamlConfigure': dto.ssoViewSchema, 'access.ssoSamlDisable': dto.ssoViewSchema, 'access.ssoUnlink': dto.ssoUnlinkSchema,
  'access.terminalShares': z.object({ grants: dto.terminalSharesSchema }).strict(), 'access.terminalShareCreate': dto.terminalShareSchema, 'access.terminalShareRevoke': dto.terminalShareRevokedSchema,
  'access.passkeyLoginOptions': passkeyAuthenticationSchema, 'access.passkeys': z.object({ passkeys: dto.passkeyListSchema }).strict(),
  'access.passkeyRegisterOptions': passkeyRegistrationSchema, 'access.passkeyRegisterVerify': dto.passkeyRegisteredSchema, 'access.passkeyRemove': dto.accountRemoveSchema,
  'access.view': z.object({ role: z.enum(['owner', 'viewer', 'member']), checkedAt: z.string(), desktopAvailable: z.boolean(), vms: z.array(vmSummary) }).strict(),
  'access.enable': dto.accountEnableSchema, 'access.users': z.object({ users: dto.accountUsersSchema }).strict(),
  'access.createViewer': dto.accountCreateSchema, 'access.removeViewer': dto.accountRemoveSchema, 'access.createMember': dto.accountCreateSchema, 'access.removeMember': dto.accountRemoveSchema,
  'access.projectPermissions': dto.projectPermissionsSchema, 'access.configureProjectPermissions': dto.projectPermissionsConfiguredSchema,
  'access.policyBundleKeys': dto.policyKeysSchema, 'access.policyBundleKeyAction': dto.policyKeyActionSchema,
  'access.exportPolicyBundle': z.object({ bundle: dto.policyExportSchema }).strict(), 'access.previewPolicyBundle': dto.policyPreviewSchema, 'access.applyPolicyBundle': dto.policyAppliedSchema,
  'access.changes': z.object({ changes: dto.changesSchema }).strict(), 'access.createChange': dto.changeCreateSchema, 'access.decideChange': dto.changeDecisionSchema, 'access.applyChange': dto.changeAppliedSchema, 'access.password': dto.accountPasswordSchema,
  system: z.object({
    name: z.literal('Sakura'), version: z.string(), engine: z.string(), posixloom: z.string(), nativeHost: z.boolean(), hostname: z.string(),
    platform: z.enum(['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd']), hostCpus: z.number(), hostMemoryMiB: z.number(),
    freeMemoryMiB: z.number(), controllerMemoryMiB: z.number(), imageReady: z.boolean(), imageBytes: z.number(), plugins: z.array(z.string()),
    pluginRuntime: dto.communityViewSchema.shape.runtime.optional(), session: sessionViewSchema
  }).strict(),
  monitor: monitorResponseSchema, 'storage-pools.get': storageView, 'storage-pools.action': storageActionSchema,
  'native.get': dto.nativeViewSchema, 'native.action': dto.nativeActionSchema, 'native-clipboard.get': dto.clipboardViewSchema, 'native-clipboard.action': dto.clipboardActionSchema,
  'assistant.get': dto.assistantViewSchema, 'assistant.action': z.union([dto.assistantViewSchema, dto.assistantPreviewSchema, dto.assistantModelsSchema, dto.assistantGeneratedSchema]),
  'webhooks.get': dto.webhookViewSchema, 'webhooks.change': dto.webhookConfiguredSchema,
  'automation-rules.get': dto.automationViewSchema, 'automation-rules.change': dto.automationConfiguredSchema,
  'feature-rollouts.get': dto.rolloutsSchema.extend({ selected: z.array(z.string()), active: z.array(z.string()) }).strict(), 'feature-rollouts.change': dto.rolloutConfiguredSchema,
  'fleet-policy-rollouts.get': dto.fleetViewSchema, 'fleet-policy-rollouts.change': dto.fleetConfiguredSchema,
  'usb-hotplug.get': dto.usbViewSchema, 'usb-hotplug.change': dto.usbActionSchema,
  'gpu-profiles.get': dto.gpuViewSchema, 'gpu-profiles.change': dto.gpuActionSchema,
  'build-farm.get': z.union([dto.buildFarmSchema, dto.buildFarmProjectsSchema]), 'build-farm.change': dto.buildFarmActionSchema,
  'media-devices.get': dto.mediaViewSchema, 'media-devices.change': dto.mediaActionSchema,
  'memory-reclaim.get': dto.memoryViewSchema, 'memory-reclaim.change': dto.memoryActionSchema,
  'host-mount.get': dto.hostMountViewSchema, 'host-mount.change': dto.hostMountActionSchema,
  'virtioFs.get': dto.virtioFsViewSchema, 'virtioFs.change': dto.virtioFsActionSchema,
  'trustedBoot.get': dto.trustedBootViewSchema, 'trustedBoot.change': dto.trustedBootActionSchema,
  'host-peers.get': dto.hostPeersSchema.extend({ local: dto.hostStatusSchema }).strict(), 'host-peers.change': dto.hostPeersConfiguredSchema,
  'cold-migrations.get': dto.coldMigrationsSchema, 'snapshot-replications.get': dto.snapshotReplicationsSchema,
  'graphql.schema': z.object({ version: z.literal('1'), endpoint: z.literal('/api/graphql'), readOnly: z.literal(true), limits: graphqlLimits, sdl: z.string() }).strict(),
  'graphql.query': graphqlResultSchema, 'log-retention.get': dto.retentionViewSchema, 'log-retention.change': z.union([dto.retentionViewSchema, dto.retentionPreviewSchema]),
  audit: auditResponseSchema, 'audit.remoteStatus': dto.remoteAuditSchema, 'audit.remoteAction': dto.remoteAuditSchema,
  'plugins.list': dto.pluginStatusSchema, 'plugins.change': dto.pluginStatusSchema,
  'community-plugins.list': dto.communityViewSchema, 'community-plugins.change': z.union([dto.communityViewSchema, communityResultSchema]), 'community-plugins.extension': communityResultSchema,
  'mobile-companion.get': dto.mobileViewSchema.extend({ listener: dto.hostPeersSchema.shape.listener, fingerprint: dto.hostPeersSchema.shape.fingerprint }).strict(), 'mobile-companion.change': dto.mobileActionSchema,
  'vms.list': z.array(dto.vmViewSchema), 'vms.create': dto.vmViewSchema, 'vms.get': dto.vmViewSchema, 'vms.update': dto.vmViewSchema,
  'vms.delete': ok, 'vms.start': dto.vmViewSchema, 'vms.stop': dto.vmViewSchema,
  'vms.exec': z.union([z.object({ scope: z.literal('instance'), stdout: z.string(), stderr: z.string(), code: z.number() }).strict(),
  z.object({ scope: z.literal('project'), projectId: z.string(), directory: z.string(), networkIsolation: z.enum(['host', 'private']), stdout: z.string(), stderr: z.string(), code: z.number() }).strict()]),
  'vms.logs': z.object({ content: z.string() }).strict(), 'lockdown.get': z.object({ locked: z.boolean() }).strict(), 'lockdown.set': z.object({ locked: z.boolean(), stopped: z.boolean() }).strict(),
  'jobs.list': z.object({ jobs: z.array(dto.jobViewSchema), warnings: z.array(z.string()) }).strict(),
  'jobs.result': z.object({ jobId: z.string(), result: jsonValueSchema }).strict(), 'jobs.cancel': ok, 'jobs.retry': dto.jobViewSchema,
  events: z.object({
    events: z.array(z.object({
      type: z.literal('job'), id: z.string().optional(), vmId: z.string().optional(), projectId: z.string().optional(), title: z.string().optional(),
      status: z.enum(['error', 'cancelled', 'interrupted']), message: z.string().optional(), errorCode: z.string().optional(), at: z.string()
    }).strict())
  }).strict(),
  openapi: openApiResponseSchema, sdk: z.object({ filename: z.literal('sakura-client.mjs'), mime: z.literal('text/javascript'), content: z.string() }).strict(),
  'session.passkeyOptions': passkeyAuthenticationSchema, 'access.jitList': z.object({ requests: dto.jitListSchema }).strict(), 'access.jitCreate': dto.jitRequestSchema,
  'access.jitDecision': dto.jitRequestSchema, 'access.jitExecute': dto.jitRequestSchema,
  'browserExtensions.list': z.object({ connections: dto.extensionConnectionsSchema }).strict(), 'browserExtensions.pair': dto.extensionPairingSchema, 'browserExtensions.revoke': dto.extensionRevokedSchema,
  'extension.connect': dto.extensionConnectedSchema, 'extension.inventory': z.object({ permissions: z.array(z.string()), expiresAt: z.number(), checkedAt: z.string(), vms: z.array(vmSummary) }).strict(),
  'guest.interop': dto.guestInteropSchema,
  'operation-results.get': operationResultSchema,
  'recoveries.rebuild': recoveryListSchema,
  'recoveries.list': recoveryListSchema, 'recoveries.retry': recoveryViewSchema,
  operations: z.object({ version: z.number(), operations: z.array(operationDeclarationSchema) }).strict(),
  'host-runtime': hostRuntimeDiagnosticSchema, 'network-runtime': networkRuntimeDiagnosticSchema,
};

const created = new Set(['access.terminalShareCreate', 'access.passkeyRegisterVerify', 'access.createViewer', 'access.createMember', 'access.createChange', 'vms.create', 'access.jitCreate', 'browserExtensions.pair', 'extension.connect']);
export const coreResponseContracts: Readonly<Record<string, HttpResponseContract>> = {
  ...Object.fromEntries(Object.entries(coreResponseSchemas).map(([id, schema]) => [id, {
    kind: 'json' as const, statuses: id === 'graphql.query' ? [200, 400] : [created.has(id) ? 201 : 200],
    media: id === 'graphql.query' ? 'application/graphql-response+json' : 'application/json', schema,
  }])),
  'access.ssoOidcCallback': { kind: 'text', statuses: [200], media: 'text/html', schema: z.string() },
  'access.ssoSamlCallback': { kind: 'text', statuses: [200], media: 'text/html', schema: z.string() },
  download: { kind: 'binary', statuses: [200], media: 'application/octet-stream' },
  'extension.connectOptions': { kind: 'empty', statuses: [204] },
  'extension.inventoryOptions': { kind: 'empty', statuses: [204] },
};
export const coreResponseSchema = (id: string): z.ZodType | undefined => coreResponseSchemas[id];
