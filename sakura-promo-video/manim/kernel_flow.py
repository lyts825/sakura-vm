# 绘制 PosixLoom 管理与 QEMU/Linux 内核职责的 Manim 流程动画，使用 Pango 文本并保留两个分支的职责区别。
"""Eight-second Sakura runtime explainer, rendered with Manim Community.

The two branches represent responsibilities, not alternative Linux backends.
Text uses Pango; this scene has no LaTeX dependency.
"""

from manim import (
    Scene, VGroup, RoundedRectangle, Text, Line, Dot,
    FadeIn, Create, MoveAlongPath, Indicate,
    UP, DOWN, LEFT, RIGHT, WHITE, BOLD, smooth,
)


BG = "#FAF7F9"
INK = "#352637"
PINK = "#D986A3"
PALE = "#F3E3EB"
MUTED = "#8D7787"
WIRE = "#C9B4C2"
FONT = "Segoe UI"


class KernelFlow(Scene):
    """Sakura coordinates host commands and QEMU virtual machines."""

    def node(self, title, subtitle, width, position, title_size=48, accent=False):
        box = RoundedRectangle(
            width=width, height=1.58, corner_radius=0.23,
            stroke_color=PINK if accent else WIRE, stroke_width=2.6,
            fill_color=PALE if accent else WHITE, fill_opacity=1,
        ).move_to(position)
        heading = Text(title, font=FONT, font_size=title_size,
                       color=INK, weight=BOLD)
        if isinstance(subtitle, tuple):
            caption = VGroup(*(Text(line, font=FONT, font_size=21, color=MUTED)
                               for line in subtitle)).arrange(DOWN, buff=0.055)
        else:
            caption = Text(subtitle, font=FONT, font_size=23, color=MUTED)
        labels = VGroup(heading, caption).arrange(DOWN, buff=0.16).move_to(box)
        return VGroup(box, labels)

    def construct(self):
        self.camera.background_color = BG
        # 16 x 9 logical canvas; substantial labels survive the Remotion inset.
        sakura = self.node("Sakura", "LOCAL LINUX WORKSPACE", 5.1,
                           UP * 2.78, title_size=62, accent=True)
        posix = self.node("PosixLoom", "COMMANDS  /  SESSIONS", 5.2,
                          LEFT * 3.48 + UP * 0.12, title_size=48)
        qemu = self.node("QEMU", "VIRTUALIZATION", 5.2,
                         RIGHT * 3.48 + UP * 0.12, title_size=56)
        kernel = self.node("Linux kernel", "REAL LINUX", 3.7,
                           RIGHT * 1.41 + DOWN * 2.62, title_size=40)
        disk = self.node("QCOW2 disk", ("PERSISTENT", "PER INSTANCE"), 4.08,
                         RIGHT * 5.49 + DOWN * 2.62, title_size=40)

        # Each visible wire meets card edges; no connector crosses a label.
        root_l = Line(sakura[0].get_bottom(), posix[0].get_top(),
                      color=WIRE, stroke_width=3.2)
        root_r = Line(sakura[0].get_bottom(), qemu[0].get_top(),
                      color=WIRE, stroke_width=3.2)
        qemu_k = Line(qemu[0].get_bottom(), kernel[0].get_top(),
                      color=WIRE, stroke_width=3.2)
        qemu_d = Line(qemu[0].get_bottom(), disk[0].get_top(),
                      color=WIRE, stroke_width=3.2)

        host_detail = Text("Windows process tree", font=FONT, font_size=25,
                           color=MUTED).next_to(posix, DOWN, buff=0.31)
        status_dot = Dot(radius=0.07, color=PINK).next_to(host_detail, LEFT, buff=0.17)
        host_caption = VGroup(status_dot, host_detail)

        # Exact timeline: 8 seconds = 240 frames at 30 fps.
        self.play(FadeIn(sakura, shift=UP * 0.12), run_time=0.6)           # 0.0–0.6
        self.play(Create(root_l), Create(root_r), run_time=0.5)          # 0.6–1.1
        self.play(FadeIn(posix, shift=UP * 0.1),
                  FadeIn(qemu, shift=UP * 0.1), run_time=0.6)           # 1.1–1.7
        self.play(FadeIn(host_caption),
                  posix[0].animate.set_stroke(PINK), run_time=0.5)      # 1.7–2.2
        self.play(Create(qemu_k), Create(qemu_d), run_time=0.5)          # 2.2–2.7
        self.play(FadeIn(kernel, shift=UP * 0.1),
                  FadeIn(disk, shift=UP * 0.1), run_time=0.6)           # 2.7–3.3

        dots = VGroup(Dot(radius=0.075, color=PINK).move_to(root_l.get_start()),
                      Dot(radius=0.075, color=PINK).move_to(root_r.get_start()))
        self.add(dots)
        self.play(MoveAlongPath(dots[0], root_l, rate_func=smooth),
                  MoveAlongPath(dots[1], root_r, rate_func=smooth),
                  run_time=0.8)                                       # 3.3–4.1
        self.remove(dots)
        self.play(qemu[0].animate.set_stroke(PINK),
                  posix[0].animate.set_fill(PALE), run_time=0.4)        # 4.1–4.5

        children = VGroup(Dot(radius=0.075, color=PINK).move_to(qemu_k.get_start()),
                          Dot(radius=0.075, color=PINK).move_to(qemu_d.get_start()))
        self.add(children)
        self.play(MoveAlongPath(children[0], qemu_k, rate_func=smooth),
                  MoveAlongPath(children[1], qemu_d, rate_func=smooth),
                  run_time=0.8)                                       # 4.5–5.3
        self.remove(children)
        self.play(kernel[0].animate.set_stroke(PINK).set_fill(PALE),
                  disk[0].animate.set_stroke(PINK).set_fill(PALE),
                  run_time=0.5)                                       # 5.3–5.8
        self.play(Indicate(kernel[0], color=PINK, scale_factor=1.025),
                  Indicate(disk[0], color=PINK, scale_factor=1.025),
                  run_time=0.6)                                       # 5.8–6.4
        self.wait(1.6)                                                # 6.4–8.0
