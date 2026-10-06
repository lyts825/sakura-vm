# Sakura Manim 动画素材

本目录保存 Sakura 介绍片的 Manim 源码与固定依赖。原有 8 秒 `KernelFlow` 图解区分 PosixLoom 的命令编排与 QEMU 虚拟化职责，并展示真正的 Linux 内核及每实例持久 QCOW2 磁盘。

视频 1.1 新增两段各 10 秒的图解：

- [RecoveryFlow 素材](../public/manim/recovery-flow.mp4)：停机原实例的磁盘快照恢复、独立克隆，以及校验备份恢复为新实例。
- [ProjectIsolation 素材](../public/manim/project-isolation.mp4)：同一 Linux 实例内两个项目的 UID/GID、独立家目录与进程归属，明确标注共享内核。

新图解的事实来源、边界与重建命令见 [FLOW_SOURCES.md](FLOW_SOURCES.md)。原有 [kernel-flow.mp4](../public/manim/kernel-flow.mp4) 保持 8 秒、240 帧；新素材各 10 秒、300 帧。所有素材均为 H.264、1920×1080、30 fps、无音轨，背景为 `#FAF7F9`。

使用 **Manim Community 0.21.0**、Python 3.12、Cairo 和 Pango `Text`，字体为 **Segoe UI**，无需 LaTeX。

在 `sakura-promo-video` 目录内用 PowerShell 重建原动画：

```powershell
uv venv .venv --python 3.12
uv pip install --python .venv\Scripts\python.exe -r manim\requirements.txt
.venv\Scripts\python.exe -m manim --config_file manim\manim.cfg --media_dir .cache\manim --resolution 854,480 --fps 30 -o kernel-flow-preview manim\kernel_flow.py KernelFlow
.venv\Scripts\python.exe -m manim --config_file manim\manim.cfg --media_dir .cache\manim --resolution 1920,1080 --fps 30 -o kernel-flow manim\kernel_flow.py KernelFlow
New-Item -ItemType Directory -Force public\manim
Copy-Item -LiteralPath .cache\manim\videos\kernel_flow\1080p30\kernel-flow.mp4 -Destination public\manim\kernel-flow.mp4
```

环境与渲染缓存仅用于本地重建，播放和 Remotion 合成只需 MP4。重建需要固定依赖及 Segoe UI；其他系统可能需要替换字体。参考 Manim [官方安装说明](https://docs.manim.community/en/stable/installation.html)与[快速入门](https://docs.manim.community/en/stable/tutorials/quickstart.html)。

已检查预览及最终关键帧，并通过 ffprobe 核对视频规格、时长和完整解码帧数。必要验证图片与日志留在 `.cache/manim`，不纳入 Git。
