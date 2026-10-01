# 项目命令执行

基础命令执行 API、生成的 SDK 与 CLI 默认使用实例保存的活动项目及其固定 UID/GID 和独立 home。命令进入该项目目录，加载项目环境变量及私密配置，并按保存的网络模式运行；私有项目进入仅回环的网络命名空间。正文通过有界标准输入运输，降权后执行已密封的只读脚本，root 参数不携带命令或环境正文。既有目录权限不足时须先核对并应用 [目录迁移](project-directory-migration.md)，不自动放宽目录权限。停用项目插件后仍遵守保存的项目配置，已启用的私密配置和网络服务仍参与环境解析。

`POST /api/vms/:vmId/exec` 接受 `command`、可选的 `scope` 和 `timeoutSeconds`。`scope` 默认 `project`，超时默认 30 秒，允许 1–3600 秒。通过 `?project=default` 或 `?project=<16 位项目标识>` 选择其他项目；省略时使用活动项目。响应包含 `stdout`、`stderr`、`code`、`scope`，项目命令还返回 `projectId`、`directory` 和 `networkIsolation`。项目私密配置值在标准输出和错误输出中被遮盖。

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

GPG 命令仍使用项目目录、环境、网络模式及本次专属临时 `GNUPGHOME`，尚未接入上述项目账号。超时或取消后结束命令 cgroup 并关闭桥接，仅在确认原域停止后清理临时目录。`test:ssh-agent-forward` 与 `test:gpg-agent-forward` 的独立实例检查支持发行版参数 `alpine`、`debian`、`ubuntu`；设置 `SAKURA_AGENT_PRIVATE=1` 可启用私有模式。

“系统调用隔离”的 `run` 模式也绑定所选项目，在进入网络空间、加载环境和目录后再施加 seccomp 策略，并遮盖私密输出。固定的系统 Python 以隔离模块加载模式启动受限执行器，项目 `PATH` 和 `PYTHONPATH` 仍传给用户选择的命令。取消、超时或正常退出后，清理执行器、受限命令及同任务域的后台子进程。`status` 与 `install` 检查和安装实例工具，使用系统环境。`npm run test:syscall-profile -- alpine` 实测项目配置、策略继承、参数、额外路由拒绝和进程清理，也支持 `debian`、`ubuntu`。

管理员维护整个实例时明确提交 `scope: "instance"` 或使用 CLI `--instance`。此范围使用客户机共享网络，不加载项目配置，也不接受项目查询参数。它用于系统管理，仍受实例维护、应急锁定和操作锁约束。

一次性命令拥有独立 cgroup v2。请求断开、SDK 取消、CLI 收到退出信号或超时时，服务通过独立 SSH 连接核对客户机 boot ID、域路径与 inode，结束所属进程并确认域已删除，再核销准确的项目账号票据及暂存资源。普通 `setsid`、双重 fork 和 GNU `timeout` 创建的新进程组仍属于原任务域。清理连接最多重试三次，未确认时保留回执并返回错误；后续项目命令先恢复可准确确认的旧任务，真实冷重启后保留原始票据并登记退休原因。客户机管理员仍可主动改变归属。服务关闭等待这些清理，执行期间保护实例和项目绑定。运行条件及三发行版实测见 [客户机任务清理](guest-task-cleanup.md) 与 [项目账号](project-identities.md)。

`npm run test:project-terminals -- alpine` 在编译后的服务和真实 QEMU 客户机中验证 API/SDK/CLI 的实际网络空间、目录、环境与密钥遮盖、字面参数、退出码、超时与取消进程、账户权限及项目插件停用后的恢复。也可选择 `debian` 或 `ubuntu`。网络隔离的完整范围见 [项目网络隔离](project-network-isolation.md)。
