# Sakura runtime animation

An 8-second Manim Community scene for the 14–22 second section of the Sakura introduction video. The diagram distinguishes PosixLoom's host orchestration from QEMU virtualization and shows the Linux kernel and each instance's persistent QCOW2 disk under QEMU.

Rendered with **Manim Community 0.21.0**, Python 3.12, Cairo, and Pango `Text` using **Segoe UI**. No LaTeX installation is required. The final source asset is `../public/manim/kernel-flow.mp4`: H.264, 1920×1080, 30 fps, 240 frames, exactly 8 seconds, no audio. Background `#FAF7F9` matches the composition.

Run from `sakura-promo-video` in PowerShell:

```powershell
uv venv .venv --python 3.12
uv pip install --python .venv\Scripts\python.exe -r manim\requirements.txt
.venv\Scripts\python.exe -m manim --config_file manim\manim.cfg --media_dir .cache\manim --resolution 854,480 --fps 30 -o kernel-flow-preview manim\kernel_flow.py KernelFlow
.venv\Scripts\python.exe -m manim --config_file manim\manim.cfg --media_dir .cache\manim --resolution 1920,1080 --fps 30 -o kernel-flow manim\kernel_flow.py KernelFlow
New-Item -ItemType Directory -Force public\manim
Copy-Item -LiteralPath .cache\manim\videos\kernel_flow\1080p30\kernel-flow.mp4 -Destination public\manim\kernel-flow.mp4
```

The environment and render cache are local build dependencies, not needed for playback or Remotion composition. Regeneration needs Python 3.12, the pinned dependency, and Segoe UI; another OS may need a font substitution. See the [official installation guide](https://docs.manim.community/en/stable/installation.html) and [quickstart](https://docs.manim.community/en/stable/tutorials/quickstart.html).

Verification: preview and final frames inspected; runtime/stream metadata and decoded frame count checked with ffprobe. Test images and logs stay in `.cache/manim`.
