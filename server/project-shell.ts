/**
 * 模块职责：生成项目终端的 shell 启动命令，使用经过引用处理的目录进入项目环境。
 */
import type { Project } from './project-config.ts';
import { quote } from './shell.ts';
import { projectPrivateShellCommand } from './project-network-isolation.ts';

export function terminalShell(project: Project) {
  return project.networkIsolation === 'private'
    ? projectPrivateShellCommand(project)
    : `set -eu\ncd ${quote(project.directory)}\nexec /bin/sh -l`;
}
