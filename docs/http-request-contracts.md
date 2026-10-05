# HTTP 请求体契约清单

核对版本：`2.3.2`（2026-10-06），基于实际工作区 `2.3.1 / 7620ee1`，保留 `v2.3.0 / c37a393` 之后的恢复修复。

历史 86 个顶层 `request: unknown` 出自 `d4a2587`，其请求协议已在 `2dc4d6a` 声明；`c37a393` 和 `7620ee1` 的顶层请求 unknown 均为零。本清单按真实处理器复核这些操作，并记录仍需对齐的条件正文、嵌套类型和解析规则。运行时以 [请求目录](../server/http-request-contracts.ts)、[路由 Schema](../server/http-route-requests.ts) 及各领域 Schema 为准，生成物为 [操作 Schema](schemas/operations.json) 和 [类型客户端契约](../shared/contracts/api-client.generated.ts)。

| 分类 | 数量 | 请求体 |
| --- | ---: | --- |
| 无正文 | 24 | `undefined`；不发布 OpenAPI requestBody |
| JSON | 57 | `application/json`；字段、必需项、枚举和默认值来自下列源码 |
| 表单 | 1 | `application/x-www-form-urlencoded` |
| 二进制 | 4 | `application/octet-stream`；原始字节，不作 JSON 序列化 |

## 无请求体的 24 项

操作仍可带路径、query 和鉴权头；这些输入不构成正文。尤其不能按 DELETE 方法推断无正文，网络配置、流水线和密钥删除仍属于后面的 JSON 操作。

| 操作 ID | HTTP 路径 | 处理器依据 |
| --- | --- | --- |
| `core.access.ssoOidcDisable` | `DELETE /api/access/sso/oidc` | [处理器](../server/http-account-access.ts) |
| `core.access.ssoSamlDisable` | `DELETE /api/access/sso/saml` | [处理器](../server/http-account-access.ts) |
| `core.access.ssoUnlink` | `DELETE /api/access/sso/link/{provider}` | [处理器](../server/http-account-access.ts) |
| `core.access.handoffCancel` | `DELETE /api/access/handoff` | [处理器](../server/http-account-access.ts) |
| `core.access.terminalShareRevoke` | `DELETE /api/access/terminal-shares/{id}` | [处理器](../server/http-account-access.ts) |
| `core.access.logout` | `POST /api/access/logout` | [处理器](../server/http-account-access.ts) |
| `core.access.removeViewer` | `DELETE /api/access/users/{id}` | [处理器](../server/http-account-access.ts) |
| `core.access.removeMember` | `DELETE /api/access/members/{id}` | [处理器](../server/http-account-access.ts) |
| `core.vms.delete` | `DELETE /api/vms/{vmId}` | [处理器](../server/http-machines.ts) |
| `core.vms.start` | `POST /api/vms/{vmId}/start` | [处理器](../server/http-machines.ts) |
| `core.jobs.cancel` | `POST /api/jobs/{jobId}/cancel` | [处理器](../server/plugins/tasks.ts) |
| `core.jobs.retry` | `POST /api/jobs/{jobId}/retry` | [处理器](../server/plugins/tasks.ts) |
| `core.browserExtensions.revoke` | `DELETE /api/browser-extensions/{id}` | [处理器](../server/http-companions.ts) |
| `automation.legacy.post.vms.vmId.suspend` | `POST /api/vms/{vmId}/suspend` | [处理器](../plugins/automation/server.ts) |
| `automation.legacy.post.vms.vmId.resume` | `POST /api/vms/{vmId}/resume` | [处理器](../plugins/automation/server.ts) |
| `desktop.legacy.post.vms.vmId.ime` | `POST /api/vms/{vmId}/ime` | [处理器](../plugins/desktop/server.ts) |
| `files.legacy.delete.vms.vmId.uploads` | `DELETE /api/vms/{vmId}/uploads` | [处理器](../plugins/files/server.ts) |
| `images.legacy.post.images.imageId` | `POST /api/images/{imageId}` | [处理器](../plugins/images/server.ts) |
| `maintenance.legacy.post.vms.vmId.diagnostics` | `POST /api/vms/{vmId}/diagnostics` | [处理器](../plugins/maintenance/server.ts) |
| `maintenance.legacy.post.vms.vmId.compact` | `POST /api/vms/{vmId}/compact` | [处理器](../plugins/maintenance/server.ts) |
| `snapshots.legacy.delete.vms.vmId.snapshots.snapshotId` | `DELETE /api/vms/{vmId}/snapshots/{snapshotId}` | [处理器](../plugins/snapshots/server.ts) |
| `sync.legacy.post.vms.vmId.sync-preview` | `POST /api/vms/{vmId}/sync-preview` | [处理器](../plugins/sync/server.ts) |
| `sync.legacy.post.vms.vmId.sync-queue` | `POST /api/vms/{vmId}/sync-queue` | [处理器](../plugins/sync/server.ts) |
| `sync.legacy.delete.vms.vmId.sync-queue` | `DELETE /api/vms/{vmId}/sync-queue` | [处理器](../plugins/sync/server.ts) |

## JSON 请求的 57 项

除特别说明外，正文必需。Schema 链接指向处理器直接使用或统一准入复用的定义；路径与完整 query/header 参数见操作 Schema。领域状态、路径权限、大小校验和跨字段 refinement 仍由服务端执行，TypeScript 结构类型不替代这些检查。

| 操作 ID | 请求 Schema | 处理器 |
| --- | --- | --- |
| `core.extension.connect` | [extensionCodeInput](../server/browser-extensions.ts) | [处理器](../server/application-http.ts) |
| `automation.legacy.put.vms.vmId.advanced` | [featureSuiteUpdateRequest](../server/feature-suite.ts) | [处理器](../plugins/automation/server.ts) |
| `automation.legacy.post.vms.vmId.advanced` | [featureSuiteActionRequest](../server/feature-suite.ts) | [处理器](../plugins/automation/server.ts) |
| `automation.legacy.post.vms.vmId.packages` | [packageWorkbenchRequest](../server/package-workbench.ts) | [处理器](../plugins/automation/server.ts) |
| `backups.legacy.put.vms.vmId.backups` | [backupPolicySchema](../server/backups.ts) | [处理器](../plugins/backups/server.ts) |
| `backups.legacy.post.vms.vmId.backups` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/backups/server.ts) |
| `backups.legacy.post.vms.vmId.backup-download` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/backups/server.ts) |
| `code-checks.legacy.post.vms.vmId.language-service` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/code-checks/server.ts) |
| `code-checks.legacy.post.vms.vmId.debugger` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/code-checks/server.ts) |
| `containers.legacy.post.vms.vmId.containers` | [containerActionSchema](../server/containers.ts) | [处理器](../plugins/containers/server.ts) |
| `desktop.legacy.post.vms.vmId.desktop` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/desktop/server.ts) |
| `desktop.legacy.post.vms.vmId.single-app` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/desktop/server.ts) |
| `extensions.legacy.post.vms.vmId.extended-features` | [extendedFeatureActionRequest](../server/extended-features.ts) | [处理器](../plugins/extensions/server.ts) |
| `files.legacy.put.vms.vmId.file` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/files/server.ts) |
| `files.legacy.post.vms.vmId.file-lock` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/files/server.ts) |
| `files.legacy.post.vms.vmId.history` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/files/server.ts) |
| `files.legacy.post.vms.vmId.file-operation` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/files/server.ts) |
| `files.legacy.post.vms.vmId.uploads` | [uploadSessionRequest](../server/resumable-uploads.ts)；创建/提交条件见下文 | [处理器](../plugins/files/server.ts) |
| `git.legacy.post.vms.vmId.git` | [gitActionSchema](../server/git-workbench.ts) | [处理器](../plugins/git/server.ts) |
| `ide.legacy.post.vms.vmId.ide` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/ide/server.ts) |
| `library.legacy.post.vms.batch` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/library/server.ts) |
| `library.legacy.put.vms.vmId.organization` | [organizationSchema](../shared/contracts/vm.ts) | [处理器](../plugins/library/server.ts) |
| `maintenance.legacy.post.vms.vmId.resize` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/maintenance/server.ts) |
| `maintenance.legacy.put.vms.vmId.disk-maintenance` | [diskMaintenancePolicySchema](../server/disk-maintenance.ts) | [处理器](../plugins/maintenance/server.ts) |
| `maintenance.legacy.post.vms.vmId.disk-maintenance` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/maintenance/server.ts) |
| `migration.legacy.post.migration` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/migration/server.ts) |
| `network.legacy.post.network-profiles` | [networkProfileRequest](../server/network-profiles.ts) | [处理器](../plugins/network/server.ts) |
| `network.legacy.delete.network-profiles` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/network/server.ts) |
| `network.legacy.post.vms.vmId.network` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/network/server.ts) |
| `network.legacy.patch.vms.vmId.services` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/network/server.ts) |
| `pipelines.legacy.put.vms.vmId.pipelines` | [pipelineSchema](../server/pipelines.ts) | [处理器](../plugins/pipelines/server.ts) |
| `pipelines.legacy.delete.vms.vmId.pipelines` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/pipelines/server.ts) |
| `pipelines.legacy.post.vms.vmId.pipelines` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/pipelines/server.ts) |
| `pipelines.legacy.post.vms.vmId.pipeline-artifact` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/pipelines/server.ts) |
| `platform.legacy.post.vms.vmId.next-features` | [nextFeatureActionRequest](../server/next-features.ts) | [处理器](../plugins/platform/server.ts) |
| `projects.legacy.post.vms.vmId.projects` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/projects/server.ts) |
| `projects.legacy.put.vms.vmId.project` | [projectSchema](../server/project-config.ts) | [处理器](../plugins/projects/server.ts) |
| `projects.legacy.post.vms.vmId.project` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/projects/server.ts) |
| `projects.legacy.post.vms.vmId.project-directory-migration` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/projects/server.ts) |
| `recipes.legacy.post.recipes` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/recipes/server.ts) |
| `recipes.legacy.put.vms.vmId.recipe` | [recipeSchema](../server/recipes.ts) | [处理器](../plugins/recipes/server.ts) |
| `recipes.legacy.post.vms.vmId.recipe` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/recipes/server.ts) |
| `runtimes.legacy.post.vms.vmId.runtimes` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/runtimes/server.ts) |
| `secrets.legacy.put.vms.vmId.secrets` | [secretSaveRequest](../server/secrets.ts) | [处理器](../plugins/secrets/server.ts) |
| `secrets.legacy.delete.vms.vmId.secrets` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/secrets/server.ts) |
| `secrets.legacy.patch.vms.vmId.secret-rotation` | [secretRotationRequest](../server/secrets.ts) | [处理器](../plugins/secrets/server.ts) |
| `snapshots.legacy.post.vms.vmId.snapshots` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/snapshots/server.ts) |
| `snapshots.legacy.patch.vms.vmId.snapshots.snapshotId` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/snapshots/server.ts) |
| `snapshots.legacy.post.vms.vmId.snapshots.snapshotId.restore` | [httpRouteRequests 中同名项](../server/http-route-requests.ts)；可省略正文，语义见下文 | [处理器](../plugins/snapshots/server.ts) |
| `snapshots.legacy.post.vms.vmId.clone` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/snapshots/server.ts) |
| `sync.legacy.put.vms.vmId.sync` | [syncSchema](../server/sync.ts) | [处理器](../plugins/sync/server.ts) |
| `sync.legacy.post.vms.vmId.sync` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/sync/server.ts) |
| `sync.legacy.post.vms.vmId.sync-merge` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/sync/server.ts) |
| `sync.legacy.post.vms.vmId.sync-rollback` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/sync/server.ts) |
| `terminal-workspace.legacy.post.vms.vmId.terminal-session` | [httpRouteRequests 中同名项](../server/http-route-requests.ts) | [处理器](../plugins/terminal-workspace/server.ts) |
| `toolchains.legacy.post.vms.vmId.tools` | [toolchainInstallRequest](../server/toolchains.ts) | [处理器](../plugins/toolchains/server.ts) |
| `transfers.legacy.post.vms.vmId.download` | [downloadSchema](../server/downloads.ts) | [处理器](../plugins/transfers/server.ts) |

### 同一路径的正文条件

- `files.legacy.post.vms.vmId.uploads`：未提供 query `id` 时，必须提交 `{ path, size, chunks, overwrite? }`，`chunks` 为 SHA-256 字符串数组，`overwrite` 默认为 false；提供合法 `id` 时提交已有会话，禁止正文。声明使用 `request.bodylessQuery = "id"`，默认分支 `required = true`。生成 `OperationOptions` 以 query/body 联合类型排除两种无效组合；SDK 和类型客户端在获取凭证前拒绝缺失或多余正文。OpenAPI 的 requestBody 标为整体可选，并在 description 与 `x-sakura-operation.request` 中说明条件，不能把可选误读为创建时可省略。
- `snapshots.legacy.post.vms.vmId.snapshots.snapshotId.restore`：省略正文沿用 `backup=false`；提交 `{}` 沿用 Schema 的 `backup=true`。`memory` 可选。只有 Content-Type 而没有正文时也按省略处理。

端口转发输入中允许的扩展字段现为递归 JSON 值，覆盖本清单中的两个 recipe 操作及目录中的 VM create/update；不会把函数、Symbol 等任意 JavaScript 值发布为 unknown。Schema 转换只访问 Schema 位置，`default: {}`、const 和 examples 均保留数据含义。

## 表单与二进制请求的 5 项

| 操作 ID | 结构及关联输入 | 处理器 |
| --- | --- | --- |
| `core.access.ssoSamlCallback` | 表单字符串 `SAMLResponse`、`RelayState`，各出现一次且非空；有界读取最多 1,500,000 字节，保持 URL 编码及重复字段检查 | [SAML 回调及表单读取](../server/application-http.ts) |
| `files.legacy.put.vms.vmId.transfer` | 文件原始字节；query `path` 必需，`overwrite=0/1` 可选；文件锁头可选 | [文件传输](../plugins/files/server.ts) |
| `files.legacy.put.vms.vmId.uploads` | 分块原始字节；query `id`、`chunk` 必需；文件锁头可选 | [分块上传](../plugins/files/server.ts) |
| `images.legacy.post.image-import` | 镜像原始字节；query `name/format/distro/memoryMiB/cpus` 必需，架构、加速、固件、SHA-256 可选 | [镜像导入](../plugins/images/server.ts) |
| `snapshots.legacy.post.import` | Sakura 包原始字节；query `name` 必需；加密密码 base64 头可选 | [快照包导入](../plugins/snapshots/server.ts) |

JSON、表单的媒体类型按去参数、去空白及小写化后比较，与统一准入相同；正文中的字符串、默认值和二进制字节不受该规范化影响。二进制继续由原有流读取器消费，客户端不会自动重放写请求。

## 生成与校验

`npm run plugins:schema` 刷新操作 Schema 与类型客户端；`npm run plugins:check` 校验漂移与公共服务兼容。目录拒绝 JSON/表单缺少 Schema、无正文却携带 Schema/required/media、二进制与 JSON Schema 混用及错误条件 query；生成器拒绝不支持的结构落成 unknown（包括嵌套成员）。公开 JSON 扩展保留 JSON 值语义。最小验证结论与版本提交见 [项目状态](../PROJECT_STATUS.md)，专项材料保存在忽略目录，不进入 Git。
