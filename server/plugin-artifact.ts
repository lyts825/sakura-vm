/**
 * 模块职责：计算插件及系统产物摘要，为实例代次、审计与恢复核对提供内容身份。
 * Module purpose: Hashes plugin/system artifacts for instance generations, audit identity and recovery verification.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import { APP_VERSION } from '../shared/version.ts';
import { ROOT } from './paths.ts';

let artifact: string | undefined;
/** Production activations identify the installed bundle; development identifies its source inputs. */
/**
 * 入口 / Entry: fingerprint.
 * 功能：在计算插件及系统产物摘要中，执行此领域的具体处理步骤并返回其结果；本入口产生 `hash.digest('hex')` 供上层消费（`plugin-artifact.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-artifact.ts`; this entry produces `hash.digest('hex')` for its caller. Module context: Hashes plugin/system artifacts for instance generations, audit identity and recovery verification.
 * 处理：通过 `createHash`, `fileURLToPath`, `entry.endsWith`, `inline.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash`, `fileURLToPath`, `entry.endsWith`, `inline.map`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `hash.digest('hex')`.
 * 副作用 / Effects: `createHash`; `hash.update().update`; `hash.update`; `name.replaceAll`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: pluginArtifactDigest.
 * 功能：在计算插件及系统产物摘要中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(artifact).update(JSON.stringify(manifest)).digest('hex')` 供上层消费（`plugin-artifact.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-artifact.ts`; this entry produces `createHash('sha256').update(artifact).update(JSON.stringify(manifest)).digest('hex')` for its caller. Module context: Hashes plugin/system artifacts for instance generations, audit identity and recovery verification.
 * 处理：通过 `fingerprint`, `createHash().update().update().digest`, `createHash().update().update`, `createHash().update` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `fingerprint`, `createHash().update().update().digest`, `createHash().update().update`, `createHash().update`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: manifest: PluginManifest
 * 输出 / Returns: `createHash('sha256').update(artifact).update(JSON.stringify(manifest)).digest('hex')`.
 * 副作用 / Effects: `createHash().update().update().digest`; `createHash().update().update`; `createHash().update`; `createHash`; 更新 / updates `artifact`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function pluginArtifactDigest(manifest: PluginManifest) {
  artifact ??= fingerprint();
  return createHash('sha256').update(artifact).update(JSON.stringify(manifest)).digest('hex');
}
/**
 * 入口 / Entry: systemArtifactDigest.
 * 功能：在计算插件及系统产物摘要中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256') .update(artifact) .update('system:' + id + '@' + version) .digest('hex')` 供上层消费（`plugin-artifact.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-artifact.ts`; this entry produces `createHash('sha256') .update(artifact) .update('system:' + id + '@' + version) .digest('hex')` for its caller. Module context: Hashes plugin/system artifacts for instance generations, audit identity and recovery verification.
 * 处理：通过 `fingerprint`, `createHash().update().update().digest`, `createHash().update().update`, `createHash().update` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `fingerprint`, `createHash().update().update().digest`, `createHash().update().update`, `createHash().update`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; version: default=APP_VERSION
 * 输出 / Returns: `createHash('sha256') .update(artifact) .update('system:' + id + '@' + version) .digest('hex')`.
 * 副作用 / Effects: `createHash().update().update().digest`; `createHash().update().update`; `createHash().update`; `createHash`; 更新 / updates `artifact`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function systemArtifactDigest(id: string, version = APP_VERSION) {
  artifact ??= fingerprint();
  return createHash('sha256')
    .update(artifact)
    .update('system:' + id + '@' + version)
    .digest('hex');
}
