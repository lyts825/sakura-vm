import { z } from 'zod';
import type { CapabilityActionView } from '../shared/capability-actions.ts';
import { timeWindowSchema } from './automation-policy.ts';
import { cpuTopologySchema, deviceProfileSchema } from '../shared/hardware.ts';
import { reservationSchema } from './resource-policies.ts';
import { diskHealthThresholds } from './host-disk-health.ts';
import { powerPolicySchema } from './power-policy.ts';
import { networkEmulationShape } from './network-emulation.ts';
import { flamegraphOptions } from './flamegraph.ts';
import { ebpfProfileOptions } from './ebpf-profiler.ts';
import { coldMigrationInput, maintenanceDrainInput } from './cold-migration.ts';
import { snapshotReplicationInput } from './snapshot-replications.ts';
import { notebookInput } from './notebook-environments.ts';
import { browserIdeInput } from './browser-ide.ts';

export const relativePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes(':') &&
      !value.split('/').includes('..') &&
      !/[\x00-\x1f]/.test(value),
    '需要项目内的相对路径',
  );
const label = z.string().trim().min(1).max(120);
const argv = z.array(z.string().max(4096)).min(1).max(80);
const timeout = z.number().int().min(1).max(1800).default(60);
const uuid = z.uuid();
const projectId = z
  .string()
  .regex(/^(default|[a-f0-9]{16})$/)
  .default('default');
const target = z.object({ vmId: uuid, projectId }).strict();
const action = <T extends z.ZodRawShape>(
  name: string,
  scope: CapabilityActionView['scope'],
  shape: T,
  example: Record<string, unknown>,
  note: string,
  requiresGuest = true,
  writes = false,
) => ({ name, scope, schema: z.object(shape).strict(), example, note, requiresGuest, writes });

export const capabilityDefinitions = {
  'authenticated-ide-preview': action(
    '认证浏览器 IDE',
    'next',
    browserIdeInput.shape,
    { mode: 'status', guestPort: 8080, hostPort: 8080, ttlMinutes: 60 },
    'Debian/Ubuntu 客户机可安装并启动 code-server。入口只转发到本机回环地址，随机密码通过单独接口取得，到期会停止会话。',
    false,
    true,
  ),
  'notebook-environment': action(
    'Jupyter/Marimo 环境',
    'next',
    notebookInput.shape,
    { mode: 'status', provider: 'jupyter', guestPort: 8888, hostPort: 8888 },
    '当前项目可安装并启动 JupyterLab 或 Marimo。start 自动安装缺少的工具，创建仅监听本机回环地址的端口映射；stop 关闭会话并移除由该功能创建的映射。访问链接通过单独的本机控制接口获取。',
    false,
    true,
  ),
  'cross-host-snapshots': action(
    '跨主机快照复制',
    'next',
    snapshotReplicationInput.shape,
    { peerId: '', snapshotId: '', targetName: 'snapshot-replica' },
    '停止实例后，把所选历史快照的磁盘和身份校验并传至已授权主机，作为独立实例导入。来源不变；持久回执可重试。快照 ID 可在快照页查看。',
    false,
    true,
  ),
  'maintenance-drain': action(
    '主机维护排空',
    'next',
    maintenanceDrainInput.shape,
    { peerId: '', confirmSourceRemoval: false, targetNames: {} },
    '在任意实例的能力中心检查本机全部实例。先停止所有实例并复制到同一已授权目标；逐台验证目标后再明确确认移除源实例。目标名称冲突或源实例变化时，可用 targetNames 按实例 ID 指定新目标名。',
    false,
    true,
  ),
  'cold-migration': action(
    '跨主机冷迁移',
    'next',
    coldMigrationInput.shape,
    { peerId: '', targetName: 'migrated-vm', confirmSourceRemoval: false },
    '停止实例后，通过已配对且明确授权导入的主机传送校验后的完整实例包；队列保留重试标识。默认保留源实例，确认目标可用后才勾选移除源实例。',
    false,
    true,
  ),
  'ebpf-profiler': action(
    'eBPF 内核性能分析',
    'next',
    ebpfProfileOptions.shape,
    { durationSeconds: 5, frequencyHz: 49 },
    '在运行中的客户机用 bpftrace 的 profile 探针采样内核调用栈，统计热点函数并下载完整报告。需要客户机安装 bpftrace，且内核与权限允许 eBPF。',
  ),
  flamegraph: action(
    '客户机性能火焰图',
    'next',
    flamegraphOptions.shape,
    { durationSeconds: 5, frequencyHz: 49 },
    '在运行中的客户机用 perf 对所有 CPU 采样调用栈，聚合为可下载的 SVG 火焰图。需要客户机安装 perf 并允许性能采样；最长 10 秒，最多分析 2000 次采样。',
  ),
  'network-emulation': action(
    '客户机延迟与丢包模拟',
    'next',
    networkEmulationShape,
    { mode: 'inspect', interface: 'eth0', delayMs: 50, jitterMs: 0, lossPercent: 0 },
    '检查客户机 tc 队列规则，预览指定网卡上的延迟、抖动和丢包参数；apply 实际设置 netem，clear 仅清除当前根 netem 规则。规则由 Linux 内核管理，客户机重启后需重新应用。',
    true,
    true,
  ),
  'power-aware-schedule': action(
    '宿主电源感知调度',
    'extended',
    { mode: z.enum(['inspect', 'save']).default('inspect'), policy: powerPolicySchema.optional() },
    {
      mode: 'inspect',
      policy: { enabled: false, allowBatteryStarts: false, minimumBatteryPercent: 30, stopBelowPercent: 0 },
    },
    '按实例保存电源策略。启用自动化调度后，依据交流电、电池电量限制计划开机；stopBelowPercent 大于零时在低电量下调用停止流程（请求关机，15 秒后仍未退出则结束虚拟机）。状态未知不关机，暂停自动开机；维护窗口内暂停操作，手动操作不受影响。',
    false,
    true,
  ),
  'host-disk-health': action(
    '主机数据磁盘健康报告',
    'next',
    diskHealthThresholds.shape,
    { minimumFreeGiB: 10, minimumFreePercent: 5, maximumTemperatureC: 70, maximumWearPercent: 90 },
    '读取数据目录所在卷及磁盘的 Windows 健康状态、容量、温度、寿命消耗和读写错误。设备或权限不提供计数器时明确显示未知；只读检查，可导出报告。',
    false,
  ),
  'network-diagnostics': action(
    'DNS、TCP、HTTPS 与路由诊断',
    'suite',
    {
      target: z
        .string()
        .trim()
        .min(1)
        .max(253)
        .regex(/^[A-Za-z0-9:][A-Za-z0-9.:-]*$/)
        .default('example.com'),
      port: z.number().int().min(1).max(65535).default(443),
      probes: z
        .array(z.enum(['dns', 'tcp', 'https', 'route']))
        .min(1)
        .max(4)
        .refine((values) => new Set(values).size === values.length, '检查项不能重复')
        .default(['dns', 'tcp', 'https', 'route']),
      timeout: z.number().int().min(1).max(30).default(10),
    },
    { target: 'example.com', port: 443, probes: ['dns', 'tcp', 'https', 'route'], timeout: 10 },
    '在客户机逐项执行 DNS 解析、TCP 连接、验证证书的 HTTPS HEAD 和实际路由查询。每项独立限时，任一失败则整体失败；返回地址、状态码、耗时及原因。不跟随重定向，不读取响应正文。',
  ),
  'availability-report': action(
    '实例可用性报告',
    'extended',
    { hours: z.number().min(1).max(720).default(24) },
    { hours: 24 },
    '基于自动化调度的持续采样，统计运行、停止、探测失败与未知时段。超过 90 秒的采集空白不算正常运行；显示观测覆盖率，可导出报告。需启用自动化调度来积累记录。',
    false,
  ),
  'global-dedup': action(
    '全局备份去重统计与清理',
    'next',
    {
      mode: z.enum(['inspect', 'collect']).default('inspect'),
    },
    { mode: 'inspect' },
    '统计本机全部实例的备份内容块、逻辑大小和共享节省量。collect 在校验全部清单引用后清理无引用块；被任何备份引用的内容均保留。',
    false,
    true,
  ),
  'audit-log': action(
    '审计日志链校验与导出',
    'extended',
    { limit: z.number().int().min(1).max(2000).default(200), allMachines: z.boolean().default(false) },
    { limit: 200, allMachines: false },
    '记录控制面写操作和后台任务的开始、结果，按 HMAC 链和独立封印检查篡改或截断。仅包含操作元数据；保护依赖本机审计密钥。',
    false,
  ),
  'otel-tracing': action(
    'OpenTelemetry 请求与任务链路',
    'next',
    { limit: z.number().int().min(10).max(2000).default(1000), allMachines: z.boolean().default(false) },
    { limit: 1000, allMachines: false },
    '从真实控制面写请求与后台任务事件生成 OTLP JSON，保留 trace/span 父子关系、时长和结果码；可下载导入采集器，不发送到外部服务。',
    false,
  ),
  'dependency-report': action(
    '依赖关系与更新报告',
    'suite',
    {
      manager: z.enum(['auto', 'npm', 'python']).default('auto'),
      updates: z.boolean().default(false),
      timeout,
    },
    { manager: 'auto', updates: false, timeout: 60 },
    '读取 npm 锁文件的直接与传递依赖图，或当前 Python 环境的安装元数据。updates 显式查询包源并列出可升级版本；不修改依赖。',
  ),
  'runtime-matrix': action(
    '运行时版本管理',
    'suite',
    {
      mode: z.enum(['list', 'versions', 'install']).default('list'),
      runtime: z.enum(['go', 'java', 'dotnet', 'php']).default('go'),
      package: z
        .string()
        .regex(/^[a-z0-9][a-z0-9+._-]{0,100}$/)
        .optional(),
      version: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9.+:~_-]{0,100}$/)
        .optional(),
      timeout: z.number().int().min(30).max(1800).default(600),
    },
    { mode: 'list', runtime: 'go', timeout: 600 },
    '探测 Go、Java、.NET 和 PHP；versions 查询 apk/apt 实际包版本，install 需要明确 package 和 version，先模拟依赖变化再安装指定版本。',
    true,
    true,
  ),
  'reproducible-env': action(
    '环境锁定、校验与安装',
    'suite',
    {
      mode: z.enum(['capture', 'verify', 'install']).default('verify'),
      installSystem: z.boolean().default(false),
      timeout: z.number().int().min(30).max(1800).default(600),
    },
    { mode: 'verify', installSystem: false, timeout: 600 },
    '锁定 OS、架构、系统包精确版本、工具版本和项目依赖文件哈希；安装前校验锁文件，依赖使用 frozen/locked 模式。installSystem 显式安装精确系统包；不同发行版拒绝重建。',
    true,
    true,
  ),
  'resource-presets': action(
    '资源预设与宿主机推荐',
    'suite',
    {
      mode: z.enum(['list', 'save', 'delete', 'apply']).default('list'),
      name: label.optional(),
      workload: z.enum(['light', 'development', 'build', 'desktop']).default('development'),
      growDisk: z.boolean().default(false),
      preset: z
        .object({
          name: label,
          memoryMiB: z.number().int().min(256).max(8192),
          cpus: z.number().int().min(1).max(8),
          diskGiB: z.number().int().min(2).max(128),
        })
        .strict()
        .optional(),
    },
    { mode: 'list', workload: 'development' },
    '列出、保存、应用资源预设，按宿主 CPU、内存和发行版最低要求推荐资源。停止后应用；growDisk 显式扩容且不会缩小磁盘。',
    false,
    true,
  ),
  'cpu-topology': action(
    'CPU 拓扑与 NUMA',
    'extended',
    {
      mode: z.enum(['view', 'save', 'reset']).default('view'),
      topology: cpuTopologySchema.optional(),
    },
    { mode: 'view' },
    '停止后保存 sockets/cores/threads 与可选 NUMA 节点；启动参数实际应用并随实例包导出。NUMA 必须完整分配 CPU 与内存。',
    false,
    true,
  ),
  'device-profiles': action(
    '虚拟设备档案',
    'extended',
    {
      mode: z.enum(['list', 'save', 'apply', 'delete']).default('list'),
      name: label.optional(),
      profile: deviceProfileSchema.optional(),
    },
    { mode: 'list' },
    '保存和应用网卡、随机数、内存气球、磁盘缓存与 TRIM 设备组合；停止后应用，下次启动生效。',
    false,
    true,
  ),
  'resource-reservation': action(
    '资源预算与启动优先级',
    'extended',
    {
      mode: z.enum(['view', 'save']).default('view'),
      policy: reservationSchema.optional(),
    },
    { mode: 'view' },
    '限制运行实例的总 vCPU 和物理内存预算，并为宿主机预留内存。启动与热插拔均执行预算检查；计划启动按 priorities 从高到低。',
    false,
    true,
  ),
  ipv6: action(
    '客户机 IPv6',
    'extended',
    {
      mode: z.enum(['view', 'save']).default('view'),
      enabled: z.boolean().default(true),
    },
    { mode: 'view' },
    '停止后启用或关闭 QEMU 用户网络 IPv6；运行时读取客户机 IPv6 地址与路由。公网连通性取决于宿主网络。',
    false,
    true,
  ),
  'vcpu-hotplug': action(
    '在线添加 vCPU',
    'next',
    {
      mode: z.enum(['view', 'configure', 'add']).default('view'),
      maximum: z.number().int().min(1).max(8).default(8),
      target: z.number().int().min(1).max(8).optional(),
    },
    { mode: 'view' },
    'configure 在停止时预留插槽；TCG 模式下 add 添加到 target 个 vCPU 并确认 Linux 上线。执行前检查内核预留数量；当前 Alpine 6.18 内核未识别 TCG 预留 CPU 时拒绝添加，WHPX 也拒绝在线修改。',
    false,
    true,
  ),
  'memory-hotplug': action(
    '在线添加内存',
    'next',
    {
      mode: z.enum(['view', 'configure', 'add']).default('view'),
      maximum: z.number().int().min(256).max(8192).default(8192),
      slots: z.number().int().min(1).max(8).default(4),
      target: z.number().int().min(256).max(8192).optional(),
    },
    { mode: 'view' },
    'configure 在停止时预留最大内存与插槽；TCG 模式下 add 添加 pc-dimm 并核验实际容量。需要客户机内核自动上线支持，按 128 MiB 对齐，仅支持增加；WHPX 拒绝在线修改。',
    false,
    true,
  ),
  'git-worktrees': action(
    'Git 工作树管理',
    'suite',
    {
      mode: z.enum(['list', 'create', 'open', 'remove']).default('list'),
      path: relativePath.optional(),
      directory: z.string().min(1).max(4096).optional(),
      ref: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_./~^{}@-]{0,127}$/)
        .default('HEAD'),
      branch: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/)
        .optional(),
      projectName: label.optional(),
    },
    { mode: 'list' },
    '列出真实 Git worktree；create 用项目内 path 创建，可指定新 branch；open 用列表中的 directory 打开为独立项目；remove 拒绝脏工作树和仍被项目引用的目录。',
    true,
    true,
  ),
  'crash-loop-guard': action(
    '启动失败熔断',
    'extended',
    { mode: z.enum(['status', 'reset']).default('status') },
    { mode: 'status' },
    '5 分钟内连续 5 次启动失败后拒绝再次启动；状态跨服务重启保存。客户机启动就绪后清零，停止实例后可手动重置。',
    false,
    true,
  ),
  'maintenance-windows': action(
    '自动任务维护窗口',
    'extended',
    {
      mode: z.enum(['view', 'save']).default('view'),
      enabled: z.boolean().default(false),
      windows: z.array(timeWindowSchema).max(32).default([]),
    },
    { mode: 'view' },
    '按时区与星期暂停新启动的计划启停、自动同步和定期备份；运行中的任务与手动操作继续。跨午夜窗口归属开始日。',
    false,
    true,
  ),
  'workspace-search': action(
    '跨实例与项目全文搜索',
    'suite',
    {
      query: z.string().min(1).max(256),
      caseSensitive: z.boolean().default(false),
      targets: z.array(target).max(32).default([]),
      limit: z.number().int().min(1).max(500).default(100),
    },
    { query: 'TODO', targets: [], caseSensitive: false, limit: 100 },
    '实时搜索所选实例与项目；targets 为空时遍历当前运行实例的全部项目。结果附实例、项目、文件和行号，失败目标单独列出。',
    false,
  ),
  'schema-panels': action(
    'Schema 表单目录',
    'next',
    {},
    {},
    '导出所有可执行功能的参数 Schema；各功能面板可展开参数表单，填写枚举、数值、开关和结构化参数。',
    false,
  ),
  'compliance-evidence': action(
    '操作证据导出',
    'next',
    {
      hours: z.number().int().min(1).max(8760).default(24),
    },
    { hours: 24 },
    '导出当前项目任务结果摘要、结果哈希和能力 Schema 指纹；不包含日志正文或凭据。',
    false,
  ),
  'proxy-pac': action(
    'PAC 代理规则生成',
    'next',
    {
      rules: z
        .array(
          z
            .object({
              domain: z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/),
              subdomains: z.boolean().default(true),
              proxy: z.string().regex(/^(DIRECT|(?:PROXY|HTTPS|SOCKS5) [A-Za-z0-9.-]+:[0-9]{1,5})$/),
            })
            .strict(),
        )
        .max(200),
      fallback: z.literal('DIRECT').default('DIRECT'),
    },
    {
      rules: [{ domain: 'example.com', subdomains: true, proxy: 'PROXY 127.0.0.1:8080' }],
      fallback: 'DIRECT',
    },
    '生成浏览器可用的 PAC 文件；严格匹配域名边界，按规则顺序选择代理。下载后可导入系统或浏览器。',
    false,
  ),
  'build-cache': action(
    '可校验构建缓存',
    'next',
    {
      mode: z.enum(['save', 'restore', 'inspect']),
      path: relativePath.default('dist'),
      inputs: z.array(relativePath).min(1).max(100),
      target: relativePath.optional(),
      namespace: label.default('default'),
    },
    { mode: 'save', path: 'dist', inputs: ['package-lock.json'], namespace: 'default' },
    '由输入文件哈希和命名空间生成缓存键，保存构建目录；恢复时校验每个文件，只写入新的目标目录。',
    true,
    true,
  ),
  'branch-preview': action(
    '分支预览工作区',
    'next',
    {
      mode: z.enum(['create', 'list', 'remove']).default('list'),
      ref: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_./~^{}@-]{0,127}$/)
        .default('HEAD'),
      previewId: z.uuid().optional(),
    },
    { mode: 'list' },
    '创建独立 Git worktree 并记录提交；列出预览目录，清理时拒绝删除有未提交改动的工作树。',
    true,
    true,
  ),
  'onboarding-checklist': action(
    '项目入门清单',
    'next',
    {
      mode: z.enum(['list', 'add', 'complete', 'reopen', 'remove']).default('list'),
      member: label.default('本地用户'),
      title: label.optional(),
      stepId: z.uuid().optional(),
    },
    { mode: 'list', member: '本地用户' },
    '保存项目入门步骤及每位成员的完成时间；成员名称是本地记录标签，不代表身份认证。',
    true,
    true,
  ),
  'review-threads': action(
    '行级评审线程',
    'next',
    {
      mode: z.enum(['list', 'comment', 'reply', 'resolve', 'reopen']).default('list'),
      threadId: z.uuid().optional(),
      path: relativePath.optional(),
      line: z.number().int().positive().max(1000000).optional(),
      body: z.string().trim().min(1).max(12000).optional(),
      author: label.default('本地用户'),
    },
    { mode: 'list' },
    '与本地代码评审共用项目线程，支持行级评论、回复、解决和重新打开。',
    true,
    true,
  ),
  'patch-bundle': action(
    '补丁签名包',
    'extended',
    {
      mode: z.enum(['keygen', 'create', 'verify']),
      target: relativePath,
      from: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_./~^{}@-]{0,127}$/)
        .optional(),
      to: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_./~^{}@-]{0,127}$/)
        .default('HEAD'),
      privateKey: relativePath.optional(),
      publicKey: relativePath.optional(),
    },
    {
      mode: 'create',
      from: 'HEAD~1',
      to: 'HEAD',
      target: 'change.sakura-patch.json',
      privateKey: '.sakura/keys/patch.pem',
    },
    '使用 Ed25519 签名完整 Git 补丁；verify 必须指定独立受信任公钥，不能信任包内自带的密钥。',
    true,
    true,
  ),
  'format-lint': action(
    '格式化、检查与自动修复',
    'suite',
    {
      mode: z.enum(['lint', 'format', 'fix']),
      tool: z.enum(['auto', 'npm', 'ruff', 'cargo', 'go']).default('auto'),
      timeout,
    },
    { mode: 'lint', tool: 'auto', timeout: 60 },
    '统一执行项目脚本或语言工具；缺工具和检查失败都返回失败。',
    true,
    true,
  ),
  'environment-recreate': action(
    '按锁文件重建项目环境',
    'extended',
    {
      target: relativePath,
      timeout: z.number().int().min(1).max(1800).default(600),
    },
    { target: 'rebuilt-environment', timeout: 600 },
    '从当前 Git 提交导出到新目录，识别锁文件并实际安装依赖；保留原项目，失败保留新目录便于检查。',
    true,
    true,
  ),
  'editor-profiles': action(
    '编辑器连接档案',
    'extended',
    {
      editor: z.enum(['jetbrains', 'neovim', 'vscode']).default('neovim'),
    },
    { editor: 'neovim' },
    '生成当前实例的 SSH 档案与编辑器启动命令，可下载；不改写宿主现有 SSH 配置。',
    false,
  ),
  'metrics-export': action(
    '指标导出',
    'extended',
    {
      format: z.enum(['prometheus', 'otlp-json']).default('prometheus'),
    },
    { format: 'prometheus' },
    '从真实客户机采样生成 Prometheus 文本或 OTLP JSON，可保存为文件。',
  ),
  'event-timeline': action(
    '事件关联时间线',
    'extended',
    {
      limit: z.number().int().min(1).max(500).default(100),
    },
    { limit: 100 },
    '关联当前实例的任务起止、失败和资源告警，按时间排序。',
    false,
  ),
  'activity-digest': action(
    '活动摘要',
    'next',
    {
      hours: z.number().int().min(1).max(8760).default(24),
    },
    { hours: 24 },
    '从任务和告警历史生成时段摘要、失败列表和耗时统计。',
    false,
  ),
  'slo-dashboard': action(
    '任务 SLO 仪表盘',
    'next',
    {
      targetPercent: z.number().gt(0).lte(100).default(99.9),
      hours: z.number().int().min(1).max(8760).default(24),
    },
    { targetPercent: 99.9, hours: 24 },
    '按已完成任务计算成功率、目标达成情况和失败预算；无样本时不推断可用性。',
    false,
  ),
  'error-budget': action(
    '任务错误预算',
    'next',
    {
      targetPercent: z.number().gt(0).lte(100).default(99.9),
      hours: z.number().int().min(1).max(8760).default(24),
    },
    { targetPercent: 99.9, hours: 24 },
    '按任务 SLO 计算允许失败数、已消耗预算及剩余预算。',
    false,
  ),
  'capacity-forecast': action(
    '宿主容量预测',
    'next',
    {
      memoryMiB: z.number().int().min(256).max(8192).default(1024),
      cpus: z.number().int().min(1).max(8).default(1),
      reservePercent: z.number().min(0).max(90).default(20),
    },
    { memoryMiB: 1024, cpus: 1, reservePercent: 20 },
    '依据宿主可用内存、CPU 及已运行实例资源，估算指定规格还能启动的实例数；不是未来负载承诺。',
    false,
  ),
  'anomaly-detection': action(
    '资源异常基线检测',
    'extended',
    {
      window: z.number().int().min(5).max(500).default(30),
      sigma: z.number().min(1).max(10).default(3),
    },
    { window: 30, sigma: 3 },
    '使用已有采样历史建立 CPU、内存及磁盘基线，返回最新点的偏差与异常原因。',
    false,
  ),
  'log-index': action(
    '任务日志索引',
    'next',
    {
      mode: z.enum(['build', 'search']).default('build'),
      query: z.string().min(1).max(256).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    { mode: 'build' },
    '索引当前实例与项目的持久任务日志，按文本检索并定位任务及日志行。',
    false,
    true,
  ),
  'test-sharding': action(
    '测试分片',
    'next',
    {
      mode: z.enum(['plan', 'run']).default('plan'),
      files: z.array(relativePath).min(1).max(20000),
      shards: z.number().int().min(1).max(16).default(2),
      argv: argv.optional(),
      timeout,
    },
    { mode: 'plan', files: ['tests/example.test.js'], shards: 2 },
    '按文件名稳定分片；run 要求 argv，{files} 展开为该片文件参数。各片有独立退出码、耗时和日志。',
    true,
    true,
  ),
  'directory-history': action(
    '目录版本与恢复',
    'suite',
    {
      mode: z.enum(['snapshot', 'list', 'diff', 'restore']),
      path: relativePath.default('src'),
      revision: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .optional(),
      target: relativePath.optional(),
      label: label.default('目录版本'),
    },
    { mode: 'snapshot', path: 'src', label: '修改前' },
    '保存目录内容与哈希；diff 与当前目录比较；restore 恢复到新的目标目录，保留当前内容。',
    true,
    true,
  ),
  'disk-analyzer': action(
    '磁盘类型与目录分析',
    'suite',
    {
      path: relativePath.default('.'),
      depth: z.number().int().min(1).max(8).default(3),
    },
    { path: '.', depth: 3 },
    '返回目录树、文件类型占用、最大文件；不跟随符号链接。',
  ),
  'review-comments': action(
    '本地代码评审',
    'extended',
    {
      mode: z.enum(['list', 'comment', 'reply', 'resolve', 'reopen']).default('list'),
      threadId: z.uuid().optional(),
      path: relativePath.optional(),
      line: z.number().int().positive().max(1000000).optional(),
      body: z.string().trim().min(1).max(12000).optional(),
      author: label.default('本地用户'),
    },
    { mode: 'list' },
    '在当前项目保存文件行级线程、回复和解决状态；记录提交及文件哈希。',
    true,
    true,
  ),
  'command-forms': action(
    '命令参数表单',
    'extended',
    {
      mode: z.enum(['preview', 'run']).default('preview'),
      argv,
      fields: z
        .array(
          z
            .object({
              name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/),
              label,
              type: z.enum(['string', 'integer', 'boolean', 'choice']).default('string'),
              required: z.boolean().default(true),
              choices: z.array(z.string()).max(100).optional(),
            })
            .strict(),
        )
        .max(40),
      values: z
        .record(z.string(), z.union([z.string().max(4096), z.number().int(), z.boolean()]))
        .default({}),
      timeout,
    },
    {
      mode: 'preview',
      argv: ['python3', '-m', 'pytest', '${TARGET}'],
      fields: [{ name: 'TARGET', label: '测试目录', type: 'string', required: true }],
      values: { TARGET: 'tests' },
    },
    '按声明生成字段并校验输入；占位符作为单个 argv 参数替换，命令不会经过 Shell。',
    true,
    true,
  ),
  'vm-dependency-start': action(
    '按依赖启动实例',
    'extended',
    {
      dependencies: z.record(uuid, z.array(uuid).max(32)),
      timeoutSeconds: z.number().int().min(1).max(900).default(300),
    },
    { dependencies: {} },
    '验证完整依赖图，按顺序等待每台实例就绪；失败即停止后续启动。',
    false,
    true,
  ),
  'environment-parity': action(
    '环境一致性报告',
    'extended',
    {
      targets: z.array(target).min(2).max(16),
    },
    { targets: [] },
    '实际读取每个目标的系统、工具版本及项目锁文件哈希，逐项比较，不收集环境变量值。',
    false,
  ),
  'test-matrix': action(
    '跨实例测试矩阵',
    'extended',
    {
      targets: z.array(target).min(1).max(16),
      argv,
      timeout,
    },
    { targets: [], argv: ['npm', 'test'], timeout: 60 },
    '在所选实例与项目中实际执行同一测试；保存每个目标的退出码、日志和耗时，任一失败即失败。',
    false,
    true,
  ),
  'cross-vm-copy': action(
    '跨实例文件复制',
    'extended',
    {
      source: relativePath,
      target: relativePath,
      targetVmId: uuid,
      targetProjectId: projectId,
    },
    { source: 'README.md', target: 'README.copy.md', targetVmId: '' },
    '通过 SFTP 流式复制普通文件，拒绝覆盖现有目标，并核对源文件变更与 SHA-256。',
    true,
    true,
  ),
  'network-topology': action(
    '客户机网络拓扑',
    'next',
    {},
    {},
    '读取真实接口、地址、路由和监听端口，连同实例端口转发生成拓扑。',
  ),
  'code-search-index': action(
    '代码搜索索引',
    'next',
    {
      mode: z.enum(['build', 'search']).default('build'),
      query: z.string().min(1).max(256).optional(),
      caseSensitive: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(100),
    },
    { mode: 'build' },
    '建立项目文本索引；搜索返回文件、行号、内容及索引是否过期。',
    true,
    true,
  ),
  'language-server-catalog': action(
    '语言服务器目录',
    'next',
    {},
    {},
    '实际探测 TypeScript、Python、Rust、Go、Clang 等语言服务器位置与版本；没有服务器时报告缺失。',
  ),
  'pii-classification': action(
    '敏感数据分类',
    'next',
    {
      paths: z.array(relativePath).min(1).max(100),
    },
    { paths: ['README.md'] },
    '按规则扫描邮件、电话、IP、身份号码及常见密钥，仅返回类型、文件和行号，不返回匹配值。',
  ),
} as const;
export type CapabilityId = keyof typeof capabilityDefinitions;
export const hasCapability = (id: string): id is CapabilityId => Object.hasOwn(capabilityDefinitions, id);
export function capabilityViews(scope: CapabilityActionView['scope']): CapabilityActionView[] {
  return Object.entries(capabilityDefinitions)
    .filter(([, value]) => value.scope === scope)
    .map(([id, value]) => ({
      id,
      name: value.name,
      scope: value.scope,
      example: value.example,
      note: value.note,
      requiresGuest: value.requiresGuest,
      writes: value.writes,
      schema: z.toJSONSchema(value.schema) as Record<string, unknown>,
    }));
}
export function capabilityParameters(id: CapabilityId, input: unknown): Record<string, unknown> {
  return capabilityDefinitions[id].schema.parse(input) as Record<string, unknown>;
}
