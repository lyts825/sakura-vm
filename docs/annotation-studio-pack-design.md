# 数据标注与复核插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `annotation-studio`，含 12 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户固定文本和图像样本，定义标签及标注指南，完成分类、文本区间、图像矩形框、分歧裁决和抽检，交付可追溯标签集。首版不执行模型预标注、训练、视频标注或外部众包任务。

[数据工作台](data-lab.md)保留数据处理责任，[本地化](localization-studio-pack-design.md)保留翻译责任。本包拥有人工标签、意见和接受版本；任务负责人是业务记录，实际访问继续按现有空间权限。

## 2. 内部插件与直接依赖

短名统一补上 `annot-`；服务、方法和入口均待实现。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `annot-sources` 样本空间 | 根账本、原文本/图像、许可和固定字节；AnnotSourcesV1：upload、pin、inspect | — | — |
| `annot-labels` 标签体系 | 标签 ID、层级、互斥及属性模式；AnnotLabelsV1：define、validate、seal | sources | — |
| `annot-guidelines` 标注指南 | 定义、正反例、边界规则和指南版本；AnnotGuidelinesV1：compose、linkExamples、seal | sources, labels | — |
| `annot-samples` 样本集合 | 稳定样本 ID、分组和重复关系；AnnotSamplesV1：compose、deduplicate、partition | sources | — |
| `annot-batches` 工作批次 | 样本分配、复核份数、角色声明和到期；AnnotBatchesV1：plan、assign、reassign | sources, labels, guidelines, samples | — |
| `annot-marks` 标注编辑 | 分类、区间和矩形框意见的修订；AnnotMarksV1：saveMarks、validate、submit | sources, labels, guidelines, samples, batches | — |
| `annot-agreement` 意见比较 | 可比较样本、分歧及匹配口径；AnnotAgreementV1：compare、summarize | sources, labels, samples, batches, marks | — |
| `annot-adjudications` 分歧裁决 | 裁决意见、证据、取舍及驳回；AnnotAdjudicationsV1：prepare、decide、reopen | sources, guidelines, samples, marks, agreement | — |
| `annot-audits` 质量抽检 | 固定抽样、逐项问题及复核结果；AnnotAuditsV1：planSample、recordReview、evaluate | sources, labels, guidelines, samples, marks, adjudications | — |
| `annot-releases` 标签集版本 | 接受标签、未解决项及来源映射；AnnotReleasesV1：preview、seal、diff | sources, labels, guidelines, samples, batches, marks, agreement, adjudications, audits | — |
| `annot-exchange` 标注交接 | 样本、标签、指南和意见封套；AnnotExchangeV1：export、inspectImport、acceptImport | * | — |
| `annot-workbench` 标注工作台 | 键盘标注、图像画布、分歧和抽检导航；AnnotWorkbenchV1：view、templates | * | — |

marks 保留每份原始意见；裁决另存，不覆盖原标注。releases 固定接受的意见或裁决及依据，不通过删除不同意见制造一致结果。

## 3. 完整使用流程

1. 选择“文本分类”“实体区间”或“图像目标框”模板，上传本地样本并声明许可。
2. 固定标签、属性、指南和正反例，检查标签树及互斥约束。
3. 处理重复样本，建立批次及复核份数；固定参与者声明和实际账号关系。
4. 逐样本标注、保存草稿并提交，跳过时记录理由；编辑器校验范围和标签版本。
5. 比较独立意见，对分歧逐项裁决；允许退回并保留原意见历史。
6. 固定抽样方法与种子，执行人工抽检；问题影响范围需显式决定是否返工。
7. 预览标签集完整样本数、未解决项及许可，封存固定版本。
8. 导出选定原样本或摘要引用及标签，接收端校验坐标和版本；清理无保护引用的草稿暂存。

## 4. 坐标、独立意见与版本

文本区间采用固定原文的 Unicode 码点半开区间 `[start, end)`，同时记录原字节摘要；不使用编辑器 UTF-16 下标直接作为交换坐标。显示可以换行，原文内容和规范化形式不能静默改变。

图像标注绑定固定解码后的展示栅格摘要、宽高、方向变换和原图摘要。矩形采用左上原点及半开像素坐标，旋转或裁剪产生新样本；旧框不会自动迁移。拟议 `AnnotationMediaInspectV1` 使用固定解码器并限制像素和内存。

`AnnotationOpinion` 保存实际账号、声明参与者、指南和标签修订。首版 owner 权限不能提供独立多人盲审保证；同一账号录入两份意见明确标为录入的双份意见。导入签名缺失时仍是来源声明，不可当作已认证标注者身份。

agreement 分别报告分类一致、区间匹配和矩形匹配，固定匹配阈值及分母。跳过、无答案和标签不存在分别计数；意见一致不代表事实正确。样本不足或全部缺失时不生成质量满分。

抽检保存总体、方法、种子、抽取结果和实际完成项。人工方便抽样与随机抽样分开；首版不把便利样本错误率推断为全体质量保证。抽样后替换困难样本必须生成新抽检计划。

标签层级必须无环，互斥规则不能要求同一样本同时选择互斥标签。标签删除采用退役，引用该标签的历史版本继续可读。标签语义变化建立新版本和迁移提案，旧意见必须重新检查，不能静默改名后当作同一含义。

## 5. 页面、HTTP 与 CLI

页面包含样本、标签、指南、批次、标注器、分歧、抽检和版本。图像画布提供坐标表替代输入，快捷键可配置且支持撤销当前未提交操作。CLI 别名为 `annotate`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 编排批次 | `/api/annot-batches/plan` | `annotate batch plan` |
| 提交标注 | `/api/annot-marks/submit` | `annotate marks submit` |
| 比较意见 | `/api/annot-agreement/compare` | `annotate agreement compare` |
| 裁决 | `/api/annot-adjudications/decide` | `annotate adjudication decide` |
| 抽检/封存 | `/api/annot-audits/planSample`、`/api/annot-releases/seal` | `annotate audit plan`、`annotate release seal` |
| 交接 | `/api/annot-exchange/export` | `annotate export`、`annotate verify` |

## 6. 容量、异常与恢复

拟定上限：每空间 50,000 个样本、1000 个标签、100 个批次；单文本 1 MiB，单图 16 MiB、20 百万像素，解码峰值 128 MiB，单样本 200 个标记。包总额 4 GiB，封套 512 MiB；标签/坐标比较最多 2 分钟。

损坏图像和超大解码隔离，不能跳过后冒充全部处理。并发保存拒绝旧修订并保留本地意见。原样本撤权阻止查看和导出相关内容。未裁决项默认阻止完整标签集封存；允许不完整导出时清单明确缺项且结论不通过。

## 7. 实施与验收

先完成样本、标签和坐标工具，再实现标注、比较、裁决与抽检，最后完成版本和交接。

1. 三个模板完成实际编辑、分歧裁决、抽检、版本导出和接收。
2. 中文、组合字符和 emoji 的区间经过导出再导入仍指向原文；旋转图像的框保持相同栅格位置。
3. 同一账号的两份意见不冒充独立双人复核，来源声明与实际主体分别保留。
4. 未标注、跳过、标签退役和语义变化产生正确缺项及版本影响。
5. 抽样可按种子重现，替换样本留新修订，不隐藏问题样本。
6. 并发修改、撤权、解码超限及接受中断不覆盖旧意见或发布部分标签集。
7. 只启用本包即可完成全部流程，导出不包含未许可原样本或活动授权。
