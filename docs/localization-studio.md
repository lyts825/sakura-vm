# 本地化交付

本文说明如何整理项目文案、审阅译文并交付语言文件。应用仍为 2.7.0，本包属于 2.8.0 开发中的实验功能。十包整体进度见 [项目状态](../PROJECT_STATUS.md)。

## 启用与首次使用

在插件中心选择 `localization-studio`，保存后重启服务；也可运行：

```powershell
npm run sakura -- pack enable localization-studio
```

本包包含目录、上下文、术语、译文、检查、预览、审阅、版本、交接和工作台，共 10 个插件。无需 VM 或在线模型。默认插件选择保持为空，打开页面只读取已有材料。

在「本地化交付」创建空间，选择「应用文案」「错误消息」或「源文更新」。样例均为合成材料。创建样例只保存固定输入，点击「运行文案检查」才生成检查、组件预览和待审阅记录。

1. 在「目录」上传源语言 JSON，可另行上传已有目标语言目录。
2. 在「上下文与术语」填写使用说明、字符建议及固定术语。
3. 在「译文」选择源文、目标语言和术语，逐键编辑并保存。
4. 在「检查与预览」核对完整检查结果及固定组件窗口。
5. 在「审阅与版本」填写理由，逐项确认缺项和长度建议，再预览本机版本。
6. 批准固定计划后，下载语言文件或待应用补丁，也可交接完整材料。

页面一次发布一种目标语言。领域操作和 CLI 支持一次固定最多 19 种目标语言，加上源语言共 20 种。每种译文须有对应的本机接受记录。

## 目录、占位符和译文修订

目录必须为 UTF-8 JSON 字符串映射，不接受嵌套对象、数组、脚本模块或可执行模板：

```json
{
  "app.title": "Workspace",
  "hello.user": "Hello, {user}"
}
```

键使用 Unicode 字母、数字、下划线或连字符，可用点分层级。键须为 NFC 形式；重复键及非法 Unicode 会拒绝。语言标签按 `Intl.Locale` 固定为规范形式。

占位符支持 `{user}` 这样的标识符，按名称及出现次数比较。复杂复数、额外花括号和 HTML 明确拒绝。不能通过人工接受绕过过期译文、占位符、术语或禁用词错误。

译文固定引用源文修订，并逐键保存源文摘要。源文变化后，使用「核对源文变化」生成新记录，变化项标为过期。重新编辑并显式保存后，才能针对新源文审阅；旧记录仍可查阅。

翻译记忆只记录本空间已经接受且检查通过的本机译文。建议按语言、术语领域、文案键及源文摘要匹配。建议不会自动写入译文，也不会自动获得审阅状态。外来的接受记录不能登记为本机记忆。

## 上下文与预览

上下文固定文案键、说明、使用位置和字符建议。字符检查使用 Unicode 用户感知字符。建议长度超出时保留警告，审阅须明确确认。

截图只接受 PNG/JPEG，单图最多 8 MiB、16,000,000 像素。截图默认禁止导出；若它成为发布材料的引用，导出会继续核对这项许可。

预览使用 320 px、768 px 或 1,280 px 固定组件宽度，可显示实际译文或保留占位符的伪本地化源文。阿拉伯语等目标语言使用从右到左方向。每次最多 100 个组件，可以继续查看下一段。

行数为估计。固定组件不运行用户应用，不加载外链素材或用户样式；字体、布局和交互须在目标应用另行验收。

## 审阅、发布与补丁

审阅保存实际认证主体及固定输入，首版为同一所有者的分阶段审阅。缺项可以在接受后选择「明确回退源文」；选择「拒绝缺失译文」仍会阻止发布。缺项及回退键完整保存在版本中。

预览固定语言集合、文件正文、摘要、回退规则和原活动版本。发布时重新核对输入及原活动版本；期间有另一版本激活时，旧计划拒绝提交。本机发布不写回项目，不改变 Sakura 自身的界面资源。

回退也必须重新预览、核对原材料许可并批准。回退保存新激活记录，保留原版本及前一活动版本。当前活动版本不能归档。

语言补丁包含文件路径、预期原摘要、新摘要和完整正文。已有目标目录的原摘要来自实际上传字节。手工新增的语言文件使用 `create` 操作，要求原路径不存在。补丁保持待应用状态，不由本包直接改写原项目。

应用前须逐文件核对原字节。原文件变更或本应新建的路径已经存在时，应停止应用并重新比较。摘要核对不替代项目自身的测试和审阅。

## CLI、HTTP 与离线交接

在线命令使用已认证的本机服务，参数文件须为 JSON 对象：

```powershell
npm run locale -- help
npm run locale -- catalogs create-workspace create-space.json
npm run locale -- upload <workspaceId> en.json --export
npm run locale -- catalogs import-json catalog-input.json
npm run locale -- translations revise translation-input.json
npm run locale -- workbench run-checks check-input.json
npm run locale -- reviews decide decision.json
npm run locale -- releases preview release-input.json
npm run locale -- releases publish-local approval.json
npm run locale -- language-file release-ref.json zh-CN new-zh-CN.json
npm run locale -- releases make-patch release-input-ref.json
```

固定引用格式为 `{domain,id,revision}`。发布输入包含 `workspaceId/catalog/translations/reviews/fallback`，批准包含 `workspaceId/planId/digest`。`language-file` 只写入指定的新文件，拒绝覆盖已有路径。

HTTP 为 `POST /api/locale-<领域>/<动作>`，动作使用连字符，例如 `import-json` 和 `publish-local`。每个入口都有严格输入、响应及所有者策略。容量、内部记忆登记和保护引用写入不开放 HTTP。

交接格式为 `sakura-localization-studio/1`，使用 ZIP STORE。导出预览核对完整引用图和实际原文导出许可。下载时再次复核原许可。接受会生成新空间和新 ID，导入的审阅、发布及信任声明均只作参考。

```powershell
# 使用编译运行包；不启动宿主或联网。
node scripts/cli.mjs locale verify localization-studio.zip
```

离线核验分别报告字节和对象图完整性、可重算目录、检查、固定组件、语言文件及补丁清单。人工审阅、当前许可、目标应用表现和原项目当前摘要不在自动核验范围内。来源保持未经认证。

## 容量、清理与当前限制

每包 2 GiB，元数据上限 128 MiB，包含 32 MiB 控制预算。单目录 32 MiB、50,000 个键，单值按 UTF-8 最多 16 KiB。检查在有界工作线程执行，当前限 60 秒。语言版本单文件最多 2 MiB、全部语言文件合计 8 MiB；交接包最多 16 MiB。超限会拒绝，保持原材料，不截断检查或交接结果。

目录原文支持分块上传。译文保存还须满足 2 MiB 的 HTTP 控制请求上限；CLI 参数文件最多 1 MiB。较大的整套译文需要后续的分段修订接口，当前不会拆分后静默丢弃条目。

「历史与清理」支持后续分页、保护引用、归档、清理预览和材料暂存取消。未知清理保留原计划，跨代次恢复须重新预览。已被引用的历史不能直接删除。

公共接收中断对账、失败发布引用对账及跨包全局额度仍在开发，详见项目状态。本包暂不计为十包整体完整验收，尚未加入 `complete`。
