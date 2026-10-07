/**
 * 模块职责：提供受限 GraphQL 查询入口，限制查询深度及展开数量并读取服务状态快照。
 * Module purpose: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { arch, cpus, freemem, hostname, platform, totalmem } from 'node:os';
import {
  buildSchema,
  execute,
  getNamedType,
  getOperationAST,
  getVariableValues,
  GraphQLError,
  isListType,
  isNonNullType,
  isObjectType,
  isInterfaceType,
  isInputObjectType,
  isEnumType,
  isUnionType,
  Kind,
  parse,
  printSchema,
  SchemaMetaFieldDef,
  TypeMetaFieldDef,
  TypeNameMetaFieldDef,
  validate,
  type DocumentNode,
  type GraphQLCompositeType,
  type SelectionSetNode,
  type FragmentDefinitionNode,
  type FormattedExecutionResult,
} from 'graphql';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import { PLUGINS } from '../shared/plugins.ts';

export const graphqlLimits = {
  queryBytes: 16384,
  requestBytes: 65536,
  tokens: 2500,
  depth: 16,
  expandedSelections: 1500,
  cost: 50000,
  pageSize: 100,
  offset: 10000,
  responseBytes: 1048576,
  timeoutMs: 5000,
  concurrent: 8,
};
export const graphqlRequest = z
  .object({
    query: z.string().min(1).max(graphqlLimits.queryBytes),
    variables: z.record(z.string(), z.unknown()).nullish(),
    operationName: z.string().min(1).max(128).nullish(),
  })
  .strict();
const schema = buildSchema(`
  "Sakura local read-only API version 1. Mutations and subscriptions are not defined."
  type Query {
    apiVersion: String!
    host: Host!
    vm(id: ID!): VirtualMachine
    "Filter first, then paginate; limit 1–100, offset 0–10000."
    vms(limit: Int = 20, offset: Int = 0, status: String): [VirtualMachine!]!
    "Newest first; only metadata from currently active plugins."
    jobs(limit: Int = 20, offset: Int = 0, status: String, vmId: ID): [Task!]!
    plugins: [Plugin!]!
  }
  type Host { name: String! platform: String! architecture: String! cpus: Int! memoryMiB: Float! freeMemoryMiB: Float! capturedAt: String! totalVms: Int! totalJobs: Int! }
  type VirtualMachine { id: ID! name: String! status: String! cpus: Int! memoryMiB: Int! }
  type Task { id: ID scope: String! action: String! vmId: ID status: String! startedAt: String! finishedAt: String }
  type Plugin { id: ID! name: String! version: String! enabled: Boolean! }
`);
/**
 * 入口 / Entry: graphqlInfo.
 * 功能：从当前输入或状态计算 `({ version: '1', endpoint: '/api/graphql', readOnly: true, limits: { ...graphqlLimits }, sdl: printSchema(schema), })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: '1', endpoint: '/api/graphql', readOnly: true, limits: { ...graphqlLimits }, sdl: printSchema(schema), })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `({ version: '1', endpoint: '/api/graphql', readOnly: true, limits: { ...graphqlLimits }, sdl: printSchema(schema), })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const graphqlInfo = () => ({
  version: '1',
  endpoint: '/api/graphql',
  readOnly: true,
  limits: { ...graphqlLimits },
  sdl: printSchema(schema),
});
/**
 * 入口 / Entry: querySnapshot.
 * 功能：在提供受限 GraphQL 查询入口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ host: { name: hostname(), platform: platform(), architecture: arch(), cpus: cpus().length, memoryMiB: totalmem() / 1048576,…` 供上层消费（`graphql-api.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `graphql-api.ts`; this entry produces `{ host: { name: hostname(), platform: platform(), architecture: arch(), cpus: cpus().length, memoryMiB: totalmem() / 1048576,…` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
 * 处理：通过 `inline.map`, `machines.records.values`, `stores.flatMap().sort().map`, `stores.flatMap().sort` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.map`, `machines.records.values`, `stores.flatMap().sort().map`, `stores.flatMap().sort`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Pick<Machines, 'records' | 'state'>; stores: Pick<JobsV1, 'list'>[]; active: Iterable<string>
 * 输出 / Returns: `{ host: { name: hostname(), platform: platform(), architecture: arch(), cpus: cpus().length, memoryMiB: totalmem() / 1048576,…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function querySnapshot(
  machines: Pick<Machines, 'records' | 'state'>,
  stores: Pick<JobsV1, 'list'>[],
  active: Iterable<string>,
) {
  const vms = [...machines.records.values()].map((vm) => ({
    id: vm.id,
    name: vm.name,
    status: machines.state(vm.id),
    cpus: vm.cpus,
    memoryMiB: vm.memoryMiB,
  }));
  /**
   * 入口 / Entry: querySnapshot.label.
   * 功能：从当前输入或状态计算 `typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task'`，供调用方后续验证或使用。
   * Purpose: Computes `typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task'` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: `typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task'`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const label = (value: unknown) =>
    typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task';
  const jobs = stores
    .flatMap((store) => store.list())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((job) => ({
      id: job.id,
      vmId: job.vmId,
      scope: label(job.scope),
      action: label(job.action),
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }));
  const enabled = new Set(active);
  return {
    host: {
      name: hostname(),
      platform: platform(),
      architecture: arch(),
      cpus: cpus().length,
      memoryMiB: totalmem() / 1048576,
      freeMemoryMiB: freemem() / 1048576,
      capturedAt: new Date().toISOString(),
      totalVms: vms.length,
      totalJobs: jobs.length,
    },
    vms,
    jobs,
    plugins: PLUGINS.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      enabled: enabled.has(plugin.id),
    })),
  };
}
type Snapshot = ReturnType<typeof querySnapshot>;
const schemaTypes = Object.values(schema.getTypeMap());
const fields = schemaTypes.flatMap((type) =>
  isObjectType(type) || isInterfaceType(type) ? Object.values(type.getFields()) : [],
);
const introspectionBounds: Record<string, number> = {
  '__Schema.types': schemaTypes.length,
  '__Schema.directives': schema.getDirectives().length,
  '__Type.fields': Math.max(
    0,
    ...schemaTypes.map((type) =>
      isObjectType(type) || isInterfaceType(type) ? Object.keys(type.getFields()).length : 0,
    ),
  ),
  '__Type.inputFields': Math.max(
    0,
    ...schemaTypes.map((type) => (isInputObjectType(type) ? Object.keys(type.getFields()).length : 0)),
  ),
  '__Type.enumValues': Math.max(
    0,
    ...schemaTypes.map((type) => (isEnumType(type) ? type.getValues().length : 0)),
  ),
  '__Type.interfaces': Math.max(
    0,
    ...schemaTypes.map((type) =>
      isObjectType(type) || isInterfaceType(type) ? type.getInterfaces().length : 0,
    ),
  ),
  '__Type.possibleTypes': Math.max(
    0,
    ...schemaTypes.map((type) =>
      isUnionType(type) || isInterfaceType(type) ? schema.getPossibleTypes(type).length : 0,
    ),
  ),
  '__Field.args': Math.max(0, ...fields.map((field) => field.args.length)),
  '__Directive.args': Math.max(0, ...schema.getDirectives().map((directive) => directive.args.length)),
  '__Directive.locations': Math.max(
    0,
    ...schema.getDirectives().map((directive) => directive.locations.length),
  ),
  'Query.plugins': PLUGINS.length,
};
/**
 * 入口 / Entry: fail.
 * 功能：从当前输入或状态计算 `new GraphQLError(message, { extensions: { code } })`，供调用方后续验证或使用。
 * Purpose: Computes `new GraphQLError(message, { extensions: { code } })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: message: string; code: default='QUERY_LIMIT'
 * 输出 / Returns: `new GraphQLError(message, { extensions: { code } })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const fail = (message: string, code = 'QUERY_LIMIT') => new GraphQLError(message, { extensions: { code } });
/**
 * 入口 / Entry: invalidQuery.
 * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ status: 400, body: { errors: errors.slice(0, 10).map(error => ({ ...error.toJSON(), extensions: { ...error.extensions, cod…` 供上层消费（`graphql-api.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `graphql-api.ts`; this entry produces `({ status: 400, body: { errors: errors.slice(0, 10).map(error => ({ ...error.toJSON(), extensions: { ...error.extensions, cod…` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
 * 处理：通过 `errors.slice().map`, `errors.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `errors.slice().map`, `errors.slice`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: errors: readonly GraphQLError[]; code: string
 * 输出 / Returns: `({ status: 400, body: { errors: errors.slice(0, 10).map(error => ({ ...error.toJSON(), extensions: { ...error.extensions, cod…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const invalidQuery = (errors: readonly GraphQLError[], code: string) => ({
  status: 400,
  body: { errors: errors.slice(0, 10).map(error => ({ ...error.toJSON(), extensions: { ...error.extensions, code } })) },
});

// Count every fragment expansion before GraphQL validation or execution. List fan-out is
// conservative, including introspection lists; aliases cannot avoid the same budget.
/**
 * 入口 / Entry: boundedDocument.
 * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`graphql-api.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `graphql-api.ts`; the calls and state transitions below complete the operation. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
 * 处理：通过 `fragments.set`, `walk`, `schema.getQueryType` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `fragments.set`, `walk`, `schema.getQueryType`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `node.kind === Kind.FRAGMENT_DEFINITION`; `node.kind === Kind.OPERATION_DEFINITION`.
 * 输入 / Inputs: document: DocumentNode
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `fragments.set`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function boundedDocument(document: DocumentNode) {
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const node of document.definitions)
    if (node.kind === Kind.FRAGMENT_DEFINITION) fragments.set(node.name.value, node);
  let selections = 0,
    cost = 0;
  /**
   * 入口 / Entry: boundedDocument.walk.
   * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`graphql-api.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `graphql-api.ts`; the calls and state transitions below complete the operation. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
   * 处理：通过 `fail`, `visiting.has`, `fragments.get`, `next.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `fail`, `visiting.has`, `fragments.get`, `next.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `fragment`; `node.kind === Kind.INLINE_FRAGMENT`; `node.selectionSet`.
   * 输入 / Inputs: set: SelectionSetNode; type: GraphQLCompositeType | undefined; depth: number; multiplier: number; visiting: Set<string>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `next.add`; 更新 / updates `cost`, `fanout`.
   * 拒绝 / Refusals: 条件 / conditions `depth > graphqlLimits.depth`; `++selections > graphqlLimits.expandedSelections`; `node.kind === Kind.FRAGMENT_SPREAD`; 异常 / errors `fail('查询嵌套超过深度限制')`; `fail('查询展开数量超过限制')`.
   */
  const walk = (
    set: SelectionSetNode,
    type: GraphQLCompositeType | undefined,
    depth: number,
    multiplier: number,
    visiting: Set<string>,
  ) => {
    if (depth > graphqlLimits.depth) throw fail('查询嵌套超过深度限制');
    for (const node of set.selections) {
      if (++selections > graphqlLimits.expandedSelections) throw fail('查询展开数量超过限制');
      if (node.kind === Kind.FRAGMENT_SPREAD) {
        const name = node.name.value;
        if (visiting.has(name)) throw fail('片段存在循环引用', 'INVALID_QUERY');
        const fragment = fragments.get(name);
        if (fragment) {
          const next = new Set(visiting);
          next.add(name);
          walk(
            fragment.selectionSet,
            schema.getType(fragment.typeCondition.name.value) as GraphQLCompositeType | undefined,
            depth,
            multiplier,
            next,
          );
        }
        continue;
      }
      if (node.kind === Kind.INLINE_FRAGMENT) {
        walk(
          node.selectionSet,
          node.typeCondition
            ? (schema.getType(node.typeCondition.name.value) as GraphQLCompositeType | undefined)
            : type,
          depth,
          multiplier,
          visiting,
        );
        continue;
      }
      cost += multiplier;
      if (cost > graphqlLimits.cost) throw fail('查询展开成本超过限制，请减少别名、列表或嵌套');
      const name = node.name.value;
      const field =
        name === '__typename'
          ? TypeNameMetaFieldDef
          : type === schema.getQueryType() && name === '__schema'
            ? SchemaMetaFieldDef
            : type === schema.getQueryType() && name === '__type'
              ? TypeMetaFieldDef
              : type && (isObjectType(type) || isInterfaceType(type))
                ? type.getFields()[name]
                : undefined;
      if (node.selectionSet) {
        const output = field && (isNonNullType(field.type) ? field.type.ofType : field.type);
        // Introspection fields are bounded by this static schema, independent of user data.
        let fanout = 1;
        if (output && isListType(output)) {
          fanout = introspectionBounds[`${type?.name}.${name}`] ?? graphqlLimits.pageSize;
        }
        walk(
          node.selectionSet,
          field ? (getNamedType(field.type) as GraphQLCompositeType) : undefined,
          depth + 1,
          multiplier * fanout,
          visiting,
        );
      }
    }
  };
  for (const node of document.definitions)
    if (node.kind === Kind.OPERATION_DEFINITION)
      walk(node.selectionSet, schema.getQueryType() || undefined, 1, 1, new Set());
}
/**
 * 入口 / Entry: page.
 * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `rows .filter( (row) => (args.status == null || row.status === args.status) && (args.vmId == null || row.vmId === args.vmId), …` 供上层消费（`graphql-api.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `graphql-api.ts`; this entry produces `rows .filter( (row) => (args.status == null || row.status === args.status) && (args.vmId == null || row.vmId === args.vmId), …` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
 * 处理：通过 `fail`, `rows.filter().slice`, `rows.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `fail`, `rows.filter().slice`, `rows.filter`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: rows: T[]; args: { limit?: number | null; offset?: number | null; status?: string | null; vmId?: strin…
 * 输出 / Returns: `rows .filter( (row) => (args.status == null || row.status === args.status) && (args.vmId == null || row.vmId === args.vmId), …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `limit < 1 || limit > graphqlLimits.pageSize || offset < 0 || offset > graphqlLimits.offset`; 异常 / errors `fail('分页需要 limit 1–100、offset 0–10000', 'BAD_USER_INPUT')`.
 */
function page<T extends { status?: string; vmId?: string }>(
  rows: T[],
  args: { limit?: number | null; offset?: number | null; status?: string | null; vmId?: string | null },
) {
  const limit = args.limit ?? 20,
    offset = args.offset ?? 0;
  if (limit < 1 || limit > graphqlLimits.pageSize || offset < 0 || offset > graphqlLimits.offset)
    throw fail('分页需要 limit 1–100、offset 0–10000', 'BAD_USER_INPUT');
  return rows
    .filter(
      (row) =>
        (args.status == null || row.status === args.status) && (args.vmId == null || row.vmId === args.vmId),
    )
    .slice(offset, offset + limit);
}
export class GraphApi {
  private closed = false;
  private active = new Map<AbortController, Promise<{ status: number; body: FormattedExecutionResult }>>();
  /**
   * 入口 / Entry: GraphApi.constructor.
   * 功能：建立 GraphApi 的提供受限 GraphQL 查询入口上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the GraphApi context for this module's responsibility: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: source: (signal: AbortSignal) => Promise<Snapshot>
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private source: (signal: AbortSignal) => Promise<Snapshot>) {}
  /**
   * 入口 / Entry: GraphApi.query.
   * 功能：在提供受限 GraphQL 查询入口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `await pending` 供上层消费（`GraphApi`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `GraphApi`; this entry produces `await pending` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
   * 处理：通过 `graphqlRequest.parse`, `external.addEventListener`, `cancel`, `setTimeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `graphqlRequest.parse`, `external.addEventListener`, `cancel`, `setTimeout`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `external?.aborted`.
   * 输入 / Inputs: input: unknown; external: AbortSignal optional
   * 输出 / Returns: `await pending`.
   * 副作用 / Effects: `external.addEventListener`; `setTimeout`; `this.execute`; `this.active.set`; `clearTimeout`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.active.size >= graphqlLimits.concurrent`; `Buffer.byteLength(value.query) > graphqlLimits.queryBytes`; 异常 / errors `new AppError('查询服务正在关闭', 503)`; `new AppError('并发查询过多，请稍后重试', 429)`.
   * 收尾：退出 try 区域时始终执行 `clearTimeout(timer);`; `external?.removeEventListener('abort', cancel);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `clearTimeout(timer);`; `external?.removeEventListener('abort', cancel);`; these steps also apply to exceptional exits.
   */
  async query(input: unknown, external?: AbortSignal) {
    if (this.closed) throw new AppError('查询服务正在关闭', 503);
    if (this.active.size >= graphqlLimits.concurrent) throw new AppError('并发查询过多，请稍后重试', 429);
    const value = graphqlRequest.parse(input);
    if (Buffer.byteLength(value.query) > graphqlLimits.queryBytes)
      throw new AppError('GraphQL 查询超过 16 KiB', 413);
    const abort = new AbortController();
    /**
     * 入口 / Entry: GraphApi.query.cancel.
     * 功能：把本层请求转交 `abort.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `abort.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `abort.abort()`.
     * 副作用 / Effects: `abort.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const cancel = () => abort.abort();
    external?.addEventListener('abort', cancel, { once: true });
    if (external?.aborted) cancel();
    const timer = setTimeout(cancel, graphqlLimits.timeoutMs);
    timer.unref();
    const pending = this.execute(value, abort.signal);
    this.active.set(abort, pending);
    try {
      return await pending;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', cancel);
      this.active.delete(abort);
    }
  }
  /**
   * 入口 / Entry: GraphApi.execute.
   * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `invalidQuery([error], 'GRAPHQL_PARSE_FAILED')` / `invalidQuery(errors, 'GRAPHQL_VALIDATION_FAILED')` 供上层消费（`GraphApi`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GraphApi`; this entry produces `invalidQuery([error], 'GRAPHQL_PARSE_FAILED')` / `invalidQuery(errors, 'GRAPHQL_VALIDATION_FAILED')` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
   * 处理：通过 `cancelled`, `parse`, `invalidQuery`, `boundedDocument` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `cancelled`, `parse`, `invalidQuery`, `boundedDocument`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `error instanceof GraphQLError`; `errors.length`; `variables.errors`.
   * 输入 / Inputs: value: z.infer<typeof graphqlRequest>; signal: AbortSignal
   * 输出 / Returns: Promise<{ status: number; body: FormattedExecutionResult }>；结果来自 / values from `invalidQuery([error], 'GRAPHQL_PARSE_FAILED')`; `invalidQuery(errors, 'GRAPHQL_VALIDATION_FAILED')`; `invalidQuery(variables.errors, 'BAD_USER_INPUT')`.
   * 副作用 / Effects: `execute`; 更新 / updates `document`.
   * 拒绝 / Refusals: 条件 / conditions `!operation`; `operation.operation !== 'query'`; 异常 / errors `error`; `fail('需要指定有效的 operationName', 'INVALID_QUERY')`.
   * 失败处理：catch 分支执行 `return { status: 400, body: { errors: [(error instanceof GraphQLError ? error : fail('无法解析查询', 'INVALID_QUERY')).toJSON()], }…`; `if (error instanceof GraphQLError) return invalidQuery([error], 'GRAPHQL_PARSE_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { status: 400, body: { errors: [(error instanceof GraphQLError ? error : fail('无法解析查询', 'INVALID_QUERY')).toJSON()], }…`; `if (error instanceof GraphQLError) return invalidQuery([error], 'GRAPHQL_PARSE_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async execute(
    value: z.infer<typeof graphqlRequest>,
    signal: AbortSignal,
  ): Promise<{ status: number; body: FormattedExecutionResult }> {
    let document: DocumentNode;
    /**
     * 入口 / Entry: GraphApi.execute.cancelled.
     * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`GraphApi`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `GraphApi`; the calls and state transitions below complete the operation. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
     * 处理：通过 `fail` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `fail`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `signal.aborted`; 异常 / errors `fail('查询已取消或超时', 'CANCELLED')`.
     */
    const cancelled = () => {
      if (signal.aborted) throw fail('查询已取消或超时', 'CANCELLED');
    };
    try {
      cancelled();
      try { document = parse(value.query, { maxTokens: graphqlLimits.tokens }); }
      catch (error) {
        if (error instanceof GraphQLError) return invalidQuery([error], 'GRAPHQL_PARSE_FAILED');
        throw error;
      }
      boundedDocument(document);
      const errors = validate(schema, document, undefined, { maxErrors: 10 });
      if (errors.length) return invalidQuery(errors, 'GRAPHQL_VALIDATION_FAILED');
      const operation = getOperationAST(document, value.operationName);
      if (!operation) throw fail('需要指定有效的 operationName', 'INVALID_QUERY');
      if (operation.operation !== 'query') throw fail('此 GraphQL API 只支持 query', 'READ_ONLY');
      const variables = getVariableValues(schema, operation.variableDefinitions || [], value.variables || {}, { maxErrors: 10 });
      if (variables.errors) return invalidQuery(variables.errors, 'BAD_USER_INPUT');
    } catch (error) {
      return {
        status: 400,
        body: {
          errors: [(error instanceof GraphQLError ? error : fail('无法解析查询', 'INVALID_QUERY')).toJSON()],
        },
      };
    }
    let snapshot: Promise<Snapshot> | undefined;
    /**
     * 入口 / Entry: GraphApi.execute.callback@335.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: resolve; reject
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `signal.addEventListener`; `abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    /**
     * 入口 / Entry: GraphApi.execute.data.
     * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(snapshot ||= new Promise<Snapshot>((resolve, reject) => { const abort = () => reject(fail('查询已取消或超时', 'CANCELLED')); signal.…` 供上层消费（`GraphApi`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `GraphApi`; this entry produces `(snapshot ||= new Promise<Snapshot>((resolve, reject) => { const abort = () => reject(fail('查询已取消或超时', 'CANCELLED')); signal.…` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `(snapshot ||= new Promise<Snapshot>((resolve, reject) => { const abort = () => reject(fail('查询已取消或超时', 'CANCELLED')); signal.…`.
     * 副作用 / Effects: 更新 / updates `snapshot`.
     */
    const data = () =>
      (snapshot ||= new Promise<Snapshot>(
      /**
       * 中文功能：将状态来源读取与取消事件协调为 Promise，响应前再检查 signal，成功/失败都解除 abort 监听。
       * English: Coordinates state-source reading and cancellation into a Promise, rechecking the signal before response and removing the abort listener on success/failure.
       * 所属 / Owner: GraphApi.execute.data.
       * 输入 / Inputs: resolve; reject.
       */
      (resolve, reject) => {
        /**
         * 入口 / Entry: GraphApi.execute.abort.
         * 功能：在提供受限 GraphQL 查询入口中，结束、撤销或清理本次拥有的领域资源；本入口产生 `reject(fail('查询已取消或超时', 'CANCELLED'))` 供上层消费（`GraphApi`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `GraphApi`; this entry produces `reject(fail('查询已取消或超时', 'CANCELLED'))` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
         * 处理：通过 `reject`, `fail` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `reject`, `fail`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `reject(fail('查询已取消或超时', 'CANCELLED'))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const abort = () => reject(fail('查询已取消或超时', 'CANCELLED'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
          abort();
          signal.removeEventListener('abort', abort);
          return;
        }
        Promise.resolve()
          .then(() => {
            cancelled();
            return this.source(signal);
          })
          .then(
            (value) => {
              signal.removeEventListener('abort', abort);
              if (signal.aborted) abort();
              else resolve(value);
            },
            () => {
              signal.removeEventListener('abort', abort);
              reject(fail('无法读取当前主机状态', 'SOURCE_UNAVAILABLE'));
            },
          );
      }));
    const result = await execute({
      schema,
      document,
      operationName: value.operationName,
      variableValues: value.variables,
      rootValue: {
        /**
         * 入口 / Entry: GraphApi.execute.apiVersion.
         * 功能：从当前输入或状态计算 `'1'`，供调用方后续验证或使用。
         * Purpose: Computes `'1'` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `'1'`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        apiVersion: () => '1',
        /**
         * 入口 / Entry: GraphApi.execute.host.
         * 功能：从当前输入或状态计算 `(await data()).host`，供调用方后续验证或使用。
         * Purpose: Computes `(await data()).host` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `(await data()).host`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        host: async () => (await data()).host,
        /**
         * 入口 / Entry: GraphApi.execute.vm.
         * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await data()).vms.find((vm) => vm.id === id) || null` 供上层消费（`GraphApi`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `GraphApi`; this entry produces `(await data()).vms.find((vm) => vm.id === id) || null` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
         * 处理：通过 `inline.vms.find`, `data` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `inline.vms.find`, `data`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: { id }: { id: string }
         * 输出 / Returns: `(await data()).vms.find((vm) => vm.id === id) || null`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        vm: async ({ id }: { id: string }) => (await data()).vms.find((vm) => vm.id === id) || null,
        /**
         * 入口 / Entry: GraphApi.execute.vms.
         * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `page((await data()).vms, args)` 供上层消费（`GraphApi`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `GraphApi`; this entry produces `page((await data()).vms, args)` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
         * 处理：通过 `page`, `data` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `page`, `data`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: args: Parameters<typeof page>[1]
         * 输出 / Returns: `page((await data()).vms, args)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        vms: async (args: Parameters<typeof page>[1]) => page((await data()).vms, args),
        /**
         * 入口 / Entry: GraphApi.execute.jobs.
         * 功能：在提供受限 GraphQL 查询入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `page((await data()).jobs, args)` 供上层消费（`GraphApi`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `GraphApi`; this entry produces `page((await data()).jobs, args)` for its caller. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
         * 处理：通过 `page`, `data` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `page`, `data`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: args: Parameters<typeof page>[1]
         * 输出 / Returns: `page((await data()).jobs, args)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        jobs: async (args: Parameters<typeof page>[1]) => page((await data()).jobs, args),
        /**
         * 入口 / Entry: GraphApi.execute.plugins.
         * 功能：从当前输入或状态计算 `(await data()).plugins`，供调用方后续验证或使用。
         * Purpose: Computes `(await data()).plugins` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `(await data()).plugins`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        plugins: async () => (await data()).plugins,
      },
      options: { maxCoercionErrors: 10 },
    });
    const body: FormattedExecutionResult = {
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.errors ? { errors: result.errors.map((error) => error.toJSON()) } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(body)) > graphqlLimits.responseBytes)
      return { status: 400, body: { errors: [fail('查询结果超过 1 MiB，请缩小范围').toJSON()] } };
    return { status: result.data === undefined ? 400 : 200, body };
  }
  /**
   * 入口 / Entry: GraphApi.close.
   * 功能：在提供受限 GraphQL 查询入口中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`GraphApi`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `GraphApi`; the outcome is recorded in `this.closed`. Module context: Provides bounded GraphQL status queries, limiting nesting and expanded field counts before service snapshots.
   * 处理：通过 `this.active.keys`, `abort.abort`, `Promise.allSettled`, `this.active.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.keys`, `abort.abort`, `Promise.allSettled`, `this.active.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `abort.abort`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    for (const abort of this.active.keys()) abort.abort();
    await Promise.allSettled(this.active.values());
  }
}
