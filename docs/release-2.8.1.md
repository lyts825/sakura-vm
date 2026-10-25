# 2.8.1 安全修复

## 版本与范围

2026-10-25，应用及内置包从 2.8.0 更新至 2.8.1。修复网络请求、集合校验和开发工具依赖的已知漏洞。插件数量保持 201 个、26 个包，宿主 API 保持 5。

| 依赖 | 原锁定版本 | 修复后版本 | 作用 |
| --- | --- | --- | --- |
| Undici | 7.30.0 | 7.30.1 | 修复多重内容编码响应提前断开导致的进程崩溃，以及该版本范围内的其他公告 |
| Zod | 4.6.5 | 4.6.7 | 包含 4.6.6 的集合资源耗尽修复及后续补丁 |
| Vite | 7.3.6 | 7.3.7 | 修复开发服务器和编辑器启动相关公告 |
| source-map-js | 1.2.1 | 1.2.2 | 修复恶意索引 source map 导致的同步阻塞 |

上游依据：[Undici 公告](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c)、[Zod 公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、[Vite 发行记录](https://github.com/vitejs/vite/releases/tag/v7.3.7)和 [source-map-js 修复记录](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)。锁文件固定具体字节，安装下限也已同步。

## 实际请求路径

受管网络改用 npm 安装的修复版 Undici `fetch`，继续使用原专属 dispatcher、连接归属和取消信号。设置、更新器、CLI、可信插件和模型评测均通过这条路径，不再调用 Node 内置的旧实现。

网络适配接受 Node 原生 Headers、FormData 和 Request。URL 加原始字符串、Blob 或 FormData 的请求保持可重放；原生 Request 已封装的正文只按公开流传输。需要重投该正文或使用 keepalive 时，抛出 `NETWORK_REQUEST_BODY_NOT_REPLAYABLE`；流正文也不支持 `mode: 'no-cors'`。这些调用应改传 URL 和原始正文。适配器不缓冲整个上传，也不读取运行时私有状态。

## Node SDK 的兼容变化

生成 SDK 在浏览器中继续默认使用浏览器的 `fetch`。Node 调用方须显式提供修复版实现；未提供或直接提供 `globalThis.fetch` 时，在发送请求前抛出 `SDK_NODE_FETCH_REQUIRED`。SDK 不隐式安装或加载依赖。

```sh
npm install undici@^7.30.1
```

```js
import { fetch } from 'undici';
import { SakuraClient } from './sakura-client.mjs';

const client = new SakuraClient({ fetcher: fetch });
const machines = await client.call('core.vms.list');
```

主机 Node 的内置库没有被替换。上述修复作用于 Sakura 及其发行工具；其他程序直接使用旧 Node 内置 `fetch` 时，仍应升级其运行时或调整调用实现。

## 验证与交付

完整 `npm audit` 和生产依赖审计均为 0 条告警。60 项既有核心、网络、SDK 和输入回归通过；漏洞专项的 28 项网络、23 项 Zod、7 项 SDK 检查也通过。旧版负对照只在受限子进程中执行，不影响主服务。

完整构建、1,578 模块架构、298 个显式服务、2,266 条 HTTP 契约及生产烟雾验收通过。独立安装目录不含应用源码或开发依赖，生产审计为 0；编译网络入口拒绝恶意响应后仍正常请求，201 插件全启用、默认空配置及退出清理均通过。安装态复用已准备的 QEMU 路径和 4 份 PosixLoom 运行资源。

测试脚本、恶意响应样本和报告保留于 Git 忽略目录 `artifacts/security-2.8.1/`。实现提交为 `e98978a`；2.8.1 契约快照从该提交的 107 份声明冻结，并核对既有版本兼容性。交付记录由本地 `v2.8.1` 标签定位，尚未推送或发布。
