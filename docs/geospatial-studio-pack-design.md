# 地理数据工作室插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；当前应用保持 2.8.1，基线为 `4afb3b9a`。包 ID 为 `geospatial-studio`，含 15 个拟议插件，当前分支运行实现待开始。共同规则见[第七批总览](plugin-pack-seventh-design.md)。

用户导入点、线和面资料，明确坐标系与精度，完成空间关系、裁剪和汇总，交付带来源的图层版本、地图及分析档案。首版支持离线矢量资料和本地预览，不依赖在线地图服务。

[数据工作台](data-lab.md)保留通用表格处理，[媒体工作室](media-studio-pack-design.md)保留图像制作。本包增加几何有效性、空间索引、坐标变换、空间连接和计量语义；它不提供导航、地址追踪或实时定位。

## 2. 内部插件与直接依赖

表中接口均为拟议。原资料、派生图层、样式及地图视图分别保存。

| 插件 ID 与名称 | 独立对象、核心功能和服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `geodesk-spaces` 地理空间 | 工作空间、授权和额度；GeodeskSpacesV1：create、configure、close | — | — |
| `geodesk-sources` 地理材料 | 原文件、来源许可和字段档案；GeodeskSourcesV1：upload、inspect、pin | `geodesk-spaces` | — |
| `geodesk-crs` 坐标档案 | 坐标参考、轴顺序、单位及变换版本；GeodeskCrsV1：define、validate、seal | `geodesk-spaces`, `geodesk-sources` | — |
| `geodesk-validation` 几何检查 | 无效坐标、自交、空几何和修复建议；GeodeskValidationV1：preview、check、cancel、reconcile | `geodesk-spaces`, `geodesk-sources`, `geodesk-crs` | — |
| `geodesk-layers` 图层版本 | 固定要素、属性、范围和父版本；GeodeskLayersV1：compose、validate、seal | `geodesk-spaces`, `geodesk-sources`, `geodesk-crs`, `geodesk-validation` | — |
| `geodesk-operations` 几何操作 | 裁剪、相交、缓冲和变换定义；GeodeskOperationsV1：define、preview、seal | `geodesk-spaces`, `geodesk-crs`, `geodesk-layers` | — |
| `geodesk-joins` 空间连接 | 包含、相交、最近邻及多匹配策略；GeodeskJoinsV1：define、validate、seal | `geodesk-spaces`, `geodesk-crs`, `geodesk-layers` | — |
| `geodesk-indexes` 空间索引 | 图层固定版本的索引及覆盖账本；GeodeskIndexesV1：build、inspect、cancel、reconcile | `geodesk-spaces`, `geodesk-layers` | — |
| `geodesk-runs` 空间计算 | 固定工具任务、派生图层和逐要素错误；GeodeskRunsV1：preview、run、cancel、reconcile | `geodesk-spaces`, `geodesk-crs`, `geodesk-validation`, `geodesk-layers`, `geodesk-operations`, `geodesk-joins`, `geodesk-indexes` | — |
| `geodesk-measures` 地理计量 | 距离、长度、面积及分组汇总；GeodeskMeasuresV1：define、calculate、compare | `geodesk-spaces`, `geodesk-crs`, `geodesk-layers`, `geodesk-runs` | — |
| `geodesk-styles` 地图样式 | 分类色、标注、图例和显示精度；GeodeskStylesV1：define、preview、seal | `geodesk-spaces`, `geodesk-layers`, `geodesk-measures` | — |
| `geodesk-reviews` 地图复核 | 修复选择、缺失区域和用途限制决定；GeodeskReviewsV1：prepare、decide、seal | `geodesk-spaces`, `geodesk-validation`, `geodesk-layers`, `geodesk-runs`, `geodesk-measures`, `geodesk-styles` | — |
| `geodesk-reports` 地理档案 | 输入输出、地图视图及计量依据；GeodeskReportsV1：assemble、seal | `geodesk-spaces`, `geodesk-layers`, `geodesk-runs`, `geodesk-measures`, `geodesk-styles`, `geodesk-reviews` | — |
| `geodesk-exchange` 图层交接 | 图层、坐标档案和地图报告交换；GeodeskExchangeV1：export、inspectImport、acceptImport | `geodesk-spaces`, `geodesk-sources`, `geodesk-crs`, `geodesk-validation`, `geodesk-layers`, `geodesk-operations`, `geodesk-joins`, `geodesk-indexes`, `geodesk-runs`, `geodesk-measures`, `geodesk-styles`, `geodesk-reviews`, `geodesk-reports` | — |
| `geodesk-workbench` 地理工作台 | 图层树、地图、属性表和保存视图；GeodeskWorkbenchV1：view、saveView、templates | `geodesk-spaces`, `geodesk-sources`, `geodesk-crs`, `geodesk-validation`, `geodesk-layers`, `geodesk-operations`, `geodesk-joins`, `geodesk-indexes`, `geodesk-runs`, `geodesk-measures`, `geodesk-styles`, `geodesk-reviews`, `geodesk-reports`, `geodesk-exchange` | — |

## 3. 模板与完整流程

| 模板 | 输入和重点 | 完成交付 |
| --- | --- | --- |
| 区域设施汇总 | 合成设施点及区域面 | 区域数量、边界点和未匹配项 |
| 路网裁剪 | 线图层、目标区域和计量方法 | 裁剪结果及长度变化 |
| 多源图层整理 | 不同坐标档案的本地矢量资料 | 统一图层、变换记录及质量报告 |

1. 上传 GeoJSON 或含明确坐标列的 CSV，登记来源及使用许可。
2. 指定坐标档案、轴顺序和单位，检查范围和缺失值。
3. 检查几何；查看原图与修复候选，显式选定修复规则。
4. 冻结输入图层，建立有界索引，编辑空间操作和连接策略。
5. 预览目标图层、输出规模及计量方法，执行后检查逐要素错误。
6. 计算汇总，配置图例与标注；地图保留未匹配和不支持范围。
7. 复核用途与几何修复，封存图层和地图报告。
8. 导出所选图层、样式及坐标档案，接收端隔离核验后重新建立本地索引。

## 4. 几何、坐标与结果语义

首版处理二维点、折线、多边形及其多要素类型。高程和测量值可作为普通属性保留，不参与二维计算。未知几何、栅格、曲线或动态坐标系显示不支持，不转换成看似正常的平面图。

输入必须明确坐标参考、轴顺序及单位。GeoJSON 按所支持档案解析，CSV 不凭列名猜测坐标系。两层坐标不相容时先建立显式变换，缺少所需变换资料则拒绝计算。

几何修复会产生新图层，保留原几何、算法与改变的要素。自交或无效环不能静默修复后覆盖原输入。小数精度、容差和网格吸附均进入定义摘要。

空间连接明确边界点行为及一对多规则。最近邻同时给出距离、计量方式和搜索半径；范围内没有结果时返回未匹配，不将范围外对象当作最近结果。

平面与地表距离、面积分别标记，单位和所用模型进入报告。地图投影显示和计量计算分开配置；视觉上重合不能证明空间关系或精度相同。跨日期变更线的几何要单独检测，未支持的运算明确拒绝。

拟议 `VectorGeometryComputeV1` 提供固定解析器、有限变换和几何算子。实施须固定工具与资料摘要，验证复杂几何的时间/内存上限、取消及暂存清理。导入文件中的脚本、远程 URL 和样式资源不执行、不自动请求。

## 5. 页面、HTTP 与 CLI

页面提供地图与属性表双视图、坐标读数、误差面板、操作计划和结果比较。离线背景仅用网格与用户许可的资料；没有底图时仍可完成全部流程。地图提供键盘及表格替代。

下表均为拟议 POST，CLI 前缀为 `sakura geo-desk`。

| 服务方法 | HTTP 路径 | CLI 子命令 |
| --- | --- | --- |
| Crs.validate | `/api/geodesk-crs/validate` | `crs validate` |
| Validation.check | `/api/geodesk-validation/check` | `geometry check` |
| Layers.seal | `/api/geodesk-layers/seal` | `layer seal` |
| Runs.preview/run | `/api/geodesk-runs/preview`、`/api/geodesk-runs/run` | `run preview`、`run start` |
| Measures.calculate | `/api/geodesk-measures/calculate` | `measure calculate` |
| Exchange.export/acceptImport | `/api/geodesk-exchange/export`、`/api/geodesk-exchange/acceptImport` | `export`、`import accept` |

材料走有界上传、分段读取；所有路由声明 owner 与空间策略。CLI 提供原状态、等待、取消、恢复和离线 `verify`，导出不触发网络地图发布。

## 6. 容量、权限与恢复

拟定单文件 128 MiB、每空间 50 层，单层最多 100,000 个要素、合计 200 万个顶点；单要素 100,000 个顶点。单次输出 128 MiB、计算 5 分钟；缓冲或相交的输出放大必须计入计划和实时额度。

包总额 2 GiB，含 32 MiB 恢复账本、索引、修复候选、派生图层及隔离接收；封套最多 256 MiB。实施须接入宿主既有 8 GiB 共同额度，按实际暂存及预留核销，不把索引当作免费缓存。

来源许可与坐标精度参与导出预览。精确位置不因缩略图而自动公开；按当前空间授权读写，复核人和图层作者标签不授予账户权限。

取消后等待原计算退出，未确认索引或暂存继续计费。中断仅核对原运行和固定输入；不自动把部分几何发布为完整图层。磁盘满保留原输入、意图与恢复账本。

接收端重建本地索引，旧路径、缓存和活动任务不导入生效。升级算子会产生新结果，旧结果保留旧工具摘要；模式升级失败保留原字节。归档不删除受图层或地图引用的原资料。

## 7. 实施与验收

P0 完成有界解析、坐标档案、几何工具和引用账本；P1 完成连接、计量和地图复核；集成维护验证安装态与离线交接。

1. 三个模板在无网络、无在线底图条件下完成全部流程。
2. 轴顺序或单位不明时拒绝空间运算；不相容坐标须先显式变换。
3. 自交面修复产生新版本，原几何和差异均保留。
4. 边界点、一对多与零匹配符合固定策略，不丢弃未匹配行。
5. 平面与地表计量保留不同方法标签，最近邻不越过指定搜索半径。
6. 巨大顶点数、恶意嵌套和输出放大均有界拒绝，远程样式不联网。
7. 取消、撤权、旧修订和磁盘满不发布半份图层，未知索引不提前核销。
8. 篡改坐标档案或缺失图层的封套被拒绝；接收不恢复旧执行权限。
