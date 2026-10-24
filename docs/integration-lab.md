# 接口集成验证

## 使用范围

适用于 Sakura 2.7.0。本包包含 11 个独立插件，只要求额外启用 `projects` 和 `secrets`。`app-targets` 是可选适配；缺席时，手工登记私网测试环境和本包模拟流程仍可用。

启用插件、创建模板和编辑定义都不会启动 VM。工作空间属于当前已鉴权 owner，不接受客户端指定 owner。执行必须引用已封存修订，先预览，再批准。修改草稿不会覆盖旧修订或改变已批准输入。

首版支持 HTTP/1.1 的 HTTP 和 HTTPS。功能请求只允许固定的私网 IPv4 测试端点，或本次 VM 内的模拟服务。负载只允许本次 VM 内的模拟服务。DNS、IPv6、代理、重定向、宿主地址和关闭 TLS 验证选项均不开放。

## 首次使用

1. 启用 `integration-lab` 包，保存插件选择并重启服务。
2. 打开接口集成验证工作台。工作空间、模板和执行动作初始均为空选择。
3. 选择“订单接口演练”，填写名称并创建定义。模板固定虚构商品、订单有限状态、串行场景和断言。另有“分页与限流”和“契约变更检查”。
4. 导入已准备的镜像，或选择镜像列表中的固定摘要。准备镜像须包含 `python3`、Python TLS 标准库、`cc`、`ip`、`nft`、`useradd` 和 `groupadd`。缺项返回 `RUNTIME_NOT_PREPARED`，不会安装依赖。
5. 在“引导式演练”中选择已准备镜像并预览运行。工作台会保留模板的固定场景、模拟和断言引用，无需手动复制 ID。审阅目标、写节点、凭据版本、时限和正文保留字段。
6. 批准同一个计划 ID 和摘要。订单演练包含写操作，须明确设置 `approveWrites: true`。
7. 读取运行，等待断言和清理结束，再封存报告。任务提交成功不等于验证通过。

本包直接执行已准备镜像。镜像制作和依赖下载需要另行明确执行；运行计划没有隐式安装步骤。准备镜像导入支持纯 Node CLI，浏览器上传上限为 256 MiB。

```powershell
node scripts/integration-cli.mjs workspace create --file template.json --json
node scripts/integration-cli.mjs image import --workspace <workspaceId> --file prepared.qcow2 --distro debian --architecture x86_64 --json
```

`template.json`：

```json
{ "name": "订单接口演练", "template": "order-demo" }
```

CLI 从 `SAKURA_TOKEN` 读取登录凭据。它只连接本机 Sakura 地址。认证凭据不要写进输入 JSON。也可使用主 CLI `node scripts/cli.mjs integration`，或 `npm run integration --`。

## 定义、修订与场景

每个定义通过 `save` 创建草稿；修改已有对象须同时传 `id` 和 `expectedRevision`。`seal` 校验并封存指定修订。`get` 必须给出对象 ID 和修订摘要。`archive` 拒绝仍有依赖引用的修订。并发修改只允许一个请求成功，另一个返回 `REVISION_CONFLICT`。

契约采用严格 `sakura-http-contract/1`。不支持的字段直接拒绝。同文档具名模式不能递归，也不能引用远程文档。兼容比较方向固定为“旧客户端消费新服务”；未覆盖的约束变化返回 `undetermined`。

CSV 和 JSON 导入后保存固定内容。生成器只创建固定种子的虚构数据。模拟规则按照声明顺序匹配方法、完整路径模板和当前有限状态，支持延迟、错误状态、截断与断连。会话之间不共享状态。

场景编译为最多 100 个节点的 DAG，目前按确定顺序串行执行。节点可引用固定数据行。响应变量只能写入声明的路径参数、查询值和请求体字段。字符串必须有限长，数值必须有范围或枚举。变量不能改变目标、方法或认证头。循环、越界和未声明写入位置都会拒绝。

断言支持状态、允许的响应头、JSON Pointer 值、类型与范围、集合成员、跨步骤关系和时限。运行器是唯一证据提交者，HTTP 不开放自造证据或直接提交“通过”的入口。负载断言检查每个匹配样本，不能用第一个成功样本代表整个批次。

## HTTP 和 CLI 映射

每个领域使用 `/api/integration-<领域>`。GET 读取；POST 的 `action` 分派到该领域的独立方法。需要工作空间的调用使用 `?workspaceId=<id>`。所有成功响应采用 `{ "result": ... }`，未知输入和输出字段均拒绝。

| 领域         | POST 动作                                                                                         | CLI 领域                            |
| ------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| specs        | create-workspace、save、get、seal、archive、compare                                               | spec；workspace create 组合模板服务 |
| environments | save、get、seal、archive、versions、revoke、application-targets                                   | environment                         |
| fixtures     | save、get、seal、archive、import、generate                                                        | fixture                             |
| mocks        | save、get、seal、archive                                                                          | mock                                |
| scenarios    | save、get、seal、archive、compile                                                                 | scenario                            |
| assertions   | save、get、seal、archive                                                                          | assertion                           |
| runners      | preview、apply、inspect、cancel、recover、verify-effect；images 和 image-*                        | run；image import                   |
| load         | save、get、seal、archive、preview、apply                                                          | load                                |
| reports      | seal、get、compare、cleanup-plan、cleanup                                                         | report                              |
| exchange     | export、quarantine、accept；upload-begin、upload-append、upload-complete、uploads、upload-discard | exchange；export；import            |
| workbench    | create                                                                                            | workbench；workspace create         |

CLI 动作从 `--file` 读取 JSON；文件省略 `action`，由子命令提供。完整字段由 `shared/contracts/integration-http.ts` 定义。工作台的各领域编辑器使用同一 DTO，支持查看响应和保存 JSON。

```powershell
node scripts/integration-cli.mjs run preview --workspace <id> --file preview.json --json
node scripts/integration-cli.mjs run apply --workspace <id> --file approval.json --json
node scripts/integration-cli.mjs run inspect --workspace <id> --file run.json --json
node scripts/integration-cli.mjs report seal --workspace <id> --file report.json --json
```

预览文件的外层为 `input`，包括 `scenario`、`mock`、`assertions`、`image`、`mode`、`requests`、`rate`、`durationSeconds` 和 `retainFields`。定义引用形如 `{ "id": "…", "revision": "…" }`，镜像引用形如 `{ "assetId": "…", "digest": "…" }`。正文默认不保留，使用 `retainFields: []`。

批准文件为 `{ "planId": "…", "digest": "…", "approveWrites": true }`。运行查询文件为 `{ "id": "…" }`。报告封存文件为 `{ "runId": "…" }`。重复批准同一个计划返回原运行，不重复发送请求。

## 请求许可、取消与恢复

固定工具 `integration-http-v1` 在专用 VM 的普通项目账户中运行。宿主不代发 HTTP。工具先提交挑战，运行器重新核对 owner、目标、来源修订、动态绑定和完整秘密版本集合，持久保存意图。本体随后持久保存许可签发记录，再通过短期通道发送许可。

功能许可只消费一次，从工具创建挑战时开始计时，最多 2 秒。控制器没有新许可时，工具不能发下一请求。负载先固定整个请求账本，每次授权心跳仍有最多 2 秒有效期。模拟独立会话也需短期确认。令牌桶初始为空，暂停后不补发错过的请求。

取消先停止新调度，再停止原工具和 VM。主进程重启不会恢复业务执行。缺少完整响应的已许可请求保留 `effect-unknown`；不能根据网络错误断言对端没有写入。`verify-effect` 只追加外部核验摘要，不修改历史请求结论。

`recover` 只核销原回执。创建身份、启动身份或 boot ID 已改变时，保留恢复责任，不停止替换实例。`cleanup-pending` 不能归还 VM 额度或显示资源已释放。

CLI 退出码：`0` 表示当前调用没有已知业务失败；`1` 表示失败或断言违反；`2` 表示输入或传输错误；`3` 表示证据未求值或结果不确定；`4` 表示清理待确认。提交异步运行的 `0` 只表示提交完成，后续必须查询终态。

## 负载、报告与保留

功能运行上限为 200 次请求、10 分钟；单请求最多 15 秒。负载上限为 6000 次、100 次/秒、60 秒，实际执行串行，不能通过配置增加并发。每个工作空间最多 1 台活动 VM，全包最多 2 台；当前实例固定为 1 GiB、1 vCPU。

报告记录请求计划数、已知发起数、完成数、错误数、未发起数、未知数和计数是否完整。延迟分位数只使用完整样本；超时单列。调度缺口、缺少最终摘要、身份变化或未求值断言会使报告为 `inconclusive`。报告比较固定输入、工具、镜像、负载计划、资源和时钟方式；不匹配时返回原因，不输出性能提升百分比。

默认只保留允许的响应头、大小、摘要和断言结论。选定正文 JSON Pointer 后，仅保留这些字段；已知秘密反射会过滤。此过滤不能证明任意业务数据都不敏感。报告明确标记 `record-only` 或 `selected-fields`，并说明完整正文已丢弃，不能离线重新计算全部业务断言。

累计容量由 specs 管理。业务元数据分配上限收紧为 224 MiB，另为索引和账本留下 32 MiB；控制记录另留 32 MiB。全包持久与暂存内容最多 32 GiB，镜像副本、VM 磁盘和导入峰值均计入。容量满时拒绝新业务，不删除受保护内容腾位。

默认报告保留 30 天。清理先生成计划，再核对摘要和保护条件。未确认清理的运行继续保护内容和预算。

## 离线交换

```powershell
node scripts/integration-cli.mjs export --workspace <id> --file selection.json --out bundle.zip
node scripts/integration-cli.mjs verify --file bundle.zip --out evidence.html
node scripts/integration-cli.mjs import --file bundle.zip
node scripts/integration-cli.mjs exchange accept --file acceptance.json
```

导出选择包含 `scenario`、`mock`、`assertions` 和 `reports` 数组。导出器通过领域服务收集完整依赖闭包。环境变成未绑定的逻辑槽位，秘密源 VM、秘密值、应用目标身份、运行批准和资源令牌不进入包。

ZIP 上传采用最多 512 KiB 的块，检查偏移、最终大小和 SHA-256。同一块的安全重试不会重复追加。解析前检查条目数、展开大小、路径、别名、重复条目、链接、设备、重叠和本地头一致性。内容停在隔离区，接受定义不会联网或启动 VM。

离线核验器只证明完整性与记录关联，不认证发布者。离线 HTML 把所有输入作为文本，并禁止远程资源。导入报告永远标记为导入证据。接受定义创建新的本地 ID 和 owner 工作空间；失败后可用同一导入 ID 继续。接受后仍须重新绑定环境、修订场景并重新预览。

压缩包上限为 256 MiB、展开内容为 512 MiB、条目为 2000。当前隔离元数据另受 128 MiB 和全包累计配额约束；超限会保留拒绝记录。未发布上传可以用 `upload-discard` 清理，已经关联隔离导入的上传受保护。

## 验证记录

2026-10-23 已通过无 VM 领域验证 24 项、分块交换与 CLI 验证 12 项。真实 VM 订单演练完成 3 次请求与 5 项断言，并确认销毁原实例。真实故障验证覆盖写入后断连、固定模拟负载、运行取消和许可超时；没有重放请求。20 次负载虽全部完成，但出现授权心跳导致的调度缺口，报告按规则标为不确定。

这些验证使用本领域独立创建的 1 GiB、1 vCPU VM，未操作现有用户 VM。私网外部端点的 TLS 正向联通、真实账户秘密轮换和完整独立运行包仍须在主任务整合环境验收，不能据上述模拟结果推断已经通过。
