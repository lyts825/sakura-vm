import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { hostname, cpus, totalmem, freemem } from 'node:os';
import { z } from 'zod';
import { IMAGE } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import type { Machines } from './machines.ts';
import type { Features } from './features.ts';
import type { Engine } from './runtime.ts';
import type { SessionLock } from './session-lock.ts';
import type { UsbHotplug } from './usb-hotplug.ts';
import type { ProjectPermissions } from './project-permissions.ts';
import { guestExecutionInput, type ProjectExecution } from './project-execution.ts';
import { storagePoolInput } from './storage-pools.ts';
import { requestScope } from './operation-scope.ts';
import { captureOperationCheck } from './operation-context.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { sendJson as send } from './http-response.ts';

export type MachineApiContext = {
  machines: Machines;
  features: Pick<Features, 'enabled' | 'validateConfig'>;
  pluginRuntime?: () => ReturnType<Features['directory']['view']>;
  engine: Engine;
  session: Pick<SessionLock, 'view'>;
  usbHotplug: UsbHotplug;
  projectPermissions: Pick<ProjectPermissions, 'revokeVm'>;
  projectExecution: Pick<ProjectExecution, 'run'>;
  authorizedBody: (req: IncomingMessage, limit?: number, signal?: AbortSignal) => Promise<any>;
};
/** Production dispatch inherits the gateway authority; standalone callers retain their own gate. */
export function createMachineApi(context: MachineApiContext) {
  const {
    machines,
    features,
    engine,
    session,
    usbHotplug,
    projectPermissions,
    projectExecution,
    authorizedBody,
  } = context;
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    await captureOperationCheck()();
    const route = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && url.pathname === '/api/system')
      return send(res, {
        name: 'Sakura',
        version: '0.1.0',
        engine: engine.version,
        posixloom: '0.1.0',
        nativeHost: Boolean(engine.runtime.findNativeHost()),
        hostname: hostname(),
        platform: process.platform,
        hostCpus: cpus().length,
        hostMemoryMiB: Math.round(totalmem() / 1048576),
        freeMemoryMiB: Math.round(freemem() / 1048576),
        controllerMemoryMiB: Math.round(process.memoryUsage().rss / 1048576),
        imageReady: existsSync(IMAGE),
        imageBytes: (await stat(IMAGE).catch(() => null))?.size || 0,
        plugins: [...features.enabled],
        pluginRuntime: context.pluginRuntime?.(),
        session: session.view(),
      });
    if (route[1] === 'storage-pools' && route.length === 2) {
      if (req.method === 'GET') return send(res, await machines.storagePools.view());
      if (req.method === 'POST')
        return send(
          res,
          await machines.storagePools.run(
            undefined,
            storagePoolInput.parse(await authorizedBody(req)),
            'run',
          ),
        );
    }
    if (route[1] === 'vms' && route.length === 2) {
      if (req.method === 'GET') return send(res, await machines.list());
      if (req.method === 'POST') {
        const input = await authorizedBody(req);
        features.validateConfig(input);
        return send(res, await machines.create(input), 201);
      }
    }
    if (route[1] === 'vms' && route[2]) {
      const id = route[2];
      machines.get(id);
      if (route.length === 4 && route[3] === 'usb-hotplug') {
        if (req.method === 'GET') return send(res, await usbHotplug.view(id));
        if (req.method === 'POST')
          return send(res, await usbHotplug.action(id, await authorizedBody(req, 4096)));
        throw new AppError('不支持此方法', 405);
      }
      if (route.length === 3) {
        if (req.method === 'GET') return send(res, await machines.view(id));
        if (req.method === 'PATCH') {
          const input = await authorizedBody(req);
          features.validateConfig(input, machines.get(id));
          return send(res, await machines.update(id, input));
        }
        if (req.method === 'DELETE') {
          await machines.delete(id);
          await projectPermissions.revokeVm(id);
          return send(res, { ok: true });
        }
      }
      if (req.method === 'POST' && route.length === 4 && route[3] === 'start')
        return send(res, await machines.start(id));
      if (req.method === 'POST' && route.length === 4 && route[3] === 'stop') {
        const options = z
          .object({ force: z.boolean().default(false) })
          .strict()
          .parse(await authorizedBody(req));
        return send(res, await machines.stop(id, options.force));
      }
      if (req.method === 'POST' && route.length === 4 && route[3] === 'exec') {
        const operation = requestScope(req, res),
          abort = operation.controller;
        try {
          const input = guestExecutionInput.parse(await authorizedBody(req, 512 * 1024, abort.signal));
          return send(
            res,
            await withResourceContext({ projectId: input.scope === 'instance' ? '@instance' :
              url.searchParams.get('project') || undefined }, () =>
              projectExecution.run(id, input, url.searchParams.get('project'), abort.signal)),
          );
        } finally {
          operation.dispose();
        }
      }
      if (req.method === 'GET' && route.length === 4 && route[3] === 'logs')
        return send(res, { content: machines.logs.get(id) || '' });
    }
    return false;
  };
}
