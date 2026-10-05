import type { IncomingMessage } from 'node:http';
import type { OperationEntry } from './operation-catalog.ts';
import { DEFAULT_JSON_REQUEST_BYTES, MAX_TEXT_REQUEST_BYTES, readJsonBody, requestHasBody } from './http.ts';
import { resolveOperationBody } from '../shared/http-transport.ts';
import { validateOperationInput } from './operation-gateway.ts';
import { graphqlLimits } from './graphql-api.ts';

const coreByteLimits = new Map<string, number>();
for (const [limit, ids] of [
  [4096, ['operation-results.archive', 'recoveries.retry', 'recoveries.rebuild',
    'access.login', 'access.enable', 'access.handoffRedeem', 'access.handoffCreate',
    'access.terminalShareCreate', 'access.passkeyLoginOptions', 'access.passkeyRegisterOptions',
    'access.passkeyRemove', 'access.createViewer', 'access.createMember', 'access.password',
    'access.ssoStart', 'access.exportPolicyBundle', 'access.decideChange', 'access.applyChange',
    'access.jitCreate', 'access.jitDecision', 'access.jitExecute', 'browserExtensions.pair',
    'session.unlock', 'session.activity', 'session.lock', 'session.configure', 'session.passkeyOptions',
    'mobile-companion.change', 'usb-hotplug.change', 'memory-reclaim.change', 'host-mount.change',
    'virtioFs.change', 'trustedBoot.change', 'guest.interop', 'extension.connect']],
  [8192, ['access.ssoOidcConfigure', 'access.policyBundleKeyAction', 'audit.remoteAction',
    'gpu-profiles.change', 'build-farm.change', 'media-devices.change']],
  [32768, ['access.configureProjectPermissions', 'webhooks.change', 'automation-rules.change',
    'feature-rollouts.change', 'fleet-policy-rollouts.change', 'host-peers.change',
    'native-clipboard.action', 'native.action', 'community-plugins.extension']],
  [65536, ['access.passkeyLoginVerify', 'access.passkeyRegisterVerify', 'session.passkeyVerify',
    'access.previewPolicyBundle', 'access.applyPolicyBundle', 'access.createChange', 'community-plugins.change']],
  [128 * 1024, ['assistant.action']],
  [512 * 1024, ['vms.exec']],
  [700000, ['access.ssoSamlConfigure']],
  [graphqlLimits.requestBytes, ['graphql.query']],
] as const) for (const id of ids) coreByteLimits.set('core.' + id, limit);

/** Match the small credential and recovery envelopes before allocating a
 * receipt. Other handlers still apply their own bound when reading the cache. */
export function operationInputByteLimit(entry: OperationEntry) {
  const id = entry.declaration.id;
  const coreLimit = coreByteLimits.get(id);
  if (coreLimit !== undefined) return coreLimit;
  if (['files.legacy.put.vms.vmId.file', 'git.legacy.post.vms.vmId.git',
    'sync.legacy.post.vms.vmId.sync', 'code-checks.legacy.post.vms.vmId.language-service'].includes(id))
    return MAX_TEXT_REQUEST_BYTES;
  return DEFAULT_JSON_REQUEST_BYTES;
}

/** Invoke under gateway admission, before OperationResults.start/begin.
 * Binary uploads, forms and streaming handlers retain their original readers. */
export async function prepareOperationInput(req: IncomingMessage, entry: OperationEntry,
  options: { maxBytes?: number; signal?: AbortSignal } = {}) {
  if (!entry.declaration.mutating || entry.requestContract?.kind !== 'json') return;
  const query = Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
  const body = resolveOperationBody(entry.requestContract, query);
  if (body.kind === 'none' || (!body.required && !requestHasBody(req))) return;
  const input = await readJsonBody(req, options.maxBytes ?? operationInputByteLimit(entry), options.signal);
  return validateOperationInput(input);
}

/** Unlock and complete password/passkey authentication share a bounded reserve
 * so normal/SSO failures cannot block the owner from reviewing receipts. */
export function operationResultPool(id: string): 'normal' | 'management' | 'authentication' {
  if (['core.access.login', 'core.access.passkeyLoginOptions', 'core.access.passkeyLoginVerify',
    'core.session.unlock', 'core.session.passkeyOptions', 'core.session.passkeyVerify'].includes(id))
    return 'authentication';
  if (id === 'core.recoveries.rebuild' || id === 'core.recoveries.retry') return 'management';
  return 'normal';
}
