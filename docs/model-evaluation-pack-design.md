# 模型评测插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；基线 2.7.0 / `912287a`。`model-evaluation` 含 10 个拟议插件，运行实现待开始，遵守[第三批总览](plugin-pack-suite-design.md)。

用户固定样例、提示词、端点声明和评分规则，比较逐样例输出、延迟、失败及人工评分。现有[本地助手](local-assistant.md)继续提供交互问答；本包只执行有界评测，不提供 Agent、工具调用、网页搜索或自动修改项目。

首次可导入固定输出完成评分流程，界面必须标为“导入结果评估”。真实模型评测另行选择端点并确认发送材料；固定输出不能冒充真实推理。模型生成内容始终按不可信文本处理。

首版接入与现有本地助手一致的本机文本协议档案，继续执行本地模型元数据预检。流式响应、远程转发声明、工具调用和任意兼容协议均不支持。远程模型连接须另行设计适配与验收，不能放宽旧助手的地址规则来获得支持。

## 2. 内部插件与依赖

短依赖前缀为 `evaluation-`，CLI 别名为 `evaluation`。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `evaluation-datasets` | 固定样例、标签、参考答案和发送许可；EvaluationDatasetsV1：upload、split、pin | — | @data-datasets |
| `evaluation-prompts` | 提示词模板、变量及生成参数；EvaluationPromptsV1：compile、renderPreview | datasets | — |
| `evaluation-endpoints` | 固定端点、模型声明、秘密版本和能力检查；EvaluationEndpointsV1：previewConnection、check、revoke | @secrets | — |
| `evaluation-runners` | 逐样例调用许可、响应与取消；EvaluationRunnersV1：preview、start、cancel、reconcile | datasets, prompts, endpoints | — |
| `evaluation-scorers` | 精确匹配、结构规则、人工量表和评判计划；EvaluationScorersV1：evaluate、planJudge、applyJudge | datasets, runners, endpoints | — |
| `evaluation-comparisons` | 配对样例、覆盖差异和可比性；EvaluationComparisonsV1：compare、explain | runners, scorers | — |
| `evaluation-reviews` | 盲审记录、争议和最终意见；EvaluationReviewsV1：open、score、decide | comparisons | — |
| `evaluation-reports` | 固定评测摘要、限制和证据；EvaluationReportsV1：seal、compare | runners, scorers, comparisons, reviews | — |
| `evaluation-exchange` | 数据许可、运行和审阅交换；EvaluationExchangeV1：export、inspectImport、acceptImport | datasets, prompts, endpoints, runners, scorers, comparisons, reviews, reports | — |
| `evaluation-workbench` | 样例、发送预览、评分、对比与交接；EvaluationWorkbenchV1：view、templates | * | — |

scorers 的模型判分通过 EvaluationCallsV1 单独执行，不调用 runners 的业务运行写入口，也不能覆盖原回答。数据和端点都撤销许可时，后续判分同样停止。

## 3. 完整用户流程

1. 选择“结构化提取”“固定分类”或“文档回答人工评分”，导入已审阅材料并定义发送范围。
2. 固定提示词、变量、样例集合和评分规则，检查缺失标签与重复样例。
3. 登记端点和秘密引用，主动检查协议；确认目标与将发送的完整材料及最大调用数。
4. 批准原计划，执行逐样例调用。运行视图显示未发送、已发送、响应完成和未知结果。
5. 使用规则或人工量表评分。可选模型判分须单独预览发送内容、端点及预算。
6. 对共同样例作配对比较，完成人工审阅，导出有明确覆盖和限制的报告。

## 4. 许可、评估与数据状态

每次发送固定原端点、地址范围、协议、模型声明、秘密修订和正文摘要。EvaluationCallsV1 在持久化意图后才发送；挑战到期或授权变化时拒绝后续调用。禁止重定向、代理注入、模型返回 URL 自动抓取和宿主控制面地址。

本地端点须显式登记回环地址、端口和协议档案，拒绝宿主控制面及非模型内部接口。需要认证时只引用另存的固定秘密版本，不允许任意认证头。密钥仅在发送时提供，不进入提示词、报告或导出。模型协议未报告版本时标为未知，不能推测后台模型未变。

样例修订和评分修订分别保存。评估集与调参集明确区分，重用样例有可见记录；不能用训练/评估重叠的数据宣称泛化能力。比较必须列出共同样例、缺失样例、生成设置、重复次数及评判方式。

评分区分规则结论、人工标签和模型意见。人工评分不能伪装为独立多人的审阅；模型判分不能证明事实正确。样例内容中的指令只属于待评估材料，不能改变评分器权限或调用工具。

断线后保留已发送请求为结果未知，禁止自动重发。取消不保证端点立即停止推理或删除已收到的材料。用量缺失时保持未知；硬预算按请求数、字节和时间落实，不能用端点自报用量判断原操作是否完成。

## 5. 入口、预算与验收

页面包含样例、提示词、端点、运行、评分、对比、审阅和交接。

| 操作 | 拟议 HTTP | CLI | 结果 |
| --- | --- | --- | --- |
| 发送预览 | `/api/evaluation-runners/preview` | `evaluation run preview` | 完整发送范围、调用次数、秘密修订 |
| 开始/取消 | `/api/evaluation-runners/start`、`cancel` | `evaluation run start/cancel` | 原请求账本与取消状态 |
| 模型判分 | `/api/evaluation-scorers/planJudge`、`applyJudge` | `evaluation scorer plan-judge/apply-judge` | 独立发送计划和判分证据 |
| 比较/交接 | `/api/evaluation-comparisons/compare`、`/api/evaluation-exchange/export` | `evaluation compare`、`evaluation export` | 配对覆盖、差异及来源属性 |

拟定每集合 1,000 个样例，单输入和输出各 64 KiB；每次计划最多 2,000 次生成调用、1,000 次判分调用，总调用上限 3,000 次。并发最多 2，单次调用 60 秒，整个运行 30 分钟。总存储 4 GiB，单导出 256 MiB。输入、输出、错误正文和多次采样都计入配额。

先实现固定样例/规则/人工评估，再实现调用许可和受管端点，最后接通模型判分、对比与交换。接口夹具只证明协议；完整验收还须实际调用经用户选定的模型端点，并保留其真实响应，不以预设文本代替。

必须覆盖敏感字段预览、端点/秘密轮换拒绝旧计划、提示注入不触发工具、缺失用量、超长输出、取消与断线未知、控制器重启不重发、样例错配、盲审身份标注和离线篡改。外来评测结果不能直接作为本地模型调用证明。
