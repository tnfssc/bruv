"""Shared PIL snapshot renderer; callers own provenance and acceptance audits."""
import math
import os
import re
import subprocess
import unicodedata

from PIL import Image, ImageDraw, ImageFont


FRAME_SIZE = (1600, 1200)
FPS = 5
CELL_WIDTH = 11
CELL_HEIGHT = 22
DEFAULT_FOREGROUND = "#e2e8f0"
PALETTE = [
    "#0f172a", "#f87171", "#86efac", "#fde68a",
    "#93c5fd", "#c4b5fd", "#67e8f9", DEFAULT_FOREGROUND,
]


def _ansi_color(index):
    if index < 16:
        return PALETTE[index % 8]
    if index >= 232:
        return (8 + (index - 232) * 10,) * 3
    index -= 16
    levels = [0, 95, 135, 175, 215, 255]
    return tuple(levels[channel] for channel in (index // 36, (index // 6) % 6, index % 6))


def _sgr_colors(token, foreground, background):
    """Apply one SGR token, consuming extended-color operands with their code."""
    parameters = [int(value or 0) for value in token[2:-1].split(";")]
    i = 0
    while i < len(parameters):
        code = parameters[i]
        if code == 0:
            foreground, background = DEFAULT_FOREGROUND, None
        elif code == 39:
            foreground = DEFAULT_FOREGROUND
        elif code == 49:
            background = None
        elif 30 <= code <= 37:
            foreground = PALETTE[code - 30]
        elif 90 <= code <= 97:
            foreground = PALETTE[code - 90]
        elif 40 <= code <= 47:
            background = PALETTE[code - 40]
        elif code in (38, 48) and i + 2 < len(parameters):
            color = None
            if parameters[i + 1] == 5:
                color = _ansi_color(parameters[i + 2])
                i += 2
            elif parameters[i + 1] == 2 and i + 4 < len(parameters):
                color = tuple(parameters[i + 2:i + 5])
                i += 4
            if color is not None:
                if code == 38:
                    foreground = color
                else:
                    background = color
        # Bold (1/22) and other unsupported attributes have no visual effect.
        i += 1
    return foreground, background


class _SnapshotRenderer:
    """Own the fonts and fixed presentation for one snapshot video."""

    def __init__(self, heading, subheading, footer):
        self.heading = heading
        self.subheading = subheading
        self.footer = footer
        font_path = "/usr/share/fonts/noto/NotoSansMono-Regular.ttf"
        symbol_path = "/usr/share/fonts/TTF/MesloLGMDZNerdFontMono-Regular.ttf"
        self.mono_font = ImageFont.truetype(font_path, 18)
        self.symbol_font = (
            ImageFont.truetype(symbol_path, 18) if os.path.exists(symbol_path) else self.mono_font
        )
        self.title_font = ImageFont.truetype(font_path, 24)
        self.small_font = ImageFont.truetype(font_path, 16)
        self.caption_font = ImageFont.truetype(font_path, 20)

    def _draw_screen(self, draw, text):
        # Captures are complete snapshots: colors persist across lines, not frames.
        foreground, background = DEFAULT_FOREGROUND, None
        for row, line in enumerate(text.splitlines()[:44]):
            column = 0
            for token in re.split(r"(\x1b\[[0-9;]*m)", line):
                if token.startswith("\x1b"):
                    foreground, background = _sgr_colors(token, foreground, background)
                    continue
                for char in token:
                    if ord(char) < 32:
                        continue
                    if unicodedata.combining(char):
                        width = 0
                    elif unicodedata.east_asian_width(char) in ("W", "F"):
                        width = 2
                    else:
                        width = 1
                    x = 44 + column * CELL_WIDTH
                    y = 151 + row * CELL_HEIGHT
                    if background:
                        draw.rectangle((x, y, x + width * CELL_WIDTH, y + CELL_HEIGHT), fill=background)
                    font = (
                        self.symbol_font
                        if ord(char) >= 0xE000 or char in ("✗", "✓", "⚠")
                        else self.mono_font
                    )
                    draw.text((x, y), char, font=font, fill=foreground, stroke_width=0)
                    column += width
                    # Preserve the snapshot renderer's token-local clipping.
                    if column >= 120:
                        break

    def frame(self, row, t):
        image = Image.new("RGB", FRAME_SIZE, "#0b1220")
        draw = ImageDraw.Draw(image)
        draw.text((36, 20), self.heading, font=self.title_font, fill="#f8fafc")
        draw.text((36, 60), self.subheading, font=self.small_font, fill="#94a3b8")
        draw.text((36, 102), row["caption"], font=self.caption_font, fill="#67e8f9")
        draw.rounded_rectangle((30, 143, 1570, 1135), radius=9, fill="#111827", outline="#334155")
        self._draw_screen(draw, row["screen"])
        draw.text((36, 1155), self.footer(t), font=self.small_font, fill="#94a3b8")
        return image


def render_video(rows, video, heading, subheading, footer, audit_frame=None):
    duration = rows[-1]["t"]
    frames = math.ceil(duration * FPS)
    renderer = _SnapshotRenderer(heading, subheading, footer)
    proc = subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "warning",
        "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", f"{FRAME_SIZE[0]}x{FRAME_SIZE[1]}", "-framerate", str(FPS),
        "-i", "pipe:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(video),
    ], stdin=subprocess.PIPE)

    row_index = 0
    sampled_steps = set()
    for frame in range(frames):
        t = frame / FPS
        while row_index + 1 < len(rows) and rows[row_index + 1]["t"] <= t:
            row_index += 1
        row = rows[row_index]
        image = renderer.frame(row, t)
        if audit_frame:
            audit_frame(frame, t, row)
        proc.stdin.write(image.tobytes())
        # Audit may replace this timeline entry; sampling re-reads its timestamp.
        if row["step"] not in sampled_steps and t - rows[row_index]["t"] >= 0:
            image.save(str(video.parent / ("sample-" + row["step"] + ".png")))
            sampled_steps.add(row["step"])

    proc.stdin.close()
    assert proc.wait() == 0
    return frames, FPS
