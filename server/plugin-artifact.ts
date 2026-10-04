import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import { APP_VERSION } from '../shared/version.ts';
import { ROOT } from './paths.ts';

let artifact: string | undefined;
/** Production activations identify the installed bundle; development identifies its source inputs. */
function fingerprint() {
  const hash = createHash('sha256');
  const entry = fileURLToPath(import.meta.url);
  const development = entry.endsWith('.ts');
  const roots = development
    ? ['server', 'shared', 'plugins'].map((name) => ({ name, path: join(ROOT, name) }))
    : [{ name: 'bundle', path: dirname(entry) }];
  for (const root of roots) {
    const names = readdirSync(root.path, { recursive: true })
      .filter(
        (name): name is string =>
          typeof name === 'string' &&
          (development ? /\.[cm]?[jt]sx?$/.test(name) : statSync(join(root.path, name)).isFile()),
      )
      .sort();
    for (const name of names) {
      const bytes = readFileSync(join(root.path, name));
      hash.update(root.name + '/' + name.replaceAll('\\', '/') + '\0' + bytes.length + '\0').update(bytes);
    }
  }
  return hash.digest('hex');
}
export async function pluginArtifactDigest(manifest: PluginManifest) {
  artifact ??= fingerprint();
  return createHash('sha256').update(artifact).update(JSON.stringify(manifest)).digest('hex');
}
export function systemArtifactDigest(id: string, version = APP_VERSION) {
  artifact ??= fingerprint();
  return createHash('sha256')
    .update(artifact)
    .update('system:' + id + '@' + version)
    .digest('hex');
}
