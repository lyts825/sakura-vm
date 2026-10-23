/**
 * 模块职责（中文）：插件清单、插件包和启用选择的公共协议；提供内置插件默认值、精确版本依赖及贡献声明构造器。
 * Module responsibility (English): Constructing exact-version dependencies, plugin manifests and pack protocols.
 * 详细范围（中文）：公开入口包括 PLUGIN_API_VERSION, BUILTIN_PLUGIN_VERSION, PluginManifest, PluginPack, PluginSelection, HttpContribution, OperationContribution, OperationRoute, PluginRoot, PluginStatus, definePlugin, pin, http, operation, definePack, member；职责覆盖构造精确版本依赖、插件清单和插件包协议，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PLUGIN_API_VERSION, BUILTIN_PLUGIN_VERSION, PluginManifest, PluginPack, PluginSelection, HttpContribution, OperationContribution, OperationRoute, PluginRoot, PluginStatus, definePlugin, pin, http, operation, definePack, member. The scope covers Constructing exact-version dependencies, plugin manifests and pack protocols. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { z } from 'zod';
import type { PluginInstanceView } from './contracts/plugin-runtime.ts';
import type {
  pluginManifestSchema,
  pluginPackSchema,
  pluginSelectionSchema,
  httpContributionSchema,
  operationContributionSchema,
  operationRouteSchema,
} from './plugin-schema.ts';

export const PLUGIN_API_VERSION = 5;
export const BUILTIN_PLUGIN_VERSION = '2.6.0';
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginPack = z.infer<typeof pluginPackSchema>;
export type PluginSelection = z.infer<typeof pluginSelectionSchema>;
export type HttpContribution = z.infer<typeof httpContributionSchema>;
export type OperationContribution = z.infer<typeof operationContributionSchema>;
export type OperationRoute = z.infer<typeof operationRouteSchema>;
export type PluginRoot = { kind: 'plugin' | 'pack'; id: string };
export type PluginStatus = {
  selection: PluginSelection;
  active: string[];
  planned: string[];
  reasons: Record<string, PluginRoot[]>;
  migrations: string[];
  restartRequired: boolean;
  errors: Record<string, string>;
  lifecycle: Record<string, { phase: 'active' | 'failed' | 'skipped'; activationMs: number }>;
  plugins: PluginManifest[];
  packs: PluginPack[];
  runtime?: { version: number; instances: PluginInstanceView[] };
};

type PluginInput = Pick<PluginManifest, 'id' | 'name' | 'description' | 'category'> &
  Partial<
    Omit<
      PluginManifest,
      'kind' | 'schemaVersion' | 'contributes' | 'id' | 'name' | 'description' | 'category'
    >
  > & { contributes?: Partial<PluginManifest['contributes']> };
// 默认贡献数组总是存在；input 可覆盖元数据，而 contributes 单独展开，避免局部贡献覆盖遗漏其他集合。
/**
 * 中文：将插件输入补成完整清单：默认使用内置版本、插件 API 与生命周期预算，并逐贡献字段补空集合。input 覆盖元数据，贡献独立展开，局部贡献不会抹掉其他集合。
 * English: Complete plugin input with builtin version, plugin API and lifecycle-budget defaults, supplying empty collections for each contribution field. Input overrides metadata while contributions merge separately, so partial contributions cannot erase other collections.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：包含 schemaVersion、kind、version、apiVersion、experimental、requires、optional、services、systemDependencies、lifecycle、contributes 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing schemaVersion, kind, version, apiVersion, experimental, requires, optional, services, systemDependencies, lifecycle, contributes for caller state reads/operations
 */
export function definePlugin(input: PluginInput): PluginManifest {
  return {
    schemaVersion: 1,
    kind: 'plugin',
    version: BUILTIN_PLUGIN_VERSION,
    apiVersion: PLUGIN_API_VERSION,
    experimental: false,
    requires: [],
    optional: [],
    services: [],
    systemDependencies: [],
    lifecycle: { activateMs: 30000, closeMs: 10000 },
    ...input,
    contributes: {
      http: [],
      routes: [],
      operations: [],
      sockets: [],
      pages: [],
      tabs: [],
      developmentSections: [],
      managed: [],
      ...input.contributes,
    },
  };
}
/**
 * 中文：构造指向精确插件 ID 和版本的依赖引用，省略版本时固定到内置版本；不使用浮动兼容范围。
 * English: Build an exact plugin-ID/version reference, defaulting to the builtin version rather than a floating compatibility range.
 * 中文：输入：id：目标资源标识；version：读取票号、内容版本或契约版本（缺省 BUILTIN_PLUGIN_VERSION）
 * English: Inputs: id: target resource identifier; version: read ticket/content/contract version (default BUILTIN_PLUGIN_VERSION)
 */
export const pin = (id: string, version = BUILTIN_PLUGIN_VERSION) => ({ id, version });
/**
 * 中文：声明 HTTP 前缀、允许方法及项目作用域；只提供清单元数据，运行时处理器另行登记。
 * English: Declare an HTTP prefix, allowed methods and project scope as manifest metadata; register runtime handlers separately.
 * 中文：输入：path：目标文件或请求路径；methods：签名所示 HttpContribution['methods'] 业务值；projectScoped：此处理器的调用值（缺省 false）
 * English: Inputs: path: target file/request path; methods: the HttpContribution['methods'] domain value in the signature; projectScoped: the invocation value for this handler (default false)
 * 中文：结果：HttpContribution，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: HttpContribution carrying the described computation/transport result; throwing branches do not provide success
 */
export const http = (
  path: string,
  methods: HttpContribution['methods'],
  projectScoped = false,
): HttpContribution => ({ path, methods, projectScoped });

/** 独立领域的所有者查询与写入入口；每次生成新的显式策略对象。 */
export const ownerDomainRoutes = (path: string): PluginManifest['contributes']['routes'] =>
  (['view', 'act'] as const).map((id) => ({
    id,
    method: id === 'view' ? 'GET' : 'POST',
    path,
    handler: 'route',
    status: 200,
    policy: {
      access: 'controller',
      roles: ['owner'],
      projectScoped: false,
      identity: 'host',
      maintenance: id === 'view' ? 'allow' : 'block',
      transport: 'json',
      mutating: id === 'act',
      session: 'required',
      vmLock: 'allow-locked',
      projectBinding: 'none',
      approval: 'none',
      extensionAuth: 'none',
    },
  }));
/**
 * 中文：声明精确 operation ID、方法、路径及成功状态，把路由认领与响应契约连接起来。
 * English: Declare an exact operation ID/method/path/success status, linking route ownership to the response contract.
 * 中文：输入：id：目标资源标识；method：请求 HTTP 方法；path：目标文件或请求路径；status：此处理器的调用值（缺省 200）
 * English: Inputs: id: target resource identifier; method: request HTTP method; path: target file/request path; status: the invocation value for this handler (default 200)
 * 中文：结果：OperationContribution，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: OperationContribution carrying the described computation/transport result; throwing branches do not provide success
 */
export const operation = (
  id: string,
  method: OperationContribution['method'],
  path: string,
  status = 200,
): OperationContribution => ({ id, method, path, status });
// 插件包只描述选择入口与版本固定成员；服务启动顺序由依赖解析结果决定。
/**
 * 中文：构造精确版本的插件包及旧插件替换别名，包只表达用户选择，不创建服务或决定执行顺序；实际启用顺序由依赖解析器计算。
 * English: Construct exact-version packs and legacy replacement aliases. Packs express user selection rather than creating services or choosing execution order; the resolver computes actual activation order.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：包含 schemaVersion、kind、version、replacesPlugins 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing schemaVersion, kind, version, replacesPlugins for caller state reads/operations
 */
export function definePack(
  input: Pick<PluginPack, 'id' | 'name' | 'description' | 'members'> &
    Partial<Pick<PluginPack, 'version' | 'replacesPlugins'>>,
): PluginPack {
  return { schemaVersion: 1, kind: 'pack', version: BUILTIN_PLUGIN_VERSION, replacesPlugins: [], ...input };
}
/**
 * 中文：把指定 ID、精确版本和成员类型组成插件包成员，供解析器展开插件或嵌套包。
 * English: Form a pack member from ID/exact version/member kind so the resolver can expand plugins or nested packs.
 * 中文：输入：id：目标资源标识；kind：签名所示 'plugin' | 'pack' 业务值（缺省 'plugin'）；version：读取票号、内容版本或契约版本（缺省 BUILTIN_PLUGIN_VERSION）
 * English: Inputs: id: target resource identifier; kind: the 'plugin' | 'pack' domain value in the signature (default 'plugin'); version: read ticket/content/contract version (default BUILTIN_PLUGIN_VERSION)
 * 中文：结果：PluginPack['members'][number]，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: PluginPack['members'][number] carrying the described computation/transport result; throwing branches do not provide success
 */
export const member = (
  id: string,
  kind: 'plugin' | 'pack' = 'plugin',
  version = BUILTIN_PLUGIN_VERSION,
): PluginPack['members'][number] => ({
  ...pin(id, version),
  kind,
});
/**
 * 中文：返回 schemaVersion 3 的空插件与插件包选择，仅启用基础控制面；不隐式加入推荐插件。
 * English: Return an empty schemaVersion-three plugin/pack selection for the base controller without implicitly enabling recommended plugins.
 * 中文：结果：PluginSelection，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: PluginSelection carrying the described computation/transport result; throwing branches do not provide success
 */
export const emptySelection = (): PluginSelection => ({ schemaVersion: 3, plugins: [], packs: [] });
