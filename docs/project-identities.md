# 持久项目账号与固定启动器

`server/project-identity.ts` 提供项目账号登记、核对、运行票据、停止和绑定变更接口。此批是后续迁移项目执行入口的基础；现有主命令、服务、普通终端、系统 SSH、cron 与用户管理器尚未全部改为使用这些账号，网络隔离总功能仍为部分实现。

## 账号与目录

客户机在 root 管理的 `/var/lib/sakura/project-identities` 保存登记表。每个项目固定一组 UID/GID、账号、身份 UUID 和修订号，先持久保留分配意图，再建立系统账号与独立 home。分配中断后复用已保留的身份，UID 不分配给另一个项目。登记同时核对 passwd、group、补充组、home 以及目录设备号和 inode，不接管同名但已替换的账号或目录。

home 位于 `/var/lib/sakura-project-homes/<identityId>`，叶目录为该账号所有且权限 `0700`，父目录由 root 管理。已有项目目录不会自动递归改属主，也不会放宽 `/root`。控制器用真实项目 UID 核对父目录可遍历和项目目录的读、写、执行权限；不足时返回 `PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED`，需要先明确迁移目录权限，再重试同一登记。

`ensure` 可携带先前保存的登记表、身份 UUID 与修订号；预期身份不符时拒绝。`rebind` 必须提供当前身份，确认旧运行全部停止后，才将新目录或网络模式发布为下一修订。宿主调用者仍需保存并保护自己的预期身份记录；此接口不能代替所有上层生命周期保护。

## 运行归属

独立运行准备专属 `sakura-identity-<runId>` cgroup v2，固定当前 boot ID、网络命名空间和 cgroup 的设备号及 inode。私有网络只允许本项目派生的 `sk-<projectId>`，核对仅回环接口和无路由。准备回执丢失可用相同 run ID 重试；关闭的票据不能再次开放。

`inheritedCommand` 用于已经进入 Sakura 短任务、主命令或服务 cgroup 的 root 启动器。控制器从自身真实 cgroup 成员关系取得上层归属，调用者不能传入任意 cgroup 路径；C 启动器核对固定域后保持成员关系，不把项目命令移出原有清理范围。关闭继承票据只关闭入口，上层域负责清理进程。

固定 C 启动器读取 root 管理的二进制记录，不以项目提供的 JSON、UID、命名空间路径或 FD 编号决定权限。非 root 调用按真实 UID 查找唯一项目登记，不能选择另一个账号。进入已核对的网络与 cgroup 后，清空补充组、丢弃 UID/GID 和 capabilities，设置 `no_new_privs`，然后才载入项目环境并执行命令。项目环境不能替换 `HOME`、`USER` 或 `LOGNAME`。

当前基础 API 以启动参数传递命令与环境，继承入口的 base64 JSON 也没有保密性。在默认 `/proc` 挂载下，其他 UID 可能读取进程命令行；登记文件不持久保存这些正文，不等于运行时运输已经保密。接入含密钥的产品执行入口前，还需改用受保护的有界 FD/标准输入传输，并避免把内联命令正文放入最终 shell 的 `-c` 参数。此批未把这些 API 接入已有项目密钥执行路径。

独立停止先关闭票据，再清理准确的 cgroup，确认空域和移除；回执丢失可重试。身份替换、控制连接失败或清理未确认时保留记录并报告错误，不按账号名称或目录猜测并终止其他进程。客户机 root 仍能修改这些设施，实例管理入口仍是管理员能力。

## 分发与验证

生产资产包含 `protocol.h`、`launcher.c`、`controller.py` 与第 1 版清单。构建、运行时安装及分发检查核对每项大小、SHA-256 和整体摘要；运行时只读随包资产，不回退到开发源码。客户机安装使用干净环境，在受保护版本目录编译固定启动器。

客户机需要 Python 3、C 编译器、iproute2 和发行版 shadow 账号工具。Alpine 用官方 `shadow` 软件包的固定命令，三发行版都采用显式 UID/GID 的 system account 建立方式，不依赖某个版本才支持的 login.defs 设置。运行准备在 Alpine 启动原生 cgroups 服务，并核对实际 cgroup v2 挂载，不以测试目录或普通文件代替。

单元与实机入口分别为 `tests/project-identity.test.ts` 和 `npm run test:project-identity -- alpine|debian|ubuntu`。实机使用独立数据目录与虚拟机；具体通过范围、源摘要和回执见 [功能实现记录](capability-completion.md)。这些验证不表示普通系统 SSH、cron、用户管理器及全部扩展调用已完成迁移。
