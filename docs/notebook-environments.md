# JupyterLab 与 Marimo 环境

启动实例并选择项目后，在“能力中心”选择“Jupyter/Marimo 环境”。参数中的 `provider` 可设为 `jupyter` 或 `marimo`；`mode` 支持 `status`、`install`、`start` 和 `stop`。`start` 会自动安装缺失的环境。任务完成后使用“打开 Notebook”获取当前会话的访问链接。

每个项目分别在项目目录的 `.sakura/notebooks/<provider>/venv` 安装 Python 虚拟环境。安装会在客户机中使用其系统包管理器和 pip，因此客户机需要联网且能访问软件源。安装结果保留在项目目录；`stop` 只关闭会话并清理由本功能创建的本机端口映射，不删除虚拟环境或项目文件。每个实例的每个项目同时管理一个 Notebook 会话；更换提供者或端口前先停止现有会话。

`guestPort` 是客户机监听端口，`hostPort` 是 Windows 本机回环端口，默认均为 8888。端口已被其他映射占用时可选择另一个本机端口；使用既有同端口映射时，停止 Notebook 不会删除该映射。服务在客户机内启动 tmux 会话，JupyterLab 或 Marimo 使用随机令牌保护入口；Sakura 仅将端口转发绑定在 `127.0.0.1`。访问链接通过已授权且未锁定的本机控制接口单独获取，普通状态和任务记录不含令牌。链接中包含访问令牌，勿分享链接；结束使用后执行 `stop`。实例暂停时先恢复实例再停止会话。

状态检查会核对客户机进程和本机入口。Sakura 重启后会从本机记录恢复会话信息，并重新检查实际运行状态；异常中断的启动会标记为待复核。实例重启会终止客户机中的会话，需要重新执行 `start`。此功能提供当前项目的交互式 Notebook，不负责 Notebook 内文件保存、内核任务恢复或自动更新 Python 依赖。

`npm run test:notebook` 在真实 Alpine/QEMU 客户机中安装并启动两种提供者，验证认证访问及端口转发清理。
