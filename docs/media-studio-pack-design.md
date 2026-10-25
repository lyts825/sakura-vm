# 媒体资源制作插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；设计基线 2.7.0 / `912287a`。`media-studio` 的 9 个插件已在 2.8.0 实施，并完成真实 FFmpeg、服务代理、字幕集合、审核交接及撤权清理验证。实际入口、限制和验证边界见[媒体资源制作使用说明](media-studio.md)。共同边界见[第三批总览](plugin-pack-suite-design.md)。下文保留原设计；容量、依赖和服务方法以使用说明及已生成契约为准。

用户把本地图片、音视频和字幕变成尺寸明确、格式固定、可审阅的交付资源。已有[桌面录制](desktop-recording.md)继续负责捕获；本包处理用户选择的文件，记录来源、配方和派生关系，不读取摄像头、麦克风或实时桌面。

首版拟定输入 PNG、JPEG、WebP、WAV 和受支持 MP4 档案，输出缩放/裁切图片、缩略图、音量规范化音频、定长片段和字幕文件。实际编解码档案须在准备时探测；未知编码明确拒绝。没有生成式图片、自动配音或自动字幕识别。

## 2. 内部插件与依赖

短依赖前缀为 `media-`。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `media-sources` | 原始字节、许可、容量与保护引用；MediaSourcesV1：upload、planCapture、capture、pin | — | @files |
| `media-inspect` | 固定探测工具和媒体事实；MediaInspectV1：preview、inspect、cancel、reconcile | sources, @projects | — |
| `media-recipes` | 尺寸、裁切、时间、音量和编码档案；MediaRecipesV1：validate、compile | inspect | — |
| `media-workers` | 专用执行副本、转换任务和派生字节；MediaWorkersV1：preview、start、cancel、reconcile | sources, inspect, recipes, @projects | — |
| `media-captions` | 手工字幕、语言与时间对齐；MediaCaptionsV1：importText、validateTiming、exportText | sources | — |
| `media-collections` | 资源集合、命名规则和版本映射；MediaCollectionsV1：assemble、compare | sources, workers, captions | — |
| `media-reviews` | 预览、质量检查和人工接受；MediaReviewsV1：open、decide、recheck | collections, inspect | — |
| `media-exchange` | 资源、配方、字幕和制作证明；MediaExchangeV1：export、inspectImport、acceptImport | sources, inspect, recipes, workers, captions, collections, reviews | — |
| `media-workbench` | 批处理、前后比较、版本与交接；MediaWorkbenchV1：view、templates | * | — |

sources 管理材料容量与运行名额，inspect 与 workers 各自持有原执行回执。探测副本不能通过猜测 ID 转交给转换任务。导出从所属服务取得固定读租约，不遍历宿主目录。

## 3. 完整用户流程

1. 选择“多尺寸图片”“演示视频片段”或“音频与手工字幕”，上传明确文件并审阅许可。
2. 显式选择预备镜像，执行有界探测；查看真实尺寸、帧率、时长、编码、方向和元数据。
3. 编辑固定配方与输出命名，预览完整文件映射、覆盖规则、资源和派生体积预算。
4. 确认后执行转换，分别记录每项输入、工具、参数、退出与输出核验。
5. 手工编辑字幕，检查时间范围、重叠和阅读预览；审阅实际输出后封存集合。
6. 导出选定资源及可复核制作记录，核销执行副本；原材料保持不变。

## 4. 处理与发布规则

媒体解析与解码属于不可信输入处理，均通过拟议 MediaTasksV1 在专用 VM 内执行。宿主只处理有界控制记录及已经验证的输出。不接受用户命令、工具路径、过滤表达式、外部 URL 或脚本型素材。

配方采用严格操作树：顺序明确、参数有界、工具端固定映射。尺寸、方向、颜色转换和时间舍入都写入版本化规则；不能仅凭文件扩展名判断编码。输出重新探测，检查格式、尺寸、时长和字节预算，验证后才发布。

单项状态为 `planned → processing → verified → published`。失败输出只在隔离区可见，不能加入正式集合。取消后的临时文件按原回执清理；其他已完成项目保留成功状态，不伪造批次全成功。

字幕采用固定文本和毫秒时间，不执行标签或外部资源。去除元数据、脱敏图层和裁切均产生新派生版本，不能承诺消除所有隐私信息。人工许可声明只作为来源记录，不代表系统完成版权认证。

## 5. 入口和预算

页面包含材料、探测、配方、任务、字幕、集合与交接；CLI 别名 `media`。

| 操作 | 拟议 HTTP | CLI | 输出 |
| --- | --- | --- | --- |
| 探测 | `/api/media-inspect/preview`、`inspect` | `media inspect preview/run` | 固定来源、工具及真实媒体事实 |
| 转换 | `/api/media-workers/preview`、`start` | `media job preview/start` | 输入输出映射、预算、原任务 |
| 字幕与集合 | `/api/media-captions/validateTiming`、`/api/media-collections/assemble` | `media caption validate`、`media collection assemble` | 时间错误和固定集合 |
| 审阅/导出 | `/api/media-reviews/decide`、`/api/media-exchange/export` | `media review decide`、`media export` | 接受修订和实际资源 |

原设计拟定单图片 20 MiB、解码后 40,000,000 像素；每批 200 张。单音视频 256 MiB、10 分钟；视频最多 30 帧/秒、18,000 帧、单帧 1920 × 1080。解码逐帧流式处理，不将全片放入内存。单任务 15 分钟，每包最多两台 2 vCPU / 2 GiB VM，每台虚拟磁盘 16 GiB。总存储 64 GiB，单导出 2 GiB。实施已收紧这些上限，实际以[使用说明的容量表](media-studio.md#实际容量)为准。

当前 FilesV2 捕获仍受 32 MiB 总量限制，大文件使用显式上传。图片、视频与导出同时占用包和宿主额度；预算不足时不启动转换。

## 6. 实施与验收

先实现材料、配方与字幕纯校验，再通过探测/解码隔离门禁，最后完成转换、审阅、交接和清理。安装包必须随附准确工具及许可清单；工具准备单独由用户确认，执行中不下载编码器。

必须实测三个模板、方向与颜色保留、精确片段边界、字幕时长、批次部分失败、损坏或超大解码输入、输出目录逃逸、取消与全部子进程退出、重启后的未发布输出、配额耗尽和离线复核。工具退出码为 0 但输出损坏时，任务必须失败。
