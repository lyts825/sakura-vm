/**
 * 模块职责：声明项目语言运行时版本和安装目录，提供环境选择及精确版本匹配规则。
 * Module purpose: Declares project runtime versions/install paths and supplies environment selection/exact-version matching.
 */
import { z } from 'zod';

export const exactVersion = z.string().regex(/^\d{1,2}\.\d{1,3}\.\d{1,3}$/);
export const runtimesSchema = z.object({ node: exactVersion.optional(), python: exactVersion.optional() }).strict()
  .transform(value => ({ ...(value.node !== undefined ? { node: value.node } : {}),
    ...(value.python !== undefined ? { python: value.python } : {}) }));
export type RuntimeVersionsConfig = z.infer<typeof runtimesSchema>;
export const runtimeRoot = '/opt/sakura-runtimes';
/**
 * 入口 / Entry: runtimeBin.
 * 功能：从当前输入或状态计算 ``${runtimeRoot}/${tool}-${version}/bin``，供调用方后续验证或使用。
 * Purpose: Computes ``${runtimeRoot}/${tool}-${version}/bin`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: tool: 'node' | 'python'; version: string
 * 输出 / Returns: ``${runtimeRoot}/${tool}-${version}/bin``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function runtimeBin(tool: 'node' | 'python', version: string) {
  exactVersion.parse(version);
  return `${runtimeRoot}/${tool}-${version}/bin`;
}
/**
 * 入口 / Entry: runtimeEnvironment.
 * 功能：在声明项目语言运行时版本和安装目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `paths.length ? { PATH: [...paths, existingPath || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'].join(':'), …` 供上层消费（`runtime-config.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `runtime-config.ts`; this entry produces `paths.length ? { PATH: [...paths, existingPath || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'].join(':'), …` for its caller. Module context: Declares project runtime versions/install paths and supplies environment selection/exact-version matching.
 * 处理：通过 `inline.map`, `runtimesSchema.parse`, `inline.join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.map`, `runtimesSchema.parse`, `inline.join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: versions: RuntimeVersionsConfig optional; existingPath: string optional
 * 输出 / Returns: Record<string, string>；结果来自 / values from `paths.length ? { PATH: [...paths, existingPath || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'].join(':'), …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function runtimeEnvironment(versions?: RuntimeVersionsConfig, existingPath?: string): Record<string, string> {
  const paths = (Object.entries(runtimesSchema.parse(versions || {})) as ['node' | 'python', string][])
    .map(([tool, version]) => runtimeBin(tool, version));
  return paths.length ? {
    PATH: [...paths, existingPath || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'].join(':'),
    ...(versions?.python ? { VIRTUAL_ENV: `${runtimeRoot}/python-${versions.python}` } : {}),
  } : {};
}
/**
 * 入口 / Entry: declarationVersion.
 * 功能：在声明项目语言运行时版本和安装目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `/^\d{1,2}(?:\.\d{1,3}){0,2}$/.test(value) ? value : null` 供上层消费（`runtime-config.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `runtime-config.ts`; this entry produces `/^\d{1,2}(?:\.\d{1,3}){0,2}$/.test(value) ? value : null` for its caller. Module context: Declares project runtime versions/install paths and supplies environment selection/exact-version matching.
 * 处理：通过 `text.trim().split()[...].trim().replace`, `text.trim().split()[...].trim`, `text.trim().split`, `text.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `text.trim().split()[...].trim().replace`, `text.trim().split()[...].trim`, `text.trim().split`, `text.trim`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `/^\d{1,2}(?:\.\d{1,3}){0,2}$/.test(value) ? value : null`.
 * 副作用 / Effects: `text.trim().split()[...].trim().replace`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function declarationVersion(text: string) {
  const value = text.trim().split(/\r?\n/)[0]?.trim().replace(/^v/, '');
  return /^\d{1,2}(?:\.\d{1,3}){0,2}$/.test(value) ? value : null;
}
/**
 * 入口 / Entry: matchesVersion.
 * 功能：从当前输入或状态计算 `actual === requested || actual.startsWith(requested + '.')`，供调用方后续验证或使用。
 * Purpose: Computes `actual === requested || actual.startsWith(requested + '.')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: actual: string; requested: string
 * 输出 / Returns: `actual === requested || actual.startsWith(requested + '.')`.
 * 副作用 / Effects: `actual.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function matchesVersion(actual: string, requested: string) {
  return actual === requested || actual.startsWith(requested + '.');
}
