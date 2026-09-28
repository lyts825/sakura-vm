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

签名原文是 UTF-8 编码的紧凑 JSON，键顺序固定为 `schemaVersion,id,name,description,version,sha256,publisher`，不包含 `signature` 和 `wasmUrl`。发布者使用 Ed25519 对这些字节签名。可参考 [测试中的签名构造](../tests/community-plugins.test.ts)。目录内容仅用于发现，信任由管理员登记的公钥决定；修改名称、描述、版本或文件哈希都会使签名无效。

插件必须是 WebAssembly v1 模块，不能导入任何宿主函数、内存或模块，也不能声明函数表。它需导出一个最大值不超过 256 页（16 MiB）的 `memory`，及两个函数：`alloc(i32) -> i32` 和 `run(i32, i32) -> i32`。宿主把 JSON UTF-8 输入写到 `alloc` 返回的位置，调用 `run`；返回值指向 4 字节小端输出长度，后面是最长 64 KiB 的 JSON UTF-8 结果。单次输入最长 32 KiB，执行最长 1 秒，同时最多 4 个工作线程。插件不具备文件、网络、虚拟机或系统 API；它适用于对传入数据做纯计算。需要访问宿主能力的扩展仍需其他协议，当前不由此沙箱开放。

管理接口为 `GET /api/community-plugins` 和 `POST /api/community-plugins`，沿用 Sakura 管理员会话。POST 的 `operation` 可为 `trust`、`untrust`、`add-source`、`remove-source`、`refresh`、`install`、`uninstall`、`run`。插件中心提供同样的操作。第三方插件目前不会自动订阅事件，也不贡献导航页或 HTTP 路由；这些仍属于未完成的插件 API 范围。

这是一种严格的无宿主导入计算环境，不是通用 Node.js 插件。发布者签名认证文件来源，不证明插件计算结果可信。管理员应核对发布者公钥指纹与目录源身份。
