# Windows 托盘伴侣

在 Windows 安装好 Sakura 的依赖并完成 `npm run build`（或使用已编译运行包）后，运行 `npm run tray`。命令会在后台启动系统托盘进程并返回。托盘图标会显示本机 Sakura 是运行中、会话锁定、未运行，还是端口由其他服务占用。双击图标或选择“打开 Sakura”可在浏览器打开控制台；选择“启动 Sakura”会在后台启动该运行包的服务。如果服务已经运行，托盘不会重复启动。

托盘菜单可单独选择“托盘启动时启动 Sakura”和“登录 Windows 时启动托盘”。端口默认为 7337；首次启动可用 `npm run tray -- 7338` 指定并保存其他端口。启动策略和端口保存在当前用户的 `%LOCALAPPDATA%\Sakura\tray.json`，不保存账户凭证。登录启动只登记当前用户的 Windows `Run` 项，不需要管理员权限；再次点击菜单项会移除登记。移动运行包后，应从新位置重新开启登录启动。

退出托盘不会关闭已经启动的 Sakura 服务。托盘只查询无需登录的本机状态接口，不能解锁会话或操作实例。Windows 的登录启动行为遵循 [Run 项文档](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)。

验证：`npm run test:tray` 在 Windows 启动真实编译服务，检查离线与在线状态、重复启动阻止、Windows Forms 控件创建和策略配置读取。
