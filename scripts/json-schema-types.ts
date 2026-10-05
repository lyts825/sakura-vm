/** Conservative JSON Schema conversion: an unsupported or absent shape stays unknown. */
type Schema = Record<string, any> | boolean;
type ReferenceResolver = (reference: string) => string | undefined;
/** Reject unbounded wire values before generating either HTTP or WebSocket clients. */
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
export function schemaTypeRegistry() {
  const roots = new Map<string, string>();
  const declarations = new Map<string, string>();
  return {
    add(schema: Schema | undefined): string {
      if (schema === undefined) return 'unknown';
      const key = JSON.stringify(schema);
      const existing = roots.get(key);
      if (existing) return existing;
      const name = 'Contract' + roots.size;
      roots.set(key, name);
      const references = new Map<string, string>([['#', name]]);
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
    source: () => [...declarations].map(([name, type]) => 'type ' + name + ' = ' + type + ';').join('\n'),
  };
}
