/** 明确坐标与单位的二维矢量处理；布尔拓扑与缓冲使用固定库。 */
import { z } from 'zod';
import clipping from 'polygon-clipping';
import { buffer as turfBuffer } from '@turf/buffer';
import jsts from '@turf/jsts';
import type { Feature, Geometry } from 'geojson';
import {
  dataCompare,
  dataId,
  dataRow,
  dataError,
  checkDataSignal,
  uniqueDataIds,
  stableData,
} from '../shared/seventh-data-contracts.ts';

type Position = [number, number];
type Ring = Position[];
type Poly = Ring[];
type Multi = Poly[];
const position = z.tuple([z.number().finite(), z.number().finite()]);
const line = z.array(position).min(2).max(100001),
  ring = z.array(position).min(3).max(100001);
const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }).strict(),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position).max(100000) }).strict(),
  z.object({ type: z.literal('LineString'), coordinates: line }).strict(),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(line).max(100000) }).strict(),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(10000) }).strict(),
  z
    .object({
      type: z.literal('MultiPolygon'),
      coordinates: z.array(z.array(ring).min(1).max(10000)).max(100000),
    })
    .strict(),
]);
type Geo = z.infer<typeof geometrySchema>;
const crsSchema = z
  .object({
    code: z.enum(['EPSG:4326', 'EPSG:3857', 'LOCAL']),
    axis: z.enum(['xy', 'yx']),
    unit: z.enum(['degree', 'meter']),
  })
  .strict();
const geoFeature = z
  .object({
    type: z.literal('Feature').default('Feature'),
    id: dataId,
    properties: dataRow.default({}),
    geometry: geometrySchema,
  })
  .strict();
const layerSchema = z.object({ crs: crsSchema, features: z.array(geoFeature).max(100000) }).strict();
type Layer = z.infer<typeof layerSchema>;
const EARTH = 6371008.8,
  MERCATOR = 6378137,
  RAD = Math.PI / 180;
const samePoint = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
function mapGeo(geometry: Geo, fn: (p: Position) => Position): Geo {
  if (geometry.type === 'Point') return { type: geometry.type, coordinates: fn(geometry.coordinates) };
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString')
    return { type: geometry.type, coordinates: geometry.coordinates.map(fn) };
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon')
    return { type: geometry.type, coordinates: geometry.coordinates.map((ring) => ring.map(fn)) };
  return {
    type: geometry.type,
    coordinates: geometry.coordinates.map((poly) => poly.map((ring) => ring.map(fn))),
  };
}
function points(geometry: Geo): Position[] {
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') return geometry.coordinates;
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates.flat();
  return geometry.coordinates.flat(2);
}
function lines(geometry: Geo): Ring[] {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}
function polygons(geometry: Geo): Multi {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  dataError('GEO_POLYGON_REQUIRED', '此操作只接受 Polygon 或 MultiPolygon');
}
function box(geometry: Geo): [number, number, number, number] {
  const ps = points(geometry);
  if (!ps.length) return [0, 0, 0, 0];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of ps) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}
const boxesIntersect = (a: number[], b: number[]) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function normalizeLayer(raw: unknown): Layer {
  const layer = layerSchema.parse(raw);
  uniqueDataIds(
    layer.features.map((f) => f.id),
    '要素',
  );
  if ((layer.crs.code === 'EPSG:4326') !== (layer.crs.unit === 'degree'))
    dataError('GEO_CRS_UNIT', '经纬坐标须使用 degree，平面坐标须使用 meter');
  let count = 0;
  const features = layer.features.map((feature) => ({
    ...feature,
    geometry: mapGeo(feature.geometry, (p) => {
      if (++count > 2000000) dataError('GEO_VERTEX_LIMIT', '图层顶点超过 200 万');
      const xy: Position = layer.crs.axis === 'xy' ? [...p] : [p[1], p[0]];
      if (layer.crs.code === 'EPSG:4326' && (Math.abs(xy[0]) > 180 || Math.abs(xy[1]) > 90))
        dataError('GEO_COORDINATE_RANGE', '经纬度超出范围：' + feature.id);
      if (
        layer.crs.code === 'EPSG:3857' &&
        (Math.abs(xy[0]) > Math.PI * MERCATOR || Math.abs(xy[1]) > Math.PI * MERCATOR)
      )
        dataError('GEO_COORDINATE_RANGE', 'Web Mercator 坐标超出支持范围：' + feature.id);
      if (Math.abs(xy[0]) > 1e12 || Math.abs(xy[1]) > 1e12)
        dataError('GEO_COORDINATE_RANGE', '坐标绝对值超过 10^12');
      return xy;
    }),
  }));
  return { crs: { ...layer.crs, axis: 'xy' }, features };
}
function rejectAntimeridian(layer: Layer) {
  if (layer.crs.code === 'EPSG:4326')
    for (const feature of layer.features)
      for (const l of lines(feature.geometry))
        for (let i = 1; i < l.length; i++)
          if (Math.abs(l[i][0] - l[i - 1][0]) > 180)
            dataError('GEO_ANTIMERIDIAN', '首版拒绝未拆分的跨日期变更线几何：' + feature.id);
}
function cross(a: Position, b: Position, c: Position) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(p: Position, a: Position, b: Position, tolerance = 1e-10) {
  return (
    Math.abs(cross(a, b, p)) <= tolerance * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])) &&
    p[0] >= Math.min(a[0], b[0]) - tolerance &&
    p[0] <= Math.max(a[0], b[0]) + tolerance &&
    p[1] >= Math.min(a[1], b[1]) - tolerance &&
    p[1] <= Math.max(a[1], b[1]) + tolerance
  );
}
function intersectSegments(a: Position, b: Position, c: Position, d: Position) {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  return (
    (abC * abD < 0 && cdA * cdB < 0) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  );
}
function ringContains(p: Position, ring: Ring): 'inside' | 'outside' | 'boundary' {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    if (onSegment(p, a, b)) return 'boundary';
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}
function polygonContains(p: Position, poly: Poly): 'inside' | 'outside' | 'boundary' {
  const outer = ringContains(p, poly[0]);
  if (outer !== 'inside') return outer;
  for (const hole of poly.slice(1)) {
    const state = ringContains(p, hole);
    if (state === 'boundary') return 'boundary';
    if (state === 'inside') return 'outside';
  }
  return 'inside';
}
function multiContains(p: Position, multi: Multi) {
  let boundary = false;
  for (const poly of multi) {
    const state = polygonContains(p, poly);
    if (state === 'inside') return 'inside';
    if (state === 'boundary') boundary = true;
  }
  return boundary ? 'boundary' : 'outside';
}
function signedArea(ring: Ring) {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return sum / 2;
}
export function validateGeospatial(raw: unknown, signal?: AbortSignal) {
  const input = z
      .object({ layer: layerSchema, tolerance: z.number().positive().max(0.1).default(1e-10) })
      .strict()
      .parse(raw),
    layer = normalizeLayer(input.layer),
    issues: { feature: string; ring: number | null; kind: string }[] = [];
  let comparisons = 0;
  for (const feature of layer.features) {
    checkDataSignal(signal);
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
    let ringIndex = 0;
    for (const poly of polygons(feature.geometry)) {
      for (const r of poly) {
        const at = ringIndex++;
        if (!samePoint(r[0], r.at(-1)!))
          issues.push({ feature: feature.id, ring: at, kind: 'unclosed-ring' });
        if (Math.abs(signedArea(r)) <= input.tolerance)
          issues.push({ feature: feature.id, ring: at, kind: 'zero-area' });
        const segments = r
          .slice(1)
          .map((b, i) => ({
            a: r[i],
            b,
            index: i,
            minX: Math.min(r[i][0], b[0]),
            maxX: Math.max(r[i][0], b[0]),
            minY: Math.min(r[i][1], b[1]),
            maxY: Math.max(r[i][1], b[1]),
          }))
          .sort((a, b) => a.minX - b.minX);
        let active: typeof segments = [];
        for (const segment of segments) {
          checkDataSignal(signal);
          active = active.filter((a) => a.maxX >= segment.minX);
          for (const a of active) {
            if (++comparisons > 2000000) dataError('GEO_TOPOLOGY_BUDGET', '几何拓扑比较超过 200 万次');
            if (
              Math.abs(a.index - segment.index) <= 1 ||
              (samePoint(r[0], r.at(-1)!) && Math.abs(a.index - segment.index) === r.length - 2)
            )
              continue;
            if (a.maxY < segment.minY || a.minY > segment.maxY) continue;
            if (intersectSegments(a.a, a.b, segment.a, segment.b))
              issues.push({ feature: feature.id, ring: at, kind: 'self-intersection' });
            if (issues.length > 10000) dataError('GEO_ISSUE_LIMIT', '几何错误超过 10000');
          }
          active.push(segment);
        }
      }
      for (const hole of poly.slice(1))
        if (hole.some((p) => ringContains(p, poly[0]) !== 'inside'))
          issues.push({ feature: feature.id, ring: null, kind: 'hole-outside-outer-ring' });
      for (let first = 0; first < poly.length; first++)
        for (let second = first + 1; second < poly.length; second++) {
          checkDataSignal(signal);
          let crosses = false;
          for (let a = 1; a < poly[first].length && !crosses; a++)
            for (let b = 1; b < poly[second].length; b++) {
              if (++comparisons > 2000000) dataError('GEO_TOPOLOGY_BUDGET', '几何拓扑比较超过 200 万次');
              if (
                intersectSegments(poly[first][a - 1], poly[first][a], poly[second][b - 1], poly[second][b])
              ) {
                crosses = true;
                break;
              }
            }
          if (crosses) issues.push({ feature: feature.id, ring: null, kind: 'ring-boundaries-intersect' });
          else if (
            first > 0 &&
            (ringContains(poly[first][0], poly[second]) === 'inside' ||
              ringContains(poly[second][0], poly[first]) === 'inside')
          )
            issues.push({ feature: feature.id, ring: null, kind: 'holes-overlap' });
        }
    }
  }
  return {
    layer,
    issues,
    comparisons,
    verdict: issues.length ? 'failed' : 'passed',
    tolerance: input.tolerance,
    implicitRepair: false,
  };
}
function requireValidGeospatial(layer: Layer, signal?: AbortSignal) {
  const checked = validateGeospatial({ layer }, signal);
  if (checked.issues.length)
    dataError(
      'GEO_INVALID_GEOMETRY',
      '必须先显式修复无效几何：' + checked.issues[0].feature + '/' + checked.issues[0].kind,
    );
}
export function transformGeospatial(raw: unknown, signal?: AbortSignal) {
  const input = z
      .object({ layer: layerSchema, target: z.enum(['EPSG:4326', 'EPSG:3857']) })
      .strict()
      .parse(raw),
    layer = normalizeLayer(input.layer);
  if (layer.crs.code === 'LOCAL') dataError('GEO_TRANSFORM_UNSUPPORTED', 'LOCAL 坐标没有已登记变换资料');
  const features = layer.features.map((feature) => ({
    ...feature,
    geometry: mapGeo(feature.geometry, (p) => {
      checkDataSignal(signal);
      if (layer.crs.code === input.target) return p;
      if (input.target === 'EPSG:3857') {
        if (Math.abs(p[1]) > 85.0511287798066)
          dataError('GEO_MERCATOR_LATITUDE', '纬度超出 Web Mercator 支持范围');
        return [p[0] * RAD * MERCATOR, MERCATOR * Math.log(Math.tan(Math.PI / 4 + (p[1] * RAD) / 2))];
      }
      return [p[0] / MERCATOR / RAD, (2 * Math.atan(Math.exp(p[1] / MERCATOR)) - Math.PI / 2) / RAD];
    }),
  }));
  return {
    layer: {
      crs: { code: input.target, axis: 'xy', unit: input.target === 'EPSG:4326' ? 'degree' : 'meter' },
      features,
    },
    transform: 'spherical-web-mercator-v1',
    sourceCrs: layer.crs,
  };
}
function allPolygons(layer: Layer): Multi {
  const result = layer.features.flatMap((f) => polygons(f.geometry));
  if (result.length > 10000) dataError('GEO_POLYGON_LIMIT', '单次布尔操作最多 10000 个面');
  return result;
}
function unionMulti(multi: Multi): Multi {
  if (!multi.length) return [];
  return clipping.union(multi) as Multi;
}
function checkedOutput(layer: Layer) {
  const normalized = normalizeLayer(layer);
  if (JSON.stringify(normalized).length > 128 * 1024 ** 2)
    dataError('GEO_OUTPUT_LIMIT', '派生图层超过 128 MiB');
  return normalized;
}
function clipLineToMulti(source: Ring, mask: Multi, signal?: AbortSignal): Ring[] {
  const result: Ring[] = [];
  let comparisons = 0;
  for (let i = 1; i < source.length; i++) {
    checkDataSignal(signal);
    const a = source[i - 1],
      b = source[i],
      ts = [0, 1],
      vx = b[0] - a[0],
      vy = b[1] - a[1];
    if (!vx && !vy) continue;
    for (const poly of mask)
      for (const ring of poly)
        for (let j = 1; j < ring.length; j++) {
          if (++comparisons > 2000000) dataError('GEO_CLIP_BUDGET', '线裁剪比较超过 200 万次');
          const c = ring[j - 1],
            d = ring[j],
            wx = d[0] - c[0],
            wy = d[1] - c[1],
            denominator = vx * wy - vy * wx;
          if (Math.abs(denominator) > 1e-16) {
            const t = ((c[0] - a[0]) * wy - (c[1] - a[1]) * wx) / denominator,
              u = ((c[0] - a[0]) * vy - (c[1] - a[1]) * vx) / denominator;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) ts.push(t);
          } else if (onSegment(c, a, b) || onSegment(d, a, b)) {
            const axis = Math.abs(vx) >= Math.abs(vy) ? 0 : 1;
            for (const p of [c, d]) {
              const t = (p[axis] - a[axis]) / (b[axis] - a[axis]);
              if (t >= 0 && t <= 1) ts.push(t);
            }
          }
        }
    const sorted = [...new Set(ts)].sort((a, b) => a - b);
    for (let j = 1; j < sorted.length; j++) {
      const from = sorted[j - 1],
        to = sorted[j];
      if (to - from < 1e-14) continue;
      const pointAt = (t: number): Position => [a[0] + vx * t, a[1] + vy * t];
      if (multiContains(pointAt((from + to) / 2), mask) !== 'outside')
        result.push([pointAt(from), pointAt(to)]);
    }
  }
  return result;
}
export function operateGeospatial(raw: unknown, signal?: AbortSignal) {
  const input = z
      .object({
        layer: layerSchema,
        operation: z.enum([
          'intersection',
          'union',
          'difference',
          'clip',
          'repair-close-rings',
          'repair-nonzero',
        ]),
        mask: layerSchema.optional(),
      })
      .strict()
      .parse(raw),
    layer = normalizeLayer(input.layer);
  rejectAntimeridian(layer);
  if (!input.operation.startsWith('repair-')) requireValidGeospatial(layer, signal);
  let mask: Multi = [];
  if (input.mask) {
    const other = normalizeLayer(input.mask);
    rejectAntimeridian(other);
    requireValidGeospatial(other, signal);
    if (stableData(layer.crs) !== stableData(other.crs))
      dataError('GEO_CRS_MISMATCH', '空间操作前须显式统一坐标档案');
    mask = unionMulti(allPolygons(other));
  }
  if (['intersection', 'difference', 'clip'].includes(input.operation) && !input.mask)
    dataError('GEO_MASK_REQUIRED', '空间操作须指定固定面掩膜');
  if (input.operation === 'union') {
    const coordinates = unionMulti(allPolygons(layer));
    return {
      layer: checkedOutput({
        ...layer,
        features: coordinates.length
          ? [
              {
                type: 'Feature',
                id: 'union-0',
                properties: {},
                geometry: { type: 'MultiPolygon', coordinates },
              },
            ]
          : [],
      }),
      operation: input.operation,
      sources: layer.features.map((f) => f.id),
      library: 'polygon-clipping@0.15.7',
    };
  }
  const changes: { source: string; output: string; changed: boolean }[] = [];
  const features: Layer['features'] = [];
  for (const [index, feature] of layer.features.entries()) {
    checkDataSignal(signal);
    let geometry: Geo | null = null;
    if (input.operation === 'repair-close-rings')
      geometry =
        feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
          ? {
              type: 'MultiPolygon',
              coordinates: polygons(feature.geometry).map((poly) =>
                poly.map((r) => (samePoint(r[0], r.at(-1)!) ? r : [...r, [...r[0]] as Position])),
              ),
            }
          : feature.geometry;
    else if (input.operation === 'repair-nonzero') {
      const coordinates = unionMulti(polygons(feature.geometry));
      if (coordinates.length) geometry = { type: 'MultiPolygon', coordinates };
    } else if (feature.geometry.type === 'Point' || feature.geometry.type === 'MultiPoint') {
      const selected = points(feature.geometry).filter(
        (p) => (multiContains(p, mask) !== 'outside') !== (input.operation === 'difference'),
      );
      if (selected.length)
        geometry =
          selected.length === 1
            ? { type: 'Point', coordinates: selected[0] }
            : { type: 'MultiPoint', coordinates: selected };
    } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
      if (input.operation === 'difference')
        dataError('GEO_OPERATION_UNSUPPORTED', '线差集须使用显式裁剪定义，首版不隐式反转面');
      const coordinates = lines(feature.geometry).flatMap((l) => clipLineToMulti(l, mask, signal));
      if (coordinates.length) geometry = { type: 'MultiLineString', coordinates };
    } else {
      const coordinates =
        input.operation === 'difference'
          ? (clipping.difference(polygons(feature.geometry), mask) as Multi)
          : (clipping.intersection(polygons(feature.geometry), mask) as Multi);
      if (coordinates.length) geometry = { type: 'MultiPolygon', coordinates };
    }
    if (geometry) {
      const id = 'derived-' + index;
      features.push({ ...feature, id, geometry });
      changes.push({
        source: feature.id,
        output: id,
        changed: stableData(feature.geometry) !== stableData(geometry),
      });
    } else changes.push({ source: feature.id, output: '', changed: true });
  }
  return {
    layer: checkedOutput({ ...layer, features }),
    operation: input.operation,
    changes,
    originalPreserved: true,
    repairInterpretation: input.operation === 'repair-nonzero' ? 'explicit-nonzero-winding-union' : null,
    library: 'polygon-clipping@0.15.7',
  };
}
function planarBuffer(geometry: Geo, radius: number, steps: number, signal?: AbortSignal): Multi {
  checkDataSignal(signal);
  if (points(geometry).length > 100000) dataError('GEO_BUFFER_LIMIT', '缓冲输入顶点最多 100000');
  const source = new jsts.GeoJSONReader().read(geometry as Geometry);
  const output = new jsts.GeoJSONWriter().write(jsts.BufferOp.bufferOp(source, radius, steps));
  checkDataSignal(signal);
  if (output.type !== 'Polygon' && output.type !== 'MultiPolygon')
    dataError('GEO_BUFFER_PROTOCOL', '固定缓冲工具返回了未声明的几何种类');
  if (
    !output.coordinates.length ||
    (output.type === 'Polygon'
      ? output.coordinates.every((r) => !r.length)
      : output.coordinates.every((p) => p.every((r) => !r.length)))
  )
    return [];
  return polygons(geometrySchema.parse(output));
}
export function bufferGeospatial(raw: unknown, signal?: AbortSignal) {
  const input = z
      .object({
        layer: layerSchema,
        radiusMeters: z.number().finite().min(-1000000).max(1000000),
        steps: z.number().int().min(4).max(64).default(8),
      })
      .strict()
      .parse(raw),
    layer = normalizeLayer(input.layer);
  rejectAntimeridian(layer);
  const features: Layer['features'] = [],
    empty: string[] = [];
  requireValidGeospatial(layer, signal);
  for (const [index, f] of layer.features.entries()) {
    checkDataSignal(signal);
    let geometry: Geo | null = null;
    if (layer.crs.code === 'EPSG:4326') {
      const output = turfBuffer(
        { type: 'Feature', properties: {}, geometry: f.geometry } as Feature<Geometry>,
        input.radiusMeters,
        { units: 'meters', steps: input.steps },
      );
      if (output) geometry = geometrySchema.parse(output.geometry);
    } else {
      const coordinates = planarBuffer(f.geometry, input.radiusMeters, input.steps, signal);
      if (coordinates.length) geometry = { type: 'MultiPolygon', coordinates };
    }
    if (geometry) features.push({ ...f, id: 'buffer-' + index, geometry });
    else empty.push(f.id);
  }
  return {
    layer: checkedOutput({ ...layer, features }),
    emptySourceIds: empty,
    radiusMeters: input.radiusMeters,
    steps: input.steps,
    method: layer.crs.code === 'EPSG:4326' ? 'turf-local-projected-buffer@7.4.0' : 'jsts-planar-buffer@2.7.2',
    approximation: 'fixed-segment-round-arcs',
    originalPreserved: true,
  };
}
const haversine = (a: Position, b: Position) => {
  const dLat = (b[1] - a[1]) * RAD,
    dLon = (b[0] - a[0]) * RAD,
    h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(Math.min(1, h)));
};
function pointSegmentDistance(p: Position, a: Position, b: Position) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy,
    t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function geometryDistance(a: Geo, b: Geo, spherical: boolean): number {
  const ap = points(a),
    bp = points(b);
  if (!ap.length || !bp.length) return Infinity;
  if (spherical) {
    if (!['Point', 'MultiPoint'].includes(a.type) || !['Point', 'MultiPoint'].includes(b.type))
      dataError('GEO_SPHERICAL_NEAREST', '球面最近邻首版仅比较点；线面距离须用明确平面投影');
    if (ap.length * bp.length > 2000000) dataError('GEO_DISTANCE_BUDGET', '球面距离比较超过 200 万次');
    let best = Infinity;
    for (const p of ap) for (const q of bp) best = Math.min(best, haversine(p, q));
    return best;
  }
  if (
    (a.type === 'Polygon' || a.type === 'MultiPolygon') &&
    bp.some((p) => multiContains(p, polygons(a)) !== 'outside')
  )
    return 0;
  if (
    (b.type === 'Polygon' || b.type === 'MultiPolygon') &&
    ap.some((p) => multiContains(p, polygons(b)) !== 'outside')
  )
    return 0;
  const aLines = lines(a),
    bLines = lines(b);
  let count = 0,
    best = Infinity;
  for (const l of aLines)
    for (let i = 1; i < l.length; i++)
      for (const m of bLines)
        for (let j = 1; j < m.length; j++) {
          if (++count > 2000000) dataError('GEO_DISTANCE_BUDGET', '线段距离比较超过 200 万次');
          if (intersectSegments(l[i - 1], l[i], m[j - 1], m[j])) return 0;
        }
  for (const p of ap) {
    for (const q of bp) {
      if (++count > 2000000) dataError('GEO_DISTANCE_BUDGET', '距离比较超过 200 万次');
      best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
    for (const l of bLines)
      for (let i = 1; i < l.length; i++) best = Math.min(best, pointSegmentDistance(p, l[i - 1], l[i]));
  }
  for (const p of bp)
    for (const l of aLines)
      for (let i = 1; i < l.length; i++) best = Math.min(best, pointSegmentDistance(p, l[i - 1], l[i]));
  return best;
}
export function joinGeospatial(raw: unknown, signal?: AbortSignal) {
  const input = z
      .object({
        left: layerSchema,
        right: layerSchema,
        mode: z.enum(['point-in-polygon', 'intersects', 'nearest']),
        boundary: z.enum(['include', 'exclude']).default('include'),
        multiMatch: z.enum(['all', 'first', 'error']).default('all'),
        radiusMeters: z.number().nonnegative().finite().optional(),
      })
      .strict()
      .parse(raw),
    left = normalizeLayer(input.left),
    right = normalizeLayer(input.right);
  if (stableData(left.crs) !== stableData(right.crs))
    dataError('GEO_CRS_MISMATCH', '连接前须显式统一坐标档案');
  rejectAntimeridian(left);
  rejectAntimeridian(right);
  requireValidGeospatial(left, signal);
  requireValidGeospatial(right, signal);
  if (left.features.length * right.features.length > 1000000)
    dataError('GEO_JOIN_LIMIT', '空间连接候选超过 100 万');
  if (input.mode === 'nearest' && input.radiusMeters === undefined)
    dataError('GEO_RADIUS_REQUIRED', '最近邻须固定搜索半径');
  const pairs: { left: string; right: string; distanceMeters: number | null; boundary: boolean }[] = [],
    unmatched: string[] = [];
  const spherical = left.crs.code === 'EPSG:4326';
  for (const a of left.features) {
    checkDataSignal(signal);
    let matches: typeof pairs = [];
    for (const b of right.features) {
      if (input.mode === 'nearest') {
        const distance = geometryDistance(a.geometry, b.geometry, spherical);
        if (distance <= input.radiusMeters!)
          matches.push({ left: a.id, right: b.id, distanceMeters: distance, boundary: false });
      } else if (input.mode === 'point-in-polygon') {
        if (a.geometry.type !== 'Point') dataError('GEO_POINT_REQUIRED', '点面连接左侧须为 Point');
        const state = multiContains(a.geometry.coordinates, polygons(b.geometry));
        if (state === 'inside' || (state === 'boundary' && input.boundary === 'include'))
          matches.push({ left: a.id, right: b.id, distanceMeters: null, boundary: state === 'boundary' });
      } else if (boxesIntersect(box(a.geometry), box(b.geometry))) {
        const polygonPair =
          (a.geometry.type === 'Polygon' || a.geometry.type === 'MultiPolygon') &&
          (b.geometry.type === 'Polygon' || b.geometry.type === 'MultiPolygon');
        const interiorOverlap =
          polygonPair && clipping.intersection(polygons(a.geometry), polygons(b.geometry)).length > 0;
        if (
          interiorOverlap ||
          (input.boundary === 'include' && geometryDistance(a.geometry, b.geometry, false) === 0)
        )
          matches.push({ left: a.id, right: b.id, distanceMeters: null, boundary: !interiorOverlap });
      }
    }
    if (input.mode === 'nearest' && matches.length) {
      const minimum = matches.reduce((min, m) => Math.min(min, m.distanceMeters!), Infinity);
      matches = matches.filter((m) => m.distanceMeters === minimum);
    }
    matches.sort((a, b) => dataCompare(a.right, b.right));
    if (input.multiMatch === 'error' && matches.length > 1)
      dataError('GEO_MULTIPLE_MATCHES', '空间连接存在多匹配：' + a.id);
    if (!matches.length) unmatched.push(a.id);
    else pairs.push(...(input.multiMatch === 'first' ? matches.slice(0, 1) : matches));
    if (pairs.length > 1000000) dataError('GEO_JOIN_OUTPUT_LIMIT', '空间连接输出超过 100 万');
  }
  return {
    pairs,
    unmatched,
    radiusMeters: input.radiusMeters ?? null,
    boundaryPolicy: input.boundary,
    multiMatch: input.multiMatch,
    distanceMethod: input.mode === 'nearest' ? (spherical ? 'haversine-sphere' : 'planar') : null,
    earthRadiusMeters: spherical ? EARTH : null,
    coverage: 'full-declared-layers',
  };
}
export function measureGeospatial(raw: unknown, signal?: AbortSignal) {
  const input = z
      .object({ layer: layerSchema, method: z.enum(['planar', 'sphere']) })
      .strict()
      .parse(raw),
    layer = normalizeLayer(input.layer);
  rejectAntimeridian(layer);
  if ((input.method === 'sphere') !== (layer.crs.code === 'EPSG:4326'))
    dataError('GEO_MEASURE_CRS', '球面计量须使用经纬坐标，平面米计量须使用米坐标');
  requireValidGeospatial(layer, signal);
  const rows = layer.features.map((feature) => {
    checkDataSignal(signal);
    const geometry = feature.geometry;
    let length = 0,
      area = 0;
    for (const l of lines(geometry))
      for (let i = 1; i < l.length; i++)
        length +=
          input.method === 'sphere'
            ? haversine(l[i - 1], l[i])
            : Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
      for (const poly of polygons(geometry))
        for (let j = 0; j < poly.length; j++) {
          const r = poly[j];
          let ringArea = 0;
          if (input.method === 'planar') ringArea = Math.abs(signedArea(r));
          else {
            let sum = 0;
            for (let i = 1; i < r.length; i++)
              sum +=
                (r[i][0] - r[i - 1][0]) * RAD * (2 + Math.sin(r[i - 1][1] * RAD) + Math.sin(r[i][1] * RAD));
            ringArea = Math.abs((sum * EARTH ** 2) / 2);
          }
          area += (j ? -1 : 1) * ringArea;
        }
    return {
      id: feature.id,
      lengthMeters: length,
      areaSquareMeters: area,
      empty: points(geometry).length === 0,
    };
  });
  return {
    rows,
    method: input.method,
    earthRadiusMeters: input.method === 'sphere' ? EARTH : null,
    totals: {
      lengthMeters: rows.reduce((s, r) => s + r.lengthMeters, 0),
      areaSquareMeters: rows.reduce((s, r) => s + r.areaSquareMeters, 0),
    },
  };
}
export function indexGeospatial(raw: unknown) {
  const { layer: value } = z.object({ layer: layerSchema }).strict().parse(raw),
    layer = normalizeLayer(value);
  return {
    crs: layer.crs,
    entries: layer.features
      .map((f) => ({ id: f.id, bbox: box(f.geometry) }))
      .sort((a, b) => a.bbox[0] - b.bbox[0] || dataCompare(a.id, b.id)),
    algorithm: 'sorted-bounding-box-v1',
    coverage: 'all-declared-features',
  };
}
