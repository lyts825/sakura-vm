# 可重复构建验证插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `reproducible-builds`，含 12 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户以相同源文件和依赖，在独立环境构建多次，检查原字节是否一致，并定位时间、路径、顺序等差异。交付构建回执、差异、环境变量和结论范围。首版提供静态资源归档、固定 C 工程和离线 JavaScript 资源构建模板。

[交付工作台](delivery-workbench.md)继续拥有正式构建与发布，[工坊](foundry-workbench.md)准备镜像，[供应审查](supply-audit-pack-design.md)判断依赖来源。本包检验可重复性，不签发正式发行物，也不凭字节一致认定软件安全。

## 2. 内部插件与直接依赖

短名统一补上 `repro-`；服务均为拟议接口。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `repro-sources` 源文件空间 | 根账本、文件树及原提交声明；ReproSourcesV1：upload、pin、inspect | — | — |
| `repro-recipes` 构建配方 | 固定工具、步骤、输出集合和环境白名单；ReproRecipesV1：define、validate | sources | — |
| `repro-dependencies` 离线依赖 | 依赖材料、锁定清单及完整性；ReproDependenciesV1：upload、resolve、seal | sources, recipes | — |
| `repro-environments` 环境矩阵 | 镜像、工具摘要及可变因素矩阵；ReproEnvironmentsV1：define、expand | sources, recipes | — |
| `repro-builds` 独立构建 | 构建副本、原输出和工具/资源回执；ReproBuildsV1：preview、start、cancel、reconcile | sources, recipes, dependencies, environments, @projects | — |
| `repro-normalizations` 差异解释规则 | 格式感知的派生比较规则；ReproNormalizationsV1：define、validate | sources | — |
| `repro-comparisons` 字节与结构比较 | 原字节差异、归档成员及派生差异；ReproComparisonsV1：compare、explain | sources, builds, normalizations | — |
| `repro-variance` 变因实验 | 单一因素变化和重建计划；ReproVarianceV1：propose、preview、compareObservations | sources, recipes, environments, builds, comparisons | — |
| `repro-statements` 复现声明 | 固定输入、次数、范围及机器可读结论；ReproStatementsV1：assemble、validate、seal | sources, recipes, dependencies, environments, builds, comparisons, variance | — |
| `repro-reports` 人工报告 | 差异说明、限制、审阅与证据目录；ReproReportsV1：assemble、review、seal | sources, builds, comparisons, variance, statements | — |
| `repro-exchange` 复现交接 | 配方、声明、产物与报告封套；ReproExchangeV1：export、inspectImport、acceptImport | * | — |
| `repro-workbench` 复现工作台 | 环境矩阵、构建状态和差异浏览；ReproWorkbenchV1：view、templates | * | — |

variance 只拥有变因定义；实际新构建仍由 builds 预览并执行。statements 是可追溯声明，首版不提供新的签名或可信认证服务。

## 3. 完整使用流程

1. 选择模板，上传源树、依赖和固定工具镜像，核对所需材料。
2. 编写配方并限定输出；列出可能执行的构建脚本及其隔离域。
3. 设置至少两次独立构建，明确缓存、工作路径、时区和时间输入。
4. 预览完整矩阵及峰值资源，批准后按顺序创建独立环境，保留实际工具观测。
5. 比较全部输出的路径、长度和原始摘要；查看归档成员及字节差异。
6. 需要解释差异时选择固定归一化规则；需要验证变因时另建计划并批准重建。
7. 原构建副本全部核销后，封存精确范围的复现声明和人工报告。
8. 导出配方及允许交接的材料；接收端只核验字节，重新构建需新的本地计划。

## 4. 原始一致性与执行规则

`BuildInputSet` 固定源树、依赖、配方和环境摘要。每次构建使用新工作目录和独立可写层；仅共享只读固定依赖。不能将第一次的产物缓存作为第二次输入，除非实验明确研究缓存影响并单独标记。

拟议 `ReproBuildSessionsV1` 运行审核过的固定构建驱动，项目脚本只能在专属 VM 执行。运行不联网下载，不注入签名密钥，不挂载宿主源目录。工具或离线依赖缺失时停止准备。

“原字节一致”要求指定输出集合的路径、类型、长度和字节全部一致。空输出不能自动通过，配方须声明必需产物。派生比较可忽略明确的时间字段或归档顺序，但不得把归一化一致改写为原字节可重复。

`VarianceStudy` 每次固定一个变化因素，记录其他可观察条件。观察关联不直接认定根因；改变多个因素或缺少环境证据时保留无法归因结论。不自动重建直到出现一致结果。

复现声明包含实际成功/失败次数、原始与派生结果、未覆盖平台及清理状态。相同工具链内两次一致只支持该实验范围；不推导跨工具链、跨物理主机或无限未来构建一致。

## 5. 页面、HTTP 与 CLI

页面包括源树、依赖、配方、环境、运行矩阵、归档差异、变因和声明。CLI 别名为 `repro`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 解析依赖 | `/api/repro-dependencies/resolve` | `repro dependencies resolve` |
| 预览/构建 | `/api/repro-builds/preview`、`/api/repro-builds/start` | `repro build preview/start` |
| 比较输出 | `/api/repro-comparisons/compare` | `repro compare` |
| 提出变因 | `/api/repro-variance/propose` | `repro variance propose` |
| 封存声明 | `/api/repro-statements/seal` | `repro statement seal` |
| 交接 | `/api/repro-exchange/export` | `repro export`、`repro verify` |

## 6. 容量、异常与恢复

拟定上限：源树 20,000 个文件及 512 MiB，单矩阵 8 次构建，每次 20 分钟、输出 512 MiB；持久材料 4 GiB，封套 1 GiB。首版串行运行一个 VM，声明磁盘 16 GiB 另预留；宿主配置不足则拒绝，不能以稀疏文件当前大小绕过。

输出越界、后代进程未退出和日志超限分别记录。一次失败保留其记录，不自动补跑；取消停止后续构建并核销当前原域。提取归档只在有界解析器处理普通文件，拒绝路径穿越、链接和递归压缩展开。

## 7. 实施与验收

先完成配方、依赖和矩阵，再实现独立构建工具及差异解析，最后完成声明和交接。

1. 三个模板各完成至少两次真实独立构建、全部输出比较和原资源清理。
2. 植入时间戳差异后，原字节结果失败；归一化相同只显示派生一致。
3. 空输出、遗漏必需文件和失败次数不能被后续成功覆盖。
4. 第二次构建不能读取第一次可写缓存；依赖缺失不能触发联网补齐。
5. 变因重建必须有新计划，不因已有报告批准而自动执行。
6. 控制器退出、磁盘满和原身份变化保留原回执，未知资源不释放。
7. 离线 verify 不执行构建脚本；报告明确同机、平台和工具版本的证据范围。
