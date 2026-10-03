import type { Project } from './project-config.ts';
import { quote } from './shell.ts';
import { projectPrivateShellCommand } from './project-network-isolation.ts';

export function terminalShell(project: Project) {
  return project.networkIsolation === 'private'
    ? projectPrivateShellCommand(project)
    : `set -eu\ncd ${quote(project.directory)}\nexec /bin/sh -l`;
}
