# 开发工作台与安全维护

这轮新增的十项功能均可从网页使用；后端操作也有 CLI 入口。实例相关操作作用于当前选中的 Linux 实例，长任务可在「任务中心」查看日志、结果与取消状态。

## 功能入口

| 功能             | 网页入口                          | 首版范围                                                                            |
| ---------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| Git 工作台       | 实例 → Git                        | 状态、工作区/暂存区差异、暂存、取消暂存、提交、本地分支、最近 30 次提交             |
| 多文件编辑器     | 实例 → 文件                       | 项目文件树、最多 20 个标签、独立草稿、行号、语法高亮、查找替换、项目全文搜索        |
| 全局命令面板     | 右上角「快速前往」或 Ctrl / ⌘ + K | 切换、创建和管理工作空间，搜索操作、当前项目文件和收藏命令，支持键盘选择与参数填写  |
| 开发工具管理     | 实例 → 开发 → 开发工具            | Git、Node.js/npm、Python/pip、Rust/Cargo、Go、Java、PHP，版本检测和发行版软件源安装 |
| 网络配置助手     | 实例 → 开发 → 网络配置            | HTTP(S) 代理、npm/pip 仓库、APK/APT 软件源、预览、连通性测试、恢复                  |
| 持续健康检查     | 实例 → 项目 → 多服务项目          | 检查命令、周期、超时、失败阈值、有限次自动重启与指数退避                            |
| 数据目录迁移     | 系统设置 → 数据目录迁移           | 空间检查、停机复制、逐文件校验、QCOW2 路径修复、重启切换和取消切换                  |
| 私密配置         | 实例 → 开发 → 私密配置            | Windows 账户加密保存、按名称引用、执行时注入、任务与项目日志脱敏                    |
| Docker / Compose | 实例 → 容器                       | Debian/Ubuntu 安装、容器启停/重启/删除、日志、镜像拉取/删除、Compose、数据卷列表    |
| 加密与外部备份   | 实例 → 快照 → 备份与加密导出      | 指定其他磁盘、密码加密、下载、校验、恢复为新实例、加密文件导入                      |

## 编辑与 Git

编辑器使用 CodeMirror，按文件类型按需加载 JavaScript/TypeScript、JSON、Python、HTML、CSS、Markdown、Java、Rust、Go、YAML 和 Shell 支持。Ctrl / ⌘ + F 打开查找替换，Ctrl / ⌘ + S 保存。切换文件保留各自的草稿；离开文件面板会询问是否保留草稿并离开。草稿保存在当前浏览器，浏览器存储不可用时会提示。项目文件树支持方向键展开、收起和移动焦点，Enter 打开文件或切换目录。

保存使用文件版本校验；如果 Linux 内的文件已变化，显示服务器内容与当前草稿供合并。保存期间继续输入的内容不会被成功响应覆盖。文件上限仍是 1 MiB UTF-8 文本。

项目搜索从项目配置中的目录开始，跳过符号链接、`.git`、`node_modules`、虚拟环境及构建目录。单次最多扫描 4,000 项，显示最多 2,000 个文件或 200 处内容匹配，内容读取总量限制为 32 MiB；达到限制时页面会提示缩小范围。文件树有独立刷新按钮。

Git 工作台不执行 hooks、外部 diff/textconv 或 fsmonitor 命令。未跟踪文件也能预览差异。提交只包含暂存内容，可为本次提交填写作者和邮箱；分支操作不会强制覆盖本地修改。已提供 HTTPS 远程配置、fetch/pull/push 与分支合并入口；完整三方可视化冲突编辑器仍未实现。提交前扫描暂存区常见高置信度密钥特征，发现匹配会阻止本次提交，日志仅包含路径和行号。

## 命令、工具与网络

收藏命令在项目目录中执行。参数声明为 `NAME=默认值`，执行时通过环境变量传入，命令中使用 `"$NAME"`。参数值按 Shell 数据引用，不作为命令拼接执行；未声明的参数会被拒绝。命令定义本身是用户编写的 Shell 脚本。每个实例最多 50 个收藏，执行历史进入任务中心，参数值不单独写入历史。

工具版本和项目清单探测使用捕获原项目的 UID/GID、独立 home 与网络，完整任务清理后才释放准备租约；共享工具安装继续使用固定实例管理员环境，具体范围见 [项目工具任务](project-tool-tasks.md)。工具管理使用发行版当前配置的软件源，因此版本取决于发行版。`package.json`、`pyproject.toml`、`requirements.txt`、`Cargo.toml`、`go.mod`、`pom.xml`、`build.gradle` 和 `composer.json` 用于提示项目需要的工具；检测结果不代替项目依赖安装。

网络设置先预览文件修改，再凭预览校验值应用；文件在两步之间发生变化时拒绝写入。修改前会保存恢复记录，中途失败后仍可「恢复原配置」。恢复发现文件被外部修改时会保留该文件并报出路径。重新配置前先恢复上一份设置。

代理地址只接受不含凭证、查询参数的 HTTP(S) URL。`10.0.2.2` 是 Linux NAT 访问主机的地址；代理实际是否接受该连接由主机代理配置决定。代理和 npm/pip 设置应用于新的登录 Shell 与 Sakura 项目/工具任务；已经运行的进程需重新启动。APT 修改只针对 Debian/Ubuntu 源 URI，保留第三方仓库、注释与签名配置。Docker 守护进程的代理需在 Linux 内单独配置。

## 私密配置与健康检查

私密值保存在数据目录的 `secrets/<实例 ID>.json`，通过 Windows DPAPI 的 `CurrentUser` 保护；API 列表只返回名称和更新时间，不提供读取明文接口。该功能需要 Windows，恢复密文仍需创建它的 Windows 账户。见 [Microsoft ProtectedData 文档](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata)。

项目和服务配置使用名称引用，例如：

```json
{
  "directory": "/workspace/app",
  "secrets": { "API_TOKEN": "api-token" },
  "services": [
    {
      "name": "api",
      "command": "npm start",
      "health": {
        "command": "curl -fsS http://127.0.0.1:3000/health",
        "interval": 30,
        "timeout": 5,
        "failures": 3,
        "restart": true,
        "maxRestarts": 3,
        "backoff": 10
      }
    }
  ]
}
```

私密值只在执行时解密并注入环境。任务输出支持跨分块脱敏，项目运行日志和容器日志也会替换已引用的私密值。程序主动变换、编码或写入文件的秘密不在这项日志替换的范围内。`sakura.json`、实例导出包只包含引用，不包含主机私密配置库；恢复或克隆后需重新建立引用的私密配置。Linux 磁盘自身的文件和运行日志仍包含在实例备份中。

健康检查在通过 Sakura 启动服务后生效，同时检查 tmux 会话和检查命令退出码。连续失败达到阈值后，在上限内重启服务与已启用且依赖它的服务；间隔按退避基数翻倍，最大一小时。手动停止后不会自动拉起；失败的停止请求不会撤销原有监控意图。重启上限是每次手动启动期间的累计值，达到上限后需检查日志并手动启动。控制服务重启后不会自动恢复之前的运行意图。

## 容器

安装使用 Debian/Ubuntu 自带的软件包 `docker.io`，并选择 `docker-compose` 或 `docker-compose-v2`。兼容 `docker compose` 和旧版 `docker-compose`，使用当前项目目录和实例对应的 Compose 项目名。Compose 文件路径必须是项目内相对路径。

删除容器不会带 `--force`，删除镜像也不会强制解除使用关系；Compose down 不删除命名卷。容器日志最多返回最近 200 行。软件包安装与镜像拉取需要能访问相应软件源、镜像仓库；网络错误显示在任务中。容器端口通过现有「服务」面板映射到主机。Docker 命令语义见 [Docker Compose 文档](https://docs.docker.com/reference/cli/docker/compose/)。

## 加密备份

在备份策略中填写外部目录，新文件位于 `<外部目录>/sakura-backups/<实例 ID>/`。已有备份保留原存储路径。手动创建时可输入至少 10 个字符的密码，计划备份可引用一项私密配置作为密码。一次性密码不保存；加密备份需要回到原面板填写密码或使用当前的密码引用重新创建，以免重试时因配置变化而意外生成未加密文件。

`.sakura.enc` 使用 scrypt 派生密钥、随机 salt/nonce 和 AES-256-GCM；头部作为认证数据，错误密码、内容损坏或截断都会被拒绝。解密完成并通过认证后才导入实例；校验/恢复过程临时生成的明文文件在结束时清理。加密 API 的实现依据 [Node.js Crypto 文档](https://nodejs.org/api/crypto.html)。

创建和校验都会检查内部磁盘校验值；备份记录还保存整个文件的 SHA-256。恢复创建新实例，不覆盖现有实例。可在「镜像库」导入下载的加密文件。备份密码引用改名、删除或改值后，旧备份可通过手动输入原密码校验和恢复。

## 数据目录迁移

1. 停止全部实例，等待后台任务结束。
2. 在系统设置输入尚未存在的目标绝对路径，检查空间并预览。
3. 开始迁移。维护锁阻止新操作；按文件复制和校验，然后修复 QCOW2 基础镜像引用、数据目录内的备份目录记录，并比较迁移前后的虚拟磁盘内容。内部快照随 QCOW2 一起保留。
4. 完成后重启 Sakura。启动时读取旧目录中的 `.sakura-redirect.json`，核对新目录的完成标记，再使用新目录。已有 SSH Include 路径会转向新位置。

原目录保留。重启前可点击「继续使用原目录」撤销切换；取消或失败不会启用未完成的目标。失败时可能留下尚未启用的目标副本，页面/任务保留错误信息，重新迁移需另选未使用的目标路径。

迁移包含当前数据目录内的镜像、实例、快照、备份、配置和私密库；位于目录外的镜像/备份不搬移。PosixLoom 临时运行数据与临时传输文件不会复制。目标需容纳所有文件并额外保留 64 MiB，目录不能包含符号链接/联接，也不能与源目录相互包含。复制完成后如需释放旧磁盘空间，应先确认新目录可用，并保留重定向文件或将 `SAKURA_DATA_DIR` 改为新路径。QCOW2 backing file 操作见 [QEMU qemu-img 文档](https://www.qemu.org/docs/master/tools/qemu-img.html)。

收藏命令、网络恢复记录和自动备份策略属于主机实例配置，随数据目录迁移；`.sakura` 实例导出仍只携带磁盘、实例身份、资源与项目配置。

## CLI 示例

```powershell
npm run sakura -- git my-dev status
npm run sakura -- git my-dev diff src/main.ts
npm run sakura -- git my-dev stage src/main.ts
npm run sakura -- git my-dev commit "Update application"
npm run sakura -- git my-dev branch feature/workbench
npm run sakura -- project-files my-dev greeting --content
npm run sakura -- tools my-dev install git node python
npm run sakura -- commands my-dev save preset.json
npm run sakura -- commands my-dev run <preset-id> values.json
node scripts/cli.mjs network my-dev preview network.json > network-preview.json
npm run sakura -- network my-dev apply network-preview.json
npm run sakura -- network my-dev restore
npm run sakura -- secrets my-dev list
npm run sakura -- health my-dev
npm run sakura -- containers my-dev install
npm run sakura -- containers my-dev compose-up compose.yaml
npm run sakura -- backup-download my-dev <backup-id> backup.sakura.enc
node scripts/cli.mjs migration preview E:\SakuraData > migration-preview.json
npm run sakura -- migration start migration-preview.json
```

写入私密配置使用环境变量 `SAKURA_SECRET_VALUE` 配合 `secrets <实例> put <名称>`；`backup` 和 `import` 使用 `SAKURA_BACKUP_PASSWORD` 传递密码，避免密码出现在命令参数中。使用后清除这些环境变量。CLI 不输出私密值。导出预览 JSON 时直接使用 `node scripts/cli.mjs`，避免 npm 的标题混入 JSON。

## 验证

运行 `npm test` 和 `npm run build`。新增单元测试覆盖加密认证、损坏与取消、DPAPI、日志脱敏、输入校验、网络恢复冲突、编辑保存竞态、迁移预览与取消，以及健康检查退避和 CLI 预览令牌。

`npm run test:development` 在临时独立数据目录创建真实 QEMU 实例，验证 Alpine 开发工作流、加密备份与恢复开机、Debian/Ubuntu Docker 和 Compose，以及含快照的磁盘迁移。容器测试使用本地 busybox 镜像，避免把 Docker Hub 的可达性作为容器管理功能的前提；仍需访问发行版软件源。`-- --skip-containers` 可只运行开发与存储流程。测试结束会关闭所建实例并清理它自己的临时目录。
