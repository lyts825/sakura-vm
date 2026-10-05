"""Generate the public Sakura narration and an original instrumental score.

Python 3.12, edge-tts 7.2.8, numpy 2.4.2, FFmpeg on PATH.
Only the six public promotional sentences below are sent to Edge TTS.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import shutil
import subprocess
from pathlib import Path

import edge_tts
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SR = 48000
SECONDS = 45
VOICE = "zh-CN-XiaoxiaoNeural"
SCENES = [
    (0, 6, "Sakura。让 Linux，在本地生长。", 0),
    (6, 14, "从基础 Alpine 终端开始。创建、启动和停止实例，数据保存在持久磁盘。", 8),
    (14, 22, "QEMU 真正运行 Linux 内核。PosixLoom，编排命令与会话。", 0),
    (22, 32, "文件、多终端、项目、Git 和快照，按需选择插件。保存后，重启 Sakura 服务生效。", 8),
    (32, 40, "把代码、文件和终端，组织成本地工作空间。按需组合，专注创造。", 0),
    (40, 45, "从一个终端，长成你的工作空间。", 0),
]


def run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, capture_output=True)


def decode(path: Path) -> np.ndarray:
    result = run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
                  "-ar", str(SR), "-ac", "1", "pipe:1"])
    return np.frombuffer(result.stdout, dtype="<f4").copy()


def write_normalized(samples: np.ndarray, output: Path, cache: Path, target: float) -> dict:
    raw = cache / (output.stem + ".f32")
    samples.astype("<f4").tofile(raw)
    common = ["ffmpeg", "-hide_banner", "-nostats", "-f", "f32le", "-ar", str(SR),
              "-ac", "2", "-i", str(raw)]
    measured = run(common + ["-af", f"loudnorm=I={target}:TP=-2:LRA=8:print_format=json",
                             "-f", "null", "-"]).stderr.decode("utf-8", errors="replace")
    values = json.loads(measured[measured.rfind("{"):measured.rfind("}") + 1])
    filt = (f"loudnorm=I={target}:TP=-2:LRA=8:measured_I={values['input_i']}:"
            f"measured_TP={values['input_tp']}:measured_LRA={values['input_lra']}:"
            f"measured_thresh={values['input_thresh']}:offset={values['target_offset']}:"
            "linear=true,aresample=48000")
    run(common + ["-y", "-af", filt, "-t", str(SECONDS), "-c:a", "pcm_s24le", str(output)])
    raw.unlink()
    verified = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(output), "-af",
                    f"loudnorm=I={target}:TP=-1:LRA=8:print_format=json", "-f", "null", "-"])
    report = verified.stderr.decode("utf-8", errors="replace")
    actual = json.loads(report[report.rfind("{"):report.rfind("}") + 1])
    (cache / (output.stem + "-measurements.json")).write_text(
        json.dumps({"beforeNormalization": values, "afterNormalization": actual}, indent=2) + "\n",
        encoding="utf-8")
    return {"targetIntegratedLufs": target,
            "verifiedIntegratedLufs": float(actual["input_i"]),
            "verifiedTruePeakDbtp": float(actual["input_tp"])}


async def synthesize(text: str, rate: int, output: Path) -> list[dict]:
    boundaries = []
    communicate = edge_tts.Communicate(text, VOICE, rate=f"{rate:+d}%", boundary="SentenceBoundary")
    with output.open("wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "SentenceBoundary":
                boundaries.append({"start": chunk["offset"] / 10_000_000,
                                   "duration": chunk["duration"] / 10_000_000,
                                   "text": chunk["text"]})
    return boundaries


async def narration(cache: Path) -> tuple[np.ndarray, list[dict], list[dict]]:
    track = np.zeros((SR * SECONDS, 2), np.float32)
    scenes, captions = [], []
    for index, (start, end, text, initial_rate) in enumerate(SCENES):
        speech_start = start + (0.25 if index == 5 else 0.4)
        available = end - speech_start - (0.45 if index == 5 else 0.35)
        rate = initial_rate
        for attempt in range(4):
            mp3 = cache / f"scene-{index + 1}.mp3"
            boundaries = await synthesize(text, rate, mp3)
            samples = decode(mp3)
            # Keep the generated signal intact; adjust TTS speaking rate instead of cutting tails.
            duration = len(samples) / SR
            if duration <= available:
                break
            rate = math.ceil((100 + rate) * duration / available - 100) + 2
        else:
            raise RuntimeError(f"Scene {index + 1} still exceeds its slot: {duration:.3f}s")
        offset = round(speech_start * SR)
        track[offset:offset + len(samples), 0] = samples
        track[offset:offset + len(samples), 1] = samples
        scene = {"index": index + 1, "start": start, "end": end, "text": text,
                 "speechStart": speech_start, "speechEnd": speech_start + duration,
                 "rate": f"{rate:+d}%"}
        scenes.append(scene)
        if boundaries:
            for boundary in boundaries:
                cue_start = speech_start + boundary["start"]
                cue_end = min(speech_start + duration, cue_start + boundary["duration"] + 0.12)
                captions.append({"start": round(cue_start, 3), "end": round(cue_end, 3),
                                 "text": boundary["text"]})
        else:
            captions.append({"start": speech_start, "end": speech_start + duration, "text": text})
        print(f"Scene {index + 1}: {duration:.3f}s, {rate:+d}%, {speech_start:.2f}–{speech_start + duration:.2f}s", flush=True)
    # Edge sentence boundaries can overlap slightly; a subtitle renderer must see one cue at a time.
    for current, following in zip(captions, captions[1:]):
        current["end"] = round(min(current["end"], following["start"] - .01), 3)
    return track, scenes, captions


def soundtrack() -> np.ndarray:
    """Original D-major pentatonic mallet melody, warm keyboard chords and sparse pulse."""
    score = np.zeros((SR * SECONDS, 2), np.float32)
    rng = np.random.default_rng(20261006)

    def note(at: float, midi: int, duration: float, gain: float, pan: float, kind="mallet"):
        length = min(round(duration * SR), len(score) - round(at * SR))
        if length <= 0:
            return
        t = np.arange(length) / SR
        frequency = 440 * 2 ** ((midi - 69) / 12)
        if kind == "mallet":
            envelope = (1 - np.exp(-t * 250)) * np.exp(-t * 3.2)
            sound = (np.sin(2 * np.pi * frequency * t)
                     + 0.28 * np.sin(2 * np.pi * frequency * 3 * t) * np.exp(-t * 6)
                     + 0.12 * np.sin(2 * np.pi * frequency * 7 * t) * np.exp(-t * 10))
        else:
            envelope = (1 - np.exp(-t * 100)) * np.exp(-t * 1.15)
            sound = sum(weight * np.sin(2 * np.pi * frequency * harmonic * t)
                        for harmonic, weight in [(1, 1), (2, .24), (3, .1), (4, .04)])
        envelope *= np.minimum(1, np.maximum(0, (duration - t) / 0.3))
        mono = sound * envelope * gain
        position = round(at * SR)
        score[position:position + length, 0] += mono * math.sqrt((1 - pan) / 2)
        score[position:position + length, 1] += mono * math.sqrt((1 + pan) / 2)

    beat = 60 / 72
    # Composed specifically for this 45-second film, with a quiet resolving final phrase.
    melody = [(0, 74), (2, 78), (3.5, 81), (5, 78), (7, 76), (9, 74),
              (11, 69), (13, 71), (15, 74), (17, 78), (19, 76), (21, 74),
              (23, 71), (25, 69), (27, 74), (29, 78), (31, 81), (33, 78),
              (35, 76), (37, 74), (39, 71), (41, 74), (43, 78), (45, 81),
              (47, 78), (49, 76), (50.5, 74)]
    for index, (pulse, midi) in enumerate(melody):
        note(0.65 + pulse * beat, midi, 2.2, .085 if pulse < 47 else .07,
             .24 * math.sin(index * 1.4))
    chords = [(50, 57, 66), (47, 54, 62), (43, 50, 59), (45, 52, 61)]
    for bar in range(13):
        at = .4 + bar * 4 * beat
        chord = chords[bar % 4] if bar < 12 else chords[0]
        for index, pitch in enumerate(chord):
            note(at + index * .09, pitch, 4.2, .028, (-.25, .1, .3)[index], "keyboard")
    # Small rounded bass pulse and filtered shaker only after the introduction.
    for pulse in range(8, 47, 2):
        at = .4 + pulse * beat
        note(at, [38, 35, 31, 33][(pulse // 4) % 4], .6, .015, 0, "keyboard")
        length = round(.11 * SR)
        noise = rng.standard_normal(length)
        soft = np.convolve(noise, np.ones(25) / 25, mode="same")
        soft *= np.exp(-np.arange(length) / SR * 45) * .014
        position = round((at + beat) * SR)
        if position + length < len(score):
            score[position:position + length, :] += soft[:, None]
    # Original soft, high chimes mark scene changes without masking consonants.
    for at in [6, 14, 22, 32, 40]:
        note(at + .03, 86, 1.7, .016, -.2)
    dry = score.copy()
    for delay, amount in [(.087, .12), (.173, .08), (.29, .055), (.41, .025)]:
        shift = round(delay * SR)
        score[shift:] += dry[:-shift, ::-1] * amount
    fade_in = np.minimum(1, np.arange(len(score)) / (SR * .7))
    fade_out = np.minimum(1, (len(score) - 1 - np.arange(len(score))) / (SR * 1.2))
    score *= (fade_in * fade_out)[:, None]
    return score


def srt_time(seconds: float) -> str:
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--music-only", action="store_true", help="Offline: regenerate only original music")
    args = parser.parse_args()
    if not shutil.which("ffmpeg"):
        raise SystemExit("FFmpeg must be on PATH")
    output = ROOT / "public" / "audio"
    cache = ROOT / ".cache" / "audio"
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    metadata = {"duration": SECONDS, "sampleRate": SR, "channels": 2,
                "voice": VOICE, "ttsLibrary": "edge-tts 7.2.8", "music": "Original procedural composition",
                "musicFadeOutSeconds": 1.2}
    if not args.music_only:
        samples, scenes, captions = await narration(cache)
        metadata["narration"] = write_normalized(samples, output / "narration.wav", cache, -18)
        metadata["scenes"] = scenes
        metadata["captions"] = captions
        (output / "narration.srt").write_text("\n\n".join(
            f"{index + 1}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n{cue['text']}"
            for index, cue in enumerate(captions)) + "\n", encoding="utf-8")
    metadata["soundtrack"] = write_normalized(soundtrack(), output / "soundtrack.wav", cache, -29)
    if not args.music_only:
        (output / "transcript.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Wrote 45-second, 48kHz stereo WAV tracks.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
