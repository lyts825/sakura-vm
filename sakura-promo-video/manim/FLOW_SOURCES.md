# 视频 1.1：工作空间图解来源与边界

两段新图解均使用 Manim Community 0.21.0、Cairo/Pango 和 Segoe UI，无需 LaTeX。每段精确 10 秒，1920×1080、H.264、30 fps、300 帧，无音轨；内容中心上移，可放入 1120×650 的合成容器。原 [kernel-flow.mp4](../public/manim/kernel-flow.mp4) 保持 8 秒。

## 事实来源与表达边界

**RecoveryFlow（恢复流程）**从 `Stopped instance`（已停机原实例）出发，区分三条磁盘路径：普通快照 `Snapshot → Restore` 恢复到**原实例**，覆盖快照之后的磁盘变化；`Clone → Independent instance` 创建**独立实例**；`Verified backup → Restore to new instance` 校验备份后恢复为**新实例**，不覆盖原实例。画面中的 `Disk state / Cold start` 表示磁盘状态与冷启动；这三条路径不承诺恢复 RAM 或运行中进程。

依据：[项目 README](../../README.md) 的快照与备份说明；[工作空间管理](../../docs/workspace-management.md)的“自动备份”；[开发工作台](../../docs/development-workbench.md)的“加密备份”；[RAM 与进程状态快照](../../docs/memory-snapshots.md)中跨主机复制、导出和克隆仅保留磁盘状态的限制。

**ProjectIsolation（项目账号边界）**将两个持久项目账号放在 `One Linux instance`（同一 Linux 实例）内。各项目有自己的 UID/GID、私有家目录和进程归属；底部 `Shared kernel` 明确说明共享内核。这是 Linux 账号边界，不能解释为两台虚拟机的硬隔离或绝对安全保证。客户机 root、显式管理员入口及尚未迁移的扩展入口仍有独立权限路径。

依据：[持久项目账号与固定启动器](../../docs/project-identities.md)的“账号与目录”“运行归属”及最后的权限边界说明；[项目终端](../../docs/project-terminals.md)。

**供周边中文旁白参考的桌面边界：**当前[Linux 图形桌面文档](../../docs/linux-desktop.md)描述所选项目的 UID/GID 和独立 home、每实例一个 KDE 会话，以及切换项目前先停止旧会话。新账号身份、端点与清理合同尚未在新鲜真实 KDE 虚拟机中联测；旧 smoke 证据属于历史入口，不能替代新入口验证。桌面仍为实验性；noVNC 网页自身没有独立音频流或 WSLg 式单应用集成。涉及桌面账号时，以当前文档正文为准，不沿用较旧的 README 账号表述。

## 重建命令

在 `sakura-promo-video` 目录内，使用已按 [requirements.txt](requirements.txt) 安装依赖的隔离 `.venv` 执行：

```powershell
.venv\Scripts\python.exe -m manim --config_file manim\manim.cfg --media_dir .cache\manim --resolution 854,480 --fps 30 -o recovery-flow-preview manim\workspace_flows.py RecoveryFlow
.venv\Scripts\python.exe -m manim --config_file manim\manim.cfg --media_dir .cache\manim --resolution 854,480 --fps 30 -o project-isolation-preview manim\workspace_flows.py ProjectIsolation
.venv\Scripts\python.exe -m manim --config_file manim\manim.cfg --media_dir .cache\manim --resolution 1920,1080 --fps 30 -o recovery-flow manim\workspace_flows.py RecoveryFlow
.venv\Scripts\python.exe -m manim --config_file manim\manim.cfg --media_dir .cache\manim --resolution 1920,1080 --fps 30 -o project-isolation manim\workspace_flows.py ProjectIsolation
Copy-Item -LiteralPath .cache\manim\videos\workspace_flows\1080p30\recovery-flow.mp4 -Destination public\manim\recovery-flow.mp4
Copy-Item -LiteralPath .cache\manim\videos\workspace_flows\1080p30\project-isolation.mp4 -Destination public\manim\project-isolation.mp4
```

播放与 Remotion 合成只需 [recovery-flow.mp4](../public/manim/recovery-flow.mp4) 和 [project-isolation.mp4](../public/manim/project-isolation.mp4)。重建需要固定依赖和 Segoe UI。必要预览帧及日志保存在本地 `.cache/manim`，不纳入 Git；现有中间渲染缓存保留。

## 验证结论

低清预览、动画中间帧及最终第 9 秒关键帧的文字布局和语义边界已检查通过；主代理也已核验最终关键帧。ffprobe 完整帧数核对确认两段均为 H.264、1920×1080、30 fps、300 帧、精确 10 秒，且无音轨。
