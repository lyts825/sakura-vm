# 单应用 Linux 窗口

运行中的 Alpine 实例可在“桌面 → 单应用窗口”输入客户机里的程序名及参数，启动独立的浏览器弹窗。每个应用使用专属 Xvnc 显示器和 Openbox，会话与普通 KDE 桌面分开；首次使用会通过 `apk` 安装所需图形组件。默认程序 `xterm` 可用于检查。参数每行一个，程序需已安装在客户机中。

每台实例最多四个会话，可从桌面页重新打开或停止。应用退出、实例停止或 Sakura 服务关闭时会话终止，最长运行四小时。关闭弹窗只断开观看，可从会话列表重新打开。图形数据经已有实例 SSH 通道和有权限校验的 WebSocket 转发；客户机 RFB 仅监听环回。

这是独立的**浏览器窗口**，不是 Windows 原生单应用窗口；应用界面仍显示在自己的虚拟屏幕上，可能带有 Openbox 背景和窗口边框。当前只支持 Alpine，重启 Sakura 服务后未保留会话索引，也不提供跨窗口剪贴板同步、音频或文件拖放。浏览器必须允许弹窗。宿主机窗口管理器级集成及其他发行版仍未完成，因此目录状态为“部分实现”。

接口：`GET /api/vms/:vmId/single-app` 查看会话；`POST` 使用 `{ "action": "start", "program": "xterm", "args": [], "resolution": "1024x768" }` 启动，或 `{ "action": "stop", "id": "..." }` 停止。图形 WebSocket 为 `/ws/:vmId/desktop?app=:sessionId&token=:ownerToken`，仅实例拥有者可连接。

`npm run test:single-app-windows` 在真实 Alpine 虚拟机内验证启动、独立 RFB 握手和停止。
