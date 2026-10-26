/** 受限设计变量求值与CSS编译；evaluates typed design tokens and compiles fixed CSS. */
import {
  type Data,
  cancelled,
  digest,
  graph,
  list,
  number,
  object,
  reject,
  rows,
  strings,
  text,
  unique,
} from './seventh-creation-common.ts';

const cssIdentifier = (v: unknown) => {
  const name = text(v, 128);
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) reject('DESIGN_CSS_IDENTIFIER');
  return name;
};
function resolve(input: Data) {
  const tokens = rows(input.tokens, 5000);
  const byId = new Map(tokens.map((t) => [text(t.id), t]));
  unique(tokens.map((t) => text(t.id)));
  const order = graph(
    tokens.map((t) => ({ id: text(t.id), deps: typeof t.alias === 'string' ? [t.alias] : [] })),
  );
  const values: Data = {};
  for (const id of order) {
    const token = byId.get(id)!;
    let value = token.alias ? values[text(token.alias)] : token.value;
    if (token.alias && byId.get(text(token.alias))!.type !== token.type) reject('DESIGN_ALIAS_TYPE');
    if (token.type === 'color') {
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value))
        reject('DESIGN_COLOR');
    } else if (token.type === 'length') {
      if (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:px|rem|em|%)$/.test(value)) reject('DESIGN_LENGTH');
    } else if (token.type === 'number') number(value, -100000, 100000);
    else if (token.type === 'font') {
      if (typeof value !== 'string' || !/^[\p{L}\p{N} ,_-]{1,128}$/u.test(value)) reject('DESIGN_FONT');
    } else reject('DESIGN_TOKEN_TYPE');
    values[id] = value;
  }
  return { values, order, digest: digest(values) };
}
function inspectSvg(value: unknown) {
  const svg = text(value, 262144);
  if (/<!|<\?|\bon\w+\s*=|(?:href|src)\s*=|url\s*\(|(?:javascript|data):/i.test(svg))
    reject('DESIGN_SVG_UNSAFE');
  const allowed = new Set([
    'svg',
    'g',
    'path',
    'circle',
    'rect',
    'line',
    'polyline',
    'polygon',
    'ellipse',
    'title',
    'desc',
  ]);
  const attributes = new Set([
    'xmlns',
    'viewBox',
    'width',
    'height',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'fill-rule',
    'clip-rule',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'd',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'points',
    'transform',
    'id',
    'role',
    'aria-label',
  ]);
  for (const tag of svg.matchAll(/<[a-zA-Z][\w:-]*\b([^<>]*)>/g)) {
    const attrs = tag[1].replace(/\/\s*$/, '');
    let end = 0;
    for (const attr of attrs.matchAll(/([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g)) {
      if (attrs.slice(end, attr.index).trim()) reject('DESIGN_SVG_ATTRIBUTE');
      if (!attributes.has(attr[1])) reject('DESIGN_SVG_ATTRIBUTE');
      end = attr.index! + attr[0].length;
    }
    if (attrs.slice(end).trim()) reject('DESIGN_SVG_ATTRIBUTE');
  }
  let nodes = 0;
  for (const match of svg.matchAll(/<\/?\s*([\w:-]+)/g)) {
    if (!allowed.has(match[1])) reject('DESIGN_SVG_ELEMENT');
    if (++nodes > 5000) reject('DESIGN_SVG_LIMIT');
  }
  if (!/^\s*<svg\b/.test(svg) || !/<\/svg>\s*$/.test(svg)) reject('DESIGN_SVG_ROOT');
  return { svg, digest: digest(svg), nodes, passed: true };
}
export function computeDesign(action: string, input: Data, signal?: AbortSignal): unknown {
  cancelled(signal);
  if (action === 'tokens.resolve') return resolve(input);
  if (action === 'icons.inspect') return inspectSvg(input.svg);
  if (action === 'themes.validate') {
    const base = resolve(input);
    const ids = new Set(Object.keys(base.values));
    const themes = rows(input.themes, 12);
    unique(themes.map((t) => text(t.id)));
    const results = themes.map((t) => {
      const overrides = object(t.overrides ?? {});
      for (const k of Object.keys(overrides)) if (!ids.has(k)) reject('DESIGN_THEME_UNKNOWN_TOKEN');
      const merged = rows(input.tokens).map((token) =>
        Object.hasOwn(overrides, text(token.id))
          ? { ...token, alias: undefined, value: overrides[text(token.id)] }
          : token,
      );
      return { id: t.id, ...resolve({ tokens: merged }) };
    });
    return { base, themes: results, passed: true };
  }
  if (action === 'states.checkCoverage') {
    const required = strings(input.required, 6400);
    const examples = strings(input.examples, 10000);
    return {
      total: required.length,
      covered: required.filter((s) => examples.includes(s)),
      missing: required.filter((s) => !examples.includes(s)),
      passed: required.length > 0 && required.every((s) => examples.includes(s)),
    };
  }
  if (action === 'builds.start') {
    const resolved = resolve(input);
    const namespace = input.namespace ? cssIdentifier(input.namespace) : 'sakura';
    const lines = Object.entries(resolved.values).map(
      ([id, v]) => `  --${namespace}-${cssIdentifier(id)}: ${String(v)};`,
    );
    const components = rows(input.components ?? [], 200);
    for (const c of components) {
      if (!['text', 'button', 'input', 'select', 'container', 'table', 'status'].includes(text(c.kind)))
        reject('DESIGN_COMPONENT_KIND');
      cssIdentifier(c.id);
    }
    const css = `:root {\n${lines.join('\n')}\n}\n`;
    return {
      files: [
        { path: 'tokens.css', text: css, digest: digest(css) },
        { path: 'tokens.json', text: JSON.stringify(resolved.values, null, 2) },
      ],
      components,
      tokenDigest: resolved.digest,
      layoutMeasured: false,
    };
  }
  if (action === 'checks.evaluate') {
    const problems: Data[] = [];
    for (const item of rows(input.boxes ?? [], 10000)) {
      const width = number(item.width, 0),
        min = number(item.minWidth ?? 0, 0);
      if (width < min) problems.push({ id: item.id, code: 'STATIC_MIN_WIDTH', width, min });
    }
    return {
      passed: problems.length === 0,
      problems,
      scope: 'static dimensional constraints',
      layoutMeasured: false,
    };
  }
  reject('CREATION_ACTION_UNSUPPORTED');
}
