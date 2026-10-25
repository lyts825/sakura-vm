# 应用配置设计插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `configuration-studio`，含 12 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户把基础配置、环境覆盖及变量组合成确定结果，检查逐键来源、类型、冲突和敏感引用，交付已审阅的配置版本及变更说明。首版支持 JSON、受限 YAML 和键值文件；整个设计流程可离线完成。

[应用配置](app-runtime-pack.md)继续负责运行实例的真实配置和秘密注入，[多主机基线](fleet-baseline-pack-design.md)负责主机漂移。本包处理发布前的配置求值与审阅，不向运行服务写入配置。

## 2. 内部插件与直接依赖

短依赖统一补上 `cfg-`；每个服务均为拟议接口。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `cfg-sources` 来源与空间 | 根账本、原配置字节、格式及许可；CfgSourcesV1：upload、pin、parse | — | — |
| `cfg-schemas` 字段模式 | 类型、默认值、必填和未知键策略；CfgSchemasV1：define、validate | sources | — |
| `cfg-layers` 覆盖层 | 层顺序、作用条件与合并策略；CfgLayersV1：compose、checkOrder | sources, schemas | — |
| `cfg-variables` 非秘密变量 | 类型变量、有限引用和缺省规则；CfgVariablesV1：define、checkReferences | sources, schemas | — |
| `cfg-bindings` 敏感绑定声明 | 符号名、用途、必需性和接收端绑定要求；CfgBindingsV1：declare、checkUsage | sources, schemas | — |
| `cfg-targets` 环境目标 | 环境矩阵、变量集和层选择；CfgTargetsV1：define、expand | sources, layers, variables, bindings | — |
| `cfg-renders` 确定性求值 | 有界求值任务、逐键来源及渲染产物；CfgRendersV1：preview、render、cancel、reconcile | sources, schemas, layers, variables, bindings, targets | — |
| `cfg-checks` 配置检查 | 类型、交叉字段、覆盖和绑定缺项；CfgChecksV1：evaluate、explain | sources, schemas, bindings, targets, renders | — |
| `cfg-diffs` 变更比较 | 逐键语义差异、来源变化与影响分类；CfgDiffsV1：compare、annotate | sources, schemas, renders, checks | — |
| `cfg-reviews` 版本审阅 | 审阅项、决定及配置版本清单；CfgReviewsV1：prepare、decide、sealRelease | sources, renders, checks, diffs | — |
| `cfg-exchange` 配置交接 | 原稿、模板、结果与审阅封套；CfgExchangeV1：export、inspectImport、acceptImport | * | — |
| `cfg-workbench` 配置工作台 | 层叠编辑器、逐键来源和多环境比较；CfgWorkbenchV1：view、templates | * | — |

bindings 仅保存符号及用途，不读取秘密值，也不依赖秘密服务。接收端重新绑定；本包结果不能证明运行时秘密存在或部署成功。reviews 保存版本决定，渲染字节仍归 renders。

## 3. 完整使用流程

1. 从“开发与生产”“多区域服务”或“配置格式迁移”模板创建空间并上传原稿。
2. 定义字段模式、默认值、未知键策略及敏感绑定符号。
3. 设置覆盖层顺序、删除标记和数组策略，录入非秘密变量。
4. 展开目标环境，预览每个目标的输入、层顺序、缺项和输出路径。
5. 求值并查看逐键来源；修复重复键、循环引用、类型或覆盖冲突。
6. 与指定旧版本比较，区分数值变化、来源变化、缺省变化和敏感绑定变化。
7. 复核完整环境矩阵，封存配置版本；敏感绑定未解析时保存为待绑定模板。
8. 导出配置、绑定说明和审阅记录，接收端核验后建立新版本；清理无人引用的暂存。

## 4. 求值语义与版本规则

`LayerRevision` 固定顺序及对象、数组和空值的合并规则。默认对象逐键覆盖，数组整体替换；逐项合并必须声明唯一键。删除使用独立标记，不能混同 null 或空字符串。重复键在解析阶段拒绝。

`VariableRef` 仅能引用本目标中声明的非秘密变量，引用图必须无环。拟议 `ConfigurationEvaluateV1` 只支持常量、引用、有限条件和字符串拼接；禁止脚本、环境变量隐式读取、文件包含和联网。YAML 禁止自定义标签及别名展开。

每个输出键保存原文件位置、各层操作、最终类型及规则版本。缺少必需值为失败，未知规则为不支持；用户可保存未通过草稿，不能将其封存为已检查通过的配置版本。

敏感字段必须使用 binding 占位。发现用户明确标为秘密的字面值时，拒绝普通预览及导出，并提供替换为符号的修订入口。自动检测仅作为提示，不声称能发现所有秘密。封存模板的结论标明待绑定项。

业务审阅绑定所有目标的固定修订和检查摘要，修改任何层均使新配置需要新审阅。已封存结果不追随新变量或新模式。格式化差异与语义差异分别显示，不能自动忽略类型改变。

## 5. 页面、HTTP 与 CLI

页面包含来源、模式、层、变量、绑定、环境、求值、逐键溯源、差异和交接。点击输出键可以查看全部覆盖过程。CLI 别名为 `config-studio`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 检查引用 | `/api/cfg-variables/checkReferences` | `config-studio variables check` |
| 求值预览/执行 | `/api/cfg-renders/preview`、`/api/cfg-renders/render` | `config-studio render preview/run` |
| 规则检查 | `/api/cfg-checks/evaluate` | `config-studio checks evaluate` |
| 语义比较 | `/api/cfg-diffs/compare` | `config-studio diff` |
| 封存版本 | `/api/cfg-reviews/sealRelease` | `config-studio release seal` |
| 交接 | `/api/cfg-exchange/export` | `config-studio export`、`config-studio verify` |

## 6. 容量、异常与恢复

拟定上限：单文件 4 MiB、嵌套 32 层、每空间 20,000 个键、50 个覆盖层和 100 个目标；单次求值 30 秒及 128 MiB 输出。包总额 1 GiB，单封套 128 MiB。求值任务及暂存计费，取消后核对原计算任务再释放。

循环、歧义合并或重复键阻止求值。输出超限只保留失败诊断，不发布半份环境结果。并发编辑拒绝旧修订；封存中断查询原提交意图。历史版本保护对应原稿、规则及渲染字节，归档不能绕过保护。

## 7. 实施与验收

先实现格式、模式和覆盖语义，再实现有界求值、差异审阅及交接。无需执行用户程序或访问在线服务。

1. 三个模板从原稿产生可溯源的多环境配置并完成交接。
2. 缺失、null、空值、删除和数组替换各有明确且可复现的结果。
3. 重复键、引用环、YAML 扩展和外部文件引用被拒绝。
4. 相同固定输入产生相同语义结果；逐键来源覆盖所有修改。
5. 敏感绑定保持未解析，导出不携带秘密值；待绑定模板不标为已部署。
6. 并发旧修订、撤权、中断和满盘不发布部分配置；旧封存版本保持原值。
7. 单包启用、离线核验和独立安装的 CLI 均可完成全部设计流程。
