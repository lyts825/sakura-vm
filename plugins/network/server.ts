/**
 * 模块职责（中文）：“网络管理”插件服务端入口。激活时装配 NetworkProfiles、IngressCertificates、HttpIngress、LocalAliases、Set，并处理声明的服务端操作。
 * Module responsibility (English): service composition for ports, network profiles, ingress and certificates, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, operations, route, httpHandlers, responseContracts；职责覆盖装配端口、网络档案、入口与证书的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, operations, route, httpHandlers, responseContracts. The scope covers service composition for ports, network profiles, ingress and certificates, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as networkServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation, PluginRoute } from '../../server/plugin-api.ts';

import { AppError } from '../../shared/errors.ts';

import { NetworkProfiles } from '../../server/network-profiles.ts';
import { HttpIngress } from '../../server/http-ingress.ts';
import { ingressActionSchema } from '../../shared/http-ingress.ts';
import { IngressCertificates } from '../../server/ingress-certificates.ts';
import { certificateActionSchema } from '../../shared/ingress-certificates.ts';
import { LocalAliases } from '../../server/local-aliases.ts';
import { localAliasActionSchema } from '../../shared/local-aliases.ts';

/**
 * 中文：在本次插件激活中构造 NetworkProfiles、IngressCertificates、HttpIngress、LocalAliases，发布 networkServices.network、networkServices.certificates、networkServices.ingress、networkServices.localAliases 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct NetworkProfiles, IngressCertificates, HttpIngress, LocalAliases within this activation and publish networkServices.network, networkServices.certificates, networkServices.ingress, networkServices.localAliases service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(networkServices.network, new NetworkProfiles(m));
  const certificates = host.provide(networkServices.certificates, new IngressCertificates(host.capabilities.metadata.reference('certificates')));
  await host.capabilities.metadata.run('certificates', async () => certificates.init());
  // 证书初始化先完成，再恢复入口和本地别名；入口加载依赖可用的证书及其元数据能力。
  const ingress = host.provide(networkServices.ingress, new HttpIngress(m, host.capabilities.metadata.reference('ingress'), certificates, host.networking));
  await ingress.init();
  await host.provide(networkServices.localAliases, new LocalAliases(() => host.use(networkServices.ingress).aliasNames(),
    undefined, host.capabilities.metadata.reference('local-aliases'))).init();
  host.registerJobs(host.use(networkServices.network).jobs, () => {
    throw new AppError('请在网络配置中重新测试当前设置');
  });
}
export const operations: Record<string, PluginOperation> = {
  'ingress-certificate-view': {
    response: pluginRouteResponses["network.ingress-certificate-view"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(networkServices.certificates).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(networkServices.certificates).view; deliver progress/failure through the existing job-service contract
     */
    execute() {
      return this.use(networkServices.certificates).view();
    },
  },
  'ingress-certificate-action': {
    request: certificateActionSchema,
    response: pluginRouteResponses["network.ingress-certificate-action"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.capabilities.metadata.run；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.capabilities.metadata.run; deliver progress/failure through the existing job-service contract
     * 中文：输入：_url：此处理器的调用值；input：尚待校验的输入数据；signal：本次调用的取消寿命
     * English: Inputs: _url: the invocation value for this handler; input: input data requiring validation; signal: cancellation lifetime for this invocation
     */
    execute(_url, input, signal) {
      return this.capabilities.metadata.run('certificates',
      async () => this.use(networkServices.certificates).action(input));
    },
  },
  'ingress-view': {
    response: pluginRouteResponses["network.ingress-view"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(networkServices.ingress).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(networkServices.ingress).view; deliver progress/failure through the existing job-service contract
     */
    execute() {
      return this.use(networkServices.ingress).view();
    },
  },
  'ingress-action': {
    request: ingressActionSchema,
    response: pluginRouteResponses["network.ingress-action"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(networkServices.ingress).action；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(networkServices.ingress).action; deliver progress/failure through the existing job-service contract
     * 中文：输入：_url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: _url: the invocation value for this handler; input: input data requiring validation
     */
    async execute(_url, input) {
      const view = await this.use(networkServices.ingress).action(input);
      await this.use(networkServices.localAliases).refresh();
      return view;
    },
  },
  'local-aliases-view': {
    response: pluginRouteResponses["network.local-aliases-view"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(networkServices.localAliases).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(networkServices.localAliases).view; deliver progress/failure through the existing job-service contract
     */
    execute() {
      return this.use(networkServices.localAliases).view();
    },
  },
  'local-aliases-action': {
    request: localAliasActionSchema,
    response: pluginRouteResponses["network.local-aliases-action"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(networkServices.localAliases).action；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(networkServices.localAliases).action; deliver progress/failure through the existing job-service contract
     * 中文：输入：_url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: _url: the invocation value for this handler; input: input data requiring validation
     */
    execute(_url, input) {
      return this.use(networkServices.localAliases).action(input);
    },
  },
};
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["network.legacy.delete.network-profiles"]
        、httpRouteRequests["network.legacy.post.vms.vmId.network"]
          、httpRouteRequests["network.legacy.patch.vms.vmId.services"]
           等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["network.legacy.delete.network-profiles"]
        , httpRouteRequests["network.legacy.post.vms.vmId.network"]
          , httpRouteRequests["network.legacy.patch.vms.vmId.services"]
          . Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：无法读取客户机监听端口。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 无法读取客户机监听端口. These errors reach the direct caller or this function's catch handler
 */
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Parameters<PluginRoute>[3],
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
  if (parts[1] === 'network-profiles') {
    if (parts.length === 2 && req.method === 'GET') return send(await this.use(networkServices.network).profiles());
    if (parts.length === 2 && req.method === 'POST')
      return send(await this.use(networkServices.network).saveProfile(await body(req, signal)));
    if (parts.length === 2 && req.method === 'DELETE') {
      const { id } = httpRouteRequests["network.legacy.delete.network-profiles"]
        .parse(await body(req, signal));
      return send(await this.use(networkServices.network).removeProfile(id));
    }
    return false;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'network') {
      if (req.method === 'GET') {
        send({ ...(await this.use(networkServices.network).state(id)), job: this.use(networkServices.network).jobs.view(id) });
        return true;
      }
      if (req.method === 'POST') {
        const input = httpRouteRequests["network.legacy.post.vms.vmId.network"]
          .parse(await body(req, signal));
        send(
          input.action === 'preview'
            ? await this.use(networkServices.network).preview(id, input.config, signal)
            : input.action === 'apply'
              ? await this.use(networkServices.network).apply(id, input.config, input.token || '')
              : input.action === 'restore'
                ? await this.use(networkServices.network).restore(id)
                : this.use(networkServices.network).test(id, input.config),
        );
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'services') {
      if (req.method === 'PATCH') {
        const { forwards } = httpRouteRequests["network.legacy.patch.vms.vmId.services"]
          .parse(await body(req, signal));
        send(await this.vm.setForwards(id, forwards));
        return true;
      }
      if (req.method === 'GET') {
        let listening = new Set<number>();
        if (this.vm.state(id) === 'running') {
          const result = await this.vm.exec(id, 'cat /proc/net/tcp /proc/net/tcp6', 10000);
          if (result.code !== 0) throw new AppError('无法读取客户机监听端口');
          listening = new Set(
            result.stdout
              .split('\n')
              .map((line) => line.trim().split(/\s+/))
              .filter((columns) => columns[3] === '0A')
              .map((columns) => parseInt(columns[1].split(':').at(-1)!, 16)),
          );
        }
        send({
          forwards: this.vm.get(id).forwards.map((p) => ({ ...p, listening: listening.has(p.guest) })),
          listening: [...listening],
        });
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.network-profiles": route,
  "legacy.post.network-profiles": route,
  "legacy.delete.network-profiles": route,
  "legacy.get.vms.vmId.network": route,
  "legacy.post.vms.vmId.network": route,
  "legacy.get.vms.vmId.services": route,
  "legacy.patch.vms.vmId.services": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("network");
