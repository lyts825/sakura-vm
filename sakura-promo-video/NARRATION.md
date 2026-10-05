# Sakura 45 秒介绍视频音频

两条音轨均为 45 秒、48 kHz、双声道 24 位 WAV。旁白使用 Microsoft Edge `zh-CN-XiaoxiaoNeural`，通过 `edge-tts 7.2.8` 联网合成。只向语音服务发送下表公开介绍文案。音轨已分别按约 −18 LUFS（旁白）和 −29 LUFS（音乐）归一化；Remotion 两条音轨均使用 `volume={1}`。音乐已包含末尾 1.2 秒淡出，不必再次淡出。

| 场景 | 公开旁白 |
| --- | --- |
| 0–6 秒 | Sakura。让 Linux，在本地生长。 |
| 6–14 秒 | 从基础 Alpine 终端开始。创建、启动和停止实例，数据保存在持久磁盘。 |
| 14–22 秒 | QEMU 真正运行 Linux 内核。PosixLoom，编排命令与会话。 |
| 22–32 秒 | 文件、多终端、项目、Git 和快照，按需选择插件。保存后，重启 Sakura 服务生效。 |
| 32–40 秒 | 把代码、文件和终端，组织成本地工作空间。按需组合，专注创造。 |
| 40–45 秒 | 从一个终端，长成你的工作空间。 |

`public/audio/transcript.json` 包含实际合成后的逐段语速、旁白起止时间和 TTS 句边界字幕时间；`narration.srt` 为同源字幕。结尾至少保留 0.45 秒空白，遇到超时段时提高合成语速，保留完整尾音。

音乐与场景切换轻铃由 `scripts/audio_generate.py` 原创程序合成：D 大调五声音阶木琴旋律、柔和键盘和弦、稀疏低音与轻刷音。使用固定随机种子，无采样曲库或第三方录音。

## 重生成

需要 Python 3.12 与 PATH 中的 FFmpeg。以下命令在本目录执行，专用环境与合成缓存位于被忽略的 `.cache/audio/`，不修改项目 Node 依赖。

```powershell
python -m venv .cache/audio/venv
.cache/audio/venv/Scripts/python.exe -m pip install -r scripts/audio_requirements.txt
.cache/audio/venv/Scripts/python.exe scripts/audio_generate.py
```

语音合成需要联网，语音服务输出可能随服务更新变化。原创音乐可离线重生成：

```powershell
.cache/audio/venv/Scripts/python.exe scripts/audio_generate.py --music-only
```

本次已通过 FFprobe 核对两条音轨均为 45.000000 秒、48 kHz、双声道。FFmpeg `loudnorm` 实测旁白 −18.00 LUFS / −5.09 dBTP，音乐 −28.99 LUFS / −16.67 dBTP。最后一句完整音频在 43.562 秒结束。当前环境没有可用的音频听辨工具，未声称完成主观试听；可在成片预览中验收发音与混音。

依赖环境和分段 MP3 仅供本地再生成与检查，不纳入 Git。
