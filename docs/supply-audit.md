# 软件供应审查

本文面向使用供应审查工作台的维护者。应用版本仍为 2.7.0，2.8.0 正在开发。本包已接入 10 个插件；十包整体交付仍在进行，进度见 [项目状态](../PROJECT_STATUS.md)。

## 启用与首次使用

在「插件中心」选择 `supply-audit`，保存后重新启动服务。也可运行：

```powershell
npm run sakura -- pack enable supply-audit
```

启用本包会加载材料、清单、公告、许可、来源、门槛、审阅、报告、交接和工作台。默认选择仍为空。打开页面只读取已有空间；创建样例和运行检查都需要点击对应按钮。本包无需 VM，不安装依赖或执行包脚本。

选择「软件供应审查」，输入空间名称和起点。三个合成模板分别演示 npm 锁文件、Python 固定依赖和公告更新。样例中的问题、组件与来源均为虚构。

1. 在「材料」上传依赖文件和公告快照，明确原文导出许可。
2. 在「审查」选择固定输入，保存并封存门槛，再运行检查。
3. 在「审阅与报告」逐项处理问题。接受例外必须填写理由和到期时间，期限最多 30 天。
4. 封存报告。在「离线交接」选择报告，核对完整范围后批准导出。

同一所有者的多个步骤会记录为分阶段审阅。服务端记录实际主体，页面中的审阅标签不构成新的账号角色。

## 支持的材料

| 材料 | 首版范围 | 判定边界 |
| --- | --- | --- |
| npm 锁文件 | `lockfileVersion` 为数字 2 或 3，使用 `packages` | 保存直接关系、安装位置和缺项；peer 关系不计入完整覆盖 |
| Python 清单 | 每行 `name==version --hash=sha256:<64 位十六进制>` | 依赖图、许可证和版本范围覆盖保持未知 |
| 组件 JSON | `sakura-components/1` 和严格组件字段 | 身份摘要须匹配组件字段，仍属于来源声明 |
| 公告 JSON | `sakura-advisories/1` | 固定获取、发布、修订和撤回时间；不自动联网刷新 |
| 来源证明 | `sakura-supply-provenance/1`、Ed25519 | 签名有效、发布者受信任和已安装字节核验分别显示 |

JSON 拒绝重复键、非法编码、过深结构和超限材料。缺少哈希、无法解析的版本规则及不支持的关系会保留为缺项。

公告的最小结构如下。使用自己的真实获取时间；示例只说明格式。

```json
{
  "format": "sakura-advisories/1",
  "source": "offline-dataset",
  "collectedAt": "2026-10-24T00:00:00.000Z",
  "records": []
}
```

每条公告包含 `id/ecosystem/name/ranges/severity/issuedAt/modifiedAt/withdrawn/summary`。范围为 `{introduced,fixed}`，`fixed` 可为 `null`。只比较明确支持的 npm 语义版本子集；Python 范围显示未知。

许可证检查核对声明表达式和项目门槛，保留原文及人工用途意见。它不证明法律合规。没有命中公告也不能推导不存在漏洞。

来源信任配置只接受 Ed25519 的 SPKI `PUBLIC KEY` 公钥。私钥、重复发布者及错误算法会拒绝保存。导入的发布者配置统一恢复为未信任。

## 固定修订与当前许可

结果引用固定的 `domain/id/revision`。修改定义会生成新修订，旧报告保留原输入。来源许可有独立修订；撤销后，派生读取与导出也会拒绝。恢复许可不会重新激活旧批准。

读取租约由材料插件签发，最长 15 分钟，每块最多 512 KiB。租约绑定原主体、插件代次、空间许可、输入及用途；许可变化后必须重新取得租约。未释放的有效租约会阻止材料清理。

「历史与清理」先显示保护引用。只有已归档、无人保护的本插件对象才能进入清理计划。清理只处理计划中的原对象，保存确认回执。失败或中断后先查询原计划；跨插件重载的清理需要重新预览恢复，并显式批准。

跨插件保存先记录发布意图，再保护引用并写入正式对象。在「原发布与引用核对」查询对应领域的发布记录，预览后批准核对。恢复只确认已经落盘的原对象，或释放未发布对象自己的保护引用，不重新运行审查。无法确认时保留原意图及占用。

## CLI 与 HTTP

先保持 Sakura 服务运行。参数文件必须为 JSON 对象：

```powershell
npm run supply -- help
npm run supply -- sources create-workspace create-space.json
npm run supply -- upload <workspaceId> package-lock.json --export
npm run supply -- workbench run-checks inputs.json
npm run supply -- reviews decide decision.json
npm run supply -- reports seal report-inputs.json
npm run supply -- exchange preview-export export-inputs.json
npm run supply -- exchange export approval.json
npm run supply -- download export-record.json supply-audit.zip
```

`inputs.json` 指定 `workspaceId/source/advisorySource/policy`，后三项为固定引用。`approval.json` 指定 `workspaceId/planId/digest`。`export-record.json` 指定 `workspaceId/id/revision`。工作台和 CLI 都不会把当前选择替换进已经批准的计划。

HTTP 使用 `POST /api/supply-<领域>/<动作>`。URL 中的动作使用连字符，例如 `create-workspace`、`preview-export` 和 `accept-import`。每个入口单独登记输入、响应与所有者策略；内部容量、保护引用写入及隔离接收回调不开放为 HTTP。

可通过 `inspect-plan` 查询原计划。若原清理已提交但未确认，使用同一领域的 `preview-recovery` 取得新计划，再调用 `cleanup`。此入口只恢复原清理，不重放捕获、导出或接收动作。

退出码：0 表示当前操作完成；1 为已知业务失败；2 为输入或传输失败；3 为不确定或不支持；4 为清理未确认。检查结果与人工用途接受分别记录，不能只凭请求成功判断业务通过。

## 离线交接与核验

当前交接格式为 `sakura-supply-audit/1`，使用 ZIP STORE。预览核对完整对象图和原文导出许可，批准固定摘要及大小。单包最多 16 MiB，超过后拒绝导出，不截断证据。

导入依次核对 ZIP 结构、条目摘要、固定修订及完整引用图，然后隔离等待接受。接受会创建新空间和新 ID。外来的结果、人工决定及信任声明都保留为参考，不能替代本地审批或执行证明。接收后的原始材料默认禁止再次导出。

「交接暂存」列出上传和导出暂存。无效或不再使用的上传可取消，核销后保留回执。已有正式交接记录保护的字节须先归档并清理对应记录。下载已生成的 ZIP 时，仍会复核原材料的当前导出许可。

「接收中断恢复」区分两种情况：尚未发布的隔离空间可在核对完整清单后批准核销；已发布空间的待确认回执须复核原 ID、修订、许可和实际字节后确认。未知占用会阻止隔离关闭并保留原账本。核销回执及清理证据保存在原接收空间；代次变化后重新预览。

CLI 的 `exchange quarantines` 查询隔离记录，`exchange preview-quarantine-discard` 接收 `workspaceId/targetWorkspaceId`，再用 `exchange discard-quarantine` 提交批准。接收回执恢复使用 `exchange preview-import-recovery`，输入为 `workspaceId/receipt`，再用 `exchange recover-import` 提交批准。两种恢复均不重新执行业务动作，也不转移外来审批。

```powershell
# 不需要启动宿主，不访问网络。
node scripts/cli.mjs supply verify supply-audit.zip
```

离线核验使用运行包中的编译工具，在有界工作线程中执行。源码目录须先完成 `npm run build`。核验分别报告：

- 字节、ZIP 条目及引用图完整性。
- 可重算的依赖解析、公告匹配和许可证声明检查。
- 未经认证的材料来源。
- 未重算的人工决定、当前时效、来源信任和业务报告结论。

摘要一致不能证明发布者可信。已经下载的材料无法远程撤回。

## 容量与当前缺口

每包总额度 2 GiB，元数据上限 128 MiB，另保留 32 MiB 控制预算。普通领域元数据写入限制为 96 MiB。单锁文件解析最多 32 MiB，公告最多 64 MiB。上传按完整声明大小预留，支持分块和取消；多次元数据提交会按实际存储槽位核销。

本包已接入[新插件包共同容量](suite-capacity.md)，停用后的原占用仍计入总额。十包整体尚未完整验收。开发模式另有审计等待复现，编译服务的正常流程已通过实测；排查和后续验证见项目状态。
