/** Conservative JSON Schema conversion: an unsupported or absent shape stays unknown. */
type Schema = Record<string, any> | boolean;
export function schemaType(schema: Schema | undefined, root: Schema = schema || {}, references = new Set<string>()): string {
  if (schema === false) return 'never';
  if (!schema || schema === true) return 'unknown';
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/') || references.has(schema.$ref)) return 'unknown';
    const pointer = schema.$ref.slice(2).split('/').map((part: string) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    const resolved = pointer.reduce((value: any, key: string) => value?.[key], root);
    return schemaType(resolved, root, new Set([...references, schema.$ref]));
  }
  if ('const' in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map((value: unknown) => JSON.stringify(value)).join(' | ') || 'never';
  const union = schema.oneOf || schema.anyOf;
  if (union) return union.map((part: Schema) => '(' + schemaType(part, root, references) + ')').join(' | ');
  if (schema.allOf) return schema.allOf.map((part: Schema) => '(' + schemaType(part, root, references) + ')').join(' & ');
  if (Array.isArray(schema.type)) return schema.type.map((type: string) => schemaType({ ...schema, type }, root, references)).join(' | ');
  if (schema.type === 'string') return 'string';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'null') return 'null';
  if (schema.type === 'array') {
    if (schema.prefixItems) return '[' + schema.prefixItems.map((part: Schema) => schemaType(part, root, references)).join(', ') + ']';
    return 'Array<' + schemaType(schema.items, root, references) + '>';
  }
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    const required = new Set(schema.required || []);
    const properties = Object.entries(schema.properties || {}).map(([key, value]) =>
      JSON.stringify(key) + (required.has(key) ? '' : '?') + ': ' + schemaType(value as Schema, root, references));
    if (schema.additionalProperties !== false)
      properties.push('[key: string]: ' + schemaType(typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined, root, references));
    return properties.length ? '{ ' + properties.join('; ') + ' }' : 'Record<string, never>';
  }
  return 'unknown';
}
