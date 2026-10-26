# 表单流程工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `form-flow-studio`，包含 13 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户设计有类型、校验、条件分支和多步骤导航的表单，用固定样例验证路径，预览输入与错误，再交付表单定义、受限渲染规格和验收记录。首版只提供本地设计与试填，不部署外网表单，不收集真实访客数据。

本包负责声明式表单语义及试填证据。[跨包流程](flow-studio-pack-design.md)继续负责原业务动作委派，[浏览器验收](browser-lab-pack-design.md)负责真实应用流程。表单结果不会自动触发这些业务动作。

## 2. 内部插件与直接依赖

以下插件和服务均为拟议；依赖写完整 ID，每个存储对象只有一个所有者。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `fform-spaces` 表单空间 | 空间、模板、额度与访问修订；FformSpacesV1：create、templates、archive | — | — |
| `fform-fields` 字段目录 | 稳定字段 ID、输入类型、标签与帮助文本；FformFieldsV1：define、validate | `fform-spaces` | — |
| `fform-schemas` 数据约定 | 类型、枚举、默认值、必填和规范化规则；FformSchemasV1：define、check | `fform-spaces`, `fform-fields` | — |
| `fform-logic` 条件逻辑 | 显隐、计算与跳转的有限表达式图；FformLogicV1：compose、checkGraph | `fform-spaces`, `fform-fields`, `fform-schemas` | — |
| `fform-pages` 步骤编排 | 页面、字段顺序、导航和可达性；FformPagesV1：compose、checkReachability | `fform-spaces`, `fform-fields`, `fform-logic` | — |
| `fform-fixtures` 样例材料 | 合成试填值、路径期望和边界案例；FformFixturesV1：define、generate | `fform-spaces`, `fform-fields`, `fform-schemas`, `fform-pages` | — |
| `fform-validations` 校验执行 | 字段/跨字段规则结果、路径覆盖和错误顺序；FformValidationsV1：preview、run、status、cancel、reconcile | `fform-spaces`, `fform-fields`, `fform-schemas`, `fform-logic`, `fform-pages`, `fform-fixtures` | — |
| `fform-previews` 交互预览 | 固定定义预览会话、草稿及导航轨迹；FformPreviewsV1：open、answer、navigate、close | `fform-spaces`, `fform-fields`, `fform-schemas`, `fform-logic`, `fform-pages`, `fform-validations` | — |
| `fform-submissions` 试填记录 | 明示为本地样例的提交、错误和字段来源；FformSubmissionsV1：capture、read、erasePreview | `fform-spaces`, `fform-schemas`, `fform-previews` | — |
| `fform-versions` 表单版本 | 定义、提示、样例及覆盖结果的固定引用图；FformVersionsV1：assemble、seal、diff | `fform-spaces`, `fform-fields`, `fform-schemas`, `fform-logic`, `fform-pages`, `fform-fixtures`, `fform-validations`, `fform-submissions` | — |
| `fform-reviews` 表单复核 | 业务要求、人工体验意见及发布接受；FformReviewsV1：review、decide | `fform-spaces`, `fform-versions`, `fform-validations` | — |
| `fform-exchange` 表单交接 | 定义与样例封套、模式检查及本地映射；FformExchangeV1：export、inspectImport、acceptImport | `fform-spaces`, `fform-fields`, `fform-schemas`, `fform-logic`, `fform-pages`, `fform-fixtures`, `fform-validations`, `fform-previews`, `fform-submissions`, `fform-versions`, `fform-reviews` | — |
| `fform-workbench` 表单工作台 | 字段/步骤编辑、路径图、预览与版本导航；FformWorkbenchV1：view、templates | `fform-spaces`, `fform-fields`, `fform-schemas`, `fform-logic`, `fform-pages`, `fform-fixtures`, `fform-validations`, `fform-previews`, `fform-submissions`, `fform-versions`, `fform-reviews`, `fform-exchange` | — |

预览草稿归预览服务，显式保存的试填归提交服务。表单版本只引用被选择的试填证据，未保存草稿关闭后按原会话清理。`erasePreview` 只处理本包无保护引用的试填材料，不能清除正式版本证据。

## 3. 模板与完整流程

| 模板 | 交互特点 | 验证重点 |
| --- | --- | --- |
| 多步骤登记 | 类型字段、前后导航和最终确认 | 错误定位、草稿保存及重入 |
| 条件申请 | 根据选择显隐字段和改变步骤 | 不可达页、隐藏字段及分支覆盖 |
| 有限重复明细 | 数量受限的明细行和合计 | 行 ID、上下界及跨字段约束 |

1. 创建空间，定义字段类型、标签、默认值和数据约定。
2. 编排步骤与有限条件，检查未定义字段、逻辑循环和不可达页面。
3. 选择隐藏值保留或清除策略，定义规范化与错误顺序。
4. 创建合成样例及预期路径，预览运行范围后执行有限校验。
5. 在固定版本上试填，验证焦点、返回导航、错误摘要和草稿恢复。
6. 显式保存所需试填证据，复核未覆盖分支及业务字段说明。
7. 封存表单版本，导出 JSON 定义、渲染说明、样例和覆盖报告。
8. 接收端先核验再预览；集成到真实网站须由后续实施明确部署与收集范围。

## 4. 规则与解释器边界

字段首版支持文本、有限小数、整数、布尔、日期、枚举及有界重复组。文件上传、支付、外部身份校验和远程字段查询不在首版。输入始终按数据处理，不解释为 HTML 或脚本。

逻辑表达式只允许类型化比较、布尔组合、有限算术和枚举成员判断。计算字段图必须无环；页面导航允许用户返回前页，但自动跳转不得形成循环。日期固定时区或明确使用无时区日历日期。

拟议宿主接口 `FormDefinitionEvaluateV1` 在受管有界计算 worker 内执行校验和路径解释，固定语言与步数上限，无网络或任意代码能力。浏览器预览使用同一版本的解释语义；服务端校验结果仍是试填保存依据。

隐藏字段的清除/保留、必填生效范围和提交序列化分别配置。规范化不静默修改原输入；记录原值、规范值和错误。重复行使用稳定 ID，删除或重排不能把错误挂到其他行。

路径覆盖只描述给定样例命中的条件，不等于所有可能输入均正确。静态可达性有不确定条件时明确保留缺项。前端页面可见与通过校验不构成业务授权。

## 5. 页面、HTTP 与 CLI

页面包括字段、数据约定、条件、步骤、样例、校验、预览、试填与版本。错误摘要可跳转到实际字段，字段标签和帮助文本有键盘路径；所有条件图提供可编辑表格。

所有接口均为拟议鉴权 POST，CLI 前缀为 `sakura forms`。预览会话绑定 owner、空间、固定定义及插件 generation。

| 操作 | HTTP 路径 | CLI 动作 |
| --- | --- | --- |
| 逻辑检查 | `/api/fform-logic/checkGraph` | `logic check` |
| 页面可达性 | `/api/fform-pages/checkReachability` | `pages check` |
| 校验计划/执行 | `/api/fform-validations/preview`、`/api/fform-validations/run` | `check preview/run` |
| 查询/停止/核销 | `/api/fform-validations/status`、`/api/fform-validations/cancel`、`/api/fform-validations/reconcile` | `check status/cancel/reconcile` |
| 预览回答 | `/api/fform-previews/answer` | `preview answer` |
| 版本与交接 | `/api/fform-versions/seal`、`/api/fform-exchange/export` | `version seal`、`export` |

离线 `verify` 检查定义、样例、引用及有限规则，不启动网络收集端点。CLI 退出码沿共同约定，未覆盖路径在明细中保留。

## 6. 容量、恢复与交接

设计上限为 200 个字段、20 个页面、500 条规则、每重复组 100 行、2,000 个样例及每样例 1,000 个解释步骤。计算截止 2 分钟，最多一个校验任务；同空间最多 10 个预览会话，闲置 30 分钟关闭。

单包 512 MiB，单提交 256 KiB、全部试填 64 MiB、封套 64 MiB；包含 32 MiB 恢复账本。数值待实测；预览草稿、保存试填、接收隔离和导出暂存计入共同容量，现有 8 GiB 尚未登记本包。

冲突修订、非法跳转和解释步数超限保留输入及错误。锁定或撤权关闭预览并清除浏览器草稿；服务端持久草稿按原空间权限保留。重启不自动提交试填，恢复须核对原保存意图。

升级预览字段/规则模式迁移并保留原版本，未知规则拒绝执行。交接默认不包含试填值，选择附带时逐项显示；正式版本引用的记录不能用预览清理入口删除。业务角色标签不会创建访问权限。

可执行的表单定义必须在同一封套中带齐字段、规则和页面引用，试填证据可以明确省略。定义缺项时只接受只读参考档案；不允许跨封套隐式拼接后启动预览。

## 7. 实施与验收

先完成字段与有限解释器，再实现页面/样例和交互预览，最后交付版本、试填选择及安装态核验。

1. 三种模板在同包内完成编辑、校验、试填、导出和接收。
2. 自动跳转循环和计算循环分别定位，用户正常返回步骤保持可用。
3. 隐藏字段按所选策略保留或清除，必填规则与实际提交值一致。
4. 重复行删除、重排后错误仍关联正确行 ID，合计按固定精度计算。
5. 前后端对边界样例产生相同规范值、错误代码和路径结果。
6. 未命中分支显示未覆盖，空样例集不产生通过结论。
7. 撤权、锁定、超时与旧 generation 拒绝继续回答或保存试填。
8. 重启、满盘和重复提交只核对原意图，交接材料不会创建公开收集端点。
