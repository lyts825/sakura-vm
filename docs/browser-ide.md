# 认证浏览器 IDE

在 Debian 或 Ubuntu 实例中启动并选择项目，然后到“能力中心”选择“认证浏览器 IDE”。参数 `mode` 支持 `status`、`install`、`start`、`stop`。首次 `start` 自动安装固定版本的 code-server；安装包下载后先核对 SHA-256，再在客户机中启用。首次下载约 239 MB，客户机需要可访问 GitHub 的网络与足够磁盘空间。Alpine 暂不支持此入口，可继续使用 Sakura 文件编辑器与终端。

`guestPort` 是客户机监听端口，`hostPort` 是 Windows 本机回环端口，默认均为 8080；冲突时更换本机端口。服务为当前项目启动独立的 code-server 会话，打开该项目目录。启动结果不含密码；点击“打开浏览器 IDE”后，Sakura 才通过已授权、未锁定的本机接口提供入口与随机密码。新标签页显示 code-server 登录页，在原标签页输入或复制访问密码。密码不会写入任务结果或普通状态；本机服务记录使用受限权限保存以便重启恢复。不要分享密码。

`ttlMinutes` 默认 60，范围 1–240 分钟。到期后客户机内的进程会停止，本机服务也会清理它创建的端口映射；控制服务重启时重新加载到期时间并复核会话。手动 `stop` 会立即关闭会话，但保留已安装的 IDE 和项目文件。实例暂停时先恢复再停止。若使用的是预先存在的相同端口映射，停止会保留该映射。每个实例的每个项目同时管理一个浏览器 IDE 会话；修改端口或项目目录前先停止原会话。

浏览器 IDE 是客户机中的完整编辑器及终端，以客户机 root 身份运行，只通过本机回环端口提供入口。code-server 自身的扩展、设置和文件保存由客户机管理。安装及认证机制参考 [code-server 官方安装文档](https://github.com/coder/code-server/blob/main/docs/install.md)与 [安全访问说明](https://coder.com/docs/code-server/guide)。

`npm run test:browser-ide` 在真实 Debian/QEMU 客户机中核验发布包摘要、启动、拒绝错误密码、接受正确密码和到期清理。
