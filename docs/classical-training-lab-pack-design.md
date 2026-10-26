# 经典模型训练实验插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `classical-training-lab`，包含 15 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户上传固定表格，在受限工具中训练小规模分类、回归或聚类模型，比较候选，保存预测与误差，再交付可检查的模型材料和适用范围。包内包含真实训练和固定模型推理，注册模型不自动启动在线服务。

[模型评测](model-evaluation-pack-design.md)继续负责模型端点及外来输出的比较；本包负责本地经典算法的训练来源、候选选择和模型产物。特征表可直接上传，不要求特征工程包或其他新包。

## 2. 内部插件与直接依赖

所有服务与方法均为拟议；每个插件唯一拥有自己的领域记录，依赖使用完整 ID。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `ctrain-spaces` 训练空间 | 空间、额度、模板及访问修订；CtrainSpacesV1：create、templates、archive | — | — |
| `ctrain-datasets` 训练材料 | CSV/JSONL 原始字节、列角色和固定样本；CtrainDatasetsV1：upload、pin、inspect | `ctrain-spaces` | — |
| `ctrain-targets` 学习目标 | 任务类型、标签、类别及度量方向；CtrainTargetsV1：define、check | `ctrain-spaces`, `ctrain-datasets` | — |
| `ctrain-partitions` 评估分区 | 训练、验证、测试、实体组和交叉验证成员；CtrainPartitionsV1：define、checkOverlap | `ctrain-spaces`, `ctrain-datasets`, `ctrain-targets` | — |
| `ctrain-estimators` 算法配方 | 固定算法、参数类型、预处理和工具摘要；CtrainEstimatorsV1：configure、validate | `ctrain-spaces`, `ctrain-targets`, `ctrain-partitions` | — |
| `ctrain-searches` 候选搜索 | 有界候选表、选择规则及预算分配；CtrainSearchesV1：expand、freeze | `ctrain-spaces`, `ctrain-estimators`, `ctrain-partitions` | — |
| `ctrain-runs` 训练任务 | 训练意图、原工具票据、模型字节与日志；CtrainRunsV1：preview、start、status、cancel、reconcile | `ctrain-spaces`, `ctrain-datasets`, `ctrain-targets`, `ctrain-partitions`, `ctrain-estimators`, `ctrain-searches` | — |
| `ctrain-predictions` 固定预测 | 模型版本对应的逐行预测、概率及推理票据；CtrainPredictionsV1：predict、read、cancel、reconcile | `ctrain-spaces`, `ctrain-datasets`, `ctrain-partitions`, `ctrain-runs` | — |
| `ctrain-metrics` 评估指标 | 逐分区指标、混淆表、残差和样本缺项；CtrainMetricsV1：calculate、slice | `ctrain-spaces`, `ctrain-datasets`, `ctrain-targets`, `ctrain-partitions`, `ctrain-predictions` | — |
| `ctrain-comparisons` 候选比较 | 固定验证域排序、平局规则及差异；CtrainComparisonsV1：compare、select | `ctrain-spaces`, `ctrain-searches`, `ctrain-runs`, `ctrain-metrics` | — |
| `ctrain-explanations` 模型解释 | 系数、树结构或有限扰动观察；CtrainExplanationsV1：inspect、explain | `ctrain-spaces`, `ctrain-datasets`, `ctrain-runs`, `ctrain-predictions`, `ctrain-metrics` | — |
| `ctrain-registry` 模型登记 | 模型引用、输入约定、预处理及适用域；CtrainRegistryV1：register、seal、compare | `ctrain-spaces`, `ctrain-datasets`, `ctrain-targets`, `ctrain-partitions`, `ctrain-estimators`, `ctrain-runs`, `ctrain-comparisons` | — |
| `ctrain-reports` 训练报告 | 数据/工具/候选摘要、限制与人工接受；CtrainReportsV1：assemble、review、seal | `ctrain-spaces`, `ctrain-datasets`, `ctrain-targets`, `ctrain-partitions`, `ctrain-estimators`, `ctrain-searches`, `ctrain-runs`, `ctrain-predictions`, `ctrain-metrics`, `ctrain-comparisons`, `ctrain-explanations`, `ctrain-registry` | — |
| `ctrain-exchange` 模型交接 | 白名单模型格式、报告封套及隔离映射；CtrainExchangeV1：export、inspectImport、acceptImport | `ctrain-spaces`, `ctrain-datasets`, `ctrain-targets`, `ctrain-partitions`, `ctrain-estimators`, `ctrain-searches`, `ctrain-runs`, `ctrain-predictions`, `ctrain-metrics`, `ctrain-comparisons`, `ctrain-explanations`, `ctrain-registry`, `ctrain-reports` | — |
| `ctrain-workbench` 训练工作台 | 目标配置、候选矩阵、误差与模型导航；CtrainWorkbenchV1：view、templates | `ctrain-spaces`, `ctrain-datasets`, `ctrain-targets`, `ctrain-partitions`, `ctrain-estimators`, `ctrain-searches`, `ctrain-runs`, `ctrain-predictions`, `ctrain-metrics`, `ctrain-comparisons`, `ctrain-explanations`, `ctrain-registry`, `ctrain-reports`, `ctrain-exchange` | — |

训练任务拥有原模型字节，登记服务只保护引用。预测任务另存逐行输出及其来源；登记或报告不得覆盖原训练失败。工具返回成功与模型适用性分别判断。

## 3. 模板与完整流程

| 模板 | 固定任务 | 交付结果 |
| --- | --- | --- |
| 二分类基线 | 逻辑回归及有限深度树候选 | 混淆表、概率、阈值选择记录和模型 |
| 数值回归 | 线性/岭回归及常数基线 | 逐行残差、验证误差和系数 |
| 小型聚类 | 固定 K 值候选与种子 | 簇归属、中心、空簇及稳定性观察 |

1. 上传固定材料，检查列类型、缺失值和标签，选择学习目标。
2. 固定分区、实体约束及评估度量；缺少标签的聚类单独说明评价范围。
3. 选择固定算法及参数，展开全部候选，预览逐候选预算和总截止。
4. 批准训练，按原计划运行；逐候选显示成功、失败、超时及未运行。
5. 对固定验证成员推理，比较指标；选择规则只能使用预先声明的验证域。
6. 冻结选择后运行测试域预测，保留测试被查看的历史，不能重新标成未使用。
7. 审阅误差与解释，登记输入约定、模型和限制，封存报告。
8. 导出白名单模型及选定证据，接收端核验；按保护引用清理失败候选及暂存。

## 4. 学习规则与工具边界

首版只接收有限数值/类别表格，不接收用户 Python、任意模型对象或自定义损失代码。固定算法为常数基线、线性/岭回归、逻辑回归、有限深度分类树和 K 均值聚类；参数范围由版本档案锁定。深度学习、GPU、分布式训练和在线学习均不在首版范围。

拟议宿主接口 `ClassicalTrainingSessionsV1` 首版采用固定原生隔离进程，提供训练、推理、模型检查和原会话核销。进程只接收已准入材料和专属暂存句柄，不能指定任意命令、路径或环境变量。它不创建 VM，因此没有 `projects` 依赖。

实施须证明计算隔离、内存与线程上限、独立截止、无出站网络及可核销的临时文件。固定进程的目录和网络限制不能只依赖工具自律；宿主平台验证未通过时只开放编辑，不能宣布整包实现完成。

拟合预处理只读取对应训练折。验证和测试成员不得参与缺失填充参数、类别词表或特征选择。交叉验证保留逐折训练成员与拟合摘要；分组或时间约束优先于普通随机拆分。

上传的预处理特征保留上游来源类别、配方和拟合证据。缺少完整的上游分区及参数来源时，只能证明本包内的拟合隔离，报告须将端到端泄漏检查标为范围不足；不能把外来特征直接当作已验证的无泄漏输入。

指标保存分母、正类、阈值、缺失处理和分区。未出现某类别时，无法计算的指标显示未定义；空集不产生 0 分或 100% 通过。聚类编号可置换，比较必须使用声明的对应规则。

模型格式限定显式 JSON 数值参数、类别映射和树节点，拒绝 Pickle、动态导入和执行型模型内容。模型大小、节点数、数值有限性及引用无环都须核验。离线登记不会授予执行权限。

## 5. 页面、HTTP 与 CLI

页面包括材料、目标、分区、算法、候选、运行、预测、指标、解释、登记及交接。候选失败原因和样本分母在列表中可见；图表有可下载的数据表，并显示筛选范围。

拟议接口逐方法鉴权，CLI 前缀为 `sakura trainlab`。服务端保存计划及一次消费回执，传输重试先查询原任务。

| 操作 | HTTP POST 路径 | CLI 动作 |
| --- | --- | --- |
| 检查分区 | `/api/ctrain-partitions/checkOverlap` | `partitions check` |
| 展开候选 | `/api/ctrain-searches/expand` | `search expand` |
| 训练计划/执行 | `/api/ctrain-runs/preview`、`/api/ctrain-runs/start` | `run preview/start` |
| 查询/停止/核销 | `/api/ctrain-runs/status`、`/api/ctrain-runs/cancel`、`/api/ctrain-runs/reconcile` | `run status/cancel/reconcile` |
| 固定模型推理 | `/api/ctrain-predictions/predict` | `predict` |
| 比较与登记 | `/api/ctrain-comparisons/compare`、`/api/ctrain-registry/register` | `compare`、`register` |
| 交接 | `/api/ctrain-exchange/export` | `export`、`verify` |

`verify` 只核对材料、模型格式、引用和可重算指标，不启动训练或加载可执行对象。重新推理使用新计划并绑定本地工具。

## 6. 容量、恢复与交接

拟定上限为 50,000 行、256 个输入特征、32 个候选和 5 折；候选展开后的实际训练次数上限为 80。每候选最多 5 分钟、总任务最多 30 分钟；同时最多一个训练任务，工具线程上限为 2。

单包 2 GiB，单模型 32 MiB、全部模型 256 MiB、封套 256 MiB；包内保留 32 MiB 恢复账本。训练副本、预测、日志、接收隔离和导出暂存均计费。额度均为设计目标，现有共同 8 GiB 尚未纳入本包；峰值不足时不得启动。

候选失败不取消已成功候选的证据，但选择报告须列出缺项。控制器退出后原工具独立截止；未知进程、文件或任务不能释放额度。恢复核对原运行及模型摘要，不能以重跑结果覆盖原失败。

仅使用现有 owner 权限。升级需预览模型模式迁移并保留原字节；不支持的新模型可保留为只读材料。导入不携带批准、凭证、注册可用状态或原执行票据；正式登记保护模型及其训练来源。

完整训练定义必须在同一封套中带齐数据、配方及分区。只带模型或缺少原材料时，接收为只读参考档案；重新使用模型须另建本地计划并补全输入约定，不允许跨封套隐式拼接训练任务。

## 7. 实施与验收

先交付数据/分区和工具档案，再实现真实训练、推理、比较与模型格式，最后接通登记、工作台及交接。

1. 三个模板均由真实工具产生模型；同包独立启用即可完成全流程。
2. 固定小数据中，模型参数、预测及指标与人工可核算结果一致。
3. 改变测试集不改变训练参数与候选选择，交叉验证逐折拟合无交叉使用；外来特征缺少上游拟合证据时，端到端泄漏结论保持范围不足。
4. 全空列、缺失正类、单簇、重复实体与样本不足给出明确处理或拒绝。
5. 81 次展开训练在准入前拒绝；候选超时、取消和重启不启动补偿训练。
6. 模型含非有限数、环形树或可执行序列化内容时，导入和推理均拒绝。
7. 测试集查看后保留使用记录，重新选择产生新实验修订而非清除历史。
8. 满盘和清理失败保留原资源责任；离线核验不依赖开发工具且不执行模型内容。
