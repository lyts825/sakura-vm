# 可观测性规则设计插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `observability-studio`，含 13 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户导入固定指标和日志样本，定义解析、计算、服务目标、仪表盘及告警规则，用历史回放检查命中、漏检和缺失行为，交付待应用的规则配置与报告。首版离线处理 CSV/JSONL 时序和 UTF-8 日志，不开启常驻采集。

既有指标、健康检查及[告警投递](webhooks.md)保留实时权威，[事件复盘](incident-desk.md)记录处置与因果判断。本包设计遥测规则并回放，不发送真实通知、不写入现有告警配置，也不把历史回放当成生产可靠性证明。

## 2. 内部插件与直接依赖

短名统一补上 `obsdesign-`；所有服务为拟议接口。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `obsdesign-sources` 遥测空间 | 根账本、样本原字节、时间范围和许可；ObsdesignSourcesV1：upload、pin、inspect | — | — |
| `obsdesign-signals` 信号目录 | 指标类型、单位、标签及时间语义；ObsdesignSignalsV1：define、validate | sources | — |
| `obsdesign-parsers` 日志解析 | 固定解析规则、字段和敏感字段投影；ObsdesignParsersV1：define、preview、validate | sources, signals | — |
| `obsdesign-recordings` 计算规则 | 有限表达式、派生序列和窗口依赖；ObsdesignRecordingsV1：define、checkGraph | sources, signals, parsers | — |
| `obsdesign-objectives` 服务目标 | 成功事件定义、目标比例和评价窗口；ObsdesignObjectivesV1：define、validate | sources, signals, recordings | — |
| `obsdesign-alerts` 告警规则 | 触发、持续时间、恢复和缺失处理；ObsdesignAlertsV1：define、validate | sources, signals, recordings, objectives | — |
| `obsdesign-routes` 路由模拟 | 标签匹配、分组、抑制和接收方占位；ObsdesignRoutesV1：define、checkConflicts | sources, alerts | — |
| `obsdesign-dashboards` 仪表盘设计 | 面板、查询、单位、阈值和布局版本；ObsdesignDashboardsV1：compose、validate、preview | sources, signals, recordings, objectives | — |
| `obsdesign-scenarios` 回放场景 | 固定时窗、步长、预期事件和缺失片段；ObsdesignScenariosV1：compose、preview、seal | sources, signals, parsers, recordings, objectives, alerts, routes | — |
| `obsdesign-replays` 历史回放 | 有界计算、逐窗口序列及虚拟通知记录；ObsdesignReplaysV1：preview、run、cancel、reconcile | sources, signals, parsers, recordings, objectives, alerts, routes, scenarios | — |
| `obsdesign-reports` 规则审阅 | 规则覆盖、告警对照、意见及配置版本；ObsdesignReportsV1：assemble、review、sealConfig | sources, signals, parsers, recordings, objectives, alerts, routes, dashboards, scenarios, replays | — |
| `obsdesign-exchange` 规则交接 | 样本、规则、回放和待应用配置封套；ObsdesignExchangeV1：export、inspectImport、acceptImport | * | — |
| `obsdesign-workbench` 可观测性设计台 | 信号、解析预览、面板、事件轴和审阅；ObsdesignWorkbenchV1：view、templates | * | — |

routes 只保存虚拟接收方，不存凭据或实际投递地址。reports 拥有审阅决定，原回放结果归 replays；人工接受不能覆盖误报或缺失记录。

## 3. 完整使用流程

1. 选择“请求成功率”“批任务延迟”或“日志异常”模板，导入固定样本。
2. 声明计数器、量值、单位、标签和时间字段，配置日志解析及敏感字段处理。
3. 定义派生计算和服务目标，检查依赖、单位及窗口含义。
4. 编写触发/恢复规则及虚拟路由，组装仪表盘并查看示例面板。
5. 设置回放窗口、步长、预热及预期事件；预览完整样本和规则修订。
6. 运行回放，查看真实输入、派生序列、告警状态和虚拟投递，定位缺失或错误解析。
7. 与预期事件比较，记录审阅及限制，封存待应用的配置版本。
8. 导出规则、必要样本和回放报告，接收端重算；清理无保护引用的计算暂存。

## 4. 时间、告警及判断语义

`SignalDefinition` 明确计数器、量值或事件，固定单位和标签键。速率运算声明计数器重置处理；缺失值使用 missing，不默认为零。单位不兼容或标签连接产生歧义时拒绝求值。

日志解析使用固定 JSON 字段或受限线性模式，限制输入行长及输出字段数；不运行上传解析脚本。未解析行单独计数，不能从后续分母中静默消失。原日志与脱敏投影保留独立摘要及许可关系。

拟议 `TelemetryReplayComputeV1` 使用事件时间、固定排序规则和确定的边界区间。相同时间戳按原记录序号稳定排序。乱序、重复、缺失时区及时间漂移必须先按场景声明处理；无法解释的记录隔离并降低覆盖。

告警状态为 inactive、pending、firing、resolved；无数据另记 unknown，不能直接视作恢复。持续时间、抑制和恢复等待按虚拟事件时钟计算。回放结束时仍触发的告警保持开放，不虚构 resolved。

服务目标保存原成功数、有效总数、排除范围和窗口覆盖。无请求或缺少分母时不判为 100% 成功。首版只提供明确计数比例与预算计算，不输出未验证的可靠性预测。

预期事件是用户标注，回放告警是计算观察。只有明确标注过的时窗才能计算命中、漏检和误报；未标注窗口单独报告。仪表盘预览同样显示缺口，不平滑成看似连续的观测。

## 5. 页面、HTTP 与 CLI

页面包括信号目录、解析前后、规则图、服务目标、虚拟路由、仪表盘和回放时间轴。CLI 别名为 `obsdesign`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 解析预览 | `/api/obsdesign-parsers/preview` | `obsdesign parser preview` |
| 依赖检查 | `/api/obsdesign-recordings/checkGraph` | `obsdesign rules check` |
| 面板预览 | `/api/obsdesign-dashboards/preview` | `obsdesign dashboard preview` |
| 回放计划/执行 | `/api/obsdesign-replays/preview`、`/api/obsdesign-replays/run` | `obsdesign replay preview/run` |
| 封存配置 | `/api/obsdesign-reports/sealConfig` | `obsdesign config seal` |
| 交接 | `/api/obsdesign-exchange/export` | `obsdesign export`、`obsdesign verify` |

## 6. 容量、异常与恢复

拟定上限：单样本 128 MiB、1,000,000 条记录，单行 64 KiB；5000 个序列、每序列 20 个标签、200 条规则、50 个面板、10,000 个回放时点。单计算 5 分钟及 128 MiB 派生输出，包总额 2 GiB，封套 256 MiB。

标签组合达到基数上限时停止，不丢弃高基数序列后宣称完整。规则环、模式超限、时间不明和缺少预热分别给出定位。计算取消或满盘只保留中间观察，不能封存完整回放；重启核对原计算任务，不启动真实采集或投递。

## 7. 实施与验收

先完成信号、解析和有限表达式，再实现确定性回放、面板及审阅，最后完成配置交换。

1. 三个模板均完成样本解析、规则设计、实际回放、审阅和离线重算。
2. 计数器重置、缺失点、无请求和不同单位分别处理，不生成假成功或假恢复。
3. 乱序和相同时间戳具有可复现结果；缺时区记录不能隐式套用宿主时区。
4. 告警 pending、firing、resolved 与 unknown 转换满足固定规则，结束未恢复保持开放。
5. 路由只生成虚拟投递，无真实网络发送；封存配置不改变现有监控服务。
6. 未标注窗口、解析失败和截断保留覆盖说明；规则环和基数超限明确失败。
7. 撤权、中断、满盘及导入篡改不发布完整报告，单包可独立完成全部流程。
