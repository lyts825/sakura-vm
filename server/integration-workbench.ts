/** 工作台组合公开服务，不持有其他插件私有状态。 Workbench orchestration through declared services only. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type * as Ports from './service-contracts/integration-lab.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { IntegrationRows, ilHash } from './integration-store.ts';
import {
  type IntegrationScope,
  type HttpContract,
  type HttpShape,
  type IntegrationRevision,
  type IntegrationRef,
  type IntegrationScenario,
} from '../shared/contracts/integration-lab.ts';
type Deps = {
  specs: Ports.IntegrationSpecsV1;
  environments: Ports.IntegrationEnvironmentsV1;
  fixtures: Ports.IntegrationFixturesV1;
  mocks: Ports.IntegrationMocksV1;
  scenarios: Ports.IntegrationScenariosV1;
  assertions: Ports.IntegrationAssertionsV1;
  runners: Ports.IntegrationRunnersV1;
  load: Ports.IntegrationLoadV1;
  reports: Ports.IntegrationReportsV1;
  exchange: Ports.IntegrationExchangeV1;
};
const ref = (r: IntegrationRevision<unknown>): IntegrationRef => ({ id: r.id, revision: r.revision });
const integer: HttpShape = { type: 'integer', minimum: 1, maximum: 999999 };
const object = (properties: Record<string, HttpShape>, required = Object.keys(properties)): HttpShape => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export class IntegrationWorkbench implements Ports.IntegrationWorkbenchV1 {
  private rows;
  constructor(
    meta: PluginMetadata,
    private d: Deps,
  ) {
    this.rows = new IntegrationRows(
      meta,
      z
        .object({
          id: z.uuid(),
          workspaceId: z.uuid(),
          template: z.string(),
          at: z.iso.datetime(),
          digest: z.string(),
        })
        .strict(),
    );
  }
  async templates() {
    return [
      { id: 'order-demo' as const, name: '订单接口演练' },
      { id: 'pagination' as const, name: '分页与限流' },
      { id: 'contract-change' as const, name: '契约变更检查' },
    ];
  }
  async create(raw: { name: string; template: 'order-demo' | 'pagination' | 'contract-change' }) {
    const input = z
      .object({
        name: z.string().min(1).max(200),
        template: z.enum(['order-demo', 'pagination', 'contract-change']),
      })
      .strict()
      .parse(raw);
    const workspace = await this.d.specs.createWorkspace({ name: input.name }),
      scope = { workspaceId: workspace.id };
    const save = async <T>(port: Ports.IntegrationDefinitionsV1<T>, content: T) => {
      const row = await port.save(scope, { content });
      return port.seal(scope, ref(row));
    };
    const product = object({
        id: integer,
        name: { type: 'string', maxLength: 100 },
        price: { type: 'number', minimum: 0, maximum: 10000 },
      }),
      order = object({
        id: integer,
        total: { type: 'number', minimum: 0, maximum: 10000 },
        items: { type: 'array', items: product, maxItems: 20 },
      });
    const contract: HttpContract = {
      format: 'sakura-http-contract/1',
      title: input.name,
      schemas: {},
      operations: [
        {
          operationId: 'products',
          method: 'GET',
          path: '/products',
          pathParameters: [],
          queryParameters: [],
          request: null,
          responses: [
            {
              status: 200,
              mediaType: 'application/json',
              schema: object({ items: { type: 'array', items: product, maxItems: 20 } }),
            },
          ],
          effect: 'read',
        },
        {
          operationId: 'create-order',
          method: 'POST',
          path: '/orders',
          pathParameters: [],
          queryParameters: [],
          request: object({ productId: integer, quantity: { type: 'integer', minimum: 1, maximum: 10 } }),
          responses: [{ status: 201, mediaType: 'application/json', schema: order }],
          effect: 'write',
        },
        {
          operationId: 'get-order',
          method: 'GET',
          path: '/orders/{id}',
          pathParameters: [{ name: 'id', required: true, schema: integer }],
          queryParameters: [],
          request: null,
          responses: [{ status: 200, mediaType: 'application/json', schema: order }],
          effect: 'read',
        },
      ],
    };
    if (input.template === 'pagination') {
      contract.operations = [
        {
          operationId: 'page',
          method: 'GET',
          path: '/items',
          pathParameters: [],
          queryParameters: [
            { name: 'page', required: true, schema: { type: 'integer', minimum: 1, maximum: 2 } },
          ],
          request: null,
          responses: [
            {
              status: 200,
              mediaType: 'application/json',
              schema: object({ items: { type: 'array', items: product, maxItems: 20 } }),
            },
            {
              status: 429,
              mediaType: 'application/json',
              schema: object({ error: { type: 'string', maxLength: 100 } }),
            },
          ],
          effect: 'read',
        },
      ];
    }
    const spec = await save(this.d.specs, contract);
    if (input.template === 'contract-change') {
      const changed = structuredClone(contract);
      changed.operations[2].responses[0].schema = object({
        id: integer,
        items: { type: 'array', items: product, maxItems: 20 },
      });
      const next = await save(this.d.specs, changed);
      const comparison = await this.d.specs.compare(scope, ref(spec), ref(next));
      await this.rows.change((rows) =>
        rows.push({
          id: randomUUID(),
          workspaceId: workspace.id,
          template: input.template,
          at: new Date().toISOString(),
          digest: ilHash(comparison),
        }),
      );
      return { workspace, scenario: null, mock: null, assertions: null, comparison };
    }
    const env = await save(this.d.environments, {
      name: '本次模拟',
      target: { kind: 'mock' as const },
      credentials: [],
    });
    const products = [
      { id: 1, name: 'Fictional tea', price: 12 },
      { id: 2, name: 'Fictional cup', price: 8 },
    ];
    const fixture = await save(this.d.fixtures, {
      name: '虚构商品',
      columns: ['items'],
      rows: [{ items: products }],
      seed: 42,
      redactedFields: [],
    });
    const orderBody = { id: 1001, total: 24, items: [products[0], products[0]] };
    const fault = { delayMs: 0, disconnect: false };
    const mock = await save(
      this.d.mocks,
      input.template === 'pagination'
        ? {
            name: '分页与限流',
            contract: ref(spec),
            fixtures: [ref(fixture)],
            states: ['first', 'limited'],
            initialState: 'first',
            seed: 42,
            rules: [
              {
                id: 'page-one',
                operationId: 'page',
                state: 'first',
                nextState: 'limited',
                status: 200,
                headers: {},
                body: null,
                fixture: { index: 0, row: 0 },
                fault,
              },
              {
                id: 'rate-limit',
                operationId: 'page',
                state: 'limited',
                status: 429,
                headers: { 'Retry-After': '1' },
                body: { error: 'rate-limited' },
                fault,
              },
            ],
          }
        : {
            name: '订单有限状态',
            contract: ref(spec),
            fixtures: [ref(fixture)],
            states: ['empty', 'ordered'],
            initialState: 'empty',
            seed: 42,
            rules: [
              {
                id: 'products',
                operationId: 'products',
                status: 200,
                headers: {},
                body: null,
                fixture: { index: 0, row: 0 },
                fault,
              },
              {
                id: 'create',
                operationId: 'create-order',
                state: 'empty',
                nextState: 'ordered',
                status: 201,
                headers: {},
                body: orderBody,
                fault,
              },
              {
                id: 'order',
                operationId: 'get-order',
                state: 'ordered',
                status: 200,
                headers: {},
                body: orderBody,
                fault,
              },
            ],
          },
    );
    const nodes: IntegrationScenario['nodes'] =
      input.template === 'pagination'
        ? [
            {
              id: 'page-one',
              operationId: 'page',
              after: [],
              path: {},
              query: { page: 1 },
              body: null,
              bindings: [],
            },
            {
              id: 'page-two',
              operationId: 'page',
              after: ['page-one'],
              path: {},
              query: { page: 2 },
              body: null,
              bindings: [],
            },
          ]
        : [
            {
              id: 'products',
              operationId: 'products',
              after: [],
              path: {},
              query: {},
              body: null,
              bindings: [],
            },
            {
              id: 'create',
              operationId: 'create-order',
              after: ['products'],
              path: {},
              query: {},
              body: { productId: 1, quantity: 2 },
              bindings: [],
            },
            {
              id: 'order',
              operationId: 'get-order',
              after: ['create'],
              path: {},
              query: {},
              body: null,
              bindings: [{ from: 'create', pointer: '/id', to: 'path', field: 'id', shape: integer }],
            },
          ];
    const scenario = await save(this.d.scenarios, {
      name: input.name,
      contract: ref(spec),
      environment: ref(env),
      fixtures: [ref(fixture)],
      nodes,
    });
    const assertions = await save(this.d.assertions, {
      name: input.name,
      scenario: ref(scenario),
      rules:
        input.template === 'pagination'
          ? [
              { id: 'first-ok', node: 'page-one', kind: 'status' as const, equals: 200 },
              { id: 'limited', node: 'page-two', kind: 'status' as const, equals: 429 },
              { id: 'retry', node: 'page-two', kind: 'header' as const, name: 'retry-after', equals: '1' },
            ]
          : [
              { id: 'products-ok', node: 'products', kind: 'status' as const, equals: 200 },
              { id: 'created', node: 'create', kind: 'status' as const, equals: 201 },
              { id: 'total', node: 'order', kind: 'value' as const, pointer: '/total', equals: 24 },
              {
                id: 'items',
                node: 'order',
                kind: 'value' as const,
                pointer: '/items',
                equals: orderBody.items,
              },
              {
                id: 'same-order',
                node: 'order',
                kind: 'relation' as const,
                pointer: '/id',
                otherNode: 'create',
                otherPointer: '/id',
                relation: 'eq' as const,
              },
            ],
    });
    const result = {
      workspace,
      scenario: ref(scenario),
      mock: ref(mock),
      assertions: ref(assertions),
      comparison: null,
    };
    await this.rows.change((rows) =>
      rows.push({
        id: randomUUID(),
        workspaceId: workspace.id,
        template: input.template,
        at: new Date().toISOString(),
        digest: ilHash(result),
      }),
    );
    return result;
  }
  async view(scope: IntegrationScope) {
    const { workspace } = await this.d.specs.assertWorkspace(scope);
    return { workspace, runs: await this.d.runners.list(scope), reports: await this.d.reports.list(scope) };
  }
  async close() {
    await this.rows.close();
  }
}
