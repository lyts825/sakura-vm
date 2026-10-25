# 桌面流程自动化插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `desktop-automation-lab`，含 13 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户在专属 Linux 图形客户机录制并编辑桌面流程，按参数批量回放，检查界面和输出文件，交付可复查的流程及实录。首版面向本地演示和重复操作，提供文本编辑、表单录入和文件整理模板。

[Linux 桌面](linux-desktop.md)和[桌面录制](desktop-recording.md)保留原连接与捕获权威。本包新增动作语义、定位、参数和断言；不会使用用户宿主桌面、已有个人会话、外部账号或真实业务系统作为默认目标。

## 2. 内部插件与直接依赖

短名统一补上 `deskflow-`；所有服务均为拟议接口。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `deskflow-spaces` 流程空间 | 根账本、应用制品和示例材料；DeskflowSpacesV1：create、upload、pin | — | — |
| `deskflow-environments` 桌面环境 | 镜像、应用、分辨率、输入法和显示协议；DeskflowEnvironmentsV1：define、validate | spaces | — |
| `deskflow-recordings` 动作录制 | 专属录制会话、输入事件及原画面；DeskflowRecordingsV1：preview、start、stop、reconcile | spaces, environments, @projects | — |
| `deskflow-locators` 元素定位 | 窗口/控件定位、模板区域和版本适用性；DeskflowLocatorsV1：define、inspectMatches | spaces, recordings | — |
| `deskflow-flows` 步骤编辑 | 有限动作图、等待、分支及错误出口；DeskflowFlowsV1：compose、validate、seal | spaces, environments, recordings, locators | — |
| `deskflow-parameters` 输入集合 | 非秘密参数、文件夹具和批次映射；DeskflowParametersV1：define、expand | spaces, flows | — |
| `deskflow-assertions` 行为断言 | 窗口、文本、文件和人工确认条件；DeskflowAssertionsV1：define、validate | spaces, flows, locators | — |
| `deskflow-runs` 回放管理 | 原专属会话、动作回执和批次状态；DeskflowRunsV1：preview、start、pause、cancel、reconcile | spaces, environments, locators, flows, parameters, assertions, @projects | — |
| `deskflow-observations` 回放证据 | 截图、控件观察、定位理由和文件摘要；DeskflowObservationsV1：extract、readStep、coverage | spaces, runs | — |
| `deskflow-results` 流程判断 | 逐步骤断言、偏差和人工接管记录；DeskflowResultsV1：evaluate、compare、annotate | spaces, assertions, runs, observations | — |
| `deskflow-reports` 流程报告 | 固定流程、批次结果和原资源核销；DeskflowReportsV1：assemble、seal | spaces, recordings, flows, parameters, runs, observations, results | — |
| `deskflow-exchange` 流程交接 | 已审阅录制、流程与结果封套；DeskflowExchangeV1：export、inspectImport、acceptImport | * | — |
| `deskflow-workbench` 桌面流程台 | 步骤时间线、定位器、回放和人工恢复；DeskflowWorkbenchV1：view、templates | * | — |

recordings 和 runs 各自拥有其会话及清理责任，不能把录制中的活动句柄交给回放复用。observations 提取运行批准范围内的证据，不能额外捕获别的窗口。

## 3. 完整使用流程

1. 选择模板和预备镜像，创建专属录制环境，确认应用及输入材料。
2. 显式开始录制，完成本地操作；停止后查看全部事件和画面，核销录制会话。
3. 将录制转为流程草稿，替换脆弱坐标、补等待条件和失败出口。
4. 定义输入批次、期望窗口及输出文件，检查有限步骤和定位器适用环境。
5. 预览全部动作、数据、文件写入及捕获范围，批准后在新专属环境回放。
6. 定位失配或出现未知弹窗时暂停；查看原状态并决定取消或创建新的继续计划。
7. 检查结果，区分自动完成、人工接管及强制终止；核销桌面、应用后代和 VM 后封存报告。
8. 审阅并导出必要画面及流程，接收端建立新草稿；清理无保护引用的录制暂存。

## 4. 定位、恢复与权限

拟议 `DesktopWorkflowSessionsV1` 绑定 VM 创建身份、boot、桌面会话和应用窗口。动作仅发送到该客户机的受管通道，禁止借宿主全局输入接口操作其他应用。显示协议和控件树能力须逐工具实测。

定位器优先使用唯一控件身份和窗口范围；图像模板固定像素尺度、区域及阈值。坐标动作必须声明分辨率和窗口几何。无匹配、多匹配或窗口身份变化时停止，不自动降低阈值或改用其他定位方式。

流程允许有限条件分支和有最大次数的循环，每步设截止。禁止导入脚本和任意 shell 动作；需要运行应用时只使用计划中的固定制品。录制不会自动成为可执行流程，录制包含的确认动作必须进入完整审阅。

暂停停止发送新输入。恢复需重新观察原会话并核对固定步骤及状态；preview 为继续操作生成新计划，绑定原会话、当前观察摘要及下一步骤，再由 start 消费。控制器断开后不重放未知点击、保存或确认操作。人工接管后的步骤标记 assisted，不再计为纯自动成功。

首版不支持秘密参数和外部登录。敏感输入区域的录制须先暂停；导出前人工审阅截图范围。自动遮盖仅为辅助，不能宣称消除所有隐私内容。原字节及派生画面保留独立摘要。

## 5. 页面、HTTP 与 CLI

页面包括环境、录制、定位器、流程、参数、断言、回放控制和结果。键盘能编辑全部步骤；暂停和取消始终可达。CLI 别名为 `deskflow`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 录制计划/开始 | `/api/deskflow-recordings/preview`、`/api/deskflow-recordings/start` | `deskflow record preview/start` |
| 检查流程 | `/api/deskflow-flows/validate` | `deskflow flow validate` |
| 回放计划/开始 | `/api/deskflow-runs/preview`、`/api/deskflow-runs/start` | `deskflow run preview/start` |
| 暂停/取消 | `/api/deskflow-runs/pause`、`/api/deskflow-runs/cancel` | `deskflow run pause/cancel` |
| 逐步证据 | `/api/deskflow-observations/readStep` | `deskflow observation step` |
| 交接 | `/api/deskflow-exchange/export` | `deskflow export`、`deskflow verify` |

## 6. 容量、异常与恢复

拟定上限：每流程 200 步、每批 50 个输入，单步骤 30 秒、单运行 15 分钟；单截图 8 MiB，单运行证据 256 MiB。持久材料 4 GiB，封套 512 MiB；录制与回放共用一个活动 VM 名额，声明磁盘 16 GiB 另预留。

未知弹窗、焦点丢失、窗口换代和输入法不匹配均停在原步骤。证据达到上限后停止要求完整证据的运行，不能继续并声称记录完整。取消必须释放按键、关闭输入通道并核对原应用后代；停止未知时保留资源账本。

## 7. 实施与验收

先实现专属桌面通道、录制和独立截止，再实现编辑、回放、判断及交换。

1. 三个模板完成真实录制、编辑、参数回放、产物验证及资源清理。
2. 多匹配、焦点变化、分辨率变化和未知弹窗均停止，不产生越目标输入。
3. 控制器退出后原桌面停止输入，所有按键释放；宿主其他窗口不接收动作。
4. 未知保存操作恢复时只核对原结果，不自动重复点击。
5. 人工接管结果标记 assisted；图像匹配失败不能用静态示例代替通过。
6. 未审阅画面拒绝导出，接收材料不产生活动会话或旧批准。
7. 支持平台、显示协议和应用版本按实测列明，不从已有桌面连接推导自动化可用。
