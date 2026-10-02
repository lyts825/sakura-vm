# 项目首次 Git 检出

项目配置保存 HTTPS 仓库地址后，初始化和启动会先在项目账号内核对目录。已有 `.git`（包括 worktree 使用的文件）直接复用，不下载或自动更新。首次检出要求目录为空；原有文件、悬空 `.git` 链接和其他对象不会由下载控制器删除或接管。客户机回环测试地址可使用 HTTP，其他地址必须使用 HTTPS，地址不能携带用户名、密码、查询令牌或片段。

私有项目也可以首次检出。下载器在客户机共享网络中使用系统 Python 与系统 Git，仅下载固定仓库的对象数据；项目账号在原目录和原私有命名空间内验证 bundle 摘要并检出。初始化命令随后继续在项目账号与项目环境内执行。系统下载器不进入项目目录，不加载项目 home、Git 配置、凭据助手、环境变量、导入路径、模板、过滤器或钩子。

在“开发设置 → 私密配置”保存只读 Git 凭据，再在“网络配置 → 项目依赖与 Git 认证预取”填写 Git 下载端点、Bearer 或用户名密码方式及凭据名称。预览并应用档案后生效，只保存档案不启用认证。配置示例：

```json
{
  "dependencyDownloads": {
    "git": {
      "kind": "bearer",
      "endpoint": "https://git.example.com/team/",
      "tokenSecret": "git-reader"
    }
  }
}
```

只有协议、域名、端口和目录均匹配的仓库解析该凭据。范围外的公共仓库尝试无认证下载，不读取这份秘密。下载器只转发准确仓库的 `info/refs?service=git-upload-pack` 和 `git-upload-pack`，不提供推送、任意对象路径、代理其他地址或交互登录。上游必须支持 Git smart HTTP；重定向会拒绝，请保存最终仓库地址。请求正文不超过 1 MiB，引用广告不超过 8 MiB，单个响应和交付 bundle 不超过 512 MiB，上游正文合计不超过 1 GiB，最多 64 次请求、4 个并发连接，下载操作限时 480 秒。

下载凭据与固定代理源码通过受保护的、有界标准输入传递；凭据不进入 SSH 参数、Git 参数、项目环境、工作树或仓库配置。代理读入独占的 root/0600 请求文件后立即删除，系统 Git 仅连接带随机 nonce 的临时回环入口。上游错误正文、Cookie 和 Location 不转发到 Git 或项目日志。

回环 URL 可能出现在其他账号可读取的进程参数中，因此 nonce URL 本身不授予下载权限。Git 使用另一枚本次随机客户端令牌，通过 [Git 的 `--config-env`](https://git-scm.com/docs/git) 从仅 root 可读取的进程环境提供给回环入口；入口逐请求核对，令牌不转发到上游。上游 Bearer/Basic 凭据仍只保留在系统 Python 内存中。

对象核对后仅将只读 bundle 和空模板授予准确项目 GID，其他项目账号/UID 无法读取；目录仍由 root 管理且项目不能修改来源。项目内使用清空配置的 Git 核对摘要和 HEAD，保留远端默认分支，`origin` 保存原仓库地址。空仓库由项目账号初始化。首次检出不自动下载子模块或执行 LFS 等配置的过滤器；需要这些操作时在项目初始化命令中明确运行，它们仍受项目网络模式约束。后续 fetch/pull/push 使用项目已有 Git 工作台入口，本预取入口只负责首次检出。

宿主在下载前保存原 boot、项目账号、任务 UUID、源码摘要和随机归属记录。取消、失败和 SSH 中断后先确认本次下载 cgroup 不存在，再核对准确 root 目录、归属回执和文件身份并清理。项目任务清理未确认时保留下载记录和资源，不推断成功；重试先核对并恢复原任务。真实重启后仅核销已消失的原 `/run` 资源，不能清理新 boot 的同名对象。检出入场同时固定 live 对象和原 boot，旧下载不能授权新 boot 的项目代码。Git 检出中断可能留下 Git 自身的工作树状态，需在项目账号内检查后再继续。

`npm run test:project-repository -- --describe` 显示测试合同；`npm run test:project-repository -- --run-new alpine` 在全新 Alpine/QEMU、独立基础镜像副本和新 SSH 身份中验证真实项目初始化、经过审阅的目录迁移、认证下载、私有检出、主命令停止、既有/非空/空仓库、错误反射、重定向和取消清理。测试使用自己的回环 Git 服务，不调用用户私有仓库；结束后停止本次实例并保留证据。Python 单元夹具另运行真实系统 Git 的 HTTP 和 bundle 流程，不把它视为客户机权限或 cgroup 的证明。

普通终端、项目 SSH、cron、用户管理器及全部扩展的项目账号迁移仍未完成，网络隔离整体保持部分实现，见 [未完成功能](unfinished-features.md)。

Alpine 实机测试服务额外安装 `git-daemon` 提供 `git-http-backend`；该拆包见 [Alpine 官方打包脚本](https://raw.githubusercontent.com/alpinelinux/aports/3.23-stable/main/git/APKBUILD)。产品中的下载客户端只需要 `git`。
