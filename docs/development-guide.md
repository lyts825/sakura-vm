# 源码阅读与维护指南

核对日期：2026-10-23；应用与内置包版本：2.5.0；宿主插件 API：5；公共服务契约：V1。全部主题文档见 [文档索引](README.md)，当前交付状态见 [项目状态](../PROJECT_STATUS.md)。

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

模块和函数说明采用中文与英文对应书写。模块头解释职责、与其他模块的关系和适用边界；具名函数、局部辅助函数、类方法、构造器、访问器、公开可调用类型及复杂匿名回调说明功能、实际参数、结果和可观察副作用。没有实现体的接口描述调用约定，不将接口声明写成已经实施的校验。

复杂流程另写“设计思路 / Design”，解释为何按当前顺序组织操作：身份与代次在什么时点复核，取消后谁清理迟到资源，事务在哪一步提交，重试需要什么条件，以及平台限制如何影响实现。说明应能从函数体、调用处或公开契约核实；不能仅拆解函数名称，也不能把一次模型断言扩大为真实环境保证。简单赋值和自明控制语句无需逐行翻译；短小回调可以由所属函数和相邻流程说明覆盖。

TypeScript/JavaScript 使用 JSDoc 或相邻块注释，Python 使用普通注释保留原有 docstring、编码声明和反射结果，C/C++、C# 与 PowerShell 沿用所在文件格式。参数与结果描述保留代码标识符，中文解释和英文解释保持相同含义。协议字符串、命令文本和编译指令保持原值；嵌入式诊断程序由生成或执行它的所属函数解释。对 PowerShell `Add-Type` 内的自有 C# 实现补注释时，单独验证该段 C# 去注释后的词法序列，外层 PowerShell 除这段编译源码外保持词法等价。修改实现时同步核对两种语言的说明。

例如，异步连接函数应说明它获取什么连接、返回的是连接还是清理函数、失败向谁传播；如果创建过程可以被取消，应同时解释为何建立连接后还要检查请求代次，以及过期连接由哪个分支释放。测试夹具应解释它替换哪些适配器、怎样注入失败、怎样恢复状态，而不是宣称它证明了生产平台的隔离能力。

可从下列具体函数阅读复杂流程的双语设计说明：

| 模块与函数 | 重点阅读 |
| --- | --- |
| [服务生命周期](../server/service-lifecycle.ts) `start`、`close` | 启动依赖、就绪与准入的区别；消费者先关闭，清理失败时保留提供者供重试 |
| [资源范围](../server/resource-scope.ts) `close`、`retryCleanup` | 共享关闭 Promise、依赖顺序、已成功资源不重复清理 |
| [服务代理](../server/service-broker.ts) `handle` | 公共契约过滤、提供者/借用者状态、异步借用与嵌套返回的检查点 |
| [Git 项目任务](../server/git-project-task.ts) `runCaptured` | 捕获配置与客户机身份、租约准备、异步步骤后重检及清理失败合并 |
| [原生项目身份](../native/project-identity/controller.py) `execute`、`stop` | 完成后检查输出大小；独立、继承与 SSH 停止模式的实际发布和清理顺序 |
| [同步策略](../shared/sync-policy.ts) `matchesSyncPattern` | 项目专用的 `*` / `**` 规则、正则字面转义与路径边界 |

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

## 仓库目录与本地材料

正式源码、配置、文档、资源和版本记录由 Git 管理。主题说明集中在 `docs/`，根目录保留项目入口、配置与 `PROJECT_STATUS.md`。

| 目录 | 用途与维护边界 |
| --- | --- |
| `src/`、`server/`、`shared/`、`plugins/` | 应用源码、共享契约与插件 |
| `native/`、`browser-extension/`、`public/`、`scripts/` | 原生组件、扩展、静态资源与开发运行入口 |
| `docs/`、`server/service-contracts/releases/` | 主题文档与已提交的服务契约基线 |
| `sakura-promo-video/` | 独立视频源码、资源与正式成片；本地缓存按子项目规则忽略 |
| `tests/`、`e2e/`、`integration/` | 现有 CI 验证入口；新增本地材料放入 `artifacts/` 或命名为 `tests/*.local.*` |
| `.data/`、`.sakura-update/`、`versions/` | 本地实例、更新与运行版本状态；即使被忽略，也应保留，清理前核对运行及恢复用途 |
| `node_modules/`、`.tools/`、`.vendor/` | 本机依赖与运行工具；普通仓库整理保留 |
| `dist/`、`.sakura-server/`、`.sakura-witness/`、`release/` | 构建与打包产物；清理前核对启动、交付及回退引用 |
| `artifacts/`、`test-results/` | 本地复现脚本、报告、日志与测试产物；有用证据保留，确认失用后才删除具体路径 |

`.gitignore` 只决定 Git 是否收录文件，不作为删除依据。删除或移动目录前，核对绝对路径位于工作区内、没有链接跳转，并确认文件来源及引用。避免使用 `git clean -fdx` 清空本地数据、依赖或交付物。

取消跟踪已有测试前，检查 `package.json`、TypeScript 配置与 CI 的引用。当前自动验证直接依赖这些入口，批量取消跟踪会破坏新检出环境；因此保留已有入口，新增本地测试材料继续忽略。

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

只调整仓库文档位置、忽略规则或本地缓存时，应用版本保持不变，以独立维护提交记录，保留原应用发布标签及服务契约基线。

迭代开始记录基线、目标、范围与验收要求，完成后更新 [项目状态](../PROJECT_STATUS.md)。普通实现提交后，使用 `npm run plugins:contracts:freeze -- --release <版本> --commit <实现提交>` 冻结已提交的服务声明；冻结和简短验证结论再形成交付提交，以本地 `v<版本>` 标签定位。提交号由 Git 和冻结文件给出，避免在该提交自己的正文中写入自引用哈希。

提交前核对任务差异，清理本轮无用临时文件，保留正式产物与仍有用途的验证证据。实现、验证、本地提交、标签、外部发布各自报告；本地标签不会自动发布或部署。
