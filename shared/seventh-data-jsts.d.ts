/** @turf/buffer 已使用的固定 JSTS 子集；只声明本包实际调用的三个 API。 */
declare module '@turf/jsts' {
  import type { Geometry } from 'geojson';
  interface JstsGeometry {
    readonly __jstsGeometryBrand: unique symbol;
  }
  const jsts: {
    GeoJSONReader: new () => { read(input: Geometry): JstsGeometry };
    GeoJSONWriter: new () => { write(input: JstsGeometry): Geometry };
    BufferOp: { bufferOp(input: JstsGeometry, radius: number, quadrantSegments: number): JstsGeometry };
  };
  export default jsts;
}
