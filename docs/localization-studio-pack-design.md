# 本地化交付插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；基线 2.7.0 / `912287a`。`localization-studio` 含 10 个拟议插件，实现待开始，共同约定见[第三批总览](plugin-pack-suite-design.md)。

用户导入固定文案，整理上下文和术语，编辑译文、检查占位符，审阅后导出语言版本及待应用补丁。现有宿主繁体资源生成器保持原职责，本包面向用户项目，不自动改写 Sakura 的界面。

首版支持严格 JSON 字符串映射、点分键和明确的 `{name}` 占位符。复杂复数表达式、脚本模块、可执行模板及富 HTML 翻译明确拒绝。预览使用固定布局和伪本地化文本，不运行用户应用。

## 2. 内部插件与依赖

短依赖前缀为 `locale-`，服务和依赖符号遵守总览。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `locale-catalogs` | 空间、语言目录、键和源文修订；LocaleCatalogsV1：importJson、planCapture、capture、compare | — | @files |
| `locale-contexts` | 截图说明、字符建议和使用位置；LocaleContextsV1：attach、inspect | catalogs | — |
| `locale-terminology` | 术语、禁用词和语言适用范围；LocaleTerminologyV1：validate、lookup | catalogs | — |
| `locale-translations` | 固定源文对应译文和来源；LocaleTranslationsV1：revise、suggestFromMemory、markStale | catalogs, contexts, terminology | — |
| `locale-checks` | 键覆盖、占位符、术语和长度检查；LocaleChecksV1：evaluate、explain | catalogs, translations, terminology | — |
| `locale-previews` | 伪本地化、方向和固定组件预览；LocalePreviewsV1：render、compare | catalogs, translations, checks | — |
| `locale-reviews` | 逐项审阅和用途接受；LocaleReviewsV1：open、decide、recheck | checks, previews | — |
| `locale-releases` | 固定语言集合、回退规则及补丁；LocaleReleasesV1：preview、publishLocal、rollback、makePatch | catalogs, translations, checks, reviews | — |
| `locale-exchange` | 目录、术语、审阅及语言包交换；LocaleExchangeV1：export、inspectImport、acceptImport | catalogs, contexts, terminology, translations, checks, previews, reviews, releases | — |
| `locale-workbench` | 文案差异、编辑、检查、发布与交接；LocaleWorkbenchV1：view、templates | * | — |

没有必需的外部插件。材料、译文和发布版本各有唯一所有者；发布服务只引用已固定且已接受的译文，不覆盖翻译草稿。

## 3. 完整用户流程

1. 选择“应用文案”“错误消息”或“源文更新”，导入源语言和已有目标语言目录。
2. 检查重复键、缺失项和不支持的语法，补充上下文与术语。
3. 手工填写译文，或从本空间已接受的翻译记忆中选择建议；建议不会自动成为已审阅内容。
4. 检查占位符及术语，在固定窄屏和方向布局中查看伪本地化与实际译文。
5. 审阅后预览语言版本及明确的缺项回退，发布为本机只读版本。
6. 导出语言文件和基于原摘要的补丁；在原项目中另行审阅并应用，不由本包直接写回。

## 4. 版本与检查语义

译文绑定源文的内容摘要。源文变化后标记 stale，旧译文仍可查阅，但不能无提示进入新发布。键重命名只能生成迁移候选；同文不同键不自动合并。

占位符按标识符集合和出现次数检查，禁止丢失、额外引入及修改参数名。长度规则区分字符数、用户感知字符和固定预览宽度；无法测量的字体情况标为不确定，不能宣称真实应用没有溢出。

术语和翻译记忆绑定语言、领域及来源许可。撤销来源后停止推荐和导出对应原文。人工编辑形成新版本并保留来源关系；删除个人信息不是自动解除旧版本的导出限制。

发布状态为 `draft → checked → reviewed → active → retired`。规则、源文或译文修订变化后，旧接受不适用于新发布。回退也重新核对许可。补丁列出每个文件的原摘要、新摘要和路径，遇到原项目变化时拒绝直接套用。

## 5. 入口、预算与验收

页面包含目录、上下文、术语、译文、检查、预览、审阅和版本。CLI 别名为 `locale`。

| 操作 | 拟议 HTTP | CLI | 输出 |
| --- | --- | --- | --- |
| 导入/比较 | `/api/locale-catalogs/importJson`、`compare` | `locale catalog import/compare` | 固定键、缺项与源文变化 |
| 检查/预览 | `/api/locale-checks/evaluate`、`/api/locale-previews/render` | `locale check`、`locale preview` | 逐键问题与固定布局 |
| 本机发布 | `/api/locale-releases/preview`、`publishLocal` | `locale release preview/publish` | 已审阅语言集合及回退规则 |
| 补丁/交接 | `/api/locale-releases/makePatch`、`/api/locale-exchange/export` | `locale release patch`、`locale export` | 原摘要补丁和证据包 |

拟定 20 种语言、每语言 50,000 个键；单值 16 KiB、单输入目录 32 MiB。上下文截图只接受 PNG/JPEG，单图 8 MiB、16,000,000 像素，禁止 SVG 和外链素材。全部持久与暂存 2 GiB，单导出 256 MiB；每次检查 5 分钟，预览最多 100 个组件。输入与导出均按实际 UTF-8 字节计量，不只限制键数量。

实施顺序为目录及版本、术语与译文、检查与固定预览、审阅发布及交换。预览是有界本地渲染，禁止脚本、外链图片和用户样式执行。

验收必须覆盖三个模板、Unicode 和重复键、占位符漏增、源文更新使审阅失效、术语冲突、双向文字、长字符串、并发译文修订、撤权、原摘要补丁冲突及离线接收后重新审阅。固定组件预览不替代目标应用的浏览器验收。
