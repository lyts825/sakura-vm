# 源码阅读与维护指南

核对日期：2026-10-07；应用与内置包版本：2.3.6；宿主插件 API：5；公共服务契约：V1。全部主题文档见 [文档索引](README.md)，当前交付状态见 [项目状态](../PROJECT_STATUS.md)。

## 从哪里开始读

| 目标 | 入口与阅读顺序 |
| --- | --- |
| 启动与退出 | `server/index.ts` → `application.ts` → `application-services.ts`、`service-lifecycle.ts`、`resource-scope.ts` |
| HTTP 与 WebSocket | `application-http.ts`、`application-websocket.ts` → `operation-gateway.ts` → `core-http-handlers.ts`、各插件 `server.ts` |
| 插件声明和跨插件调用 | `shared/plugin-protocol.ts`、`plugin-schema.ts`、`plugin-resolver.ts` → `server/plugin-manager.ts`、`plugin-runtime.ts`、`service-broker.ts` |
| VM 生命周期与资源 | `server/machines.ts` → `vm-ports.ts`、`domains/` → `host-runtime/`、`network/`、`storage-runtime.ts` |
| 项目账号与执行 | `server/project-identity.ts`、`project-run-scope.ts`、`project-preparation.ts` → `native/project-identity/` 与具体任务入口 |
| 浏览器状态 | `src/main.tsx` → `src/app/App.tsx`、`use-controller-state.ts`、`use-project-selection.ts` → 对应插件 `client.tsx` |
| 构建、安装与 CLI | `package.json` 的 scripts → `scripts/setup.mjs`、`launch.mjs`、`cli.mjs`、`prepare-server-assets.mjs` |

详细依赖与资源所有权以 [架构说明](architecture.md) 和 [插件设计契约](plugin-design-contract.md) 为准。`shared/contracts/` 是浏览器与服务端共用的传输类型，`server/service-contracts/v1.ts` 是跨服务公开接口；实现类新增方法不会自动扩大公共服务能力。

## 注释约定与覆盖范围

模块头说明职责，接口注释说明输入、输出或边界，流程注释说明代码背后的约束。重点记录身份与代次复核、取消后的清理、事务提交点、重试条件和平台限制。简单赋值和自明的控制语句无需逐行解释；修改实现时同步核对相邻注释。

本次覆盖 Git 管理的自有 TypeScript、TSX、JavaScript、Python、C/C++、C#、PowerShell、CSS、HTML 和相关运行配置，包括既有测试入口、浏览器扩展、原生辅助程序与宣传视频源码。测试模块的范围注释沿用实际用例标题，完整验收条件仍由断言定义；模拟夹具或可移植模型不能证明真实 VM 或 Linux 隔离能力。

第三方 `native/windows-clipboard/vendor/`、运行时依赖、Wayland 上游协议 XML、二进制资产与严格 JSON 数据保留其原格式和来源。JSON 配置的约束写在对应 Schema 或使用说明中。生成代码由生成器写入职责说明，不直接手改生成产物。

## 安装与开发

根项目要求 Node.js 22.12+。首次环境准备见 [快速启动](../README.md#快速启动)；Windows 原生源码构建所需编译器见 [原生剪贴板说明](native-clipboard.md)，Linux 运行环境见 [WSL 后端](wsl-backend.md)。

```powershell
npm ci
npm run setup
npm run dev
```

开发服务默认监听 `127.0.0.1:7337`。`.data/` 保存实例、镜像和私钥；准备环境与真实 VM 验证前先核对数据目录归属。只改注释或文档通常不需要启动 VM、重新安装客户机软件或下载运行时。

宣传视频是独立子项目，保持自身版本和依赖，入口及渲染步骤见 [视频说明](../sakura-promo-video/README.md)；主应用的版本迭代不自动提升视频版本。

## 生成文件与权威来源

| 文件或目录 | 权威来源与同步命令 |
| --- | --- |
| `shared/plugin-catalog.generated.ts`、`server/plugins/loaders.generated.ts` | 插件与整合包清单；`npm run plugins:sync` |
| `shared/contracts/api-client.generated.ts`、HTTP 契约 JSON | 操作目录与请求/响应 Schema；`npm run plugins:schema` |
| `shared/contracts/websocket-client.generated.ts`、WebSocket 契约 JSON | WebSocket 贡献与通道 Schema；`npm run plugins:schema` |
| `server/public-service-members.ts` 服务描述符 | `server/service-contracts/v1.ts`；`npm run plugins:contracts`，普通检查不会更新发布基线 |
| `server/service-contracts/releases/` 发布基线 | 已提交的版本接口与关联类型；`npm run plugins:contracts:freeze -- --release <版本> --commit <实现提交>` |
| 繁体本地化资源 | `src/`、`plugins/` 的 TS/TSX 文本、字符串与模板片段，经 OpenCC 转换；`npm run locales:build` |
| `docs/unfinished-features.md` | 基础、工程、平台静态功能目录的状态及脚本中的待验收范围；`npm run features:audit` |
| 宣传视频字体与来源清单 | 视频 TS/TSX 源码及字幕文字；使用视频 README 中的 `scripts/fonts_generate.py` 生成与 `--check` 流程 |

生成命令可能更新多个文件。提交前核对差异，生成文件头的注释应在生成器模板中修改。版本基线 `server/service-contracts/releases/` 保存当时已提交的声明源码，不作为当前源码编辑。

视频字体生成器扫描完整源码，中文注释也进入字符集合和源码摘要。维护注释后需要复核字符覆盖及来源清单；字体同步无需重新导出内容未变化的成片。主应用字体另有 `scripts/build-fonts.py`，普通构建不执行该脚本；新增可见文案时按 [字体说明](../src/assets/fonts/README.md) 处理。

## 最小必要验证

| 改动 | 优先验证 |
| --- | --- |
| 纯文档、注释 | 差异与本地链接检查；确认 shebang、编码声明、指令和字符串未被改变 |
| TypeScript 或生成器 | `npx tsc --noEmit`；`npm run architecture:check`；`npm run plugins:check`；涉及语言资源时加 `npm run locales:check` |
| 单个功能 | `npx tsx --test tests/<相关模块>.test.ts`，或对应 `package.json` 快速验证入口 |
| 浏览器交互 | 相关 Playwright 用例；`npm run test:e2e` 使用生产预览，先构建 |
| VM、项目身份或磁盘 | 对应 `test:*` 真实运行入口；需要覆盖集成时使用 `npm run verify:vm` |
| 发布候选 | `npm run verify`；构建包含原生辅助程序、浏览器与服务端资产，不等同于仅通过类型检查 |

`npm run verify` 当前串联架构、插件、语言资源、单测、构建、分发检查、生产冒烟与浏览器 E2E；`verify:vm` 是独立真实 VM 门禁。`.github/workflows/ci.yml` 在 Windows 与 Ubuntu 上运行这些入口。沿用此前确认的约定，保留已有 CI 必需测试；新增本地验证脚本、截图和报告存放被忽略的 `artifacts/` 或精确忽略的本地测试路径，避免破坏克隆后的验证入口。

测试通过只能说明对应情景已验证；平台跳过、未运行的原生编译或真实 VM 检查必须单独列出。本轮的实际验证结论见 [项目状态](../PROJECT_STATUS.md)。

## 版本与交付

采用 `MAJOR.MINOR.PATCH`：不兼容变更提升主版本，兼容新功能提升次版本，兼容修复或维护提升补丁版本。应用版本同步根 `package.json`、`package-lock.json`、`shared/version.ts` 与 `shared/plugin-protocol.ts` 的内置包版本；插件 API 与服务契约版本按真实兼容性变化独立处理。

迭代开始记录基线、目标、范围与验收要求，完成后更新 [项目状态](../PROJECT_STATUS.md)。普通实现提交后，使用 `npm run plugins:contracts:freeze -- --release <版本> --commit <实现提交>` 冻结已提交的服务声明；冻结和简短验证结论再形成交付提交，以本地 `v<版本>` 标签定位。提交号由 Git 和冻结文件给出，避免在该提交自己的正文中写入自引用哈希。

提交前核对任务差异，清理本轮无用临时文件，保留正式产物与仍有用途的验证证据。实现、验证、本地提交、标签、外部发布各自报告；本地标签不会自动发布或部署。
