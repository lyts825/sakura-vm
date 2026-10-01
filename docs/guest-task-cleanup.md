# 客户机任务取消与清理

一次性项目命令、就绪和健康检查、构建任务及 SSH/GPG Agent 命令通过 `guestTask` 执行。每次执行创建随机名称的专属 cgroup v2，准备回执保存客户机 boot ID、域路径与 inode；工作进程在执行项目代码前进入该域，后台子进程、`setsid` 和双重 fork 仍继承归属。GNU `timeout` 创建不同进程组也不会脱离任务域。

客户机必须提供可写的统一 cgroup v2 及 `cgroup.kill`。缺少这些条件时，在项目代码执行前拒绝启动。Alpine 可以启动发行版已有的 cgroups 服务；不把普通目录当成 cgroup 挂载，也不退回仅清理进程组的成功状态。

取消、超时或正常结束后，通过独立 SSH 连接核对原客户机及域身份，给予短暂 TERM 宽限，再通过已打开的 `cgroup.kill` 结束所属进程。确认内核报告空域并删除原域后，才能清理缓存暂存目录、临时 `GNUPGHOME` 等后续资源，最后核销回执。清理连接和后续回调最多各重试三次；每次回调前重新核对客户机 boot ID 和已删除的原任务域。更换实例、客户机重启或同名域 inode 变化时，拒绝操作其他代次的对象。

无法确认清理时，接口返回 `GUEST_TASK_CLEANUP_FAILED`，保留归属回执和未确认的暂存资源。健康检查遇到该错误或 `GUEST_TASK_SCOPE_UNAVAILABLE` 时暂停自动检查与自动重启，显示遮盖私密值的具体原因；核查原任务归属后，成功的手动服务操作才恢复相应服务的自动检查。失败的手动操作保留暂停状态。

任务锚点有有限存续时间。控制连接全部失败后仍会结束任务域，但不能因此假定已经取得清理确认；遗留回执继续供核查。由系统服务管理器或独立容器守护程序启动的持久服务具有自己的生命周期，停止一次准备任务不会替代显式停止这些服务。客户机管理员可以主动改变 cgroup 或启动外部服务，不据此宣称隔离任意 root 程序。

```powershell
npm run test:guest-task -- alpine
npm run test:guest-task -- debian
npm run test:guest-task -- ubuntu
```

脚本默认创建自己的测试实例。可在发行版参数后传入本脚本保留并已停止的测试目录；必须匹配原证据中的 VM ID、名称与发行版。本批三个发行版均已验证 GNU/BusyBox `timeout`、不同会话的普通后台进程、正常返回状态、首次清理连接失败、回调重试、无可写 cgroup 时不执行项目代码，以及同名新 inode 不被旧回执终止。Debian、Ubuntu 还核对独立 systemd 持久服务继续运行。依据见 [Linux cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)。
