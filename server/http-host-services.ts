import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import { assistantRequest } from './local-assistant.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

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
    | 'requireService'
  >,
): CoreHttpHandlers {
  const { services, authorizedBody } = context;
  const webhooksGetHandler: HttpOperationHandler = async (req, res, url) => {
    const webhooks = services.requireService('webhooks');
    if (url.pathname === '/api/webhooks') {
      if (req.method === 'GET') return send(res, webhooks.view());
      if (req.method === 'POST') return send(res, await webhooks.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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
  const gpuProfilesGetHandler: HttpOperationHandler = async (req, res, url) => {
    const gpuProfiles = services.requireService('gpuProfiles');
    if (url.pathname === '/api/gpu-profiles') {
      if (req.method === 'GET') return send(res, await gpuProfiles.view());
      if (req.method === 'POST') return send(res, await gpuProfiles.action(await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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
  const coldMigrationsGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { coldMigrations } = services;
    if (url.pathname === '/api/cold-migrations') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, coldMigrations?.view() || { enabled: false, entries: [] });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const snapshotReplicationsGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { snapshotReplications } = services;
    if (url.pathname === '/api/snapshot-replications') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, snapshotReplications?.view() || { enabled: false, entries: [] });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const nativeClipboardGetHandler: HttpOperationHandler = async (req, res, url) => {
    const nativeClipboard = services.requireService('nativeClipboard');
    if (url.pathname === '/api/native-clipboard') {
      if (req.method === 'GET') return send(res, nativeClipboard.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      return send(res, await nativeClipboard.action(await authorizedBody(req, 32768)));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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
  const assistantGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { features } = services;
    const assistant = services.requireService('assistant');
    if (url.pathname === '/api/assistant') {
      if (req.method === 'GET') return send(res, assistant.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const abort = new AbortController();
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
  };
}
