# WebSocket 契约与收发路径

核对版本：`2.3.3`（2026-10-06），基于 `v2.3.2 / 0dd28ca`。基线六个原始 entry 标记 partial，但目录组装已强制改为 declared；本轮删除这一掩盖，补齐共享类型、身份与关闭描述以及生成门禁。协议版本仍为 1，不改变既有消息字节、权限或重连策略。

声明：[共享协议](../shared/contracts/websocket.ts)、[操作目录](../server/operation-catalog.ts)、[查询参数](../server/http-request-contracts.ts)。生成产物：[浏览器类型](../shared/contracts/websocket-client.generated.ts)、[完整机器可读清单](schemas/websockets.json)；清单包括每个通道的实际 query/header Schema、操作身份、消息方向、鉴权和关闭语义。

## 六通道与身份

路径除 events 外均带 `{vmId}`；表中列出 token 以外的查询参数。所有通道都必须携带 `token`，没有应用层请求正文或自定义认证 header；重复、未声明或格式错误的 query 拒绝。WebSocket 自身握手 header 仍由传输库处理。名称为 sakura-json-v1 / rfb-3.7-or-3.8 的值是目录协议描述，不要求浏览器发送同名 `Sec-WebSocket-Protocol`。

| 通道 / 路径 | 查询参数 | 客户端 → 服务端 | 服务端 → 客户端 | 账户模式与绑定 |
| --- | --- | --- | --- | --- |
| events `/ws/events` | 无 | `never` | `change` | owner；宿主身份；允许迁移维护和 VM 锁 |
| terminal `/ws/{vmId}/terminal` | `project?`、`session?` | `input`、`resize` | `ready`、`data`、`error`、`exit` | owner；固定 VM 运行身份和项目；阻止迁移维护及 VM 锁；有 session 时归属 terminal-workspace |
| terminal-view `/ws/{vmId}/terminal-view` | `project?`、必填 `session` | `never` | 同 terminal | 仅 viewer，VM 必须在授权列表中，并匹配 viewer/VM/session/project 的有效终端授权及 terminalId；固定 VM；归属 terminal-workspace |
| logs `/ws/{vmId}/logs` | `session?` | `never` | `data` | owner；固定 VM，不绑定项目；允许维护及已有 VM 锁；若连接后发生 incident-lockdown，仍按 VM 关闭 |
| desktop `/ws/{vmId}/desktop` | `project?`、`app?` | RFB 二进制流片段 | RFB 二进制流片段 | owner；固定 VM/项目；阻止维护和 VM 锁；归属 desktop；app 是 UUID，指向既有应用会话 |
| desktop-view `/ws/{vmId}/desktop-view` | `project?` | 经过只读过滤的 RFB 流片段 | RFB 二进制流片段 | owner 或有 VM 授权的 viewer；固定 VM/项目；阻止维护和 VM 锁；归属 desktop |

未开启账户模式时，六通道都接受当前本机控制令牌并使用 owner 身份，包括 terminal-view；开启账户模式后不回退到本机令牌。所有入口要求同源及宿主会话解锁，member 不可连接。terminal-view 的操作角色集合包含 owner，是为了本机兼容路径；不能据此宣称账户 owner 可以连接该入口。

`project` 是 `default` 或 16 位小写十六进制；`session` 匹配 `[a-z0-9-]{1,48}`。普通项目通道省略 project 时由网关捕获当前项目并在后续检查复核；旧 terminal-view 授权省略 project 时维持旧会话绑定，不重解释为当前项目。有 session 的连接还要求启用 terminal-session 能力（logs 的兼容参数也保留）；桌面要求 desktop 能力。app 桌面仍保留原查询项目准入，再由应用服务核对既有应用的实际归属及固定端口。

鉴权代码：[socketAuthorization 与撤权回调](../server/application-http.ts)、[操作身份捕获/复核](../server/operation-authority.ts)、[网关准入](../server/operation-gateway.ts)、[终端授权](../server/terminal-sharing.ts)。账户 ID、凭证、VM、终端授权和插件代次分别关联连接；账户/授权过期、撤权或会话锁定会清理连接。

## JSON 消息字段

所有对象严格匹配既有 Schema，不允许附加字段。一个文本 WebSocket message 对应一个 JSON 对象；协议没有请求 ID、ACK 或可恢复序号。大小限制针对完整 message，而不是 WebSocket 的单个底层分片。

| 消息 | 字段 | 通道与行为 |
| --- | --- | --- |
| input | `{ type: 'input', data: string }`；data 最长 32,768 个 JS 字符单元 | terminal 上行；写入 SSH 流，不缓存重放 |
| resize | `{ type: 'resize', cols: integer, rows: integer }` | terminal 上行；接受范围外整数，服务端将 cols 限到 10–400、rows 限到 2–200；不在 Schema 中缩窄这一兼容范围 |
| ready | `{ type: 'ready', data: { projectId: string, networkIsolation: 'host' \| 'private' } }` | terminal / terminal-view；SSH exec 成功后发送捕获的项目上下文 |
| data | `{ type: 'data', data: string }`；data 最长 524,288 个 JS 字符单元 | 终端 stdout/stderr 由各自 UTF-8 StringDecoder 解码；logs 先发当前日志或等待提示，再追加日志 |
| error | `{ type: 'error', data: string }`；data 最长 1,024 个 JS 字符单元 | 仅两个终端通道；默认安全提示，目录权限迁移错误保留显式安全指引；不发送原异常、HTTP ApiErrorDto 或独立 code 字段；error 本身不保证立刻关闭 |
| exit | `{ type: 'exit', data: true }` | 仅两个终端通道；终端流关闭时发送，再执行无状态 close；SSH 提前关闭等路径不保证收到 exit |
| change | `{ type: 'change', data: null }` | events；连接后立即发送一次，随后响应 machines change；浏览器已有 data.resources 扩展及不可解析旧信号的全量刷新容错保留，但不是当前服务端生成帧的字段 |

服务端收发：[application-websocket.ts](../server/application-websocket.ts)。浏览器：[终端和日志](../src/terminal-connection.ts)、[终端页面](../src/TerminalPanel.tsx)、[只读视图](../src/AccessControl.tsx)、[事件刷新](../src/controller-watch.ts)。浏览器消费继续保留旧主机的宽容读取，不新增严格 Schema 解析；当前发送与 ready 回调使用生成类型，旧字段检查及错误处理保持。

所有通道的客户端 message 上限为 65,536 字节；服务端 message 上限为 1,048,576 字节。JSON 的序列化字节限额与字段字符限额分别生效，转义和多字节文本不能只按 string.length 计算。服务端 JSON 待发送缓冲大于 1 MiB 时拒绝慢消费者。

## RFB 字节流

[桌面桥](../server/desktop.ts)使用 SSH exec 和流背压，向客户端按最多 1 MiB 切片；客户端必须发送二进制帧。`Uint8Array` 表示可跨 JS 环境使用的字节片段类型，不代表协议包边界或 JSON 包装。noVNC 负责浏览器侧 RFB 编解码：[桌面](../src/DesktopPanel.tsx)、[共享桌面](../src/AccessControl.tsx)、[单应用](../src/single-app-page.ts)。

普通 desktop 的客户端字节透明转发，版本和认证由 guest/noVNC 协商；描述中的 3.7/3.8 不能被理解为普通桥做了版本验证。desktop-view 使用 [ReadOnlyRfb](../server/readonly-rfb.ts)，允许跨帧或同帧多包：

- 握手限 RFB `003.007` / `003.008`；security type 1；ClientInit 为 0 或 1。此 no-auth 是 guest RFB 握手，外层 Sakura 凭证仍必需。
- 只转发 SetPixelFormat(0)、SetEncodings(2)、FramebufferUpdateRequest(3)、EnableContinuousUpdates(150)、Fence(248)。编码数最多 256，pending 最多 65,536 字节；Fence flags 仅低两位、payload 最多 64 字节。
- 去掉剪贴板伪编码 `0xc0a1e5ce`；键盘、指针、剪贴板、改分辨率、请求方向的 Fence 和未知扩展失败关闭。只读不等于没有客户端字节，也不阻止正常画面请求。

## 错误、关闭与重连

应用升级前：会话锁定返回 HTTP 423；网关准入、凭证、权限、参数、同源及能力拒绝返回 HTTP 403；没有 JSON 错误体。无效 URL 或底层握手失败可能直接销毁连接或由 ws 返回其传输错误，不能把它们映射为业务 error 消息。升级后的明确关闭帧由共享 `socketCloseReasons` 驱动：

| code | 原始 reason | 条件 |
| --- | --- | --- |
| 1003 | `Unsupported message type` / `Binary RFB required` | JSON 收到二进制，或桌面收到文本；桌面前置流监听器可能先销毁流 |
| 1008 | `Read-only channel` / `Read-only terminal` | 只读 JSON 通道收到应用输入；早期监听器通常先执行 |
| 1008 | `Invalid message` / `invalid message` | 终端 JSON/字段验证失败，或终端后续输入检查失败；保留原大小写 |
| 1008 | `Plugin generation revoked` / `Incident lockdown` | 插件代次撤销，或 VM incident 锁定 |
| 1008 | `slow consumer` | JSON 服务端积压超过 1 MiB |
| 1009 | `Message too large` | 应用发送/接收检查超限；ws 的 maxPayload 可能先关闭，此时 reason 可为空 |
| 1011 | `Invalid server message` | 输出不符共享 Schema |
| 1011 | `Desktop unavailable` | 桌面准备/attach 异常；SSH/流清理若已开始关闭，可能先观察到无状态关闭 |

普通 `close()` 不发送应用 code/reason；直接 `terminate()` 不发送 close 帧。客户端库通常以 1005 表示无状态关闭、1006 表示异常断连；这两个数字不作为服务端 wire code 发送。终端准备失败通常先发送安全 error 再无状态关闭，SSH 断开可能只关闭；RFB 过滤/SSH/桥接流错误沿流清理关闭，无 JSON error。宿主关闭、账户/凭证/授权过期或撤销、会话锁、准入异步失败、桌面会话失效分别见生成清单 lifecycle，异常关闭时不承诺最后一帧送达。

事件重连使用新凭证并全量刷新；终端有限次重连但不重放输入，收到 exit 后停止自动重连；桌面沿用原 noVNC 重连控制器。只读视图原来没有自动重连，本轮不添加。恢复连接不保证补齐漏掉的事件、终端输出或 RFB 字节。

## 生成与验证入口

`npm run plugins:schema` 从同一操作目录和帧 Schema 生成 HTTP 与 WebSocket 产物；`npm run plugins:check`（CI 的 verify 已调用）检查六通道唯一覆盖、完整声明、消息方向/判别字段、JSON 与字节流形态以及生成文件漂移。不支持的 Schema 不允许降为 unknown/any。公开目录继续返回完整 socketContract，HTTP 生成的目录响应类型同步包含新增描述。

本轮定向验证与边界记录在 [PROJECT_STATUS.md](../PROJECT_STATUS.md)；专项脚本、类型正反例和日志仅保存在被忽略的 `artifacts/websocket-contracts-2.3.3/`，不作为产品文件入库。
