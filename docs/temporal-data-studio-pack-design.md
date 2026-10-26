# 时间数据工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；当前应用保持 2.8.1，基线为 `4afb3b9a`。包 ID 为 `temporal-data-studio`，含 14 个拟议插件，当前分支运行实现待开始。共同规则见[第七批总览](plugin-pack-seventh-design.md)。

用户统一来自多套系统的时间记录，明确时区、精度、事件顺序与窗口规则，交付可追溯的对齐数据、区间分析和版本比较。本包支持离线时间资料处理，不修改设备时钟。

[数据工作台](data-lab.md)保留通用 SQL 与 Notebook，[事件实验](event-lab-pack-design.md)保留真实队列协议。新包专门拥有本地时间语义、双时间记录、区间关系及迟到重算。时间计划和后台调度属于各自原提供者。

## 2. 内部插件与直接依赖

服务均为拟议接口；时间规则与运行结果分开保存。

| 插件 ID 与名称 | 独立对象、核心功能和服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `temporaldesk-spaces` 时间空间 | 空间、授权和额度；TemporaldeskSpacesV1：create、configure、close | — | — |
| `temporaldesk-sources` 时间材料 | 原记录、解析档案和来源许可；TemporaldeskSourcesV1：upload、inspect、pin | `temporaldesk-spaces` | — |
| `temporaldesk-calendars` 日历版本 | 时区资料、工作日历及业务日边界；TemporaldeskCalendarsV1：define、inspect、seal | `temporaldesk-spaces` | — |
| `temporaldesk-semantics` 时间语义 | 事件时间、记录时间、精度和不确定区间；TemporaldeskSemanticsV1：define、validate、seal | `temporaldesk-spaces`, `temporaldesk-sources`, `temporaldesk-calendars` | — |
| `temporaldesk-alignment` 时间对齐 | 时区消歧、单位转换及显式偏移规则；TemporaldeskAlignmentV1：define、preview、seal | `temporaldesk-spaces`, `temporaldesk-sources`, `temporaldesk-calendars`, `temporaldesk-semantics` | — |
| `temporaldesk-intervals` 区间规则 | 开闭端点、重叠、间隙与有效期；TemporaldeskIntervalsV1：define、validate、seal | `temporaldesk-spaces`, `temporaldesk-semantics`, `temporaldesk-alignment` | — |
| `temporaldesk-windows` 窗口定义 | 滚动、滑动、会话及重采样窗口；TemporaldeskWindowsV1：define、validate、seal | `temporaldesk-spaces`, `temporaldesk-calendars`, `temporaldesk-semantics`, `temporaldesk-alignment` | — |
| `temporaldesk-latepolicy` 迟到策略 | 固定水位序列、迟到阈值和更正办法；TemporaldeskLatepolicyV1：define、validate、seal | `temporaldesk-spaces`, `temporaldesk-semantics`, `temporaldesk-windows` | — |
| `temporaldesk-runs` 时间处理 | 对齐、窗口、区间计算和派生数据；TemporaldeskRunsV1：preview、run、cancel、reconcile | `temporaldesk-spaces`, `temporaldesk-sources`, `temporaldesk-calendars`, `temporaldesk-semantics`, `temporaldesk-alignment`, `temporaldesk-intervals`, `temporaldesk-windows`, `temporaldesk-latepolicy` | — |
| `temporaldesk-comparisons` 时间比较 | 规则版本差异、窗口修正和缺口；TemporaldeskComparisonsV1：compare、explain | `temporaldesk-spaces`, `temporaldesk-runs`, `temporaldesk-windows`, `temporaldesk-latepolicy` | — |
| `temporaldesk-reviews` 语义复核 | 歧义时刻、估计偏移和适用范围决定；TemporaldeskReviewsV1：prepare、decide、seal | `temporaldesk-spaces`, `temporaldesk-semantics`, `temporaldesk-alignment`, `temporaldesk-runs`, `temporaldesk-comparisons` | — |
| `temporaldesk-reports` 时间档案 | 处理版本、原值追溯和覆盖说明；TemporaldeskReportsV1：assemble、seal | `temporaldesk-spaces`, `temporaldesk-runs`, `temporaldesk-comparisons`, `temporaldesk-reviews` | — |
| `temporaldesk-exchange` 时间交接 | 原记录、日历档案及派生版本交换；TemporaldeskExchangeV1：export、inspectImport、acceptImport | `temporaldesk-spaces`, `temporaldesk-sources`, `temporaldesk-calendars`, `temporaldesk-semantics`, `temporaldesk-alignment`, `temporaldesk-intervals`, `temporaldesk-windows`, `temporaldesk-latepolicy`, `temporaldesk-runs`, `temporaldesk-comparisons`, `temporaldesk-reviews`, `temporaldesk-reports` | — |
| `temporaldesk-workbench` 时间工作台 | 时间轴、歧义队列、窗口预览和保存视图；TemporaldeskWorkbenchV1：view、saveView、templates | `temporaldesk-spaces`, `temporaldesk-sources`, `temporaldesk-calendars`, `temporaldesk-semantics`, `temporaldesk-alignment`, `temporaldesk-intervals`, `temporaldesk-windows`, `temporaldesk-latepolicy`, `temporaldesk-runs`, `temporaldesk-comparisons`, `temporaldesk-reviews`, `temporaldesk-reports`, `temporaldesk-exchange` | — |

## 3. 模板与完整流程

| 模板 | 输入和重点 | 完成交付 |
| --- | --- | --- |
| 多时区业务记录 | 本地时刻、时区和业务日期 | 消歧后的绝对时刻及原值映射 |
| 设备观测对齐 | 不同精度、已知偏移和缺测 | 对齐数据与不确定时间范围 |
| 有效期台账 | 起止时刻、记录时刻和更正记录 | 重叠、间隙及指定时点视图 |

1. 导入 CSV 或 JSONL，选择明确的解析格式、单位和时区来源。
2. 冻结时区资料及业务日历版本，区分事件时间与资料记录时间。
3. 配置歧义时刻策略和已知时钟偏移，查看不能确定的记录。
4. 定义窗口、区间端点和迟到规则，预览边界样例及计算规模。
5. 运行固定转换，保留每个输出值的原记录和转换步骤。
6. 比较规则版本或追加更正后的结果，检查改变的窗口及记录。
7. 复核歧义与估计条件，封存数据版本和报告。
8. 导出原资料与必要日历；隔离接收后核对可重算范围和清理引用。

## 4. 时间精度与计算语义

绝对时刻采用有符号十进制整数及显式精度，不经 JavaScript 浮点毫秒偷偷截断。首版支持秒、毫秒、微秒和纳秒的有界整数表示；超出工具范围时返回不支持，不自动舍入。

无时区的本地时刻不能直接当作 UTC。时区规则版本和摘要进入计划；重复出现的本地时刻要求选择具体偏移，缺失的本地时刻要求拒绝或显式调整。调整保存原值与理由。

固定时长窗口和日历窗口分开定义。所有窗口注明起点、端点开闭、空窗口和缺测行为。插值是派生估计，保留算法及适用范围，不能显示为实测值。

迟到处理按输入中固定的到达顺序和水位序列重放，不读取宿主当前时间改变历史结果。允许重算时产生更正版，旧窗口保留；丢弃时列出全部被排除范围与计数。

时间先后不自动构成因果关系。存在精度或时钟误差时允许顺序未知；禁止为画出整齐时间线而任意排序。双时间查询分别约束业务有效时点与记录获知时点。

拟议 `TemporalSeriesComputeV1` 提供固定时间解析、有限窗口和区间运算。实施须验证时区资料固定、整数精度、边界消歧、外部排序、取消及暂存核销；它不允许修改宿主时钟或执行用户脚本。

## 5. 页面、HTTP 与 CLI

页面显示原值、绝对时刻、业务日和不确定区间。歧义队列逐项给出原因；时间轴支持键盘和表格替代。窄屏保留范围总量，不能只按可见区间批准全部数据。

下表均为拟议 POST，CLI 前缀为 `sakura temporal-desk`。

| 服务方法 | HTTP 路径 | CLI 子命令 |
| --- | --- | --- |
| Semantics.validate | `/api/temporaldesk-semantics/validate` | `semantics validate` |
| Alignment.preview | `/api/temporaldesk-alignment/preview` | `alignment preview` |
| Windows.seal | `/api/temporaldesk-windows/seal` | `window seal` |
| Runs.preview/run | `/api/temporaldesk-runs/preview`、`/api/temporaldesk-runs/run` | `run preview`、`run start` |
| Comparisons.compare | `/api/temporaldesk-comparisons/compare` | `comparison create` |
| Exchange.export/acceptImport | `/api/temporaldesk-exchange/export`、`/api/temporaldesk-exchange/acceptImport` | `export`、`import accept` |

另提供任务状态、等待、取消、原回执恢复和离线 `verify`。核验器不读取当前日历网站或启动外部时间同步。

## 6. 容量、权限与恢复

拟定每输入 128 MiB、100 万条记录，每条 128 KiB；一次最多 32 条时间序列、100 个窗口定义和 100 万个输出区间，计算 5 分钟。输出放大超限应拒绝计划或终止任务，不截断后宣称完整。

包总额 2 GiB，包含 32 MiB 恢复账本、原始及更正版、排序暂存和隔离接收；封套 256 MiB。宿主既有 8 GiB 共同额度必须先接入，本包额度不表示额外获得 2 GiB。

空间 owner 控制所有操作；敏感日期和地点不因图表预览而公开。导出预览列明日历和原资料，用户可以只导出派生结果，但须记录缺失原输入及不可重算范围。

取消或重启后保留原规则版本和水位位置，先查询原任务。不得从新到达顺序自动恢复旧计划；需要续作时显式建立新的固定输入和计划。未知暂存仍计费。

接收生成新 ID，外来复核不替代本地决定。升级日历或解析器产生新版本，旧结果保留旧资料摘要；模式迁移失败保留原字节，降级不理解精度时拒绝写入。归档不解除历史更正版的引用。

## 7. 实施与验收

P0 完成精确表示、资料版本和固定计算；P1 完成窗口、迟到与双时间比较；集成维护完成页面、交换和独立安装。

1. 三模板各完成导入、处理、复核、封存和交接，单包无其他新包依赖。
2. 使用固定资料的重复和缺失本地时刻用例，未消歧时拒绝绝对时刻输出。
3. 纳秒相差 1 的记录不合并；不支持的工具精度明确拒绝。
4. 相邻开闭区间在同一边界上的归属正确，日历窗口与固定时长窗口分开验证。
5. 迟到记录分别执行拒绝、旁存和更正策略，旧结果与更正版均可追溯。
6. 误差区间相交时允许顺序未知，图表不伪造因果或确定顺序。
7. 旧修订、撤权、输出爆炸、取消及磁盘满不发布部分完整版本。
8. 缺失日历的交接明确不可重算；离线核验不查询当前时间来改变结论。
