# 项目命令执行

基础命令执行 API、生成的 SDK 与 CLI 默认使用实例保存的活动项目及其固定 UID/GID 和独立 home。命令进入该项目目录，加载项目环境变量及私密配置，并按保存的网络模式运行；私有项目进入仅回环的网络命名空间。正文通过有界标准输入运输，降权后执行已密封的只读脚本，root 参数不携带命令或环境正文。既有目录权限不足时须先核对并应用 [目录迁移](project-directory-migration.md)，不自动放宽目录权限。停用项目插件后仍遵守保存的项目配置，已启用的私密配置和网络服务仍参与环境解析。

`POST /api/vms/:vmId/exec` 接受 `command`、可选的 `scope` 和 `timeoutSeconds`。`scope` 默认 `project`，超时默认 30 秒，允许 1–3600 秒。通过 `?project=default` 或 `?project=<16 位项目标识>` 选择其他项目；省略时使用活动项目。响应包含 `stdout`、`stderr`、`code`、`scope`，项目命令还返回 `projectId`、`directory` 和 `networkIsolation`。项目私密配置值在标准输出和错误输出中被遮盖。

项目请求固定准备前的客户机 live 身份，并核对准备租约捕获的项目 ID、非枚举项目标识及配置摘要。环境只解析这份配置一次；配置、准备信号或运行身份改变会停止后续执行，不采用新配置或新实例。命令完成后复核原绑定，等待完整任务清理及异步租约释放再返回；清理 503 和多项原始原因继续保留，服务关闭也等待这些清理并报告未确认状态。正文与环境合计超过原生 64 KiB 限制返回 413，不执行部分命令。

项目启动器在发行票据前拒绝时，会在确认任务域清理后返回明确的账号错误，不能作为普通命令退出码或普通健康失败处理。已发行运行的用户非零退出与任意 JSON 输出保持原有响应语义。

CLI 示例：

```powershell
npm run sakura -- exec dev -- pwd
npm run sakura -- exec dev --project default --timeout 60 -- sh -c 'pwd; echo "$HOME"'
npm run sakura -- shell dev --project default
npm run sakura -- exec dev --instance -- ip netns list
```

`--` 后的各个参数原样传给客户机，不再解析为 CLI 选项。需要 shell 运算符时显式使用 `sh -c`。账户模式下将登录返回的会话令牌放入 `SAKURA_TOKEN` 环境变量；未提供时沿用基础模式的本机鉴权。API 和 CLI 命令执行仍只允许管理员，查看者及项目成员没有此入口权限。

生成的 SDK 沿用相同合约：

```js
const result = await client.call('core.vms.exec', {
  path: { vmId },
  query: { project: 'default' },
  body: { command: 'pwd', timeoutSeconds: 60 },
  signal: abort.signal,
});
```

能力中心的单次 SSH Agent 命令已使用所选项目的固定 UID/GID、独立 home、捕获配置及受保护正文。每次提交都需明确命令和 `confirmed: true`，不能保存命令或沿用旧确认。项目环境不能替换本次独立入口；直接请求核对准确项目和任务域，取消、超时或结束先清理完整域和转发资源，再核销账号票据。失败的具体清理码和原记录可在重载后继续查看，准备租约保留到清理结束，见 [SSH Agent 转发](ssh-agent-forward.md)。新的三系统检查入口 `test:ssh-agent:identity` 只接受脚本固定的已停止自有实例和旧证明，不接受任意用户实例。

GPG 命令使用同样的项目账号与受保护正文，另有本次专属、项目可写的临时 `GNUPGHOME` 和固定 Assuan broker。宿主来源、helper 和关闭回执有独立的持久归属；完整域停止、准确转发资源与临时 home 清理后才核销账号票据。当前宿主支持 Windows x64 原生 GnuPG，客户机仍需导入公钥，见 [GPG Agent 转发](gpg-agent-forward.md)。`test:gpg-agent:identity -- --describe` 列出新的源码、测试所有权、依赖与实际运行合同；旧模拟 extra socket 证明不代表当前实现。

“系统调用隔离”的 `run` 模式也通过保护帧使用原项目 UID/GID、独立 home、捕获配置与完整任务域，然后施加 seccomp 策略并遮盖私密输出。固定的系统 Python 以隔离模块加载模式解释可信执行器，项目 `PATH` 和 `PYTHONPATH` 仍传给用户选择的命令。取消、超时或正常退出后清理原整个任务域。`status` 与 `install` 使用固定系统环境与 helper 归属、摘要核对，见 [项目工具任务](project-tool-tasks.md)。`npm run test:syscall-profile -- alpine` 已适配明确目录迁移与 UID/GID/home/task 检查，并保留策略、参数、路由拒绝和进程清理检查，也支持 `debian`、`ubuntu`；本次尚未执行新账号脚本的客户机联测，历史结果不替代当前验证。

管理员维护整个实例时明确提交 `scope: "instance"` 或使用 CLI `--instance`。此范围使用客户机共享网络，不加载项目配置，也不接受项目查询参数。它用于系统管理，仍受实例维护、应急锁定和操作锁约束。

一次性命令拥有独立 cgroup v2。请求断开、SDK 取消、CLI 收到退出信号或超时时，服务通过独立 SSH 连接核对客户机 boot ID、域路径与 inode，结束所属进程并确认域已删除，再核销准确的项目账号票据及暂存资源。普通 `setsid`、双重 fork 和 GNU `timeout` 创建的新进程组仍属于原任务域。清理连接最多重试三次，未确认时保留回执并返回错误；后续项目命令先恢复可准确确认的旧任务，真实冷重启后保留原始票据并登记退休原因。客户机管理员仍可主动改变归属。服务关闭等待这些清理，执行期间保护实例和项目绑定。运行条件及三发行版实测见 [客户机任务清理](guest-task-cleanup.md) 与 [项目账号](project-identities.md)。

`npm run test:project-terminals -- alpine` 在编译后的服务和真实 QEMU 客户机中验证 API/SDK/CLI 的实际网络空间、目录、环境与密钥遮盖、字面参数、退出码、超时与取消进程、账户权限及项目插件停用后的恢复。也可选择 `debian` 或 `ubuntu`。网络隔离的完整范围见 [项目网络隔离](project-network-isolation.md)。
