# 项目主命令的运行归属

没有配置 `services` 时，项目的 `command` 使用独立 `main` 运行记录。它与普通服务共用持久 cgroup v2 引擎，但主命令的第 2 版记录、目录、会话、日志和绑定摘要分别保存，不占用任何服务名称。已有第 1 版服务记录保持兼容。

## 启动与停止

启动先用固定、无项目环境的命令准备 Python 3 和 tmux，并检查现有归属。同配置已经运行时直接返回，不重复初始化项目。未确认的准备、仍待清理的已退出主进程或未知旧会话均拒绝重新启动。

项目初始化继续使用有限时限的短任务，并与主命令共用持久项目账号。主命令只在运行意图、完整 pane 身份及继承账号票据保存、实际进入所属 cgroup 后才提交执行。命令与环境通过受保护的独占帧运输，固定启动器检查原文件身份和完整正文，降权后运行只读 memfd 脚本，root 参数不包含正文。普通新进程组、`setsid` 和双重 fork 后代继续属于本次主运行。启动失败只回滚本次运行，控制连接失败会独立重试并保留未确认的记录。已有 root 目录需要明确 [目录迁移](project-directory-migration.md)。

私有项目的“停止项目”先登记固定网络代次与核销请求，冻结本代的新运行，再停止普通服务和主命令、核销全部账号票据，最后确认原命名空间没有进程并移除。删除或确认失联时保存原请求，重试不会跟随后来建立的新代次。只停止一个命名服务不影响主命令或整个项目网络。主命令清理必须匹配同一 live 实例、boot ID、run ID、cgroup inode 和 pane/PID 创建时间；不使用工作目录、命令参数或仅有会话名推断归属。

主进程退出后的顶层运行状态为 `exited`，归属仍保留。准备未提交、控制响应不完整或身份改变时显示 `unconfirmed`。公开运行响应保留 `{status,log}`，另有 `main.status` 表示实际的 `absent`、`prepared`、`running`、`exited`、`stopped`、`unconfirmed` 或 `unmanaged` 状态，不公开 PID 或运行令牌。

客户机完整重启后，停止会在同一客户机 live 和完整旧回执下核对当前 boot、旧运行目录、准确旧 cgroup 与保留会话。只有旧 boot 已结束且这些对象均不存在，才将旧记录确认停止，不向新开机的进程发送信号。同 boot 丢失记录、同路径替换域、新 owner 或同名新 pane 都不能据此被忽略或终止。

修改启动命令、环境、密钥、运行时、目录、网络或切换到多服务模式前，需要确认旧主运行已经停止。停止使用已保存配置，不提交面板内未保存的草稿；失败后草稿和待清理状态继续保留，支持再次停止。

暂停期间无法检查客户机的未知旧主会话，修改主运行绑定需已有完整、已确认停止的主命令记录。仅有已停止的服务记录仍不足以证明保留主会话不存在，需要先恢复实例核对；没有以空启动命令代替这项检查。目录和网络变更继续遵守整个项目的暂停与会话保护。

## 错误与旧会话

主命令错误码为 `PROJECT_MAIN_SCOPE_UNAVAILABLE`、`PROJECT_MAIN_SCOPE_CHANGED`、`PROJECT_MAIN_SCOPE_UNMANAGED` 和 `PROJECT_MAIN_CLEANUP_FAILED`。清理失败保留原记录；Job 记录具体错误码并遮盖已知密钥。即使用户取消或关闭服务，清理仍未确认也显示任务失败，不能只显示“已取消”。正常取消并确认清理仍记录为取消。

升级前已有的 `sakura-project` 或 `sakura-project-<projectId>` tmux 会话缺少完整归属。界面提示迁移，不能自动停止或重新接管它们；管理员需要明确核查并停止旧会话和实际后台任务，再从项目入口启动。旧版已完整登记的 root 运行可以按原回执停止，但不会直接视为新账号运行或重复执行。客户机管理员可自行移出 cgroup，仍不属于普通运行后代的清理保证。

单元回归见 `tests/project-main-scope.test.ts`、`tests/workspaces-main-scope.test.ts` 和 `tests/jobs-cleanup.test.ts`。三发行版原生命周期入口为 `scripts/smoke-project-main-scope.ts`，账号接入验证为 `scripts/smoke-project-uid-scopes.ts <已释放的自有 fixture>`。打包服务的新 HTTP/SDK 验证为 `scripts/smoke-project-identity-http.mjs <已释放的账号执行 fixture> <releaseRoot>`，要求默认 Node 路径和原始源码摘要一致。旧 `smoke-project-main-http.mjs` 的前置证明属于先前 root 运行批次，不能代替当前账号与目录迁移验证。
