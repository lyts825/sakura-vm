export const SUITE_BUNDLE_LIMIT: number;
export interface SuiteBundleEntry {
  path: string;
  data: Uint8Array;
}
export interface SuiteBundleManifest {
  format: string;
  digest: string;
  files: { path: string; bytes: number; digest: string }[];
}
export interface SuiteBundleOptions { maximumBytes?: number; }
export function canonicalBundle(value: unknown): string;
export function encodeSuiteBundle(
  format: string,
  entries: SuiteBundleEntry[],
  options?: SuiteBundleOptions,
): { data: Buffer; manifest: SuiteBundleManifest };
export function decodeSuiteBundle(
  data: Uint8Array,
  expectedFormat: string,
  options?: SuiteBundleOptions,
): {
  manifest: SuiteBundleManifest;
  entries: { path: string; data: Buffer }[];
  integrity: 'verified';
  sourceTrust: 'unauthenticated';
};
