import { posix } from 'node:path';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { repositoryPath } from './git-workbench.ts';
import { quote } from './files.ts';
import { guestPath } from './model.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
};
export class CodeIntelligence {
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}
  async diagnose(id: string, path: string, signal?: AbortSignal) {
    const project = await this.workspaces.config(id);
    // The file editor uses absolute guest paths; CLI callers use project-relative paths.
    // Both forms must stay inside the currently selected project directory.
    path = repositoryPath.parse(
      path.startsWith('/') ? posix.relative(project.directory, guestPath(path)) : path,
    );
    const target = posix.join(project.directory, path);
    const ext = path.split('.').pop()?.toLowerCase();
    let command: string;
    if (['js', 'jsx', 'mjs', 'cjs'].includes(ext || '')) command = `node --check ${quote(target)}`;
    else if (['ts', 'tsx'].includes(ext || ''))
      command = `if command -v tsc >/dev/null; then tsc --noEmit --pretty false ${quote(target)}; else node --check ${quote(target)}; fi`;
    else if (ext === 'py') command = `python3 -m py_compile ${quote(target)}`;
    else if (ext === 'json') command = `python3 -m json.tool ${quote(target)} >/dev/null`;
    else return { path, diagnostics: [], supported: false };
    const result = await this.machines.exec(id, projectNetworkCommand(project, command), 30000, signal),
      output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code === 0) return { path, diagnostics: [], supported: true };
    const diagnostics: Diagnostic[] = output
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 100)
      .map((line) => {
        const match = line.match(/(?::|\()([0-9]+)(?::|,)([0-9]+)?(?:\)|:)?\s*(.*)$/);
        return {
          severity: 'error' as const,
          line: match ? Number(match[1]) : undefined,
          column: match?.[2] ? Number(match[2]) : undefined,
          message: match?.[3] || line.slice(0, 500),
        };
      });
    return { path, diagnostics, supported: true };
  }
}
