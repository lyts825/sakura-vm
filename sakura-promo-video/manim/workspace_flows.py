# 绘制磁盘恢复及项目账户边界的 Manim 动画，为宣传视频提供可重用流程片段。
# Create reusable Manim clips for disk-recovery semantics and project-account boundaries.
"""Ten-second recovery and project-account explainers for Sakura video 1.1.

These illustrate disk recovery semantics and Linux account boundaries.
Neither scene represents a guarantee of recovery success or VM isolation.
"""

from manim import (
    Scene, VGroup, RoundedRectangle, Text, Line, Dot, FadeIn, Create,
    MoveAlongPath, Indicate, DOWN, UP, LEFT, RIGHT, WHITE, BOLD, smooth,
)

from kernel_flow import BG, INK, PINK, PALE, MUTED, WIRE, FONT


# 用固定 Pango 字体创建可指定字号/颜色/粗细的文本节点，保持流程片段字形一致。
# Create text with the fixed Pango font and size/color/weight options for consistent flow typography.
def label(text, size=38, color=INK, bold=False):
    return Text(text, font=FONT, font_size=size, color=color,
                weight=BOLD if bold else "NORMAL")


# 组合圆角底框、可换行标题和可选副标题，按输入尺寸/位置返回整体节点。
# Combine a rounded card, multiline title and optional subtitle into one positioned node of supplied dimensions.
def card(title, subtitle, width, height, position, size=42, accent=False):
    box = RoundedRectangle(width=width, height=height, corner_radius=0.21,
                           stroke_color=PINK if accent else WIRE, stroke_width=2.5,
                           fill_color=PALE if accent else WHITE, fill_opacity=1)
    titles = VGroup(*(label(line, size, bold=True) for line in title.split("\n")))
    titles.arrange(DOWN, buff=0.06)
    content = titles
    if subtitle:
        content = VGroup(titles, label(subtitle, 21, MUTED)).arrange(DOWN, buff=0.15)
    content.move_to(box)
    return VGroup(box, content).move_to(position)


# 创建指定端点间的统一颜色/线宽连线，供流程图连接。
# Create a consistently styled line between supplied endpoints for flow connections.
def wire(start, end):
    return Line(start, end, color=WIRE, stroke_width=3)


class RecoveryFlow(Scene):
    """Stopped disk: restore original, clone independently, backup to new."""

    # 从停机原磁盘分别演示快照、独立克隆与校验备份的恢复去向，避免把三种恢复语义混同。
    # Animate distinct snapshot/independent-clone/verified-backup paths from a stopped original disk, preserving their different recovery meanings.
    def construct(self):
        self.camera.background_color = BG
        original = card("Stopped\ninstance", "ORIGINAL DISK", 3.25, 2.1,
                        LEFT * 5.77 + UP * 0.35, size=43, accent=True)
        rows = [2.55, 0.35, -1.85]
        actions = [
            card("Snapshot", "DISK STATE", 3.75, 1.55, [-0.22, rows[0], 0], size=45),
            card("Clone", "DISK COPY", 3.75, 1.55, [-0.22, rows[1], 0], size=48),
            card("Verified backup", "CHECKSUM VERIFIED", 3.75, 1.55,
                 [-0.22, rows[2], 0], size=34),
        ]
        targets = [
            card("Restore", "ORIGINAL INSTANCE", 4.45, 1.55, [5.16, rows[0], 0], size=48),
            card("Independent", "NEW INSTANCE", 4.45, 1.55, [5.16, rows[1], 0], size=43),
            card("Restore to\nnew instance", "", 4.45, 1.55,
                 [5.16, rows[2], 0], size=40),
        ]
        incoming = [wire(original[0].get_right(), action[0].get_left()) for action in actions]
        outgoing = [wire(action[0].get_right(), target[0].get_left())
                    for action, target in zip(actions, targets)]
        disk_note = label("Disk state  /  Cold start", 27, MUTED).move_to(DOWN * 3.19)

        self.play(FadeIn(original, shift=UP * 0.12), run_time=0.8)
        self.play(*(Create(path) for path in incoming), run_time=0.4)
        for action, target, path in zip(actions, targets, outgoing):
            self.play(FadeIn(action, shift=RIGHT * 0.1), run_time=0.6)
            self.play(Create(path), FadeIn(target, shift=RIGHT * 0.1), run_time=0.6)
            dot = Dot(radius=0.085, color=PINK).move_to(path.get_start())
            self.add(dot)
            self.play(MoveAlongPath(dot, path, rate_func=smooth),
                      action[0].animate.set_stroke(PINK).set_fill(PALE), run_time=0.6)
            self.remove(dot)
        self.play(*(target[0].animate.set_stroke(PINK).set_fill(PALE) for target in targets),
                  FadeIn(disk_note), run_time=0.6)
        self.wait(2.8)  # 10.0 seconds / 300 frames at 30 fps.


class ProjectIsolation(Scene):
    """Two persistent project accounts inside one shared Linux instance."""

    # 在同一实例中演示各项目 UID/Home 与执行域，以及本机控制入口和项目权限之间的边界。
    # Animate per-project UID/Home/execution domains inside one instance and the boundary between local control and project authority.
    def construct(self):
        self.camera.background_color = BG
        control = card("Sakura", "LOCAL CONTROL PLANE", 6.15, 1.45,
                       UP * 2.95, size=54, accent=True)
        instance = RoundedRectangle(width=14.5, height=5.25, corner_radius=0.32,
                                    stroke_color=WIRE, stroke_width=2.7,
                                    fill_color=PALE, fill_opacity=0.32).move_to(DOWN * 0.83)
        instance_title = label("One Linux instance", 30, MUTED).move_to(UP * 1.39)
        boxes, headings, identity_rows, home_rows, process_rows = [], [], [], [], []
        paths = []
        for name, center_x in [("Project A", -3.54), ("Project B", 3.54)]:
            box = RoundedRectangle(width=5.92, height=3.3, corner_radius=0.24,
                                   stroke_color=WIRE, stroke_width=2.5,
                                   fill_color=WHITE, fill_opacity=1).move_to([center_x, -0.62, 0])
            heading = label(name, 46, bold=True).move_to([center_x, 0.46, 0])
            identity = label("UID / GID", 37).move_to([center_x, -0.3, 0])
            home = label("Private home", 37).move_to([center_x, -1.0, 0])
            process = label("Own processes", 37).move_to([center_x, -1.7, 0])
            boxes.append(box)
            headings.append(heading)
            identity_rows.append(identity)
            home_rows.append(home)
            process_rows.append(process)
            paths.append(wire(control[0].get_bottom(), box.get_top()))
        boundary_note = label("Linux account boundaries  /  Shared kernel", 27, MUTED)
        boundary_note.move_to(DOWN * 2.9)

        self.play(FadeIn(control, shift=UP * 0.1), run_time=0.6)
        self.play(Create(instance), run_time=0.6)
        self.play(FadeIn(instance_title), run_time=0.4)
        self.play(*(Create(path) for path in paths), run_time=0.6)
        self.play(*(FadeIn(VGroup(box, heading), shift=UP * 0.1)
                    for box, heading in zip(boxes, headings)), run_time=0.6)
        self.play(*(FadeIn(row) for row in identity_rows), run_time=0.6)
        self.play(*(FadeIn(row) for row in home_rows), run_time=0.6)
        self.play(*(FadeIn(row) for row in process_rows), run_time=0.6)
        particles = VGroup(*(Dot(radius=0.085, color=PINK).move_to(path.get_start())
                             for path in paths))
        self.add(particles)
        self.play(*(MoveAlongPath(dot, path, rate_func=smooth)
                    for dot, path in zip(particles, paths)), run_time=1.0)
        self.remove(particles)
        self.play(*(box.animate.set_stroke(PINK) for box in boxes),
                  *(Indicate(row, color=PINK, scale_factor=1.025) for row in process_rows),
                  run_time=1.0)
        self.play(FadeIn(boundary_note), run_time=0.6)
        self.wait(2.8)  # 10.0 seconds / 300 frames at 30 fps.
