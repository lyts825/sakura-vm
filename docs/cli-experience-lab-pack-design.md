# 命令行体验验证插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `cli-experience-lab`，包含 13 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户验证命令行程序的参数、帮助、退出码、标准流、交互提示和取消行为，交付可复查的兼容矩阵及实录。首版面向专属 Linux 客户机的固定可执行制品，支持管道输入和伪终端；Windows 原生命令等平台另行验证。

[项目终端](project-terminals.md)负责日常交互，[接口验证](integration-lab.md)负责 HTTP。本包拥有命令行契约、终端步骤和输出判断，不把已有通用终端直接作为无人监管的测试执行器。

## 2. 内部插件与直接依赖

短名统一补上 `clilab-`；表中的服务均待实现。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `clilab-artifacts` 制品与空间 | 根账本、可执行文件、静态输入；ClilabArtifactsV1：upload、pin、inspect | — | @delivery-artifacts |
| `clilab-contracts` 命令契约 | 子命令、参数、帮助和退出码约定；ClilabContractsV1：define、validate | artifacts | — |
| `clilab-fixtures` 文件与流夹具 | 运行目录树、stdin 和预期文件集合；ClilabFixturesV1：compose、checkPaths | artifacts | — |
| `clilab-environments` 终端环境 | 镜像、终端尺寸、编码、时区和环境白名单；ClilabEnvironmentsV1：define、validate | artifacts | — |
| `clilab-dialogues` 交互步骤 | 等待提示、输入、缩放、EOF 和中断步骤；ClilabDialoguesV1：compose、validate | artifacts, contracts | — |
| `clilab-assertions` 结果断言 | 退出、字节、结构化输出和文件变化要求；ClilabAssertionsV1：define、validate | artifacts, contracts, fixtures, dialogues | — |
| `clilab-matrices` 验证矩阵 | 制品、参数、环境和步骤的固定组合；ClilabMatricesV1：expand、preview、seal | artifacts, contracts, fixtures, environments, dialogues, assertions | — |
| `clilab-runs` 执行管理 | 工具会话、目标进程及逐通道原始输出；ClilabRunsV1：preview、start、cancel、reconcile | artifacts, contracts, fixtures, environments, dialogues, matrices, @projects | — |
| `clilab-transcripts` 终端实录 | 分通道字节、屏幕帧和安全显示投影；ClilabTranscriptsV1：decode、readFrames、coverage | artifacts, runs | — |
| `clilab-results` 兼容判断 | 断言结果、候选差异和人工说明；ClilabResultsV1：evaluate、compare、annotate | artifacts, assertions, matrices, runs, transcripts | — |
| `clilab-reports` 验证报告 | 版本矩阵、失败定位及原资源回执；ClilabReportsV1：assemble、seal | artifacts, contracts, matrices, runs, transcripts, results | — |
| `clilab-exchange` 验证交接 | 固定用例、结果和材料封套；ClilabExchangeV1：export、inspectImport、acceptImport | * | — |
| `clilab-workbench` 命令行工作台 | 契约表、步骤编辑、实录和差异导航；ClilabWorkbenchV1：view、templates | * | — |

可选交付制品只读取用户选择的固定版本及许可；缺少适配器时上传制品。environments 保存期望配置，实际能力和环境由 runs 的工具握手记录，不能用用户标签冒充探测。

## 3. 完整使用流程

1. 选择“帮助与错误参数”“管道过滤器”或“交互向导”模板，上传目标和候选制品。
2. 定义参数、输出格式、退出码及允许的目录变化，准备输入文件和 stdin。
3. 编写交互步骤，设置每步匹配条件、超时、输入、EOF 和中断期望。
4. 选择终端尺寸、编码及区域设置，展开全部组合；排除项须记录理由。
5. 预览并批准固定矩阵，在专属环境执行；显示每个用例状态、流输出和实际能力。
6. 逐断言检查字节、JSON、退出码与文件差异，比较两版本；解释未覆盖和不确定项。
7. 确认进程树、终端、临时目录及 VM 核销，封存报告和实录。
8. 导出用例及结果，离线核验和隔离接收；删除无保护引用的暂存。

## 4. 终端语义与执行边界

`CommandSpec` 使用可执行制品摘要、参数数组和白名单环境变量，不拼接 shell 字符串。目标程序及安装钩子仅能在计划明示的隔离域执行，首版不支持运行时联网安装。输入路径限定为本次夹具树。

管道模式分别保存 stdout 和 stderr 的原字节及各自顺序。跨流只记录观察时间，不宣称操作系统未提供的全局精确顺序。伪终端模式通常合并输出，不能据此验证 stderr 独立性；用例必须明确选择模式。

`DialogueRevision` 固定有限步骤，禁止无限循环。匹配采用有界字面量、受限模式或固定 JSON 路径；禁止任意表达式执行。提示歧义、多匹配、超时或终端能力缺失时停止该用例，不猜测输入目标。

终端显示使用受限转义序列解释器，禁用剪贴板、链接执行及宿主控制序列。原字节单独保留；去色、换行及时间字段忽略规则在执行前固定，同时呈现原始与归一化比较。程序因信号终止与正常退出码分别记录。

拟议 `CliHarnessSessionsV1` 管理原进程树、伪终端及独立截止。取消先停止新用例，按计划发送中断，再确认退出或强制终止原执行域。强制终止不算程序自行正确响应中断。

## 5. 页面、HTTP 与 CLI

页面提供命令树、夹具目录、交互步骤、终端预览、矩阵、原字节和差异。实录支持时间定位、失败步骤跳转和显示/原字节切换。CLI 别名为 `clilab`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 展开矩阵 | `/api/clilab-matrices/expand` | `clilab matrix expand` |
| 预览/运行 | `/api/clilab-runs/preview`、`/api/clilab-runs/start` | `clilab run preview/start` |
| 读取帧 | `/api/clilab-transcripts/readFrames` | `clilab transcript frames` |
| 判断/比较 | `/api/clilab-results/evaluate`、`/api/clilab-results/compare` | `clilab result evaluate/compare` |
| 核销 | `/api/clilab-runs/reconcile` | `clilab run reconcile` |
| 交接 | `/api/clilab-exchange/export` | `clilab export`、`clilab verify` |

## 6. 容量、异常与恢复

拟定上限：每矩阵 500 个用例，每例 100 步、120 秒和 8 MiB 输出，每轮 30 分钟及 256 MiB 输出；先达到任何上限即停止相应范围。单制品 256 MiB，持久材料 3 GiB，封套 512 MiB；同包一个活动 VM，声明磁盘 8 GiB 另行预留。

输出超限保存截断位置，后续断言为未覆盖。文件写越界、原进程身份改变和终端失联停止用例并核对原资源。重启不重放密码输入、确认或文件写入；缺失步骤保留 interrupted。存储满时优先保留原回执，拒绝新运行。

## 7. 实施与验收

先完成契约、夹具和矩阵，再实现工具及实录，最后完成判断、报告和安装态交接。

1. 三种模板真实运行，覆盖正常参数、错误参数、stdin、EOF 和取消。
2. 分通道输出与伪终端合并语义正确；中文宽字符、窗口缩放及分段编码不丢原字节。
3. 输出含危险终端控制序列时，页面不改剪贴板、不执行链接，原字节仍可核验。
4. 交互歧义和超时停在准确步骤；中断退出与监管强杀分别呈现。
5. 归一化规则改变产生新判断修订，原始输出差异始终可见。
6. 取消、控制器退出和后代进程残留均按原身份核销；unknown 不释放资源。
7. 可选制品来源缺席、单包启用及离线导入均可完成规定流程。
