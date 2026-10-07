# 按 STORYBOARD 合成中文旁白和原创配乐，根据语音边界生成帧对齐场景、字幕与总时长元数据。
# Generate whole-chapter Chinese narration/original music and derive frame-aligned scene/caption/total timing from actual speech boundaries.
"""Generate STORYBOARD-based Chinese narration and original music for Sakura.

Python 3.12, edge-tts 7.2.8, numpy 2.4.2, FFmpeg/FFprobe on PATH.
Only the public storyboard ttsText is sent to Microsoft Edge TTS.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import re
import shutil
import subprocess
from pathlib import Path

import edge_tts
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SR = 48000
VOICE = "zh-CN-XiaoyiNeural"
RATE = "-3%"
PITCH = "+0Hz"
MUSIC_FADE = 1.8


# 执行外部音频工具并收集输出，非零退出直接抛错，不把失败当成有效音频。
# Execute audio tools with captured output and raise on nonzero exits instead of accepting failed audio.
def run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, capture_output=True)


# 经 FFmpeg 解码为固定采样率单声道 float32 数组，并复制缓冲供后续修改。
# Decode through FFmpeg to fixed-rate mono float32 samples and copy the buffer for later mutation.
def decode(path: Path) -> np.ndarray:
    result = run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
                  "-ar", str(SR), "-ac", "1", "pipe:1"])
    return np.frombuffer(result.stdout, dtype="<f4").copy()


# 运行 loudnorm 测量并解析 stderr 的最后 JSON 报告，返回目标响度所需观测。
# Run loudnorm measurement and parse the final stderr JSON report for target-loudness observations.
def loudness(args: list[str], target: float) -> dict:
    report = run(args + ["-af", f"loudnorm=I={target}:TP=-2:LRA=11:print_format=json",
                         "-f", "null", "-"]).stderr.decode("utf-8", errors="replace")
    return json.loads(report[report.rfind("{"):report.rfind("}") + 1])


# 测量后应用单一常量增益，兼顾目标响度和 -2dB 真峰值，保留动态/呼吸并写出音频及报告。
# Measure/apply one constant gain bounded by target loudness and -2dB true peak, preserving dynamics/breaths and writing audio/report.
def write_normalized(samples: np.ndarray, output: Path, cache: Path, target: float) -> dict:
    """One constant gain preserves dynamics and breaths; no compressor or time stretching."""
    raw = cache / (output.stem + ".f32")
    samples.astype("<f4").tofile(raw)
    common = ["ffmpeg", "-hide_banner", "-nostats", "-f", "f32le", "-ar", str(SR),
              "-ac", "2", "-i", str(raw)]
    measured = loudness(common, target)
    gain = min(target - float(measured["input_i"]), -2.0 - float(measured["input_tp"]))
    run(common + ["-y", "-af", f"volume={gain:.6f}dB", "-c:a", "pcm_s24le", str(output)])
    raw.unlink()
    actual = loudness(["ffmpeg", "-hide_banner", "-nostats", "-i", str(output)], target)
    (cache / (output.stem + "-measurements.json")).write_text(
        json.dumps({"beforeGain": measured, "gainDb": gain, "afterGain": actual}, indent=2) + "\n",
        encoding="utf-8")
    return {"targetIntegratedLufs": target, "verifiedIntegratedLufs": float(actual["input_i"]),
            "verifiedTruePeakDbtp": float(actual["input_tp"]), "constantGainDb": round(gain, 3)}


# 移除空白与常见中英文标点，用于语音边界和原稿的文本对应比较。
# Remove whitespace/common Chinese-English punctuation for matching speech boundaries to script text.
def comparable(text: str) -> str:
    return re.sub(r"[\s，。！？、,.!?]", "", text)


# 按整章文案及声线/速率/音调摘要复用或重取 TTS，保留句子上下文，并核对边界文本与音频。
# Reuse/request whole-chapter TTS from text/voice/rate/pitch fingerprints, preserving prosody and validating boundaries against audio/script.
async def synthesize(scene: dict, cache: Path, force: bool) -> tuple[np.ndarray, list[dict]]:
    """Synthesize the entire scene together to keep sentence context and natural prosody."""
    text = "\n".join(line["ttsText"] for line in scene["lines"])
    fingerprint = hashlib.sha256((VOICE + RATE + PITCH + text).encode("utf-8")).hexdigest()
    mp3 = cache / (scene["id"] + ".mp3")
    boundary_file = cache / (scene["id"] + "-boundaries.json")
    saved = json.loads(boundary_file.read_text(encoding="utf-8")) if boundary_file.exists() else {}
    if force or not mp3.exists() or saved.get("fingerprint") != fingerprint:
        communicate = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH,
                                          boundary="SentenceBoundary")
        boundaries = []
        with mp3.open("wb") as audio:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.write(chunk["data"])
                elif chunk["type"] == "SentenceBoundary":
                    boundaries.append({"start": chunk["offset"] / 10_000_000,
                                       "duration": chunk["duration"] / 10_000_000,
                                       "text": chunk["text"]})
        saved = {"fingerprint": fingerprint, "voice": VOICE, "rate": RATE,
                 "pitch": PITCH, "ttsText": text, "boundaries": boundaries}
        boundary_file.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    boundaries = saved["boundaries"]
    if len(boundaries) != len(scene["lines"]):
        raise RuntimeError(f"{scene['id']}: {len(boundaries)} TTS sentences for {len(scene['lines'])} caption lines")
    for boundary, line in zip(boundaries, scene["lines"]):
        if comparable(boundary["text"]) != comparable(line["ttsText"]):
            raise RuntimeError(f"{scene['id']}: TTS boundary text does not match its public line")
    return decode(mp3), boundaries


# 按帧量化章起止和字幕，再换算精确样本位置并拼接旁白，返回音频、场景与字幕避免累积时长漂移。
# Quantize scene/caption timing to frames before exact sample placement and narration concatenation, avoiding cumulative duration drift.
async def narration(storyboard: dict, cache: Path, force: bool) -> tuple[np.ndarray, list[dict], list[dict]]:
    fps = storyboard["fps"]
    if SR % fps:
        raise RuntimeError("Audio sample rate must divide evenly into the storyboard FPS")
    samples_per_frame = SR // fps
    # 所有场景和字幕先量化到整帧，再换算音频样本位置，避免逐章累积浮点时长漂移。
    scenes, captions, pieces = [], [], []
    cursor = 0
    for index, source in enumerate(storyboard["scenes"]):
        samples, boundaries = await synthesize(source, cache, force)
        head = round((.8 if index == 0 else .6) * fps)
        tail = math.ceil((1.5 if index == len(storyboard["scenes"]) - 1 else .65) * fps)
        speech_frames = math.ceil(len(samples) / samples_per_frame)
        duration_frames = head + speech_frames + tail
        speech_from = cursor + head
        speech_to = speech_from + speech_frames
        scene_captions = []
        for line_index, (boundary, line) in enumerate(zip(boundaries, source["lines"])):
            cue_from = speech_from + round(boundary["start"] * fps)
            cue_to = min(speech_to, speech_from + math.ceil((boundary["start"] + boundary["duration"]) * fps))
            if line_index + 1 < len(boundaries):
                # 当前字幕最多显示到下一句前一帧，避免相邻句在同一时间竞争显示。
                next_from = speech_from + round(boundaries[line_index + 1]["start"] * fps)
                cue_to = min(cue_to, next_from - 1)
            if cue_to <= cue_from:
                raise RuntimeError(f"{source['id']}: nonpositive caption interval")
            cue = {"sceneId": source["id"], "line": line_index + 1,
                   "start": cue_from / fps, "end": cue_to / fps,
                   "from": cue_from, "durationInFrames": cue_to - cue_from, "text": line["text"]}
            scene_captions.append(cue)
        scene = {"id": source["id"], "index": index + 1, "title": source["title"],
                 "start": cursor / fps, "end": (cursor + duration_frames) / fps,
                 "from": cursor, "durationInFrames": duration_frames,
                 "speechStart": speech_from / fps, "speechEnd": speech_to / fps,
                 "text": "".join(line["text"] for line in source["lines"]),
                 "ttsText": "".join(line["ttsText"] for line in source["lines"]),
                 "captions": scene_captions}
        scenes.append(scene)
        captions.extend(scene_captions)
        pieces.append((speech_from * samples_per_frame, samples))
        cursor += duration_frames
        print(f"{scene['id']}: {scene['start']:.3f}–{scene['end']:.3f}s, "
              f"speech {scene['speechStart']:.3f}–{scene['speechEnd']:.3f}s; "
              f"{scene['durationInFrames']} frames", flush=True)
    track = np.zeros((cursor * samples_per_frame, 2), np.float32)
    for at, samples in pieces:
        track[at:at + len(samples), :] = samples[:, None]
    return track, scenes, captions


# 以固定随机种子生成原创五声音阶键盘/槌音配乐，按章节 cue 编排并做片尾淡出，返回定长立体声。
# Generate original pentatonic keyboard/mallet music with a fixed seed, chapter cues and closing fade into fixed-length stereo samples.
def soundtrack(duration_frames: int, fps: int, scenes: list[dict]) -> np.ndarray:
    """Original evolving pentatonic score: soft keyboard, mallets, sparse pulse, chapter cues."""
    seconds = duration_frames / fps
    total = duration_frames * (SR // fps)
    score = np.zeros((total, 2), np.float32)
    rng = np.random.default_rng(20261008)

    # 把单音包络/泛音按 MIDI、时间、增益和声像累加到 score，裁剪片尾且忽略越界位置。
    # Add a note’s envelope/harmonics to score from MIDI/time/gain/pan, clipping the tail and ignoring invalid positions.
    def note(at: float, midi: int, duration: float, gain: float, pan: float, kind="mallet"):
        position = round(at * SR)
        length = min(round(duration * SR), total - position)
        if length <= 0 or position < 0:
            return
        t = np.arange(length) / SR
        frequency = 440 * 2 ** ((midi - 69) / 12)
        if kind == "mallet":
            envelope = (1 - np.exp(-t * 210)) * np.exp(-t * 2.9)
            sound = (np.sin(2 * np.pi * frequency * t)
                     + .23 * np.sin(2 * np.pi * frequency * 3 * t) * np.exp(-t * 6)
                     + .07 * np.sin(2 * np.pi * frequency * 7 * t) * np.exp(-t * 10))
        else:
            envelope = (1 - np.exp(-t * 80)) * np.exp(-t * .9)
            sound = sum(weight * np.sin(2 * np.pi * frequency * harmonic * t)
                        for harmonic, weight in [(1, 1), (2, .19), (3, .08), (4, .03)])
        envelope *= np.minimum(1, np.maximum(0, (duration - t) / .4))
        mono = sound * envelope * gain
        score[position:position + length, 0] += mono * math.sqrt((1 - pan) / 2)
        score[position:position + length, 1] += mono * math.sqrt((1 + pan) / 2)

    beat = 60 / 76
    chords = [(50, 57, 66), (47, 54, 62), (43, 50, 59), (45, 52, 61),
              (50, 57, 62), (43, 54, 59), (47, 57, 62), (45, 57, 61)]
    for bar, at in enumerate(np.arange(.3, seconds - 3.7, 4 * beat)):
        chord = chords[bar % len(chords)]
        for part, midi in enumerate(chord):
            note(float(at) + part * .075, midi, 4.3, .023, (-.28, .08, .3)[part], "keyboard")
        if bar % 2:
            note(float(at) + 2 * beat, chord[0] - 12, 1.0, .013, -.05, "keyboard")

    motifs = [[74, 78, 81, 78, 76, 74], [71, 74, 78, 76, 74],
              [74, 76, 78, 81, 78], [78, 81, 83, 81, 78, 76],
              [76, 74, 71, 69, 74], [71, 74, 76, 78, 74]]
    for index, scene in enumerate(scenes):
        motif = motifs[index % len(motifs)]
        interval = beat * (2.1 if index in (3, 4, 8) else 2.7)
        for n, at in enumerate(np.arange(scene["start"] + .8, scene["end"] - 1.9, interval)):
            pitch = motif[n % len(motif)]
            note(float(at), pitch, 2.7, .065 if n % 3 else .074,
                 .26 * math.sin(index + n * 1.6), "mallet" if n % 3 else "keyboard")
        if index > 0:
            note(scene["start"] + .08, 86 if index % 2 else 81, 1.7, .012, -.18)
        # Gentle brush rhythm in the busier chapters; no continuous click track.
        if index in (3, 4, 8):
            for at in np.arange(scene["start"] + 2, scene["end"] - 2, 4 * beat):
                length = round(.11 * SR)
                soft = np.convolve(rng.standard_normal(length), np.ones(31) / 31, mode="same")
                soft *= np.exp(-np.arange(length) / SR * 38) * .008
                position = round(at * SR)
                score[position:position + length, :] += soft[:, None]

    # Resolve the whole piece, then allow the final brand image to breathe.
    for part, midi in enumerate((50, 57, 62, 66, 74)):
        note(seconds - 3.5 + part * .11, midi, 3.3, .023 if part < 4 else .05,
             -.2 + part * .1, "keyboard")
    dry = score.copy()
    for delay, amount in [(.087, .1), (.173, .07), (.29, .04), (.41, .02)]:
        shift = round(delay * SR)
        score[shift:] += dry[:-shift, ::-1] * amount
    del dry
    envelope = np.ones(total, np.float32)
    # Slow chapter-level attenuation leaves consonants and breaths clear.
    for scene in scenes:
        a = max(0, round((scene["speechStart"] - .15) * SR))
        b = min(total, round((scene["speechEnd"] + .15) * SR))
        ramp = min(round(.4 * SR), (b - a) // 2)
        envelope[a:a + ramp] = np.minimum(envelope[a:a + ramp], np.linspace(1, .78, ramp))
        envelope[a + ramp:b - ramp] = np.minimum(envelope[a + ramp:b - ramp], .78)
        envelope[b - ramp:b] = np.minimum(envelope[b - ramp:b], np.linspace(.78, 1, ramp))
    envelope[:round(.8 * SR)] *= np.linspace(0, 1, round(.8 * SR))
    fade = round(MUSIC_FADE * SR)
    envelope[-fade:] *= np.linspace(1, 0, fade)
    score *= envelope[:, None]
    return score


# 将秒量化为毫秒并格式化 SRT 时间戳，统一字幕导出表示。
# Quantize seconds to milliseconds and format a consistent SRT timestamp.
def srt_time(seconds: float) -> str:
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


# 检查 FFmpeg 依赖，按模式生成或复用旁白时间线，再导出配乐、字幕和元数据；失败不标记音频就绪。
# Check FFmpeg dependencies, generate/reuse narration timing by mode and export music/captions/metadata without claiming readiness after failure.
async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--music-only", action="store_true", help="Offline: reuse transcript timeline and regenerate music")
    parser.add_argument("--force-tts", action="store_true", help="Re-request public speech, ignoring cached scene MP3")
    args = parser.parse_args()
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise SystemExit("FFmpeg and FFprobe must be on PATH")
    storyboard_path = ROOT / "STORYBOARD.json"
    storyboard = json.loads(storyboard_path.read_text(encoding="utf-8"))
    output = ROOT / "public" / "audio"
    cache = ROOT / ".cache" / "audio-v1.1"
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    if args.music_only:
        metadata = json.loads((output / "transcript.json").read_text(encoding="utf-8"))
    else:
        samples, scenes, captions = await narration(storyboard, cache, args.force_tts)
        duration_frames = sum(scene["durationInFrames"] for scene in scenes)
        metadata = {"videoVersion": storyboard["videoVersion"], "duration": duration_frames / storyboard["fps"],
                    "durationInFrames": duration_frames, "fps": storyboard["fps"], "sampleRate": SR,
                    "channels": 2, "voice": VOICE, "rate": RATE, "pitch": PITCH,
                    "voiceSelection": "User-selected sample A; non-imitative prebuilt synthetic female voice",
                    "ttsLibrary": "edge-tts 7.2.8", "timingPolicy": "Actual complete speech; frame-aligned scene boundaries; no time stretching",
                    "storyboardSha256": hashlib.sha256(storyboard_path.read_bytes()).hexdigest(),
                    "music": "Original procedural composition", "musicFadeOutSeconds": MUSIC_FADE,
                    "scenes": scenes, "captions": captions}
        metadata["narration"] = write_normalized(samples, output / "narration.wav", cache, -18)
        del samples
        (output / "narration.srt").write_text("\n\n".join(
            f"{index + 1}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n{cue['text']}"
            for index, cue in enumerate(captions)) + "\n", encoding="utf-8")
    music = soundtrack(metadata["durationInFrames"], metadata["fps"], metadata["scenes"])
    metadata["soundtrack"] = write_normalized(music, output / "soundtrack.wav", cache, -30)
    (output / "transcript.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {metadata['duration']:.6f}s / {metadata['durationInFrames']} frames, 48kHz stereo WAV tracks.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
