/**
 * 模块职责：处理宿主资源、设备及互操作相关 API，将请求转交对应领域服务。
 * Module purpose: Connects host resource, device and interoperation APIs to their owning domain services.
 */
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import { assistantRequest } from './local-assistant.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

/**
 * 入口 / Entry: hostServiceHandlers.
 * 功能：构造宿主进程、同伴、媒体、共享和资源相关 HTTP 操作目录。
 * Purpose: Builds HTTP operations for host processes, peers, media, shares and resources.
 * 设计：请求分派保持具体领域的准入和恢复边界，路径不匹配时拒绝，不由 HTTP 包装层创建独立业务状态。
 * Design: Dispatch preserves each domain's admission/recovery boundary and refuses path mismatch instead of introducing HTTP-owned business state.
 * 输入 / Inputs: context: CoreHttpContext< | 'webhooks' | 'automationRules' | 'features' | 'rollouts' | 'select…
 * 输出 / Returns: CoreHttpHandlers；结果来自 / values from `{ 'core.webhooks.get': webhooksGetHandler, 'core.webhooks.change': webhooksGetHandler, 'core.automation-rules.get': automatio…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function hostServiceHandlers(
  context: CoreHttpContext<
    | 'webhooks'
    | 'automationRules'
    | 'features'
    | 'rollouts'
    | 'selectedPlugins'
    | 'fleetRollouts'
    | 'gpuProfiles'
    | 'buildFarm'
    | 'mediaDevices'
    | 'memoryReclaim'
    | 'hostMounts'
    | 'virtioFsShares'
    | 'trustedBoot'
    | 'hostPeers'
    | 'coldMigrations'
    | 'snapshotReplications'
    | 'native'
    | 'nativeClipboard'
    | 'assistant'
    | 'trustedUpdates'
    | 'requireService'
  >,
): CoreHttpHandlers {
  const { services, authorizedBody } = context;
  /**
   * 入口 / Entry: hostServiceHandlers.webhooksGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, webhooks.view())` / `send(res, await webhooks.configure(await authorizedBody(req, 32768)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, webhooks.view())` / `send(res, await webhooks.configure(await authorizedBody(req, 32768)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `services.requireService`, `send`, `webhooks.view`, `webhooks.configure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `send`, `webhooks.view`, `webhooks.configure`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, webhooks.view())`; `send(res, await webhooks.configure(await authorizedBody(req, 32768)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/webhooks'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const webhooksGetHandler: HttpOperationHandler = async (req, res, url) => {
    const webhooks = services.requireService('webhooks');
    if (url.pathname === '/api/webhooks') {
      if (req.method === 'GET') return send(res, webhooks.view());
      if (req.method === 'POST') return send(res, await webhooks.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.automationRulesGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, automationRules.view())` / `send(res, await automationRules.configure(await authorizedBody(req, 32768)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, automationRules.view())` / `send(res, await automationRules.configure(await authorizedBody(req, 32768)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `services.requireService`, `send`, `automationRules.view`, `automationRules.configure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `send`, `automationRules.view`, `automationRules.configure`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, automationRules.view())`; `send(res, await automationRules.configure(await authorizedBody(req, 32768)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/automation-rules'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const automationRulesGetHandler: HttpOperationHandler = async (req, res, url) => {
    const automationRules = services.requireService('automationRules');
    if (url.pathname === '/api/automation-rules') {
      if (req.method === 'GET') return send(res, automationRules.view());
      if (req.method === 'POST')
        return send(res, await automationRules.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.featureRolloutsGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { ...rollouts.view(), selected: selectedPlugins, active: [...features.enabled], })` / `send(res, await rollouts.configure(await authorizedBody(req, 32768)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, { ...rollouts.view(), selected: selectedPlugins, active: [...features.enabled], })` / `send(res, await rollouts.configure(await authorizedBody(req, 32768)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `send`, `rollouts.view`, `rollouts.configure`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `rollouts.view`, `rollouts.configure`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { ...rollouts.view(), selected: selectedPlugins, active: [...features.enabled], })`; `send(res, await rollouts.configure(await authorizedBody(req, 32768)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/feature-rollouts'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const featureRolloutsGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, rollouts, selectedPlugins } = services;
    if (url.pathname === '/api/feature-rollouts') {
      if (req.method === 'GET')
        return send(res, {
          ...rollouts.view(),
          selected: selectedPlugins,
          active: [...features.enabled],
        });
      if (req.method === 'POST') return send(res, await rollouts.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.fleetPolicyRolloutsGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, fleetRollouts.view())` / `send(res, await fleetRollouts.configure(await authorizedBody(req, 32768)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, fleetRollouts.view())` / `send(res, await fleetRollouts.configure(await authorizedBody(req, 32768)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `send`, `fleetRollouts.view`, `fleetRollouts.configure`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `fleetRollouts.view`, `fleetRollouts.configure`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, fleetRollouts.view())`; `send(res, await fleetRollouts.configure(await authorizedBody(req, 32768)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/fleet-policy-rollouts'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const fleetPolicyRolloutsGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { fleetRollouts, rollouts } = services;
    if (url.pathname === '/api/fleet-policy-rollouts') {
      if (req.method === 'GET') return send(res, fleetRollouts.view());
      if (req.method === 'POST')
        return send(res, await fleetRollouts.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.gpuProfilesGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await gpuProfiles.view())` / `send(res, await gpuProfiles.action(await authorizedBody(req, 8192)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, await gpuProfiles.view())` / `send(res, await gpuProfiles.action(await authorizedBody(req, 8192)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `services.requireService`, `send`, `gpuProfiles.view`, `gpuProfiles.action` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `send`, `gpuProfiles.view`, `gpuProfiles.action`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await gpuProfiles.view())`; `send(res, await gpuProfiles.action(await authorizedBody(req, 8192)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/gpu-profiles'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const gpuProfilesGetHandler: HttpOperationHandler = async (req, res, url) => {
    const gpuProfiles = services.requireService('gpuProfiles');
    if (url.pathname === '/api/gpu-profiles') {
      if (req.method === 'GET') return send(res, await gpuProfiles.view());
      if (req.method === 'POST') return send(res, await gpuProfiles.action(await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.buildFarmGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send( res, url.searchParams.has('vmId') ? await buildFarm.projects(url.searchParams.get('vmId')!) : buildFarm.view(), )` / `send(res, await buildFarm.action(await authorizedBody(req, 8192)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send( res, url.searchParams.has('vmId') ? await buildFarm.projects(url.searchParams.get('vmId')!) : buildFarm.view(), )` / `send(res, await buildFarm.action(await authorizedBody(req, 8192)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `services.requireService`, `send`, `url.searchParams.has`, `buildFarm.projects` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `send`, `url.searchParams.has`, `buildFarm.projects`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send( res, url.searchParams.has('vmId') ? await buildFarm.projects(url.searchParams.get('vmId')!) : buildFarm.view(), )`; `send(res, await buildFarm.action(await authorizedBody(req, 8192)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/build-farm'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const buildFarmGetHandler: HttpOperationHandler = async (req, res, url) => {
    const buildFarm = services.requireService('buildFarm');
    if (url.pathname === '/api/build-farm') {
      if (req.method === 'GET')
        return send(
          res,
          url.searchParams.has('vmId')
            ? await buildFarm.projects(url.searchParams.get('vmId')!)
            : buildFarm.view(),
        );
      if (req.method === 'POST') return send(res, await buildFarm.action(await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.mediaDevicesGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await mediaDevices.view(mediaRoute[1]))` / `send(res, await mediaDevices.action(mediaRoute[1], await authorizedBody(req, 8192)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, await mediaDevices.view(mediaRoute[1]))` / `send(res, await mediaDevices.action(mediaRoute[1], await authorizedBody(req, 8192)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `inline.exec`, `send`, `mediaDevices.view`, `mediaDevices.action` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.exec`, `send`, `mediaDevices.view`, `mediaDevices.action`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await mediaDevices.view(mediaRoute[1]))`; `send(res, await mediaDevices.action(mediaRoute[1], await authorizedBody(req, 8192)))`.
   * 副作用 / Effects: `inline.exec`; `send`.
   * 拒绝 / Refusals: 条件 / conditions `mediaRoute`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const mediaDevicesGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { mediaDevices } = services;
    const mediaRoute = /^\/api\/vms\/([a-f0-9-]{36})\/media-devices$/.exec(url.pathname);
    if (mediaRoute) {
      if (req.method === 'GET') return send(res, await mediaDevices.view(mediaRoute[1]));
      if (req.method === 'POST')
        return send(res, await mediaDevices.action(mediaRoute[1], await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.memoryReclaimGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await memoryReclaim.view(reclaimRoute[1]))` / `send(res, await memoryReclaim.action(reclaimRoute[1], await authorizedBody(req, 4096)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, await memoryReclaim.view(reclaimRoute[1]))` / `send(res, await memoryReclaim.action(reclaimRoute[1], await authorizedBody(req, 4096)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `services.requireService`, `inline.exec`, `send`, `memoryReclaim.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `inline.exec`, `send`, `memoryReclaim.view`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await memoryReclaim.view(reclaimRoute[1]))`; `send(res, await memoryReclaim.action(reclaimRoute[1], await authorizedBody(req, 4096)))`.
   * 副作用 / Effects: `inline.exec`; `send`.
   * 拒绝 / Refusals: 条件 / conditions `reclaimRoute`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const memoryReclaimGetHandler: HttpOperationHandler = async (req, res, url) => {
    const memoryReclaim = services.requireService('memoryReclaim');
    const reclaimRoute = /^\/api\/vms\/([a-f0-9-]{36})\/memory-reclaim$/.exec(url.pathname);
    if (reclaimRoute) {
      if (req.method === 'GET') return send(res, await memoryReclaim.view(reclaimRoute[1]));
      if (req.method === 'POST')
        return send(res, await memoryReclaim.action(reclaimRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.hostMountGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await hostMounts.view(hostMountRoute[1]))` / `send(res, await hostMounts.action(hostMountRoute[1], await authorizedBody(req, 4096)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, await hostMounts.view(hostMountRoute[1]))` / `send(res, await hostMounts.action(hostMountRoute[1], await authorizedBody(req, 4096)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `inline.exec`, `send`, `hostMounts.view`, `hostMounts.action` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.exec`, `send`, `hostMounts.view`, `hostMounts.action`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await hostMounts.view(hostMountRoute[1]))`; `send(res, await hostMounts.action(hostMountRoute[1], await authorizedBody(req, 4096)))`.
   * 副作用 / Effects: `inline.exec`; `send`.
   * 拒绝 / Refusals: 条件 / conditions `hostMountRoute`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const hostMountGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { hostMounts } = services;
    const hostMountRoute = /^\/api\/vms\/([a-f0-9-]{36})\/host-mount$/.exec(url.pathname);
    if (hostMountRoute) {
      if (req.method === 'GET') return send(res, await hostMounts.view(hostMountRoute[1]));
      if (req.method === 'POST')
        return send(res, await hostMounts.action(hostMountRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.virtioFsGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await virtioFsShares.view(virtioFsRoute[1]))` / `send(res, await virtioFsShares.action(virtioFsRoute[1], await authorizedBody(req, 4096)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, await virtioFsShares.view(virtioFsRoute[1]))` / `send(res, await virtioFsShares.action(virtioFsRoute[1], await authorizedBody(req, 4096)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `inline.exec`, `send`, `virtioFsShares.view`, `virtioFsShares.action` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.exec`, `send`, `virtioFsShares.view`, `virtioFsShares.action`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await virtioFsShares.view(virtioFsRoute[1]))`; `send(res, await virtioFsShares.action(virtioFsRoute[1], await authorizedBody(req, 4096)))`.
   * 副作用 / Effects: `inline.exec`; `send`.
   * 拒绝 / Refusals: 条件 / conditions `virtioFsRoute`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const virtioFsGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { virtioFsShares } = services;
    const virtioFsRoute = /^\/api\/vms\/([a-f0-9-]{36})\/virtio-fs$/.exec(url.pathname);
    if (virtioFsRoute) {
      if (req.method === 'GET') return send(res, await virtioFsShares.view(virtioFsRoute[1]));
      if (req.method === 'POST')
        return send(res, await virtioFsShares.action(virtioFsRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.trustedBootGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await trustedBoot.view(trustedBootRoute[1]))` / `send(res, await trustedBoot.action(trustedBootRoute[1], await authorizedBody(req, 4096)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, await trustedBoot.view(trustedBootRoute[1]))` / `send(res, await trustedBoot.action(trustedBootRoute[1], await authorizedBody(req, 4096)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `inline.exec`, `send`, `trustedBoot.view`, `trustedBoot.action` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.exec`, `send`, `trustedBoot.view`, `trustedBoot.action`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await trustedBoot.view(trustedBootRoute[1]))`; `send(res, await trustedBoot.action(trustedBootRoute[1], await authorizedBody(req, 4096)))`.
   * 副作用 / Effects: `inline.exec`; `send`.
   * 拒绝 / Refusals: 条件 / conditions `trustedBootRoute`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const trustedBootGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { trustedBoot } = services;
    const trustedBootRoute = /^\/api\/vms\/([a-f0-9-]{36})\/trusted-boot$/.exec(url.pathname);
    if (trustedBootRoute) {
      if (req.method === 'GET') return send(res, await trustedBoot.view(trustedBootRoute[1]));
      if (req.method === 'POST')
        return send(res, await trustedBoot.action(trustedBootRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.hostPeersGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { ...hostPeers.view(), local: await hostPeers.status() })` / `send(res, await hostPeers.configure(await authorizedBody(req, 32768)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, { ...hostPeers.view(), local: await hostPeers.status() })` / `send(res, await hostPeers.configure(await authorizedBody(req, 32768)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `send`, `hostPeers.view`, `hostPeers.status`, `hostPeers.configure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `hostPeers.view`, `hostPeers.status`, `hostPeers.configure`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { ...hostPeers.view(), local: await hostPeers.status() })`; `send(res, await hostPeers.configure(await authorizedBody(req, 32768)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/host-peers'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const hostPeersGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { hostPeers } = services;
    if (url.pathname === '/api/host-peers') {
      if (req.method === 'GET') return send(res, { ...hostPeers.view(), local: await hostPeers.status() });
      if (req.method === 'POST')
        return send(res, await hostPeers.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.coldMigrationsGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, coldMigrations?.view() || { enabled: false, entries: [] })` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, coldMigrations?.view() || { enabled: false, entries: [] })` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `send`, `coldMigrations.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `coldMigrations.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, coldMigrations?.view() || { enabled: false, entries: [] })`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/cold-migrations'`; `req.method !== 'GET'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const coldMigrationsGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { coldMigrations } = services;
    if (url.pathname === '/api/cold-migrations') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, coldMigrations?.view() || { enabled: false, entries: [] });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.snapshotReplicationsGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `send(res, snapshotReplications?.view() || { enabled: false, entries: [] })` 供上层消费（`http-host-services.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `http-host-services.ts`; this entry produces `send(res, snapshotReplications?.view() || { enabled: false, entries: [] })` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `send`, `snapshotReplications.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `snapshotReplications.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, snapshotReplications?.view() || { enabled: false, entries: [] })`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/snapshot-replications'`; `req.method !== 'GET'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const snapshotReplicationsGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { snapshotReplications } = services;
    if (url.pathname === '/api/snapshot-replications') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, snapshotReplications?.view() || { enabled: false, entries: [] });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.nativeClipboardGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, nativeClipboard.view())` / `send(res, await nativeClipboard.action(await authorizedBody(req, 32768)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, nativeClipboard.view())` / `send(res, await nativeClipboard.action(await authorizedBody(req, 32768)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `services.requireService`, `send`, `nativeClipboard.view`, `nativeClipboard.action` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `send`, `nativeClipboard.view`, `nativeClipboard.action`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, nativeClipboard.view())`; `send(res, await nativeClipboard.action(await authorizedBody(req, 32768)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/native-clipboard'`; `req.method !== 'POST'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const nativeClipboardGetHandler: HttpOperationHandler = async (req, res, url) => {
    const nativeClipboard = services.requireService('nativeClipboard');
    if (url.pathname === '/api/native-clipboard') {
      if (req.method === 'GET') return send(res, nativeClipboard.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      return send(res, await nativeClipboard.action(await authorizedBody(req, 32768)));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.nativeGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await native.view())` / `send(res, await native.action(await authorizedBody(req, 32768)))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, await native.view())` / `send(res, await native.action(await authorizedBody(req, 32768)))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `services.requireService`, `send`, `native.view`, `features.operations.enter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `send`, `native.view`, `features.operations.enter`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await native.view())`; `send(res, await native.action(await authorizedBody(req, 32768)))`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/native-integration'`; `req.method !== 'POST'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
  const nativeGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { features } = services;
    const native = services.requireService('native');
    if (url.pathname === '/api/native-integration') {
      if (req.method === 'GET') return send(res, await native.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await native.action(await authorizedBody(req, 32768)));
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: hostServiceHandlers.assistantGetHandler.
   * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, assistant.view())` / `send(res, await assistant.configure(input.version, input.settings))` 供上层消费（`http-host-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; this entry produces `send(res, assistant.view())` / `send(res, await assistant.configure(input.version, input.settings))` for its caller. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
   * 处理：通过 `services.requireService`, `send`, `assistant.view`, `req.once` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `send`, `assistant.view`, `req.once`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.aborted || res.destroyed`; `input.action === 'preview'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, assistant.view())`; `send(res, await assistant.configure(input.version, input.settings))`; `send(res, assistant.preview(input.input))`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/assistant'`; `req.method !== 'POST'`; `input.action === 'configure'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `req.off('aborted', cancel);`; `res.off('close', cancel);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `req.off('aborted', cancel);`; `res.off('close', cancel);`; these steps also apply to exceptional exits.
   */
  const assistantGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { features } = services;
    const assistant = services.requireService('assistant');
    if (url.pathname === '/api/assistant') {
      if (req.method === 'GET') return send(res, assistant.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const abort = new AbortController();
      /**
       * 入口 / Entry: hostServiceHandlers.cancel.
       * 功能：在处理宿主资源、设备及互操作相关 API中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`http-host-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-host-services.ts`; the calls and state transitions below complete the operation. Module context: Connects host resource, device and interoperation APIs to their owning domain services.
       * 处理：通过 `abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `abort.abort`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!res.writableFinished`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `abort.abort`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cancel = () => {
        if (!res.writableFinished) abort.abort();
      };
      req.once('aborted', cancel);
      res.once('close', cancel);
      if (req.aborted || res.destroyed) cancel();
      try {
        const input = assistantRequest.parse(await authorizedBody(req, 128 * 1024, abort.signal));
        if (input.action === 'configure') {
          const releaseMutation = features.operations.enter();
          try {
            if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
            return send(res, await assistant.configure(input.version, input.settings));
          } finally {
            releaseMutation();
          }
        }
        if (input.action === 'preview') return send(res, assistant.preview(input.input));
        return send(
          res,
          input.action === 'models'
            ? await assistant.models(abort.signal)
            : await assistant.generate(input.previewId, abort.signal),
        );
      } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /** 更新动作沿用请求寿命与维护锁；具体信任与版本验证由本体服务负责。
   * Update actions share request cancellation and the maintenance guard; the core service owns trust and version checks. */
  const trustedUpdatesHandler: HttpOperationHandler = async (req, res, url) => {
    if (url.pathname !== '/api/trusted-updates')
      throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
    const updates = services.requireService('trustedUpdates');
    if (req.method === 'GET') return send(res, await updates.view());
    if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
    const abort = new AbortController();
    const cancel = () => { if (!res.writableFinished) abort.abort(); };
    req.once('aborted', cancel); res.once('close', cancel);
    if (req.aborted || res.destroyed) cancel();
    let release: (() => void) | undefined;
    try {
      release = services.features.operations.enter();
      if (services.features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const input = await authorizedBody(req, 16 * 1024, abort.signal);
      return send(res, await updates.action(input, abort.signal));
    } finally {
      release?.(); req.off('aborted', cancel); res.off('close', cancel);
    }
  };
  return {
    'core.webhooks.get': webhooksGetHandler,
    'core.webhooks.change': webhooksGetHandler,
    'core.automation-rules.get': automationRulesGetHandler,
    'core.automation-rules.change': automationRulesGetHandler,
    'core.feature-rollouts.get': featureRolloutsGetHandler,
    'core.feature-rollouts.change': featureRolloutsGetHandler,
    'core.fleet-policy-rollouts.get': fleetPolicyRolloutsGetHandler,
    'core.fleet-policy-rollouts.change': fleetPolicyRolloutsGetHandler,
    'core.gpu-profiles.get': gpuProfilesGetHandler,
    'core.gpu-profiles.change': gpuProfilesGetHandler,
    'core.build-farm.get': buildFarmGetHandler,
    'core.build-farm.change': buildFarmGetHandler,
    'core.media-devices.get': mediaDevicesGetHandler,
    'core.media-devices.change': mediaDevicesGetHandler,
    'core.memory-reclaim.get': memoryReclaimGetHandler,
    'core.memory-reclaim.change': memoryReclaimGetHandler,
    'core.host-mount.get': hostMountGetHandler,
    'core.host-mount.change': hostMountGetHandler,
    'core.virtioFs.get': virtioFsGetHandler,
    'core.virtioFs.change': virtioFsGetHandler,
    'core.trustedBoot.get': trustedBootGetHandler,
    'core.trustedBoot.change': trustedBootGetHandler,
    'core.host-peers.get': hostPeersGetHandler,
    'core.host-peers.change': hostPeersGetHandler,
    'core.cold-migrations.get': coldMigrationsGetHandler,
    'core.snapshot-replications.get': snapshotReplicationsGetHandler,
    'core.native-clipboard.get': nativeClipboardGetHandler,
    'core.native-clipboard.action': nativeClipboardGetHandler,
    'core.native.get': nativeGetHandler,
    'core.native.action': nativeGetHandler,
    'core.assistant.get': assistantGetHandler,
    'core.assistant.action': assistantGetHandler,
    'core.trusted-updates.get': trustedUpdatesHandler,
    'core.trusted-updates.action': trustedUpdatesHandler,
  };
}
