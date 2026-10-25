# 离线分发与接收插件包设计

## 1. 版本与用户结果

设计版本 5.0.0，日期 2026-10-25；应用基线 2.7.0 / `5726601`。包 ID 为 `offline-distribution`，含 13 个拟议插件，运行实现待开始。共同规则见[第五批总览](plugin-pack-specialist-design.md)。

用户把镜像、制品、文档及依赖材料组织成固定离线集合，按目标平台解析缺项，制作分卷或增量材料，在接收端核验并入库。交付物包括完整清单、分卷、依赖解析和接收回执。

[离线缓存](package-cache.md)、[工坊](foundry-workbench.md)和[运行包更新](self-update.md)继续负责下载、制作及安装。本包负责运输准备与接收，接收成功不表示已安装、已激活或发布到外部仓库。

## 2. 内部插件与直接依赖

短名统一补上 `offdist-`；所有服务均为拟议接口。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `offdist-materials` 材料仓 | 根账本、固定字节与来源许可；OffdistMaterialsV1：upload、pin、readChunks | — | @delivery-artifacts |
| `offdist-catalogs` 材料目录 | 类型、版本、平台及依赖声明；OffdistCatalogsV1：register、validate | materials | — |
| `offdist-targets` 接收目标 | 平台、已有摘要、容量与接收要求；OffdistTargetsV1：define、inspectInventory | materials | — |
| `offdist-selections` 分发集合 | 用户选定内容和必需/可选材料；OffdistSelectionsV1：compose、seal | materials, catalogs | — |
| `offdist-resolutions` 依赖解析 | 精确闭包、冲突、缺项及目标适配；OffdistResolutionsV1：resolve、explain | materials, catalogs, targets, selections | — |
| `offdist-baselines` 接收基线 | 原接收清单及增量前置摘要；OffdistBaselinesV1：importInventory、compare | materials, catalogs, targets | — |
| `offdist-kits` 固定分发清单 | 完整集合摘要、增量引用和封存版本；OffdistKitsV1：preview、seal | materials, catalogs, targets, selections, resolutions, baselines | — |
| `offdist-volumes` 分卷制作 | 有界分卷任务、卷清单和校验结果；OffdistVolumesV1：preview、build、cancel、reconcile | materials, kits | — |
| `offdist-receipts` 接收事务 | 接收暂存、重组、接受及来源映射；OffdistReceiptsV1：inspect、stageVolume、previewAccept、accept、reconcile | materials, catalogs, targets, baselines, kits, volumes | — |
| `offdist-updates` 后续分发 | 基线到目标集合的差量计划；OffdistUpdatesV1：propose、checkPrerequisites | materials, catalogs, targets, selections, resolutions, baselines, kits, receipts | — |
| `offdist-reports` 分发报告 | 缺项、卷覆盖、接收和未安装说明；OffdistReportsV1：assemble、seal | materials, resolutions, kits, volumes, receipts, updates | — |
| `offdist-exchange` 元数据交接 | 目录和报告封套及离线核验；OffdistExchangeV1：export、inspectImport、acceptImport | * | — |
| `offdist-workbench` 离线分发台 | 集合编辑、缺项、卷进度和接收导航；OffdistWorkbenchV1：view、templates | * | — |

materials 唯一持有本包材料字节；volumes 拥有运输副本，receipts 拥有隔离接收事务。去重不转移原所有者的引用责任。exchange 只交换有界元数据，大载荷走 volumes 的分卷格式。

## 3. 完整使用流程

1. 选择“离线开发环境”“演示交付”或“受限网络更新”模板，导入固定材料。
2. 填写类型、版本、平台及精确依赖；声明来源和允许交接范围。
3. 指定接收端平台及容量，选择完整集合或原基线增量。
4. 解析全部依赖，展示缺项、冲突及已有材料的可验证摘要；缺项未补齐不能封存为完整集合。
5. 预览固定清单、卷大小、总量和暂存峰值，生成分卷及逐卷摘要。
6. 由用户传送分卷；接收端分次提交卷，核验并重组到隔离空间。
7. 查看完整对象图和增量前置，显式接受到本包材料仓，生成接收回执。
8. 导出接收清单供下一次增量使用；保留所需材料，清理已无用途且无人引用的运输副本。

## 4. 分卷、增量与信任

`KitManifest` 固定每项逻辑身份、长度、摘要、依赖和适用平台。首版只支持精确版本声明，不求解任意包管理器的版本范围，也不推断安装脚本的动态依赖。声称完整仅限已声明并验证的材料闭包。

依赖解析拒绝环、相同材料身份对应不同摘要及平台冲突，报告完整路径。可选材料未选择时保留排除声明，不自动纳入分卷。用户变更集合后须重新解析和封存。

大载荷格式拟定为 `sakura-offline-volumes/1`：一个有界清单和若干原始数据卷。每卷固定长度、摘要及所属集合摘要；映射表声明材料的偏移和长度，接收端按字节范围重组，拒绝重叠、越界、缺口和重复冲突。磁盘路径由接收端生成，不采用清单中的任意路径。

拟议 `OfflineVolumeStoreV1` 提供流式写入、固定偏移读取及接收事务。现有交接 16 MiB 的边界不能作为大载荷能力证据。首版无压缩、无可执行自解压程序、无自动扫描移动介质，也不新增加密格式。

增量采用“完整目标清单 + 已有材料摘要引用 + 新材料卷”，不使用二进制补丁。接收端必须逐项验证基线字节仍在且摘要一致；缺失则请求完整对应材料，不能仅凭旧回执判定已有。旧文件同名不能满足摘要前置。

接受结果为 accepted、rejected 或 interrupted，传输成功与材料入库分别显示。同一事务重试返回原接收回执；同摘要不同声明仍保留各自来源和许可。来源签名未配置时保持未认证，摘要校验只证明完整性。

删除旧材料只形成后续清理建议，不随增量接受执行。安装、启用或改变原应用版本须进入原领域的新计划。本包不执行包内钩子或安装命令。

## 5. 页面、HTTP 与 CLI

页面包括材料、目录、目标、集合、依赖、清单、分卷、接收、增量和报告。CLI 别名为 `offdist`。

| 操作 | 拟议 POST 路径 | CLI（前缀 sakura） |
| --- | --- | --- |
| 依赖解析 | `/api/offdist-resolutions/resolve` | `offdist resolve` |
| 封存集合 | `/api/offdist-kits/preview`、`/api/offdist-kits/seal` | `offdist kit preview/seal` |
| 制作分卷 | `/api/offdist-volumes/build` | `offdist volume build` |
| 接收审阅/接受 | `/api/offdist-receipts/previewAccept`、`/api/offdist-receipts/accept` | `offdist receive preview/accept` |
| 增量建议 | `/api/offdist-updates/propose` | `offdist update propose` |
| 报告交接 | `/api/offdist-exchange/export` | `offdist export`、`offdist verify` |

卷上传另设严格二进制路由，不用 JSON 承载整个卷。离线 verify 同时支持元数据封套和指定卷集合，只读用户指定文件，不寻找或执行安装器。

## 6. 容量、异常与恢复

拟定上限：每集合 10,000 项、依赖深度 64、清单 8 MiB；单卷 256 MiB、最多 128 卷，总载荷 32 GiB；包总额 64 GiB，普通元数据封套 64 MiB。所有值受宿主共同总额约束，默认 8 GiB 配置不会自动扩大。

预览计入原材料、运输副本、接收暂存和重组峰值；磁盘不足先拒绝。断点续传只接受同集合、同卷摘要和已验证偏移，不信任客户端“已完成字节数”。损坏卷隔离，不发布部分目标集合。接收待确认持续保护基线，清理不能删除它。

## 7. 实施与验收

先完成目录、目标及依赖，再实现有界分卷和接收事务，最后完成增量与工作台。

1. 三种模板均完成完整集合及一次增量接收，材料逐字节一致。
2. 缺卷、损坏卷、越界映射、冲突重复和错误基线均拒绝接受。
3. 在大于 16 MiB 的真实载荷上验证流式内存边界、中断续传及峰值计费。
4. 原基线已删除或内容改变时，增量要求补齐，不误认完成。
5. 接收中断重复提交只产生一个事务结果，部分对象图不开放读取。
6. 导入含安装命令的材料不执行，接收状态不显示已安装或已发布。
7. 同机独立目录与跨物理设备分别记录验收；未实测的传输方式不能宣称支持。
