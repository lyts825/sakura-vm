/**
 * 模块职责（中文）：“磁盘快照”插件服务端入口。激活时装配 SignedBundles、Bundles、GoldenImages、Rescue、SnapshotDiff、SnapshotMerge，并处理声明的服务端操作。
 * Module responsibility (English): service composition for snapshots, clones, rescue, golden images and signed bundles, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, operations, route, httpHandlers, responseContracts；职责覆盖装配快照、克隆、救援、黄金镜像和签名包的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, operations, route, httpHandlers, responseContracts. The scope covers service composition for snapshots, clones, rescue, golden images and signed bundles, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as transfersServices } from '../transfers/services.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { requestHasBody } from '../../server/http.ts';
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as snapshotsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';

import { importEncrypted } from '../../server/encrypted-backups.ts';
import { Bundles } from '../../server/bundles.ts';
import { GoldenImages } from '../../server/golden-images.ts';
import { goldenActionSchema } from '../../shared/golden-images.ts';
import { Rescue } from '../../server/rescue.ts';
import { SnapshotDiff } from '../../server/snapshot-diff.ts';
import { SnapshotMerge } from '../../server/snapshot-merge.ts';
import { snapshotMergeInputSchema } from '../../shared/snapshot-merge.ts';
import { snapshotDiffInputSchema } from '../../shared/snapshot-diff.ts';
import { SignedBundles, signedBundleActionSchema } from '../../server/signed-bundles.ts';
import { rescueRunSchema } from '../../shared/rescue.ts';

/**
 * 中文：在本次插件激活中构造 SignedBundles、Bundles、GoldenImages、Rescue、SnapshotDiff、SnapshotMerge，发布 snapshotsServices.signedBundles、snapshotsServices.bundles、snapshotsServices.goldenImages、snapshotsServices.rescue、snapshotsServices.snapshotDiff、snapshotsServices.snapshotMerge 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct SignedBundles, Bundles, GoldenImages, Rescue, SnapshotDiff, SnapshotMerge within this activation and publish snapshotsServices.signedBundles, snapshotsServices.bundles, snapshotsServices.goldenImages, snapshotsServices.rescue, snapshotsServices.snapshotDiff, snapshotsServices.snapshotMerge service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const signatures = host.provide(snapshotsServices.signedBundles, new SignedBundles(host.capabilities.metadata.reference('signed-bundles')));
  await signatures.init();
  host.provide(snapshotsServices.bundles, new Bundles(host.vm, signatures, host.system));
  const golden = host.provide(snapshotsServices.goldenImages, new GoldenImages(host.vm, host.use(snapshotsServices.bundles)));
  // 这些操作包含镜像、快照、分支或命令输入；重试入口要求回原界面复核，避免自动重放旧决策。
  host.registerJobs(golden.jobs, () => {
    throw new AppError('请先刷新黄金镜像库核对结果，再明确发起操作', 409);
  });
  const rescue = host.provide(snapshotsServices.rescue, new Rescue(host.vm));
  await rescue.init();
  host.registerJobs(rescue.jobs, () => {
    throw new AppError('请在快照页检查救援命令后重新执行', 409);
  });
  const snapshotDiff = host.provide(snapshotsServices.snapshotDiff, new SnapshotDiff(host.vm));
  host.registerJobs(snapshotDiff.jobs, () => {
    throw new AppError('请在快照页选择快照后重新比较', 409);
  });
  const snapshotMerge = host.provide(snapshotsServices.snapshotMerge, new SnapshotMerge(host.vm, host.use(snapshotsServices.bundles)));
  host.registerJobs(snapshotMerge.jobs, () => {
    throw new AppError('请在快照页核对分支和目标后重新合并', 409);
  });
}
export const operations: Record<string, PluginOperation> = {
  'snapshot-merge-view': {
    response: pluginRouteResponses["snapshots.snapshot-merge-view"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.snapshotMerge).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.snapshotMerge).view; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(snapshotsServices.snapshotMerge).view(url.pathname.split('/')[3]);
    },
  },
  'snapshot-merge-run': {
    request: snapshotMergeInputSchema,
    response: pluginRouteResponses["snapshots.snapshot-merge-run"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.snapshotMerge).run；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.snapshotMerge).run; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      return this.use(snapshotsServices.snapshotMerge).run(url.pathname.split('/')[3], input);
    },
  },
  'snapshot-diff-view': {
    response: pluginRouteResponses["snapshots.snapshot-diff-view"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.snapshotDiff).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.snapshotDiff).view; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(snapshotsServices.snapshotDiff).view(url.pathname.split('/')[3]);
    },
  },
  'snapshot-diff-run': {
    request: snapshotDiffInputSchema,
    response: pluginRouteResponses["snapshots.snapshot-diff-run"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.snapshotDiff).run；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.snapshotDiff).run; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      return this.use(snapshotsServices.snapshotDiff).run(url.pathname.split('/')[3], input);
    },
  },
  'signed-bundles-view': {
    response: pluginRouteResponses["snapshots.signed-bundles-view"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.signedBundles).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.signedBundles).view; deliver progress/failure through the existing job-service contract
     */
    execute() {
      return this.use(snapshotsServices.signedBundles).view();
    },
  },
  'signed-bundles-action': {
    request: signedBundleActionSchema,
    response: pluginRouteResponses["snapshots.signed-bundles-action"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.signedBundles).action；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.signedBundles).action; deliver progress/failure through the existing job-service contract
     * 中文：输入：_url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: _url: the invocation value for this handler; input: input data requiring validation
     */
    execute(_url, input) {
      return this.use(snapshotsServices.signedBundles).action(input);
    },
  },
  'rescue-view': {
    response: pluginRouteResponses["snapshots.rescue-view"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.rescue).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.rescue).view; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(snapshotsServices.rescue).view(url.pathname.split('/')[3]);
    },
  },
  'rescue-artifact': {
    response: pluginRouteResponses["snapshots.rescue-artifact"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.rescue).artifact；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.rescue).artifact; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(snapshotsServices.rescue).artifact(
        url.pathname.split('/')[3],
        z.uuid().parse(url.searchParams.get('run')),
        z.uuid().parse(url.searchParams.get('artifact')),
      );
    },
  },
  'rescue-run': {
    request: rescueRunSchema,
    response: pluginRouteResponses["snapshots.rescue-run"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.rescue).run；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.rescue).run; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      return this.use(snapshotsServices.rescue).run(url.pathname.split('/')[3], input);
    },
  },
  'golden-list': {
    response: pluginRouteResponses["snapshots.golden-list"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.goldenImages).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.goldenImages).view; deliver progress/failure through the existing job-service contract
     */
    execute() {
      return this.use(snapshotsServices.goldenImages).view();
    },
  },
  'golden-action': {
    request: goldenActionSchema,
    response: pluginRouteResponses["snapshots.golden-action"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(snapshotsServices.goldenImages).action；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(snapshotsServices.goldenImages).action; deliver progress/failure through the existing job-service contract
     * 中文：输入：_url：此处理器的调用值；input：尚待校验的输入数据；signal：本次调用的取消寿命
     * English: Inputs: _url: the invocation value for this handler; input: input data requiring validation; signal: cancellation lifetime for this invocation
     */
    execute(_url, input, signal) {
      return this.use(snapshotsServices.goldenImages).action(input, signal);
    },
  },
};
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      、httpRouteRequests["snapshots.legacy.post.vms.vmId.snapshots"]
      、httpRouteRequests["snapshots.legacy.post.vms.vmId.snapshots.snapshotId.restore"]
          、httpRouteRequests["snapshots.legacy.patch.vms.vmId.snapshots.snapshotId"]
            、httpRouteRequests["snapshots.legacy.post.vms.vmId.clone"]
         等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      , httpRouteRequests["snapshots.legacy.post.vms.vmId.snapshots"]
      , httpRouteRequests["snapshots.legacy.post.vms.vmId.snapshots.snapshotId.restore"]
          , httpRouteRequests["snapshots.legacy.patch.vms.vmId.snapshots.snapshotId"]
            , httpRouteRequests["snapshots.legacy.post.vms.vmId.clone"]
        . Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：另一个导入仍在进行；整机状态快照要求运行中的实例。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 另一个导入仍在进行; 整机状态快照要求运行中的实例. These errors reach the direct caller or this function's catch handler
 */
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: /** 中文：异步读取请求正文供路由 Schema 校验，不预先假设输入类型；这是 route 的调用契约 | English: Asynchronously read request data for route-schema validation without assuming an input type; this is the callable contract of route | 中文：输入：req：签名所示 IncomingMessage 业务值；signal：本次调用的取消寿命 | English: Inputs: req: the IncomingMessage domain value in the signature; signal: cancellation lifetime for this invocation | 中文：结果：Promise<any>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<any>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (req: IncomingMessage, signal?: AbortSignal) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  /**
   * 中文：把服务结果按当前操作响应描述写入 HTTP 输出，并返回 true 标记本路由已认领请求
   * English: Write service results through the current operation response description and return true to mark the request claimed
   * 中文：输入：data：签名所示 unknown 业务值；status：此处理器的调用值（缺省 200）
   * English: Inputs: data: the unknown domain value in the signature; status: the invocation value for this handler (default 200)
   */
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] === 'import' && parts.length === 2 && req.method === 'POST') {
    if (this.activity.importing) throw new AppError('另一个导入仍在进行', 409);
    const name = z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .parse(url.searchParams.get('name'));
    await this.activity.exclusive('import', /** 中文：在装配快照、克隆、救援、黄金镜像和签名包的服务，发布清单中声明的操作并随插件关闭清理流程中向活动传输交付数据；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In service composition for snapshots, clones, rescue, golden images and signed bundles, publication of declared operations and lifecycle cleanup, deliver data to an active transport. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：加密密码格式错误。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 加密密码格式错误. These errors reach the direct caller or this function's catch handler */ async () => {
      const passphrase = req.headers['x-sakura-passphrase'];
      if (passphrase !== undefined) this.require('backups');
      if (passphrase !== undefined && (typeof passphrase !== 'string' || passphrase.length > 6000))
        throw new AppError('加密密码格式错误');
      send(
        passphrase
          ? await importEncrypted(
              this.use(snapshotsServices.bundles),
              name,
              req,
              Buffer.from(passphrase, 'base64').toString('utf8'),
              signal,
            )
          : await this.use(snapshotsServices.bundles).importExternal(name, req, signal),
        201,
      );
    });
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (req.method === 'POST' && parts[3] === 'snapshots' && parts.length === 4) {
    const { name, online, memory } = httpRouteRequests["snapshots.legacy.post.vms.vmId.snapshots"]
      .parse(await body(req, signal));
    if (memory && !online) throw new AppError('整机状态快照要求运行中的实例', 409);
    return send(await (memory ? this.vm.memorySnapshot(id, name)
      : online ? this.vm.onlineSnapshot(id, name) : this.vm.snapshot(id, name)), 201);
  }
  if (
    req.method === 'POST' &&
    parts.length === 6 &&
    parts[3] === 'snapshots' &&
    parts[4] &&
    parts[5] === 'restore'
  ) {
    const input = requestHasBody(req)
      ? httpRouteRequests["snapshots.legacy.post.vms.vmId.snapshots.snapshotId.restore"]
          .parse(await body(req, signal))
      : { backup: false };
    return send(await (input.memory ? this.vm.restoreMemory(id, parts[4], input.backup)
      : this.vm.restore(id, parts[4], input.backup)));
  }
  if (action === 'snapshots' && parts[4] && parts.length === 5) {
    if (req.method === 'DELETE') {
      send(await this.vm.editSnapshot(id, parts[4], null));
      return true;
    }
    if (req.method === 'PATCH') {
      send(
        await this.vm.editSnapshot(
          id,
          parts[4],
          httpRouteRequests["snapshots.legacy.patch.vms.vmId.snapshots.snapshotId"]
            .parse(await body(req, signal)),
        ),
      );
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'export' && req.method === 'GET') {
      await this.use(transfersServices.downloads).send({ id, type: 'export', name: this.vm.get(id).name + '.sakura' }, res);
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'clone' && req.method === 'POST') {
      const { name, snapshot } = httpRouteRequests["snapshots.legacy.post.vms.vmId.clone"]
        .parse(await body(req, signal));
      send(await this.use(snapshotsServices.bundles).clone(id, name, snapshot, signal), 201);
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.post.import": route,
  "legacy.post.vms.vmId.snapshots": route,
  "legacy.patch.vms.vmId.snapshots.snapshotId": route,
  "legacy.delete.vms.vmId.snapshots.snapshotId": route,
  "legacy.post.vms.vmId.snapshots.snapshotId.restore": route,
  "legacy.get.vms.vmId.export": route,
  "legacy.post.vms.vmId.clone": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("snapshots");
