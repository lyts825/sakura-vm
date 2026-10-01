import { z } from 'zod';

export const exactVersion = z.string().regex(/^\d{1,2}\.\d{1,3}\.\d{1,3}$/);
export const runtimesSchema = z.object({ node: exactVersion.optional(), python: exactVersion.optional() }).strict()
  .transform(value => ({ ...(value.node !== undefined ? { node: value.node } : {}),
    ...(value.python !== undefined ? { python: value.python } : {}) }));
export type RuntimeVersionsConfig = z.infer<typeof runtimesSchema>;
export const runtimeRoot = '/opt/sakura-runtimes';
export function runtimeBin(tool: 'node' | 'python', version: string) {
  exactVersion.parse(version);
  return `${runtimeRoot}/${tool}-${version}/bin`;
}
export function runtimeEnvironment(versions?: RuntimeVersionsConfig, existingPath?: string): Record<string, string> {
  const paths = (Object.entries(runtimesSchema.parse(versions || {})) as ['node' | 'python', string][])
    .map(([tool, version]) => runtimeBin(tool, version));
  return paths.length ? {
    PATH: [...paths, existingPath || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'].join(':'),
    ...(versions?.python ? { VIRTUAL_ENV: `${runtimeRoot}/python-${versions.python}` } : {}),
  } : {};
}
export function declarationVersion(text: string) {
  const value = text.trim().split(/\r?\n/)[0]?.trim().replace(/^v/, '');
  return /^\d{1,2}(?:\.\d{1,3}){0,2}$/.test(value) ? value : null;
}
export function matchesVersion(actual: string, requested: string) {
  return actual === requested || actual.startsWith(requested + '.');
}
