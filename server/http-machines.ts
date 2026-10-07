/**
 * 模块职责：封装实例 API 请求上下文，将实例操作绑定到统一操作网关。
 * Module purpose: Builds VM API request context and binds VM actions to the common operation gateway.
 */
import type { UsbHotplugV1 } from './service-contracts/v1.ts';
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

import type { ProjectPermissions } from './project-permissions.ts';
import { guestExecutionInput, type ProjectExecution } from './project-execution.ts';
import { storagePoolInput } from './storage-pools.ts';
import { requestScope } from './operation-scope.ts';
import { captureOperationCheck } from './operation-context.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { sendJson as send } from './http-response.ts';
import { APP_VERSION } from '../shared/version.ts';

export type MachineApiContext = {
  machines: Machines;
  features: Pick<Features, 'enabled' | 'validateConfig'>;
  /**
   * 签名 / Signature: MachineApiContext.pluginRuntime.
   * 功能：为封装实例 API 请求上下文声明 pluginRuntime 的输入与结果契约，所属容器为 MachineApiContext。
   * Purpose: Declares the input/result contract for pluginRuntime in MachineApiContext. Module responsibility: Builds VM API request context and binds VM actions to the common operation gateway.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ReturnType<Features['directory']['view']>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  pluginRuntime?: () => ReturnType<Features['directory']['view']>;
  engine: Engine;
  session: Pick<SessionLock, 'view'>;
  usbHotplug: UsbHotplugV1;
  projectPermissions: Pick<ProjectPermissions, 'revokeVm'>;
  projectExecution: Pick<ProjectExecution, 'run'>;
  /**
   * 签名 / Signature: MachineApiContext.authorizedBody.
   * 功能：为封装实例 API 请求上下文声明 authorizedBody 的输入与结果契约，所属容器为 MachineApiContext。
   * Purpose: Declares the input/result contract for authorizedBody in MachineApiContext. Module responsibility: Builds VM API request context and binds VM actions to the common operation gateway.
   * 输入 / Inputs: req: IncomingMessage; limit: number optional; signal: AbortSignal optional
   * 输出 / Returns: Promise<any>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  authorizedBody: (req: IncomingMessage, limit?: number, signal?: AbortSignal) => Promise<any>;
};
/** Production dispatch inherits the gateway authority; standalone callers retain their own gate. */
/**
 * 入口 / Entry: createMachineApi.
 * 功能：提供实例 API 上下文与声明操作的分派函数，连接实例生命周期和配置动作。
 * Purpose: Provides VM API context and declared dispatch for lifecycle/configuration actions.
 * 设计：参数解析、实例查找和授权分层进行；方法及操作声明不符时返回协议错误，实际资源变更由 VM 管理器持锁执行。
 * Design: Parsing, lookup and authority are layered; mismatched methods/declarations fail while the manager owns locked resource mutations.
 * 输入 / Inputs: context: MachineApiContext
 * 输出 / Returns: `async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => { await captureOperationCheck()(); const rou…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
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
  /**
   * 入口 / Entry: createMachineApi.callback@49.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; url: URL
   * 输出 / Returns: Promise<boolean>；结果来自 / values from `send(res, { name: 'Sakura', version: APP_VERSION, engine: engine.version, posixloom: '0.1.0', nativeHost: Boolean(engine.runt…`; `send(res, await machines.storagePools.view())`; `send( res, await machines.storagePools.run( undefined, storagePoolInput.parse(await authorizedBody(req)), 'run', ), )`.
   * 副作用 / Effects: `send`; `machines.create`; `machines.update`; `machines.delete`; `machines.start`.
   * 拒绝 / Refusals: 条件 / conditions `route[1] === 'vms' && route[2]`; `route.length === 4 && route[3] === 'usb-hotplug'`; 异常 / errors `new AppError('不支持此方法', 405)`.
   * 收尾：退出 try 区域时始终执行 `operation.dispose();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `operation.dispose();`; these steps also apply to exceptional exits.
   */
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    await captureOperationCheck()();
    const route = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && url.pathname === '/api/system')
      return send(res, {
        name: 'Sakura',
        version: APP_VERSION,
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
            await withResourceContext(
              {
                projectId:
                  input.scope === 'instance' ? '@instance' : url.searchParams.get('project') || undefined,
              },
              () => projectExecution.run(id, input, url.searchParams.get('project'), abort.signal),
            ),
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
