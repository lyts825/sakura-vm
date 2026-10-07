/**
 * 模块职责：声明工程操作目录与参数约束，将归档、项目路径等安全边界交给运行器执行。
 * Module purpose: Declares engineering actions and parameter boundaries, leaving archive and project-path enforcement to the guest runner.
 */
import { z } from 'zod';
import { isIP } from 'node:net';
import { AppError } from '../shared/errors.ts';

const path = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (v) =>
      !v.startsWith('/') &&
      !v.includes('\\') &&
      !v.includes(':') &&
      !v.split('/').includes('..') &&
      !/[\x00-\x1f]/.test(v),
    '需要项目内的相对路径',
  );
const command = z.string().trim().min(1).max(8192);
const ref = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./~^{}@-]{0,127}$/);
const label = z.string().trim().min(1).max(120);
const argv = z.array(z.string().max(4096)).min(1).max(80);
const empty = z.object({}).strict();
/**
 * 入口 / Entry: op.
 * 功能：在声明工程操作目录与参数约束中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ name, feature, schema: z.object(shape).strict(), example, note, writes })` 供上层消费（`engineering-operations.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `engineering-operations.ts`; this entry produces `({ name, feature, schema: z.object(shape).strict(), example, note, writes })` for its caller. Module context: Declares engineering actions and parameter boundaries, leaving archive and project-path enforcement to the guest runner.
 * 处理：通过 `z.object().strict`, `z.object` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.object().strict`, `z.object`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: name: string; feature: string; shape: T; example: Record<string, unknown>; note: default=''; writes: default=false
 * 输出 / Returns: `({ name, feature, schema: z.object(shape).strict(), example, note, writes })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const op = <T extends z.ZodRawShape>(
  name: string,
  feature: string,
  shape: T,
  example: Record<string, unknown>,
  note = '',
  writes = false,
) => ({ name, feature, schema: z.object(shape).strict(), example, note, writes });

/** Every listed action has a concrete executor. Catalogue-only ideas are not actions. */
export const engineeringOperations = {
  archive: op(
    '归档 / 解压',
    'archive-wizard',
    { mode: z.enum(['create', 'extract', 'list']), path, target: path.optional() },
    { mode: 'create', path: 'src', target: 'src.tar.gz' },
    '只处理项目内的普通文件；解压先校验全部成员，禁止链接与越界路径。',
    true,
  ),
  'hash-manifest': op(
    '文件证据清单',
    'hash-manifest',
    { path: path.default('.'), output: path.optional() },
    { path: '.' },
    'SHA-256、大小与修改时间；扫描上限 20,000 个文件 / 512 MiB，超限会报错。',
  ),
  'case-conflict-report': op(
    'Windows 文件名预检',
    'case-conflict-report',
    { path: path.default('.') },
    { path: '.' },
  ),
  'task-import': op(
    '导入项目任务',
    'task-import',
    { save: z.boolean().default(false) },
    { save: false },
    '识别 npm、Make、Just、Taskfile 静态任务名；保存为 Sakura 收藏命令，不执行任务。',
    true,
  ),
  'project-onboarding': op(
    '生成项目上手步骤',
    'project-onboarding',
    {},
    {},
    '读取项目清单与 README 复选项，生成待执行步骤。',
  ),
  'env-schema': op(
    '校验环境变量',
    'env-schema',
    {
      rules: z.record(
        z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
        z
          .object({
            type: z.enum(['string', 'integer', 'boolean', 'url']).default('string'),
            required: z.boolean().default(true),
            choices: z.array(z.string()).optional(),
          })
          .strict(),
      ),
    },
    {
      rules: { NODE_ENV: { type: 'string', required: true, choices: ['development', 'test', 'production'] } },
    },
    '校验项目最终继承的环境变量，报告只包含变量名。',
  ),
  'shell-profiles': op(
    '项目 Shell 启动环境',
    'shell-profiles',
    {
      mode: z.enum(['save', 'run', 'read']),
      content: z.string().max(16384).default(''),
      command: command.optional(),
    },
    { mode: 'read' },
    '配置保存在项目 .sakura/profile.sh；通过本入口启动的命令会显式加载它。',
    true,
  ),
  'toolchain-check': op(
    '工具链兼容性检查',
    'toolchain-check',
    {},
    {},
    '检测已安装版本和项目清单；无法解析的版本约束明确标为待人工核对。',
  ),
  'bootstrap-dry-run': op(
    '初始化前置检查',
    'bootstrap-dry-run',
    { command },
    { command: 'npm ci' },
    '只做 Shell 语法、工具和路径检查；不能预测脚本的所有副作用。',
  ),
  'project-template-pack': op(
    '项目模板打包',
    'project-template-pack',
    { target: path, excludes: z.array(path).max(100).default([]) },
    { target: 'project-template.tar.gz', excludes: [] },
    '默认排除 .git、依赖目录、.env、私钥和 Sakura 内部状态；打包前仍需检查项目是否含其他秘密。',
    true,
  ),
  'git-stash': op(
    'Git Stash',
    'git-stash',
    {
      mode: z.enum(['list', 'save', 'apply', 'drop']),
      ref: z
        .string()
        .regex(/^stash@\{\d{1,4}\}$/)
        .optional(),
      message: label.default('Sakura stash'),
    },
    { mode: 'list' },
    '应用不会自动删除 stash；保存包含未跟踪文件。',
    true,
  ),
  'git-reflog': op(
    '从 Reflog 恢复分支',
    'git-reflog',
    {
      mode: z.enum(['list', 'recover']),
      commit: z
        .string()
        .regex(/^[a-f0-9]{7,40}$/)
        .optional(),
      branch: ref.optional(),
    },
    { mode: 'list' },
    '恢复创建新分支，不重置或覆盖当前工作区。',
    true,
  ),
  'git-cherry-pick': op(
    'Cherry-pick / Revert',
    'git-cherry-pick',
    {
      mode: z.enum(['pick', 'revert', 'continue', 'abort']),
      commit: z
        .string()
        .regex(/^[a-f0-9]{7,40}$/)
        .optional(),
      sequence: z.enum(['cherry-pick', 'revert']).default('cherry-pick'),
    },
    { mode: 'pick', commit: '填入提交 SHA' },
    '冲突保留现场；继续和中止显式选择对应序列。',
    true,
  ),
  'git-bisect': op(
    'Git Bisect',
    'git-bisect',
    {
      mode: z.enum(['start', 'good', 'bad', 'skip', 'reset', 'log']),
      good: ref.optional(),
      bad: ref.optional(),
    },
    { mode: 'log' },
    '启动二分前要求干净工作区；重置回到起点。',
    true,
  ),
  'git-rebase': op(
    '交互式 Rebase',
    'git-rebase',
    {
      mode: z.enum(['plan', 'apply', 'continue', 'abort']),
      base: ref.optional(),
      head: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .optional(),
      todo: z
        .array(
          z
            .object({
              action: z.enum(['pick', 'reword', 'squash', 'fixup', 'drop']),
              commit: z.string().regex(/^[a-f0-9]{7,40}$/),
              message: label.optional(),
            })
            .strict(),
        )
        .max(100)
        .optional(),
    },
    { mode: 'plan', base: 'HEAD~3' },
    '先生成计划，再提交显式的提交列表；拒绝 exec 和未纳入计划的提交。',
    true,
  ),
  'git-policy': op(
    '分支与提交策略检查',
    'git-policy',
    {
      branchPrefixes: z.array(z.string().max(80)).max(20).default(['feat/', 'fix/', 'codex/']),
      commitTypes: z
        .array(z.string().regex(/^[a-z]+$/))
        .max(30)
        .default(['feat', 'fix', 'docs', 'test', 'chore', 'refactor', 'perf']),
      message: label.optional(),
    },
    {
      branchPrefixes: ['feat/', 'fix/', 'codex/'],
      commitTypes: ['feat', 'fix', 'docs', 'test', 'chore', 'refactor', 'perf'],
    },
  ),
  'precommit-secrets': op(
    '暂存区密钥扫描',
    'precommit-secrets',
    {},
    {},
    '扫描 Git 暂存区而非工作区；仅输出路径、行号和规则，不输出匹配值。',
  ),
  'code-ownership': op(
    'CODEOWNERS 映射',
    'code-ownership',
    { paths: z.array(path).max(200).default([]) },
    { paths: ['src/main.tsx'] },
    '支持常用路径与通配符和最后匹配规则；不向评审人发送消息。',
  ),
  'flaky-tests': op(
    '重复运行检查不稳定性',
    'flaky-tests',
    {
      command,
      repeats: z.number().int().min(2).max(20).default(3),
      timeout: z.number().int().min(1).max(120).default(60),
    },
    { command: 'npm test', repeats: 3, timeout: 60 },
    '按命令退出码区分稳定通过、稳定失败与偶发失败；保留每轮耗时。',
    true,
  ),
  'coverage-history': op(
    '读取覆盖率',
    'coverage-history',
    { path: path.default('coverage/coverage-summary.json') },
    { path: 'coverage/coverage-summary.json' },
    '支持 Istanbul summary、LCOV 和 coverage.py JSON；结果保存到运行历史。',
  ),
  'benchmark-regression': op(
    '性能基准',
    'benchmark-regression',
    {
      command,
      repeats: z.number().int().min(1).max(20).default(5),
      timeout: z.number().int().min(1).max(120).default(60),
      baselineMs: z.number().positive().optional(),
      thresholdPercent: z.number().min(0).max(1000).default(20),
    },
    { command: 'npm run build', repeats: 5, timeout: 60, thresholdPercent: 20 },
    '采用耗时中位数与给定基线比较；命令失败会使任务失败。',
    true,
  ),
  sbom: op(
    '生成 CycloneDX SBOM',
    'sbom',
    {},
    {},
    '支持 npm package-lock v2/v3，报告精确版本与可用的完整性信息。',
  ),
  'license-report': op(
    '依赖许可证报告',
    'license-report',
    {
      allowed: z
        .array(z.string().max(120))
        .max(100)
        .default(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause']),
    },
    { allowed: ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause'] },
    '读取 npm 锁文件或已安装包的声明；缺失或复合许可证标为待审查，不提供法律结论。',
  ),
  'release-gates': op(
    '执行发布门禁',
    'release-gates',
    {
      checks: z
        .array(
          z.object({ name: label, command, timeout: z.number().int().min(1).max(120).default(60) }).strict(),
        )
        .min(1)
        .max(12),
      artifacts: z.array(path).max(50).default([]),
    },
    { checks: [{ name: '测试', command: 'npm test', timeout: 60 }], artifacts: ['dist'] },
    '所有检查和产物存在性必须通过；不自动发布。',
    true,
  ),
  'artifact-provenance': op(
    '构建来源清单',
    'artifact-provenance',
    { path },
    { path: 'dist' },
    '记录 Git 提交、脏状态、构建产物哈希和工具版本；此清单本身不等于可信签名。',
  ),
  changelog: op(
    '生成变更日志',
    'changelog',
    { from: ref.optional(), to: ref.default('HEAD') },
    { to: 'HEAD' },
  ),
  'reproducible-build': op(
    '双目录可复现构建',
    'reproducible-build',
    { command, artifact: path, timeout: z.number().int().min(1).max(300).default(120) },
    { command: 'npm ci && npm run build', artifact: 'dist', timeout: 120 },
    '从同一 Git 提交导出两个临时目录独立构建，比较产物哈希；命令可联网安装依赖。',
    true,
  ),
  'posix-acl': op(
    'POSIX ACL',
    'posix-acl',
    {
      path,
      mode: z.enum(['read', 'set', 'remove']),
      entry: z
        .string()
        .regex(/^[ug]:[a-zA-Z0-9_-]{1,32}:[rwx-]{3}$/)
        .optional(),
    },
    { path: '.', mode: 'read' },
    '需要客户机 acl 软件包；只操作所选路径，不递归修改。',
    true,
  ),
  'guest-clock-policy': op(
    '时钟同步',
    'guest-clock-policy',
    { mode: z.enum(['inspect', 'sync']) },
    { mode: 'inspect' },
    '同步使用宿主机 UTC，需客户机 date 权限；输出同步前后的偏差。',
    true,
  ),
  'static-routes': op(
    '客户机静态路由',
    'static-routes',
    {
      mode: z.enum(['list', 'add', 'delete']),
      destination: z.string().max(64).optional(),
      gateway: z.string().max(64).optional(),
    },
    { mode: 'list' },
    '校验 IP/CIDR，只增删显式指定的非默认路由；重启后不持久。',
    true,
  ),
  'process-history': op(
    '进程资源采样',
    'process-history',
    {},
    {},
    '读取 /proc，记录 PID、启动标识、RSS 和 CPU 时间；不采集命令参数。',
  ),
  'disk-io-metrics': op(
    '磁盘 I/O 采样',
    'disk-io-metrics',
    {},
    {},
    '采样一秒，计算吞吐、平均 I/O 延迟、在途请求。',
  ),
  'network-metrics': op(
    '网络流量采样',
    'network-metrics',
    {},
    {},
    '采样一秒，返回接口收发字节、包、错误与丢包增量。',
  ),
  'command-risk': op(
    '命令风险预检',
    'command-risk',
    { command },
    { command: 'rm -rf build' },
    '启发式标记删除、提权、下载执行与外部传输；不能作为安全沙箱。',
  ),
  'command-macros': op(
    '执行条件命令宏',
    'command-macros',
    {
      steps: z
        .array(
          z
            .object({
              name: label,
              argv,
              when: z.enum(['always', 'success', 'failure']).default('success'),
              timeout: z.number().int().min(1).max(120).default(60),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    },
    { steps: [{ name: '环境', argv: ['uname', '-a'], when: 'always', timeout: 60 }] },
    '每一步直接传 argv；只在明确指定 sh -c 时使用 Shell。',
    true,
  ),
  runbooks: op(
    '运行运维手册',
    'runbooks',
    {
      steps: z
        .array(
          z.object({ name: label, command, timeout: z.number().int().min(1).max(120).default(60) }).strict(),
        )
        .min(1)
        .max(20),
    },
    { steps: [{ name: '空间检查', command: 'df -h', timeout: 10 }] },
    '依次运行诊断和修复；首个失败停止，保留结果。',
    true,
  ),
  'feature-run': op(
    '扩展能力适配器',
    'extended-features',
    {
      featureId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
      mode: z.enum(['check', 'run']).default('run'),
      options: z.record(z.string(), z.unknown()).default({}),
    },
    { featureId: 'session-lock', mode: 'run', options: {} },
    '统一执行任意扩展能力的检查或便携适配器。',
  ),
} as const;

export type EngineeringOperation = keyof typeof engineeringOperations;
/**
 * 入口 / Entry: validateOperation.
 * 功能：在声明工程操作目录与参数约束中，核对调用资格、输入或资源归属；本入口产生 `{ operation, parameters }` 供上层消费（`engineering-operations.ts`）。
 * Purpose: Checks admission, input or resource ownership in `engineering-operations.ts`; this entry produces `{ operation, parameters }` for its caller. Module context: Declares engineering actions and parameter boundaries, leaving archive and project-path enforcement to the guest runner.
 * 处理：通过 `z.object().strict().parse`, `z.object().strict`, `z.object`, `z.string` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.object().strict().parse`, `z.object().strict`, `z.object`, `z.string`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `operation === 'archive' && mode !== 'list'`; `operation === 'shell-profiles' && mode === 'run'`; `operation === 'git-reflog' && mode === 'recover'`.
 * 输入 / Inputs: input: unknown
 * 输出 / Returns: `{ operation, parameters }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Object.hasOwn(engineeringOperations, body.operation)`; `operation === 'git-rebase' && (mode === 'plan' || mode === 'apply')`; `mode === 'apply'`; 异常 / errors `new AppError('操作不存在', 400)`; `new AppError('计划不能为空；reword 需要提供 message')`.
 */
export function validateOperation(input: unknown) {
  const body = z
    .object({ operation: z.string(), parameters: z.record(z.string(), z.unknown()).default({}) })
    .strict()
    .parse(input);
  if (!Object.hasOwn(engineeringOperations, body.operation)) throw new AppError('操作不存在', 400);
  const operation = body.operation as EngineeringOperation;
  const parameters = engineeringOperations[operation].schema.parse(body.parameters) as Record<
    string,
    unknown
  >;
  /**
   * 入口 / Entry: validateOperation.need.
   * 功能：在声明工程操作目录与参数约束中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`engineering-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `engineering-operations.ts`; the calls and state transitions below complete the operation. Module context: Declares engineering actions and parameter boundaries, leaving archive and project-path enforcement to the guest runner.
   * 输入 / Inputs: keys: string[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `parameters[key] === undefined`; 异常 / errors `new AppError('此操作需要参数：' + key, 400)`.
   */
  const need = (...keys: string[]) => {
    for (const key of keys)
      if (parameters[key] === undefined) throw new AppError('此操作需要参数：' + key, 400);
  };
  const mode = parameters.mode;
  if (operation === 'archive' && mode !== 'list') need('target');
  if (operation === 'shell-profiles' && mode === 'run') need('command');
  if (operation === 'git-reflog' && mode === 'recover') need('commit', 'branch');
  if (operation === 'git-cherry-pick' && (mode === 'pick' || mode === 'revert')) need('commit');
  if (operation === 'git-bisect' && mode === 'start') need('good', 'bad');
  if (operation === 'git-rebase' && (mode === 'plan' || mode === 'apply')) {
    need('base');
    if (mode === 'apply') {
      need('todo');
      const todo = parameters.todo as Array<{ action: string; message?: string }>;
      if (!todo.length || todo.some((item) => item.action === 'reword' && !item.message))
        throw new AppError('计划不能为空；reword 需要提供 message');
    }
  }
  if (operation === 'posix-acl' && mode !== 'read') need('entry');
  if (operation === 'static-routes' && mode !== 'list') {
    need('destination');
    const [address, prefix, extra] = String(parameters.destination).split('/');
    const family = isIP(address);
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))
    )
      throw new AppError('需要非默认的有效 IP/CIDR 路由');
    if (parameters.gateway && isIP(String(parameters.gateway)) !== family)
      throw new AppError('网关 IP 与目标协议不一致');
  }
  return { operation, parameters };
}
/**
 * 入口 / Entry: operationViews.
 * 功能：从当前输入或状态计算 `Object.entries(engineeringOperations).map(([id, v]) => ({ id, name: v.name, feature: v.feature, example: v.example, note: v.n…`，供调用方后续验证或使用。
 * Purpose: Computes `Object.entries(engineeringOperations).map(([id, v]) => ({ id, name: v.name, feature: v.feature, example: v.example, note: v.n…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `Object.entries(engineeringOperations).map(([id, v]) => ({ id, name: v.name, feature: v.feature, example: v.example, note: v.n…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export const operationViews = () =>
  Object.entries(engineeringOperations).map(([id, v]) => ({
    id,
    name: v.name,
    feature: v.feature,
    example: v.example,
    note: v.note,
    writes: v.writes,
    schema: z.toJSONSchema(v.schema),
  }));
