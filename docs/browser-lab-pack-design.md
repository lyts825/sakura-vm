# 浏览器验收插件包设计

实施更新（2026-10-25）：10 个插件已在 2.8.0 落地。下文保留设计草案，实际方法、预算及执行边界以[使用指南](browser-lab.md)为准；验收结论见[版本说明](release-2.8.0.md)。

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；基线为应用 2.7.0 / `912287a`。包 ID 为 `browser-lab`，含 10 个拟议插件，原设计时运行实现尚未开始。本文与[第三批总览](plugin-pack-suite-design.md)共同作为实施与验收依据。

用户将固定站点、操作步骤和预期结果组合为验收场景，取得逐步结果、截图差异、可访问性发现和人工审阅。与[接口验证](integration-lab.md)相比，本包验证浏览器内的实际交互；与[交付预览](delivery-workbench.md)相比，本包保存可重复的场景与基线。

首版只执行专用 VM 内的固定站点。上传内容可以包含网页脚本，但只能在隔离浏览器中执行。现有用户浏览器、真实登录会话、外部网站、浏览器扩展和任意脚本测试代码不在首版范围内。

## 2. 内部插件与依赖

短依赖使用 `browser-` 前缀；`@`、`*` 及共同读写方法见总览。表内服务和方法均为拟议接口。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `browser-targets` | 站点字节、固定镜像与运行档案；BrowserTargetsV1：upload、pin、resolve | — | @delivery-artifacts |
| `browser-fixtures` | 合成表单数据、浏览器状态模板；BrowserFixturesV1：generate、validate | targets | — |
| `browser-journeys` | 声明式操作和分支；BrowserJourneysV1：compile、previewSteps | targets, fixtures | — |
| `browser-runners` | 专用 VM、浏览器进程和逐步原始证据；BrowserRunnersV1：preview、start、cancel、reconcile | targets, fixtures, journeys, @projects | — |
| `browser-assertions` | 固定文本、元素、URL 与状态断言；BrowserAssertionsV1：evaluate、explain | runners, journeys | — |
| `browser-visual` | 基线、遮罩、截图差异和审阅；BrowserVisualV1：proposeBaseline、compare、acceptBaseline | runners, targets | — |
| `browser-accessibility` | 有界规则集、发现与人工检查单；BrowserAccessibilityV1：evaluate、review | runners | — |
| `browser-reports` | 证据覆盖、结论与可比性；BrowserReportsV1：seal、compare | runners, assertions, visual, accessibility, journeys | — |
| `browser-exchange` | 场景、基线和报告封套；BrowserExchangeV1：export、inspectImport、acceptImport | targets, fixtures, journeys, runners, assertions, visual, accessibility, reports | — |
| `browser-workbench` | 首次运行、失败定位、基线审阅和交接；BrowserWorkbenchV1：view、templates | * | — |

断言和报告消费运行器的封存证据，运行器不依赖报告，避免循环。导出可访问性或断言明细时，由 reports 提供已经固定的报告附件；原始大字节仍由 targets 或 runners 的受控读租约返回。

## 3. 完整用户流程

1. 新建空间，选择“表单提交”“多尺寸导航”或“截图变化”模板，预览合成数据。
2. 上传固定站点包，选择已准备的浏览器镜像；显式检查工具、字体、视口与时区。
3. 编辑点击、输入、选择、等待条件和截图步骤，封存场景。检查器拒绝未知动作和任意 JavaScript。
4. 预览站点、初始状态、允许来源、步骤与预算，确认后启动专用 VM。
5. 查看逐步断言和差异。首次截图只能成为候选基线；用户审阅后，才建立新基线修订。
6. 完成人工检查，封存报告；导出指定材料，确认原浏览器、站点服务和 VM 清理。

## 4. 执行、证据和数据模型

固定输入包括站点摘要、镜像摘要、浏览器与字体版本、场景、数据、视口、时区和随机种子。可比性不一致时只展示差异，不给出退化比例。即使固定上述条件，动画和时间依赖仍可能不稳定，须在结果中列出。

站点内容通过固定只读文件服务提供。浏览器网络仅允许本次站点来源；下载、外部跳转、DNS、WebSocket 外连和宿主控制地址全部阻断。每个上下文独立 Cookie 与存储目录，运行后按原回执清理。页面产生的新窗口归属同一运行。

`StepObservation` 记录实际执行序号、单调时钟、DOM 摘要和截图引用。HTTP 不接受客户端提交“已点击”或“已通过”的证据。遮罩、容差和可访问性规则必须先封存；运行后改规则产生新评估，保留旧结论。

新基线采用 `proposed → reviewed → active → retired`。接受基线需要当前基线修订，避免并发覆盖；接受不能把原失败报告改为通过。可访问性报告只陈述规则覆盖与人工检查结果，不宣称满足所有规范。

报告只对计划选定的检查求总体结论，未选规则显示为未覆盖。首次没有视觉基线时，相应视觉检查为不确定；不能在看到截图后临时取消这项检查来取得通过。

## 5. 页面、HTTP 与 CLI

工作台包含目标、场景、运行、视觉基线、可访问性、报告和交接。页面默认不选目标；失败步骤能定位原截图和条件。CLI 别名为 `browser`。

| 操作 | 拟议 HTTP | CLI | 返回要点 |
| --- | --- | --- | --- |
| 编译场景 | `/api/browser-journeys/compile` | `browser journey compile` | 固定修订、拒绝的动作和依赖 |
| 运行预览/提交 | `/api/browser-runners/preview`、`start` | `browser run preview/start` | 计划摘要、资源、原运行回执 |
| 基线审阅 | `/api/browser-visual/acceptBaseline` | `browser baseline accept` | 新修订、原报告仍保持 |
| 核销/交接 | `/api/browser-runners/reconcile`、`/api/browser-exchange/export` | `browser run reconcile`、`browser export` | 原资源清理及准确材料清单 |

## 6. 预算、失败与验收

拟定上限：每空间 100 个场景，每场景 200 步；运行 15 分钟，单步 30 秒。全包最多 2 个专用 VM，每台 2 vCPU、4 GiB 内存、8 GiB 虚拟磁盘。站点包 256 MiB，单图 20 MiB，单次 200 张图；总存储 32 GiB，导出 1 GiB。图像比较有独立像素和内存预算，不能只按压缩文件大小准入。

| 异常 | 必须呈现和保留的结果 |
| --- | --- |
| 浏览器崩溃或证据截断 | 未完成步骤为 inconclusive，保留已确认步骤 |
| 遮罩漂移或环境改变 | 拒绝旧基线直接比较，不自动重新取基线 |
| 取消、重启或工具失联 | 撤销新动作，原运行待核销，不从中间步骤重放 |
| 脱敏与导入 | 脱敏派生新图；外来通过记录只能作参考，基线须本地重新审阅 |

实施依次完成目标与场景、BrowserSessionsV1 实机门禁、证据和三类判定、完整工作台与交换。该会话接口是新增本体前置，不由当前 PreparedWorkerSessionsV1 承担。

验收必须覆盖三个模板的真实浏览器运行、失败截图和元素定位、恶意外连拒绝、基线并发接受、取消后无残留子进程、控制器退出后的原 VM 核销，以及安装态离线报告复核。单纯加载静态站点或比较两张上传图不能替代执行验收。
