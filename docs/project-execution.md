# 项目命令执行

基础命令执行 API、生成的 SDK 与 CLI 默认使用实例保存的活动项目。命令进入该项目目录，加载项目环境变量及私密配置，并按保存的网络模式运行；私有项目进入仅回环的网络命名空间，准备阶段可创建该空间和目录。执行前检查实际接口与路由，失败时拒绝执行。停用项目插件后仍遵守保存的项目配置，已启用的私密配置和网络服务仍参与环境解析。

`POST /api/vms/:vmId/exec` 接受 `command`、可选的 `scope` 和 `timeoutSeconds`。`scope` 默认 `project`，超时默认 30 秒，允许 1–3600 秒。通过 `?project=default` 或 `?project=<16 位项目标识>` 选择其他项目；省略时使用活动项目。响应包含 `stdout`、`stderr`、`code`、`scope`，项目命令还返回 `projectId`、`directory` 和 `networkIsolation`。项目私密配置值在标准输出和错误输出中被遮盖。

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

管理员维护整个实例时明确提交 `scope: "instance"` 或使用 CLI `--instance`。此范围使用客户机共享网络，不加载项目配置，也不接受项目查询参数。它用于系统管理，仍受实例维护、应急锁定和操作锁约束。

一次性命令拥有独立进程组。请求断开、SDK 取消、CLI 收到退出信号或执行超时时，服务通过独立 SSH 连接结束该进程组并清理任务标记。服务正常关闭也等待这些清理；执行期间不能暂停、停止实例或修改项目绑定。主动脱离进程组的客户机进程及客户机管理员仍可绕过这些约束。

`npm run test:project-terminals -- alpine` 在编译后的服务和真实 QEMU 客户机中验证 API/SDK/CLI 的实际网络空间、目录、环境与密钥遮盖、字面参数、退出码、超时与取消进程、账户权限及项目插件停用后的恢复。也可选择 `debian` 或 `ubuntu`。网络隔离的完整范围见 [项目网络隔离](project-network-isolation.md)。
