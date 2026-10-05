# Sakura 项目介绍视频

45 秒中文横屏介绍片。Manim 制作 Linux 运行原理动画，Remotion 完成界面动效、字幕、旁白与音乐合成。

- 视频版本：首次制作 → `1.0.0`，独立于 Sakura 应用版本。
- 项目依据：Sakura `2.3.3`（`31e1d66`）的源码与说明；本目录不修改应用功能。
- 规格：1920 × 1080，30 fps，45 秒，H.264 / AAC MP4。
- 状态：已完成制作与必要验证，交付版本 `1.0.0`，日期 `2026-10-06`。
- 负责人：主代理负责内容核对、整合验收和 Git 交付；三位 GPT-6.1-sol 子代理分别负责 Remotion、Manim、音频。

## 分镜

| 时间 | 内容 | 表达边界 |
| --- | --- | --- |
| 00–06 | Sakura：让 Linux，在本地生长 | 沿用项目樱花素材与配色 |
| 06–14 | 从基础 Alpine 终端开始 | 创建、启停、持久磁盘；界面为动效示意 |
| 14–22 | 真正运行 Linux 内核 | Manim 表达 PosixLoom 编排与 QEMU 虚拟化的职责 |
| 22–32 | 通过插件按需扩展 | 文件、多终端、项目、Git、快照均为可选；保存并重启服务后生效 |
| 32–40 | 组合自己的本地工作空间 | 明确需启用相关插件，不表示基础版默认提供全部入口 |
| 40–45 | 从一个终端，长成你的工作空间 | 品牌落版 |

视频用于项目介绍，界面经过重绘与简化，不是实际操作录屏，也不作为性能测试或所有可选功能的验收证据。未把实验性桌面、路线图入口或未实现功能包装成已经成熟的能力。

## 内容与素材依据

- 产品范围与插件条件：[项目 README](../README.md)。
- 插件实现：[PluginCenter.tsx](../src/PluginCenter.tsx)、[插件架构](../docs/plugin-architecture.md)。
- 视觉基线：[style.css](../src/style.css)、[樱花素材说明](../docs/sakura-art.md)。
- 品牌素材：复用项目已有的樱花透明图与标志，不新增外部图库素材。
- 字体：沿用项目 Sakura 字体来源，针对视频文案重新裁剪中文字体并保留 OFL 许可；见[原字体说明](../src/assets/fonts/README.md)和[视频字体来源清单](public/brand/fonts/manifest.json)。
- 声音：Microsoft `zh-CN-XiaoxiaoNeural` 中文合成旁白与程序生成的原创轻音乐；具体文案、依赖与复现方式见 [NARRATION.md](NARRATION.md)。

## 制作工具

- [Remotion 官方 skills](https://github.com/remotion-dev/skills)：创建、React 动效、预览和导出。
- [Manim Community 官方文档](https://docs.manim.community/en/stable/)：原理动画和局部渲染。
- FFmpeg / FFprobe：媒体合成检查、关键帧、时长、编码与响度验证。

Node 依赖由本目录独立的 `package.json` 和锁文件管理，Python 依赖使用隔离环境。最终视频、封面、制作源码和必要素材纳入 Git；依赖、缓存、预览与专用验证材料不入库。根项目现有改动和其它本地文件不属于本次清理范围。

## 交付物与重建

- [正式 MP4](deliverables/sakura-intro-1080p.mp4)与[封面](deliverables/sakura-intro-cover.png)。
- [Remotion 场景源码](src/SakuraPromo.tsx)，完整 composition 为 `SakuraPromo`，封面为 `SakuraCover`，每幕也可单独预览。
- [Manim 源码与重建说明](manim/README.md)。
- [旁白字幕 SRT](public/audio/narration.srt)与[句级时间轴](public/audio/transcript.json)。字幕内容与旁白使用同一份时间轴。
- [音频生成说明](NARRATION.md)及 `scripts/audio_generate.py`。

在本目录使用 Node.js 和 npm：

```powershell
npm ci
npm run dev
```

打开终端打印的地址，默认 `http://localhost:3400/SakuraPromo`。导出成片与封面：

```powershell
npm run lint
npm run render
```

仅导出封面用 `npm run cover`。渲染入口为 `scripts/render.mjs`，详细日志写入被忽略的 `.cache/render.log`。首次安装 Node 依赖和渲染浏览器需要网络；已有必要媒体素材均随本目录保存，普通重新渲染不需要重新合成语音或运行 Python。修改原理动画或声音时，按对应说明重建源素材。

新增文案后，使用已建立的 Python 3.12 `.venv` 补齐视频字体：

```powershell
uv pip install --python .venv\Scripts\python.exe -r scripts\fonts_requirements.txt
.venv\Scripts\python.exe scripts\fonts_generate.py
.venv\Scripts\python.exe scripts\fonts_generate.py --check
```

字体重建优先只读父项目的原字体缓存；全新检出会从固定版本的 Google Fonts 源下载完整字体到本目录 `.cache/fonts`，校验 Git blob 后使用。OFL 使用随视频保留的授权文本。首次补齐缓存需要网络，缓存后可离线运行。

本目录自有代码沿用项目 [MIT 许可](../LICENSE)；字体及工具的原许可分别适用，OFL 许可随字体保留。

## 验收与版本记录

- `npm run lint`（ESLint + TypeScript）通过；实际 `npm run render` 成功导出 MP4 与封面。独立只读复核确认时间轴、字幕时间、素材引用及依赖锁一致。
- 六幕关键帧与封面已检查；修复了中文字体回退混排，148 个所需汉字与中文标点全部覆盖。正文、最长字幕、界面示意标注和插件条件均无裁切或遮挡。
- 最终视频：1920 × 1080、30 fps、1,350 帧，画面时长 45.000 秒；H.264 / `yuv420p` / BT.709 / TV range；AAC、48 kHz、双声道。容器时长 45.013 秒包含 AAC 尾包，文件 4,656,244 字节。FFmpeg 全部视频与音频解码成功，无错误。
- Manim 原理片段确认为 8 秒、240 帧。旁白最后一句完整保留到 43.562 秒，配乐包含尾部淡出；合成响度约 −18.1 LUFS，真峰值约 −5.1 dBFS。
- 验证边界：配音未进行人工听辨；未在无缓存的新机器或其它操作系统重建。字体下载回退已实现，本次使用本地固定缓存，未实测该联网回退。应用未变更，因此未重跑根应用测试。

本轮清除了失败的重复字体脚本、探测文件与已失用的旧预览；必要验证帧、日志和依赖环境保留在忽略目录。中间 Manim 分段缓存的删除被自动审批拒绝（仅返回 `blocked by policy`），因此保留且不入库。所有正式交付物与制作素材纳入本次提交，无额外发布或部署。

版本首次制作 → `1.0.0`，对应本地标签 `video-v1.0.0`；使用 `git rev-parse video-v1.0.0^{commit}` 可定位交付提交。本版本不改变 Sakura 应用版本或兼容性。
