/**
 * 模块职责：生成项目终端的 shell 启动命令，使用经过引用处理的目录进入项目环境。
 * Module purpose: Builds project terminal shell commands with safely quoted directory entry and network-specific execution.
 */
import type { Project } from './project-config.ts';
import { quote } from './shell.ts';
import { projectPrivateShellCommand } from './project-network-isolation.ts';

/**
 * 入口 / Entry: terminalShell.
 * 功能：在生成项目终端的 shell 启动命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `project.networkIsolation === 'private' ? projectPrivateShellCommand(project) : `set -eu\ncd ${quote(project.directory)}\nexec…` 供上层消费（`project-shell.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-shell.ts`; this entry produces `project.networkIsolation === 'private' ? projectPrivateShellCommand(project) : `set -eu\ncd ${quote(project.directory)}\nexec…` for its caller. Module context: Builds project terminal shell commands with safely quoted directory entry and network-specific execution.
 * 处理：通过 `projectPrivateShellCommand`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectPrivateShellCommand`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `project.networkIsolation === 'private' ? projectPrivateShellCommand(project) : `set -eu\ncd ${quote(project.directory)}\nexec…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function terminalShell(project: Project) {
  return project.networkIsolation === 'private'
    ? projectPrivateShellCommand(project)
    : `set -eu\ncd ${quote(project.directory)}\nexec /bin/sh -l`;
}
