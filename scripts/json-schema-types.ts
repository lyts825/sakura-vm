/** 将可支持的 JSON Schema wire 形状转成去重 TypeScript 类型，明确拒绝无法表达的契约以避免退化成 unknown。
 * Convert supported JSON Schema wire shapes into deduplicated TypeScript types and refuse unrepresentable contracts rather than silently using unknown. */
/** Conservative JSON Schema conversion: an unsupported or absent shape stays unknown. */
type Schema = Record<string, any> | boolean;
type ReferenceResolver = /** 把 JSON Schema 引用路径解析成已知 TypeScript 类型名；无法在既定目录定位的引用返回 undefined，让类型投影显式采用未解析策略。
 * Resolve a JSON Schema reference path to a known TypeScript type name; unknown catalog references return undefined for explicit unresolved-reference handling. */ (reference: string) => string | undefined;
/** Reject unbounded wire values before generating either HTTP or WebSocket clients. */
/** 递归核对 schema 的显式形状和全部嵌套成员，拒绝无界/缺失 wire 值；false/空 not 表示不能取值。
 * Recursively validate explicit schema shapes/nested members, refusing unbounded/absent wire values; false/empty not denotes no possible value. */
export function requireWireShape(schema: unknown, path: string) {
  if (schema === false) return;
  if (schema === true || !schema || typeof schema !== 'object') throw new Error('Unbounded wire schema: ' + path);
  const value = schema as Record<string, any>;
  if (value.not && typeof value.not === 'object' && Object.keys(value.not).length === 0) return;
  if (!value.type && !value.$ref && !('const' in value) && !value.enum && !value.anyOf && !value.oneOf && !value.allOf)
    throw new Error('Missing wire shape: ' + path);
  for (const key of ['properties', '$defs', 'patternProperties'])
    for (const [name, nested] of Object.entries(value[key] || {})) requireWireShape(nested, path + '/' + key + '/' + name);
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems'])
    for (const [index, nested] of (value[key] || []).entries()) requireWireShape(nested, path + '/' + key + '/' + index);
  for (const key of ['items', 'additionalProperties'])
    if (value[key] !== undefined) requireWireShape(value[key], path + '/' + key);
}
/** 把 schema 转为 TS 联合/交叉/tuple/object 等类型，解析本地引用并保留可选成员；无法支持返回 unknown，由生成入口拒绝。
 * Convert schemas to TS unions/intersections/tuples/objects, resolving local refs and optional members; unsupported shapes return unknown for generators to reject. */
export function schemaType(schema: Schema | undefined, root: Schema = schema || {}, references = new Set<string>(), resolveReference?: ReferenceResolver): string {
  if (schema === false) return 'never';
  if (!schema || schema === true) return 'unknown';
  if (schema.not && typeof schema.not === 'object' && Object.keys(schema.not).length === 0) return 'never';
  if (schema.$ref) {
    const named = resolveReference?.(schema.$ref);
    if (named) return named;
    if (!schema.$ref.startsWith('#/') || references.has(schema.$ref)) return 'unknown';
    const pointer = schema.$ref.slice(2).split('/').map((part: string) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    const resolved = pointer.reduce((value: any, key: string) => value?.[key], root);
    return schemaType(resolved, root, new Set([...references, schema.$ref]), resolveReference);
  }
  if ('const' in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map((value: unknown) => JSON.stringify(value)).join(' | ') || 'never';
  const union = schema.oneOf || schema.anyOf;
  if (union) return union.map((part: Schema) => '(' + schemaType(part, root, references, resolveReference) + ')').join(' | ');
  if (schema.allOf) return schema.allOf.map((part: Schema) => '(' + schemaType(part, root, references, resolveReference) + ')').join(' & ');
  if (Array.isArray(schema.type)) return schema.type.map((type: string) => schemaType({ ...schema, type }, root, references, resolveReference)).join(' | ');
  if (schema.type === 'string') return 'string';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'null') return 'null';
  if (schema.type === 'array') {
    if (schema.prefixItems) return '[' + schema.prefixItems.map((part: Schema) => schemaType(part, root, references, resolveReference)).join(', ') + ']';
    return 'Array<' + schemaType(schema.items, root, references, resolveReference) + '>';
  }
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    const required = new Set(schema.required || []);
    const members = Object.entries(schema.properties || {}).map(([key, value]) => ({ key,
      type: schemaType(value as Schema, root, references, resolveReference) }));
    const properties = members.map(({ key, type }) => JSON.stringify(key) + (required.has(key) ? '' : '?') + ': ' + type);
    if (schema.additionalProperties !== false) {
      // A TS string index also covers named properties, unlike JSON Schema's additionalProperties.
      // Include their exact types so nested optional extension members remain representable.
      const values = new Set([schemaType(typeof schema.additionalProperties === 'object'
        ? schema.additionalProperties : undefined, root, references, resolveReference), ...members.map(member => member.type)]);
      if (members.some(member => !required.has(member.key))) values.add('undefined');
      properties.push('[key: string]: ' + [...values].map(value => '(' + value + ')').join(' | '));
    }
    return properties.length ? '{ ' + properties.join('; ') + ' }' : 'Record<string, never>';
  }
  return 'unknown';
}

/** Preserve recursive JSON values and recursive DTOs as named aliases, not unknown. */
/** 按 schema JSON 字节去重根类型，预登记命名引用以保留递归 DTO，返回 add/source 生成接口。
 * Deduplicate roots by schema JSON, preregister named refs to preserve recursive DTOs and return add/source generation operations. */
export function schemaTypeRegistry() {
  const roots = new Map<string, string>();
  const declarations = new Map<string, string>();
  return {
    /** 复用已登记 schema 别名，否则先预留根名再解析引用声明，递归引用不退化为 unknown。
     * Reuse registered schema aliases or reserve a root name before resolving reference declarations so recursion does not degrade to unknown. */
    add(schema: Schema | undefined): string {
      if (schema === undefined) return 'unknown';
      const key = JSON.stringify(schema);
      const existing = roots.get(key);
      if (existing) return existing;
      const name = 'Contract' + roots.size;
      roots.set(key, name);
      const references = new Map<string, string>([['#', name]]);
      /** 在当前根 schema 中解析命名引用，先登记别名避免环；外部/缺失引用抛错，不生成不完整契约。
       * Resolve named refs inside the current root and preregister aliases against cycles; external/missing refs throw rather than emitting incomplete contracts. */
      const render = (target: Schema) => schemaType(target, schema, new Set(), reference => {
        const present = references.get(reference);
        if (present) return present;
        if (!reference.startsWith('#/')) throw new Error('Unsupported public schema reference: ' + reference);
        const keys = reference.slice(2).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
        const resolved = keys.reduce<any>((value, part) => value?.[part], schema);
        if (resolved === undefined) throw new Error('Unresolved public schema reference: ' + reference);
        const alias = name + 'Ref' + references.size;
        references.set(reference, alias);
        declarations.set(alias, render(resolved));
        return alias;
      });
      declarations.set(name, render(schema));
      return name;
    },
    /** 按登记顺序输出全部命名 wire 类型声明，根与引用保持稳定可追溯。
     * Emit all named wire declarations in registration order, keeping roots/references deterministic and traceable. */
    source: () => [...declarations].map(([name, type]) => 'type ' + name + ' = ' + type + ';').join('\n'),
  };
}
