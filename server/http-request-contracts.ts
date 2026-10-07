/**
 * 模块职责：从操作声明选择 HTTP 线路请求契约，缺少明确契约的操作拒绝发布。
 */
import { z } from 'zod';
import type { OperationPolicy } from '../shared/contracts/operations.ts';
import { organizationSchema } from '../shared/contracts/vm.ts';
import { jsonValueSchema } from '../shared/contracts/json-values.ts';
import { httpRouteRequests } from './http-route-requests.ts';
import { backupPolicySchema } from './backups.ts';
import { containerActionSchema } from './containers.ts';
import { diskMaintenancePolicySchema } from './disk-maintenance.ts';
import { downloadSchema } from './downloads.ts';
import { extendedFeatureActionRequest } from './extended-features.ts';
import { featureSuiteActionRequest, featureSuiteUpdateRequest } from './feature-suite.ts';
import { gitActionSchema } from './git-workbench.ts';
import { networkProfileRequest } from './network-profiles.ts';
import { nextFeatureActionRequest } from './next-features.ts';
import { packageWorkbenchRequest } from './package-workbench.ts';
import { pipelineSchema } from './pipelines.ts';
import { projectSchema } from './project-config.ts';
import { recipeSchema } from './recipes.ts';
import { requestSchema as uploadSessionRequest } from './resumable-uploads.ts';
import { secretRotationRequest, secretSaveRequest } from './secrets.ts';
import { syncSchema } from './sync.ts';
import { toolchainInstallRequest } from './toolchains.ts';
import { extensionCodeInput } from './browser-extensions.ts';

export type HttpRequestContract = {
  kind: 'none' | 'json' | 'form' | 'binary';
  required: boolean;
  media?: string;
  bodylessQuery?: string;
  schema?: z.ZodType;
  query: z.ZodObject;
  headers: z.ZodObject;
};
/** Extensible protocol fields remain JSON values in the published wire type. */
export function wireRequestSchema(
  schema: z.ZodType,
  published?: Record<string, unknown>,
): Record<string, unknown> {
  const json = published || (z.toJSONSchema(schema, { io: 'input' }) as Record<string, any>);
  let extensions = false;
  const jsonExtension = () => {
    extensions = true;
    return { $ref: '#/$defs/requestJsonValue' };
  };
  const visit = (value: unknown): unknown => {
    if (value === true) return jsonExtension();
    if (!value || typeof value !== 'object') return value;
    const part = value as Record<string, unknown>;
    if (!Object.keys(part).length) return jsonExtension();
    if (part.not && typeof part.not === 'object' && !Object.keys(part.not).length) return { ...part };
    const result = { ...part };
    // Traverse schema positions only: defaults, const values and examples are data.
    for (const key of ['properties', '$defs', 'patternProperties', 'dependentSchemas']) {
      const nested = part[key];
      if (nested && typeof nested === 'object')
        result[key] = Object.fromEntries(Object.entries(nested).map(([name, property]) => [name, visit(property)]));
    }
    for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems'])
      if (Array.isArray(part[key])) result[key] = part[key].map(visit);
    for (const key of ['items', 'additionalProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else',
      'unevaluatedProperties', 'unevaluatedItems'])
      if (part[key] !== undefined) result[key] = visit(part[key]);
    // Zod's stripping objects accept extra input fields; on the wire those are JSON, never arbitrary JS.
    if (part.type === 'object' && part.additionalProperties === undefined)
      result.additionalProperties = jsonExtension();
    return result;
  };
  const result = visit(json) as Record<string, any>;
  if (extensions) {
    const extension = JSON.parse(
      JSON.stringify(z.toJSONSchema(jsonValueSchema)).replaceAll('"#"', '"#/$defs/requestJsonValue"'),
    );
    delete extension.$schema;
    result.$defs = { ...result.$defs, requestJsonValue: extension };
  }
  return result;
}
const additionalInputs: Readonly<Record<string, z.ZodType>> = {
  'core.access.ssoSamlCallback': z
    .object({ SAMLResponse: z.string().min(1).max(1_500_000), RelayState: z.string().min(1).max(4096) })
    .strict(),
  'core.extension.connect': extensionCodeInput,
  'core.community-plugins.extension': jsonValueSchema,
  'automation.legacy.put.vms.vmId.advanced': featureSuiteUpdateRequest,
  'automation.legacy.post.vms.vmId.advanced': featureSuiteActionRequest,
  'automation.legacy.post.vms.vmId.packages': packageWorkbenchRequest,
  'backups.legacy.put.vms.vmId.backups': backupPolicySchema,
  'containers.legacy.post.vms.vmId.containers': containerActionSchema,
  'extensions.legacy.post.vms.vmId.extended-features': extendedFeatureActionRequest,
  'files.legacy.post.vms.vmId.uploads': uploadSessionRequest,
  'git.legacy.post.vms.vmId.git': gitActionSchema,
  'library.legacy.put.vms.vmId.organization': organizationSchema,
  'maintenance.legacy.put.vms.vmId.disk-maintenance': diskMaintenancePolicySchema,
  'network.legacy.post.network-profiles': networkProfileRequest,
  'pipelines.legacy.put.vms.vmId.pipelines': pipelineSchema,
  'platform.legacy.post.vms.vmId.next-features': nextFeatureActionRequest,
  'projects.legacy.put.vms.vmId.project': projectSchema,
  'recipes.legacy.put.vms.vmId.recipe': recipeSchema,
  'secrets.legacy.put.vms.vmId.secrets': secretSaveRequest,
  'secrets.legacy.patch.vms.vmId.secret-rotation': secretRotationRequest,
  'sync.legacy.put.vms.vmId.sync': syncSchema,
  'toolchains.legacy.post.vms.vmId.tools': toolchainInstallRequest,
  'transfers.legacy.post.vms.vmId.download': downloadSchema,
};
const noBody = new Set([
  'sandbox.destroy',
  'core.access.ssoOidcDisable',
  'core.access.ssoSamlDisable',
  'core.access.ssoUnlink',
  'core.access.handoffCancel',
  'core.access.terminalShareRevoke',
  'core.access.logout',
  'core.access.removeViewer',
  'core.access.removeMember',
  'core.vms.delete',
  'core.vms.start',
  'core.jobs.cancel',
  'core.jobs.retry',
  'core.browserExtensions.revoke',
  'automation.legacy.post.vms.vmId.suspend',
  'automation.legacy.post.vms.vmId.resume',
  'desktop.legacy.post.vms.vmId.ime',
  'images.legacy.post.images.imageId',
  'maintenance.legacy.post.vms.vmId.diagnostics',
  'maintenance.legacy.post.vms.vmId.compact',
  'files.legacy.delete.vms.vmId.uploads',
  'snapshots.legacy.delete.vms.vmId.snapshots.snapshotId',
  'sync.legacy.post.vms.vmId.sync-preview',
  'sync.legacy.post.vms.vmId.sync-queue',
  'sync.legacy.delete.vms.vmId.sync-queue',
]);
const binaryBody = new Set([
  'files.legacy.put.vms.vmId.transfer',
  'files.legacy.put.vms.vmId.uploads',
  'images.legacy.post.image-import',
  'snapshots.legacy.post.import',
]);
const text = () => z.string().max(4096);
const uuid = () => z.uuid();
const natural = () => z.string().regex(/^\d+$/).max(16);
const project = () => z.string().regex(/^(default|[a-f0-9]{16})$/);
const flag = () => z.enum(['0', '1']);
type QueryShape = Record<string, z.ZodType>;
const queries: Readonly<Record<string, QueryShape>> = {
  'core.access.ssoOidcCallback': {
    state: text(),
    code: text().optional(),
    error: text().optional(),
    error_description: text().optional(),
    iss: text().optional(),
    session_state: text().optional(),
  },
  'core.access.terminalShares': { vmId: uuid().optional(), project: project().optional() },
  'core.access.projectPermissions': { vmId: uuid(), projectId: project() },
  'core.build-farm.get': { vmId: uuid().optional() },
  'automation.legacy.get.vms.vmId.advanced': { limit: natural().optional() },
  'automation.legacy.get.vms.vmId.packages': {
    mode: z.enum(['installed', 'search', 'updates']).optional(),
    query: text().optional(),
    page: natural().optional(),
    limit: natural().optional(),
  },
  'containers.legacy.get.vms.vmId.containers': { logs: text().optional(), template: text().optional() },
  'code-checks.legacy.get.vms.vmId.code-diagnostics': { path: text().optional() },
  'code-checks.legacy.get.vms.vmId.language-service': { path: text().optional() },
  'files.legacy.get.vms.vmId.files': { path: text().optional() },
  'files.legacy.get.vms.vmId.file': { path: text() },
  'files.legacy.get.vms.vmId.file-lock': { path: text() },
  'files.legacy.post.vms.vmId.file-lock': { path: text() },
  'files.legacy.get.vms.vmId.history': { path: text().optional(), content: uuid().optional() },
  'files.legacy.get.vms.vmId.transfer': { path: text() },
  'files.legacy.put.vms.vmId.transfer': { path: text(), overwrite: flag().optional() },
  'files.legacy.get.vms.vmId.uploads': { id: uuid() },
  'files.legacy.post.vms.vmId.uploads': { id: uuid().optional() },
  'files.legacy.put.vms.vmId.uploads': { id: uuid(), chunk: natural() },
  'files.legacy.delete.vms.vmId.uploads': { id: uuid() },
  'files.legacy.get.vms.vmId.file-preview': { path: text() },
  'files.legacy.get.vms.vmId.download-chunks': { path: text(), chunk: natural().optional() },
  'git.legacy.get.vms.vmId.git': {
    choices: text().optional(),
    merge: text().optional(),
    path: text().optional(),
    staged: flag().optional(),
  },
  'images.legacy.post.image-import': {
    name: text(),
    format: z.enum(['raw', 'vmdk', 'vhdx', 'ova']),
    distro: z.enum(['alpine', 'debian', 'ubuntu']),
    architecture: z.enum(['x86_64', 'aarch64']).optional(),
    memoryMiB: natural(),
    cpus: natural(),
    accelerator: z.enum(['auto', 'tcg', 'whpx']).optional(),
    firmware: z.enum(['bios', 'uefi']).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  },
  'project-search.legacy.get.vms.vmId.project-files': { q: text().optional(), content: flag().optional() },
  'snapshots.legacy.post.import': { name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/) },
  'core.socket.events': { token: text() },
  'core.socket.logs': {
    token: text(),
    session: z
      .string()
      .regex(/^[a-z0-9-]{1,48}$/)
      .optional(),
  },
  'core.socket.terminal': {
    token: text(),
    session: z
      .string()
      .regex(/^[a-z0-9-]{1,48}$/)
      .optional(),
  },
  'core.socket.terminal-view': { token: text(), session: z.string().regex(/^[a-z0-9-]{1,48}$/) },
  'core.socket.desktop': { token: text(), app: uuid().optional() },
  'core.socket.desktop-view': { token: text() },
};
const artifactInputs = { run: uuid(), artifact: uuid() };
const fileHeaders = { 'x-sakura-file-lock': uuid().optional() };
export function requestContract(
  id: string,
  policy: OperationPolicy,
  method: string,
  supplied?: z.ZodType,
  jsonSchema?: Record<string, unknown>,
): HttpRequestContract {
  let schema =
    supplied || (httpRouteRequests as Readonly<Record<string, z.ZodType>>)[id] || additionalInputs[id];
  if (!schema && jsonSchema) schema = z.fromJSONSchema(jsonSchema as z.core.JSONSchema.JSONSchema);
  const kind = binaryBody.has(id)
    ? 'binary'
    : schema
      ? policy.transport === 'form'
        ? 'form'
        : 'json'
      : ['GET', 'OPTIONS', 'UPGRADE'].includes(method) || noBody.has(id)
        ? 'none'
        : undefined;
  if (!kind) throw new Error('HTTP操作缺少请求契约：' + id);
  const query = z
    .object({
      // VM panels carry their selected project even for lifecycle operations. This validated
      // context hint does not change the declaration's project binding or account grants.
      ...(policy.projectScoped || (method !== 'UPGRADE' && policy.identity !== 'host')
        ? { project: project().optional() } : {}),
      ...(['sandbox.artifact', 'snapshots.rescue-artifact', 'backups.recovery-artifact'].includes(id)
        ? artifactInputs
        : {}),
      ...queries[id],
    })
    .strict();
  const headers = z
    .object({
      ...(policy.access === 'guest' ? { 'x-sakura-guest-token': text() } : {}),
      ...(policy.access === 'extension'
        ? {
            origin: method === 'GET' ? text().optional() : text(),
            ...(method === 'OPTIONS' ? {} : { 'x-sakura-extension-origin': text() }),
            ...(policy.extensionAuth === 'paired' ? { 'x-sakura-extension-token': text() } : {}),
          }
        : {}),
      ...([
        'files.legacy.put.vms.vmId.transfer',
        'files.legacy.put.vms.vmId.uploads',
        'files.legacy.post.vms.vmId.uploads',
      ].includes(id)
        ? fileHeaders
        : {}),
      ...(id === 'snapshots.legacy.post.import'
        ? { 'x-sakura-passphrase': z.string().max(6000).optional() }
        : {}),
    })
    .strict();
  return {
    kind,
    required:
      kind !== 'none' &&
      id !== 'snapshots.legacy.post.vms.vmId.snapshots.snapshotId.restore',
    ...(id === 'files.legacy.post.vms.vmId.uploads' ? { bodylessQuery: 'id' } : {}),
    ...(kind !== 'none'
      ? {
          media:
            kind === 'form'
              ? 'application/x-www-form-urlencoded'
              : kind === 'binary'
                ? 'application/octet-stream'
                : 'application/json',
        }
      : {}),
    ...(schema ? { schema } : {}),
    query,
    headers,
  };
}
