# 事件投递与告警路由

系统设置 → 管理事件通知可添加最多 16 个接收端。默认不启用自动投递；保存时生成 32 字节签名密钥，仅在创建或轮换的响应中显示一次。后续 GET 不返回密钥，浏览器不持久保存它。本机数据目录的 `webhooks.json` 保存接收配置、签名密钥和投递队列；应使用该目录已有的宿主机访问控制。

接收地址支持 HTTPS，本机 `localhost`、`127.0.0.1` 和 `::1` 可使用 HTTP 测试。不允许 URL 用户名、密码、查询参数或片段。不会跟随重定向。外部接收端应使用此签名认证；控制 API 的凭证不会随 Webhook 发送。

## 事件与条件

- `job.finished`：已启用插件的任务结束，状态为 done/error/cancelled/interrupted。
- `alert.raised`：自动化插件生成的新告警，包括 CPU、内存、磁盘、服务、备份、任务失败及密钥轮换提醒。需要启用自动化调度和对应实例的告警策略。
- `test`：用户点击测试投递，发送无实例信息的测试事件；也可测试尚未启用的接收端。

可设置实例标识、项目标识、标签、任务状态和告警类型。不同条件同时满足才匹配；同一列表中的标识/类型为任一命中，标签为全部命中。空列表不限。标签来自采集时的实例配置；任务状态条件仅影响任务事件，告警类型条件仅影响告警事件。

每 5 秒从当前已启用插件的保留记录中采集。新订阅及修改后的订阅只接收其保存时间之后的事件，不回填旧记录；来源时间范围为最近 24 小时。尚未采集就被来源历史淘汰的事件无法恢复。去重窗口保存 48 小时，最多 20000 个事件标识。接收端之间分别匹配，多条命中的订阅分别投递。

JSON 正文为 `version: 1` 加上以下事件字段：`id`、`type`、`occurredAt`、`tags`，以及存在时的 `vmId`、`projectId`、`jobId`、`scope`、`status`、`kind`。正文排除命令、任务标题、错误正文、告警消息、日志、配置值和控制凭证。

## 验证签名

POST 使用 `Content-Type: application/json`，包含以下请求头：

| 请求头 | 内容 |
| --- | --- |
| `X-Sakura-Event` | 事件类型 |
| `X-Sakura-Delivery` | 此订阅版本和事件对应的稳定投递标识 |
| `Idempotency-Key` | 与投递标识相同 |
| `X-Sakura-Timestamp` | 此次发送的 Unix 秒数 |
| `X-Sakura-Signature` | `sha256=` 加十六进制 HMAC-SHA256 |

签名使用**十六进制解码后的密钥字节**，签名内容为时间戳、一个点和未经重新序列化的原始 JSON 正文。Node.js 验证计算示例：

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const expected = createHmac('sha256', Buffer.from(secretHex, 'hex'))
  .update(timestamp + '.')
  .update(rawRequestBody)
  .digest();
const formatOK = /^sha256=[a-f0-9]{64}$/.test(signature);
const received = formatOK ? Buffer.from(signature.slice(7), 'hex') : Buffer.alloc(0);
const fresh = /^\d+$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
const valid = fresh && received.length === expected.length && timingSafeEqual(received, expected);
```

接收端需限制正文大小，验证签名及时间戳后，以投递标识持久去重。完成可靠接收后返回 2xx；重复标识也返回成功。不要仅靠进程内缓存去重。

## 重试、取消和维护

发送前先保存队列和本次尝试记录。网络失败、超时、408、429、5xx 最多自动尝试 5 次，退避为 30 秒、2 分钟、10 分钟、30 分钟。429/503 的秒数形式 Retry-After 可延后下次尝试，最大一小时。其他非 2xx 状态直接失败。每个请求限时 10 秒，串行发送，每轮最多处理 10 次；保存响应状态，不保存远端响应正文。

成功响应丢失或服务在发送后退出时，恢复后可能重复发送**同一投递标识**。重试失败记录也是同一标识；HTTP 2xx 只表示接收端接受了事件，不代表其业务处理已完成。

最多保留 500 项待发送及最近 200 项已结束记录。队列满时已排队事件仍保留，新事件等待后续采集，设置页显示采集错误；界面显示最近 50 条，API 提供完整保留记录。修改、停用、移除订阅及轮换密钥会取消旧版本积压并中断当前请求，不能撤回已被接收端接受的事件。取消不会改送到新的接收地址。迁移数据目录时暂停；关闭服务中断网络并等待队列写入；会话锁定期间已配置的后台投递继续运行。

控制接口是受本机会话与凭证保护的 `GET /api/webhooks` 和 `POST /api/webhooks`。POST 支持 save/remove/rotate/test/retry/cancel，配置修改通过版本号检查冲突；OpenAPI 与生成的 JavaScript SDK 包含完整请求合约。浏览器和通用 SDK 不自动重放配置或测试请求。
