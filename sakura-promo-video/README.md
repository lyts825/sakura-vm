# Sakura 项目介绍视频

中文配音与中文字幕的项目介绍片。Manim 制作原理动画，Remotion 完成产品界面动效、逐句字幕、旁白与原创音乐合成。

- 视频版本：`1.0.0 → 1.1.0`，独立于 Sakura 应用版本。
- 项目依据：Sakura `2.3.3`（`31e1d66`）的源码与文档。
- 本轮交付：原 45 秒短片扩展为 **154.27 秒（约 2 分 34 秒）**的完整介绍；使用用户选定的 A 款明亮中文女声，以实际语音决定镜头长度。
- 规格：1920 × 1080，30 fps，4,628 帧，H.264 / AAC MP4。
- 状态：已完成制作与必要验收，日期 `2026-10-06`；交付提交由本地标签 `video-v1.1.0` 定位。
- 分工：主代理负责文案、功能核对、整合验收和 Git 交付；三位 GPT-6.1-sol 子代理负责音频、Manim、Remotion 编码与制作。

## 这一版的变化

旁白改为 Microsoft `zh-CN-XiaoyiNeural`，即用户从同稿试听中选择的 A 款。使用自然音高、较舒缓语速、长短句搭配与句间停顿；不再像短片那样为了塞入固定镜头而局部加速。朗读稿与显示字幕分别保存，技术名词的读法可以调整，字幕保留准确名称。

内容扩展到十二个章节，介绍基础环境、可选插件、开发、文件同步、恢复、服务、维护、隔离和实验性桌面。新增恢复路径与项目账号边界的 Manim 动画，并保留原来的 Linux 内核运行图解。原 45 秒成片继续保留。

## 分镜与事实边界

[STORYBOARD.json](STORYBOARD.json) 保存旁白、字幕文案、屏幕要点、画面要求和逐景来源。最终时间以 [transcript.json](public/audio/transcript.json) 为准，视频和字幕使用同一份时间轴。

| 章节 | 主要特点 | 画面需要说明的条件 |
| --- | --- | --- |
| 品牌开场 | Windows 上的本地 Linux 工作空间 | 终端、代码与文件组织在一起 |
| 内核与编排 | QEMU 运行 Linux，PosixLoom 管理命令与会话 | 默认原生 Windows 后端，不依赖已有 WSL |
| 基础实例 | Alpine、持久磁盘、终端与资源配置 | 更多发行版需镜像插件，资源调整须停机 |
| 按需扩展 | 32 个插件、9 个整合包 | 默认关闭；保存后重启 Sakura 服务生效 |
| 开发工作台 | 项目模板、代码编辑、Git、多终端 | 需启用相关插件；tmux 恢复需客户机依赖 |
| 文件与同步 | SFTP、Windows 双向同步、变更预览 | 冲突需要逐项决策，可配置忽略规则 |
| 数据恢复 | 快照、克隆、定时备份与校验 | 停机操作；快照回退原实例，备份恢复为新实例 |
| 网络与服务 | TCP 转发、服务依赖、健康检查、编辑器接入 | Remote-SSH 接入限定支持的发行版和环境 |
| 自动化与维护 | 计划启停、资源历史、任务日志、诊断报告 | 需启用相应插件与后台调度 |
| 项目边界与沙箱 | 本机管理、项目账号与 Home、可选沙箱 | 同实例账号边界与独立沙箱虚拟机分别呈现 |
| 图形桌面 | KDE Plasma、浏览器 VNC 连接 | 始终标明实验性；网页自身无独立音频流 |
| 品牌落版 | 从终端按需扩展到工作空间 | 留出完整旁白和音乐淡出 |

产品界面和指标经过重绘与简化，画面标注为示意，并非实际操作录屏或性能测试。没有将路线图目录、待实现入口或未经验证的桌面能力宣传成成熟功能。项目账户隔离不等于独立虚拟机，也不作绝对安全承诺。

## 交付物与复现

本轮正式输出为 [加长版 MP4](deliverables/sakura-intro-extended-1080p.mp4) 与 [加长版封面](deliverables/sakura-intro-extended-cover.png)。原版 [45 秒 MP4](deliverables/sakura-intro-1080p.mp4) 与 [原版封面](deliverables/sakura-intro-cover.png) 保留，已核对其 Git 内容摘要与 `1.0.0` 一致。

- [Remotion 场景](src/SakuraPromo.tsx)：主 composition 为 `SakuraPromo`，封面为 `SakuraCover`，每章可单独预览。
- [Manim 源码与重建方法](manim/README.md)：内核运行、恢复路径、项目账号边界。
- [音频生成说明](NARRATION.md)、[字幕 SRT](public/audio/narration.srt)、[实际句级时间轴](public/audio/transcript.json)。
- [视频专用字体来源](public/brand/fonts/manifest.json)：针对成片文字裁剪，保留上游 OFL 许可。

在本目录使用 Node.js 与 npm：

```powershell
npm ci
npm run dev
npm run lint
npm run render
```

Studio 默认地址为 `http://localhost:3400/SakuraPromo`。`npm run render` 输出加长版成片与封面，原 45 秒文件不会被覆盖；仅重建封面用 `npm run cover`。渲染入口为 `scripts/render.mjs`，日志位于忽略目录 `.cache`。已有媒体素材随项目保存，正常重渲染不需要重新合成语音或运行 Python。修改配音或图解时，按各自说明重建素材。

新增文字后，需要补齐视频字体：

```powershell
uv pip install --python .venv\Scripts\python.exe -r scripts\fonts_requirements.txt
.venv\Scripts\python.exe scripts\fonts_generate.py
.venv\Scripts\python.exe scripts\fonts_generate.py --check
```

字体脚本只读父项目固定来源缓存；缓存缺失时，从固定版本 Google Fonts 源下载到视频目录的 `.cache/fonts`，校验 Git blob 后使用。普通渲染使用已生成字体，无需下载。

## 素材与工具

- 项目功能与视觉：[项目 README](../README.md)、[樱花素材说明](../docs/sakura-art.md)及分镜中的逐景来源。
- 图片与品牌：复用本项目已有樱花透明插画、标志及配色，不新增外部图库素材。
- 字体：沿用项目 Noto Sans SC、Noto Serif SC 与 JetBrains Mono 来源，使用视频专用裁剪和保留的许可文本。
- 声音：用户选定的通用中文合成女声与程序生成的原创轻音乐。没有使用任何真人录音、克隆模型或特定真人仿声。
- [Remotion 官方 skills](https://github.com/remotion-dev/skills)用于 React 动效、预览与导出；[Manim Community](https://docs.manim.community/en/stable/)用于图解动画；FFmpeg / FFprobe 用于媒体验证。

Node 与 Python 依赖分别隔离。成片、封面、制作源码、字幕和必要素材纳入 Git；依赖、缓存、试听样本、关键帧和验证报告不入库。本目录自有代码沿用项目 [MIT 许可](../LICENSE)，字体和工具保留各自许可。

## 验收与版本记录

2026-10-07 随主应用 `2.3.6` 进行源码维护：补充注释并按现有流程同步视频字体及来源清单，两套字体覆盖 474 个所需汉字、809 个码点，保留此前全部字符；字体覆盖检查和 TypeScript 检查通过。视频时间线、字幕、音频、成片与封面保持原交付内容，视频版本仍为 `1.1.0`；下列渲染及视听验收记录属于该视频版本，最新源码维护验证见 [项目状态](../PROJECT_STATUS.md)。

- `npm run lint`（ESLint + TypeScript）通过；`npm run render` 实际导出成片及封面，退出码 0。
- 十二景、三条最长字幕中点与末帧共 16 张静帧完成检查；修复了实例、插件、网络、监控、隔离和桌面场景的底部裁切，以及同步完成状态的文案不一致。字幕安全区保持在 y=924–1050。正式 MP4 的同步、恢复图解与末帧也已抽帧核验，封面已检查。
- 两套中文字体均覆盖全部 407 个所需汉字，共 768 个码点；`fonts_generate.py --check` 通过。
- 独立只读复核通过：12 景连续覆盖 0–4,628 帧；32 句字幕与分镜、实际语音句边界及 SRT 对应，无重叠或重复扣帧。三段 Manim 分别为 8 / 10 / 10 秒，播放后保持尾帧。
- 最终视频为 1920 × 1080、30 fps、4,628 帧、画面时长 154.266667 秒；H.264 High / `yuv420p` / BT.709 / TV range；AAC-LC、48 kHz、双声道。容器时长 154.283 秒包含 AAC 尾包，文件 14,164,577 字节。
- FFmpeg 使用严格错误检查完整解码全部画面与音频，退出码 0。成片混音实测 −17.90 LUFS、真峰值 −3.60 dBTP；最后一段语音音频结束后保留 1.5 秒，配乐尾部淡出，末帧品牌保持完整显示。
- 验证边界：用户已通过短样试听选择音色，未进行全片人工听辨；自然度不以技术检测代替听感。未在无缓存的新机器或其它操作系统重新构建。应用功能未变更，因此未重跑根应用测试。

成片 SHA-256：`3aec79c55d7e9aa11dcbf723f1678803e700dbf28102453e2ba1556049977178`。

| 版本 | 日期 | 变更 | 状态与定位 |
| --- | --- | --- | --- |
| `1.1.0` | 2026-10-06 | 自然节奏的中文女声、十二章完整介绍、三段 Manim 图解 | 已验收，本地标签 `video-v1.1.0` |
| `1.0.0` | 2026-10-06 | 45 秒中文短片，六幕、内核图解与原创配乐 | 已完成，提交 `7dd1999`，本地标签 `video-v1.0.0` |

使用 `git rev-parse video-v1.1.0^{commit}` 可定位本轮交付提交。两个视频版本均不改变 Sakura 应用版本与兼容性。

本轮移除了被新场景替代的旧场景文件和已无引用的 `@remotion/transitions` 依赖；原始音频浮点临时文件在处理后自动移除。必要试听、预览、渲染日志和验证材料保留于忽略目录，不纳入 Git；正式交付物和复现素材均保留。

`1.0.0` 已验证 1920 × 1080 / 30 fps / 1,350 帧，全片解码成功。它未经过人工配音听辨；本次已用同稿 A/B 样音征求用户听感选择。视频版本独立于应用，不改变 Sakura 应用版本或兼容性。本地提交与标签不代表外部发布。

上一轮部分 Manim 中间缓存清理被自动审批拒绝（仅返回 `blocked by policy`），已保留在忽略目录。该缓存不影响交付，也不纳入 Git。
