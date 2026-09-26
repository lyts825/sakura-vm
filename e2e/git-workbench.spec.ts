import { expect, test, type Page } from '@playwright/test';
import type { GitChange } from '../shared/git';
import type { JobView } from '../server/jobs';

const vmId = '11111111-1111-4111-8111-111111111111';

async function workbench(page: Page) {
  const state = {
    projectId: 'default',
    repository: true,
    branch: 'local-topic',
    detached: false,
    hasCommits: true,
    branches: ['local-topic'],
    history: [],
    changes: [] as GitChange[],
    conflicts: [] as string[],
    operation: null as string | null,
    remotes: ['origin', 'upstream'].flatMap((name) =>
      ['(fetch)', '(push)'].map((kind) => ({ name, kind, url: `https://example.test/${name}.git` })),
    ),
    upstream: { name: 'upstream/release', remote: 'upstream', branch: 'release' },
    divergence: [0, 1],
    job: null as JobView | null,
  };
  const submissions: { value: any; project: string | null }[] = [];
  const cancelled: string[] = [];
  let retainOldJob = false;
  let latestJob: JobView;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path.endsWith('/git')) {
      if (route.request().method() === 'POST') {
        submissions.push({ value: route.request().postDataJSON(), project: url.searchParams.get('project') });
        latestJob = {
          id: `job-${submissions.length}`,
          status: 'running',
          log: '',
          // Distinct jobs can share a timestamp; the accepted id must still win over an old poll.
          startedAt: '2026-01-01T00:00:00.000Z',
        };
        if (!retainOldJob) state.job = latestJob;
        return route.fulfill({ status: 202, json: latestJob });
      }
      if (url.searchParams.has('path'))
        return route.fulfill({ json: { diff: 'file difference', truncated: false } });
      return route.fulfill({ json: state });
    }
    if (path.includes('/jobs/') && path.endsWith('/cancel')) {
      cancelled.push(path);
      state.job = { ...latestJob, status: 'cancelled', error: '操作已取消' };
      return route.fulfill({ json: { ok: true } });
    }
    const data =
      path === '/api/bootstrap'
        ? { token: 'test-token' }
        : path === '/api/vms'
          ? [
              {
                id: vmId,
                name: 'Git VM',
                memoryMiB: 512,
                cpus: 2,
                diskGiB: 8,
                accelerator: 'auto',
                distro: 'alpine',
                template: 'none',
                forwards: [],
                snapshots: [],
                status: 'running',
                poweredOn: true,
                createdAt: new Date().toISOString(),
              },
            ]
          : path === '/api/system'
            ? { plugins: ['projects', 'git'], version: 'test', nativeHost: true }
            : path.endsWith('/projects')
              ? { active: 'default', projects: [{ id: 'default', name: '默认项目' }] }
              : {};
    return route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Git', exact: true }).click();
  await expect(page.getByRole('heading', { name: '远程同步' })).toBeVisible();
  return {
    state,
    submissions,
    cancelled,
    staleJobs: () => {
      retainOldJob = true;
    },
    finish: (status: JobView['status'], error?: string) => {
      state.job = { ...latestJob, status, error };
    },
    refresh: () => page.getByRole('button', { name: '刷新 Git', exact: true }).click(),
  };
}

test('remote controls select the upstream, submit explicit targets and stay busy before polling catches up', async ({
  page,
}) => {
  const f = await workbench(page);
  await expect(page.getByRole('combobox', { name: '远程仓库', exact: true })).toHaveValue('upstream');
  await expect(page.getByLabel('目标远程分支')).toHaveValue('release');
  f.staleJobs();
  await page.getByRole('button', { name: '获取更新', exact: true }).click();
  await expect
    .poll(() => f.submissions)
    .toEqual([{ value: { action: 'fetch', remote: 'upstream' }, project: 'default' }]);
  await expect(page.getByRole('button', { name: '推送当前分支', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '获取更新', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取消 Git 任务', exact: true })).toBeVisible();
  f.finish('done');
  await f.refresh();
  await expect(page.getByRole('button', { name: '快进拉取', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: '远程仓库', exact: true }).selectOption('origin');
  await expect(page.getByLabel('目标远程分支')).toHaveValue('local-topic');
  await page.getByLabel('目标远程分支').fill('review/topic');
  await f.refresh();
  await expect(page.getByLabel('目标远程分支')).toHaveValue('review/topic');
  await page.getByRole('button', { name: '推送当前分支', exact: true }).click();
  await expect
    .poll(() => f.submissions.at(-1)?.value)
    .toEqual({ action: 'push', remote: 'origin', branch: 'review/topic' });
  f.finish('error', '推送被拒绝：远程分支包含本地尚未整合的提交。请获取更新并手动整合分叉后重试。');
  await f.refresh();
  await expect(page.getByRole('alert').filter({ hasText: '推送被拒绝' })).toBeVisible();
  await expect(page.getByRole('button', { name: '推送当前分支', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '快进拉取', exact: true }).click();
  await expect
    .poll(() => f.submissions.at(-1)?.value)
    .toEqual({ action: 'pull', remote: 'origin', branch: 'review/topic' });
  await page.getByRole('button', { name: '取消 Git 任务', exact: true }).click();
  await expect.poll(() => f.cancelled).toEqual(['/api/jobs/job-3/cancel']);
  await expect(page.getByText('操作已取消', { exact: true })).toBeVisible();
});

test('conflicts, unfinished operations, dirty work and detached or unborn branches explain blocked actions', async ({
  page,
}) => {
  const f = await workbench(page);
  const pull = page.getByRole('button', { name: '快进拉取', exact: true });
  const push = page.getByRole('button', { name: '推送当前分支', exact: true });
  const fetch = page.getByRole('button', { name: '获取更新', exact: true });
  f.state.changes = [{ path: 'conflict.txt', index: 'U', worktree: 'U' }];
  f.state.conflicts = ['conflict.txt'];
  f.state.operation = 'MERGE_HEAD';
  await f.refresh();
  await expect(page.getByRole('alert').filter({ hasText: '未解决的文件冲突' })).toContainText('conflict.txt');
  await expect(page.getByRole('button', { name: '标记已解决（暂存）', exact: true })).toBeVisible();
  await expect(pull).toBeDisabled();
  await expect(push).toBeDisabled();
  await expect(fetch).toBeEnabled();
  await page.getByLabel('提交说明').fill('resolve');
  await expect(page.getByRole('button', { name: '提交暂存改动', exact: true })).toBeDisabled();
  f.state.changes = [];
  f.state.conflicts = [];
  await f.refresh();
  await expect(page.getByRole('heading', { name: 'Git 操作尚未结束' })).toBeVisible();
  await expect(push).toBeDisabled();
  f.state.operation = null;
  f.state.changes = [{ path: 'new.txt', index: '?', worktree: '?' }];
  await f.refresh();
  await expect(pull).toBeDisabled();
  await expect(push).toBeEnabled();
  f.state.changes = [];
  f.state.detached = true;
  f.state.branch = '(detached HEAD)';
  await f.refresh();
  await expect(page.getByText('detached HEAD：请先切换到本地分支再拉取或推送。')).toBeVisible();
  await expect(push).toBeDisabled();
  f.state.detached = false;
  f.state.hasCommits = false;
  f.state.branch = 'main';
  await f.refresh();
  await expect(page.getByText('请先创建首次提交，再拉取或推送。')).toBeVisible();
  await expect(pull).toBeDisabled();
  f.state.hasCommits = true;
  f.state.divergence = [1, 2];
  await f.refresh();
  await expect(page.getByRole('alert').filter({ hasText: '历史已分叉' })).toBeVisible();
  f.state.remotes = [];
  await f.refresh();
  await expect(fetch).toBeDisabled();
  await expect(push).toBeDisabled();
});
