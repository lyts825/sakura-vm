# 文档结构提取插件包设计

## 1. 版本与用户结果

设计系列 6.0.0 → 7.0.0，日期 2026-10-26；应用保持 2.8.1，核对基线为 `4afb3b9a`。包 ID 为 `document-extraction-studio`，包含 14 个拟议插件，运行实现待开始。共同约定见[第七批总览](plugin-pack-seventh-design.md)。

用户从 PDF 和页面图像提取文本、表格及指定字段，核对页内位置，修订低置信结果，再交付可追溯的结构化数据。首版提供本地文本层解析和固定光学字符识别（OCR）工具，支持人工纠错及独立复核。

第六批文档格式兼容包负责格式转换与保真比较；本包负责源页到文本、单元格及字段的证据映射。[数据标注](annotation-studio-pack-design.md)仍负责通用标注任务；提取流程无需启用该包。

## 2. 内部插件与直接依赖

以下为拟议服务与方法。原件、页图、识别结果及修订数据分别由表中唯一所有者管理，引用不转移存储责任。

| 插件 ID 与名称 | 自有对象、功能和主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `dextract-spaces` 提取空间 | 空间、额度、模板与访问修订；DextractSpacesV1：create、templates、archive | — | — |
| `dextract-sources` 原文材料 | PDF/PNG/JPEG 原字节、许可和摘要；DextractSourcesV1：upload、pin、inspect | `dextract-spaces` | — |
| `dextract-pages` 页面拆解 | 页索引、尺寸、旋转、文本层与页图字节；DextractPagesV1：prepare、status、cancel、reconcile | `dextract-spaces`, `dextract-sources` | — |
| `dextract-layouts` 版面区域 | 段落、标题、表格候选与阅读顺序；DextractLayoutsV1：detect、edit、validate | `dextract-spaces`, `dextract-pages` | — |
| `dextract-ocr` 字符识别 | 固定语言模型、区域识别任务和字符位置；DextractOcrV1：preview、start、status、cancel、reconcile | `dextract-spaces`, `dextract-pages`, `dextract-layouts` | — |
| `dextract-tables` 表格重建 | 行列、合并单元格、跨页候选与来源框；DextractTablesV1：reconstruct、edit、check | `dextract-spaces`, `dextract-pages`, `dextract-layouts`, `dextract-ocr` | — |
| `dextract-schemas` 字段约定 | 字段名、类型、必填及有限提取规则；DextractSchemasV1：define、validate | `dextract-spaces` | — |
| `dextract-fields` 字段提取 | 字段候选、标准值、来源片段及歧义；DextractFieldsV1：extract、explain | `dextract-spaces`, `dextract-pages`, `dextract-layouts`, `dextract-ocr`, `dextract-tables`, `dextract-schemas` | — |
| `dextract-checks` 结果检查 | 缺项、类型、总和约束与重复候选发现；DextractChecksV1：evaluate、listFindings | `dextract-spaces`, `dextract-tables`, `dextract-schemas`, `dextract-fields` | — |
| `dextract-corrections` 人工纠错 | 原值、修订值、原因、页内证据及编辑历史；DextractCorrectionsV1：propose、apply、compare | `dextract-spaces`, `dextract-pages`, `dextract-ocr`, `dextract-tables`, `dextract-fields`, `dextract-checks` | — |
| `dextract-datasets` 数据版本 | 按固定纠错修订组装的文本、表格及字段结果；DextractDatasetsV1：assemble、seal、read | `dextract-spaces`, `dextract-sources`, `dextract-pages`, `dextract-layouts`, `dextract-ocr`, `dextract-tables`, `dextract-schemas`, `dextract-fields`, `dextract-checks`, `dextract-corrections` | — |
| `dextract-reviews` 提取复核 | 页覆盖、抽检范围、人工决定与未决项；DextractReviewsV1：review、decide | `dextract-spaces`, `dextract-datasets`, `dextract-checks`, `dextract-corrections` | — |
| `dextract-exchange` 提取交接 | 原件选择、结构数据与映射封套；DextractExchangeV1：export、inspectImport、acceptImport | `dextract-spaces`, `dextract-sources`, `dextract-pages`, `dextract-layouts`, `dextract-ocr`, `dextract-tables`, `dextract-schemas`, `dextract-fields`, `dextract-checks`, `dextract-corrections`, `dextract-datasets`, `dextract-reviews` | — |
| `dextract-workbench` 提取工作台 | 源页/结果对照、区域编辑与复核导航；DextractWorkbenchV1：view、templates | `dextract-spaces`, `dextract-sources`, `dextract-pages`, `dextract-layouts`, `dextract-ocr`, `dextract-tables`, `dextract-schemas`, `dextract-fields`, `dextract-checks`, `dextract-corrections`, `dextract-datasets`, `dextract-reviews`, `dextract-exchange` | — |

纠错记录追加新修订，原识别输出保持不变。数据版本发布时检查纠错后的规则，并保存该次检查；不能复用原值通过的检查覆盖新值。

## 3. 模板与完整流程

| 模板 | 输入 | 输出 |
| --- | --- | --- |
| 文本资料提取 | 含文本层或扫描页的 PDF | 按页文本、阅读顺序及来源坐标 |
| 表格资料整理 | 单页或跨页规则表格 | 单元格表、合并关系和缺失提示 |
| 固定字段登记 | 具有重复版式的表单图像 | 类型化字段、原片段及人工纠错历史 |

1. 上传原件，检查真实文件类型、页数、尺寸、加密状态及来源许可。
2. 固定页范围和解析工具，生成页图、文本层和坐标映射。
3. 选择识别语言及区域，编辑阅读顺序；预览全部页数、像素和资源预算。
4. 批准固定 OCR 任务，逐页显示原始输出和失败，不跳过未识别页。
5. 重建表格或提取字段，检查缺项、歧义及声明的关系约束。
6. 对照源页纠错，记录原值和理由；复核页面覆盖与仍需人工判断的项。
7. 发布固定数据版本，导出 JSONL、CSV 和页内来源映射。
8. 接收端核验原件摘要及映射；原件未随包导出时明确不可复查的范围。

## 4. 提取规则与工具边界

首版只支持 PDF、PNG 和 JPEG，不加载外链、脚本、嵌入附件或宏。加密 PDF 无法合法解密时给出不支持，不能绕过密码。文件后缀不作为解析依据；页尺寸、像素、对象深度和解码输出均有独立上限。

拟议宿主接口 `DocumentExtractionSessionsV1` 首版使用固定原生隔离进程，运行 PDF 解析、栅格化和 OCR 工具。输入只来自已准入材料句柄，输出只写专属暂存，不创建 VM。工具清单固定版本、语言模型摘要及支持平台。

实施须以宿主外部限制证明无网络、无宿主任意目录访问、独立截止与所有解码子进程核销。固定工具名本身不构成恶意文档沙箱；未通过隔离验证的平台拒绝解析，不降级为普通宿主进程。

页坐标固定原始页 ID、旋转及变换矩阵；字符、单元格和字段均引用固定页版本。旋转、裁剪和缩放后的坐标必须可逆映射，不能用预览缩略图坐标代替原页坐标。

文本层、OCR 文本和人工修订分别保存。置信分值只保留工具语义及版本，不解释为无误概率。手写、复杂公式、非支持语言与多栏顺序歧义显示需人工复核，不自动补写缺字。

字段提取只采用固定锚点、区域、有限模式和类型转换规则。数值保存原字符串、标准值、单位和格式约定；日期歧义要求规则或人工决定。表格的空白、识别缺失与合并延续使用不同状态。

## 5. 页面、HTTP 与 CLI

工作台提供源页与结果并排视图、区域选择、阅读顺序列表、单元格编辑、字段来源跳转及逐页复核。明暗主题和窄屏保持原图颜色，识别高亮不能修改原始像素。

拟议 HTTP 为逐方法鉴权 POST，CLI 前缀为 `sakura extractdoc`。原件与页图通过有界二进制租约读取，不塞入控制 JSON。

| 操作 | HTTP POST 路径 | CLI 动作 |
| --- | --- | --- |
| 页面准备 | `/api/dextract-pages/prepare` | `pages prepare` |
| OCR 计划/执行 | `/api/dextract-ocr/preview`、`/api/dextract-ocr/start` | `ocr preview/start` |
| 查询/停止/核销 | `/api/dextract-ocr/status`、`/api/dextract-ocr/cancel`、`/api/dextract-ocr/reconcile` | `ocr status/cancel/reconcile` |
| 表格与字段 | `/api/dextract-tables/reconstruct`、`/api/dextract-fields/extract` | `tables reconstruct`、`fields extract` |
| 纠错与发布 | `/api/dextract-corrections/apply`、`/api/dextract-datasets/seal` | `corrections apply`、`dataset seal` |
| 交接 | `/api/dextract-exchange/export` | `export`、`verify` |

离线 `verify` 核对字节、页引用、坐标范围及声明约束，不重新执行 PDF/OCR 工具。源页缺席时，内容正确性保持未复查。

## 6. 容量、恢复与交接

设计上限为每文档 200 页、原件 128 MiB、单页 40 百万像素、单批 1,000 百万像素。单次 OCR 最多 20 分钟、同时一个任务；字符输出 16 MiB、表格 100,000 个单元格、固定字段 1,000 个。

单包 2 GiB，封套 256 MiB，控制账本保留 32 MiB。页图、解码暂存、识别结果、纠错版本及导出副本都计费；原件大小不能替代解码峰值。数值待实施实测，接入共同额度前不可借用现有 8 GiB 作为能力保证。

页失败保留原页及失败原因，其余页可形成明确的部分结果。取消、损坏输入、满盘及控制器退出后，核对原工具票据和暂存；未完成页不能标为无文本或识别成功。恢复不重放已消耗批准。

仅现有 owner 可读取原件与结果。锁定清除页图缓存与临时链接。升级先保存页坐标模式及原字节，迁移失败不改旧映射；导出预览逐项列出原件、派生数据和可能含原文的片段。

完整可执行定义必须在同一封套中带齐原件、页范围和提取规则。未携带原件或缺少引用时只接受只读参考档案；不允许跨封套隐式拼接材料后启动工具。

## 7. 实施与验收

先完成受限解码、坐标与页账本，再接入真实 OCR 和结构提取，最后实现纠错、数据版本、工作台及交接。

1. 三个模板均经真实工具完成，输出字段可跳转到固定原页位置。
2. 旋转、裁剪和缩放后，四角与文字框均映射到正确源坐标。
3. 空白页、损坏页、密码保护页和工具不支持语言分别显示真实状态。
4. 原识别错误经纠正后保留原值和修订者身份，重新检查修订结果。
5. 合并单元格、跨页候选、空值和缺失识别不会静默合并成同一语义。
6. 伪造页摘要、越界坐标或引用不存在的单元格时，接收核验拒绝。
7. 解码膨胀、超大像素、取消与满盘不突破额度，原进程退出后才核销。
8. 仅启用本包可完成导入到结构数据交付；未携带原件的封套明确限制复查范围。
