/**
 * 模块职责（中文）：按插件声明懒加载页面、标签与开发分区，并按插件生命周期缓存 React 组件。
 * Module responsibility (English): Caching and lazily loading plugin UI contributions by authority lifetime.
 * 详细范围（中文）：公开入口包括 PluginPageProps, PluginTabProps, embeddedPluginComponent, PluginTab, PluginPage, PluginDevelopmentSection；职责覆盖按权限寿命缓存和懒加载插件界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PluginPageProps, PluginTabProps, embeddedPluginComponent, PluginTab, PluginPage, PluginDevelopmentSection. The scope covers Caching and lazily loading plugin UI contributions by authority lifetime. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { lazy, Suspense, type ComponentType } from 'react';
import type { VMView } from '../shared/contracts/vm.ts';
import { PLUGINS } from '../shared/plugins';
import type { FeatureProps, Request } from './feature-shared';
import { PluginBoundary } from './plugin-boundary';

export type PluginPageProps = {
  request: Request;
  vms: VMView[];
  selected: string;
  refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 PluginPageProps 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of PluginPageProps | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>;
  token: string;
  onSelected: /** 中文：通知当前实例选择变化，由外层同步项目与导航；这是 PluginPageProps 的调用契约 | English: Notify VM selection changes so the owner synchronizes project/navigation state; this is the callable contract of PluginPageProps | 中文：输入：id：目标资源标识 | English: Inputs: id: target resource identifier | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (id: string) => void;
  onCreate: /** 中文：请求打开新实例创建入口，由外层管理表单寿命；这是 PluginPageProps 的调用契约 | English: Request the new-VM creation entry whose form lifetime is owned externally; this is the callable contract of PluginPageProps | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
  projectId?: string;
};
export type PluginTabProps = FeatureProps & {
  start: /** 中文：请求启动客户机，兑现后由外层更新状态；这是 PluginTabProps 的调用契约 | English: Request guest startup, allowing the owner to update state after fulfillment; this is the callable contract of PluginTabProps | 中文：结果：unknown；调用者依赖此类型约定 | English: Result: unknown; callers depend on this type contract */ () => unknown;
  busy: boolean;
  configure: /** 中文：请求跳转到实例配置界面；这是 PluginTabProps 的调用契约 | English: Request navigation to VM configuration; this is the callable contract of PluginTabProps | 中文：结果：unknown；调用者依赖此类型约定 | English: Result: unknown; callers depend on this type contract */ () => unknown;
  openFile?: { path: string; revision: number; directory?: boolean };
};
type ClientProps = {
  tabs: PluginTabProps;
  pages: PluginPageProps;
  developmentSections: FeatureProps;
};
type ClientModule = { [Kind in keyof ClientProps]?: Record<string, ComponentType<ClientProps[Kind]>> };
const entries = import.meta.glob<ClientModule>('../plugins/*/client.tsx');
const components = new Map<string, { lifetime: string; value: ComponentType<any> }>();

// 缓存既看界面贡献标识也看寿命；同一寿命保持组件引用稳定，换代/重试才新建 lazy 对象。
/**
 * 中文：同一贡献与寿命复用组件引用，换代或重试才创建新的 React.lazy；这是清除 lazy 缓存失败并避免正常渲染丢失组件状态的共同边界。
 * English: Reuse component references for the same contribution/lifetime and create new React.lazy objects only for new generations or retries. This clears cached lazy failures without losing component state on normal renders.
 * 中文：输入：key：签名所示 string 业务值；lifetime：签名所示 string 业务值；load：签名所示 () => Promise<{ default: ComponentType<Props> }> 业务值
 * English: Inputs: key: the string domain value in the signature; lifetime: the string domain value in the signature; load: the () => Promise<{ default: ComponentType<Props> }> domain value in the signature
 * 中文：结果：ComponentType<Props>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: ComponentType<Props> carrying the described computation/transport result; throwing branches do not provide success
 */
function cachedComponent<Props extends object>(key: string, lifetime: string,
  load: /** 中文：懒加载组件模块并交付 React.lazy 所需默认组件；这是 cachedComponent 的调用契约 | English: Lazily load a component module and deliver the default component required by React.lazy; this is the callable contract of cachedComponent | 中文：结果：Promise<{ default: ComponentType<Props> }>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<{ default: ComponentType<Props> }>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<{ default: ComponentType<Props> }>): ComponentType<Props> {
  const cached = components.get(key);
  let value = cached?.lifetime === lifetime ? cached.value : undefined;
  if (!value) {
    value = lazy(load);
    components.set(key, { lifetime, value });
  }
  return value;
}

/** React.lazy caches rejected imports; a boundary retry needs a fresh lazy object. */
/**
 * 中文：按嵌入组件加载器缓存 lazy 包装，复用同一加载入口并保持插件错误边界可恢复。
 * English: Cache lazy wrappers by embedded component loader, reusing the loader while keeping plugin boundary recovery available.
 * 中文：输入：owner：签名所示 string 业务值；id：目标资源标识；lifetime：签名所示 string 业务值；load：签名所示 () => Promise<{ default: ComponentType<Props> }> 业务值
 * English: Inputs: owner: the string domain value in the signature; id: target resource identifier; lifetime: the string domain value in the signature; load: the () => Promise<{ default: ComponentType<Props> }> domain value in the signature
 * 中文：结果：ComponentType<Props>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: ComponentType<Props> carrying the described computation/transport result; throwing branches do not provide success
 */
export function embeddedPluginComponent<Props extends object>(owner: string, id: string, lifetime: string,
  load: /** 中文：懒加载组件模块并交付 React.lazy 所需默认组件；这是 embeddedPluginComponent 的调用契约 | English: Lazily load a component module and deliver the default component required by React.lazy; this is the callable contract of embeddedPluginComponent | 中文：结果：Promise<{ default: ComponentType<Props> }>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<{ default: ComponentType<Props> }>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<{ default: ComponentType<Props> }>): ComponentType<Props> {
  return cachedComponent(`${owner}:embedded:${id}`, lifetime, load);
}

/**
 * 中文：从插件运行时贡献选择对应模块与导出组件，缺失贡献或不匹配导出走不可用反馈，交给权限寿命缓存隔离。
 * English: Choose the module/export for the plugin runtime contribution; missing or mismatched exports produce unavailable feedback and remain isolated by the authority-lifetime cache.
 * 中文：输入：owner：签名所示 string 业务值；kind：签名所示 Kind 业务值；id：目标资源标识；lifetime：签名所示 string 业务值
 * English: Inputs: owner: the string domain value in the signature; kind: the Kind domain value in the signature; id: target resource identifier; lifetime: the string domain value in the signature
 */
function component<Kind extends keyof ClientProps>(owner: string, kind: Kind, id: string, lifetime: string) {
  return cachedComponent<ClientProps[Kind]>(`${owner}:${kind}:${id}`, lifetime, /** 中文：为按权限寿命缓存和懒加载插件界面贡献构造包含 default 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用 | English: Build a local data object containing default for Caching and lazily loading plugin UI contributions by authority lifetime, using current inputs/explicit defaults for subsequent form/state processing | 中文：结果：包含 default 的对象，字段供调用者读取状态或调用操作 | English: Result: an object containing default for caller state reads/operations */ async () => {
    const load = entries[`../plugins/${owner}/client.tsx`];
    if (!load) throw new Error(`插件 ${owner} 缺少界面入口`);
    const entry = await load();
    const Component = entry[kind]?.[id];
    if (!Component) throw new Error(`插件 ${owner} 缺少界面组件：${id}`);
    return { default: Component };
  });
}

/**
 * 中文：呈现按权限寿命缓存和懒加载插件界面贡献中的 PluginTab 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PluginTab surface for Caching and lazily loading plugin UI contributions by authority lifetime. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ owner, id, ...props } 提供 owner（owner 状态）、id（目标资源标识）、props（props 状态） 上下文字段
 * English: Inputs: { owner, id, ...props } provides context fields owner (owner state), id (target resource identifier), props (props state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function PluginTab({ owner, id, ...props }: PluginTabProps & { owner: string; id: string }) {
  return <PluginBoundary identity={`official:${owner}`} request={props.request}>
    {(request, lifetime) => {
      const Component = component(owner, 'tabs', id, lifetime);
      return <Suspense fallback={<p role="status">正在加载功能…</p>}>
        <Component {...props} request={request} />
      </Suspense>;
    }}
  </PluginBoundary>;
}
/**
 * 中文：呈现按权限寿命缓存和懒加载插件界面贡献中的 PluginPage 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PluginPage surface for Caching and lazily loading plugin UI contributions by authority lifetime. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ owner, id, ...props } 提供 owner（owner 状态）、id（目标资源标识）、props（props 状态） 上下文字段
 * English: Inputs: { owner, id, ...props } provides context fields owner (owner state), id (target resource identifier), props (props state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function PluginPage({ owner, id, ...props }: PluginPageProps & { owner: string; id: string }) {
  return <PluginBoundary identity={`official:${owner}`} request={props.request}>
    {(request, lifetime) => {
      const Component = component(owner, 'pages', id, lifetime);
      return <Suspense fallback={<p role="status">正在加载功能…</p>}>
        <Component {...props} request={request} />
      </Suspense>;
    }}
  </PluginBoundary>;
}
/**
 * 中文：呈现按权限寿命缓存和懒加载插件界面贡献中的 PluginDevelopmentSection 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PluginDevelopmentSection surface for Caching and lazily loading plugin UI contributions by authority lifetime. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ id, ...props } 提供 id（目标资源标识）、props（props 状态） 上下文字段
 * English: Inputs: { id, ...props } provides context fields id (target resource identifier), props (props state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function PluginDevelopmentSection({ id, ...props }: FeatureProps & { id: string }) {
  const owner = PLUGINS.find((plugin) => plugin.contributes.developmentSections.includes(id))?.id;
  if (!owner) return null;
  return <PluginBoundary identity={`official:${owner}`} request={props.request}>
    {(request, lifetime) => {
      const Component = component(owner, 'developmentSections', id, lifetime);
      return <Suspense fallback={<p role="status">正在加载功能…</p>}>
        <Component {...props} request={request} />
      </Suspense>;
    }}
  </PluginBoundary>;
}
