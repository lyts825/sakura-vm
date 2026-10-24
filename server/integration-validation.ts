/** 严格契约、受限变量与 DAG 编译；无代码求值。 Contract, bounded binding and DAG validation without evaluation. */
import { isDeepStrictEqual } from 'node:util';
import {
  httpContractSchema,
  type HttpContract,
  type HttpShape,
  type IntegrationJson,
  type IntegrationScenario,
  type IntegrationEvidence,
  type IntegrationFixture,
} from '../shared/contracts/integration-lab.ts';
import { ilFail, ilBytes, ilHash } from './integration-store.ts';
export function validateShape(
  shape: HttpShape,
  schemas: Record<string, HttpShape> = {},
  path: string[] = [],
  depth = 0,
): void {
  if (depth > 16) ilFail('SCHEMA_DEPTH');
  if (shape.ref) {
    if (path.includes(shape.ref) || !schemas[shape.ref]) ilFail('SCHEMA_REFERENCE');
    return validateShape(schemas[shape.ref], schemas, [...path, shape.ref], depth + 1);
  }
  if (shape.type === 'object') {
    if (shape.additionalProperties === undefined) ilFail('ADDITIONAL_PROPERTIES_REQUIRED');
    for (const name of shape.required ?? [])
      if (!shape.properties?.[name]) ilFail('REQUIRED_PROPERTY_UNKNOWN');
    for (const s of Object.values(shape.properties ?? {})) validateShape(s, schemas, path, depth + 1);
  } else if (shape.properties || shape.required || shape.additionalProperties !== undefined)
    ilFail('SCHEMA_KEYWORD_SCOPE');
  if (shape.type === 'array') {
    if (!shape.items) ilFail('ITEMS_REQUIRED');
    validateShape(shape.items, schemas, path, depth + 1);
  } else if (shape.items || shape.minItems !== undefined || shape.maxItems !== undefined)
    ilFail('SCHEMA_KEYWORD_SCOPE');
  if (shape.type !== 'string' && (shape.minLength !== undefined || shape.maxLength !== undefined))
    ilFail('SCHEMA_KEYWORD_SCOPE');
  if (
    !['number', 'integer'].includes(shape.type ?? '') &&
    (shape.minimum !== undefined || shape.maximum !== undefined)
  )
    ilFail('SCHEMA_KEYWORD_SCOPE');
  for (const [min, max] of [
    [shape.minimum, shape.maximum],
    [shape.minLength, shape.maxLength],
    [shape.minItems, shape.maxItems],
  ])
    if (min !== undefined && max !== undefined && min > max) ilFail('SCHEMA_RANGE');
}
export function matches(
  value: unknown,
  shape: HttpShape,
  schemas: Record<string, HttpShape> = {},
  depth = 0,
): boolean {
  if (depth > 16) return false;
  if (shape.ref) return !!schemas[shape.ref] && matches(value, schemas[shape.ref], schemas, depth + 1);
  if (shape.enum && !shape.enum.some((v) => isDeepStrictEqual(v, value))) return false;
  switch (shape.type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (shape.type !== 'integer' || Number.isInteger(value)) &&
        (shape.minimum === undefined || value >= shape.minimum) &&
        (shape.maximum === undefined || value <= shape.maximum)
      );
    case 'string':
      return (
        typeof value === 'string' &&
        value.length >= (shape.minLength ?? 0) &&
        value.length <= (shape.maxLength ?? 65536)
      );
    case 'array':
      return (
        Array.isArray(value) &&
        value.length >= (shape.minItems ?? 0) &&
        value.length <= (shape.maxItems ?? 10000) &&
        !!shape.items &&
        value.every((v) => matches(v, shape.items!, schemas, depth + 1))
      );
    case 'object':
      return (
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (shape.required ?? []).every((k) => Object.hasOwn(value, k)) &&
        Object.entries(value).every(([k, v]) =>
          Object.hasOwn(shape.properties ?? {}, k)
            ? matches(v, shape.properties![k], schemas, depth + 1)
            : shape.additionalProperties === true,
        )
      );
    default:
      return false;
  }
}
export function validateContract(raw: HttpContract) {
  const contract = httpContractSchema.parse(raw);
  if (ilBytes(contract) > 5 * 1024 ** 2) ilFail('CONTRACT_TOO_LARGE');
  const ids = new Set<string>(),
    routes = new Set<string>();
  for (const shape of Object.values(contract.schemas)) validateShape(shape, contract.schemas);
  for (const op of contract.operations) {
    if (ids.has(op.operationId) || routes.has(op.method + ' ' + op.path)) ilFail('DUPLICATE_OPERATION');
    ids.add(op.operationId);
    routes.add(op.method + ' ' + op.path);
    const slots = [...op.path.matchAll(/\{([A-Za-z0-9_.:-]+)\}/g)].map((m) => m[1]);
    if (
      op.path.replace(/\{([A-Za-z0-9_.:-]+)\}/g, '').includes('{') ||
      new Set(slots).size !== slots.length ||
      slots.length !== op.pathParameters.length ||
      op.pathParameters.some((p) => !p.required || !slots.includes(p.name))
    )
      ilFail('PATH_PARAMETER_MISMATCH');
    for (const p of [...op.pathParameters, ...op.queryParameters]) {
      validateShape(p.schema, contract.schemas);
      if (!['string', 'number', 'integer', 'boolean'].includes(p.schema.type ?? '')) ilFail('PARAMETER_TYPE');
    }
    if (new Set(op.queryParameters.map((p) => p.name)).size !== op.queryParameters.length)
      ilFail('DUPLICATE_PARAMETER');
    if (op.request) validateShape(op.request, contract.schemas);
    for (const response of op.responses)
      if (response.schema) validateShape(response.schema, contract.schemas);
  }
  return contract;
}
export function compareContracts(before: HttpContract, after: HttpContract) {
  validateContract(before);
  validateContract(after);
  return before.operations.map((old) => {
    const next = after.operations.find((v) => v.operationId === old.operationId);
    const reasons: string[] = [];
    let verdict: 'compatible' | 'breaking' | 'undetermined' = 'compatible';
    if (!next || old.method !== next.method || old.path !== next.path)
      return {
        operationId: old.operationId,
        verdict: 'breaking' as const,
        reasons: ['OPERATION_REMOVED_OR_CHANGED'],
      };
    if (
      ilHash({ request: old.request, path: old.pathParameters, query: old.queryParameters }) !==
      ilHash({ request: next.request, path: next.pathParameters, query: next.queryParameters })
    ) {
      verdict = 'undetermined';
      reasons.push('REQUEST_CONSTRAINTS_CHANGED');
    }
    for (const response of old.responses) {
      const r = next.responses.find((v) => v.status === response.status);
      if (!r) {
        verdict = 'breaking';
        reasons.push('EXPECTED_STATUS_REMOVED');
        continue;
      }
      if (response.mediaType !== r.mediaType) {
        verdict = 'breaking';
        reasons.push('MEDIA_TYPE_CHANGED');
      }
      if (response.schema?.type === 'object' && r.schema?.type === 'object') {
        for (const key of response.schema.required ?? [])
          if (!(r.schema.required ?? []).includes(key) || !r.schema.properties?.[key]) {
            verdict = 'breaking';
            reasons.push('REQUIRED_RESPONSE_FIELD_REMOVED:' + key);
          }
        if (response.schema.additionalProperties === false)
          for (const key of Object.keys(r.schema.properties ?? {}))
            if (!response.schema.properties?.[key]) {
              verdict = 'breaking';
              reasons.push('CLOSED_RESPONSE_FIELD_ADDED:' + key);
            }
      }
      if (ilHash(response.schema) !== ilHash(r.schema) && verdict !== 'breaking') {
        verdict = 'undetermined';
        reasons.push('RESPONSE_CONSTRAINTS_CHANGED');
      }
    }
    if (ilHash(before.schemas) !== ilHash(after.schemas) && verdict !== 'breaking') {
      verdict = 'undetermined';
      reasons.push('NAMED_SCHEMAS_CHANGED');
    }
    return { operationId: old.operationId, verdict, reasons };
  });
}
export function pointer(value: unknown, path: string): unknown {
  if (!path) return value;
  for (const token of path
    .slice(1)
    .split('/')
    .map((v) => v.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, token)) return undefined;
    value = (value as Record<string, unknown>)[token];
  }
  return value;
}
export function compileScenario(scenario: IntegrationScenario, contract: HttpContract) {
  const nodes = new Map(scenario.nodes.map((n) => [n.id, n]));
  if (nodes.size !== scenario.nodes.length) ilFail('DUPLICATE_NODE');
  const order: string[] = [],
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (order.includes(id)) return;
    if (visiting.has(id)) ilFail('SCENARIO_CYCLE');
    const node = nodes.get(id);
    if (!node) ilFail('NODE_NOT_FOUND');
    visiting.add(id);
    for (const dep of node.after) visit(dep);
    visiting.delete(id);
    order.push(id);
  };
  for (const n of scenario.nodes) visit(n.id);
  const ancestors = (id: string): Set<string> =>
    new Set(nodes.get(id)!.after.flatMap((d) => [d, ...ancestors(d)]));
  for (const node of scenario.nodes) {
    const op = contract.operations.find((o) => o.operationId === node.operationId);
    if (!op) ilFail('OPERATION_NOT_FOUND');
    const deps = ancestors(node.id);
    if (node.condition && !deps.has(node.condition.node)) ilFail('CONDITION_NOT_ANCESTOR');
    for (const binding of node.bindings) {
      if (!deps.has(binding.from)) ilFail('BINDING_NOT_ANCESTOR');
      validateShape(binding.shape);
      if (binding.shape.ref) ilFail('BINDING_REFERENCE_FORBIDDEN');
      if (
        (binding.shape.type === 'string' && binding.shape.maxLength === undefined) ||
        (['number', 'integer'].includes(binding.shape.type ?? '') &&
          !binding.shape.enum &&
          (binding.shape.minimum === undefined || binding.shape.maximum === undefined))
      )
        ilFail('BINDING_RANGE_REQUIRED');
      if (!['string', 'number', 'integer', 'boolean'].includes(binding.shape.type ?? ''))
        ilFail('BINDING_SCALAR_REQUIRED');
      const fields =
        binding.to === 'body'
          ? op.request?.properties
          : Object.fromEntries(
              (binding.to === 'path' ? op.pathParameters : op.queryParameters).map((p) => [p.name, p.schema]),
            );
      if (!fields || !Object.hasOwn(fields, binding.field)) ilFail('BINDING_DESTINATION_UNDECLARED');
    }
  }
  return { order, digest: ilHash({ scenario, contract, order, execution: 'serial-v1' }) };
}
export function bindRequest(
  scenario: IntegrationScenario,
  contract: HttpContract,
  nodeId: string,
  evidence: IntegrationEvidence[],
  fixtures: IntegrationFixture[] = [],
) {
  const node = scenario.nodes.find((n) => n.id === nodeId);
  if (!node) ilFail('NODE_NOT_FOUND');
  const op = contract.operations.find((o) => o.operationId === node.operationId)!;
  const path = structuredClone(node.path),
    query = structuredClone(node.query);
  let body = structuredClone(node.fixture ? fixtures[node.fixture.index]?.rows[node.fixture.row] : node.body);
  if (body === undefined) ilFail('SCENARIO_FIXTURE_INVALID');
  for (const binding of node.bindings) {
    const source = evidence.find((e) => e.node === binding.from && e.complete);
    const value = source && pointer(source.body, binding.pointer);
    if (!matches(value, binding.shape)) ilFail('BINDING_OUT_OF_SCOPE');
    const target = binding.to === 'path' ? path : binding.to === 'query' ? query : body;
    if (
      !target ||
      typeof target !== 'object' ||
      Array.isArray(target) ||
      ['__proto__', 'constructor', 'prototype'].includes(binding.field)
    )
      ilFail('BINDING_OUT_OF_SCOPE');
    (target as Record<string, IntegrationJson>)[binding.field] = value as IntegrationJson;
  }
  let route = op.path;
  for (const p of op.pathParameters) {
    if (!matches(path[p.name], p.schema, contract.schemas)) ilFail('REQUEST_PARAMETER_INVALID');
    route = route.replace('{' + p.name + '}', encodeURIComponent(String(path[p.name])));
  }
  const q = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const p = op.queryParameters.find((p) => p.name === key);
    if (!p || !matches(query[key], p.schema, contract.schemas)) ilFail('REQUEST_PARAMETER_INVALID');
    q.append(key, String(query[key]));
  }
  for (const p of op.queryParameters)
    if (p.required && !Object.hasOwn(query, p.name)) ilFail('REQUEST_PARAMETER_INVALID');
  if (op.request ? !matches(body, op.request, contract.schemas) : body !== null)
    ilFail('REQUEST_BODY_INVALID');
  if (ilBytes(body) > 1024 ** 2) ilFail('REQUEST_BODY_TOO_LARGE');
  return {
    node: node.id,
    method: op.method,
    path: route + (q.size ? '?' + q.toString() : ''),
    body,
    bodyDigest: ilHash(body),
    effect: op.effect,
  };
}
