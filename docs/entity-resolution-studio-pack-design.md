# 实体归并工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；当前应用保持 2.8.1，基线为 `4afb3b9a`。包 ID 为 `entity-resolution-studio`，含 15 个拟议插件，当前分支运行实现待开始。共同规则见[第七批总览](plugin-pack-seventh-design.md)。

用户整理多份商品、机构或设备台账，通过候选匹配、人工裁决和字段取值策略，得到有证据的规范实体版本。本包交付新数据副本及原记录映射，不覆盖来源系统。

[数据工作台](data-lab.md)保留通用变换，[标注设计](annotation-studio-pack-design.md)保留通用样本标注。本包增加记录候选生成、不可合并约束、簇级裁决、字段取值及拆分追溯。首版模板使用商品、机构和设备，不提供真实人物身份调查。

## 2. 内部插件与直接依赖

下列服务为拟议接口。记录、候选、决定和规范版本分别拥有独立存储责任。

| 插件 ID 与名称 | 独立对象、核心功能和服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `entitydesk-spaces` 归并空间 | 空间、授权和额度；EntitydeskSpacesV1：create、configure、close | — | — |
| `entitydesk-sources` 原始台账 | 原文件、字段档案、记录定位及许可；EntitydeskSourcesV1：upload、inspect、pin | `entitydesk-spaces` | — |
| `entitydesk-normalization` 标准化规则 | 大小写、空白、单位和有限词典映射；EntitydeskNormalizationV1：define、preview、seal | `entitydesk-spaces`, `entitydesk-sources` | — |
| `entitydesk-blocks` 候选分组 | 阻塞键、邻域范围和候选覆盖声明；EntitydeskBlocksV1：define、estimate、seal | `entitydesk-spaces`, `entitydesk-sources`, `entitydesk-normalization` | — |
| `entitydesk-comparators` 比较器版本 | 精确匹配、编辑距离及数值容差；EntitydeskComparatorsV1：define、validate、seal | `entitydesk-spaces`, `entitydesk-normalization` | — |
| `entitydesk-candidates` 候选对 | 比较任务、逐字段分数和缺失项；EntitydeskCandidatesV1：preview、compute、cancel、reconcile | `entitydesk-spaces`, `entitydesk-sources`, `entitydesk-normalization`, `entitydesk-blocks`, `entitydesk-comparators` | — |
| `entitydesk-constraints` 合并约束 | 必须同组、禁止同组和互斥来源条件；EntitydeskConstraintsV1：define、check、seal | `entitydesk-spaces`, `entitydesk-sources`, `entitydesk-candidates` | — |
| `entitydesk-clusters` 候选簇 | 簇提议、冲突边和连通性解释；EntitydeskClustersV1：propose、explain、split | `entitydesk-spaces`, `entitydesk-candidates`, `entitydesk-constraints` | — |
| `entitydesk-decisions` 人工裁决 | 成对及簇级接受、拒绝、暂缓和理由；EntitydeskDecisionsV1：prepare、decide、seal | `entitydesk-spaces`, `entitydesk-sources`, `entitydesk-candidates`, `entitydesk-constraints`, `entitydesk-clusters` | — |
| `entitydesk-evaluations` 匹配复核 | 固定标注对、抽样范围和匹配指标；EntitydeskEvaluationsV1：defineSet、evaluate、compare | `entitydesk-spaces`, `entitydesk-candidates`, `entitydesk-clusters`, `entitydesk-decisions` | — |
| `entitydesk-survivors` 字段取值 | 来源优先级、逐字段冲突和取值证据；EntitydeskSurvivorsV1：define、preview、resolve | `entitydesk-spaces`, `entitydesk-sources`, `entitydesk-normalization`, `entitydesk-decisions` | — |
| `entitydesk-versions` 规范实体版本 | 规范记录、原记录映射和拆分历史；EntitydeskVersionsV1：compose、validate、seal | `entitydesk-spaces`, `entitydesk-sources`, `entitydesk-decisions`, `entitydesk-survivors` | — |
| `entitydesk-reports` 归并档案 | 阈值、覆盖、复核、未决项和版本差异；EntitydeskReportsV1：assemble、compare、seal | `entitydesk-spaces`, `entitydesk-candidates`, `entitydesk-clusters`, `entitydesk-decisions`, `entitydesk-evaluations`, `entitydesk-versions` | — |
| `entitydesk-exchange` 归并交接 | 规范数据、原映射和证据的隔离交换；EntitydeskExchangeV1：export、inspectImport、acceptImport | `entitydesk-spaces`, `entitydesk-sources`, `entitydesk-normalization`, `entitydesk-blocks`, `entitydesk-comparators`, `entitydesk-candidates`, `entitydesk-constraints`, `entitydesk-clusters`, `entitydesk-decisions`, `entitydesk-evaluations`, `entitydesk-survivors`, `entitydesk-versions`, `entitydesk-reports` | — |
| `entitydesk-workbench` 归并工作台 | 双列比较、簇裁决、取值预览和保存视图；EntitydeskWorkbenchV1：view、saveView、templates | `entitydesk-spaces`, `entitydesk-sources`, `entitydesk-normalization`, `entitydesk-blocks`, `entitydesk-comparators`, `entitydesk-candidates`, `entitydesk-constraints`, `entitydesk-clusters`, `entitydesk-decisions`, `entitydesk-evaluations`, `entitydesk-survivors`, `entitydesk-versions`, `entitydesk-reports`, `entitydesk-exchange` | — |

## 3. 模板与完整流程

| 模板 | 输入和重点 | 完成交付 |
| --- | --- | --- |
| 商品目录合并 | 厂商、型号、规格和商品编码 | 规范商品及型号冲突说明 |
| 机构名录整理 | 机构名称、登记号和地址资料 | 规范机构及别名映射 |
| 设备台账去重 | 序列号、资产号和维护记录 | 设备实体及来源字段选择 |

1. 上传两份以上台账，给每条记录分配不可变来源定位。
2. 配置标准化和候选分组，查看原值与派生值，估算候选规模。
3. 固定比较器和阈值，计算候选并保留逐字段贡献。
4. 添加互斥约束，形成簇提议，定位传递关系带来的冲突。
5. 人工接受、拒绝或暂缓簇；需要拆分时保存新决定和旧簇关联。
6. 以独立固定标注集复核匹配表现，报告候选生成覆盖的限制。
7. 预览字段取值，逐项处理冲突，封存规范版本。
8. 导出版本、映射和允许携带的原资料，隔离接收后核对来源。

## 4. 匹配、裁决与数据边界

首版接受 UTF-8 CSV、扁平 JSONL 和版本化词典 JSON。标准化保留原字节、规则版本及派生值；未知单位或无法解释的编码进入待处理，不自动猜测。

相似分数只表示所选比较器的分数，不能显示为同一实体概率。缺失字段按固定策略处理，不能默认等同。阈值变更会产生新候选结果，不改变既有人工决定。

候选生成限定在预设分组内。未成为候选的记录对不能计为已验证不同；候选覆盖未知时，不报告全体记录的召回率。分组过大须拒绝或要求新的分组定义，不任意抽掉配对。

成对匹配不自动证明簇内所有记录同一。连通分量只是簇提议；存在禁止同组约束时阻止封存。人工决定必须绑定整个簇、记录修订与约束版本。

字段取值允许固定来源优先、最新业务时点或显式选择。时间缺失和同级冲突须人工处理；不能用上传时间冒充业务新旧。规范版本保留每个字段的原记录来源。

拟议 `EntityMatchingComputeV1` 提供有限字符串比较、候选分组和簇提议。实施须验证归一化版本、确定性排序、候选爆炸拒绝、取消及暂存核销。不允许用户脚本或远程身份查找。

## 5. 页面、HTTP 与 CLI

页面提供原值与派生值并排查看、分数解释、约束冲突、簇级裁决及规范结果预览。长簇默认折叠但批准覆盖完整簇；提供总记录数和未展开数量。

下表均为拟议 POST，CLI 前缀为 `sakura entity-desk`。

| 服务方法 | HTTP 路径 | CLI 子命令 |
| --- | --- | --- |
| Normalization.preview | `/api/entitydesk-normalization/preview` | `normalization preview` |
| Candidates.preview/compute | `/api/entitydesk-candidates/preview`、`/api/entitydesk-candidates/compute` | `candidate preview`、`candidate compute` |
| Clusters.propose | `/api/entitydesk-clusters/propose` | `cluster propose` |
| Decisions.decide | `/api/entitydesk-decisions/decide` | `decision apply` |
| Versions.seal | `/api/entitydesk-versions/seal` | `version seal` |
| Exchange.export/acceptImport | `/api/entitydesk-exchange/export`、`/api/entitydesk-exchange/acceptImport` | `export`、`import accept` |

所有读写绑定真实 owner 与空间。CLI 提供状态、等待、取消、原任务恢复和离线 `verify`，不把规范导出直接提交到原数据库。

## 6. 容量、权限与恢复

拟定单空间 20 个来源、合计 200,000 条记录、128 MiB；每记录 128 KiB。单次最多 200 万候选对、每簇 1000 条记录、20 个比较器，计算 5 分钟。达到上限即拒绝计划，不静默减少比较范围。

包总额 2 GiB，包含 32 MiB 恢复账本、规范副本、候选索引和导入隔离；交接封套最多 256 MiB。新包仍须接入宿主共同额度，不能将各包 2 GiB 简单相加超过既有 8 GiB 默认预算。

原资料和候选含业务标识，预览与导出按当前许可检查。复核人字段不提供独立账号证明；单一 owner 完成多个阶段须如实标记。

裁决写入使用预期修订，冲突时保留双方草稿供比较。规范发布先保存意图，再由版本所有者生成完整映射；中断不发布部分规范记录。恢复只核对原意图及摘要，不重复人工决定。

接收映射生成新 ID，外来裁决保留来源类别。拆分、归档和停用都保留受报告引用的历史。升级先保留旧规则与原字节；无法无损迁移时拒绝提交，降级不删除新字段。

## 7. 实施与验收

P0 完成输入、候选计算和约束；P1 完成裁决、取值与规范版本；集成维护完成交接、工作台和独立安装核验。

1. 三模板完成原材料、候选、人工裁决、规范版本及交接，单包独立运行。
2. 相似名称但不同唯一编码的记录被互斥约束阻止合并。
3. A 与 B、B 与 C 匹配但 A 与 C 冲突时，不自动封存整个簇。
4. 空值不按字符串相等自动判同；单位不明的数值不参与数值容差。
5. 分组排除的配对计入未检查范围，独立复核集与拟合阈值资料分别记录。
6. 每个规范字段能追溯原记录；拆分产生新版本并保留历史。
7. 候选爆炸、取消、撤权和磁盘满不产生部分发布，未知资源不提前核销。
8. 篡改字段映射的交接被拒绝；离线核验不执行脚本或连接来源系统。
