/**
 * 模块职责：按操作声明计算请求字节边界并准备输入，选择对应的有限结果存储预算。
 * Module purpose: Computes input byte boundaries from declarations and selects the corresponding finite-result storage pool.
 */
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
/**
 * 入口 / Entry: operationInputByteLimit.
 * 功能：在按操作声明计算请求字节边界并准备输入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `coreLimit` / `MAX_TEXT_REQUEST_BYTES` 供上层消费（`operation-input.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-input.ts`; this entry produces `coreLimit` / `MAX_TEXT_REQUEST_BYTES` for its caller. Module context: Computes input byte boundaries from declarations and selects the corresponding finite-result storage pool.
 * 处理：通过 `coreByteLimits.get`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `coreByteLimits.get`, `inline.includes`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `coreLimit !== undefined`; `['files.legacy.put.vms.vmId.file', 'git.legacy.post.vms.vmId.git', 'sync.legacy.post.vms.vmId.sync',…`.
 * 输入 / Inputs: entry: OperationEntry
 * 输出 / Returns: `coreLimit`; `MAX_TEXT_REQUEST_BYTES`; `DEFAULT_JSON_REQUEST_BYTES`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: prepareOperationInput.
 * 功能：在按操作声明计算请求字节边界并准备输入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `validateOperationInput(input)` 供上层消费（`operation-input.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-input.ts`; this entry produces `void` / `validateOperationInput(input)` for its caller. Module context: Computes input byte boundaries from declarations and selects the corresponding finite-result storage pool.
 * 处理：通过 `resolveOperationBody`, `requestHasBody`, `readJsonBody`, `operationInputByteLimit` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `resolveOperationBody`, `requestHasBody`, `readJsonBody`, `operationInputByteLimit`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!entry.declaration.mutating || entry.requestContract?.kind !== 'json'`; `body.kind === 'none' || (!body.required && !requestHasBody(req))`.
 * 输入 / Inputs: req: IncomingMessage; entry: OperationEntry; options: { maxBytes?: number; signal?: AbortSignal } default={}
 * 输出 / Returns: `void`; `validateOperationInput(input)`.
 * 副作用 / Effects: `requestHasBody`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: operationResultPool.
 * 功能：在按操作声明计算请求字节边界并准备输入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'authentication'` / `'management'` 供上层消费（`operation-input.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-input.ts`; this entry produces `'authentication'` / `'management'` for its caller. Module context: Computes input byte boundaries from declarations and selects the corresponding finite-result storage pool.
 * 处理：通过 `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.includes`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `['core.access.login', 'core.access.passkeyLoginOptions', 'core.access.passkeyLoginVerify', 'core.ses…`; `id === 'core.recoveries.rebuild' || id === 'core.recoveries.retry'`.
 * 输入 / Inputs: id: string
 * 输出 / Returns: 'normal' | 'management' | 'authentication'；结果来自 / values from `'authentication'`; `'management'`; `'normal'`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function operationResultPool(id: string): 'normal' | 'management' | 'authentication' {
  if (['core.access.login', 'core.access.passkeyLoginOptions', 'core.access.passkeyLoginVerify',
    'core.session.unlock', 'core.session.passkeyOptions', 'core.session.passkeyVerify'].includes(id))
    return 'authentication';
  if (id === 'core.recoveries.rebuild' || id === 'core.recoveries.retry') return 'management';
  return 'normal';
}
