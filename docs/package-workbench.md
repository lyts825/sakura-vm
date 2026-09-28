# 发行版包管理器

在“能力中心 → 软件包 → 发行版包管理器”查看客户机已安装包、搜索软件源和查看可升级包。列表按 50 项分页，可按名称筛选；搜索至少需要两个字符。“更新软件源索引”提交 `apk update` 或 `apt-get update` 任务。

安装、卸载、单包升级和全部升级首先使用发行版包管理器的模拟模式生成计划。界面展示完整计划，用户确认后再次模拟；若计划变更、实例重启或超过 5 分钟，必须重新预览。执行作为可取消任务提交，进度与错误显示在同页日志。Alpine 使用 `apk`，Debian/Ubuntu 使用 `apt-get`，常规升级遵循发行版的依赖与保留包规则。离线缓存操作仍在同页独立提供。

API：`GET /api/vms/:vmId/packages?mode=installed|search|updates&query=...&page=1&limit=50` 返回已解析列表；`POST` 支持 `preview`、`apply` 和 `refresh-index`。模拟计划令牌只在服务进程内有效且只能使用一次。软件包名称限制为普通包名，防止把 APT 的特殊后缀操作当成包名提交。

`npm run test:package-workbench` 在真实 Alpine 实例中校验索引、列表、搜索、可升级项目以及经过预览的安装与卸载；并在真实 Debian 实例中校验 APT 的三个列表视图。单元测试覆盖两种管理器的输出解析、一次性令牌、计划变化和实例重启失效。

命令行为以发行版文档为准：[Alpine Package Keeper](https://wiki.alpinelinux.org/wiki/Apk)、[Debian apt-get 手册](https://manpages.debian.org/testing/apt/apt-get.8.en.html)。
