# 功能实现记录

以下按批次保存实际实现和验证。较早批次中标记的 DLL/TLS、普通 fork、认证依赖预取、原生 Wayland 受控入口、短任务进程归属，以及项目账号的 argv 正文运输和产品接入缺口，已有后续改进；历史摘要、摘要值和日志保留供追溯，不代表当前范围。最新范围与限制以下方第一节为准。

## Git 工作台的项目账号与原操作租约

2026-10-02 Git 状态、差异、索引、冲突探测、暂存、提交、分支及 HTTPS 远程命令接入原项目持久 UID/GID、独立 home、捕获配置/live 和保护帧。非枚举项目身份在复制后保留，原生目录描述符固定 cwd，环境只解析一次；完整 GET 操作或后台任务共用准备租约，每条命令保留原完整任务票据，全部 cgroup 清理和准确核销后才释放。配置或 live 改变停止后续步骤，清理 503 与全部 cause 保留，取消不覆盖原清理失败，规则见 [Git 项目账号](git-project-identity.md)。

保留原真实 Git 算法、NUL 解析、冲突版本、密钥扫描和脱敏，清除 Git 路径及 GIT_CONFIG_PARAMETERS 等环境注入。两处冲突编辑器读取/上传继续使用管理员 SFTP、1 MiB UTF-8、历史、expectedVersion 与 UID/GID/mode；不声明通用 Files 权限已迁移。原生正文/环境超限明确 413，不拆分或回退 root。正式 19 项本机真实 Git 回归与 17 项身份模型共 36 项通过，完整类型检查通过；证明为 `.data/git-workbench-identity-backend-b388dc0d-52f1-4b92-9302-77f31ad19fb8-verification.json`，实际退出 0、源码前后未变。本批未启动 VM，未重跑整仓测试，历史 Windows rename 失败证明保留；目录保持 250 项、247 项有入口、3 项部分实现。

## Notebook 项目账号、不可变依赖缓存与全域清理

2026-10-02 Jupyter/Marimo 安装、会话、内核与后代接入原项目持久 UID/GID、独立 home、捕获配置、完整服务票据与受保护正文。非枚举项目身份在配置和环境复制后保留并核对，准备固定原 live/boot；系统依赖和二进制 wheels 由固定清空环境的管理入口下载，不加载项目配置、环境、代码或钩子，项目账号离线创建虚拟环境。所有模式均使用原 UID 实际持有的监听与完整原票据核对后的回环桥接；重载不安装或发行新票据，停止先保存检查状态，原全部 cgroup 后代、pane 与保护帧确认清理后核销，未知状态及旧 root 记录保留。冷 boot 只退休准确旧资源，不向新 boot 发送旧停止，规则见 [Notebook 环境](notebook-environments.md)。

wheelhouse 固定 UUID/boot、目录及文件 device/inode、大小和 SHA，最多 512 个 wheels、合计 1 GiB；只读 manifest 最多 256 KiB。安装与退休只携带完整 manifest 摘要绑定的小型 pin，最大合法模型的 Jupyter/Marimo 安装 frame 为 5986/5974 字节，管理清理命令为 8028/8027 字节，管理命令另有 16 KiB 上限。完整原 UID 安装任务域确认关闭后才按原 parent FD 精确删除并确认不存在；垃圾、丢失应答及不确定清理保存原 lease/review，返回 503。上述大小为实际 SDK 编码及有限本地模型测量，不是实机下载证明。

正式源码六个相关测试文件共 198 项全部通过（Notebook 43 项、Browser 21 项及服务域、桥接、运行票据、Jobs 清理），完整类型检查通过；证明为 `.data/notebook-identity-backend-d4ae5a40-58a3-4cc9-bbb5-e49b26e5a27e-verification.json`，实际退出 0、源码前后未变。官方新临时实例 smoke 已适配明确目录迁移、真实 UID/home/环境、Jupyter WebSocket 内核所属域、两种模式的认证/桥接重载、原票据核销与有界测试目录清理；三个生成 Python 正文的静态语法检查通过，证明为 `.data/notebook-smoke-static-977abaf0-4bee-43f0-be1c-cc1df1fe6a18.json`。这次尚未运行新的 Notebook 客户机联测，未把历史 root 结果当作当前 UID 成功，也未重跑整仓测试。目录仍为 250 项、247 项有入口、3 项部分实现。

## 九项有限开发任务与清理失败保留

2026-10-02 能力中心的 test、test-discover、dependencies、lock、lock-check、install-locked，以及 worktree-list/add/remove 九项有限开发任务接入持久项目 UID/GID、独立 home、原网络和有界保护帧。提交同步固定原项目与 live 身份，复制保留非枚举项目 ID，准备捕获并核对一份原配置；环境只解析一次，执行和结果保存保持原租约，原 task/native 清理 503 与错误码继续传播。保留原任务中心入口、参数、退出码和日志脱敏；Lint/format 继续复用工程 UID helper。缓存安装的受限跨权限交接继续实现，缓存预取与 Docker 管理边界分别保留，使用范围见 [能力中心](feature-suite.md)。

补齐 Browser IDE、Notebook 会话及 wheelhouse 的三个准确清理错误码，取消不再把这些 503 记为普通 cancelled。正式三个相关测试文件共 41 项全部通过（17 项开发模型、3 项原能力中心回归及 21 项 Jobs 清理回归），完整类型检查通过；证明为 `.data/feature-dev-identity-backend-c8f55353-0923-4048-b3d0-565021adbcde-verification.json`，实际退出 0，源码前后未变。覆盖具名项目、捕获配置/live、更换运行、参数/frame、脱敏、完整清理与结果保存租约，以及取消后重载保留失败和 tracked 503/status/code。本批未启动 VM、未重跑整仓测试；目录保持 250 项、247 项有入口、3 项部分实现。

## 轻量代码诊断的项目账号

2026-10-02 Node、tsc、Python py_compile 和 JSON 诊断接入原项目 UID/GID、独立 home、捕获配置与受保护正文，保留原 HTTP/CLI API、文件范围和行列解析。请求在首次异步读取前固定原项目与 live 身份，非枚举项目标识在复制后独立保留，准备租约核对原配置摘要、项目和 live；环境只解析一次。单次任务时限 30 秒，整域及准确账号票据清理后才释放租约；结果发布前复核原绑定并脱敏，原 native 清理 503 不解析为编译诊断。每次检查独立拥有准备管理器，release 与 close 均尝试，多个失败保留全部原 cause 及 503/code，不需增加插件生命周期。使用范围见 [代码检查](development-next.md)。

正式诊断文件 19 项全部通过、完整类型检查通过，证明为 `.data/code-diagnostics-identity-backend-d9acbac7-86be-40ad-8364-c9ea797b6c4f-verification.json`；实际退出 0，源文件前后未变。测试包含所有检查类型、真实非枚举项目配置、相同配置摘要的错误租约、live/配置变化、参数与保护帧、秘密脱敏、清理错误、准备租约保护、缺失目录及多失败 cause。这批未启动 VM，不把本地运输模型视为实机 UID 检查，也未重跑整仓测试。独立 LSP、DAP 和其余入口继续推进，目录仍为 250 项、247 项有入口、3 项部分实现。

## 工程扩展的项目账号与配置捕获

2026-10-02 工程执行器的工作区文件、归档、Git、测试、命令宏和 Runbook 等项目操作，以及平台分片、矩阵子任务和环境指纹，已接入原项目持久 UID/GID、独立 home、捕获配置和完整短任务域。提交固定原项目与 live 身份，环境只解析捕获配置；可信源码和请求通过摘要及长度绑定的有界压缩数据进入保护帧，在降权后解码，不再写入 root 临时脚本。直接操作的结果保存与任务导入保持准备租约；取消等待整域及准确票据清理，原 503 和错误码继续传播。三个现有明确管理操作使用固定 root 环境、目录与有界 stdin，不加载项目配置或钩子，规则见 [工程操作](engineering-project-identity.md)。

修复了真实配置中非枚举 `_workspace` 被 `structuredClone` 丢弃的问题，原项目标识独立于 JSON 配置摘要保留并核对；同摘要的另一项目准备不能授权任务。旧能力任务夹具补齐 pinned live、非枚举项目身份与 ALS，复用真实宿主 journal 和二进制 frame，保留原 public Jobs 分片与矩阵断言。正式源码六个相关文件共 42 项全部通过，包含 19 项新模型；证明为 `.data/engineering-identity-backend-a3e6ebad-befe-4613-91c7-46fc8ca5e3c1-verification.json`，源码前后未变、实际退出 0，完整类型检查通过。首次 38/40 的旧夹具 false 证明继续保留，未检查的 sourceUnchanged=false 不代表实际源码漂移。

插件、语言资源、完整构建、分发检查和七种生产服务组合全部通过，942 个受核对文件前后保持一致；证明为 `.data/engineering-identity-build-482065fa-e758-42c5-9d4f-07b61835afdc-verification.json`。运行包 257 个文件通过完整清单核对，指纹 `513886ac8c3f761d4fa5a75e1cf9396251eb627633ec3a855ec1e556b2fb3d2b`；证明为 `.data/engineering-identity-release-20ba2691-1dfc-4445-ae3b-a903360b2935-verification.json`。这批未重跑整仓测试，历史 Windows rename EPERM 的原 false 证明继续保留。

这批为功能实现及本地验证，未运行新的工程 UID 客户机实测。跨实例能力的外层聚合与最终结果保存沿用原能力流程，不声明持有全部子任务租约。目录继续为 250 项、247 项有入口、3 项部分实现；Notebook、代码诊断、独立语言服务、调试适配器等其余入口仍在推进。

## 浏览器 IDE 的项目账号与到期全域清理

2026-10-02 Debian/Ubuntu 的 code-server、集成终端与扩展宿主接入持久项目 UID/GID、独立 home、受保护 stdin 与完整原服务票据。配置、用户数据和扩展保存在账号 home；共享发布包与系统工具由固定管理员入口安装。所有网络模式都使用核对后的本机回环 SSH 桥接，不建立 QEMU 端口映射。启动前先保存 Browser intent，只有原账号、boot、构建、cgroup inode、pane 创建身份、正文摘要及该 UID 持有的实际监听全部核对后才开放入口；SSH 连接完成后再次核对。规则见 [浏览器 IDE](browser-ide.md)。

停止先持久保存检查状态并关闭入口，清空原整个进程域和准确保护帧，再核销原 native/host 票据。失败保留完整归属，重载不安装或发行新票据。独立客户机守护逻辑在控制服务关闭后仍按时清理脱离终端的全部后代，重新加载后再确认核销；冷重启只在原资源确认不存在时退休旧票据，不向新 boot 发送旧停止。旧 root 会话保留检查状态，不自动接管其未知进程或缓存。

正式源码的四个相关文件共 134 项回归全部通过，涵盖 Browser 21 项、现有服务域、桥接与项目运行票据；证明为 `.data/browser-ide-identity-backend-5b605e70-b59a-4eb9-bbb3-03d783a265c1-verification.json`。固定 listener、pane、commit、watchdog Python 语法和截止时间/原归属拒绝检查通过，watchdog 的 transport 带原 SHA 与字节数。旧 Debian smoke 已适配明确迁移、UID/GID/home、完整原票据、两种模式回环桥接、真实 Chromium 与到期整域清理；其固定 Python、二进制 stdin 和类型检查通过。本段只记录功能实现与本地验证，不把改造后的脚本记为已通过新客户机实测。

插件、语言资源、完整构建、分发检查和七种生产服务组合通过，939 个受核对文件前后保持一致；证明为 `.data/browser-ide-identity-build-d7e2155a-ed58-4f22-98c8-08a84dca787c-verification.json`。运行包 264 个文件通过完整清单核对，指纹 `fde286cab18208d4f1af9d82a2b3256b004921421dc6679e6c323433695a04e7`；证明为 `.data/browser-ide-identity-release-f8eb3501-316b-424b-9142-ba02d5481f1b-verification.json`。新的独立 Ubuntu smoke 提供只读冻结/预检与明确运行入口，计划十项真实认证、WebSocket、账号、重载、整域、TTL 与冷重启检查；实际结果另行保存。本批未重跑整仓测试，前一 Windows rename EPERM 原 false 证明保留。目录继续为 250 项、247 项有入口、3 项部分实现，工程扩展、Notebook 及外部环境范围继续见 [未完成功能](unfinished-features.md)。

## 项目 SSH、SFTP 与编辑器入口的项目账号

2026-10-02 专属项目 SSH 的 Shell、命令、SFTP 与编辑器入口接入持久 UID/GID、独立 home、原项目目录及服务 cgroup。三种发行版的共享与私有项目均导出核对后的独立入口。固定 ForceCommand 只带账号、run 与摘要；真实客户端命令和环境经有界帧降权执行，独立描述符保留二进制 stdin、EOF 与 PTY。解析环境保存在 root 独占 JSON，不进入 root argv；旧 root 编辑器缓存保留。规则见 [项目 SSH](project-ssh.md)。

启动前保存宿主 intent，客户机先写受保护 SSH 完整回执再发行原生票据。发行应答丢失时，清理先恢复并保存原完整 daemon、boot 与 cgroup device/inode 票据，再关闭桥接并停止原域。只有 SSH 回执的中断状态仅允许清理恢复，不能授权普通会话或只读入场；原域消失后以不可覆盖的原子发布补齐原生记录，再退休回执和核销票据。权限变化、构建不匹配、容量或同步失败保留原记录供重试。

真实 Alpine 3.23 实机九项全部通过：UID/GID、home、目录、私有网络与捕获环境，512 KiB 二进制 stdin，256 KiB SFTP 与跨项目拒绝，PTY 输入/resize/Ctrl-C/退出，只读重载及权限拒绝，整域与脱离终端子进程停止、邻居保留和重建，无效 SESSION 帧，实际发行后丢失应答，以及明确注入的仅 SSH 回执持久状态。最后一项通过移除已核对的原生运行文件形成夹具，不声称捕获写入间的真实崩溃。证明为 `.data/project-ssh-identity-test-temp/sakura-ssh-identity-fMLJIu/project-ssh-identity-e022a2a6-8812-4532-8bc2-b22bc50a6d24.json`，摘要 `c0c623395f56cb75bb1d0d51925cb5d9c4eda6ab26fb7e3aeafd6bf74109584a`。268 个源码摘要未变，原缓存镜像未变，实际退出 0，实例、自有子进程和准确 QEMU/CIM 均已关闭。首轮 PTY 检查误读 ssh2 继承的 Node closed 状态，其 false 证明保留；改为实际 close 事件与退出码后完成复测。当前成功实机范围不包含 Debian/Ubuntu 或真实桌面编辑器客户端。

定向后端 138 项全部通过，证明为 `.data/project-ssh-identity-backend-00c7b71a-2089-40d9-a484-a60669e02465-verification.json`；其中原生 SSH 九组事务模型与归档十四组模型属于可移植检查。插件、语言资源、完整构建、分发检查和七种生产服务组合通过，937 个受核对文件前后保持一致；证明为 `.data/project-ssh-identity-build-3be1ab45-a7a1-4b01-b719-88e09cdc866d-verification.json`。运行包 264 个文件通过完整清单核对，指纹 `cf8902fd80712d481f80ec252ceb31a52f82da4e7bcc2520392cc7a3e7aea46a`；证明为 `.data/project-ssh-identity-release-42e59838-7424-49c7-b788-99793e0c8407-verification.json`。本批未重跑整仓测试，前一终端批次 Windows rename EPERM 的原 false 证明继续保留。目录仍为 250 项、247 项有入口、3 项部分实现；浏览器 IDE、工程扩展等其余账号入口继续实现，外部 HA 演练与系统级剪贴板边界见 [未完成功能](unfinished-features.md)。

## 收藏命令与流水线步骤的项目账号

2026-10-02 收藏命令和流水线步骤接入固定项目 UID/GID 启动器，命令、参数及环境通过有界保护帧运输。提交固定原项目，准备捕获一份配置和准确 live 实例，私密配置与运行时只解析这份配置。流水线各步骤独立任务 UUID、完整 cgroup 票据和时限，不在两步之间重新读取配置。准备租约保持到任务清理结束，流水线同时保持到产物收集及最终记录保存；取消和关闭会等待完整清理，借用服务的其他任务不被关闭。规则见 [项目命令任务](project-command-tasks.md)。

输出和错误消息继续脱敏；清理未确认保留原 503 和具体错误码。流水线将错误码同时保存到失败步骤、运行与任务历史，取消不把未确认清理记为正常取消，重载后仍显示失败，后续步骤与产物不执行。产物继续使用现有文件服务和原 32/64 MiB 上限，本次不声明该文件服务已迁移为新的 UID 访问边界。

新增十项宿主检查使用真实项目配置、准备租约和持久记录，并注入任务执行器；验证配置捕获、参数、活动项目切换、live 替换、迁移门闩、时限、绑定保护、取消、关闭与错误码重载。这些检查不作为两条新产品入口已完成 Linux 实机运行的证明。相关七个测试文件共 140 项全部通过，类型及差异检查通过。本次没有重新运行整仓测试；前一终端批次的一项 Windows rename EPERM 及其 false 证明继续保留。

777 个受核对文件在插件、语言资源、完整构建、分发检查和七种生产服务组合前后保持一致；构建证明为 `.data/project-command-task-build-260b9a96-4a01-4a54-b619-e4519ae29b41-verification.json`，明确记录本批未运行新的整仓测试。运行包 264 个文件通过完整清单核对，指纹 `f873a79acf1b1574a3603f2f110797d796dab4afd50c9b0a4035fd600d2fb3f5`，证明为 `.data/project-command-task-release-26b5bc62-c2c0-40d6-81c3-88b773dfcd4f-verification.json`。目录仍为 250 项、247 项有入口、3 项部分实现，后续账号入口与外部环境验证继续见 [未完成功能](unfinished-features.md)。

## 普通终端与持久会话的项目账号

2026-10-02 普通网页和 CLI 终端、可恢复 tmux 会话接入持久项目 UID/GID、独立 home、原目录与网络。每条连接或命名会话具有独立 tmux 服务器、随机运行 UUID 和完整 cgroup 票据；新增窗口及分屏继续使用原账号。固定原生启动器经独立管道接收有界保护帧，完整验收并降权后才使用已打开的读写 PTY，不修改 root PTY 的权限。socket 在项目 Shell 启动前封闭，重连与只读授权核对原运行、服务器及全部窗格的真实身份。用法见 [项目终端](project-terminals.md)。

匿名连接断开、显式停止及全项目停止会清理整个运行域，再清理准确 socket 和客户机记录，最后核销宿主票据。准备和资源退休共用运行锁；失联或失败保留原票据、错误码和连接租约。重载恢复没有活动宿主连接的匿名运行，保留命名会话；冷重启先确认原资源不存在，再保留完整原票据并登记退休。同名新会话发行新 UUID，旧共享授权不能重放。

独立 Alpine 测试实例的新开机中，五项实际检查全部通过：交互 PTY 的 UID/GID、home、网络及跨项目读取拒绝；断开重连和新增窗口的完整归属；只读输入拒绝；全域停止、准确资源清理、邻居保留和同名重建授权；普通输出管道拒绝终端帧。证明为 `.data/project-terminal-test-temp/sakura-terminal-4PcC2O/project-terminal-995d4b00-1d44-4152-9f2b-51290b1b7dc0.json`，摘要 `4ff39aebd0b4b8f2c187c78d0023727079a381aa09b366a276e3c1f191064788`。268 个与全量复核共同捕获的源码摘要一致；实例、自有子进程及准确 QEMU/CIM 均关闭，原缓存镜像未变。此实测覆盖原生终端链路，不代表旧 HTTP/浏览器脚本或跨发行版界面已完成验收。

早期终端资源退休对 O_PATH 目录执行 fsync 的失败，以及测试实例复用时重复项目名称的失败，原 false 证明继续保留；前者在实际目录 FD 上修正同步，后者只修正测试名称。两轮全量检查各有一项 Windows 重命名失败，原证明 `.data/project-terminal-full-unit-0891c75c-8cf3-42ca-bc6b-4b697c19c330-verification.json` 和 `.data/project-terminal-full-unit-723b0517-3b9b-41a1-8c30-fc9aa34ef128-verification.json` 均保留。相应文件单独复测分别通过 16 项和 7 项，没有修改产品代码或归因于未核实的系统原因。

降低并发后的全量复核仍有同步状态保存的 Windows rename EPERM：1,241 项中 1,239 通过、1 项跳过、1 项失败，774 个捕获文件前后一致；原证明为 `.data/project-terminal-full-unit-6ac7d683-1a95-48ac-98c7-834fbd565c11-verification.json`，不能记为整仓通过。同步文件独立复测 23 项通过。终端、账号、任务范围、目录迁移与项目执行五个文件定向复核 112 项全部通过。按用户优先实现的要求，继续完成构建与提交；构建证明明确记录 `fullUnitPassed: false`，不会修改失败证明。插件修改所移除的两条旧提示同时从生成的繁体语言包删除。

插件、语言资源、完整构建、分发检查和七种生产服务组合通过；证明为 `.data/project-terminal-build-656843bc-6391-4883-b6e8-b706c5c2489d-verification.json`，单独保存语言包生成前后的摘要。运行包 264 个文件通过完整清单核对，指纹 `77119b7b208e107aac245ea397b09a47de824c9d124d7be7ea7a5598e4ef0d20`，证明为 `.data/project-terminal-release-53ddd030-051e-4402-9282-5de5ad8ad25d-verification.json`。首次构建因语言包待生成而失败的原证明保留。目录继续为 250 项、247 项有入口、3 项部分实现；项目 SSH 等其他账号入口、外部 HA 演练和系统级剪贴板边界继续见 [未完成功能](unfinished-features.md)。

## 项目首次 Git 检出

2026-10-02 共享和私有项目首次检出接入固定 smart-HTTP 对象代理。独立只读认证来自已应用网络档案，凭据通过有界 stdin 运输，不进入 Git 参数或项目环境；系统 Git 不执行工作树、项目配置、钩子和过滤器。准确项目 GID 只能读取核对后的 bundle，项目 UID 在原目录、原网络和原 boot 内核对摘要、保留默认分支并检出，之后才执行初始化命令。已有仓库不自动下载，非空目录拒绝，空仓库可初始化。用法见 [首次 Git 检出](project-repository.md)。取消或失败保留未确认的准确资源；任务清理失败的 503 和错误码在取消、服务关闭及重载后仍可读取。

完整回归 1,231 项中 1,230 项通过、1 项跳过，773 个受核对文件前后一致，证明为 `.data/project-repository-full-unit-e4644444-a4d5-47a4-9ea6-7bce9542a369-verification.json`。浏览器验证 Git 的 Basic/Bearer 切换、秘密名称、档案保存、预览应用、刷新后读取和禁用状态；证明为 `.data/project-repository-ui-83165e71-a5ef-4afb-8e0e-8971d4841745-verification.json`，此检查使用路由夹具，不代表客户机权限或网络证明。构建、分发检查和七种生产服务组合通过，证明为 `.data/project-repository-build-d6e0f030-048a-4f1e-b823-650f1a14f81f-verification.json`；运行包 264 个文件通过完整清单核对，指纹 `c7240658d846dbbbb4a1902b2b42f142c281cec357b5735649da983f17003dc8`，证明为 `.data/project-repository-release-5477076c-13e6-49b9-a7f1-c155a0c216f2-verification.json`。

全新 Alpine 实机已实际通过私有仓库认证检出、原默认分支与 commit、项目 UID/GID 初始化和私有网络检查，以及已有仓库不再下载或读取秘密两项场景。该次完整测试随后在主命令 pane 入场核对中拒绝，项目主命令未执行，原 false 证明继续保留：`.data/project-repository-test-temp/sakura-repository-tKfkQw/project-repository-9c2ea27d-a10e-4736-b670-4ef8073e7d3e.json`。另一全新实例在相同主命令控制源码下单独启停成功：`.data/project-repository-test-temp/sakura-repository-9MkxT4/project-repository-eafbdb45-a8d5-4910-85cd-6ec5a7b09685.json`；这不确定前次失败原因，也不替代完整 Git 测试。两次实例、自有子进程和准确 QEMU/CIM 均已关闭，原缓存镜像未变。

完整七项实机验收仍待收尾；非空和空仓库、反射错误、重定向及取消已有可移植或宿主回归覆盖，不能据此声明它们已全部通过新客户机检查。按用户要求，先提交功能实现再继续其他入口迁移。实现检查点为 `.data/project-repository-implementation-checkpoint-3897ce23-ea93-444f-8b7b-30decd169cd5.json`，摘要 `a397782b27b4eb17bb8940326aeccda61d0ce5abe6c1d22817d6f8dbaa43be29`，明确保存 `fullGuestSuitePassed: false`。旧路径、磁盘容量、日志清理、任务取消分类、实机超时和浏览器定位失败记录未改写。功能目录继续保持 250 项、247 项有实现入口、3 项部分实现。

## 客户机关闭任务回执的无重启归档

2026-10-02 客户机热目录满 1,024 张票据时，固定控制器在原独占锁内每批归档最多 512 张当前 boot 已关闭且准确任务域已空的完整回执，随后继续接收新任务。归档按 UUID 前两位分桶，目录 root/0700、文件 root/0600，每桶最多 4,096 项。完整临时文件同步后，通过 `renameat2(RENAME_NOREPLACE)` 原子发布，同步并读回核对，再重新检查原父目录、票据字节及文件身份和任务域，最后移除准确热票据。冲突或未确认时保留原回执；旧 ID 拒绝 prepare 和继承重放，查询与重复停止不重新占用热目录。用法与范围见 [项目账号](project-identities.md)。

原生 64 位 x86-64/AArch64 的旧 libc 缺少包装入口时，调用同一内核原子接口，未知 ABI、指针/long 宽度不符或内核不支持时仍拒绝；不改为覆盖式重命名。满额准备复用同一次锁内已验证的有界快照，每个退休候选仍重新核对。任务准备控制采用三分钟独立预算，普通查询和准确停止保持原预算；首次编译保留原校验、编译标志和权限，预算调整为客户机两分钟、宿主三分钟。

14 组可移植事务模型通过，覆盖完整回执、512 条批量上限、全局容量、旧 ID 与随机 ID 冲突、活动或仍有后代的任务、源及父目录替换、未知归档保留、同步失败恢复、原子接口与 ABI 拒绝以及 FD 关闭。这些模型模拟文件系统和进程归属，不作为 Linux 实机证明。最终整仓 1,224 项检查中 1,223 项通过、1 项跳过、零失败，冻结 631 个源；证明为 `.data/project-identity-archive-full-unit-323045dc-2f2c-4f36-a05d-b7c242638f47-verification.json`。

全新 Alpine x86-64 实机的五项检查全部通过，绑定原生构建 `89ed8a1c124c58e7ee316cfaf3ca2bd47085497500acc557ff3fdba0a018f57a`。容量准备明确包含一张真实关闭票据和 1,022 张派生关闭回执夹具，并保留另一项目的真实活动任务；不把夹具写成完成了 1,023 次内核任务运行。正常生产接口从满额状态归档 512 张回执，热目录变为 513 张，boot 不变，新命令实际使用 UID/GID 20000 和原项目目录，邻居完整票据及活动域保持不变。随后实际验证旧 ID 在正文前拒绝、只读读取及重复停止、真实原子发布冲突、明确注入的目录同步失败及恢复、项目账号不能读取 root 归档，以及邻居取消后的准确票据核销。证明为 `.data/project-identity-archive-test-temp/sakura-identity-archive-nQPZQk/project-identity-archive-8ce9f63d-a43c-4b9e-a62a-a8fb7d5736d1.json`；实际退出 0，VM、子进程和准确 QEMU/CIM 均已关闭，原缓存镜像及既有实例未变。

早期备用时钟的 IO-APIC 故障、Ubuntu 就绪超时、Alpine 旧编译预算超时、真实逐条填满的十分钟超时，以及满额夹具通过后旧 40 秒准备预算超时，七份 false 证明及实际非零退出均保留。只读 libc 检查另行观察到 x86-64、8 字节指针、包装入口缺失而 syscall 可用；没有将该观察补写成旧超时的底层错误码。最终实测使用产品原来的单线程 TCG/icount 参数，未放宽产品启动就绪校验或更改客户机内核。Ubuntu 和 AArch64 不在本次成功实机覆盖中。

插件、语言资源、完整构建、分发检查和七种生产服务组合通过；证明为 `.data/project-identity-archive-build-93b5c98c-fffc-41b5-9e4d-ca985b757aa3-verification.json`。新运行包的 263 个文件通过完整清单校验，指纹 `f59ead22d875d27b3548017595f5c2f2ebf28b4ff0f41c014ca041aa6b058db7`，证明为 `.data/project-identity-archive-release-bf581245-6f3f-4887-a5c3-3b7d70e3575b-verification.json`。最终索引为 `.data/project-identity-archive-final-checkpoint-6643f60a-53ef-426b-812b-0fa3a95eb388.json`，摘要 `17165fb48e4c48529deb441e9a329d7ee3b1715a0a8bdd984a3b6235ad9fa8a7`。目录保持 250 项、247 项有实现入口、3 项部分实现；其他项目入口迁移、独立外部 HA 演练与系统级剪贴板边界继续见 [未完成功能](unfinished-features.md)。

## 单次 GPG Agent 的项目账号与原生来源验证

2026-10-02 能力中心单次 GPG Agent 命令接入持久项目 UID/GID、独立 home、原目录与保存的网络模式。每次明确提交命令、确认和时限，不能沿用旧确认；异步来源检查前固定原项目，准备和密钥解析使用捕获的配置。正文与环境通过受保护 stdin 交给固定降权启动器，root argv 不携带正文。每条任务有独立 GNUPGHOME，客户机仅导入公钥；用法见 [单次 GPG Agent 转发](gpg-agent-forward.md)。

Windows x64 原生 helper 固定 extra socket 文件、祖先目录、属主、ACL 与原监听进程的 PID、创建时间、用户和映像。真实来源连接与每个协议帧重新核对身份，转发 helper 的出生回执在连接和发送 nonce 前持久保存；来源未确认时不发送 nonce。目录句柄只读取属性和 ACL，nonce 及回执文件仍读取数据，共享方式继续保持只读，允许 GnuPG 正常原子更新自己的密钥环。Unix、MSYS 和命名管道来源明确拒绝。此产品入口不启动或关闭宿主 Agent，不复制宿主私钥文件。

固定 Linux broker 保持 root 源监听私有权限，并逐连接、逐 Assuan 请求核对 UID/GID、补充组、pidfd、创建身份、caps/NNP、boot 与完整任务 cgroup；连接、帧、数据与时间均有预算。退出、非零退出或取消先确认整个任务域停止，再确认宿主流、helper、准确 socket 和临时 home 清理，最后核销账号票据。OpenSSH 撤销转发后留下的 socket 仅在原进程已经结束、内核没有该准确路径且原目录及 inode 再次核对后删除，不终止共享 sshd 或删除未知替换对象。清理失联保留原记录与具体错误码，重载不把丢失的内存登记当作已关闭。

最终整仓回归共 1223 项，1222 通过、1 项平台跳过、0 失败，628 个受检源码前后保持一致；证明为 `.data/gpg-agent-identity-full-unit-06f5c9b7-eda5-41e9-847b-39cdafec97c8-verification.json`。三个浏览器场景通过，其源码与最终版本继续一致，证明为 `.data/gpg-agent-identity-ui-a1714cc7-0936-41f8-a94c-7eb0c56bdeed-verification.json`。类型、两段客户机 Python AST 和差异检查通过；完整构建、分发检查及七种编译服务组合通过，证明为 `.data/gpg-agent-build-53051a80-560e-4b6a-bf1f-1e740b7395fa-verification.json`。

Ubuntu 的 12 项真实 GPG 检查全部通过，绑定本次 38 个源、9 个资产、准确 boot/run 与项目 UID。覆盖真实签名、公钥验证、二进制解密、未确认提交拒绝、非零清理、并发独立 home/域、另一项目实际 UID 与私有命名空间拒绝访问、取消及脱离会话后代停止、邻居继续签名、只读重载，以及来源替换后在 nonce 发送前拒绝。证明为 `D:\27247\Desktop\Sakura\.data\network-remaining-test-temp\sakura-guest-task-dhGwI9\gpg-agent-project-identity-evidence-49a12621-197d-4eea-b3dc-06e864567347.json`，外层实际退出码 0 的控制证明为 `.data/gpg-fresh-native-ubuntu-controller-701808f6-d261-46c0-aa4a-b9c7158d0d32-proof.json`。测试使用明确记录的多线程 TCG、原磁盘与 seed，产品就绪检查及启动期限未更改；测试专用 Agent 仅有新生成的测试密钥。所有本次 VM、SSH、helper 和自有 Agent 关闭，live 与准确 QEMU/CIM 均为零，原账号、目录、旧票据与历史证明保持不变。

先前启动超时、公钥校验目录超过 Unix socket 路径限制，以及跨项目测试遗漏正常准备流程的 false 证明和实际非零退出均保留。缺失网络的固定回复由原返回摘要与本地声明的回复候选精确匹配得到；原证明没有补写错误码。原型 Ubuntu 的早期通用清理错误继续保留其原归属，后续独立 OpenSSH 残留观察不作为该早期错误原因的证明。Windows 目录共享观察、正常旧票据退休和各次失败的完整索引见下方检查点。

最终运行包包含 263 个文件，完整清单校验通过，指纹为 `1865d6d48589025cfd1fa0dee0a684692f6e1e9ea655d919b629c3104076f037`；证明为 `.data/gpg-agent-release-b21bddfe-90b6-4f15-9ff4-cef2b555f11e-verification.json`。完整索引为 `.data/gpg-agent-final-checkpoint-763329dc-eb41-4d1c-8434-708ab9ad77c8.json`。本次原生宿主与 stock GPG 实机运行覆盖 Ubuntu；原 Alpine/Debian 缺少 GPG，未安装或改动这两份旧实例。项目网络的剩余入口、真实独立外部 HA 演练与系统级剪贴板边界仍保持部分实现；目录继续为 250 项、247 项有实现入口、3 项部分实现，范围见 [未完成功能](unfinished-features.md)。

## 单次 SSH Agent 的项目账号与独立资源清理

2026-10-02 能力中心单次 SSH Agent 命令接入持久项目 UID/GID、独立 home、原项目目录和保存的网络模式。每次提交明确命令、确认与时限，旧配置中的命令或确认不能沿用。准备在异步检查前固定原项目，捕获配置摘要及准确 live 实例；环境、运行时和密钥只解析该份配置，项目中的 SSH_AUTH_SOCK 不能替换本次入口。正文与环境通过原受保护 stdin 帧交给固定降权启动器，root argv 不携带正文，普通 RUN 和全部清理的固定环境保持原合同。task 准备只核对既有目录，缺失目录明确拒绝，不再由 root 自动建立。用法见 [单次 SSH Agent 转发](ssh-agent-forward.md)。

root SSH 源监听保持原权限，其专属父目录只供 root 访问，固定 Python broker 为本次任务建立项目 socket。每个新连接核对 UID/GID、pidfd、进程创建身份、boot、caps/NNP 与完整 cgroup，转发阶段复核原进程、源 socket 和归属；连接、帧、请求、字节及时间有预算。每条任务拥有准确资源记录和宿主物理连接，同项目两条任务互不关闭。已授权进程主动传递自己的 FD 或代理请求仍不属于防止同 UID 串通的证明。

结束、取消与关闭先撤销本次宿主流并确认全部原后代停止，再核对 Agent 资源清理，最后核销账号票据。清理失联保留 503、具体错误码、原资源和宿主 owner，正常恢复按原完整身份重试；原 inode 的部分删除可继续，替换对象拒绝且保持原样。共享终端服务关闭会取消并等待这些任务，借用者不会关闭另一个服务的任务或宿主 Agent。界面显示持久错误码，刷新和重载不重放旧运行。

最终后端定向 123 项、相关回归 178 项、存储路径 29 项与生命周期 5 项以及类型、Python AST、默认 Node ESM 和差异检查通过，冻结证明为 `.data/network-remaining-test-temp/ssh-agent-identity-backend-freeze-b8dbccfc-6e56-4e51-abcc-d93c50c7073e.json`。三个浏览器场景通过，覆盖原项目提交、明确确认、取消、错误码刷新后保留及窄屏；证明为 `.data/ssh-agent-identity-ui-7f2de5ab-6e2b-499f-b704-2fdc8fefe8cc-verification.json`。首轮浏览器运行在测试前因 ssh2 CommonJS 的命名导入失败，原 false 证明和实际退出码 1 保留；修正默认导入后通过。早期终端旧 mkdir mock 阻塞及 Windows Python kernel 模型的 fcntl/转义失败日志也保留于后端证明，没有改记为成功。

首轮整仓回归实际 1,164 项，1,161 通过、1 项跳过、2 项 Windows rename EPERM 失败，621 个源码前后未变；原 false 证明和实际退出码 1 保留。实例清单随后沿用原提交时深快照与保存队列，接入已有独占刷新临时文件及 Windows 一秒有界重试，失败保留旧清单，不删除目标或其他临时文件。短锁时序证明自有 PowerShell 已关闭后仍可拒绝替换；只用连续 Node 读者的独立对照也实际返回 EPERM，证明原短锁测试自己的读者可能占用目标。测试协调关闭自己的读者后让出提交窗口，另以真实持续 Node 句柄验证预算失败、原 inode/完整旧值/邻居临时文件保留和关闭后恢复；生产一秒预算未放宽。原 25 项未改复测、9 项时序中的失败与五条件对照分别保留，没有猜测杀毒软件或把 bundle 首轮错误断言为同一原因。

第二轮整仓回归实际 1,168 项，1,165 通过、1 项跳过、2 项生命周期测试失败，622 个源码前后未变；原 false 和实际退出码 1 保留。这两项旧测试通过建立固定 machines.json.tmp 目录注入保存失败，没有命中新接口的独占随机临时文件。随后只更新准确清单的故障注入，保留启动不产生孤立 live、原 lastError、退出清理、状态事件与保存错误日志断言；不改生产实现。

随后 1,168 项整仓回归通过，但 Alpine 首次实际并发测试仅完成前 4 项，第二条任务未取得原生票据，实际退出 1；原 false、日志、账号记录和独立停机核对保留。已有任务实际使用 root0700 的 /root/.ssh/agent 父目录，而 Source 构造器要求该目录只能有一个 socket。[OpenSSH 发布说明](https://www.openssh.org/releasenotes.html)明确新版 sshd 将各转发 socket 放入 ~/.ssh/agent。新增 Python 执行模型在旧 broker 上实际 14 项中 13 项通过、1 项因 SOURCE_SHARED 失败；原 Alpine 第二槽未保存底层拒绝码，目录条件是代码与模型定位，不能将该码补写到原记录。修复仅移除目录唯一项假设，仍逐级核对 root 私有目录、准确 socket、监听进程身份和资源重复占用。同目录两条独立源可并存，邻居变动不撤销本源，本源或父目录替换、进程变化与同一源重复占用仍拒绝。

修复共享父目录后，第二次 Alpine 实测完成 11 项，随后原测试硬要求停止后的 broker 仍为 ready，实际观测为 failed，退出 1；原 false 与只读核对保留。停止和回收记录显示完整 context、scope、source、endpoint 与 broker 身份均未改变，只更新运行阶段与失败诊断。清理失联的 503、至少三次确认及全域停止断言已顺序通过；原中间时序没有写入失败回执，未补造这些观察。只修改 smoke，分开保存 ready 和停止后回执；允许 ready/null 或 failed/合法诊断，逐字段核对不可变身份，继续要求原账号保持 active、准确替换拒绝且替换对象不变、原 inode 恢复后按正常 API 回收。18 项实际 Python 模型及 Node 导入、五段 AST、类型和差异检查通过，生产实现未变。

随后 Alpine 在 e361 smoke 与 d18 戳下实际 16 项全部通过；接着 Debian 第 1 项基线断言失败，实际退出 1，Ubuntu 尚未启动。旧 Farm 保存的是创建两个测试项目之前的账号基线，结束时逐项确认原有记录未变，并在 projectPair 中保存明确创建的两份完整身份；没有保存结束后的完整 passwd 快照。只读比对确认 Debian 恰多这两份账号、绑定和保留 UID，原有记录与 ready 资产均不变；原 false、日志、双退出回执、顺序失败汇总及该次 Alpine 成功保持原脚本归属。验证脚本随后按已固定摘要的 Farm 身份，只允许记录明确创建的 pair 增量，并在任何项目正文之前核对完整身份与绑定；拒绝未知账号、旧账号变化、home inode 替换、UID 绑定变化、额外保留 UID 和 ready 资产变化。新增模型验证有效复用及明确增量和这些拒绝路径，没有依据当前客户机放宽基线或补造旧快照；生产源码未变。

修正 Farm 基线后，Debian 实际通过前 3 项，在真实转发时返回 SOURCE_OWNER，退出 1；原失败当时没有保存源 socket 的权限，未据错误码补造数值。另一次只读 root SSH 转发实际观测 root:root 的 0755 socket，专属父目录 root:root/0700，真实 SO_PEERCRED、pidfd、startTicks 与 sshd9.2 身份均确认；观察未发送 Agent 协议消息、未 chmod 或 unlink 源，连接关闭和停机后 671 项保护核对通过。新增模型使旧 broker 实际 15 项中 14 通过、1 因源权限拒绝，修复后 15 项全通过。修复只移除叶节点低权限位的额外限制，访问仍由逐组件 no-follow 的 root0700 父目录保护，root 属主、准确 inode/完整 mode 与监听进程持续复核；父目录权限扩大、叶节点变化和非 root 源均拒绝。原 cc134 Alpine16、Debian3、宿主汇总器错误与所有退出回执保持原源码归属；随后重新冻结生产与测试源码，完整重跑三系统。

当前默认 Node 24.15.0/tsx 的整仓回归共 1,171 项，1,170 通过、1 项平台跳过，0 失败或取消。196 个测试文件启动前捕获的 622 个源码摘要完成后全部一致；日志摘要为 `1b546e989d2a0a9ca38baae8481325ed2f428f8d9f01dc385895e750476b0a90`，校验为 `.data/ssh-agent-identity-full-unit-b1faca80-4e26-491f-8ea3-79ba75dc1ae0-verification.json`。此前 1,170 项测试使用 b864 戳，维持其原调用归属；当前整仓回归在 socket 权限修复后的生产戳下执行，43 个生产源和 broker/native 资产均与本次三系统戳逐字节相同。

重新冻结 43 个生产源、原 native 94bc 资产与单文件 broker 清单后，三个实际 CLI 预检均退出零；712 个源码、资产、配置、历史证明与旧宿主记录前后保持原字节，未初始化运行时或启动 VM。预检证明为 `.data/network-remaining-test-temp/ssh-agent-project-identity-fixture-validation-770ae472-fa07-46e0-8845-52242f943bcb-final.json`。随后三系统真实运行各 16 项，共 48 项通过：Alpine、Debian、Ubuntu 均为默认 Node 24.15.0/tsx，无禁用 native 的附加参数。验证真实项目 UID/home/cwd、caps/NNP、原 stdin 帧、实际 ssh-add 列钥与 Ed25519 签名、两任务并行、同 UID 不同域及另一项目的直接连接拒绝、逐任务取消和脱离会话后代、broker 未就绪时正文不执行、清理回执失联保留原记录、准确替换对象拒绝、还原后正常恢复、借用服务关闭及重载不重放。汇总为 `.data/network-remaining-test-temp/ssh-agent-project-identity-final-summary-9a434bb0-d56f-464b-b388-d376e15ad822.json`，摘要为 `06714fb2bd2b0a893bd83f74ada2b8e9898bfead81ed2c7e24b7666575ff77c6`。这是冻结源码服务图运行，没有把旧编译 HTTP 证明改记为本批接口实测。

三系统只复用原 Farm 两项目及其账号，未新增磁盘、项目或目录迁移。Alpine 原配置没有密钥引用，未声称执行 Secrets 驱动；Debian/Ubuntu 只读原独立 DPAPI 库。Agent 只用本次临时管道和内存中的自有 Ed25519 密钥，不写私钥、不连接用户 Agent。故障只在独立确认本次完整域已移除且全部准确 PID/startTicks 停止后注入；本次 root 观察目录及未核销的外层控制目录按证据保留。全部本次宿主物理流关闭，三台同步后停止，live、准确 QEMU 和独立 CIM 为零；原账号、home、目录绑定、配置、ready 资产、每条旧回执与原始证明保持归属。

插件和语言包检查、完整生产构建、54 个服务模块分发检查及 7 种编译服务组合通过。新运行包 `release/sakura-lAO2jV` 的 258 个文件摘要通过，指纹为 `a38e641605b8a3ffaf646c9f829ac4800f09c3041e531dd7d7311c995f147de1`，编译服务摘要为 `2e3d3334b58dd73ec9e7ab4b46a13c5a98b904dd5e372c6ccdaa35e356c6f4a0`，broker 原始摘要为 `9fa4c76d17ca1f9ffc78058ccc5c508898dfa265eb67fd962dd10f129ee1fe0c`；证明为 `.data/ssh-agent-identity-release-c46e7904-98a9-4fd6-8064-4607f4639f88-verification.json`。运行包复用本机工具及依赖，未验证新机器安装；构建前后独立核对四份准确自有实例，QEMU 均为零。

本批完整索引为 `.data/ssh-agent-identity-final-checkpoint-evidence.json`。目录仍为 250 项、247 项有实现入口、3 项部分实现。普通 PTY、专属项目 SSH、GPG Agent、cron、用户管理器及剩余扩展的账号接入、每 boot 1,024 张票据的无重启归档、独立外部 HA 演练和系统级剪贴板边界仍需继续；当前范围见 [未完成功能](unfinished-features.md)。下方 Farm、运行时、账号及编译 HTTP 证明继续保留原源码和客户端归属。

## 项目账号构建、并发任务与准确取消

2026-10-01 构建农场接入固定项目 UID/GID、独立 home 和受保护正文运输。每次准备捕获原项目配置、摘要与准确 live 实例，后续环境、运行时及密钥只解析该份配置；这不是入队时的快照。任务保存原项目目录、实际工作目录与配置版本，兼容既有第 1 版队列。降权后仅相对切换子目录，原账号目录绑定保持不变，普通 shell 的非零语句语义也保留。工作目录支持 `/workspace`、`/opt/projects` 与 `/srv/projects`，越界目录拒绝；用法见 [构建农场](build-farm.md)。

同项目多个槽位各自使用完整 cgroup 和账号票据。短操作队列串行核对、登记与核销，正文可并行；当前进程的活动归属必须准确匹配 live、boot、owner、账号、正文摘要和已登记票据，不能从磁盘重建或任意跳过未知运行。准备第二槽位不会把第一槽位当作失联任务，目录迁移及网络核销仍受全部未闭合票据保护。准备租约在取消后保留到完整清理结束，关闭终端服务也先等待任务释放，再解除绑定保护。

取消和关闭清理自己的全部后代，再核销准确账号票据；核销失联保留 503、具体错误码和原记录。关闭、重载和刷新不会把实际 error/cancelled/done 改成普通中断。密钥遮盖作用于分段输出、完整结果和错误；界面显示持久错误码，并允许检查后明确重新排队。

最终三文件后端定向 71 项与主命令、服务、运行时、迁移和短任务的相关回归 187 项通过；类型和差异检查通过，测试前后的六份源码与测试摘要一致。证明为 `.data/build-farm-identity-backend-freeze-e20d903f-91d3-4583-8d42-ad8ccb4ac151.json`。两个浏览器场景通过，覆盖原节点提交和取消、三类允许目录、点路径拒绝及清理错误刷新后保留；证明为 `.data/build-farm-identity-ui-11477057-577b-47dc-9d57-10893cfc4856-verification.json`。

默认 Node 24.15.0/tsx 的整仓回归共 1,140 项，1,139 通过、1 项平台跳过，0 失败或取消。192 个测试文件启动前捕获的 608 个源码摘要在完成后全部一致；日志为 `.data/runtime-identity-full-unit-build-farm.log`，摘要为 `4c5d30020e9e4330a8f7c491ab8c9dda2cbcb9a37ece0e299b25adef600af340`，校验为 `.data/runtime-identity-full-unit-build-farm-verification.json`。

最终冻结 28 个生产源及实机脚本后，三系统真实构建服务检查共 41 项通过：Alpine 13、Debian 14、Ubuntu 14；客户端均为默认 Node 24.15.0/tsx，实际退出码为零。覆盖真实 UID、home、caps、私有网络、两个槽位同时运行、逐槽取消及脱离会话后代、准备保护、正文与进程环境拒读、子目录绑定与 shell 非零语义、准确清理失败恢复、服务关闭及重载不重放。汇总为 `.data/network-remaining-test-temp/build-farm-identity-final-summary-7bd1d3f3-4c7f-4550-bb85-1881f82e602b.json`，摘要为 `cb2ebff8b623a8a54262a6ac481bb36d8aa0d49c7b55927d0cb283562c6e133c`。这是源码服务图的实际运行；下方旧运行时编译 HTTP 的 13 项继续保留其原 19 源归属，不改记为本批构建接口实测。

Alpine 使用准确两份已有迁移项目，只通过原 UID 创建本批子目录，原配置没有密钥引用，未执行密钥存储驱动用例。Debian/Ubuntu 各创建两份新的自有项目目录，实际预览、审阅并应用迁移；独立 DPAPI 密钥库及保存的引用验证分段 stdout/stderr、完整结果和重载后的遮盖。三系统仅在独立观察原外层 cgroup 已移除且全部准确 PID/startTicks 停止后，注入本次账号核销连接失联；原 503 与票据保留，正常恢复闭合准确账号，但失败回调留下的 root 控制目录按原样保留，没有宣称其已核销。三台实例全部同步后停止，live、准确 QEMU 和独立 CIM 为零；旧账号、目录绑定、ready 资产、配置、每条旧宿主回执和历史证明保持不变。

实机预检的前两轮均在初始化客户机之前拒绝：新脚本误把原 9 项迁移汇总的顶层 vmId 与原 54 项证明的 passed 当成必有字段。两份 false 证明及真实退出码 1 的工具日志保留为 `build-farm-identity-validation-failure-7ee83858-ad04-4e3e-885e-82992da265c0.json` 和 `build-farm-identity-validation-failure-e4845112-10c2-4326-bd2e-1972fe3340d9.json`；未修改原证明。脚本随后分别核对两种原始成功合同，静态检查及三种真实 `--validate-only` 均通过，且均未初始化运行时或启动 VM；冻结、预检与最终运行各有独立证明。

完整生产构建、54 个服务模块分发检查和 7 种编译服务组合均通过。新运行包 `release/sakura-cepdK5` 的 256 个文件校验通过，指纹为 `94afa1339843a027e5a7d9386c8ce43603ff06cc1f262de4ce5e4f2177d942dd`，编译服务摘要为 `61a060f60081c5ce7a857d0c4cd8ba736af5142530f90a2e97b86e780b303f87`；证明为 `.data/runtime-identity-physical-build-farm-release-verification.json`。运行包复用本机 QEMU/PosixLoom 和依赖，没有验证新机器安装。构建结束后独立按进程名、准确 fixture 路径和 VM ID 再次核对四份自有实例，QEMU 均为零，证明为 `.data/build-farm-identity-stopped-fixtures-79924e12-d630-4319-8f29-c8f48d123359.json`。

本批源码、脚本、单元、界面、预检、三系统实测、运行包和原失败的完整索引为 `.data/build-farm-identity-final-checkpoint-evidence.json`。目录仍为 250 项、247 项有实现入口、3 项部分实现。普通终端、项目 SSH、SSH/GPG Agent 和剩余扩展的账号及正文运输接入、客户机每 boot 1,024 张票据的无重启归档、真实独立外部 HA 演练和系统级剪贴板边界仍需继续；当前范围见 [未完成功能](unfinished-features.md)。

## 项目运行时探测、安装回执与私有任务控制

2026-10-01 将运行时显式探测和版本选择验证接入持久项目 UID/GID、独立 home、已核对目录和项目网络，正文与环境使用受保护运输。面板打开、刷新、十秒轮询以及 CLI `inspect` 只读取宿主配置与最近完成的采样；`probe` 才发行任务。采样有配置、宿主实例和五分钟时效核对，最多保留 256 项，失败与过期不会冒充新结果。声明文件只读普通 no-follow FD，有类型、编码、大小与前后身份检查；每个版本进程有时间和输出预算。完整任务清理及准确票据核销之后才发布采样。

版本选择先在项目 UID 下核对 ready 回执和准确绝对路径的版号，再释放 VM 锁，以原配置摘要保存；保存锁内在异步检查及临时文件写入后重新核对取消、服务关闭和实例归属。冲突保留新配置，空选择可清除覆盖。请求取消与关闭等待完整清理，清理未确认保持 503 和具体错误码。严格 POST、CLI 显式探测、面板状态和清除操作均已接通，账户模式仍仅允许 owner 使用运行时接口。使用见 [项目运行时版本](runtime-versions.md)。

安装仍是明确的 root 管理员操作，使用固定系统环境，不加载项目密钥或项目 PATH。Debian/Ubuntu 的 Node 下载官方精确版本并核对摘要；Python 使用固定 uv 0.10.11、每次安装独占的 managed interpreter 与复制依赖的 relocatable venv。内部回执固定 stage、解释器及 destination 的设备与 inode，新树先有界核对属主、类型、链接、硬链接和权限，再只规范本次私有目录内的原 FD；构建期间解释器顶层保持 0700。prepared 回执在完整任务清理之后才能独立确认 ready、开放 0755。未知旧目录或不完整回执拒绝，不按目录存在执行 binary。恢复只处理准确原安装记录，无法确认的清理保存为 `RUNTIME_INSTALL_CLEANUP_FAILED`。

外层短任务控制改为 root 0700 的 `/run/sakura-guest-tasks/<runId>` 与 root 0600 单链接记录，固定独立 nonce、boot 和完整 cgroup 身份。启动不接管已有 UUID；清理、停止确认与核销都复核原归属，丢失核销回执可重试。二进制输入及原完整 cgroup 回执合约保留，失败不能在正文执行前或清理后变成成功。

固定运行时与任务控制 18 个生产源的首轮三系统真实检查共 56 项通过：Alpine 18、Debian 19、Ubuntu 19，默认 Node 24.15.0/tsx，无附加禁用 native 的参数。每种系统通过 3,000 次实际 runtime GET 无客户机操作或新账号票据，两项目独立 UID、home、私有网络与受保护正文、畸形声明和版本输出、真实脱离会话后代取消、配置冲突与未知 root 目录拒绝。Python 3.12.12 的项目 UID 选择、探测、pip、别名与新 venv 全部通过；Debian/Ubuntu 另首次安装并核对官方 Node 22.12.0。三台实例均同步后停止，live、所属 QEMU 与独立 CIM 核对为零，原账号、配置、证明和旧产物保持原样。汇总为 `.data/network-remaining-test-temp/runtime-project-identity-final-summary-436e88f8-a3c9-4431-a0fb-eef11dc3c61e.json`。

Alpine 最终轮明确安装官方 coreutils 后复用原 ready 资产；其 Python 下载与 ready 生成仍归属前一份 `eed81…` 安装源的原始证明，不能改记为本轮首次下载。此前共享下载目录的 root `.lock` 为 0666，原安装按预期拒绝；只读诊断保留其 inode 与权限，改进为每次安装独占目录，不修复或删除旧共享内容。随后 Python 已实际下载并生成 ready，但 uv 的 pip 启动脚本使用 `realpath --`，BusyBox 产生错误 stderr；准确项目 UID 下的只读诊断确认这一点，最终补齐 coreutils，原脚本及 ready 回执字节不变。两次原失败、只读诊断与最终成功分别保存。更早宿主账号原子预留出现 EPERM，按同一账号与绑定正常 API 六步恢复通过；根因仍未确认，不宣称已修复，也不将恢复算作首次成功。

私有任务控制另在自有 Debian 实例通过 12 组实际检查，包括全字节/NUL/UTF-8/128 KiB 输入、非零退出、控制目录权限、普通 UID 无法列目录、同 UUID 错误 nonce 拒绝且原任务保留、setsid 后代完整清理与核销回执丢失重试。证明为 `sakura-boot-persistence-53hCt6/guest-task-control-evidence-24cab065-0b2f-48ff-ae5e-a4c34b6ceadb.json`；旧控制方式只保留原始源码与只读推断，没有将其描述为实际漏洞复现。

coreutils 修复后的一轮全量 Node 测试 1,101 项，1,100 通过、1 项平台跳过、0 失败；启动测试前捕获的 607 个源码摘要在完成后保持一致。运行时后端定向 65 项、面板浏览器 2 项、32 个插件契约、9 个插件包，以及 3,113 条语言文本与 74 个动态片段通过。全量原始日志与校验分别为 `.data/runtime-identity-full-unit-coreutils.log`、`.data/runtime-identity-full-unit-coreutils-verification.json`；较早 1,082 和 1,100 项测试的日志仍归属各自原安装源，不重新标记为后续源码。

随后编译版 HTTP 的第一轮因测试脚本读取 Windows 文件属主所依赖的 PowerShell 模块无法加载而中止，改用准确文件的 .NET ACL 只读接口。第二轮前三组通过，但显式 probe 在宿主账号日志原子替换时返回真实 EPERM；新客户机票据尚未发行，原账号记录完整。两轮 false 证明 `compiled-runtime-identity-http-eaab3a10-d3fb-433c-941b-a4282fdd3513.json`、`compiled-runtime-identity-http-91b507df-5d57-4381-bbc6-471dda2e0c17.json` 均保持原字节与源码归属，实例停止、原设置恢复，不将局部通过写成完整成功。

宿主 `writeStore` 为 Windows 的 EPERM/EACCES/EBUSY 增加总等待约一秒的有界原子替换重试；全部尝试只使用同一份已经 flush 的独占临时文件，持续失败返回原错误并保留旧文件，其他错误和非 Windows 直接失败。9 项新增测试通过，真实 Windows .NET FileShare.ReadWrite 且不允许删除共享的短锁验证连续读取只得到完整旧版或新版，持续锁验证原错误、原正文与临时清理；另三种错误码的相同临时 inode/正文、非 Windows 条件及序列化/flush 失败是明确模拟。连原运行时回归共 74 项通过，类型与差异检查通过；证明为 `.data/runtime-identity-store-freeze-b822e139-bcc8-410a-9399-eaa818b59b40.json`。原 EPERM 的具体持锁者仍未知，不据此宣称其根因或此前原生客户端退出已修复。

加入存储修复后的全量 Node 回归 1,110 项，1,109 通过、1 项平台跳过、0 失败或取消。192 个测试文件启动前捕获的 608 个源码摘要在完成后全部一致，使用默认 Node 24.15.0/tsx。原始日志为 `.data/runtime-identity-full-unit-storage.log`，摘要为 `ce7b1d313c05d41d34e0a06dd073722407aa3374d67d057761fa26ea8d63e4d1`，校验为 `.data/runtime-identity-full-unit-storage-verification.json`。

将宿主存储依赖也纳入冻结后，19 个生产源的三系统实际回归再通过 56 项，9,000 次 GET 无客户机操作或新增账号票据。该轮所有 Python 与 Node 都准确复用既有 ready 回执；Alpine Python 的创建继续归属原 `eed81…` 证明，Debian/Ubuntu Python 与 Node 的首次下载归属上述原 18 源汇总，不宣称再次下载。原账户、配置、旧产物与全部历史正负证明保持原字节，三台实例均同步、停止、live/QEMU/CIM 为零。新汇总 `.data/network-remaining-test-temp/runtime-project-identity-final-summary-10a5bfce-5855-4c68-a570-5de8e845201a.json` 的摘要为 `c4059c1390b198f9d8819083a205fe99b74a41756b65fde0b929b52dc2d22cbe`。

完整生产构建、54 个服务模块分发检查和 7 种编译服务组合均通过。新运行包 `release/sakura-4EIY1q` 的 256 个文件校验通过，指纹为 `8abfef63654cabbf3c7b4f34cb5363ea815eba0a0f954791c19b9481fe92f6c6`，编译服务摘要为 `fad2ae3476c3f8099d5c4102d39cc5b3d6a530a60b8f6452b30b097ceb7b01c6`；校验为 `.data/runtime-identity-physical-storage-release-verification.json`。运行包复用本机已准备的 QEMU/PosixLoom 和依赖，没有验证新机器安装。

该包首轮编译 HTTP 检查前 9 组通过，包括公开 API 官方 Node 安装、ready 回执、项目 UID 选择与探测、完整取消清理及包内 CLI；第 10 组测试角色 ID `runtime_reader` 不符合现有接口格式而中止。保留 false 证明 `compiled-runtime-identity-http-4f582916-6488-4161-8aa1-3fc66edc094c.json`，摘要为 `2d93dd251d90cae8746e482f1319b69a2dcae826122e1051480dba571b5c4d08`；实例同步后停止、QEMU 为零、原设置与活动项目恢复。仅将测试的两处角色 ID 改为 `runtime-reader`，生产接口、运行包与 19 源冻结未变；完整结果以独立的新证明记录。

修正测试角色后的同包完整编译 HTTP/生成 SDK 回归 13 组通过：默认 Node 24.15.0、客户端与两次编译服务的 `execArgv` 均为空；认证、目录审阅应用、无发行 GET、真实 UID/home/caps/NNP/私网探测与缓存、严格 POST、取消全域清理、清除及未知 prefix 拒绝、官方 Node 22.12.0 实际安装与 ready、包内 CLI、成员权限拒绝和历史证明保持均完成。最终在已只读观察到实际 UID 探测进程与准确票据后触发生产 SIGINT 处理器，确认原票据闭合、服务退出码为零、客户机停止；仅重启同包宿主服务，公开状态仍为 stopped/live=0，原活动项目恢复。证明为 `sakura-boot-persistence-53hCt6/compiled-runtime-identity-http-65e8ac68-d307-4985-9380-21fafa41d032.json`，日志及退出回执为 `.data/runtime-identity-http-default-13-role-fixed-3c757d15-ca95-4f9a-bc96-042e028b384a.log` 与同名前缀的 `-exit.json`。私有 IPC 调用的是实际生产 SIGINT 处理器，这不验证 Windows 原生控制台信号交付，也不等于新的客户机冷启动。

完整 13 组中的 Node 安装接口准确复用原 ready `6124800e-0315-449b-bcf4-72e8a0be5284`。首次官方包下载与 ready 创建仍归属此前 9/13 后因测试角色格式失败的原证明 `compiled-runtime-identity-http-4f582916-6488-4161-8aa1-3fc66edc094c.json`；最终完整轮没有宣称重新下载，也未修改原资产或回执。

本批源码摘要、运行包、全量测试、三系统实际运行、编译 HTTP、私有控制、原失败与诊断的索引为 `.data/runtime-identity-final-checkpoint-evidence.json`；所有历史证明保留原始字节和创建源码归属。目录仍为 250 项、247 项有实现入口、3 项部分实现。普通终端、项目 SSH/Agent、构建农场及剩余扩展的账号与正文迁移、客户机每 boot 1,024 张票据的无重启归档、真正独立外部 HA 演练与系统级剪贴板边界仍需继续；ARM 安装及新机器部署未实测。清单继续见 [未完成功能](unfinished-features.md)。

## 项目 UID 接入、受保护正文与目录迁移

2026-10-01 将默认项目 API/SDK/CLI 命令、项目初始化、主命令、普通服务、就绪与命令式健康检查接入持久项目 UID/GID 和独立 home。命令及环境通过最多 128 KiB 的二进制 stdin 或 root 独占保护帧运输；固定启动器核对原 boot、run、域与文件身份，降权、清空补充组和 capabilities 后才读取正文、核对 EOF/摘要并执行密封只读 memfd，root argv 不含命令或密钥。已发行票据的用户非零退出和 JSON 输出保持原语义；未发行票据的控制器拒绝返回明确账号错误，健康检查不会据此进入普通失败重启循环。

宿主先保存完整账号、上层运行及运输意图，再提交正文；上层确认全域清理后才核销准确票据。清理及确认失联保留原记录，下次操作恢复原票据；真实冷重启登记宿主退休，保留原始客户机回执。关闭历史逐项持久归档并读回核对，run UUID 不可重放。客户机仍每 boot 保留最多 1,024 张票据、同时最多 32 个活动运行，尚无无需重启的客户机归档。升级不能删除旧票据或放宽旧 SUID 启动器。

已有 root 目录需项目所有者预览保存配置的目录迁移计划、核对摘要与变更，再明确应用；项目成员即使获读取、编辑和执行授权也不能迁移属主。迁移只接受已有允许目录，核对 FD 的设备号、inode、文件系统、mount ID、权限、内容及链接，拒绝链接、ACL/capabilities、跨挂载、其他项目重叠和超限回执；512 KiB 预算包含完整完成记录、最长错误路径及最终身份。中断、重启、绑定或最后门闩确认失联均保留同一计划重试，读取不安装或应用。准备及活动终端连接阻止迁移；新终端和共享重连先只读核对门闩再准备。旧 root 终端断开后保留的未知后代仍属于后续归属迁移范围。

整个私有项目停止先冻结固定 generation/release ID，再清理服务、主命令和账号票据，最后核销准确原命名空间；旧请求不能跟随新 generation，即使 inode 被复用。删除工具持有锁 FD 并进入固定 root cgroup，控制器被杀或工具关闭继承 FD 后，恢复先确认工具域为空，才退休原代。合法 rebind 只退休完整匹配旧身份的 applied 迁移门闩，未完成门闩继续拒绝运行。网络清理未确认即使遇取消也保留 Job 失败、503 与具体错误码。

运行面板读取已登记主命令和服务日志时，用固定系统环境、NOFOLLOW 打开并核对 root 所有、普通单链接和 `0600` 权限，再有界读取尾部；不会跟随项目预先放置的日志符号链接。未知旧回执的日志不读取，也不为读取安装 Python。共享项目 Git 检出使用项目 UID；私有项目目标没有 `.git` 时明确拒绝新启动，认证预取 broker 尚未接通该路径。

最终账号核心构建为 `94bc2a7fb050ac8a72cce5fcf56997c6c44ba4a8473cd543cff6d36ff407b905`，Alpine、Debian、Ubuntu 各 31 项、共 93 项真实回归通过。包括保护帧、真实降权、完整命名空间与票据身份、失联恢复、合法 rebind 和 root 删除工具关闭锁 FD 后的清理确认。三份原始证明及源码摘要保存在 `.data/project-identity-network-latch-final-evidence.json`；Ubuntu 的最终核心轮使用默认 Node/tsx，不能据此宣称此前没有 JS 错误的原生客户端退出已经修复。

主命令、服务、就绪、日志读取与 Workspaces 共 54 项三系统实测通过，其目录迁移依赖仍明确归属旧 helper `778d…`，原证明字节未改。最终 helper `e3ed3c6041923ad9344e7aea0c7b357045a87d17cb02b42ddf4f4dbed9e41f35` 另通过三系统各 3 项、共 9 项定向测试：真实预览、审阅、应用和 UID 执行，以及 saved/native-only 两种物理重叠拒绝；旧账号、配置、目录和原 54 项证明保持原样。索引分别为 `.data/network-remaining-test-temp/project-uid-scopes-final-summary.json` 与 `project-uid-migration-overlap-final-summary.json`。这些定向负例使用自有子目录 bind，旧 helper 已可能按跨挂载拒绝，不能代替下面真实允许根目录漏洞的复现。

目录迁移的独立实机检查复现旧 helper 对 `/opt/projects` 与 `/srv/projects` 整体 bind 后的物理重叠仍接受预览；没有应用该计划。最终 helper 固定其他项目目录及祖先 FD，按设备、inode、文件系统身份核对；saved、native-only、物理祖先和文件系统根 bind 全部明确返回 `PROJECT_DIRECTORY_PHYSICAL_OVERLAP`，独立无关 tmpfs 预览仍允许。最终 5 项均通过，所有 alias 卸载，Beta 内容、属主、权限及原账号保持一致；证明为 `sakura-directory-migration-YkUE8m/project-directory-migration-physical-overlap-evidence-8372dcf6-deaf-42a9-a4f0-2f6acf6ef673.json`。缺系统 Python 的 Alpine 4 项只读门闩实测仍按其原 `778d…` 文件保存；这一门闩实现没有变化，不将旧整文件证明改记为新摘要。

最终 `e3ed…` helper 的完整 Debian 回归 28 项通过：使用新的项目 ID 与自有目录，保留原账号和旧 23 项证明；只读 GET、预留身份失联恢复、目录与预算边界、准备租约及实际 SSH PTY、受管 SSH 服务和旧 tmux/native 入口阻止迁移、真实 fchown 中断、各阶段门闩、同计划跨真实重启恢复、丢失 rebind ACK 和最终确认重试均完成。原证明为 `sakura-directory-migration-YkUE8m/directory-migration-attempt-tHg8bu/project-directory-migration-evidence.json`，28 项全部通过、源码前后一致、实例停止并同步、live 为零。客户端使用 `--no-addons --import tsx`，没有清空旧 registry 或删除票据来满足新身份。

最终 Debian 默认项目命令 9 项实测通过，涵盖两项目 UID、受保护密钥环境与非零退出、取消及脱离会话后代、准确票据确认失联重试、真实冷重启退休和私有项目健康检查、整项目命名空间核销。证明为 `sakura-boot-persistence-53hCt6/project-execution-identity-evidence.json`，脚本摘要为 `1f16fc60e704cf9f9b092087b2fa909735578e3ca43e04954f3c679498256e14`；全部相关源码在前后核对一致。

最终全量 Node 测试 1,046 项，1,045 通过、1 项按平台跳过、0 失败；冻结期间捕获的 661 个源码摘要在完成后及提交前一致。32 个插件契约、9 个插件包、3,099 条语言文本和 74 个动态片段、6 个相关浏览器场景、完整生产构建、54 个服务模块分发和 7 种编译服务组合通过。日志包括 `.data/project-uid-full-unit-physical-final.log`、`.data/project-uid-full-unit-physical-verification.json`、`.data/project-directory-ui-first.log`、`.data/project-uid-physical-build-final.log` 和 `.data/project-uid-physical-production-final.log`。此前全轮的 build-farm mock 未提供新增只读迁移门闩响应，修正测试夹具后重跑；原失败日志保留，未放宽生产门闩。

新运行包 `release/sakura-z9J08y` 的 256 个文件核对通过，指纹为 `d0fc9576c0b0a0ef0849d15dafcd0bb7c3ac9fd1505f5347d3f22789bf512f29`，编译服务摘要为 `e499a218d42de2115a60af3c4744d87f162017d95a6a10813ef2515c67c727db`。包内默认 Node 路径通过 9 组真实 Debian HTTP/生成 SDK 检查：认证与契约、直接终端连接阻止迁移、审阅后迁移和两项目 UID、主命令配置保护、清理失败与同 inode 新网络代、服务和健康检查、非零命令结果、成员不能迁移，以及准确整项目停止。原始证明为 `sakura-boot-persistence-53hCt6/compiled-project-identity-http-c452f1ec-8e0d-4744-bb0b-9dababcbc171.json`；客户端 `execArgv` 为空，源码和包摘要前后一致，原设置恢复、实例停止且所属 QEMU 为零。此前两轮脚本分别漏传 SDK 认证头及误读 Project DTO 字段，保留失败证明，修正测试后再测。运行包复用本机 QEMU/PosixLoom 与依赖，未验证新机器安装。

本批均使用自有测试实例；最终原始证明、日志摘要、661 个源码摘要、旧证明归属及范围索引为 `.data/project-uid-final-checkpoint-evidence.json`。三系统产品测试的 `--no-addons` 条件逐份记录，未据此改变生产默认或声称原生插件退出根因已修复。目录仍为 250 项、247 项有入口、3 项部分实现；普通终端、SSH/Agent、运行时和其余扩展的账号与保护运输接入、实际独立外部 HA 演练、系统级剪贴板边界仍需继续完成。使用与限制见 [项目账号](project-identities.md)、[目录迁移](project-directory-migration.md)、[项目网络隔离](project-network-isolation.md) 和 [未完成功能](unfinished-features.md)。

## 主命令归属、项目账号核心与首次开机持久化

2026-10-01 将未配置多服务的项目主命令接入持久 cgroup v2。主命令第 2 版回执与服务第 1 版分别保存，项目代码只在完整运行身份持久保存并提交后执行；`setsid`、双重 fork 和主进程退出后的后台后代仍可按原归属清理。跨 boot 的旧回执仅在准确旧对象全部不存在时确认停止，不向新开机进程发送信号。配置修改、暂停期间的未知旧会话和清理失败均保留保护；面板显示实际主运行状态，停止不提交未保存的草稿。取消或服务关闭时仍未确认清理的任务保留失败及具体错误码。见 [主命令生命周期](project-main-lifecycle.md) 与 [服务生命周期](project-service-lifecycle.md)。

Alpine、Debian、Ubuntu 各 26 项主命令和 20 项服务实测通过，最终源码摘要与三份主命令证明一致：`project-service-scope.ts` 为 `6ef9f2fd751d3b8c9cc202dde7447dbdd096503b209e557c0f08785ea823448f`，`project-main.ts` 为 `7189b053da5bb6121b4eef1cd2409a5dcf5c6245eee13449a5924973aba9a994`，`project-services.ts` 为 `4b31d27210c4bb99a8733161699af666969034ac7f9f3715522b318605ffe0b5`，`workspaces.ts` 为 `0fcc28e807505e27752000e025cff3cba796e624d6937880707bba00a73120ea`。本轮三个发行版使用 `node --no-addons --import tsx`；没有据此声称历史原生 sshcrypto 退出已修复。证据索引为 `.data/network-remaining-test-temp/project-main-final-verification.json`。

新增独立的持久项目账号核心：预留并恢复固定 UID/GID、身份和修订，核对账号、home、目录 inode 及权限；固定启动器核对命名空间与 cgroup 后降权、清空补充组和 capabilities，支持独立运行和保持上层运行域的继承入口。三个发行版各 17 项实测通过，涵盖预留恢复、真实降权、目录和账号替换拒绝、脱离父进程后代清理、重启及完整磁盘快照恢复；客户端为默认 Node 24.15.0/tsx。三个生产资产总摘要为 `217ea95f32d481e063f8c06e70e356771bd1a41fb20e88e07a4890af86778814`，TS 摘要为 `b97b2bc1789c097b20bfbeaf66a857fb5cb9ff4e7037d3752f369fff5d376f90`。证明分别保存于 `sakura-project-identity-x2Fmmn`、`sakura-project-identity-K9BMe8`、`sakura-project-identity-LSuFUk` 的 `project-identity-evidence.json`。

该账号核心尚未接入所有产品执行入口，继承票据还需由上层持久登记并在清理确认后核销；已有目录也没有自动改属主。当前核心的命令与环境运输仍经过 argv，默认 `/proc` 下不能保证跨 UID 的正文保密，因此尚未接入项目密钥执行路径。新增 `Machines.execInput` 将最多 128 KiB 的 Buffer 副本通过 SSH 标准输入传输并发送 EOF，真实 Debian 9 项验证通过，其中 7 项使用实际 SSH 通道，超限在连接前拒绝；这项运输能力不等于固定启动器已完成接入。边界见 [项目账号](project-identities.md)，输入证明为所属 Debian 的 `command-input-evidence.json`。

首次开机的 SSH 密钥、hostname 与初始化状态在发布 running 前同步；克隆身份更新也在移除待处理记录前同步。三个发行版各三轮新建实例、running 后立即强制停止、重新加载验证通过，首轮没有额外 SSH 或测试补充 sync。九轮都核对密钥、hostname、初始化标记和工作目录，boot ID 改变，QEMU 与 runtime 最终关闭。摘要与时序见 `.data/boot-persistence-test-temp/final-verification.json`。这不构成任意断电下所有磁盘写入的事务保证。

最终全量 Node 测试 971 项，970 通过、1 项按平台跳过；类型检查、32 个插件契约和 9 个插件包、3,082 条语言文本和 74 个动态片段、完整生产构建、54 个服务模块分发与 7 种编译服务组合通过。4 个相关浏览器场景验证主命令清理失败后重试、草稿保留、未知旧主会话禁用及服务清理。日志分别为 `.data/project-main-full-unit-isolated-final.log`、`.data/project-main-all-types-final.log`、`.data/project-main-build-final.log`、`.data/project-main-production-final.log` 和 `.data/project-main-ui-playwright-final.log`。此前全轮曾因测试盘剩余空间不足触发 Golden 容量保护，未放宽该保护；保留两个已停止测试盘并进行原位 NTFS 压缩后再测。另一次全轮有单个测试文件进程退出，未给出 JS 错误；该文件单测和最终独立全轮通过，原失败日志保留，退出原因未确定。

新运行包 `release/sakura-D3sMh5` 的 256 个文件校验通过，指纹为 `2d3e0eae833f8d8761ca057288be62c48b4724e529c3ddc8126eae62ea7c5d2f`，编译服务摘要为 `8a73bbadda94575dfb05ee0255771a6bf8dfcfa667ef1618ec8d5ca09d9e7b8a`。包内默认 Node 路径通过实际 Debian 的 HTTP/生成 SDK 六组验证：两个项目完整运行归属、幂等启动和配置保护、错误 boot 拒绝清理、主进程退出后的全域清理及相邻项目保留。证据为 `compiled-project-main-http-evidence.json`，日志为 `.data/project-main-release-http-default-third.log`；两次先前测试脚本的 SDK 调用错误日志保留，最终修正为路由前缀请求和独立 query 参数。结束后实例停止并重新核对同一包摘要。测试使用本机准备的 QEMU/PosixLoom 与运行依赖，未验证新机器安装；单轮默认路径成功不证明历史原生插件退出已修复。

目录仍为 250 项，247 项有实现入口、3 项部分实现。网络剩余工作包括项目账号与受保护正文运输的完整产品接入、非受管系统入口与管理员路径；剪贴板的系统级边界和实际外部 HA 故障演练仍未完成。本批全部使用自有测试实例，不把本机适配器视为实际独立见证、BMC 与切流系统的证明。持续清单见 [未完成功能](unfinished-features.md)。

## Windows 托管剪贴板双架构控件验证

2026-10-01 补齐现代 .NET 10.0.9 x86 的真实 WinForms/WPF API 与 TextBox Copy/Paste/Cut 验证。x64 SDK 离线构建明确的 x86 程序，由测试目录内微软官方 32 位 dotnet host 执行，不以 AnyCPU 或 x64 运行结果代替；核心与桌面运行时 ZIP 核对固定官方 SHA-512，复用时继续核对原包和关键文件 SHA-256。实际进程的 X86/32 位、CoreCLR、CoreLib 和桌面程序集路径均记录。现代 .NET x64、Framework 4.8.1 双架构及 WinRT Desktop 同轮回归。

每种架构最终各 717 项断言通过，失败、泄漏、fixture mutation 与 unsupported probe 均为零，包含 108 项选区保持断言及 12 次托管文本控件销毁重建。安全选区所在文档包含未选中的敏感文本时仍允许复制；拒绝复制或剪切保留先前剪贴板、全文、选区起点、长度和选区文本。托管窗口使用隐藏控件与非交互键盘消息，不对用户桌面发送输入。最终证据为 `.data/native-clipboard-interface-test-temp/interface-32-8f935ed7-a187-4690-bbff-3c13e7be5d2e/interfaces-proof.json` 和 `interface-64-d7c384f5-6f48-4d21-9a48-d1a277180721/interfaces-proof.json`。

本轮只扩展 fixture 与烟测，生产代理和控制程序没有变化，构建摘要保持 `9fa1ac1a2c923df336c0757d967940c42090337b1e45a0df72759648993817f1`。SDK 首次构建历史日志曾出现开发证书安装提示；随后只读检查仅找到 2026-05-05 的既有匹配开发证书，没有运行前 store 基线，不能声称历史证书存储完全无变化。最终两轮使用新的 D 盘 CLI home，显式禁用开发证书生成与全局工具 PATH 注册，构建日志无该提示；未 trust、删除或导出任何证书私钥。只读审计保存在 `.data/native-clipboard-modern-x86-test-temp/sdk-audit-ff579bb8-abd6-494c-8377-23acd08e9511/`。

CLR/AnyCPU 早期受控启动仍明确拒绝，打包 UWP、历史/云同步及系统级强制边界仍未由上述测试完成，剪贴板目录项保持部分实现。使用与固定运行时测试条件见 [Windows 剪贴板](native-clipboard.md)。

## 原生 Wayland、完整服务归属与 Windows 控件保护

2026-10-01 接通原生 Wayland 应用剪贴板入口，桌面偏好新增 `auto`、`x11`、`wayland` 会话选择。Alpine、Debian、Ubuntu 的桌面脚本核对实际所选入口，旧准备记录缺少 Wayland 程序时重新准备；Debian/Ubuntu 安装提供 `startplasma-wayland` 的发行版软件包。X11 与 Wayland 分别保存规则、会话归属和所有者，公开 HTTP、生成 SDK、克隆与导出导入使用同一版本检查。操作方式见 [Wayland 剪贴板](wayland-clipboard.md)。

Wayland 控制器为每次受控应用创建独立 UID、私有 DBus、home 与运行目录，检查项目目录权限及实际网络，应用和代理使用不同 cgroup。端点发现核对真正的 compositor；KWin wrapper 场景同时固定 socket creator、唯一 KWin child、创建时间、实际程序、继承的监听 FD 和内核 socket inode，child 替换后旧代理停止服务，不跟随新进程。应用连接还核对 UID、网络和所属 cgroup。普通 clipboard 与 primary selection 的复制、粘贴均先在有界内存收齐完整管道，再检查格式、UTF-8、敏感文本和大小，拒绝时不释放新正文。收紧规则取消尚未交付的数据，规则发布和首次写入同步；无法撤回合成器或工具包已经收到的缓存。常规图形协议继续转发，未知/特权管理协议和门户文件令牌拒绝，剪贴板接收 FD 必须是可写 FIFO，避免设备或文件阻塞代理。

20 个固定来源资产包含控制器、代理、来源记录及 17 个上游协议 XML，保留原始许可证和字节，构建与分发均核对大小、SHA-256 及总摘要。最终构建摘要为 `7f32f2af1177e0a5edf9e6329265ad0674494202d201599e3a0cb6e0eadd33f3`。真实 Debian Weston 10 验证 Qt 5/GTK 3 双向复制粘贴、528,000 字节正文、末尾敏感文本、格式和大小拒绝、慢源超时、热更新、子连接及整域清理；真实生产 Plasma v5 另验证 primary selection、公开服务端点发现、私有项目网络、KWin child 替换及已交付缓存边界。13 项 Python 代理回归在真实 Linux 全部通过，包括 SCM_RIGHTS 晚到、独立 FD 队列、异常 FD 与同路径监听 socket 替换。Windows 宿主只执行其中适用的 7 项，其余 6 项 Linux FD 测试由实机补足。证据为所属 Debian fixture 的 `native-wayland-evidence.json`，日志为 `.data/wayland-native-nineteenth.log`。

短任务现在在执行项目代码前进入专属 cgroup v2，用有限锚点、客户机 boot ID 和 cgroup inode 持有本次归属；普通新进程组、`setsid` 和双重 fork 后代仍在该域。停止通过已打开并核对的 `cgroup.kill`，确认域空且释放后才运行暂存清理，独立控制 SSH 重试三次。清理或隔离未确认时明确返回错误并保留回执，不回退到只杀 PGID。GPG 代理连接在失败路径也关闭，临时 GNUPGHOME 仅在确认任务域停止后清理。实际 Alpine、Debian、Ubuntu 分别通过 10、11、11 项任务回归；来源摘要 `43180ea1a46c3244637e8f24e5e9056447fe2be2358d3ff780664406cf959d25`，证据为各所属 fixture 的 `guest-task-cgroup-evidence.json`。见 [短任务清理](guest-task-cleanup.md)。

常驻服务使用独立持久 cgroup：先保存 host intent，再准备客户机域，pane 固定启动器进入该域并发布完整身份，控制服务持久保存回执后才提交项目命令与环境。停止同时核对 live/boot/run/inode/pane/PID 创建时间，清理全域并保留已停止记录供回执丢失后的幂等重试；启动失败只回滚本次新增服务。主 pane 已退出、启动未确认、状态未确认与旧服务待迁移都有独立状态，配置修改或移除服务前必须确认旧运行停止，清理失败的 Job 保留错误码并遮盖密钥。健康检查先核对归属，清理失败时暂停自动检查与重启，成功手动操作才恢复。旧 tmux 会话不按名称猜测归属，需明确迁移。见 [常驻服务归属](project-service-lifecycle.md)。

Alpine、Debian、Ubuntu 各 20 项常驻服务实机回归均完成，覆盖正常/脱离会话后代、未提交超时、全部控制连接失败、延迟准备、回执丢失、boot/run/inode/pane 替换、主进程退出后清理、Workspaces 运行视图与配置保护，以及未知旧会话拒绝。三份 `project-services-scope-evidence.json` 的源码摘要与最终文件一致：`project-services.ts` 为 `058fa900acc269c04586b40d278666d6304b04e83892e559431b64fbf4a0da1e`，`project-service-scope.ts` 为 `57ce13af3cdbb75a949f632fe9c4dde03c4acb8ff927ac53849aca41af61ef3d`。本机 Node 24.15.0 默认可选 sshcrypto 原生插件路径曾在 Debian/Ubuntu 回归后段以 `0xc0000409` 退出，未产生 JS 错误；最终这两个发行版以 `node --no-addons --import tsx` 使用 ssh2 内置纯 JS 回退完成，Alpine 默认路径完成。失败与回退日志均保留，不据此声称原生插件崩溃根因已确定或已修复。

项目 SSH 启动回滚新增同一 live/boot/run 的独立连接重试，核对失败不终止替换后的服务；全部失败返回 `PROJECT_SSH_CLEANUP_FAILED` 并保留归属。三个发行版各 5 项真实回滚回归通过，来源摘要为 `407d843cdbeb2a7eb5e80725455872a8d2d26288eb18130ed6645f00f7704f1c`，证据为 `project-ssh-rollback-evidence.json`。以上三个网络 fixture 为 `sakura-guest-task-Oky2Cx`、`sakura-guest-task-i24quD`、`sakura-guest-task-dhGwI9`，最终全部停止；未操作用户实例。

Windows OLE 在调用会清空旧内容的原始接口前预检完整全局内存数据，错误枚举和正文读取拒绝时保留旧剪贴板。标准 ANSI/Unicode EDIT、RichEdit 根据实际选区拦截复制/剪切消息和对应快捷键，拒绝时同时保留源文本；支持已存在、新线程创建、销毁重建及父窗口初始化内的嵌套子控件。ANSI 控件保留原生消息语义。早期代理静态依赖 Common Controls，允许系统或已核对 WinSxS 依赖，拒绝私有 DLL/manifest 重定向；Toolhelp 只对 `ERROR_BAD_LENGTH` 做有限重试。x64/x86 在私有窗口站分别通过 433/383 项接口断言，WinRT Desktop、Framework 4.8.1 双架构 WinForms/WPF，以及 .NET 10.0.9 x64 常规 API 和 TextBox Copy/Paste/Cut 已实测。现代 .NET x86、CLR/AnyCPU 的早期受控启动、打包 UWP、历史和云同步仍未据此完成。实际接口、普通受控启动及早期启动六组回归均通过，最终源码构建摘要为 `9fa1ac1a2c923df336c0757d967940c42090337b1e45a0df72759648993817f1`；最终整构建的双架构二进制与实测文件逐字节摘要一致。见 [接口边界](native-clipboard.md) 与 [早期启动](windows-clipboard-early-init.md)。

最终 Node 全量回归 884 项，883 通过、1 项按平台跳过；类型检查、32 个插件契约与 9 个插件包、3,076 条语言文本与 74 个动态片段、完整生产构建及最后错误码修复后的服务端重编译、54 个服务模块分发、7 种编译服务组合通过。6 个相关浏览器场景覆盖 X11/Wayland 设置与会话、桌面会话偏好和布局，以及手机端服务清理失败保留状态后重试。日志为 `.data/wayland-services-full-unit-release-final.log`、`.data/wayland-services-release-production.log`、`.data/wayland-service-ui-playwright-final.log` 与 `.data/wayland-desktop-layout-final.log`。

新运行包 `release/sakura-nrW14s` 的 252 个文件摘要校验通过，指纹为 `022721d1b18f4930166171ccb60abdf550b90aa8f7d8e307810aabfa90ab4420`。包内编译服务通过真实专用 Debian 的 HTTP/生成 SDK 验证严格请求、旧版本拒绝、原生 Plasma 发现、准确 ELF 身份、复制拒绝、规则热更新、完整文本复制粘贴与所属会话清理；证据 `compiled-wayland-http-evidence.json` 标记通过、实例已停止、错误为空，日志为 `.data/wayland-services-release-http-prepared.log`。测试使用本机已准备的固定 QEMU/PosixLoom 和运行依赖，未验证全新机器的 setup 安装；运行包没有 Sakura 开发源码目录，20 个 Wayland 资产及 Windows 二进制在包内再次核对，并在测试后重新校验同一包摘要。

目录仍为 250 项，247 项有实现入口、3 项部分实现。网络仍缺持久项目 UID/GID、非受管系统入口与主项目命令的常驻后代统一归属；剪贴板仍有接入前、既有非受管程序、底层/系统路径和已交付缓存的边界；宿主失联 HA 仍缺真实独立见证、BMC、健康和切流系统的实际故障演练。未调用真实隔离接口或用户虚拟机，未将本机适配器验证当作物理节点独立证明。持续清单见 [未完成功能](unfinished-features.md)。

## 认证依赖预取、早期剪贴板策略与 fork 恢复

网络档案新增按 npm、pip 配置的认证下载端点、Bearer 或 Basic 方式及另存的只读私密配置名称。应用档案后，预取只解析对应下载凭证，不加载项目私密配置、npmrc、pip.conf 或导入钩子。凭证通过 SFTP 写入独占的 `0700` 目录和 `0600` 文件，代理读入后立即删除；命令、子进程参数和环境不含凭证。独立 SSH 清理重试只处理本次目录，客户机重新启动后不沿用旧路径。

客户机系统 Python 运行有界回环代理，认证仅发送至准确的协议、域名、端口及目录范围。跨范围重定向、路径穿越、双重编码及控制字符拒绝，公共传递 wheel 不带认证。npm 接受完整第 2/3 版 registry 锁文件并禁用安装脚本，默认 registry 地址可映射至已配置端点；pip 接受 HTML Simple 索引及二进制 wheel。索引最多 8 MiB、包最多 256 MiB、任务上游正文最多 2 GiB、并发最多 8 个，包先完整收齐再交给管理器。原锁文件与包摘要继续用于项目私有网络中的离线安装。使用和限制见 [软件包与项目缓存](package-cache.md)。

pip 缓存改为 `renameat2` 的首次不覆盖发布及完整目录交换，当前目录始终指向完整旧版或新版。取消发生在交换之后可以保留完整新版，不承诺回滚、断电持久性或多次文件读取的事务。不支持原子操作时明确拒绝替换。真实 Alpine 验证首次/替换发布前后的 TERM/KILL、ENOSYS、首次并发碰撞，以及连续 1,000 次真实交换；并发读取未出现当前目录缺失。认证与公共 pip 均验证首次、替换和慢下载取消，取消后核对原缓存与所属暂存清理。证据为所属目录的 `atomic-cache-evidence.json`。

托管任务清理使用 boot ID、主进程/锚点创建时间及 PGID/SID 登记身份。存活锚点持续占有所属组，控制连接提交带身份的停止请求，由锚点发送组信号；清理 SSH 失败、暂存清理失败均独立重试，确认组停止后才清理暂存并核销记录。身份不符或停止未确认明确报错，不单独依据数值 PID/PGID 杀进程。实际 `/proc` 解析支持含空格、括号与换行的 comm。专属测试包括首次控制 SSH 失败、延迟登记取消、错误 boot/start ticks、无关特殊 comm 进程保留及 BusyBox setsid 的实际退出码。

Windows 第 3 版双架构代理将已授权的策略 DLL 放在首个 import，同步加载规则并建立 Win32/OLE hooks，覆盖普通未打包原生 EXE 的原始应用 DLL TLS、DllMain、EXE TLS 和主入口。服务先持久保存归属；初始化期间主线程保持暂停，最后独立核对实际策略与文件身份再恢复。系统 DLL 实际路径和 activation context 的 SxS 依赖也核对，关键依赖重定向拒绝，正常 Common Controls 与私有 manifest DLL 可用。双架构私有窗口站的上述最早调用均被当前规则拒绝，错误 cold build 未执行原始应用 TLS，失败 Job 清理不影响其他已提交进程。来源与边界见 [早期启动验证](windows-clipboard-early-init.md)。最终 Windows 来源摘要为 `82765b61ec05114de40e67197dcf601cfa117de1d7ed51f1173e11a8845cf213`。

Linux 代理通过 atfork 为普通 fork 子进程建立独立状态、新连接与缓存，正常退出不等待父进程中的线程；父连接及进行中的 INCR/MULTIPLE 继续工作。继承的受管显示器指针不能继续建立请求，遗留不可回收分配继续计入 32 MiB 预算，最多 32 层。真实 Debian KDE/Qt 与 Xlib/XCB 验证子/孙进程、新连接、热更新、普通析构退出及父传输保留；完整既有大文本、敏感检测、MULTIPLE 和两项真实 Qt INCR 回归也通过。支持范围限于已测普通线程 fork，特殊 fork 路径及任意第三方回调不作普遍承诺，见 [X11 策略](x11-clipboard.md)。最终 Linux 来源摘要为 `7979b7e0f7f98c1b2132dc895b70b86bb38c5e091124ad732630e9497b88be3c`。

JetBrains 档案新增独立严格公钥文件，同时固定项目别名与当前本机端口，兼容实际 Gateway SSHJ 不使用 HostKeyAlias 的行为。专属 WebStorm 启动器通过 VM_OPTIONS 固定项目 Java 配置、缓存与 home，普通 properties 文件不足以约束当前 native launcher。官方 Gateway 2026.2.2 与 WebStorm EAP 263.5701.38 在 Debian 12、Ubuntu 24.04 各两个项目实测 SSH/SFTP 上传、后端、转发、独立网络/cgroup/配置及停止一个项目后另一项目保持可用。图形 Client 已实际启动，但要求 JetBrains Account，账号、许可和编辑保存均未验证；不据此声称任意默认 Gateway 部署都受本项目启动配置约束。见 [项目 SSH 与编辑器](project-ssh.md)。

最终 Node 回归 805 项，804 通过、1 项 Linux 宿主测试跳过，认证代理另通过 10 项真实 HTTP 边界测试。类型检查、32 个插件契约与 9 个插件包、3,064 条语言文本与 71 个动态片段、完整生产构建、54 个服务端模块分发和 7 种编译版服务组合通过。5 个相关浏览器场景覆盖网络档案认证字段及保存/应用/恢复、Windows 双架构启动与失败、Debian/Alpine 项目 SSH 和手机布局。完整源码认证预取已在 Alpine、Debian、Ubuntu 通过；最终 Alpine 原子缓存和 Debian 任务清理专属真实回归也通过。测试只使用所属实例、进程及私有窗口站。最初全轮中 SFTP 测试进程提前退出，单项及最终全轮通过；旧取消用例的信号命令断言已同步为带身份的停止请求。

新运行包 `release/sakura-31Xp64` 的 231 个文件摘要校验通过，指纹为 `1d8cd048ab40e55b8c78df405ffeee4b4250b3c665c4f5caa567ce3ef5a9fee4`。包内编译服务与真实专用 Debian KDE 通过 HTTP 和生成 SDK 验证恢复、身份、持久规则、严格参数、旧版本拒绝、原生受控启动、复制拒绝与会话清理，日志为 `.data/continuation-release-x11-http.log`。实测使用本机已经准备的固定 QEMU/PosixLoom，不切换用户活动安装。Detours 的逐文件来源摘要核对通过，Git 对供应商目录保留原始字节，包括上游少量混合换行。

同一运行包另在真实 Debian 的新私有项目通过认证 HTTP/SDK 联测：网络预览与应用、私密配置保存、npm/pip 预取及离线安装共 4 个任务均完成，公共传递 wheel 未带凭证，该项目的认证和暂存目录为 0。运行包没有开发 Python 源码目录，确实从已校验分发资产读取下载代理；结束前同步磁盘，停止实例、恢复原活动项目及插件选择，并再次校验同一包摘要。日志为 `.data/continuation-release-auth-http-debian-final.log`，证据为所属目录的 `authenticated-prefetch-http-evidence.json`。初轮测试 registry 与核心命令同组，被正确清理导致连接失败；测试服务改用独立会话。复用旧数据又发现旧暂存及未同步强制停止后的网络配置冲突，最终改用新测试项目并在停止前同步，不删除归属不明的旧目录。

目录仍为 250 项，247 项已有实现入口、3 项部分实现：非受管/管理员网络路径、原生 Wayland/既有程序/底层剪贴板路径，以及真实独立节点的宿主失联演练。2026-10-01 只读检查未发现可用外部见证、目标主机、Redfish、健康或切流配置，没有调用实际隔离接口或用户虚拟机；本机适配器测试不能证明物理节点独立。持续未完成项见 [清单](unfinished-features.md)。

## 受控启动、复合剪贴板与 Alpine 项目 SSH

Windows 应用剪贴板新增「受控启动此应用」。先保存并启用完整 EXE 路径、文件摘要和规则，以 JSON 字符串数组输入参数。匹配架构的控制程序把新进程主线程保持暂停，并在创建时原子加入本次专属 Job；服务持久保存进程归属，独立复核实际代理、当前规则和文件身份后才恢复主线程。启动目录使用 EXE 的完整目录，包含驱动器根目录边界。提交前关闭服务或握手失败只清理本次启动；提交回执丢失时保留归属并显示未确认，刷新后核对实际状态。DLL/TLS 初始化可能早于规则，保证范围是应用主入口，不能据此宣称初始化或所有子进程均受约束。细节见 [Windows 应用剪贴板策略](native-clipboard.md)。

x64 与 x86 在私有窗口站中均完成真实启动验证：首次进入 `wmain` 时代理已就绪，第一次复制、粘贴被当前规则拒绝，空参数、引号、反斜杠、控制字符和 Unicode 原样传递，完整启动目录、扫描去重、服务重载和停用通过。每种架构还验证 5 个控制程序握手/退出/回执失败分支和 2 个服务关闭分支；未进入主入口的失败进程均清理，测试进程残余为 0。最新 Windows 构建摘要为 `33e6adcbf10568bfb93faa0a1c3fba8d7137ba96b224fa8f032d74d85ddf9d22`。

Linux X11 新增有界 MULTIPLE 复合传输，每项按原序独立完整检查，共用 INCR 的 32 MiB/32 正文槽预算；最多 128 项、32 组，单项采集时限 8 秒、全组 12 秒。私有认证 XCB 连接与独立请求窗口把复合请求转成真实单目标转换，兼容 Qt 5 的 INCR 窗口管理。规则收紧在返回和发布前继续检查；父列表不变性、请求代次、旧 cookie、属性复用、禁止副作用与嵌套目标、认证中断和线程退出均有明确处理。失败只影响对应条目，不承诺事务；受管复制仍受服务器完整原子发布容量约束。详见 [Linux X11 应用剪贴板策略](x11-clipboard.md)。

Linux 代理尚未实现 atfork 重置，fork 后不 exec 而继续使用 hooks 或普通 C++ 析构不受支持，继承的锁、线程状态和连接不能当成新子进程的可用状态；exec 重新加载代理的路径继续受支持。文档明确区分这项应用兼容边界与 cgroup 子进程归属。

本批最终 Linux 来源构建摘要为 `a2b908b27e3869e4052f215e11aa4071614ea977a273e251e4e7bf2f78e01938`，三个生产源文件与运行包资产清单逐项一致。真实请求窗口销毁后复用同一 XID、旧发送者继续写块时，代理取消原组并保留有界拒绝身份，不发布正文或原父通知；阻塞读结束后也重新核对请求代次。

真实 Debian KDE/Qt 验证普通文本复合传输、显式 Qt 请求者与同进程持续泵送事件；认证 Xvfb 的实际最大请求为 4,194,300 字节，用 Qt 的两个同样大小 MIME 二进制条目触发真实 INCR，CLIPBOARD、PRIMARY 各捕获 8 个协议头。Xlib/XCB/mixed 与 Qt 完整接收，超出原子容量的受管复制逐项拒绝，认证卡住在有界时间内退出并回收线程。原生 fixture 的双向大文本、跨块 UTF-8/凭据、缓存预算、并发与畸形/超时回归也通过。前一批 Qt 超过 256 KiB 的正文原为普通大属性，旧段落已明确修正，不再冒充 Qt INCR 证据。

Alpine 项目 SSH/SFTP 接入原生 OpenRC 和真实 cgroup v2，核对开机身份、PID 创建时间、固定主机公钥、配置摘要、项目网络及实际监听；停止等待 init 回收整个服务 cgroup。所有 Alpine 项目均使用项目入口，能力中心和 IDE 页面提供 SSH/SFTP/Neovim，拒绝当前官方客户端不支持的 VS Code Remote-SSH 和 JetBrains Gateway 后端。Debian、Ubuntu 保留 systemd 入口和已经实测的 VS Code 客户端。使用见 [项目 SSH 与编辑器](project-ssh.md)。

Alpine 保持坏 JSON、缺 PID、错误 PID 类型、旧 boot ID 或旧 start ticks 的记录原样时，直接停止、重复停止和重新配置已实测通过；桥接、真实主/后台 PID、cgroup 和 OpenRC 状态标记均清理，同机另一个项目的实际 SSH 与归属不变。核对真实 sshd 程序及精确固定配置路径不依赖损坏记录；对应主进程逃出所属 cgroup 时拒绝停止成功、重建和目录修改，不单独杀无法确认的 PID，恢复实际归属后再停止可用。

官方 Neovim 0.12.5 在 Alpine、Debian、Ubuntu 各两个实际项目完成远程文件打开、修改、UTF-8 保存、重新打开与独立 SSH 读取核对。Windows netrw 对包含空格的绝对远程路径有转义问题，因此配置同时提供 `scp://项目别名/./` 相对入口，使用已核对的项目工作目录；实测最终 Alpine 路径与导出前缀一致。不以这些文件读写场景宣称已验证全部目录浏览操作。Ubuntu 首轮后段管理 SSH 超时保留原日志，完整复测退出 0，其他发行版完整实测也已通过。

最终 Node 回归 791 项，790 通过、1 项 Linux 宿主测试跳过；类型检查、32 个插件契约与 9 个插件包、3,057 条语言文本与 71 个动态片段、完整生产构建、54 个服务端模块分发和 6 种编译版服务组合通过。4 个相关浏览器场景覆盖 Windows 双架构受控启动、Debian/Alpine 项目连接及手机宽度。Windows 与 Linux 原生测试、三个发行版 SSH 全轮和 Alpine 损坏记录恢复另使用实际测试进程与客户机验证，未访问用户交互剪贴板或实际用户虚拟机。

新运行包 `release/sakura-Ng60Zs` 的 229 个文件摘要校验通过，指纹为 `d70f590383c66f32ea2b7756d074bdf4e0e0fab331dd997b1a03918f7d72f5fa`。包内编译服务与真实专用 Debian KDE 通过 HTTP 和生成 SDK 联测，覆盖桌面恢复、身份、持久规则、严格参数、旧版本拒绝、原生受控启动、复制拒绝及会话清理；日志见 `.data/remaining-next-release-x11-http-final.log`。实测连接到本机已准备的固定 QEMU/PosixLoom 运行时，未切换用户活动安装；结束后所属 QEMU/Windows 测试进程数为 0。

整体清单仍保留 3 项部分实现：未受管网络路径与尚未验证的客户端/凭证预取范围、真实外部 HA 故障演练，以及原生剪贴板的 Wayland、既有或绕过常规接口的进程、Windows DLL/TLS 初始化与 Linux fork 后不 exec 的边界。新增范围不据此扩大为系统级强制隔离。

## 双架构剪贴板、INCR 与见证恢复

2026-10-01 将 Windows x64 宿主的原生剪贴板代理扩展到 x86 普通 EXE。两个控制程序和 DLL 按已核对的进程架构接入，128 字节共享 ABI 保持一致；清单第 2 版校验全部双架构资产，历史第 1 版继续只支持 x64。未知架构和损坏工具拒绝附加，已加载的 x86 规则可由已校验的主控制程序停用。界面显示进程位数，归属、自动扫描、服务重载和停用流程复用现有持久状态。MinHook 新增官方固定提交的 x86 解码器，逐文件来源摘要进入构建；构建同时核对两种编译器目标三元组及输出 PE 架构。

Windows x86 受管应用与 x64 对端的真实 Win32/OLE 联测通过，x64 原有用例也通过。覆盖方向、大小、格式、敏感文本、缓存对象、延迟渲染、自动扫描、服务重载、重复 DLL 核对和停用；测试在私有窗口站中执行，不访问用户交互桌面剪贴板。双架构配置页面及手机宽度场景通过。构建和边界见 [Windows 应用剪贴板策略](native-clipboard.md)。

Linux X11 双向 INCR 分块改为完整收集后检查 UTF-8、跨块敏感内容、格式与大小，传输途中收紧规则继续生效。Xlib/XCB 混合调用和四线程对同一属性读取共用已验证缓存，保留真实长度探测和删除语义；32 位属性使用正确的本机长整型步长。单次硬上限 16 MiB、缓存预算 32 MiB/32 槽、超时 8 秒，4096 个待处理回复后的请求明确失败。复制端以服务器实际最大请求为限，超过完整原子发布容量的内容拒绝，不逐块输出前缀。cgroup 清理对进程退出与内核释放之间的 EBUSY/ENOTEMPTY 竞态有限等待，UID 和会话归属检查继续保留。

真实 Debian KDE/Qt 超过 256 KiB 的双向传输、热更新、控制重载、停用和 cgroup 清理通过；本批 Qt 5.15 启用了 BIG-REQUESTS，实际原子上限约 16 MiB，因此这些 Qt 正文属于普通大属性，不能作为 Qt INCR 的证据，此处修正原记录。独立认证 Xvfb 的原生 fixture 实际发送 INCR，验证 Xlib/XCB/mixed、空流、TARGETS 过滤、缓存预算、通用回复接口、并发读取、畸形与超时流。实测最大请求为 16,777,212 字节，16 MiB 二进制完整发布被明确拒绝。Linux 构建摘要为 `f2fdcf2684236398bcf5b56d73c17c6da6db6d603ff5d0ccde0f8bee8a57eed8`；测试清理竞态的 8 个 Python 行为用例通过。细节见 [Linux X11 应用剪贴板策略](x11-clipboard.md)。

独立 HA 见证增加规范状态路径的内核独占锁和持久持有者记录，不能因锁文件丢失启动第二个活见证；进程异常退出后，只有确认同一本机的旧 PID 已消失才回收。恢复核对持久计划和绑定，持久写失败封锁新心跳及来源启动。每次目标启动、接管重试和切流核对 BMC UUID 与来源仍关闭，持续检查已接管目标、应用和流量；目标退出后只重启原副本，保留接管期间写入。失败隔离阶段也能在精确目标停机并持久退役后退出接管，退役回执跨重启和撤防心跳保留，丢失响应可以重试。

新增只读 `--drill-plan` 与 `--observe`：生成具体来源、目标、硬件和快照计划，保存初始基线及两次稳定完整接管的 JSONL 证据，不发送关机或切流。证据明确不证明物理节点独立；实际第三节点和 BMC 配置仍未在当前工作区找到。Windows HA 定向测试通过；独立部署流程、不可直接启动的占位配置和 systemd 示例见 [真实故障演练](ha-external-drill.md)，这些说明和示例随见证程序进入运行包摘要。

能力中心的编辑器下载配置复用 IDE 的已核对项目 SSH 入口，私有项目、同实例其他项目及不可读配置不会回退到实例 SSH；入口或 IDE 插件缺失时明确拒绝。共享依赖预取不解析项目密钥，清除项目执行环境与导入钩子，只保留单独保存的合法镜像/代理；npm 在独立暂存目录验证 registry 锁定依赖、拒绝 Git/路径/工作区选择器，并禁用脚本和项目 npmrc，pip 只下载二进制 wheels，安装仍回到项目网络离线执行。真实 Alpine、Debian、Ubuntu 已通过正常 npm/wheel 预取、私有离线安装、导入钩子网络及危险来源/配置拒绝。官方 VS Code 1.140.0 和 Remote-SSH 0.129.2026091815 已在真实 Debian、Ubuntu 各两个项目验证桌面客户端、远程扩展、编辑保存、集成终端、任务和外网拒绝；JetBrains 与 Neovim 仍只验证导出档案及 SSH 连接，需要项目凭证的依赖源尚无安全预取接口，当前明确拒绝。

HA 最后审查发现两条自动接管路径可能重叠：本机选择新副本时，见证仍保留旧计划。已将见证初始化提前，本机持久栅栏与已有栅栏重试必须先确认见证撤防，宿主计划检查与撤防共用串行队列；慢速检查结束后重新核对来源运行状态、策略和登记，不再发布已失效计划。撤防及目标检查返回后再次核对策略、来源停机、服务权限和当前栅栏，等待期间关闭策略、切换目标或关闭服务不会启动目标。隔离失败阶段的退出接管入口也已接到界面，仍要求确认目标期间的数据，并由后端拒绝尚在运行的目标。10 个相关浏览器场景已通过，含 fencing/fenced 失败后的拒绝与恢复、双架构 Windows、Linux X11、项目 SSH、私有终端和独立应用窗口。

最终 Node 回归 780 项，779 通过、1 项 Linux 宿主测试跳过；Windows HA 定向测试 37/37，Linux 最新本机与宿主权限回归 3/3，前一轮核心、内核锁、观察和 HTTPS 回归 23/23，轮次数量有重叠。类型检查、32 个插件契约及 9 个插件包、3,049 条语言文本及 71 个动态片段、完整生产构建、54 个服务端模块的分发检查和 6 种编译版服务组合通过。

编译版独立见证与真实 Alpine 历史快照、副本和 HTTP 应用通过错误 BMC UUID 拒绝、来源隔离、应用及流量重试、见证重启、来源启动拒绝和持久目标退役。新增真实目标写入后停机，再由见证重启同一副本，确认开机身份变化、新写入保留且没有重复切流。编译版 `--drill-plan` 与 `--observe` 捕获来源基线和两次稳定完整接管，结果仍明确 `physicalNodeIndependenceVerified: false`，BMC 与流量适配器仍位于同一测试电脑。日志见 `.data/remaining-compiled-ha-alpine-1.log`。

编译版服务和第 2 版运行包 `release/sakura-HuTvdp` 均通过真实 Debian KDE 的 HTTP、生成 SDK、归属及规则保存、严格参数、旧版本拒绝、受控启动、原生复制拒绝和会话清理。运行包 229 个文件摘要通过，包含双架构 Windows 资产、最新 Linux 来源及 4 份见证部署说明/示例；摘要为 `c28203a8654e13b6f1058ca00615a86675e721854aa2cb665b8799cff095b1d9`。运行包实测使用指向当前固定运行时的 `.tools` 与 `.vendor` 本机链接；运行包摘要仍逐文件核对受管内容，用户安装及活动版本未切换。

整体清单继续保留 3 项部分实现：非受管的项目网络路径、真实外部 HA 故障演练和原生剪贴板剩余范围。MULTIPLE、原生 Wayland、既有普通 Linux 程序、静态及底层协议调用、新 Windows 进程附加前的间隔和受保护进程没有据本批验证宣称完成。

## Linux X11 原生应用剪贴板

2026-10-01 接通共享 KDE 显示器上的显式 Linux X11 应用启动与剪贴板规则。入口在桌面工具栏「原生应用剪贴板」，按规范 ELF 路径、架构及文件摘要保存方向、其他格式、敏感检测和 UTF-8 上限。代理覆盖 Xlib/XCB 的 PRIMARY、CLIPBOARD、格式属性及通知；运行中读取根用户策略，保存失败保留原规则，客户机更新失败显示已保存意图和重试入口。使用、安装及范围见 [Linux X11 应用剪贴板策略](x11-clipboard.md)。

应用通过已经核对的文件句柄执行，继承 KDE 绑定项目的目录、环境和实际网络空间；每个会话有私有 D-Bus，避免转交给未受控的已有程序。根用户 cgroup 管理应用、D-Bus 及子进程，核对 UID、PID 创建时间、实际网络和库映射后报告状态；停止只结束本会话。控制服务关闭保留规则，重载恢复归属；克隆、导出与导入保留规则和身份，不重放 PID 或自动启动应用。三个生产源文件和库摘要进入运行包及更新校验。

真实 Debian 12、Linux 6.1、KDE Plasma 5 和 Qt 5 验证了 Xlib/XCB/Qt 双向传输、热更新、停用、拒绝计数、服务重载和 cgroup 清理。独立认证 Xvfb 使用 Xlib/XCB、混合 API 和实际 xclip 检查方向、PRIMARY、内容与格式、UTF-8 上限、敏感检测、缓存属性重读、元数据查询、无效策略及 INCR 拒绝。修复了私有网络挂载切换遮蔽 cgroup、Xlib 内部事件读取与 XCB 原子查询的锁重入，以及 Qt 零长度大小查询被误拒绝。浏览器已验证配置保存、字面参数、刷新恢复、错误项目拒绝、停止与手机宽度；备份测试覆盖规则和服务归属的克隆、导出/导入。

编译版 HTTP 与生成 SDK 已联测真实 KDE 恢复、严格请求体、版本冲突、应用身份、保存规则、受管启动、实际复制拒绝与计数，以及停止和记录清理；同一用例从运行包内服务执行也通过，复用已有固定 QEMU/PosixLoom 运行时。完整 Node 回归 754 项，753 通过、1 项 Linux 宿主测试跳过；6 个相关浏览器场景、32 个插件契约与 9 个插件包、3,049 条语言文本与 71 个动态片段、类型检查、生产构建、54 个服务端模块分发检查及 6 种编译版服务组合通过。第 2 版运行包 `release/sakura-LscrLq` 的 223 个文件摘要校验通过，Linux 构建摘要为 `d6e3d0c4cfca189fcf5560ccb6955f980a5671e978bb4916f6aa3fdd8654aaa2`；原有 Windows 原生二进制保持相同摘要。早期一次冷迁移测试进程在加载阶段退出且未给出具体诊断，单独复测和最终全集均通过，尚未认定该次退出的根因。

总清单仍保留 3 项部分实现：非受管项目网络路径、真实外部 HA 故障演练及原生剪贴板剩余范围。已有应用、原生 Wayland、静态或提权程序、直接底层协议及清除加载环境的子进程仍未覆盖；不能撤回已经返回的字节和其他程序缓存，受限状态的 INCR/MULTIPLE 仍拒绝。其他发行版和商业图形应用未据此视为实测完成。

## Windows 普通应用剪贴板代理

2026-10-01 接通 Windows x64 普通 EXE 进程的 Win32/OLE 剪贴板代理。系统设置可从当前用户的运行中进程选择应用，按完整路径与文件摘要保存复制、粘贴、其他格式、敏感检测和 UTF-8 大小限制；后台扫描已有及新启动进程，核对用户、会话、PID、创建时间与架构。代理及控制程序纳入生产资产与运行包摘要，附加失败、未知架构、文件变化与旧代理分别显示状态。使用方式及范围见 [Windows 应用剪贴板策略](native-clipboard.md)。

规则由仅当前用户与 SYSTEM 可访问的命名内存段传递，只保存规则、版本、身份与计数。服务先持久记录归属，再附加进程；收紧权限时，已包装的 OLE 缓存对象、源对象延迟供给及 Win32 延迟渲染重新核对当前规则。关闭控制服务保留当前进程规则；重载恢复归属，显式停用只解除本安装已归属进程的方向与内容限制，失败保留可重试记录。数据迁移维护会暂停写入和扫描，界面锁定期间继续执行已保存的策略。相同代理构建随安装目录切换时复用已有内存段及 DLL，避免重复加载和叠加钩子；不同构建需重启应用。

真实 Win32/OLE 应用在独立新窗口站中验证，未读写交互桌面的剪贴板。通过方向拒绝、原剪贴板保留、格式枚举、错误进程身份、中文与 UTF-8 大小、敏感文本、畸形数据、自定义二进制、OLE 缓存对象、`GetDataHere`、禁粘贴时复制、敏感与纯文本规则下的复制、混合格式过滤、延迟渲染、自动扫描、锁定、重载、不同安装目录复用与显式停用。长 JWT 与凭据改用迭代或有界检测，并通过超过 64 KiB 的真实剪贴板输入，避免递归正则耗尽应用线程栈。

完整 Node 回归 746 项，745 通过、1 项 Linux 宿主测试跳过；含归属记录写入失败时拒绝附加和恢复后重试。4 个浏览器场景通过，包括新设置的保存、重载、附加失败提示、停用与手机布局，以及原网页剪贴板、Windows 工作区集成和项目 SSH 页面。32 个插件契约与 9 个插件包、3,017 条语言文本与 71 个动态片段、类型检查、生产构建、54 个服务端模块的分发检查及 6 种编译版服务组合通过。第 2 版运行包 `release/sakura-0Or7oA` 的 219 个文件校验通过，包内原生程序再次通过实机联测；摘要为 `88bb64c829bb1a33deb90980db8fd82de9c48d6fd517734b3ad4c8419afbc301`。

初期实机测试修正了 OLE 内部对象与格式元数据被纯文本规则误拦截、混合格式源不能正常复制，以及进程列表中的非 EXE 路径使整个列表校验失败。测试启动使用系统分配的新登录标识与窗口站，保留当前用户本机权限，不创建账户、验证网络凭据或加载用户配置文件。首轮 Node 回归只有新增 OpenAPI 断言漏写 `core.` 前缀，修正后完整回归通过。所属测试进程均已结束，临时文件位于 D 盘。

总清单仍保留 3 项部分实现：非受管项目网络路径、真实外部 HA 故障演练，以及普通 Linux 进程和 Windows 代理范围之外的剪贴板路径。新进程附加前、接入前已取得的原始对象、受保护程序、32 位程序与其他底层接口仍未覆盖；商业图形应用和其他 Windows 版本的兼容性也未据此视为已验证。

## 项目 SSH、SFTP 与 VS Code 后端

2026-10-01 为 Debian、Ubuntu 私有项目接通独立 OpenSSH 服务。含私有项目的实例撤销原有名称别名，使用实例 UUID 与项目 ID 的专属入口；每个项目持有独立客户端密钥、固定主机公钥和编辑器缓存目录。命令、SFTP、回环 TCP 转发、VS Code 后端及后台子进程使用启动时固定的项目目录、环境、密钥与网络。共享项目也使用自身 SSH 服务和缓存，保持共享网络模式。私有入口的离线下载设置、生命周期和使用边界见 [项目 SSH 与 Remote-SSH](project-ssh.md)。

启动及每次新连接核对项目绑定、文件摘要、主机公钥记录、systemd 启动标识、实际程序、全部所属进程的网络及回环监听；配置或环境变化后拒绝继续使用旧入口。停止清理整个服务 cgroup，包括脱离 SSH 会话的后台程序；目录及网络绑定保护在 IDE 插件未加载、启动文件丢失时仍生效，停止不依赖密钥服务。控制服务重载后可核对并恢复本机桥接，暂停会关闭连接，客户机重启后手动重新配置。Windows 配置与密钥设置原生 OpenSSH 所需文件权限。

真实 Debian 12、Ubuntu 24.04 均通过 Windows OpenSSH 身份认证、带空格及单引号的目录、环境与 Windows DPAPI 密钥、实际命名空间、SFTP 上传、两个项目相同端口的 HTTP 应用、TCP 转发、外网及跨项目密钥拒绝、共享项目、控制重载、暂停和后台进程清理。微软官方 VS Code Server 1.140.0 经摘要校验后通过真实 SFTP 分别传入两个项目，验证了各自缓存、实际后端进程网络、SSH 转发版本端点和停止清理。本机未安装 VS Code 图形客户端，Remote-SSH 扩展界面的端到端验证仍未完成。环境变量与 SSH 原始命令重名也不能替换执行内容。

补充检查覆盖客户机配置篡改、本机 known_hosts 改动、运行时启动目录与服务文件丢失、额外路由、密钥轮换、密钥插件缺失和客户机重启恢复。实机检查修正了 OpenSSH 启动后清除自身环境的状态探测、Windows 继承权限被原生客户端拒绝，以及 PowerShell 模块自动加载差异；文件权限改用原生 .NET ACL。浏览器检查还发现 IDE 重复声明“项目”页面，使加载器选择缺失组件，现由项目插件提供页面，SSH 请求随页面关闭取消，并更新了原有容器网络提示。

完整 Node 回归 737 项，736 通过、1 项 Linux 宿主测试跳过；SSH 配置与停止确认、手机宽度、私有终端和两个容器页面的 4 个浏览器场景通过。32 个插件契约与 9 个插件包、2,993 条语言文本与 71 个动态片段、类型检查、生产构建、54 个服务端模块的分发检查及 6 种编译版服务组合通过。第 2 版运行包 `release/sakura-4HMwZ5` 的 213 个文件摘要校验通过。

初期一次测试实例的配置文件损坏、一次测试脚本未处理重复 SSH 错误事件，分别在使用新实例及补齐脚本错误处理后通过；未据此认定配置损坏的根因。Ubuntu SFTP 上传期间另遇 C 盘空间耗尽，此后临时目录改用 D 盘，两个发行版的完整联测均通过。所有所属临时实例已停止。自动审批拒绝清理用户 Temp 下的 `sakura-project-ssh-x5KVqX`、`sakura-project-ssh-HNzSTL`、`sakura-project-ssh-NvoFQj`，仅返回“blocked by policy”，三者保留，未改用其他方式删除。

本批完成项目 SSH 路径，整体仍有 3 项部分实现：非受管系统 SSH、自行启动进程及部分扩展的网络范围，真实第三节点与带外隔离的 HA 故障演练，以及普通 Windows/Linux 进程的系统级剪贴板策略。

## 私有项目 Docker 与数据库入口

2026-09-30 将受管容器接入项目网络。Debian、Ubuntu 每个私有项目拥有独立 Docker / containerd、Unix 套接字和数据目录，容器使用本项目的 `host` 回环网络，不创建网桥或转发。共享网络准备安装工具和镜像，不加载项目环境与密钥；导入、Dockerfile 构建和运行、Compose 与官方 Dev Container CLI 在项目网络中执行，固定客户端连接并校验实际守护程序和容器网络。Compose 和 CLI 同时限制特权、网络管理能力及客户机开机自启；失败和取消按启动尝试清理所属容器。

能力中心的私有数据库操作通过可选容器插件执行，支持 PostgreSQL、MySQL、Redis 的项目内端口与独立数据卷，输出遮盖密码。容器列表省略命令参数，日志另从容器配置提取已知密码与令牌进行遮盖。项目目录和模式保护移到核心服务，已停止的容器也受保护，停用容器插件仍有效；控制服务重载保留有效环境，客户机重启后手动恢复并重新核对绑定。使用与测试入口见 [私有项目容器](private-containers.md)。

真实 Debian 12、Ubuntu 24.04 均完成两套独立 Docker / containerd 的同端口 HTTP、进程命名空间、环境与 Windows DPAPI 密钥、非 root 容器、Dockerfile 网络、Compose v1/v2、官方 Dev Container 的镜像/Dockerfile/Compose、绑定篡改拒绝、暂停、构建取消与遗留容器清理、配置变更保护、额外路由拒绝及实例重启恢复。另以 PostgreSQL 16、MySQL 8、Redis 7 的官方镜像和原生客户端分别完成两个私有项目的认证查询、同名容器与端口、各自数据、容器重启持久化、实际网络、共享回环及外网拒绝。

实机测试定位并修复兼容问题：网络启动不再经会重新挂载 `/sys` 的 `ip netns exec` 启动 Docker；每个 Docker 使用自己的 containerd，避免 Debian 自动连接共享服务；守护程序使用 `022` 掩码，避免 Ubuntu Docker 29 将容器根目录设为仅 root 可访问。Ubuntu 的 dockerd 路径另兼容 `/usr/bin`。MySQL 官方镜像因默认虚拟 CPU 缺少 x86-64-v2 退出，现固定为 `Nehalem-v1`，并使 WHPX 探测采用同一模型。CPU 改动下次开机生效；旧 x86 CPU 内存快照不能恢复到新 CPU。真实 Alpine 的内存快照在运行中及实例重启后恢复通过；配对 TLS 中的真实 QEMU 正常迁移与不同 CPU 在任何状态变更前拒绝也通过，ARM64 CPU 与既有指纹格式保留。

完整 Node 回归 732 项，731 通过、1 项 Linux 宿主测试跳过；3 个容器浏览器场景、32 个插件契约与 9 个插件包、2,989 条语言文本与 71 个动态片段、类型检查、生产构建、54 个服务端模块的分发检查和 6 种编译版服务组合通过。第 2 版运行包 `release/sakura-6M4Qfj` 的 213 个文件摘要校验通过。

Docker Hub 在客户机中连接超时，联测从 Docker 官方 ECR 发布源准备相同镜像并核对导入后的镜像标识；ECR 首次 MySQL 请求限流、Ubuntu 下载一次失败后在有限重试内成功。测试初版另修正了 Compose v2 丢弃未使用网络定义和错误文本差异的断言，现统一移除未引用的顶层网络且验证不会创建网桥。早期一次 Ubuntu Node 工具进程出现段错误、一次 Docker 启动超时，以及一次独立 QEMU 联测提前结束但没有输出诊断，后续完整验证通过；不据此认定这些瞬时故障的根因。

临时测试实例均已停止。自动审批拒绝清理临时目录 `sakura-private-databases-ja0Jnj`、`sakura-private-containers-8LFjOz`、`sakura-private-containers-CgM5tP`，仅返回“blocked by policy”，三者保留在当前用户的 Temp 目录中。

本批推进项目网络隔离的容器路径，整体仍保留 3 项部分实现：独立 SSH、自行启动进程及部分扩展的项目网络边界，真实第三节点与带外隔离的 HA 故障演练，以及普通 Windows/Linux 进程的系统级剪贴板策略。

## 服务网格项目网络与真实代理验证

2026-09-30 将 Envoy 边车的配置验证、启动和版本检查放入所选项目网络，加载其目录、环境及密钥。私有项目只使用自身回环，多个私有项目及共享与私有项目可以复用端口；两个共享网络项目保存策略及切换模式时仍检查冲突。每个代理关闭热重启，避免默认共享资源冲突。策略保留第 1 版文件兼容性。

持久会话记录项目目录、网络与策略摘要及唯一启动标识。状态核对配置文件、程序、参数、工作目录、实际网络、唯一窗格和由该进程持有的回环监听；控制服务重载保留有效边车，旧版或失去会话的代理不能被自动视为可用。运行时保护项目绑定，暂停实例拒绝修改策略及禁用能力；配置和启动共享实例操作保护，启动时再次检查是否被禁用。停止用 pidfd 清理本项目固定配置对应的 Envoy，启动失败或取消只清理本次尝试，其他项目继续运行。

真实 Debian 12、Ubuntu 24.04 客户机与官方 Envoy 1.39.1 均完成三个并行代理、相同端口下各自的应用流量、目录及环境、Windows DPAPI 密钥加载、宿主 SSH 桥接、控制服务重载、暂停、配置变动拒绝、旧会话和脱离会话代理清理、取消、额外路由拒绝与客户机重启后手动恢复。Alpine 3.23 加 gcompat 缺少该二进制的两个 glibc 符号；已验证生产入口拒绝并不留下代理，尚未验证其真实代理流量。首轮 SSH 断开定位为联测脚本在命令中嵌入 NUL，已修正该脚本；没有据此修改 SSH 协议处理。复现入口与运行条件见 [项目 Envoy 边车](service-mesh.md)。

完整 Node 回归 725 项，724 通过、1 项 Linux 宿主测试跳过；能力中心操作参数浏览器场景、32 个插件契约与 9 个插件包、2,983 条语言文本与 71 个动态片段、类型检查、生产构建、54 个服务端模块的分发检查与 6 种编译版服务组合均通过。第 2 版运行包 213 个文件摘要校验通过。首次全量测试发现既有工程回归桩缺少新增实例操作保护接口，已补齐；随后一次对象备份测试进程提前退出且没有具体断言诊断，单独复测和最终全集均通过。编译版联测首次发生 Windows 原生异常退出（`0xc0000409`），独立复测全部通过，尚未确定该原生退出的根因。

该批完成时，项目网络隔离、宿主失联接管与普通应用进程的剪贴板策略仍保留部分实现状态；容器路径的后续实现见本记录开头。独立 SSH 与自行启动进程、真实外部 HA 演练及系统级剪贴板策略仍未完成。

## HA 见证发布与真实客户机联测

2026-09-30 修复独立见证程序未被运行包清单覆盖、更新暂存未复制见证目录的问题。第 2 版清单校验见证入口及全部文件；`ha:witness` 的初始化、只读预检和运行均从活动版本启动，保留参数与调用目录，回滚后随同切换。完整性不符时拒绝运行，未覆盖见证的旧版清单也不能通过新见证入口运行。更新器保留历史第 1 版运行包的校验、暂存、启用和回滚支持；旧更新工具的升级边界见 [自更新说明](self-update.md)。

目标实例包与故障副本接收器抽出供生产服务和联测共用，保留完整来源、复制任务、快照、磁盘摘要及退役记录核对。HA 后台操作不依赖网页会话解锁，仍受实例应急锁、维护状态和插件可用性限制。单元回归覆盖这些检查、重复启动幂等、普通迁移入口拒绝快照备用实例，以及见证文件篡改、缺失、新增文件与启动版本切换。

联测命令 `npm run test:ha-failover -- alpine|debian|ubuntu` 使用独立数据目录、真实来源及备用 Linux 虚拟机、编译后的见证进程和客户机 HTTP 应用。它实际复制历史快照，启用并锁定生产会话锁组件，再验证错误 BMC UUID 拒绝、来源停止后目标启动、应用和流量拒绝期间保持封锁、见证重启、实际应用请求转发、运行目标拒绝回切、停机退役后禁止重新接管及来源恢复。BMC 适配器实际停止的是测试 QEMU，流量适配器仅用于联测，所有进程仍在同一测试电脑；这不代替真实第三节点、物理宿主隔离及生产流量演练，HA 仍列为部分实现，见 [故障接管说明](ha-failover-check.md)。

三种发行版均通过上述真实客户机联测。完整 Node 回归 720 项，719 通过、1 项 Linux 宿主测试跳过；HA 配置浏览器场景、32 个插件契约与 9 个插件包、语言包同步、类型检查、生产构建、分发检查和 6 种编译版服务组合通过。第 2 版运行包 213 个文件摘要校验及包内编译见证程序的初始化通过，验证了含空格的相对配置路径。联测初版的两处断言错误匹配了被上游隐藏的原始错误文本，已改为核对拒绝状态及实际实例记录；首轮另有 Windows 进程异常退出，未据后续断言问题认定该原生退出的根因。自动审批拒绝清理首轮异常所留临时目录（仅返回“blocked by policy”），该目录保留；成功联测的临时实例均已关闭并移除。

## KDE 桌面项目绑定

普通 KDE 桌面现在与网页终端和独立应用窗口一样，使用启动时选定项目的目录、环境和网络模式。每个实例仍有一个 KDE 会话；切换绑定前必须停止旧桌面。启动程序先进入项目网络命名空间，再降为桌面用户执行，不创建共享网络中的 PAM 用户会话。联网安装依赖与持久桌面服务分开执行，取消安装会清理安装进程组，停止桌面会关闭图形连接并清理包括脱离会话程序在内的桌面用户进程。

绑定持久保存在实例目录，连接时核对启动文件摘要、项目配置和所有桌面用户进程的实际网络空间。新版本取消客户机自行启动桌面的规则，由 Sakura 每次开机核对绑定后恢复；停机期间改变项目目录或网络模式会关闭旧自动恢复。控制服务重新加载保留仍有效的桌面，实例包导出、导入和克隆保留绑定。旧版本桌面需要执行安装或启动升级，才能采用新的恢复规则。

真实 Alpine、Debian、Ubuntu 虚拟机均完成首次安装、Chromium 中操作 Konsole、私有网络与保留环境变量检查、只读及管理员连接、界面停止及后台程序清理、双屏、实例重启、控制服务重新加载、停机配置变更和项目重新绑定验证。重复执行入口是 `npm run test:project-desktop -- alpine|debian|ubuntu`，操作范围见 [Linux 桌面](linux-desktop.md) 与 [项目网络隔离](project-network-isolation.md)。

完整 Node 回归共 708 项，707 通过、1 项 Linux 宿主测试跳过；桌面相关 3 个浏览器场景、32 个插件契约与 9 个插件包、语言包同步、类型检查和生产构建、分发检查、6 种编译版插件组合均通过，运行包 203 个文件的摘要校验通过。首次完整回归有一个既有桥接测试进程提前退出、没有具体断言诊断；该文件及实例生命周期单独复测 8 项通过，随后详细报告的全集重跑通过，未据此认定最初退出的根因。

项目网络隔离、故障自动接管和按应用剪贴板策略仍保留部分实现状态。独立 SSH、显式实例管理与自行启动进程、外部 HA 故障演练，以及普通 Windows/Linux 进程的系统级剪贴板策略尚未完成；KDE 桌面用户的家目录和桌面配置仍在同一实例内共享。

## 在线迁移传输验证

独立 QEMU 传输模块在匹配的暂停目标进程与来源进程之间，通过 NBD `blockdev-mirror` 追平磁盘、预复制 RAM、在切换前暂停来源并再次追平最后写入；取消镜像后调用持久栅栏回调，成功才继续迁移。真实 Windows QEMU 11.1 与 WSL Linux QEMU 10.2 的临时合成磁盘测试均确认目标恢复、来源停住以及目标盘逻辑内容一致。预复制中断会恢复来源，栅栏失败保持两端停住，目标盘容量不匹配会在传输前拒绝。配对主机通道将 QEMU 的 NBD 和内存流经证书指纹锁定 TLS 传输，短期会话受导入与启动权限约束，目标 QMP 仅允许迁移所需命令和本机会话端口。目标延迟接收模式在收到状态前禁止手动恢复，收到并运行后才探测客户机。来源任务串联目标准备、加密转发、持久栅栏、目标就绪及来源停机；切换前确认来源仍运行时可撤销暂停目标。Sakura 项目目录、配置及组织标签随目标一起创建，含宿主私密配置引用的项目会被拒绝。两套独立 Sakura 服务与数据目录的 Windows 实测验证了真实 Alpine 客户机的内存标记、项目配置、目标 SSH、两端持久记录和来源停机；QMP 连接拒绝的短暂竞态已加入有限重试。同平台 TCG/BIOS 实例在线迁移现列为可用，其他硬件与故障环境限制见 [在线迁移检查与执行](live-migration-plan.md)。

## 可选 WSL Linux 后端

Windows 项目目录现在提供 `npm run check:wsl` 和 `npm run start:wsl`：前者检查 Linux Node.js、QEMU、swtpm、virtiofsd、带预登记密钥的 OVMF 及构建产物；后者把服务与 QEMU 放在默认 WSL 发行版内，数据单独保存在 Linux 文件系统，使已经实现的 TPM/安全启动与 Virtio-FS 路径可从 Windows 浏览器使用。因此这两项在支持后端上列为可用。2026-09-29 在本机验证 WSL 依赖探测、Windows 本机 HTTP 访问、通过 Windows CLI 创建并启动真实 Alpine 客户机、执行 `uname -a`、停止实例和 Ctrl+C 关闭服务。TPM 与 Virtio-FS 的真实客户机验证记录仍见各自文档；此入口不改变随附 Windows QEMU 的缺失后端。使用说明见 [WSL 后端](wsl-backend.md)。

## 音视频设备与宿主媒体转发

系统设置的“音视频设备”可为停止的 x86_64 实例复核并配置 QEMU HDA 双向声卡。可选择 Windows DirectSound 宿主输出和麦克风，或仅保留无宿主音频的虚拟声卡；页面使用实际 QEMU 启动探测后端，保存的硬件配置在下次启动生效。真实 Alpine 启动测试确认 HDA PCI 设备枚举，当前 Windows 宿主的 DirectSound 后端可启动。页面还可查看运行中实例的客户机 ALSA 声卡和 `/dev/video*` 设备证据。

USB 摄像头、麦克风和耳机可按宿主可见设备的四位十六进制 VID:PID 保存分类规则，复用受管 USB 热插拔在实例启动时连接，或在运行中手动连接、移除。设备类型由用户选择，Sakura 不会凭 VID:PID 证明设备真的是摄像头或麦克风；能否在客户机使用取决于实际 USB 设备、Windows 驱动占用和 Linux 驱动。noVNC 网页本身仍没有独立的音视频流，宿主音频走 QEMU，摄像头/USB 麦克风走 USB 转发。`npm run test:media-devices` 验证音频后端和真实客户机 HDA 枚举；USB 热插拔另有真实设备冒烟测试。

## 分布式构建农场

系统设置的“构建农场”可登记最多 32 个普通 Linux 实例作为构建节点，选择绑定项目，设置标签、启停和每节点 1–4 个并发槽位。未指定项目的 API 请求及旧版节点首次升级绑定实例已保存的活动项目；此后切换活动项目和服务重载不会改动节点绑定。提交时指定构建名称、客户机命令、所需标签和 5–1800 秒超时；工作目录留空使用项目目录，也可指定项目内 `/workspace` 下的子目录。调度器持久保存最多 256 条任务，在标签匹配、节点运行且有空闲槽位时将任务送到客户机执行；停止的节点保留排队任务。命令输出和退出码写入任务记录，可取消排队或运行中的任务，并将失败、取消和重启中断的任务重新排队。重启不会自动重复运行可能有副作用的中断命令。

2026-09-30 补齐构建农场的项目网络：每个构建在绑定项目的目录、环境和网络空间中运行，逐块日志、结果和错误遮盖解析后的密钥。运行期间阻止修改项目目录或网络模式及更换节点项目；超时或取消清理独立进程组，同节点多个槽位仍可并发执行。调度记录与任务结果保存实际项目、目录及网络模式。已删除的项目和未启用的密钥插件均使任务失败，后者同时修正了项目与托管服务密钥引用检查误用数组长度的问题。

各节点自行持有项目文件和编译依赖；构建农场不会自动同步源码，也不会把任务视为容器或文件系统隔离执行。`npm run test:build-farm -- alpine|debian|ubuntu` 在三种真实客户机验证目录、环境、私有命名空间、密钥遮盖、重载与活动项目变化、子目录及越界目录拒绝、同节点两槽并发和分别取消后的后台程序清理。单元测试另覆盖节点绑定持久化、缺失项目拒绝、分块日志遮盖、运行配置保护和旧版记录升级；使用边界见 [项目网络隔离](project-network-isolation.md)。

此批完整 Node 回归共 713 项，712 通过、1 项 Linux 宿主测试跳过；构建农场和桌面相关 4 个浏览器场景、32 个插件契约与 9 个插件包、语言包同步、类型检查和生产构建、分发检查、6 种编译版插件组合及运行包 203 个文件摘要校验均通过。未将三个仍缺完整范围或真实外部演练的目录条目改为完成。

## GPU/vGPU 档案

系统设置的“GPU/vGPU 档案”可保存最多 32 个 Virtio GPU 2D 或 VirGL 3D 配置，指定输出数量、默认宽高、宿主显存上限和实例最低内存。页面会用实际 QEMU 进程探测两种后端是否能启动；选择停止的 x86_64 实例后，可预览现有与目标硬件配置、QEMU 显卡设备参数及不兼容原因。应用时重新核对档案修订、实例状态和硬件配置，保存到实例的启动配置，下次启动生效。系统记录应用的档案修订，若后续通过其他入口修改硬件则显示漂移；删除档案不会改动已应用的实例。

这是虚拟显卡配置档案，不是物理 GPU 分区或设备直通。宿主后端成功启动不保证客户机已安装 Virtio GPU/Mesa 驱动，也不保证某个图形应用使用 3D 加速；客户机渲染器可在“GPU 与 3D 加速”中继续验证。`npm run test:gpu-profiles` 使用真实 QEMU 探测 2D/3D 后端，并启动 Alpine 客户机确认所配 Virtio GPU PCI 设备可见。

## 语言与区域包

系统设置新增“语言与区域”，支持简体中文与繁体中文（臺灣）界面文本、IANA 时区及中文/美式/德式数字格式。设置保存在当前浏览器，保存后重新加载；显示用的时间和数值采用所选格式，API 与持久数据不改写。编辑器、终端输出、实例名称和文件面板中的文件名不参与文字转换。繁体 UI 文本与动态提示片段由源码中的简体文案生成，并在构建检查中验证文本包同步。浏览器场景验证了语言切换、时区跨日展示、德式数值格式及实例名称保留。更新文案后运行 `npm run locales:build`。

## Python DAP 调试器

启用“代码与调试工具”插件后，在文件面板打开当前项目中的已保存 Python 文件，可在客户机内按需安装固定版本 debugpy 1.8.16 并启动 DAP stdio 调试会话。输入行号设置断点，也可在运行中更新；支持进入时暂停、继续、暂停、单步越过/进入/跳出、调用栈选帧、变量展开和程序输出。停止调试会终止被调试程序；切换到其他项目后需返回原项目或停止旧会话。每个实例最多一个会话，同时最多四个实例调试。

`npm run test:debug-adapter` 在真实 Alpine 和 Debian 客户机验证断点、单步、调用栈、变量及输出；协议单测覆盖分帧、事件缓冲、错误响应、过大消息和并发启动，浏览器场景验证编辑器控制流程。

## LSP 语言服务

启用“代码与调试工具”插件后，在文件面板打开当前项目目录内的 TypeScript、JavaScript 或 Python 文件，可按需在客户机中安装语言服务器。编辑器使用客户机内的 LSP stdio 进程提供补全、定义跳转和语言诊断；当前未保存的文本会作为 LSP 文档发送，不会为查询写入磁盘。安装固定使用 TypeScript 5.9.3、TypeScript Language Server 4.3.4 和 Pyright 1.1.414，以兼容发行版提供的 Node.js。诊断通过“语言诊断”手动刷新。

重命名要求先保存当前文件。Sakura 会预览语言服务器返回的多个文件修改，限制在当前项目内，并验证编辑范围与文件大小；应用前逐个核对版本及文件锁，写入失败时回滚已写文件并报告无法回滚的路径。其他进程在预览后修改了目标文件会使应用失败。预览最多保留五分钟。真实 Alpine 和 Debian 客户机的 `npm run test:language-services` 验证了 TypeScript 补全、跳转、诊断、跨文件重命名及 Python 诊断；协议单测验证了越界拒绝、版本冲突与文件锁，浏览器场景验证了预览和应用。

## 远程不可变审计锚点

本地审计链头可写入启用 S3 Object Lock 的远端桶；上传后按对象版本读回，核验内容、COMPLIANCE 模式和保留日期。同步失败不伪装为成功，重启继续验证既有锚点，保留期将届满时会续锚。账户管理员可以配置、同步、核验和停用自动锚定。单元测试和本机 S3 协议假服务验证了上传头、版本校验、篡改拒绝与续期；操作条件和边界见 [远程审计](remote-audit.md)。

## 签名项目策略包

管理员现在可导出包含完整角色、成员授权和审批要求的 Ed25519 策略包；导入时先验签并预览目标项目的完整策略差异，再信任签名者并应用。应用会重新检查签名、公钥信任和单调修订号，拒绝篡改、撤销信任或目标策略变化。签名密钥重启后保留，跨主机成员 ID 仍须在目标主机有效。编译版服务和浏览器测试验证了外部签名者、篡改拒绝、版本冲突、撤销与持久化。接口及边界见 [签名项目策略包](access-control.md#签名项目策略包)。

## 项目权限与自定义 RBAC

账户模式新增默认无权限的项目成员。管理员可按实例、项目定义角色及 `read`、`write`、`execute` 权限，并将成员分配到角色。成员只能对明确指定的项目调用项目配置、运行状态、项目文件搜索、Git 和服务健康接口；服务端按实时授权检查，拒绝未授权实例、其他项目和全局接口。独立成员页面可读写配置并提交项目任务，管理员设置页可创建/删除成员、编辑角色和授权。真实编译版服务与浏览器测试验证了默认拒绝、跨范围拒绝、角色变更、撤销、会话失效和重启持久化。使用边界和 API 见 [多用户与项目成员](access-control.md)。

## 项目配置双人审批

项目权限现在可启用配置变更审批，并为成员角色授予 `approve` 权限。开启后管理员和成员的直接配置写入都被服务端拒绝；申请人提交完整配置、摘要与当前 SHA-256 版本，另一账户审阅并批准后由申请人一次性应用。申请人不能自批，过期、越权、审批账户失效、重放或保存前版本变化都会阻止应用。审批记录保留状态与执行结果，真实编译版服务及浏览器验证了成员→管理员和管理员→成员两种审批方向。范围及管理员覆盖能力见 [多用户与项目成员](access-control.md)。

在 `c669881` 基础上持续完成原未完成目录记录，并完成文件、Git 和目录同步的冲突编辑。已完成部分按批提交；Windows 集成为 `f90a0a3`，网页应用剪贴板策略为 `1b4674a`，桌面录制为 `d626ae0`，黄金镜像库为 `3aef7b6`，临时 COW 工作区为 `08a7e03`，只读救援为 `f315dad`。近期接通了备份文件级恢复、云镜像导入、UEFI 固件、快照差异、本机 HTTP/HTTPS 入口、主机入口证书轮换、客户机网络仿真、嵌套虚拟化检测、私有 DNS、文件锁、事件自动化规则、插件功能灰度、跨主机配对、资源评分、客户机火焰图、eBPF 内核性能分析、跨主机冷迁移、主机维护排空、Windows 系统域名解析、跨主机快照复制、Jupyter/Marimo 环境、认证浏览器 IDE、本机存储池管理、SSD/HDD 分层、灾备演练、mTLS 服务入口、自定义同步合并驱动、脱敏数据包捕获、临时反向隧道、出站目标白名单、网络配额、NAT 回流验证、一致性在线快照、自动修复 Runbook、离线软件包缓存、镜像软件包安全扫描、项目磁盘配额、客户机用户配额、S3/MinIO 对象备份、WireGuard 覆盖网络、npm 依赖升级、团队模板、多用户只读分享与共享桌面视图。未完成功能逐条清单见 [未完成功能](unfinished-features.md)。不以保存配置、返回本机信息或工具探测代替实际执行。

## Dev Container 开发环境

在运行中的 Debian 或 Ubuntu 实例中，先于容器工作台安装 Docker。项目包含 `.devcontainer/devcontainer.json` 或 `.devcontainer.json` 时，可安装固定版本的 Dev Container CLI，然后使用其 `up --workspace-folder` 启动配置声明的镜像、Dockerfile 构建或 Compose 服务。该路径将配置解释交给 [Dev Container 官方 CLI](https://github.com/devcontainers/cli)，遵循配置文件的工作目录与挂载设置。若项目仅包含 Dockerfile，可直接构建镜像并创建常驻容器；Sakura 将当前项目目录绑定到容器的 `/workspace`，容器列入同一工作台，可查看日志、停止、重启和删除。再次执行 Dockerfile 模式会启动已有容器；更新镜像需先删除旧容器。

Dockerfile 路径必须位于当前项目目录，符号链接解析后也不能越界。若项目目录变更，旧容器会拒绝以新目录名义重启，需先删除再构建。CLI 和镜像构建可能需要访问 npm 或镜像仓库；构建步骤来自用户当前项目，应按该项目的 Dockerfile 和配置执行。Dockerfile 模式不自动解释 devcontainer.json 中的 Features、生命周期命令或 Compose 定义，此类配置请使用 CLI 模式。

容器工作台还提供官方模板目录，包含 Debian、Node.js、Python、Go 和 Rust。先在空项目目录选模板并“校验模板来源”；服务从官方 GHCR 命名空间读取 OCI 元数据，检查模板 ID、发布者、文档路径、版本及文件路径，再让用户选择镜像版本和是否包含可选文件。应用时按刚查看的版本再次取元数据、校验选项，用 [Dev Container CLI 的模板命令](https://github.com/devcontainers/cli/blob/v0.82.0/docs/templates/apply.md)先写入同级暂存目录，确认生成配置后原子替换仍为空的项目目录；下载失败或目录被修改时不覆盖原目录。成功后可按上面的配置入口启动。来源匹配说明当前 OCI 命名空间和元数据一致，不代表模板有独立代码签名或镜像内容审计；用户仍需检查模板产生的 Dockerfile、脚本及后续拉取的镜像。

## 浏览器扩展

随源码及运行包提供可安装的 Chromium Manifest V3 扩展。管理员通过五分钟一次性配对码授权扩展读取本机实例摘要；凭证绑定连接、三十天到期，可从设置中撤销，更换管理员密码时全部失效。真实 Chromium 扩展和编译版服务验证了配对、读取、越权拒绝与撤销。安装和使用见 [浏览器扩展](browser-extension.md)。

## 移动伴侣

手机浏览器现在可通过独立 HTTPS 同伴入口与一次性短码配对，按设备范围只读查看实例状态和选定类型的告警。管理员可更改或暂停设备策略并撤销连接；控制面锁定、设备过期和密码轮换会使访问失效。手机收到的是告警类型和时间，不含消息正文、任务日志或私密配置名称。真实 HTTPS 与手机宽度浏览器验证了配对、过滤和撤销；安装与边界见 [移动伴侣](mobile-companion.md)。

## Windows 托盘伴侣

提供可运行的 Windows 系统托盘进程，读取本机 Sakura 状态、打开控制台，并在服务未运行时后台启动；用户可独立设置托盘随登录启动和托盘启动时启动 Sakura。真实 Windows 测试验证了后台启动、状态读取、重复启动阻止及 Windows Forms 控件创建。使用与退出行为见 [Windows 托盘伴侣](tray-companion.md)。

## Windows Hello 解锁

管理员可在 localhost 登记本机平台通行密钥，用 Windows Hello 等系统认证器完成用户验证，直接解锁已锁定的控制面并取得新管理员会话。独立的短时挑战阻止普通登录挑战、只读账户和旧锁定代次用于解锁。真实 Chromium 虚拟平台认证器与编译版服务验证了登记、解锁、重放拒绝和密码备用入口；实际设备使用见 [Windows Hello 解锁](hello-unlock.md)。

## Passkey/WebAuthn

本机账户可验证密码后登记、列出和撤销通行密钥，并通过浏览器认证器完成免密登录。服务验证来源、RP ID、用户验证、一次性挑战与凭证计数器；只保存公钥。编译版服务与 Chromium 虚拟认证器验证了登记、登录、挑战重放拒绝、错误密码拒绝和撤销会话。使用条件及范围见 [多用户与只读分享](access-control.md)。

## 会话交接

本机账户验证密码后可生成一次性短时交接码，另一个浏览器会话接收后原凭证和连接立即失效。新会话沿用账户范围及原到期时间；取消、过期、重复接收、原会话退出均会拒绝交接。单元测试和编译版服务的双浏览器流程已验证，操作见 [多用户与只读分享](access-control.md)。

## 共享终端

管理员可按实例、tmux 会话和只读账户授予限时查看，受邀账户可在浏览器中实时查看输出。独立 WebSocket 通道拒绝所有输入，撤销立即断开连接。真实 Alpine/QEMU 客户机验证了 tmux 只读附着、输出和输入阻断；编译版服务验证了账户权限、WebSocket 消息、授权撤销和浏览器视图。操作及依赖见 [多用户与只读分享](access-control.md)。

## 多用户与只读分享

可选账户模式取代公共管理员令牌，管理员按实例授权本地只读账户。真实编译版服务和浏览器验证了登录、接口与 WebSocket 拒绝、账户撤销和重启后会话失效。使用范围及仍需完成的权限功能见 [多用户与只读分享](access-control.md)。

## 共享桌面视图

授权只读账户可打开已选实例的桌面，服务端按实例范围校验 WebSocket，并按 RFB 消息类型阻止键盘、鼠标、剪贴板及调整桌面尺寸。桌面插件与客户机桌面均需就绪；协议过滤与真实编译版服务的通道权限验证已覆盖。参见 [多用户与只读分享](access-control.md)。

## 团队模板

能力中心可从当前实例和项目生成经过预览的资源/项目蓝图，版本化保存在本机，然后按模板指纹创建独立实例。创建失败会清理目标；模板不复制环境变量、密钥、命令或端口转发。真实虚拟机测试验证了模板创建和目标项目设置落盘，操作说明见 [团队模板](team-templates.md)。

## npm 依赖升级机器人

能力中心可对当前单项目 npm 锁文件查询稳定版本更新，生成按项目文件指纹绑定的单项升级计划。审阅目标和变更级别后，可生成新清单与锁文件，异常中断可恢复，成功升级也可按修订 ID 回退。真实 npm 演练验证了扫描、升级和回退；使用范围及限制见 [npm 依赖升级机器人](dependency-bot.md)。

## 项目磁盘配额

能力中心可为当前项目目录设置真实容量上限，并迁移已有文件；支持查看、扩容、清除及重启后自动挂载。挂载缺失时会拒绝项目启动和底层目录写入。真实 Alpine、Debian/QEMU 已验证全部操作与失败保护，使用要求见 [项目磁盘配额](project-quota.md)。

客户机用户配额可对该目录卷中的非 root UID 设置硬上限，并在 Alpine、Debian、Ubuntu 重启后保持执行。三种客户机均通过真实超额写入拒绝与清除后恢复写入测试，工具和内核依赖见 [客户机用户与目录配额](guest-quota.md)。

## 镜像与软件包安全扫描

工作空间安全扫描现按客户机发行版和已安装源包版本查询 OSV 漏洞库，展示受影响软件包、编号和覆盖状态；同时保留 SSH、更新及系统文件检查。真实 Alpine、Debian、Ubuntu/QEMU 客户机及批量查询分页测试均已验证，详见 [安全扫描](security-scan.md)。

## 离线软件包缓存

工作空间的软件包面板可对 Alpine APK 及 Debian/Ubuntu APT 软件包预取、查看、离线安装和定向清理。开发任务还可预取 npm 锁文件依赖及 Python 固定版本 wheel，再以禁用联网的模式安装。缓存绑定依赖文件并校验 SHA-256；真实 Alpine 和 Debian/QEMU 客户机均验证了系统包路径，Alpine/QEMU 也验证了 npm、pip 项目依赖，详见 [离线软件包缓存](package-cache.md)。

## 自动修复 Runbook

事件规则现可选择有界的 Runbook 步骤，新建和编辑仅保存为预览；用户检查完整命令和最近匹配事件后，以绑定规则版本及内容的审批令牌启用执行。沿用持久去重、冷却、每日上限及任务记录；真实 Alpine/QEMU 验证了按序执行、首次失败即停和去重。细节见 [自动修复 Runbook](auto-remediation.md)。

## 一致性在线快照

运行中实例可借助客户机代理冻结文件系统，并由 QEMU 创建 QCOW2 内部快照；成功或失败都会尝试解冻。真实 Alpine/QEMU 测试验证了创建后继续写入及停止恢复后重启读取旧内容，单元测试覆盖 QEMU 失败时解冻与清理。使用方式和范围见 [一致性在线快照](online-snapshots.md)。

## RAM 与进程状态快照

快照页可在 TCG 运行中的实例保存 QCOW2 磁盘、RAM 和设备状态，再向同一实例加载；恢复前核对 QEMU、加速器、虚拟硬件、CPU/内存拓扑与控制身份。真实 Alpine/QEMU 测试确认文件和运行中进程在即时恢复及重启后恢复时都回到保存状态。WHPX、UEFI、加密磁盘及临时写时复制磁盘会在操作前拒绝；跨主机复制、克隆和导出仍仅带磁盘。详见 [RAM 与进程状态快照](memory-snapshots.md)。

## NAT 回流验证

客户机可经 QEMU 宿主网关地址 `10.0.2.2` 和现有 TCP 转发端口回连自身服务。能力中心提供端口选择和实际连通验证；真实 Alpine/QEMU 测试读取了回流路径上的 SSH banner，并验证在线撤销与重加。范围与使用方式见 [NAT 回流验证](nat-hairpin.md)。

## 出站白名单与带宽配额

扩展能力现可在运行中的客户机设置 IPv4 出站目标白名单，同时拒绝新建 IPv6 出站连接。规则更新采用新链接入后移除旧链；已建立连接与 DHCP 保持可用。真实 Alpine/QEMU 验证了允许、拒绝、在线替换、清除及普通联网恢复。使用与边界见 [出站白名单](egress-policy.md)。

网络配额还支持以 `tc` TBF 限制客户机出站带宽，并使用 IPv4/IPv6 防火墙规则限制并发 TCP 连接及新建连接速率。真实 Alpine/QEMU 验证了带宽计数和超额 TCP 连接拒绝；具体参数和边界见 [客户机网络配额](network-quota.md)。

## 临时反向隧道

运行中实例可按工作项目为客户机 TCP 服务打开 10–600 秒的宿主机本地入口，支持查看和手动关闭，到期、实例停止或暂停、应急锁定或服务关闭时撤销。私有项目入口连接其独立网络空间的回环端口，查询和关闭按项目分开，每次连接复核项目与网络绑定；入口存续期间保护项目目录和网络模式。中继支持二进制数据、TCP 半关闭与空闲连接，准备和桥接不导出项目环境或密钥。真实 QEMU 客户机验证同端口多项目分离、任务上下文、配置保护、额外路由拒绝、撤销及完整响应；步骤与使用边界见 [临时反向隧道](reverse-tunnel.md)。

## 脱敏数据包捕获

能力中心在运行中的客户机内调用 `tcpdump`，按网卡、协议及端口过滤，并受 20 秒、200 包上限约束。仅导出协议分布、秒级计数和一次性匿名流标识，不返回地址或载荷。真实 Alpine/QEMU 客户机已完成带流量的抓包验证。操作、依赖与边界见 [脱敏数据包捕获](packet-capture.md)。

## 自定义同步合并驱动

按路径顺序选择手动处理、另存两份、Windows/Linux 优先或三方文本合并。同步预览显示命中的驱动，单文件决策可覆盖规则；后台同步使用同一执行链路。二进制文件可另存两份或选择一端；文本自动合并仅在共同版本可校验、修改不重叠时提交，其他情形保留两端。规则变化会使旧预览失效。单元测试、浏览器界面测试与真实 Alpine/QEMU 同步验证了实际执行。细节见 [目录同步合并驱动](sync-merge-drivers.md)。

## mTLS 服务策略

HTTPS 入口可按路径要求指定客户端证书，通过 TLS 握手校验和叶证书指纹限制访问；HTTP 请求与 WebSocket 升级共用策略。可预登记替换证书和切换时间，支持单张自签名证书或直接签发的 CA 证书；服务器证书轮换时客户端信任设置保持生效。单元测试使用真实 TLS 客户端、签发 CA、WebSocket、切换前后请求及重启恢复，界面测试验证配置入口。操作和限制见 [本机 HTTP/HTTPS 服务入口](http-ingress.md)。

## 灾备演练

针对已有备份，实际校验、临时恢复、启动客户机并检查路径或文件 SHA-256；完成后删除临时实例，持久记录耗时、结果与清理状态。真实 Alpine/QEMU 客户机完成了从备份恢复到再次启动、核验文件及清理的闭环，细节见 [灾备演练](disaster-recovery-drill.md)。

## SSD/HDD 分层

管理员指定已注册池的热/冷角色；服务按持久记录的实例最后使用时间预览建议，手动或定时迁移停机实例。迁移复用存储池的文件校验和故障清理记录，运行中与临时实例跳过。单元测试及真实 Alpine/QEMU 客户机迁移后再启动均已验证，细节见 [SSD/HDD 分层](storage-tiering.md)。

## 本机存储池管理

可持久注册独立本机目录、查看容量与实例占用，在新建实例时选择池，并对已停机实例做经 SHA-256 校验的双向迁移。迁移切换与遗留副本清理有持久记录；删除池前要求实例与未登记文件清空。单元测试和真实 Alpine/QEMU 三次启动验证了迁移后的磁盘内容。使用与恢复边界见 [本机存储池](storage-pools.md)。

## 认证浏览器 IDE

能力中心可在 Debian/Ubuntu 客户机安装已校验摘要的 code-server，针对当前项目启动带随机密码且限时的浏览器 IDE。访问密码经单独的本机接口取得；到期自动停止会话并清理自建端口转发。真实 Debian/QEMU 验证了安装、错误密码拒绝、正确密码登录和到期清理。使用方式与限制见 [认证浏览器 IDE](browser-ide.md)。

## Jupyter/Marimo 环境

能力中心为每个项目安装独立的 JupyterLab 或 Marimo Python 环境，使用随机令牌启动客户机 Notebook，并通过仅监听本机回环地址的动态端口映射打开。支持安装、启动、状态检查、停止和重启后会话复核；真实 Alpine/QEMU 客户机验证了两种提供者及认证访问。操作与限制见 [Notebook 环境](notebook-environments.md)。

## 跨主机快照复制

选定的历史快照通过证书固定的主机连接复制为目标上的独立实例。来源端导出历史磁盘和身份，目标导入时校验 SHA-256 并保存快照来源；持久队列支持重启复核与同标识重试，校验值不符时保持待复核。使用步骤及边界见 [跨主机快照复制](snapshot-replications.md)。

## Windows 系统域名解析

本机 HTTP/HTTPS 服务入口可在明确启用后，把实际创建的 `.sakura.localhost` 别名同步到 Windows hosts 文件，供系统解析器和命令行客户端使用。只管理 Sakura 标记区块，检测外部冲突和异常编码；权限不足时保留待同步状态并允许重试。操作与限制见 [Windows 系统域名解析](local-aliases.md)。

## 主机维护排空

能力中心的“主机维护排空”在检查全部当前实例停止状态和目标可用性后，复用跨主机冷迁移持久队列逐台复制。批量移除前要求每台都已有匹配的目标副本及有效回执；执行时逐台重新核对，失败保留后续源实例。支持失败重试和按实例指定不冲突的目标名称。步骤及边界见 [主机维护排空](maintenance-drain.md)。

## 跨主机冷迁移

已配对且单独授权的目标主机可通过固定证书的 TLS 通道接收流式实例包。目标的导入校验与来源的持久迁移队列共同处理网络重试和回执丢失；仅在明确确认且源实例未变化时删除源实例。可选的目标启动另需独立授权与已校验回执，且只在源实例删除后发送。操作步骤及边界见 [跨主机冷迁移](cold-migration.md)。

## eBPF 内核性能分析

能力中心的“eBPF 性能分析”在运行中的客户机使用 `bpftrace` 实际采样内核调用栈并统计热点函数，提供完整报告下载；工具、内核或权限不足时报告失败，详见 [eBPF 内核性能分析](ebpf-profiler.md)。

## 客户机性能火焰图

能力中心的“火焰图生成”通过运行中客户机的 `perf` 真正采样调用栈，生成可下载的 SVG，并限制采样时长、输出大小和图形节点数。缺少工具、权限或调用栈时显示失败，具体要求见 [客户机性能火焰图](flamegraph.md)。

## 主机配对与跨主机状态

新增独立 TLS 同伴入口，默认关闭且只允许明确配置的监听地址与端口。一次性短码配合对端证书指纹完成真实网络配对，长随机凭证仅能读取固定的资源状态，双方均可移除或撤销。系统设置汇总本机和最多 16 台已配对主机的 CPU、内存、实例数量、最近检查时间与连接错误；重启保留配对，按周期刷新。资源评分调度会重新读取主机状态，排除失联、过期或资源不足的目标，再按内存、负载与实例密度排序；能力中心可按当前实例配置执行同一评分，不会自动迁移。接口纳入 OpenAPI/SDK，详见 [主机配对与多主机状态](host-peers.md)。

## 插件功能灰度

插件中心已选择的插件在服务启动时额外经过版本化的稳定主机分桶。系统设置支持预览、保存和删除启用状态及 0–100% 放行比例；未命中的插件不启动，依赖它的插件也不会绕过依赖校验。策略与主机分桶标识持久保存，修订号防止旧页面覆盖新策略；插件中心显示跳过原因，OpenAPI/SDK 提供对应接口。变更在下一次服务启动生效，详见 [插件功能灰度](feature-rollouts.md)。

## 集群策略发布

在目标主机完成单向配对，并在“主机配对与多主机状态”中为对应入站主机开启“允许策略发布”后，来源主机可在“系统设置 → 集群策略发布”选择插件、灰度比例、分桶版本和最多 16 台目标。保存批次时逐台读取当前策略修订，形成可复核的待发布记录；发布时再次核对目标身份及修订，逐台保存插件灰度策略。每台结果独立持久化，失败目标可重试；目标版本被其他操作更改时须重新建立批次。策略在目标主机下次启动 Sakura 时生效，已发布目标不会因其他目标失败而回滚。接口和限制见 [集群策略发布](fleet-policy-rollout.md)。

## USB 热插拔

x86_64 实例启动时创建 QEMU xHCI 控制器。能力中心的“USB 热插拔”面板列出 QEMU 可见的宿主设备，可按四位十六进制厂商/产品 ID 保存持久转发规则或临时连接；运行中通过 QMP 动态添加、请求移除设备。持久规则在实例再次运行时重新应用，手动转发在停止后清除，最近结果与失败原因持久保存。实际物理设备能否接入取决于宿主驱动和 QEMU 可访问权限；面板区分“已配置转发”和客户机实际识别。接口和测试见 [USB 热插拔](usb-hotplug.md)。

## 事件自动化 DSL

系统设置可保存按任务完成与告警事件触发的声明式规则，按实例、项目、标签、状态和告警类型筛选。新规则默认停用且仅预览；明确启用实际执行后可启动、正常停止、暂停或恢复事件所属实例。执行前持久登记事件与规则版本以去重，限制冷却时间和每日操作次数，记录预览、跳过、成功或失败。重启不重放结果不明的待完成动作。设置页支持编辑版本校验、最近事件预览和执行记录，接口纳入 OpenAPI/SDK。细节见 [事件自动化规则](automation-rules.md)。

## Git 非文本冲突选择

Git 工作台对未解决文件提供“选择版本”，可按当前或传入分支的索引阶段处理二进制、删除、符号链接和子模块冲突。选择前后核对冲突索引与工作区内容；文件变化会要求重新打开。普通文件与符号链接按所选阶段写回工作区并准确暂存，删除冲突可以采用缺失的一侧。子模块选择只暂存所选 gitlink 提交，保留现有工作目录供人工检查；删除子模块时也不递归删除其目录。文本冲突仍可逐处使用三方编辑器。

## 目录同步手动三方合并

启用“保存共同文本版本”并完成首次同步后，双向预览中的文本冲突可以打开手动三方合并，查看共同版本、Windows 内容和 Linux 内容，逐处编辑后提交审阅结果。服务端按预览令牌和两端文件哈希重新核对，冲突期间任一文件或配置变化会要求重新预览。一次最多提交 8 个文件、合计 1 MiB 的 UTF-8 文本；提交沿用原有元数据保留与可选回滚记录。两端无法组成单个文件系统事务，第二端失败时需重新预览并处理。

## 文件锁

文件工作台的文本编辑器可以按文件路径获取两分钟租约，编辑期间每 45 秒续租，关闭编辑器或离开页面时释放。租约由随机令牌保护；Sakura 的文本保存、覆盖上传、历史恢复、重命名和删除等文件 API 会在写入期间串行核对锁，其他编辑器收到冲突而不能覆盖。租约到期后旧令牌不可写，服务重启会清空临时租约；终端或客户机内其他程序的直接写入由现有文件版本校验发现。接口和限制见 [文件锁说明](file-locks.md)。

## 客户机 DNS 与 DNSSEC 诊断

“开发 → 网络配置”现可为 systemd-resolved 客户机预览、应用和恢复私有域名路由及 DNSSEC 策略。应用后核对名称服务器、路由域名与 DNSSEC 模式；若原来的 `/etc/resolv.conf` 绕过本地 stub，保存恢复计划后切换链接，恢复时改回原值。能力中心读取实际解析器来源、名称服务器、搜索域、路由域名和 DNSSEC 状态；未执行外部验证查询时将验证状态标记为 `not-verified`。真实 Debian/QEMU 客户机验证了域名解析、策略切换与恢复；Alpine/QEMU 验证了基础诊断。细节见 [客户机 DNS 说明](guest-dns.md)。

## 客户机网络仿真

能力中心的“延迟丢包模拟”现在可读取实际队列规则、预览参数，在指定网卡应用延迟/抖动/丢包并清除根 `netem` 规则。命令执行后会读取内核状态确认，客户机重启后需重新应用。参数、安全边界和真实 QEMU 验证见 [网络仿真说明](network-emulation.md)。

## 本机 HTTPS 与主机入口证书轮换

网络插件的服务页现在可以选择 HTTPS 监听、生成稳定的 `.sakura.localhost` 服务别名、下载本机公钥证书、配置自动轮换提前天数并立即轮换。证书私钥保存在本机数据目录，轮换会更新已有 HTTPS 监听器；使用该证书的新连接必须重新建立信任。HTTP/HTTPS 不能混用同一监听端口，域名路由按虚拟主机隔离。接口和边界见 [服务入口说明](http-ingress.md)。真实 QEMU 验证了客户机服务经 NAT、别名路由、可信证书校验和热轮换的访问链路；浏览器场景验证了协议选择、策略保存、轮换及 HTTP/HTTPS 别名导航。Windows 系统解析可在同页按需启用，系统 hosts 文件需要管理员权限；第三批“主机证书轮换”覆盖的是本机入口证书。

## 嵌套虚拟化检测

能力中心现在从运行中的客户机读取 CPU 虚拟化标志、`/dev/kvm`、内核和 QEMU 加速器，分别记录探测成功和嵌套 KVM 候选条件。结果跨服务重启保存；候选条件不等于二层虚拟机已能启动。实际 Alpine/QEMU 检测与边界见 [嵌套虚拟化说明](nested-virtualization.md)。

本批 445 项 Node 回归、52 个浏览器场景、生产构建、插件合约、分发检查及编译后服务检查通过；真实客户机探测确认本机配置没有嵌套 KVM 候选条件。

## 本机 HTTP 服务入口

网络插件的“服务与端口”页可将已声明的实例端口转发发布为本机 HTTP 路由。支持最长路径前缀、可选前缀移除、WebSocket 升级、上游健康检查和重启恢复；端口与 Sakura 控制服务及实例转发互斥。实例停止或转发消失时拒绝访问。接口纳入 OpenAPI/SDK，配置和边界见 [HTTP 入口说明](http-ingress.md)。

本批 444 项 Node 回归、52 个浏览器场景、插件契约、生产构建与分发检查通过；真实 `npm run test:http-ingress` 验证 Alpine 客户机 HTTP 服务经 QEMU NAT 和本机入口转发、健康检查及停机拒绝。

## 快照时间线与差异

快照页可以在实例停机后比较历史快照与当前状态，或比较两个历史快照。QEMU 先提取历史磁盘，再使用隔离的临时救援系统同时只读挂载两个状态；普通文件内容和符号链接目标形成新增、删除、修改清单，整盘逻辑内容另由 QEMU 比较。后台任务支持取消、进度、结果下载和任务记录；限制与接口见 [快照差异说明](snapshot-diff.md)。真实 QEMU 回归验证了文件新增、删除、修改与链接变化、整盘差异、源盘摘要不变及临时实例清理。

## 备份文件级恢复

备份页可选择备份、分区和指定文件，通过独立临时系统只读提取后下载。支持普通、加密、外部目录和内容块备份，保留当前实例及原备份；后台串行保护备份，核对整包和磁盘哈希，收集文件并保存独立结果报告。解密密码不进入任务记录，取消、应急锁定和关闭会清理临时系统与展开文件。文件边界、容量和保存方式见 [文件恢复说明](backup-file-recovery.md)。

真实 QEMU 回归分别从普通、内容块和加密备份提取旧文件，核对当前磁盘内容已不同但摘要始终不变，恢复文件内容正确，临时系统已清理。专项回归覆盖错误密码、损坏包、缺失备份、链接越界、文件超限、下载校验、备份删除并发、取消、应急锁定和关闭排空。

424 项 Node 回归、46 个浏览器场景、六种编译版插件组合、类型检查与构建、插件合约和分发检查通过。浏览器验证备份选择、错误密码反馈、密码即时清除、实际下载内容、刷新历史、取消以及长路径的手机布局。六种生产组合包含完整备份依赖，生成 SDK 验证新接口的路径、参数校验、插件禁用和不存在实例的拒绝行为。

## S3/MinIO 备份目标

能力中心可保存引用私密配置的 S3/MinIO 目标，把普通、加密或内容块备份手动或定期自动上传到对象存储，并列出、下载校验、恢复或删除。上传使用分片传输，发布远端清单前重新下载核对整包 SHA-256；恢复会再检查包内磁盘哈希并创建新实例。保留锁定期内的远端备份不能通过应用删除。操作方式与自动重试边界见 [对象备份说明](object-backup.md)。真实 Alpine/QEMU 专项回归验证了内容块与加密备份自动上传、删除本地副本后从对象存储恢复并启动。

## WireGuard 覆盖网络

能力中心可在客户机内生成并保存 WireGuard 私钥引用，配置对端、公钥、覆盖地址和路由，启动或停止隧道，并在实例重启后重新建立接口。默认路由不受覆盖网络接管；当前不配置宿主的入站 UDP 端口转发。配置与验证见 [WireGuard 说明](wireguard-overlay.md)。真实 Alpine/QEMU 回归验证了两个接口握手、隧道内通信、停止和重启后恢复。

## 只读救援

磁盘快照页可使用独立临时 Alpine 系统检查停机源盘，选择自动挂载的分区、执行限时命令并提取文件。QEMU 在临时系统启动后才只读接入源盘，宿主全程持有源实例锁；完成、取消、超时或应急锁定后终止并清理临时系统。支持刷新查看任务、导出记录和校验后的产物下载，启动失败保留日志，重启后不恢复遗留任务。入口纳入 OpenAPI/SDK，边界见 [只读救援说明](rescue-boot.md)。

418 项 Node 回归、45 个浏览器场景、六种编译版插件组合、构建、插件合约和分发检查通过。真实 QEMU 三次救援验证挂载、文件及原始块写入拒绝、文件提取、源盘及密钥摘要不变、源实例操作锁、取消、超时及临时实例清理。专项回归覆盖只读状态未确认时拒绝执行、任务结果持久化、跨实例产物访问拒绝、应急锁定、关闭排空与重启清理；浏览器验证命令、下载内容、刷新、取消和手机宽度。

## 临时 COW 工作区

沙箱创建时可选择停止即丢弃磁盘写入，使用 QEMU 对根磁盘的临时写时复制层，初始化种子继续只读。策略创建后固定；旧沙箱省略该字段时保持原有的保留行为。命令任务结束会停止虚拟机，因此日志和主动提取的产物成为显式保留出口。到期保留实例记录也不会保留临时写入，详细边界见 [临时工作区说明](cow-workspaces.md)。

真实沙箱回归在原有持久模式、网络隔离、NAT、超时、取消和到期检查之外，连续启动三次临时工作区。每次停止后基础 QCOW2 摘要保持相同，完成和取消任务的写入在后续启动消失，已提取产物继续可读。专项测试验证策略持久化、仅根盘使用临时层、普通实例及初始化种子不受影响，以及无效策略拒绝。

411 项 Node 回归、44 个浏览器场景、六种编译版插件组合、构建、插件合约和分发检查通过，运行包已重新生成。浏览器全量运行发现新增选择框的测试定位不准确，修正后沙箱三个场景定向复测通过。

## 黄金镜像库

磁盘快照插件提供模板制作、SHA-256 校验、从模板创建实例和删除，磁盘快照页与镜像库页面共用同一个库。模板使用独立实例包，即使源实例删除仍能复用；新实例默认停止，清空端口转发，并在首次启动更新控制身份。库最多 16 个、128 GiB；操作串行、可取消，并处理未完成目录及损坏记录。链接、目录联接、多重硬链接和未知文件不会被当作可递归删除的模板内容。接口纳入 OpenAPI/SDK，制作与创建遵循应急锁定和迁移保护。内容清理、账号和主机密钥边界见 [黄金镜像说明](golden-images.md)。

410 项 Node 回归、44 个浏览器场景、六种编译版插件组合、构建、合约和分发检查通过。真实 Alpine/QEMU 回归验证源实例删除、模板校验、两台派生实例启动、控制身份不同、文件修改隔离、删除模板后实例仍可启动。服务回归覆盖独立包与待更新身份、损坏/取消清理、未完成目录恢复、链接与其他文件保留、并发、沙箱拒绝及发布前锁定复查；浏览器验证模板创建、校验、刷新恢复、实例创建、删除确认及手机宽度。生产路由通过生成 SDK 实际校验和删除模板，并拒绝损坏包创建实例。

## 桌面录制与回放

桌面「外观与布局」支持为一块或两块逻辑屏幕保存分辨率、缩放和左右/上下布局；启动脚本按布局设置 Xvnc 画布和 RandR 监视器，双屏时停止浏览器自动调整客户机分辨率。旧版桌面安装首次应用新版偏好会自动升级。`npm run test:multi-monitor` 在真实 Alpine Xvnc 中验证三种布局；完整 KDE 安装在横向双屏下启动并报告两块监视器。两屏共用一个浏览器画布，详细边界见 [Linux 桌面说明](linux-desktop.md)。

桌面页可录制实际 noVNC 画布，支持暂停、继续、停止、拖动回放位置和 WebM 下载。主动保存后通过 IndexedDB 原子事务持久化索引与视频，录制库可以在桌面或系统设置中刷新、播放、下载、删除及清空，包含所有实例。单次最多 30 分钟、128 MiB，库最多 32 条、256 MiB；断连结束录制，离开检查未保存内容，锁定卸载时释放捕获资源。浏览器存储失败不丢失仍在内存中的可下载视频。详见 [录制使用说明](desktop-recording.md)。

405 项 Node 回归、43 个浏览器场景、构建、合约和分发检查通过。五项控制器测试覆盖暂停计时、最终分片、时间/容量上限、编码失败、释放资源及停止超时。浏览器用真实 noVNC 和本机 RFB WebSocket 服务验证画布编码、视频解码、拖动回放、文件内容、存储失败回滚、保存后刷新、删除、离开保护及手机宽度。五种编译版插件组合通过，并在真实生产 CSP 下完成 WebM 编码及 Blob 视频解码。视频只有桌面画面、不含音频，浏览器库不随实例备份或导出，也不因会话锁定加密。回归中修复快捷键配置范围切换后，延迟初始化偶发覆盖新草稿的问题。

## 网页应用剪贴板策略（部分实现）

新增按工作台、终端、文件编辑与远程桌面入口的复制/剪切、粘贴、文件/图片、文本上限及敏感检测策略，支持实例覆盖、恢复继承、跨标签更新和浏览器保存失败后的内存策略。拦截实际发生在终端输入与文件粘贴上传之前；禁止剪切保留原文。远程桌面对实际 noVNC 事件及发送调用使用相同检查，规则收紧会清除不再允许显示的文本，并重连以释放客户端已缓存的待发送内容，避免延迟剪贴板请求继续传出旧数据。

该能力作用于网页入口，尚不包含 Windows/Linux 独立应用进程的系统权限，因此目录仍保留“部分实现”。详见 [剪贴板策略说明](clipboard-policy.md)。400 项 Node 回归、43 个浏览器场景、五种编译版组合、构建、合约和分发检查通过。浏览器验证真实 xterm 输入、持久化/损坏恢复、文件粘贴阻断与显式上传、内存回退，并使用真实 noVNC 客户端及本机 RFB WebSocket 服务检查双向文本、跨标签收紧和缓存重连。

## Windows 原生打开、资源管理器与文件关联

系统设置提供当前用户的右键菜单安装/移除、按扩展名关联已配置同步的项目，以及记事本/VS Code 编辑器选择。打开助手实际向本机服务认证并提交选中的路径；短期随机链接使浏览器定位正确实例、项目、目录或文件，保留明确的项目选择。文件面板可以在资源管理器选中本机副本，或用固定路径的宿主编辑器打开。目录、文件与原有同步功能复用映射，不自动启动实例或覆盖文件；详细使用方法与限制见 [Windows 集成说明](native-integration.md)。

注册表修改使用预写恢复记录、版本检查、当前值比较与故障回滚，保留其他应用的值和默认关联。路径逐段检查，拒绝越界、链接、联接、备用数据流与特殊命名；锁定、应急隔离和目录迁移继续阻止访问。接口纳入 OpenAPI/SDK，打开助手随运行包分发，并修复发行包对 GraphQL 依赖的旧校验。

10 项专项测试覆盖路径边界、真实 Windows 注册表 Unicode 读写与冲突、配置中断恢复、到期请求、应急锁定、固定程序参数，以及真实 Node 进程经 HTTP 完成定位。全量 Node 回归、40 个浏览器场景、五种编译版插件组合、构建、插件合约、分发检查和运行包制作通过。注册表测试只在独立测试子键中运行；没有安装用户实际右键菜单或更改默认应用。浏览器验证项目定位、文件打开、宿主调用参数、移除和手机布局；宿主编辑器窗口由替身验证启动参数，未声称已人工验证所有 Windows 编辑器版本。

## 本地 AI 助手、脱敏建议与命令规划

系统设置可连接本机 Ollama，读取已下载的本地 GGUF 模型，审阅脱敏内容后实际调用模型提供问答、代码解释、测试或修复建议。自然语言规划通过结构化输出生成目标、假设、步骤命令、影响标注和验证方式，校验后显示并可导出。界面以纯文本显示模型回答；生成结果不会执行命令或写入项目。需要用户已有的本地模型服务，本批没有自动安装或下载模型。

服务端预览绑定配置版本、5 分钟到期且只能发送一次；支持密码、常见令牌、私钥、认证头和认证 URL 的模式脱敏，并要求人工检查遗漏。输入、结果与预览不持久保存。每次生成在发送文本前检查本地权重信息及远程声明，限制地址、并发、请求时间与响应大小，配置变化、取消、锁定和关闭会中断请求。完整边界和使用方式见 [本地助手说明](local-assistant.md)。

387 项 Node 回归、38 个浏览器场景、构建、插件合约及分发检查通过。六项针对性回归使用本机 HTTP 协议服务验证脱敏、发现/预检/生成、单次预览、云模型拒绝、结构化计划和取消。浏览器验证预览、文本安全渲染、计划导出、输入清除及手机宽度；五种编译版插件组合通过，并在真实生产路由中校验协议交互及日志不含输入。开发机未运行真实模型，生成质量与性能尚未验证，不把协议测试冒充实际模型推理。

## Webhook 事件与告警路由

系统设置 → 管理事件通知可配置最多 16 个接收端，按实例、项目、标签、任务状态及告警类型匹配。实际采集任务完成和通知中心告警，持久排队后通过带 HMAC-SHA256 签名的 HTTP POST 投递。正文只包含标识、类型、状态与实例标签，排除命令、标题、日志、告警消息、密钥值和控制凭证。密钥仅在创建和轮换时返回；配置变更校验版本，避免覆盖其他窗口的修改。

支持显式测试、自动退避重试、手动重试、取消、停用和密钥轮换。订阅修改会取消旧版本积压，不把旧事件改投新地址；关闭与恢复继续使用稳定投递标识，接收端必须去重。自动采集每 5 秒检查当前插件的保留历史，只匹配保存之后且在最近 24 小时内的事件；已排队记录独立持久保存。容量、投递头、签名算法、重试和维护行为见 [接收端接入说明](webhooks.md)。

381 项 Node 回归、37 个浏览器场景、构建、插件合约及分发检查通过。八项针对性回归覆盖内容过滤、条件匹配、真实 HTTP 签名、重启去重、重试上限、轮换、取消、队列压力及关闭排空。浏览器验证真实订阅管理、一次显示密钥、测试投递、草稿保留、停用、删除与手机宽度；五种编译版插件组合检查通过，并由真实生产后台定时器向本机 HTTP 接收端投递、核对 HMAC 和落盘结果。

## 会话自动锁定

系统设置 → 管理会话锁定可启用主机级密码锁，空闲时间为 1–240 分钟。可见页面的真实鼠标、键盘和滚轮操作才会刷新期限；状态轮询不计为操作。顶栏按钮可立即锁定，服务重启后启用了策略的主机默认锁定。所有标签页、CLI、SDK 共用状态，解锁后重新获取控制凭证，不重放被拒绝或断线的操作。

锁定由服务端在请求入口及每秒定时器执行：包括 bootstrap、一次性下载、GraphQL、监控和 WebSocket，锁定时返回 423/SESSION_LOCKED，现存终端、桌面、事件连接及受保护 HTTP 流被断开。新操作不能绕过锁定；此前已提交的后台任务和实例继续运行。浏览器卸载整个控制界面并显示密码表单，其他标签页跟随状态恢复。此功能不加密数据目录，也不清除浏览器草稿和用户启用的离线监控缓存；具有宿主机文件权限的人仍能管理本地配置。

密码至少 12 个字符，仅持久保存随机盐和 scrypt 摘要（N=131072、r=8、p=1）；更改密码、停用或重新启用已配置的策略均需当前密码。连续五次失败后冷却 60 秒，失败状态跨重启保留；一次只执行一个密码验证。配置损坏时服务拒绝启动，不静默关闭锁定。密码不进入 URL、浏览器存储、任务日志或审计正文。公开状态接口不返回凭证；同源校验覆盖解锁入口，SDK 和 CLI 显示锁定错误。

373 项 Node 回归、36 个浏览器场景、构建、分发及插件合约检查通过。回归覆盖闲置、活动续期、重启、冷却、密码轮换、停用、时钟回退、并发验证和服务关闭，以及旧请求结果不能恢复已锁定界面。浏览器验证启用、空闲自动锁定、错误密码、手动锁定、刷新和手机宽度；五种编译版插件组合验证多标签页、连接断开、未完成请求体被中断、旧凭证撤销，以及 SDK/CLI 和各受保护入口的真实拒绝行为。

## GraphQL 查询接口

系统设置 → 打开 GraphQL 查询可按字段读取主机信息、全部实例清单、已启用插件的任务元数据和插件启用状态。支持变量、命名查询、别名、片段、自省、筛选与分页，列表先筛选再按 offset/limit 取页；一个请求只获取一次主机快照。可下载 SDL Schema 和本次 JSON 结果，面板不持久保存输入或结果。接口不声明 mutation/subscription，也不暴露任务正文、结果文件、控制凭证和私密配置。

`POST /api/graphql` 继续要求本机同源和控制凭证，返回 GraphQL JSON 响应；`GET /api/graphql-schema` 返回字段、版本和限制。使用固定版本 GraphQL.js 16.14.2 执行解析、验证和查询；按 [GraphQL over HTTP](https://http-spec.graphql.org/draft/) 区分请求验证错误与字段执行错误，客户端保留字段错误信息。OpenAPI 和生成的 JavaScript SDK 已包含两个入口，SDK 支持 `+json` 响应类型。

单请求最多 64 KiB、查询文本 16 KiB、2500 token、16 层深度、1500 次选择展开、50000 展开成本；列表每页最多 100 条，offset 最大 10000，响应最多 1 MiB，并发最多 8 项，5 秒查询期限。片段循环及别名、列表乘积在执行前计算；自省列表上限由当前 Schema 推导，标准自省查询可正常执行。取消与关闭释放查询名额，内部数据读取失败不返回本机路径或原始异常。较大查询会明确拒绝，不自动拆分或重试。

五项回归覆盖 125 个实例跨页、变量和片段、标准自省、字段与操作校验、深度/成本限制、结果大小、取消、并发、超时和关闭。366 项 Node 回归、35 个浏览器场景、构建、分发检查及插件合约通过。浏览器连接实际查询执行器验证参数、错误反馈、Schema 下载和手机布局；五种编译版生产插件组合均通过生成客户端查询主机与插件状态，并验证认证、方法和请求大小限制。

## 任务日志保留策略

系统设置 → 管理任务日志可预览并保存主机级策略。默认关闭，启用后立即应用并每分钟检查一次：先按任务完成时间清除到期日志，再从旧到新清理以满足总容量。按 UTF-8 字节数计量，保留天数为 1–3650 天、容量为 1–1024 MiB；预览后的日志或策略变化会要求重新预览。运行中任务以及完成时间无效或在未来的日志受到保护，迁移数据目录时暂停，关闭服务时等待已接受的清理完成。

范围是当前已启用插件所持有任务的 log 正文；任务元数据、错误摘要、结果文件、审计链、客户机日志和 VM 串口内存环形缓冲区保持各自的保留规则。禁用插件的数据在再次启用后纳入。清理整份日志而非截断内容，任务页面显示清理时间；此容量不是整个数据目录的配额。策略先持久保存再执行，任务历史写盘失败会恢复内存中的正文并报告未全部完成；跨存储清理不是整体事务，已成功的清理不会自动恢复。

六项针对性回归覆盖时间与总容量、多字节计量、运行中保护、任务结果继续可读、重启、过期预览、失败恢复、真实定时器入口和关闭排空。浏览器验证设置、草稿、过期预览、刷新恢复、停用和手机宽度。五种编译版生产插件组合通过 SDK 实际保存策略，核对已启用插件日志在磁盘上被清空、未启用插件的历史仍保留。

361 项 Node 回归与 34 个浏览器场景通过，类型检查、构建、分发检查和插件合约通过；补充保留新核心端点及应急锁定路由，插件声明不能占用这些入口。

## OpenAPI、API 浏览器与客户端

系统设置可打开 API 浏览器，搜索 38 个核心 HTTP 操作和 12 个具有类型合约的插件操作，查看插件启用状态、参数、请求与响应结构。可填写参数执行明确允许的只读请求；写入操作仅展示文档。文档采用 OpenAPI 3.1.1，带本机控制凭证声明和运行端口，可下载为 JSON。默认参数按输入合约保持可选，运行时额外约束仍由服务端校验。旧插件的路由分发前缀另列为索引，不当作实际端点；未完整声明的响应标记 partial。

可下载无依赖的 JavaScript ES 模块，用操作标识调用已声明接口，也可通过通用 request 方法访问其他 HTTP 接口和二进制传输。客户端限制到 localhost/127.0.0.1 HTTP 源，自动获取仅保存在内存中的控制凭证，验证和编码路径参数，支持取消、JSON 解析与 Response 流读取。HTTP 错误、断线和取消均不自动重放请求；401 后需要下一次明确调用才重新认证。此客户端不包含 WebSocket 或完整生成的 TypeScript 类型。

新增三项服务端回归验证实际 HTTP 调用、参数编码、认证、二进制数据、取消和写入失败不重放；浏览器验证筛选、只读请求、路径拒绝、两个文件下载及手机布局。生成后的客户端在五种真实生产插件组合中调用实例列表和监控 API 均通过。类型检查、构建、插件合约和分发检查通过。

## 离线监控 PWA

系统设置可打开 `/monitor/index.html` 独立只读监控。页面可见时约每 30 秒读取实例概况和最近任务类型、状态、时间，最多各 100 条并显示完整总数。断网、服务停止、超过 90 秒未采样或时钟偏差均不会宣称当前在线；界面始终标明采样时间。专用 API 要求正常控制凭证且只接受 GET，返回字段不包含命令、任务标题、日志、结果、密钥和项目配置。

离线缓存默认关闭。手动启用后只缓存监控页的静态资源与最后一次脱敏快照；Service Worker 的范围为 `/monitor/`，不缓存控制台和 API 响应。内容版本自动进入缓存名称，更新成功后移除旧静态缓存。跨窗口写入与删除使用浏览器锁，旧采样不会覆盖新采样；清除只删除此功能的缓存并注销对应 Worker。缓存失败会回滚启用状态。安装清单包含 192/512 图标和独立窗口入口，支持时由用户点击浏览器安装提示。需支持 Service Worker、Cache API 和 Web Locks 的浏览器，安装方式依浏览器而异，见 [MDN PWA 安装说明](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。

新增服务端回归验证字段过滤、排序和数量上限；两个浏览器场景验证断网刷新、恢复连接、凭证/日志不进入缓存、仅清除此功能数据、存储失败回滚和手机布局。构建、分发检查、插件契约及五种生产插件组合通过，并在真实生产 CSP 下完成离线重载。未在用户浏览器中执行系统安装。

## 无障碍检查模式

顶栏可开启检查面板，按需加载本地 axe-core 4.13.0，检查当前已渲染主文档的 WCAG A/AA 和最佳实践规则，覆盖对比度、表单名称、ARIA、键盘及结构语义。结果区分明确问题、需人工复核和通过的规则；可定位具体元素，开启焦点轮廓及最近 20 次焦点轨迹辅助人工检查。页面、项目、主题、对话框切换会清空旧报告。

报告下载只保存规则描述、检查标识和本次元素编号，不保存 HTML、选择器、输入值或正文。每条规则保留最多 500 个元素并标明完整数量。检查不包含 iframe 内容、未渲染页面或 Linux 桌面图像，自动通过不能代替键盘和屏幕阅读器人工验证。运行选项与结果分类见 [axe-core API 文档](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/API.md)。

351 项 Node 回归、30 个浏览器场景、生产构建、分发检查、插件契约及五种生产插件组合通过。浏览器实际生成对比度、缺失名称和图片替代文字问题，验证定位、修复后重测、脱敏导出、手机宽度和关闭清理。额外在正式 CSP 下打开生产服务并完成检查；中文规则作为静态文字显示，不要求动态脚本求值。

## 快捷键编辑器

系统设置中可为命令面板、导航、主题及专注模式设置按键，支持浏览器页面全局配置和当前实例下的项目覆盖。空值停用对应操作，项目可恢复继承，全局可恢复默认；保存和跨标签页变更即时生效，最多保留 100 个项目。配置只保存在当前浏览器，不注册 Windows 系统全局热键。

保存前检查所有项目的最终有效按键，避免修改全局设置后产生项目冲突。Mod 适配 Ctrl/⌘，常用浏览器和编辑组合键保留。输入框、代码编辑器、终端、桌面、对话框、输入法组合状态及按键连发不触发页面命令；插件未启用的操作也不拦截。导航继续检查未保存编辑内容。

三项逻辑回归、类型检查、构建和插件契约通过。浏览器验证冲突提示、实际主题切换、项目覆盖、刷新保留、输入框与终端保护、恢复继承、命令面板和手机宽度；原有导航及插件入口回归也通过。

## 电源感知调度

能力中心的扩展操作可查看 Windows 当前供电方式与电量，并为实例保存电源策略。启用自动化调度插件后，计划开机默认只在交流电下执行；可允许电池供电并设置最低电量。状态未知或超过 90 秒的采样暂停自动开机。策略不会改动 Windows 电源计划，不影响手动启动；错过的计划分钟不在稍后补跑。

低电量停机默认关闭（阈值为 0）。显式配置正数阈值后，已知电池供电且电量达到阈值时使用普通停机流程：请求客户机退出，15 秒后仍未退出则结束虚拟机进程。开机阈值必须高于停机阈值，维护窗口暂停此自动操作，未知电源状态不会触发关机。关闭调度器会取消查询，重新启用使用新的取消信号，避免旧查询完成后开关机。

15 项定向测试、类型检查、插件契约和生产构建通过；真实读取本机 Windows 电源状态，受控调度测试覆盖电池、交流电、未知电量、维护窗口及关闭重启。浏览器验证实例停止时保存策略并显示调度决定；首轮测试补齐缺失的模拟操作列表后通过。

## 主机磁盘健康报告

平台能力中的报告通过实际数据目录解析 Windows 卷和关联磁盘，读取卷/磁盘健康状态、运行状态、可用空间，以及存储提供程序支持的温度、已消耗寿命、通电时长和历史不可纠正错误。容量、温度和寿命阈值可调整，结构化报告可下载。映射失败、计数器权限不足、全部或部分字段缺失均显示未知，不补零，也不从设备型号推断可靠性。接口为只读查询，30 秒超时并支持取消。

计数器含义遵循 [Microsoft Storage 文档](https://learn.microsoft.com/en-us/windows-hardware/drivers/storage/msft-storagereliabilitycounter)，历史错误不等于当前正在发生故障。此功能不运行磁盘表面扫描，也不修复文件系统。

本机真实检查已成功把数据目录映射到 NVMe 磁盘并读取卷健康及容量；当前权限无法读取 CIM 可靠性计数器，报告保留该原因。13 项定向测试、类型检查、生产构建、插件契约通过；两个浏览器场景验证客户机停止时仍能查看报告，区分未知与零错误并下载结果。

## 私密配置轮换与剪贴板检测

“开发 → 私密配置”显示最后一次实际变更后的天数，可为各条目启用轮换周期和提前提醒。更改提醒策略、重新保存相同值都不重置年龄；新值沿用原策略并重新计时。现有记录从历史更新时间计算，未来或无效时间显示未知；年龄不代表第三方服务上的真实签发时间。元数据查询不解密密钥，列表与提醒不返回值或密文。

启用自动化调度和告警后，到期前、到期时各生成一条通知。确认状态与去重跨服务重启保存，暂时停用私密配置插件不会清空去重。此功能提醒用户轮换本地保存的私密配置，不会自动修改外部服务或 SSH 主机密钥。

“系统设置 → 剪贴板敏感检测”为浏览器本地的可选设置。启用后检查页面复制、剪切和 Linux 桌面双向文本传递，阻止常见私钥、访问令牌、JWT、带凭据 URL 和明文赋值，超过 1 MiB 的文本也会阻止。提示只含类别，不显示匹配内容。页面剪切在可读取选择内容时提前阻止，编辑器已经提交的复制数据会清除所有格式。不读取后台剪贴板、不上传或保存检测文本；无法覆盖所有凭据格式、图片、浏览器之外的应用或第三方页面。

27 项定向回归、6 项功能生命周期/目录检查、类型检查、生产构建、插件契约及五种生产插件组合通过。四个相关浏览器场景通过（首轮剪贴板测试的导航名称修正后定向重跑通过），验证剪切保留原文、编辑器多格式载荷被清空、普通文本可复制、设置跨刷新保留，以及轮换策略只提交元数据。

## 网络诊断与配置档案

能力中心可指定目标、端口、检查项及单项超时，分别运行 DNS、TCP、HTTPS HEAD 和实际路由查询。每项在独立受限进程中执行；检查失败、缺工具或超时都使整体结果失败，不会被后面的成功命令掩盖。HTTPS 验证系统信任链和主机名，不跟随重定向，不读取响应正文。路由列出最多八个地址的查询结果，存在可用路由才通过。客户机需 Python 3.9+，路由检查需 `ip`。

“开发 → 网络配置”保存最多 40 个可跨实例加载的具名档案，包含 DNS、代理、软件源及可选 NAT 端口映射。加载只更新表单；预览展示文件和映射前后内容，应用时重新校验版本。整个恢复计划在首次写入前持久化；中断后可继续恢复，外部修改文件或端口会阻止覆盖。端口修改使用真实 QMP，持久化失败会回滚运行中的转发。

自定义 DNS 支持 Sakura Alpine 的静态网络，以及使用 systemd-resolved stub 的系统。Alpine 保留现有搜索域和解析器选项；resolved 使用可恢复的全局配置片段并重启核对地址，`~.` 作为默认解析路由，更具体的按域规则继续生效，详见 [systemd DNS 路由说明](https://github.com/systemd/systemd/blob/main/docs/RESOLVED-VPNS.md)。其他解析器在预览时明确拒绝自定义 DNS，清空地址即可沿用系统设置。NAT 档案管理现有本地 TCP 转发，不改变 QEMU 的固定内部子网。

335 项 Node 回归、24 个浏览器场景、生产构建、分发检查、插件契约与五种生产插件组合通过。`npm run test:network` 在独立 Alpine 实例验证真实 DNS/TCP/HTTPS/路由，拒绝端口、无效 TLS、超时终止，Windows 端口连接到 Linux SSH，冷启动后保留 DNS/转发，并恢复原始解析器、移除监听。单元回归另覆盖中断、版本变化、外部修改和 resolved 重载失败后的恢复；resolved 后端尚未在真实 Ubuntu 实例中验证。

## 持续可用性报告

自动化调度逐次记录正常运行、探测失败、停止、暂停和启动等状态，合并连续区间，最多保留 30 天或 8,000 段。运行且 Linux 资源探测成功视为可用；停止或探测失败视为已观测的不可用。超过 90 秒的采集空白、采样开始前和最近一次观测后的时段均计为未知。状态转换时间由约 30 秒轮询估算；系统时钟倒退不会生成重叠区间。

能力中心的可用性报告可选择最近 1–720 小时，显示已观测时段的可用率、观测覆盖率、未知时长及分状态时长，并导出区间明细。没有采样时可用率为未知，不显示为 100%。回归覆盖探测成功/失败/停止、采集空白、保留上限、窗口裁剪及重叠记录拒绝。类型检查、生产构建和插件契约通过；真实 `test:observability` 再次通过并验证运行时长与停止状态跨服务重启保留。

## 资源历史与通知中心

能力中心的资源趋势保存 CPU、内存、根分区和网络指标，可切换趋势、查看明细并导出 CSV/JSON。启用自动化调度插件后每 30 秒采样一次，每实例持久保留最近 720 次；重复读取缓存采样不会生成重复历史。网络速率根据 Linux 网卡字节计数与运行时间计算，排除回环接口；首次采样、重启、接口变化、计数重置及超过两分钟的采样间隔显示未知。桥接或虚拟接口可能重复统计同一流量，汇总值不是物理网络账单。

告警支持资源阈值、备份/后台任务失败，以及已配置健康检查的服务异常。备份和任务告警关联实际任务 ID，失败文本不复制到通知；同一任务只提醒一次。服务异常与资源阈值受冷却间隔控制，手动停止的服务不告警。维护窗口暂停自动执行，但继续监控和记录。

通知中心保留本机最近 500 条告警，可筛选未确认、逐条确认、分页查看和导出。确认状态与任务去重记录跨重启保存；浏览器通知需要手动允许，并仅在通知中心页面打开时推送新事件，不提供后台推送服务。

真实验证命令 `npm run test:observability` 使用隔离 Alpine 实例验证网卡计数和流量速率；仅破坏测试备份以触发真实校验失败，核对通知关联的任务及重启后的确认状态、指标历史。新增回归覆盖并发首读、缓存去重、网络重置、服务状态、告警冷却及插件停启后的去重；浏览器验证趋势切换、导出、确认和显式启用通知。

## 定期磁盘维护

“工作空间 → 维护”可配置定期 TRIM、停机整理及压缩选项。磁盘与诊断插件每分钟检查一次，按两种操作各自的成功时间计算间隔；失败至少等待五分钟重试。维护窗口、内部快照、未完成扩容和实例状态会限制自动操作，不会自动关闭实例。

TRIM 仅针对 Linux 根文件系统，需启用设备 discard 并安装 fstrim。整理任务在整个转换、校验和发布期间持有实例锁，禁止同时启动或改动磁盘。新镜像通过 `qemu-img check` 和 `compare` 后才替换原路径；发布期间使用硬链接保留原磁盘恢复副本。发现未清理的恢复副本时拒绝再次整理，保留数据供核验。

四项维护回归覆盖取消、校验失败、原磁盘保护、启动并发、独立调度间隔、维护窗口和重启持久化；新增浏览器场景通过。真实 `test:storage` 已验证自动 TRIM、离线压缩与逐扇区比较，以及后续备份恢复启动。

## 备份去重

快照页的备份策略可启用本机内容块去重。备份使用 1 MiB 内容块与 SHA-256 清单，在同一 Sakura 数据目录的所有实例间复用相同块。现有独立备份保持原格式；加密和外部目录备份不支持此模式，组合配置会被拒绝。数量和容量策略按备份的逻辑容量计算。

下载时逐块校验并重组为独立 `.sakura` 包，整体校验失败会中断下载；校验和恢复先重组至临时文件并检查内部磁盘哈希。删除及保留策略移除清单，能力中心的“全局去重”提供实际占用统计和显式垃圾回收。回收会扫描所有清单，仅释放没有引用的块；发现缺失引用时拒绝回收。保留锁继续约束备份删除。

新增真实虚拟机验证 `npm run test:storage` 已通过：NUMA、e1000 和 IPv4/IPv6 双栈启动，连续两份备份复用 130,354,068 字节，下载整包校验、恢复启动及项目文件检查均通过；删除并回收所有备份块后，恢复的实例仍正常读取数据。测试也修复了显式启用 QEMU IPv6 时未同时启用 IPv4 的启动错误。

## 第二批实现

| 类别      | 新增入口                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------ |
| 同步（4） | 文件事件触发与轮询回退、唯一内容重命名识别、路径方向及 Linux 权限、带哈希校验的同步回滚          |
| 资源（6） | 自定义资源预设与推荐、CPU 拓扑和 NUMA、设备档案、资源预算和启动优先级、IPv6 开关、TCG 内存热插拔 |
| 开发（3） | npm/Python 依赖图与过期报告、Go/Java/.NET/PHP 精确软件包版本安装、环境锁文件的捕获/校验/重建     |
| 审计（2） | 写 API 和后台任务的 HMAC 审计链、关联请求与任务的 OTLP 链路导出                                  |

同步功能在“工作空间 → 同步”启用。事件模式使用 Windows 递归目录监听和 Linux `inotify-tools`，缺少支持时保留 15 秒轮询，每分钟补查；仅传输内容变化的文件。重命名要求文件内容未变化、唯一对应且另一侧未修改，歧义仍按复制与删除处理。路径规则按第一条匹配生效，并约束强制同步、删除与冲突处理。删除必须在预览中明确选择。

回滚为可选功能，每轮保存两端原文件及同步基线，去重后最多 512 MiB，保留最近 10 个完成记录；未解决的中断记录保留并计入上限。只允许撤销最近一轮未回滚记录，恢复前检查当前文件和备份哈希，后续修改会阻止恢复。新建空目录保留。保存数据位于实例当前项目的 `sync-history*.json.d`。

资源能力在能力中心配置。拓扑、设备、IPv6 和资源预设需停止实例后应用，随实例包导出；预算检查覆盖启动和热插拔，自动开机按优先级顺序执行。内存热插拔需预留最大容量和插槽，以 128 MiB 为单位添加，核验 QMP 容量及 Linux 上线结果。真实 Alpine 测试已验证 TCG 下从 1024 MiB 增至 1152 MiB 和冷启动后的持久化。

多架构实例现支持 Debian 12 ARM64：镜像库校验官方 ARM64 云镜像，新建实例选择后使用 QEMU `virt`、UEFI 和 TCG。真实 Windows 宿主测试已验证客户机 `aarch64`、cloud-init 初始化与冷启动。创建、导入和实例包保留架构，已有实例不能直接切换架构。详见 [ARM64 实例](arm64-instances.md)。

vCPU 热插拔现有完整可用路径：停机预留插槽、TCG 启动、检查客户机可用插槽、QMP 在线添加及 Linux 上线校验。真实 Debian 12/QEMU 11.1 从 1 个 CPU 增至 2 个，冷启动后仍为 2 个；Alpine 6.18 未识别预留 CPU 和 WHPX 不稳定时继续在修改前拒绝。操作与支持边界见 [在线 vCPU 热插拔](cpu-hotplug.md)。

环境锁记录 OS、架构、系统包精确版本、工具版本和项目清单哈希。校验返回实际漂移；安装需要相同发行版/版本/架构，使用项目锁定安装，并且系统软件包变更需要显式 `installSystem`。不保证已从软件源移除的旧版本仍能下载。运行时精确安装先执行包管理器模拟，再安装用户选择的包和版本。

审计在控制面写 API 和后台任务执行前后记录操作元数据，不保存请求体、命令内容或任务输出。记录通过 HMAC 链和独立封印检测修改与截断；保护依赖本机审计密钥，不能抵抗持有该密钥的宿主管理员。日志损坏或达到 128 MiB 上限会拒绝新写操作，需要备份、归档并维护审计目录。审计不是远程不可变存储；OTLP JSON 导出不自动发送外部服务。

## 本轮入口

| 类别           | 实现                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础能力（9）  | 跨实例与项目全文搜索、按类型与目录分析磁盘、目录版本/差异/校验恢复、图片/PDF/CSV/ZIP/TAR 预览、分块上传与 CLI 下载续传、基于共同文本的三方同步、统一格式化/Lint/自动修复、剪贴板文件/图片上传、Git 工作树管理                                                             |
| 扩展能力（18） | 依赖顺序启动、跨实例文件复制、命令参数表单、环境一致性比较、按锁文件重建项目、Ed25519 补丁签名与验签、本地行级评审、跨实例测试矩阵、指标导出、任务和告警关联时间线、资源异常基线、编辑器 SSH 档案、终端布局预设、启动熔断、维护窗口、同步时间窗、离线同步队列、备份保留锁 |
| 平台能力（18） | 网络接口/路由拓扑、测试分片、语言服务器目录、代码索引、PII 规则分类、任务日志索引、SLO、错误预算、当前宿主容量估算、活动摘要、Schema 参数表单、操作证据导出、PAC 生成、构建缓存、分支预览工作区、入门清单、行级评审线程、备份输出限速                                     |

能力中心中的“可执行功能”可选择操作、展开参数表单或编辑 JSON，后台返回实际任务状态。失败的退出码会使任务失败。完整结果独立于 32 KiB 日志保存，带 SHA-256 校验，可导出；单项结果上限 8 MiB，跟随最近 200 条任务历史保留。

## 使用方式

GPU 与 3D 加速：在扩展能力中心的“虚拟设备档案”保存并应用 `{"graphics":"virtio-gpu"}`（2D DRM）或 `{"graphics":"virgl"}`（3D），停机后应用并重新启动实例。VirGL 使用 QEMU `virtio-gpu-gl-pci` 与 `egl-headless`；在第一批“GPU 与 3D 加速”中运行 `install-mesa` 可安装客户机 Mesa，再用 `status` 读取 GBM 实际渲染器。返回 `verifiedBy: gl-renderer` 表示 Mesa 报告 `renderer: virgl`；Debian 上若 `eglinfo` 未打印渲染器，则以 GBM 的 `virtio_gpu` EGL 驱动与内核 `+virgl` 协商联合验证，返回 `gbm-driver-and-virgl-device`。软件渲染不会被误报。Debian 云内核缺少 GPU 模块时，安装还会配置通用内核，需要重启后再次验证。真实虚拟机冒烟测试覆盖 Alpine VirGL、Virtio GPU 2D、Debian VirGL 与 Ubuntu VirGL；可在 PowerShell 中运行 `$env:SAKURA_GPU_UBUNTU_ONLY='1'; npm run test:gpu` 单独测 Ubuntu。此配置当前只支持 x86_64；应用是否使用该设备仍由应用及其显示栈决定。

系统调用隔离：在第二批能力中心选择“系统调用隔离”，先以 `{"mode":"install"}` 安装客户机 Python 与 libseccomp，再以 `{"mode":"run","profile":"networkless","command":"python3","args":["-c","print('hello')"],"confirmed":true}` 运行单次受限命令。命令使用所选项目的目录、环境与网络模式，并遮盖私密输出。`restricted` 拒绝挂载、内核模块、ptrace、命名空间切换等管理系统调用；`networkless` 还拒绝创建 socket 等常见网络系统调用。两者都会启用 no_new_privs，过滤器随子进程继承；取消、超时和命令退出后清理受限命令进程组，后台子进程不会因父命令正常退出而留下。系统调用过滤器不隔离文件系统或已经继承的文件描述符，也不替代容器或虚拟机边界；仅用于明确选择的命令，主动脱离进程组的子进程仍不受清理保证。`status` 在系统环境中实测加载的过滤器和网络拒绝，`install` 使用共享网络获取工具，不加载项目环境。`npm run test:syscall-profile -- alpine` 使用真实虚拟机验证项目绑定、网络空间、密钥遮盖、字面参数、保留的系统执行器、路由拒绝与取消、超时和退出后的进程清理，也支持 `debian`、`ubuntu`；原有发行版环境变量仍可使用。

Windows/Linux 进程互操作：在 Windows 宿主机的第一批或第三批能力入口提交 `{"mode":"allow","programId":"whoami","executable":"C:\\Windows\\System32\\whoami.exe"}`，再启动 Linux 实例并提交 `{"mode":"install"}`。客户机执行 `sakura-win whoami`，标准输出、标准错误和退出码来自登记的 Windows 程序。登记时可指定 `fixedArgs`；客户机只能传 `programId`，不能注入参数。`status` 查看允许列表，`remove` 撤销单个程序，`disable` 立即撤销实例令牌。每次调用重新验证 EXE 的 SHA-256；服务还检查实例运行及应急锁定、控制面锁定和数据迁移状态。每实例只允许一个并发调用，运行上限 30 秒，输出上限 128 KiB。客户机需安装 curl 与 jq，`install` 会尝试通过 apk 或 apt 安装。令牌只写入客户机 root 可读的 curl 配置，宿主只存储哈希。

SSH Agent 转发：在扩展能力中心选择“SSH Agent 转发”，填写要执行的客户机命令、`confirmed: true` 和 1–300 秒时限。Sakura 连接宿主 `SSH_AUTH_SOCK`（Windows 默认 OpenSSH Agent 管道），只为该命令创建转发 SSH 会话；命令结束、失败或取消即关闭连接。客户机需要 OpenSSH 客户端，宿主 Agent 需运行且装载所需密钥。客户机可请求 Agent 为任意数据签名，因此只对可信命令启用；私钥文件不复制到客户机。

GPG Agent 转发：第二批能力中心可在确认的单次命令期间，将宿主机受限制的 GnuPG extra socket 通过 SSH 提供给客户机临时 `GNUPGHOME`，并在完成或取消后关闭转发及清理临时目录。客户机须安装 GnuPG、导入公钥，并显式允许 SSH 远端 Unix 套接字转发；默认 Alpine 镜像的 `AllowTcpForwarding no` 会被前置检查拒绝。`npm run test:gpg-agent-forward` 已用真实 Alpine SSH 与模拟 Assuan extra socket 验证连接、拒绝和清理；真实宿主私钥签名尚未验证。设置与范围见 [GPG Agent 转发](gpg-agent-forward.md)。

账户模式中的 JIT 临时授权支持只读账户为其已分享的实例申请一次“启动”或“正常停止”，申请必须填写原因，并在 24 小时内获批。管理员在“系统设置 → 账户与只读分享”中选择 1–60 分钟有效期批准，也可拒绝或在执行前撤销。申请者在只读分享页手动执行；批准绑定申请者、实例和操作，执行前持久标记为已使用，失败或服务重启均不会自动重试。账户失效、实例范围变更、实例应急锁定及控制面锁定仍会阻止执行。普通只读账户的其他变更接口保持拒绝；JIT 目前只涵盖单次实例启停，不授予终端命令或配置修改权限。

ACME 证书续期在第三批能力中心选择“ACME 证书续期”。`status` 检查运行中客户机是否安装 Certbot 并已有 `/etc/letsencrypt/renewal/*.conf`；`dry-run` 调用 Certbot 的测试续期，`renew` 执行实际续期。`save` 保存 `enabled` 和 `intervalHours`（1–168，默认 12），启用后在实例运行且控制面未锁定、数据未迁移时定期执行。停机期间保留到期任务，下一次启动后重试；每次尝试及退出码写入宿主状态。该功能续期已有证书，不负责首次签发、域名验证配置或 Web 服务重载；如需部署新证书，请在客户机配置 Certbot deploy hook。[Certbot 官方文档](https://eff-certbot.readthedocs.io/en/stable/using.html#renewal)说明退出码 0 也可能表示目前无需续期，所以结果只报告“续期检查成功”，不推断证书已更换。

- 文件面板的“预览”支持图片、PDF、CSV/TSV 和 ZIP/TAR/TGZ 目录。文件大于 16 MiB 时只预览前 4 KiB；归档不执行解压，ZIP64/分卷 ZIP 尚不支持。
- 浏览器上传达到 8 MiB 后使用 1 MiB 分块。中断后重新选择相同文件和目标即可续传；宿主保存会话 24 小时，每实例最多 16 个会话，文件上限 2 GiB。
- 下载续传使用 `npm run sakura -- download <实例名> <客户机绝对路径> <本机输出文件>`。中断后重复命令即可复用校验通过的分块。部分文件与清单保留在输出文件旁；拒绝覆盖现有成品文件。完成发布使用同目录硬链接，需要支持硬链接的本机文件系统，例如 NTFS。
- `npm run sakura -- task <任务ID> result` 读取独立保存的完整结果。
- 同步面板启用“保存共同文本版本”，先完成一次同步建立基线，再在变更预览中选择自动文本合并或打开手动三方合并。单文件最多 1 MiB，基线合计最多 16 MiB。自动合并遇到重叠修改会保留两端；手动编辑后可提交审阅结果。关闭此选项会清除共同版本。两端不能组成一个文件系统事务；若第二端提交失败，日志会明确报告，重新预览后继续。
- 文件编辑器保存冲突和 Git 工作台的普通文本冲突均可打开三方编辑器。独立修改自动合并，重叠修改逐处选择或手动填写。Git 保存会核对工作文件及索引版本，并暂存结果；二进制、删除、符号链接和子模块冲突可在 Git 工作台选择一侧版本。
- 终端面板展开“终端布局预设”保存标签名称、顺序、选中标签和分屏。预设保存在当前浏览器，应用时保留其他现有会话。
- 文件面板聚焦后支持 Ctrl+V 粘贴文件与图片；编辑器中的普通文本粘贴保持原行为。无名截图生成独立文件名，上传沿用覆盖选项和进度/取消流程。
- Git 工作树操作提供 `list/create/open/remove`。`create` 使用项目内 `path`，可指定新 `branch`；`open` 使用已登记的绝对 `directory`，创建或选择独立项目。删除拒绝脏目录、当前工作树及仍被项目引用的目录。

## 自动任务与备份

能力中心“自动任务维护窗口”支持时区、星期、跨午夜时段，实际暂停新启动的计划启停、自动同步和定期备份。窗口不会中断当前任务，也不阻止手动操作。开始和结束时间相同表示完整 24 小时，跨午夜窗口归属开始日。

同步面板可保存后台时间窗和 MiB/s 限速，也可在实例离线时点击“排队同步”。队列按实例与项目隔离并写入宿主存储；连接恢复后重新扫描内容，失败按退避时间重试，上限 10 分钟。队列仅做保留冲突的双向同步，不重放旧的覆盖决定。点击“取消排队”会取消正在执行的队列任务并停止重试；更换同步根目录会清除旧队列。自动同步开启后，后续仍会按设置创建新请求。

备份面板可设置输出速率和新备份的保留锁天数；每实例串行备份。记录中的锁定到期时间不随策略修改而缩短，删除接口与自动清理都会检查它。如果锁定备份导致超过容量或数量预算，保留备份并在日志中说明。保留锁约束 Sakura 操作，不是磁盘硬件 WORM，也不能阻止宿主管理员直接修改文件。限速针对独立包输出，不限制 QEMU 转换时的临时磁盘 I/O。

启动熔断在 5 分钟内连续 5 次启动未就绪后阻止再次启动，状态跨服务重启保存；客户机启动就绪后清零。可在能力中心查看状态，停止实例后手动重置。

## 执行边界

项目文件逻辑擦除支持预览哈希及文件身份，确认后重新比对，执行两轮随机覆盖与一轮零覆盖、校验、删除并保存执行记录。仅限 `/workspace` 项目内 128 MiB 以下的单链接普通文件；不证明 QCOW2、SSD、快照或备份的历史块被物理清除。真实 Alpine 实例已验证预览不修改、符号链接和硬链接拒绝、过期令牌拒绝及成功删除。步骤与中断边界见 [逻辑擦除说明](secure-erase.md)。

独立运行包支持本地版本分阶段升级：`update:check` 校验 SHA-256 清单，`update:stage` 安装锁定的生产依赖并用隔离数据预启，`update:activate` 切换下次启动版本。启动器健康检查失败会自动切回旧版本，也可手动 `update:rollback`。数据、QEMU 和 PosixLoom 留在原安装目录；当前不支持通过此流程更换运行时。发行包完整性校验不认证发布者，升级前需从可信渠道获取本地包并备份数据。详见 [自更新说明](self-update.md)。

客户机执行器要求 Python 3.9+；格式化、签名、网络探测、环境重建等操作还要求对应工具，缺工具明确失败。分片在一个客户机中顺序执行；跨实例矩阵按目标执行并保留每个目标结果。分支预览是真实的独立 Git worktree，删除时拒绝移除脏工作树；自动部署和浏览器入口尚未包含在此操作中。

缓存由显式输入文件哈希和命名空间定位，调用者需把影响构建的源码/锁文件作为输入；恢复到新目录并逐文件校验。目录版本和构建缓存共用每项目最多 100 个版本的保留上限。环境重建导出当前 Git 提交并实际安装识别到的锁文件依赖，保留原项目；系统软件包锁定使用本批的 `reproducible-env` 操作。

行级评审、入门清单使用本地成员标签，不提供身份认证或团队权限。PII 为规则扫描，输出类型和位置，不输出匹配值。SLO 和错误预算以已完成任务为样本，无样本时显示未知；容量结果为当前资源估算。事件时间线关联已记录任务及资源告警，不补造过去未记录的事件。

指标文件遵循 [Prometheus 文本格式](https://prometheus.io/docs/instrumenting/exposition_formats/) 和 [OTLP JSON 示例结构](https://github.com/open-telemetry/opentelemetry-proto/blob/main/examples/metrics.json)。编辑器档案只生成当前实例的 SSH 参数，重启导致端口变化后应重新生成。

## 签名实例包策略

镜像库和实例快照页新增“签名实例包”。首次启用时生成本机 Ed25519 签名密钥，并自动信任对应公钥；可粘贴另一台 Sakura 的公钥加入信任列表。启用期间导出的 `.sakura` 包对规范化清单（包含磁盘 SHA-256）签名。外部明文和加密包导入先完成磁盘哈希、QCOW2 与签名校验，再检查当前信任列表并发布实例；策略变更与发布串行，撤销信任不会与正在发布的导入交错。停用严格导入后仍验证带签名包的签名。已有本地备份和黄金镜像不受严格外部导入策略阻断。

签名只证明包清单来自受信任密钥，不能替代对源实例内容的检查，也不加密磁盘或包内的实例控制凭证。签名私钥保存在本机快照插件的数据文件中，不随 API 响应或实例包导出；迁移到其他宿主前需在目标宿主添加签名公钥。真实 `npm run test:signed-bundles` 已验证旧包拒绝、签名包导入启动、文件保留与首次启动控制身份轮换。

新增签名字段仍使用现有 `SAKURA01` 格式；较早版本若严格拒绝未知清单字段，可能无法导入新签名包。迁移至旧版本前可临时停用严格导入并重新导出无签名包，仍须独立保护和校验该文件。

## 宿主硬件兼容矩阵

能力中心的“硬件兼容矩阵”现在执行 QEMU `-device help`、`-accel help` 和 `-machine help` 探测，显示 Q35、TCG、WHPX、Virtio/e1000 网卡、随机数、内存气球和内存热插拔设备。WHPX 还使用服务启动时的暂停虚机探测结果，区分编译进二进制与宿主真正可用。报告逐项比对当前实例选择的加速器、网卡和设备，并指出缺失设备或 CPU/NUMA 配置冲突。矩阵描述宿主与 QEMU 能力，不推断客户机驱动是否正常；真实 `npm run test:hardware-matrix` 已在本机 QEMU 11.1 完成探测。

## 通用镜像导入

镜像库新增“导入其他镜像”，可上传 RAW、独立单文件 VMDK、VHDX 或单磁盘 OVA。服务流式计算 SHA-256，可按用户提供的预期值拒绝损坏或错误文件；上传不超过 8 GiB，虚拟容量最大 128 GiB。低于所选发行版最低容量的源磁盘自动扩容，并将客户机文件系统标记为待扩展。OVA 校验 TAR 条目与 OVF 文件引用，只提取单个 VMDK 到受控临时目录。QEMU 转换为独立 QCOW2 后再次检查容量、外部依赖、加密与文件头；成功后复制为新实例，生成新的 SSH 密钥和 NoCloud 种子，清空端口转发。失败或取消时清除临时文件，不发布实例。

该入口面向与 Sakura 首次启动配置兼容的 Alpine、Debian、Ubuntu Linux 云镜像，需按源镜像选择发行版；不承诺启动任意操作系统或没有云初始化代理的已有虚拟机。实例包 `.sakura` 仍由原导入入口恢复。接口为 `POST /api/image-import?name=...&format=raw|vmdk|vhdx|ova&distro=alpine|debian|ubuntu&memoryMiB=...&cpus=...`，请求体是二进制文件，可附 `sha256` 查询参数；响应包含新实例与源文件哈希。

## UEFI 与 OVMF 固件

实例创建、停止状态下的资源配置和通用镜像导入现在可选择 BIOS 或 UEFI。能力中心会检查本机 QEMU 目录中的 x86_64 OVMF 代码与变量模板；缺失时拒绝保存 UEFI 实例配置。UEFI 实例首次启动时在自身目录生成独立 NVRAM 文件，后续重启沿用该文件，QEMU 通过只读代码 pflash 和可写变量 pflash 启动。切换固件不转换现有磁盘分区或引导程序；未启用可信启动的普通 UEFI 实例在包导出与克隆后会从模板重新生成 NVRAM，自定义 EFI 启动项可能需要重建。启用 TPM 与安全启动时，新的备份、导入和克隆会保留其安全 NVRAM 与 TPM 状态。

## 虚拟磁盘加密

在“开发 → 私密配置”给目标实例保存 16–256 字符的口令，然后停止实例并删除或导出其内部快照。在第二批能力中心运行“虚拟磁盘加密”，参数为 `{"secretName":"口令名称"}`。Sakura 将原 QCOW2 转换为 LUKS 加密的独立 QCOW2，校验加密格式、镜像完整性和逐扇区内容后发布；转换期间原盘保留，发布后删除应用创建的明文恢复硬链接。中断后服务启动时检查事务标记，清理未发布的转换文件，或补登记已经发布的加密磁盘。实例元数据仅保存口令名称，实际口令由 Windows 当前账户的 DPAPI 私密配置保存；QEMU 启动读取临时口令文件，在 QMP 就绪后删除。

加密实例可启动、创建/恢复/删除内部快照、扩容、执行 QCOW2 完整性检查、克隆，以及导出加密的独立实例包。备份、黄金镜像和迁移沿用实例包，因此磁盘部分保持加密。导入另一主机后，需为新实例保存同名口令才能启动；同机克隆会复制其私密配置。实例包清单中的 SSH 控制密钥和初始化镜像仍是明文，实例包本身应独立保护。离线磁盘重建、只读救援和快照文件差异目前拒绝加密实例，避免产生明文临时镜像；客户机 TRIM 仍可使用。更改已加密磁盘的私密配置值不会重新加密磁盘，只会使错误口令无法解锁。

此功能保护当前实例磁盘文件中的客户机数据，不宣称清除旧明文磁盘、旧备份、SSD/QCOW2 历史块或宿主机临时文件的可恢复痕迹。加密前存在的明文副本需单独管理。`npm run test:disk-encryption` 使用真实 QEMU 验证转换、快照、扩容、克隆、导出/导入和 Alpine 启动。

## 验证

临时隧道项目绑定批次：临时 TCP 入口按项目分开开启、查询和关闭，私有项目经 SSH 连接各自的网络空间，不加载项目环境或密钥；每次连接核对项目绑定与实际接口、路由。入口存续期间保护项目目录和网络模式，创建和关闭中的操作也受保护，服务关闭取消并等待准备完成。中继修复二进制半关闭响应被截断及五秒空闲超时，已完成的创建请求与入口自身生命周期分开。真实 Alpine、Debian、Ubuntu/QEMU 验证共享项目与两个私有项目使用同一客户机端口的实际分离、能力任务上下文、配置保护、256 KiB 二进制响应、空闲连接、额外路由拒绝、请求取消后的独立寿命、到期和暂停撤销；专项测试覆盖关闭中的准备取消与资源释放。旧能力测试替身补齐配置保护接口后，完整 Node 回归 700 项中 699 通过、1 项 Linux 宿主测试跳过。生产构建、32 个插件契约、分发、6 种编译版插件组合和发布包 202 个文件 SHA-256 校验通过。三个未完成目录条目仍保留部分实现。用法见 [临时反向隧道](reverse-tunnel.md)。

受限命令项目隔离批次：系统调用隔离工具的 `run` 模式使用所选项目的目录、环境与实际网络命名空间，并遮盖私密输出；准备与策略探测不导出项目环境。固定系统 Python 以隔离模块加载模式运行 seccomp 执行器，项目 PATH 或 PYTHONPATH 不会替换它，但仍传给所选命令。执行器处理启动时的信号竞争，取消、超时和正常退出后清理受限命令进程组及同组后台子进程；保留普通退出码并将信号退出转换为惯用的 128 加信号编号。真实 Alpine、Debian、Ubuntu/QEMU 验证策略继承、活动项目、实际网络空间、目录和环境、双向输出遮盖、字面参数、执行器路径和模块保护、额外路由拒绝、超时、取消、后台子进程清理及退出码。完整 Node 回归 698 项中 697 通过、1 项 Linux 宿主测试跳过，最终执行器修改后专项测试及三发行版实测再次通过；生产构建、32 个插件契约、分发、6 种编译版插件组合和发布包 202 个文件 SHA-256 校验通过。三个未完成目录条目保留部分实现。用法见 [项目命令执行](project-execution.md)。

Agent 命令项目隔离批次：单次 SSH/GPG Agent 转发命令沿用所选项目的目录、环境及网络模式，输出遮盖密钥。共享网络中的依赖准备不加载项目环境；实际接口和路由不符时拒绝执行。SSH 保留该次转发连接提供的套接字，GPG 使用受保护的临时主目录；请求不能通过项目环境替换这些路径。命令进入独立进程组，取消和超时后结束进程组并关闭转发，GPG 另清理临时目录；执行和清理期间保护实例操作及项目配置。真实 Alpine、Debian、Ubuntu/QEMU 验证两个协议的模拟宿主 Agent、私有网络、项目目录和环境、密钥遮盖、保留路径、额外路由拒绝、命令失败及取消后的 shell/子进程和临时目录清理，未使用真实宿主私钥签名。专项测试另验证保存的活动项目和显式默认项目不会混淆、转发只传给执行连接、准备与清理连接不接收项目密钥。完整 Node 回归 697 项中 696 通过、1 项 Linux 宿主测试跳过，编译版 Alpine API/SDK/CLI 与真实 Chromium 复查、生产构建、32 个插件契约、分发、6 种编译版插件组合及发布包 SHA-256 校验通过。网络隔离、普通进程剪贴板策略和真实外部 HA 演练仍有剩余范围，三个目录条目保持部分实现。用法见 [项目命令执行](project-execution.md) 和 [GPG Agent 转发](gpg-agent-forward.md)。

命令执行项目隔离批次：基础 `/exec`、生成的 SDK 和 CLI 默认按保存的活动项目运行，支持显式项目选择，进入项目目录并在其网络空间内加载环境与私密配置，输出遮盖密钥。实例维护需明确使用 `instance` 范围；CLI 支持账户令牌、字面参数、退出码和超时，交互 shell 支持项目选择。取消、断开和超时通过独立 SSH 清理命令进程组，运行期间保护实例操作及项目绑定；停用项目插件仍解析保存的配置与启用的密钥服务。真实 Alpine、Debian、Ubuntu/QEMU 和编译版服务验证 API/SDK/CLI 的实际网络空间、目录、环境、遮盖、参数注入拒绝、退出码、超时和取消后的 shell/子进程结束、账户权限及插件停用后的控制器恢复；真实 Ubuntu 额外验证 CLI 交互 shell 在共享和私有项目中的空间及目录。完整 Node 回归 695 项中 694 通过、1 项 Linux 宿主测试跳过，4 个相关浏览器场景、32 个插件契约、生产构建、分发及 6 种编译版插件组合检查通过。发布包包含新增 CLI 模块。独立 SSH、普通 KDE、部分扩展及自行启动进程的网络约束、普通 Windows/Linux 进程剪贴板策略与真实外部 HA 演练仍未完成，三个目录条目继续保持部分实现。用法见 [项目命令执行](project-execution.md)。

普通终端项目隔离批次：网页终端、tmux 恢复和只读分享统一绑定保存的工作项目及网络模式，所有窗格进程的实际网络空间都会在恢复时复核。标签、选中项、分屏和停止状态按项目保存；停止项目终端只结束本项目会话，刷新不会自动重建。运行连接、后台 tmux 会话和暂停实例会阻止改变目录或模式，停用项目插件也不放宽配置。分享授权另绑定该次运行会话的随机标识，停止后同名重建需要重新授权。真实 Alpine、Debian、Ubuntu/QEMU 与编译后的 HTTP/WebSocket 服务验证了共享与私有项目、历史恢复、默认分屏继承、错误窗格和新增路由拒绝、只读输入拒绝、撤销、同名重建、按项目清理、暂停保护及控制器重启后的插件停用；三个发行版的真实 Chromium 还验证了只读查看器的项目参数及服务端就绪状态。完整 Node 回归 692 项中 691 通过、1 项 Linux 宿主测试跳过，另有布局、加载等待、持久停止、项目切换、手机宽度和剪贴板浏览器场景，生产构建、分发、32 个插件契约和 6 种编译版插件组合检查通过。真实外部 HA 演练、普通 Windows/Linux 进程剪贴板策略、独立 SSH/管理执行接口及其他未覆盖网络入口仍未完成，三个目录条目保持部分实现。范围见 [项目终端与只读分享](project-terminals.md)。

单应用项目隔离批次：图形窗口沿用启动项目的网络模式，私有窗口的 Xvnc、Openbox、程序及子进程进入仅回环的项目命名空间，浏览器 SSH 桥接复核并进入同一空间。窗口使用独立 Linux 用户、受保护的 X11 凭据、随机 VNC 密码及 IPv4/IPv6 用户防火墙，隔开其他受管窗口和共享 KDE 的回环图形端口。启动失败不会覆盖第三方规则，第二组防火墙创建失败会回滚；停止和自然退出按独立用户清理进程，通过内核进程句柄避免 PID 复用，并保留应用主目录。服务关闭时逐个清理同一实例的窗口，避免操作锁冲突导致遗漏。运行、暂停和项目配置变更均有保护，暂停后的窗口可恢复。真实 Alpine、Debian、Ubuntu/QEMU 验证进程命名空间、独立用户与文件权限、密码认证、用户防火墙、失败回滚、剪贴板收紧和停止清理；真实 Chromium 验证私有及共享窗口的 noVNC 认证和剪贴板控件，真实 Debian 还验证同时关闭两个窗口后的端口与规则清理。完整 Node 回归 687 项中 686 通过、1 项 Linux 宿主测试跳过，另有窗口界面与剪贴板浏览器场景、生产构建、分发、插件和编译版服务验证。普通 Windows/Linux 进程策略、普通管理员终端及真实外部 HA 演练仍未完成，未将三个目录条目标为完成。范围见 [单应用窗口](single-app-windows.md)。

私有项目交互环境批次：Notebook 和认证浏览器 IDE 现在可在项目网络命名空间内运行，宿主使用回环 SSH TCP 桥接提供浏览器入口，不创建 QEMU 映射或客户机网络接口、路由。Notebook 二进制依赖在共享网络预取，项目虚拟环境在命名空间内离线安装。真实 Alpine、Debian/QEMU 验证 Marimo、JupyterLab 的安装与认证、桥接恢复，以及 Jupyter WebSocket 内核实际处于私有命名空间且无法访问共享网络；真实 Debian/QEMU 验证 code-server 发布包摘要、错误缓存拒绝与有效缓存安装、正确与错误密码、进程命名空间、桥接恢复和到期清理，真实 Chromium 操作还核对了集成终端继承同一项目命名空间。项目网络隔离仍为部分实现，普通管理员终端、自行启动进程与其他扩展的限制尚未完成。

项目网络隔离跨发行版验证批次：相同的真实虚拟机脚本在 Alpine、Debian 和 Ubuntu 中验证独立命名空间、无路由、初始化、服务、收藏命令、流水线与停止清理。后续新增显式项目隔离终端，仍不限制普通管理员终端或客户机自行启动的进程，见 [项目网络隔离](project-network-isolation.md)。

Virtio-FS 检查批次：第三批能力中心可分别检查 QEMU 文件系统设备、共享内存后端、virtiofsd 和客户机实际文件系统挂载。Linux 宿主已接通侧车进程、启动设备与客户机自动挂载；真实 Alpine、Debian、Ubuntu 客户机验证宿主文件读取、只读拒写和可写模式将客户机文件写入宿主。Windows 可通过 WSL Linux 后端使用，目录在支持后端上列为可用；随附 Windows QEMU 仍缺少文件系统设备和共享内存后端，范围见 [Virtio-FS 共享目录](virtio-fs.md)。

故障接管检查批次：第三批能力中心可保存目标主机、故障阈值和副本时效策略；后台每 15 秒观察本机主实例状态，持久记录连续故障样本，主动停止或暂停时撤销监测；手动检查源实例状态、目标资源与平台，以及已校验副本的实时回执和数据时效。本机 QEMU 进程退出接管只接受当前控制进程已观察过的运行实例，先持久封锁来源，再以独立入站权限请求目标启动；目标处于“正在启动”时保持来源栅栏，客户机进入运行状态后才记录已接受；退出接管先持久封锁已停机的目标。独立见证程序另实现宿主失联后的隔离、应用检查和切流协议，已增加真实客户机联测；外部第三节点、BMC 与生产流量的故障演练尚未完成，故仍保留部分实现状态。范围见 [故障接管策略与健康检查](ha-failover-check.md)。

独立应用剪贴板批次：Linux 单应用弹窗接入现有远程桌面剪贴板策略，收发、敏感文本、实例覆盖与跨标签收紧均作用于该窗口；发送缓存被禁用时重连 noVNC。该规则仍是浏览器桥接策略，不限制客户机内其他进程。细节见 [网页应用剪贴板策略](clipboard-policy.md)。

独立应用窗口现在还能在创建时分别禁用复制到宿主与粘贴到应用。限制写入该窗口的 Xvnc 会话，`vncconfig` 无法在会话内重新开启；真实 Alpine、Debian、Ubuntu 客户机验证了限制窗口与同实例默认窗口的参数彼此独立，浏览器场景验证启动请求与会话展示。客户机其他应用进程的系统剪贴板仍不受该限制，因此目录保持“部分实现”。

在线迁移批次：第三批能力中心从源 QMP 和已配对目标的最新资源观测生成检查结果，报告平台、容量、来源状态与硬件阻断；通过后可提交后台运行任务。受支持的同平台 TCG 实例完成磁盘与内存迁移、目标客户机就绪及来源停机；结果中的 `executed` 仅在这些步骤完成后为真。范围见 [在线迁移检查与执行](live-migration-plan.md)。

单应用窗口批次：Alpine、Debian 和 Ubuntu 桌面页可为每个图形程序启动独立 Xvnc 显示器，通过有权限校验的桌面 WebSocket 在独立浏览器弹窗中操作，并支持重开与停止；令牌经同源消息交接，主控制页关闭后弹窗仍可继续。三个发行版的真实虚拟机均已验证两个会话端口相互独立、RFB 握手和停止清理；浏览器测试覆盖启动与停止。当前并非 Windows 原生单应用窗口。范围见 [单应用窗口说明](single-app-windows.md)。

可信启动批次：第二批能力中心可检查安全版 OVMF、QEMU SMM/TPM 后端、`swtpm` 和客户机实际 SecureBoot/TPM 状态。Linux 宿主现在可为 Debian/Ubuntu UEFI 实例编排持久 swtpm 与预登记密钥的 OVMF；真实 Debian 和 Ubuntu 虚拟机已验证安全启动与 TPM 2.0。Ubuntu 签名引导链首次登记 EFI 启动项所需的复位可在 QEMU 内完成，初始化后恢复客户机重启即停止的策略。便携备份、导入和克隆可保留 TPM/NVRAM；新建停机磁盘快照也会保存对应状态，真实 Debian 和 Ubuntu 客户机完成回滚和历史导出后再启动。Windows 可通过 WSL Linux 后端使用，目录在支持后端上列为可用；随附 Windows QEMU 仍缺少 TPM 后端。边界见 [TPM 与安全启动](trusted-boot.md)。

项目网络隔离批次：项目设置新增仅回环的独立 Linux 网络命名空间；托管项目脚本、服务、健康检查、流水线、收藏命令、工程执行器、显式项目终端、代码诊断、语言服务、调试适配器和开发工具任务进入该命名空间。命名空间出现额外接口或路由时托管命令会拒绝执行，真实 Alpine、Debian、Ubuntu 客户机验证双项目分离、路由拒绝和清理；额外的 Alpine 客户机实测了私有网络中的 TypeScript/Python 语言服务、跨文件重命名及 debugpy 调试进程。按锁文件安装依赖在私有模式下运行，需联网下载时会失败；依赖可在共享网络预取后离线安装。数据库容器因无法保证隔离而被拒绝。普通管理员终端与客户机自行启动的进程仍可使用共享网络，因此目录保留“部分实现”。范围与操作见 [项目网络隔离](project-network-isolation.md)。

OIDC 与 SAML 单点登录批次：账户模式下，管理员可登记 HTTPS OIDC 提供商或导入 SAML IdP 元数据，已有账户自行绑定后使用外部身份登录；解绑或配置更换撤销关联会话。实现约束、回调地址与 IdP 兼容范围见 [单点登录说明](sso.md)。模拟 OIDC 发行方与签名 SAML IdP 的协议测试覆盖绑定、登录、重放、错误接收地址及撤销；账户 HTTP/浏览器冒烟测试覆盖 SAML 弹窗绑定和登录。尚未与外部托管 IdP 实测。

第三方事件插件批次：已安装且签名有效的 WebAssembly 插件可订阅任务完成和告警事件，按设定周期自动运行，并在签名目录中声明固定的管理员 HTTP 操作与纯表单面板。后台持久保存去重状态与最近结果，重启后恢复尚未完成的触发任务。测试覆盖签名扩展篡改拒绝、新旧事件筛选、重复事件、定时触发与重启恢复。协议见 [第三方插件](community-plugins.md)。

硬件声明批次：第三批能力现在可以只读预览 USB VID:PID 与 PCI BDF，Linux 上检查 PCI IOMMU 组及 VFIO 绑定；在运行中的客户机检查 NVIDIA/ROCm 工具和设备节点；按实例登记公钥指纹并计算轮换到期提醒。以上操作不代表 PCI/GPU 已实际直通或 vTPM 已创建。边界和参数见 [硬件声明与检查](hardware-readiness.md)。

服务网格边车批次：按实例和项目保存仅监听环回的 Envoy TCP 代理策略；配置验证和代理进入项目网络，状态核对实际进程、目录、网络、会话及配置摘要，停止和取消清理所属代理。Debian、Ubuntu 已完成真实 Envoy 代理流量与恢复验证；Alpine 当前只验证官方二进制兼容性失败时的拒绝。使用条件见 [项目 Envoy 边车](service-mesh.md)。

第三方插件批次：插件中心现在可添加受信任的 Ed25519 发布者和 HTTPS 目录，下载并安装签名 WebAssembly 插件，立即执行或卸载。安装和运行均校验签名与文件 SHA-256；无宿主导入的工作线程限制内存、时间、输入、输出及并发。单元测试运行真实 WebAssembly 模块，并验证目录元数据篡改和文件篡改被拒绝。扩展输入输出仍只限 JSON；协议和发布格式见 [第三方插件](community-plugins.md)。

客户机内存压力自动回收：为运行中的实例保存最低内存目标，后台按 `MemAvailable` 采样，持续空闲时逐步降低 Virtio 气球目标，压力升高时恢复，并保留最近决策。真实 QEMU/Alpine 与单元测试分别验证了气球调整、恢复判定和策略持久化。使用方式与边界见 [内存自动回收](memory-reclaim.md)。

宿主目录挂载批次：按实例保存宿主绝对路径及只读策略，用仅限 SFTP 的本地 SSH 服务和客户机 SSHFS 挂载到 `/mnt/sakura-host`；实例重启后自动恢复，停用时卸载并关闭服务。真实 QEMU/Alpine 验证了双向读写、只读拒绝、重启恢复与卸载；协议级测试覆盖目录边界。使用方式与限制见 [宿主目录挂载](host-mount.md)。

发行版包管理器批次：已安装、软件源搜索和可升级列表在界面中分页显示；安装、卸载、单包升级和全部升级先模拟计划再以一次性令牌提交，执行进度仍使用任务日志。真实 QEMU/Alpine 验证列表、预览、安装与卸载，真实 Debian 验证 APT 列表。使用方式见 [发行版包管理器](package-workbench.md)。

快照分支合并批次：从明文快照克隆时保留独立基线；快照页可预览三方文件差异，并把无冲突的文件与符号链接变更应用到来源实例的新副本，记录合并来源。真实 QEMU/Alpine 验证了冲突拒绝、临时克隆清理、新实例启动、文件删除与链接、原盘不变。范围与限制见 [快照分支合并](snapshot-merge.md)。

UEFI/OVMF 批次：439 项 Node 测试、50 个浏览器场景、生产构建、分发检查与 6 种编译后插件组合通过；真实 `npm run test:uefi` 验证 Debian 客户机从 OVMF 启动、NVRAM 持久化和再次启动。新增包测试验证 UEFI 选择在导出、导入与克隆中保留。

通用镜像导入批次：435 项 Node 测试、49 个浏览器场景、生产构建、分发检查与 6 种编译后插件组合通过；真实 `npm run test:image-import` 验证 RAW、VMDK、VHDX、streamOptimized OVA 和小容量云镜像均可导入并启动。一次与 QEMU 并行的浏览器全集运行中 Chromium 新页面崩溃，QEMU 结束后单进程重跑 49/49 全部通过。

签名实例包批次：428 项 Node 测试、47 个浏览器场景、生产构建与分发检查、6 种编译后插件组合通过；真实 Alpine 虚拟机的签名包导入和启动通过。

硬件矩阵批次：`npm run verify` 全部通过，包括 431 项 Node 测试、48 个浏览器场景、生产构建、分发检查与 6 种编译后插件组合；另使用真实 QEMU 执行 `npm run test:hardware-matrix`。

资源与告警批次：328 项 Node 测试、生产构建、分发检查、插件契约和 5 种生产插件组合全部通过。并行浏览器测试中两次新建页面遇到浏览器进程崩溃，随后单进程重跑全部 23 个场景均通过。真实存储和监控验证分别使用 `npm run test:storage`、`npm run test:observability`。

备份去重批次：320 项 Node 测试、21 个浏览器场景、类型检查与生产构建、5 种插件组合的生产服务检查全部通过。新增测试覆盖跨实例块复用、损坏块与清单拒绝、下载末尾校验失败、取消、并发删除与回收、备份策略持久化及真实虚拟机恢复。新增浏览器场景发现并修复备份插件重复声明快照页、导致页面无法加载的问题。

第二批：全部 Node 回归、类型检查、生产构建、分发检查、32 个插件契约及 5 种插件组合的编译后服务检查通过。20 个浏览器场景完成验证；全量运行中同步选择框的可访问名称问题修复后，定向复测通过。真实 Alpine 的 38 项执行器测试通过，另验证内存热插拔、CPU 不兼容前置拒绝、工作树切换、取消与应急锁定。审计测试覆盖并发写入、重启恢复、改写、截断、伪造封印、父子链路及请求体不进入日志。

新增回归覆盖实际文件写入、重启后的续传、损坏分块、完整结果持久化、失效 Git 版本、合并冲突、缓存指纹、脏工作树保护、时间窗、离线队列、保留锁和失败退出码。真实 Alpine 虚拟机已通过 19 项原工程执行器测试与 15 项新增执行器测试，并通过实际 API、工作树项目切换、取消子进程、提交检查和应急锁定验证。

本轮 `npm test` 全部 301 项通过；19 个浏览器场景已全部通过（完整运行中的两处新增测试定位问题修正后定向复测通过）。生产构建、插件契约与不同插件组合的编译后服务检查均通过。完整自动化验证命令为 `npm run verify`；客户机执行器验证为 `npm run test:engineering`。
