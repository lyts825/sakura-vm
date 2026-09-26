import { arch, cpus, freemem, hostname, platform, totalmem } from 'node:os';
import {
  buildSchema,
  execute,
  getNamedType,
  getOperationAST,
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
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import type { Jobs } from './jobs.ts';
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
export const graphqlInfo = () => ({
  version: '1',
  endpoint: '/api/graphql',
  readOnly: true,
  limits: { ...graphqlLimits },
  sdl: printSchema(schema),
});
export function querySnapshot(
  machines: Pick<Machines, 'records' | 'state'>,
  stores: Pick<Jobs, 'list'>[],
  active: Iterable<string>,
) {
  const vms = [...machines.records.values()].map((vm) => ({
    id: vm.id,
    name: vm.name,
    status: machines.state(vm.id),
    cpus: vm.cpus,
    memoryMiB: vm.memoryMiB,
  }));
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
const fail = (message: string, code = 'QUERY_LIMIT') => new GraphQLError(message, { extensions: { code } });

// Count every fragment expansion before GraphQL validation or execution. List fan-out is
// conservative, including introspection lists; aliases cannot avoid the same budget.
function boundedDocument(document: DocumentNode) {
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const node of document.definitions)
    if (node.kind === Kind.FRAGMENT_DEFINITION) fragments.set(node.name.value, node);
  let selections = 0,
    cost = 0;
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
  constructor(private source: (signal: AbortSignal) => Promise<Snapshot>) {}
  async query(input: unknown, external?: AbortSignal) {
    if (this.closed) throw new AppError('查询服务正在关闭', 503);
    if (this.active.size >= graphqlLimits.concurrent) throw new AppError('并发查询过多，请稍后重试', 429);
    const value = graphqlRequest.parse(input);
    if (Buffer.byteLength(value.query) > graphqlLimits.queryBytes)
      throw new AppError('GraphQL 查询超过 16 KiB', 413);
    const abort = new AbortController();
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
  private async execute(
    value: z.infer<typeof graphqlRequest>,
    signal: AbortSignal,
  ): Promise<{ status: number; body: FormattedExecutionResult }> {
    let document: DocumentNode;
    const cancelled = () => {
      if (signal.aborted) throw fail('查询已取消或超时', 'CANCELLED');
    };
    try {
      cancelled();
      document = parse(value.query, { maxTokens: graphqlLimits.tokens });
      boundedDocument(document);
      const errors = validate(schema, document, undefined, { maxErrors: 10 });
      if (errors.length) return { status: 400, body: { errors: errors.map((error) => error.toJSON()) } };
      const operation = getOperationAST(document, value.operationName);
      if (!operation) throw fail('需要指定有效的 operationName', 'INVALID_QUERY');
      if (operation.operation !== 'query') throw fail('此 GraphQL API 只支持 query', 'READ_ONLY');
    } catch (error) {
      return {
        status: 400,
        body: {
          errors: [(error instanceof GraphQLError ? error : fail('无法解析查询', 'INVALID_QUERY')).toJSON()],
        },
      };
    }
    let snapshot: Promise<Snapshot> | undefined;
    const data = () =>
      (snapshot ||= new Promise<Snapshot>((resolve, reject) => {
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
        apiVersion: () => '1',
        host: async () => (await data()).host,
        vm: async ({ id }: { id: string }) => (await data()).vms.find((vm) => vm.id === id) || null,
        vms: async (args: Parameters<typeof page>[1]) => page((await data()).vms, args),
        jobs: async (args: Parameters<typeof page>[1]) => page((await data()).jobs, args),
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
  async close() {
    this.closed = true;
    for (const abort of this.active.keys()) abort.abort();
    await Promise.allSettled(this.active.values());
  }
}
