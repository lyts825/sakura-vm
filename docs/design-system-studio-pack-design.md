# 设计系统工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `design-system-studio`，包含 13 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户建立设计变量、主题、组件状态与版式约定，预览组合，检查引用和覆盖，再生成可审阅的设计系统版本。交付物包括类型化变量 JSON、限定格式 CSS、自有组件说明和状态示例。

本包负责设计系统的编辑、编译和版本交付。[浏览器验收](browser-lab-pack-design.md)仍负责真实网页流程；第六批无障碍包负责专门验证。本包的静态检查不宣称替代浏览器兼容或无障碍完整验收。

## 2. 内部插件与直接依赖

服务与方法均为拟议。依赖使用完整 ID；根账本管理授权、额度和空间，变量与资源由各插件独立拥有。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `dsys-spaces` 系统空间 | 空间、模板及访问修订；DsysSpacesV1：create、templates、archive | — | — |
| `dsys-tokens` 设计变量 | 类型化颜色、间距、圆角、层级及引用；DsysTokensV1：define、resolve、diff | `dsys-spaces` | — |
| `dsys-themes` 主题集合 | 主题继承、语义别名与覆盖规则；DsysThemesV1：compose、validate | `dsys-spaces`, `dsys-tokens` | — |
| `dsys-typography` 排版规格 | 字体档案、字阶、行距与回退约定；DsysTypographyV1：define、preview | `dsys-spaces`, `dsys-tokens`, `dsys-themes` | — |
| `dsys-icons` 图标资源 | 受限 SVG 字节、命名、许可和可见范围；DsysIconsV1：upload、sanitize、inspect | `dsys-spaces` | — |
| `dsys-components` 组件规格 | 固定组件树、属性、插槽和变量引用；DsysComponentsV1：compose、validate | `dsys-spaces`, `dsys-tokens`, `dsys-themes`, `dsys-typography`, `dsys-icons` | — |
| `dsys-states` 状态矩阵 | 组件状态、允许组合、触发语义与示例值；DsysStatesV1：define、expand、checkCoverage | `dsys-spaces`, `dsys-components` | — |
| `dsys-layouts` 版式样例 | 布局容器、断点及固定组件组合；DsysLayoutsV1：compose、preview | `dsys-spaces`, `dsys-themes`, `dsys-components`, `dsys-states` | — |
| `dsys-checks` 系统检查 | 引用完整性、主题覆盖、对比度及静态尺寸约束；DsysChecksV1：evaluate、explain | `dsys-spaces`, `dsys-tokens`, `dsys-themes`, `dsys-typography`, `dsys-icons`, `dsys-components`, `dsys-states`, `dsys-layouts` | — |
| `dsys-builds` 产物编译 | 固定编译计划、变量/CSS 字节及输出清单；DsysBuildsV1：preview、start、status、cancel、reconcile | `dsys-spaces`, `dsys-tokens`, `dsys-themes`, `dsys-typography`, `dsys-icons`, `dsys-components`, `dsys-states`, `dsys-layouts`, `dsys-checks` | — |
| `dsys-reviews` 版本复核 | 版本差异、例外、接受与不可变发布记录；DsysReviewsV1：review、decide、seal | `dsys-spaces`, `dsys-checks`, `dsys-builds` | — |
| `dsys-exchange` 系统交接 | 设计源、编译产物及许可封套；DsysExchangeV1：export、inspectImport、acceptImport | `dsys-spaces`, `dsys-tokens`, `dsys-themes`, `dsys-typography`, `dsys-icons`, `dsys-components`, `dsys-states`, `dsys-layouts`, `dsys-checks`, `dsys-builds`, `dsys-reviews` | — |
| `dsys-workbench` 系统工作台 | 变量编辑、主题预览、状态矩阵与版本导航；DsysWorkbenchV1：view、templates | `dsys-spaces`, `dsys-tokens`, `dsys-themes`, `dsys-typography`, `dsys-icons`, `dsys-components`, `dsys-states`, `dsys-layouts`, `dsys-checks`, `dsys-builds`, `dsys-reviews`, `dsys-exchange` | — |

图标服务同时保留原件与规范化派生件，编译只使用通过检查的固定派生件。发布记录保护对应输入与输出，编辑新主题不会替换已封存产物。

## 3. 模板与完整流程

| 模板 | 设计内容 | 交付重点 |
| --- | --- | --- |
| 明暗双主题 | 语义颜色、字阶和基础按钮/输入框 | 主题覆盖、文字对比及状态样例 |
| 密集数据界面 | 表格、工具栏、筛选及紧凑间距 | 密度档案、长文本与窄屏组合 |
| 内容阅读界面 | 标题、段落、卡片和通知条 | 阅读宽度、字体回退及排版规格 |

1. 创建空间，选择模板，导入受支持的变量 JSON 或编辑新变量。
2. 定义语义别名、主题和字体档案，检查引用循环及类型不匹配。
3. 上传有许可说明的图标，核对清理后的预览与原始差异。
4. 组合固定组件和状态，填写示例内容，检查允许组合及未覆盖状态。
5. 建立断点和版式样例，对照主题、长文本、窄屏及键盘焦点预览。
6. 固定全部修订，预览输出文件、命名空间和预算，批准编译。
7. 审阅变量与产物差异，说明例外，封存版本并导出设计源与 CSS。
8. 接收端核验，重新生成使用新计划；清理前保护已发布版本的资源引用。

## 4. 规则与执行边界

变量 JSON 使用本包明示模式，支持颜色、长度、数值、字体引用和受限别名。首版不宣称兼容所有外部设计变量规范；导入适配必须记录来源模式和丢失字段。主题继承和变量别名必须无环。

组件采用内置声明式节点集，包括文本、按钮、输入、选择、容器、表格和状态标记。拒绝任意 JavaScript、HTML、事件脚本和外部资源 URL；示例内容只作为文本或有限结构数据。样例预览不能修改真实应用页面。

拟议宿主接口 `DesignSystemCompileV1` 在受管有界计算 worker 内执行变量求值和固定 CSS 编译。它接收类型化对象及资源租约，返回输出清单；无任意文件、网络或命令执行入口。预览使用隔离的内置渲染器，不执行导入代码。

图标只保留有限 SVG 元素和属性，拒绝脚本、外部引用、滤镜膨胀和嵌入 HTML。字体首版使用固定内置档案或字体名称声明，不下载外部字体；未安装字体显示回退与差异，不能声称真实字体已验证。

对比检查固定前景、背景、透明度合成规则和用户选择阈值。渐变、图片背景或未知字体的结果标记检查范围不足。预览中的静态检查只能报告已覆盖状态，不构成无障碍认证或跨浏览器承诺。

尺寸检查只判断声明的最小值、最大值、断点和容器约束。实际布局溢出限定为内置预览在固定窗口、字体及样例下的局部观察或人工复核，并单独记录环境与范围；worker 编译结果不作为真实布局测量。

## 5. 页面、HTTP 与 CLI

页面提供变量树、主题矩阵、排版、图标、组件、状态、版式、检查及版本。所有画布操作有键盘列表等价入口，预览区与宿主样式隔离。暗色主题不改写原设计颜色。

以下为拟议鉴权 POST 路径；CLI 前缀为 `sakura designsys`，支持 JSON、固定版本和差异输出。

| 操作 | HTTP 路径 | CLI 动作 |
| --- | --- | --- |
| 变量求值 | `/api/dsys-tokens/resolve` | `tokens resolve` |
| 主题检查 | `/api/dsys-themes/validate` | `themes check` |
| 状态覆盖 | `/api/dsys-states/checkCoverage` | `states check` |
| 编译计划/执行 | `/api/dsys-builds/preview`、`/api/dsys-builds/start` | `build preview/start` |
| 查询/停止/核销 | `/api/dsys-builds/status`、`/api/dsys-builds/cancel`、`/api/dsys-builds/reconcile` | `build status/cancel/reconcile` |
| 版本与交接 | `/api/dsys-reviews/seal`、`/api/dsys-exchange/export` | `version seal`、`export` |

离线 `verify` 校验引用、资源白名单、清单及输出摘要，不能用校验通过代替在目标应用中的集成验证。

## 6. 容量、恢复与交接

设计上限为 5,000 个变量、12 个主题、200 个组件、每组件 32 个状态、100 个版式样例和 500 个图标。单图标 256 KiB、组件树深度 16、单树 500 个节点；矩阵展开总量不得超过 10,000 个预览单元。

单包 1 GiB，单次编译输出 32 MiB、封套 128 MiB、计算截止 2 分钟，最多一个编译任务。32 MiB 恢复账本计入总额；资源原件、派生件和导出暂存均计费。数值待实测，共同 8 GiB 尚未纳入本包。

循环、类型错误、未知节点和展开超限在执行前拒绝。编译失败保留草稿及错误，不替换上个版本；中断核对原输出意图，完整清单确认后才发布。取消和清理失败保留占用。

使用既有 owner 权限。升级先预览模式与命名变化，保留原字节；导入不激活样式或安装资源。导出预览列出许可与完整资源集合，清理按原修订检查所有已发布版本。

可重新编译的定义必须在同一封套中带齐变量、组件及资源。缺少引用或超出封套上限时只接受只读参考档案；不允许跨封套隐式拼接完整版本。

## 7. 实施与验收

先完成变量、主题与受限资源，再实现组件预览和固定编译，最后交付版本差异、交接及独立安装入口。

1. 三个模板独立完成编辑、编译、复核、导出和接收。
2. 别名循环、类型不符、主题缺项和重名输出准确定位到对象。
3. 修改一个语义变量，仅声明依赖的产物变化，旧版本字节保持不变。
4. 脚本 SVG、外部引用和超深组件树在上传或解析阶段拒绝。
5. 未安装字体、图片背景和未覆盖状态显示检查缺口；预览的局部溢出观察与静态尺寸检查分开，不产生目标应用完整通过结论。
6. 状态组合超出 10,000 项时拒绝展开，界面不以第一页表示全部状态。
7. 满盘、取消和重启不发布半套 CSS，原输出核对后才释放暂存。
8. 390 px、明暗主题与键盘入口可完成同一编辑流程，隔离预览不污染宿主界面。
