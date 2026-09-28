# 第三方 WebAssembly 插件

插件中心可管理独立的第三方插件。管理员先登记 Ed25519 发布者公钥，再添加 HTTPS 目录 URL，刷新目录并安装。安装时 Sakura 下载不超过 512 KiB 的 WebAssembly 文件，核对 SHA-256 和签名；运行前再次核对文件。卸载会终止正在执行的对应工作线程并移除文件。内置插件仍使用原有受信任的生命周期协议，两类插件互不冒充。

目录返回以下 JSON。`wasmUrl` 必须解析到目录 URL 的同一 HTTPS origin；重定向不会跟随。

```json
{
  "schemaVersion": 1,
  "plugins": [{
    "schemaVersion": 1,
    "id": "example-plugin",
    "name": "Example",
    "description": "Returns JSON from a bounded computation.",
    "version": "1.0.0",
    "sha256": "<64 lowercase hex characters>",
    "publisher": "<SHA-256 of Ed25519 SPKI DER, lowercase hex>",
    "signature": "<base64 Ed25519 signature>",
    "wasmUrl": "./example.wasm"
  }]
}
```

签名原文是 UTF-8 编码的紧凑 JSON，键顺序固定为 `schemaVersion,id,name,description,version,sha256,publisher`；声明扩展时再追加 `extensions`。不包含 `signature` 和 `wasmUrl`。扩展结构的键顺序固定为 `routes,panels`，路由为 `id,name`，面板为 `id,title,description,routeId,fields`，字段为 `key,label,type,required`。发布者使用 Ed25519 对这些字节签名。可参考 [测试中的签名构造](../tests/community-plugins.test.ts)。旧目录不声明扩展时，签名原文保持不变；修改已签名的扩展声明会使安装失败。

可选的签名扩展声明示例：

```json
{"routes":[{"id":"inspect","name":"Inspect"}],"panels":[{"id":"summary","title":"Summary","description":"Inspect JSON","routeId":"inspect","fields":[{"key":"text","label":"Text","type":"text","required":true}]}]}
```

将这个对象作为单个插件条目的 `extensions` 字段。最多声明 8 个固定路由、4 个面板，每个面板最多 8 个纯表单字段。面板只能引用已声明的路由，只渲染文本、数字和布尔值输入；插件不能注入 HTML、脚本或任意导航页面。管理员调用 `POST /api/community-plugins/extensions/{pluginId}/{routeId}` 时，服务再次验签并将 `{ "kind":"http", "routeId":"...", "body":... }` 交给隔离 WASM；该路径需要管理员会话，不能绕过输入、时间和内存限制。

插件必须是 WebAssembly v1 模块，不能导入任何宿主函数、内存或模块，也不能声明函数表。它需导出一个最大值不超过 256 页（16 MiB）的 `memory`，及两个函数：`alloc(i32) -> i32` 和 `run(i32, i32) -> i32`。宿主把 JSON UTF-8 输入写到 `alloc` 返回的位置，调用 `run`；返回值指向 4 字节小端输出长度，后面是最长 64 KiB 的 JSON UTF-8 结果。单次输入最长 32 KiB，执行最长 1 秒，同时最多 4 个工作线程。插件不具备文件、网络、虚拟机或系统 API；它适用于对传入数据做纯计算。需要访问宿主能力的扩展仍需其他协议，当前不由此沙箱开放。

管理接口为 `GET /api/community-plugins` 和 `POST /api/community-plugins`，沿用 Sakura 管理员会话。POST 的 `operation` 可为 `trust`、`untrust`、`add-source`、`remove-source`、`refresh`、`install`、`uninstall`、`run`、`subscribe`、`unsubscribe`、`schedule`、`unschedule`。插件中心提供同样的操作。

安装后管理员可提交 `{"operation":"subscribe","pluginId":"example-plugin","types":["job.finished","alert.raised"],"enabled":true}`。Sakura 每五秒读取内部任务和告警事件，为订阅开始后 24 小时内的新事件运行插件。输入仅含事件 ID、类型、时间、实例/项目 ID、状态、类别和标签等固定元数据，不含命令、日志、标题或消息。相同插件与事件会持久去重；启动时会恢复尚未完成的触发任务。结果预览和失败原因最多保留最近 200 条记录。暂停后再次启用会从启用时刻开始，不补发历史事件。卸载插件会移除订阅并终止其运行中的工作线程。

管理员也可提交 `{"operation":"schedule","pluginId":"example-plugin","intervalMinutes":60,"enabled":true}`。周期为 1–1440 分钟；后台在到期时以 `{ "kind":"schedule", "scheduledAt":"..." }` 运行插件，持久记录结果。停机期间不会补跑错过的多个周期。暂停或移除会阻止后续触发。

扩展 HTTP 操作和面板都限制在插件中心及管理员 API 的命名空间内，不开放匿名入口、宿主文件/网络访问或任意前端代码执行。

这是一种严格的无宿主导入计算环境，不是通用 Node.js 插件。发布者签名认证文件来源，不证明插件计算结果可信。管理员应核对发布者公钥指纹与目录源身份。
