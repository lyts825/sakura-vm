import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { Jobs } from './jobs.ts';

export type GitChange = { path: string; previous?: string; index: string; worktree: string };
export function parseStatus(text: string): GitChange[] {
  const parts = text.split('\0'),
    items: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const row = parts[i];
    if (row.length < 4) continue;
    const item: GitChange = { index: row[0], worktree: row[1], path: row.slice(3) };
    if ('RC'.includes(row[0]) || 'RC'.includes(row[1])) item.previous = parts[++i];
    items.push(item);
  }
  return items;
}
export const repositoryPath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) => !path.startsWith('/') && !path.split('/').includes('..') && !/[\x00-\x1f]/.test(path),
    '需要仓库内的相对文件路径',
  );
export const gitActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['stage', 'unstage']), paths: z.array(repositoryPath).min(1).max(200) }).strict(),
  z
    .object({
      action: z.literal('commit'),
      message: z.string().trim().min(1).max(4096),
      author: z.string().trim().max(100).optional(),
      email: z.email().optional(),
    })
    .strict(),
  z
    .object({
      action: z.enum(['switch', 'branch']),
      branch: z.string().regex(/^(?!-)[A-Za-z0-9_./-]{1,128}$/),
    })
    .strict(),
  z.object({ action: z.literal('init') }).strict(),
]);
const git =
  'git --no-pager --literal-pathspecs -c core.hooksPath=/dev/null -c core.fsmonitor=false -c color.ui=false';
export class GitWorkbench {
  jobs = new Jobs('git');
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}
  private async command(id: string, command: string, signal?: AbortSignal) {
    const project = await this.workspaces.config(id);
    return this.machines.exec(
      id,
      `cd ${quote(project.directory)} && GIT_TERMINAL_PROMPT=0 ${git} ${command}`,
      30000,
      signal,
    );
  }
  async view(id: string, signal?: AbortSignal) {
    const check = await this.command(id, 'rev-parse --is-inside-work-tree', signal);
    if (check.code !== 0)
      return {
        repository: false,
        error: check.stderr,
        changes: [],
        branches: [],
        history: [],
        job: this.jobs.view(id),
      };
    const status = await this.command(id, 'status --porcelain=v1 -z --untracked-files=all', signal);
    if (status.code !== 0) throw new AppError(status.stderr);
    const branch = await this.command(id, 'symbolic-ref --short -q HEAD', signal);
    const branches = await this.command(id, "for-each-ref --format='%(refname:short)' refs/heads", signal);
    const history = await this.command(id, "log -30 --format='%H%x00%h%x00%s%x00%an%x00%aI%x00'", signal);
    const records =
      history.code === 0
        ? history.stdout
            .split('\0\n')
            .filter(Boolean)
            .map((row) => {
              const [id, short, subject, author, date] = row.trimStart().split('\0');
              return { id, short, subject, author, date };
            })
        : [];
    return {
      repository: true,
      branch: branch.stdout.trim() || '(detached HEAD)',
      changes: parseStatus(status.stdout),
      branches: branches.stdout.trim().split('\n').filter(Boolean),
      history: records,
      job: this.jobs.view(id),
    };
  }
  async diff(id: string, path: string, staged: boolean, signal?: AbortSignal) {
    repositoryPath.parse(path);
    const untracked =
      !staged &&
      (await this.command(id, `ls-files --others --exclude-standard -z -- ${quote(path)}`, signal)).stdout
        .split('\0')
        .includes(path);
    const result = await this.command(
      id,
      `diff --no-ext-diff --no-textconv ${untracked ? '--no-index' : staged ? '--cached' : ''} -- ${untracked ? '/dev/null ' : ''}${quote(path)}`,
      signal,
    );
    if (result.code !== 0 && !(untracked && result.code === 1)) throw new AppError(result.stderr);
    return { diff: result.stdout.slice(0, 200000), truncated: result.stdout.length > 200000 };
  }
  async run(id: string, input: unknown) {
    const value = gitActionSchema.parse(input);
    return this.machines.locked(`git:${id}`, async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
      return this.jobs.start(
        id,
        async (log, signal) => {
          let command: string;
          switch (value.action) {
            case 'stage':
              command = `add -A -- ${value.paths.map(quote).join(' ')}`;
              break;
            case 'unstage': {
              const head = await this.command(id, 'rev-parse --verify HEAD', signal);
              command =
                head.code === 0
                  ? `reset -q HEAD -- ${value.paths.map(quote).join(' ')}`
                  : `rm --cached -- ${value.paths.map(quote).join(' ')}`;
              break;
            }
            case 'commit':
              command = `${value.author ? `-c user.name=${quote(value.author)} ` : ''}${value.email ? `-c user.email=${quote(value.email)} ` : ''}commit -m ${quote(value.message)}`;
              break;
            case 'branch':
            case 'switch': {
              const check = await this.command(
                id,
                `check-ref-format --branch ${quote(value.branch)}`,
                signal,
              );
              if (check.code !== 0) throw new AppError('分支名称不符合 Git 规则');
              command = `switch ${value.action === 'branch' ? '-c ' : '-- '}${quote(value.branch)}`;
              break;
            }
            default:
              command = 'init';
          }
          const result = await this.command(id, command, signal);
          log(result.stdout + result.stderr);
          if (result.code !== 0) throw new AppError(result.stderr || `Git 操作失败（${result.code}）`);
        },
        { title: `Git · ${value.action}`, vmId: id },
      );
    });
  }
  close() {
    return this.jobs.close();
  }
}
