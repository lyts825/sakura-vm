/** 固定记录的本地有界图形预览；不载入地图、脚本或远程样式。 */
import { createContext, useContext, useMemo } from 'react';
import type { SuiteRef } from '../shared/contracts/suite-common.ts';
import { SeventhFormPreview } from './SeventhFormPreview.tsx';
export type SeventhVisualPost = <T>(domain: string, action: string, body: unknown, signal?: AbortSignal) => Promise<T>;
export const SeventhVisualContext = createContext<{ packId: string; workspaceId: string; post: SeventhVisualPost } | null>(null);
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : null;
const objects = (value: unknown) => Array.isArray(value) ? value.map(object).filter((item): item is Obj => !!item) : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';
const bound = (value: unknown, length = 120) => String(value ?? '').slice(0, length);
const escapedCharacters: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => escapedCharacters[char]);
function BindingLabel({ source }: { source?: SuiteRef }) { return <p className="sv-hint">{source ? <>原固定记录：<code>{source.domain} / {source.id} / {source.revision}</code></> : '当前固定输入的交互预览；尚未形成正式版本。'}</p>; }
function findLayers(value: unknown): Obj[] {
  const candidates: Obj[] = [], seen = new Set<unknown>();
  const visit = (item: unknown, depth: number) => { const row = object(item); if (!row || depth > 3 || seen.has(item) || seen.size > 40) return; seen.add(item); if (Array.isArray(row.features) && (row.crs || row.type === 'FeatureCollection')) candidates.push(row); else for (const key of ['layer', 'left', 'right', 'payload', 'input', 'output', 'source', 'target']) visit(row[key], depth + 1); };
  visit(value, 0); return candidates.slice(0, 4);
}
type Point = [number, number];
function GeoPreview({ layer, index }: { layer: Obj; index: number }) {
  const features = objects(layer.features), selected = features.slice(0, 200), crs = object(layer.crs), swap = crs?.axis === 'yx';
  let points = 0, invalid = false;
  const geometry = (value: unknown): { kind: string; points: Point[]; paths: Point[][]; polygons: Point[][][] } | null => {
    const row = object(value); if (!row) return null;
    const pair = (value: unknown): Point | null => { if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 2).every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) < 1e150)) { invalid = true; return null; } if (++points > 20000) { invalid = true; return null; } return swap ? [value[1], value[0]] : [value[0], value[1]]; };
    const line = (value: unknown): Point[] => Array.isArray(value) ? value.map(pair).filter((item): item is Point => item !== null) : [];
    const lines = (value: unknown) => Array.isArray(value) ? value.map(line) : [];
    const kind = text(row.type), coordinates = row.coordinates;
    if (kind === 'Point') { const p = pair(coordinates); return { kind, points: p ? [p] : [], paths: [], polygons: [] }; }
    if (kind === 'MultiPoint') return { kind, points: line(coordinates), paths: [], polygons: [] };
    if (kind === 'LineString') return { kind, points: [], paths: [line(coordinates)], polygons: [] };
    if (kind === 'MultiLineString') return { kind, points: [], paths: lines(coordinates), polygons: [] };
    if (kind === 'Polygon') return { kind, points: [], paths: [], polygons: [lines(coordinates)] };
    if (kind === 'MultiPolygon') return { kind, points: [], paths: [], polygons: Array.isArray(coordinates) ? coordinates.map(lines) : [] };
    invalid = true; return null;
  };
  const shapes = selected.map(feature => ({ id: bound(feature.id ?? object(feature.properties)?.id ?? 'geometry'), geometry: geometry(feature.geometry) }));
  const all = shapes.flatMap(shape => shape.geometry ? [...shape.geometry.points, ...shape.geometry.paths.flat(), ...shape.geometry.polygons.flat(2)] : []);
  if (!all.length || invalid) return <p className="sv-hint">图层 {index + 1} 无法完整绘制：预览仅支持六类二维 GeoJSON 几何，每层最多 200 个要素、20,000 个坐标点；超限或无效坐标请查看原记录。</p>;
  const xs = all.map(point => point[0]), ys = all.map(point => point[1]), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), scale = Math.min(600 / (maxX - minX || 1), 320 / (maxY - minY || 1));
  const project = ([x, y]: Point) => [60 + (600 - (maxX - minX) * scale) / 2 + (x - minX) * scale, 30 + (320 - (maxY - minY) * scale) / 2 + (maxY - y) * scale];
  const path = (line: Point[], closed = false) => line.map((point, index) => (index ? 'L' : 'M') + project(point).join(',')).join(' ') + (closed ? ' Z' : '');
  return <section className="sv-visual"><h3>本地图层 {index + 1}</h3><p className="sv-hint">{selected.length} / {features.length} 个要素 · {points} 个坐标 · {String(crs?.code ?? 'GeoJSON 原坐标')} · {String(crs?.unit ?? '声明单位')}。{features.length > selected.length ? '仅显示前 200 个要素。' : ''}等比例坐标图，不联网，不作为距离或面积测量。</p><svg viewBox="0 0 720 410" role="img" aria-label={`图层 ${index + 1} 的本地坐标预览`}><path d="M60 20 V360 H680" fill="none" stroke="currentColor" opacity=".5" />{shapes.map((shape, index) => <g key={index} stroke={['#a74470', '#4274aa', '#538460', '#a97e36'][index % 4]} fill={['#a7447025', '#4274aa25', '#53846025', '#a97e3625'][index % 4]}><title>{shape.id}</title>{shape.geometry?.polygons.map((polygon, i) => <path key={'polygon' + i} d={polygon.map(ring => path(ring, true)).join(' ')} fillRule="evenodd" strokeWidth="1.5" />)}{shape.geometry?.paths.map((line, i) => <path key={'line' + i} d={path(line)} fill="none" strokeWidth="2" />)}{shape.geometry?.points.map((point, i) => { const [cx, cy] = project(point); return <circle key={'point' + i} cx={cx} cy={cy} r="4" />; })}</g>)}<text x="60" y="382">X {minX.toPrecision(6)} … {maxX.toPrecision(6)}</text><text x="60" y="400">Y {minY.toPrecision(6)} … {maxY.toPrecision(6)}</text></svg></section>;
}
function graphOf(value: unknown): { nodes: Obj[]; edges: Obj[]; directed: boolean } | null {
  const row = object(value); if (!row) return null;
  if (Array.isArray(row.nodes) && row.nodes.every(node => object(node) && typeof object(node)?.id === 'string') && Array.isArray(row.edges)) return { nodes: objects(row.nodes), edges: objects(row.edges), directed: row.directed !== false };
  if (Array.isArray(row.assets) && Array.isArray(row.assertions)) return { nodes: objects(row.assets), edges: objects(row.assertions).filter(edge => edge.decision === 'accepted' && edge.claim === 'exists'), directed: true };
  return graphOf(row.graph) ?? graphOf(row.left) ?? graphOf(row.right);
}
function GraphPreview({ graph, output }: { graph: NonNullable<ReturnType<typeof graphOf>>; output: Obj }) {
  const nodes = graph.nodes.slice(0, 160), known = new Set(nodes.map(node => text(node.id))), edges = graph.edges.filter(edge => known.has(text(edge.source)) && known.has(text(edge.target))).slice(0, 320);
  const coordinates = new Map(objects(output.coordinates).map(point => [text(point.id), point]));
  const positions = new Map(nodes.map((node, index) => { const angle = index * 2 * Math.PI / Math.max(1, nodes.length); return [text(node.id), { x: 360 + Math.cos(angle) * 275, y: 210 + Math.sin(angle) * 160 }]; }));
  const highlighted = new Set([...objects(output.affected).map(row => text(row.id)), ...(Array.isArray(output.nodes) ? output.nodes.filter((row): row is string => typeof row === 'string') : [])]);
  return <section className="sv-visual"><h3>关系图与血缘预览</h3><p className="sv-hint">显示 {nodes.length} / {graph.nodes.length} 个节点、{edges.length} / {graph.edges.length} 条边。按声明节点顺序作圆形显示布局；关系来自固定输入，着色为输出涉及节点，不代表因果关系。{coordinates.size ? '原结果另保留布局坐标。' : ''}</p><svg viewBox="0 0 720 430" role="img" aria-label="固定关系图预览">{edges.map((edge, index) => { const a = positions.get(text(edge.source))!, b = positions.get(text(edge.target))!; const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || 1, tx = b.x - dx / distance * 11, ty = b.y - dy / distance * 11; return <g key={index} stroke="#8c8396" fill="#8c8396"><title>{bound(edge.id)} · {bound(edge.source)} → {bound(edge.target)}</title><line x1={a.x} y1={a.y} x2={tx} y2={ty} opacity=".55" />{graph.directed && <path d={`M${tx},${ty} l${-dx / distance * 7 - dy / distance * 3},${-dy / distance * 7 + dx / distance * 3} l${dy / distance * 6},${-dx / distance * 6} Z`} />}</g>; })}{nodes.map(node => { const position = positions.get(text(node.id))!; return <g key={text(node.id)}><title>{String(node.id)}</title><circle cx={position.x} cy={position.y} r="7" fill={highlighted.has(text(node.id)) ? '#a74470' : '#5682a9'} /><text x={position.x + 10} y={position.y + 4}>{bound(node.id, 18)}</text></g>; })}</svg></section>;
}
const csp = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; font-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'";
function safeHtml(html: string) {
  const document = new DOMParser().parseFromString(html.slice(0, 200000), 'text/html');
  const tags = new Set(['DIV','SPAN','P','SECTION','ARTICLE','HEADER','FOOTER','MAIN','H1','H2','H3','H4','H5','H6','BUTTON','INPUT','SELECT','OPTION','LABEL','TABLE','THEAD','TBODY','TR','TH','TD','UL','OL','LI','PRE','CODE','STRONG','EM','SMALL','BR','HR']);
  for (const element of Array.from(document.querySelectorAll('script,style,link,meta,base,iframe,object,embed,template,form'))) element.remove();
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (!tags.has(element.tagName)) { element.replaceWith(document.createTextNode(element.textContent ?? '')); continue; }
    for (const attribute of Array.from(element.attributes)) if (!['id','class','style','type','value','placeholder','disabled','checked','selected','role','aria-label','colspan','rowspan'].includes(attribute.name)) element.removeAttribute(attribute.name);
  }
  return document.body.innerHTML;
}
function DesignPreview({ output }: { output: Obj }) {
  const files = objects(output.files), cssFile = files.find(file => text(file.path).endsWith('.css')), htmlFile = files.find(file => text(file.path).endsWith('.html'));
  const components = objects(output.components).slice(0, 100);
  const html = useMemo(() => {
    const generated = components.map(component => { const label = escape(component.label ?? component.name ?? component.id), kind = component.kind; return kind === 'button' ? `<button>${label}</button>` : kind === 'input' ? `<label>${label}<input placeholder="${label}"></label>` : kind === 'select' ? `<label>${label}<select><option>示例选项</option></select></label>` : kind === 'status' ? `<p role="status">${label}</p>` : `<div>${label}</div>`; }).join('\n');
    const body = htmlFile ? safeHtml(text(htmlFile.text)) : generated || '<p>当前构建仅包含样式变量；下方为本地控件样本。</p><button>示例按钮</button><label>输入样本 <input placeholder="本地静态预览"></label>';
    const css = text(cssFile?.text).slice(0, 200000).replace(/<\/style/gi, '<\\/style');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><style>body{font:14px system-ui;padding:20px;color:#27232b;background:white}button,input,select{font:inherit;margin:8px;padding:10px;border:1px solid #b9a9b4;border-radius:7px} ${css}</style></head><body>${body}</body></html>`;
  }, [output]);
  return <section className="sv-visual"><h3>设计产物静态预览</h3><p className="sv-hint">{components.length} / {objects(output.components).length} 个组件，CSS / HTML 各最多 200,000 字符。独立空 sandbox，脚本、网络、表单提交均被禁用；此显示不替代尺寸验收。</p><iframe title="设计产物的隔离静态预览" sandbox="" referrerPolicy="no-referrer" srcDoc={html} /></section>;
}
export function SeventhVisual({ value, source, definition }: { value: unknown; source?: SuiteRef; definition?: Obj }) {
  const context = useContext(SeventhVisualContext), row = object(value); if (!row) return null;
  const content = object(row.content) ?? row, output = object(content.output) ?? content;
  const layers = findLayers(output), inputLayers = layers.length ? [] : findLayers(definition);
  const graph = graphOf(output) ?? graphOf(definition);
  const design = objects(output.files).some(file => /\.(css|html)$/.test(text(file.path)));
  const form = context?.packId === 'form-flow-studio' && definition && Array.isArray(definition.fields);
  if (!layers.length && !inputLayers.length && !graph && !design && !form) return null;
  return <div className="sv-visuals"><BindingLabel source={source} />{inputLayers.length > 0 && <p className="sv-hint">图中展示此记录绑定的输入图层；派生结果和验证结论见下方完整表格。</p>}{[...layers, ...inputLayers].map((layer, index) => <GeoPreview key={index} layer={layer} index={index} />)}{graph && <GraphPreview graph={graph} output={output} />}{design && <DesignPreview output={output} />}{form && context && <SeventhFormPreview definition={definition} source={source} post={context.post} workspaceId={context.workspaceId} />}</div>;
}
