"""Snapshot rendering contracts; no ffmpeg, font files, or capture fixture required."""
import importlib.util
from contextlib import ExitStack
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "ansi_video_renderer", Path(__file__).resolve().parents[2] / "scripts/ansi_video_renderer.py"
)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def snapshot(screen, t=0, step="first"):
    return {"screen": screen, "t": t, "step": step, "caption": "caption-" + step}


class RenderCapture:
    """Fake PIL/encoder environment and observations for one render invocation."""

    def __init__(self, symbols=True, exit_code=0):
        self.symbols = symbols
        self.images, self.events = [], []
        self.proc = Mock()
        self.proc.stdin.write.side_effect = lambda data: self.events.append(("write", data))
        self.proc.stdin.close.side_effect = lambda: self.events.append(("close",))
        self.proc.wait.side_effect = lambda: self.events.append(("wait",)) or exit_code

    def new_image(self, *args):
        image = Mock()
        # Keep each image with the recorder returned by the fake ImageDraw.Draw.
        image.draw = Mock()
        image.tobytes.return_value = bytes([len(self.images)])
        image.save.side_effect = lambda path: self.events.append(("save", path))
        self.images.append(image)
        return image

    def render(self, rows, audit_frame=None):
        def audit(frame, t, row):
            self.events.append(("audit", frame, t, row))
            if audit_frame:
                audit_frame(frame, t, row)

        # All external seams exist only for this call, including failure paths.
        with ExitStack() as patches:
            patches.enter_context(patch.object(renderer.Image, "new", side_effect=self.new_image))
            patches.enter_context(patch.object(
                renderer.ImageDraw, "Draw", side_effect=lambda image: image.draw
            ))
            patches.enter_context(patch.object(
                renderer.ImageFont, "truetype", side_effect=lambda path, size: (path, size)
            ))
            patches.enter_context(patch.object(renderer.os.path, "exists", return_value=self.symbols))
            self.popen = patches.enter_context(patch.object(
                renderer.subprocess, "Popen", return_value=self.proc
            ))
            self.result = renderer.render_video(
                rows, Path("/output/video.mp4"), "heading", "subheading",
                lambda t: "footer-" + str(t), audit,
            )

    def glyphs(self, frame=0):
        return [
            call for call in self.images[frame].draw.text.call_args_list
            if 151 <= call.args[0][1] < 1135
        ]


class RenderTests(unittest.TestCase):
    def test_sgr_state_carries_across_lines_but_not_frames(self):
        capture = RenderCapture()
        first = snapshot("\x1b[31;44mA\nB\x1b[39mC\x1b[49mD\x1b[1;22;90mE\x1b[mF")
        second = snapshot("G", t=.2, step="second")
        capture.render([first, second, snapshot("", t=.4)])
        glyphs = capture.glyphs()
        self.assertEqual(
            [g.kwargs["fill"] for g in glyphs],
            ["#f87171", "#f87171", "#e2e8f0", "#e2e8f0", "#0f172a", "#e2e8f0"],
        )
        self.assertEqual([g.kwargs["stroke_width"] for g in glyphs], [0] * 6)
        self.assertEqual(
            [c.kwargs["fill"] for c in capture.images[0].draw.rectangle.call_args_list],
            ["#93c5fd"] * 3,
        )
        self.assertEqual(capture.glyphs(1)[0].kwargs["fill"], "#e2e8f0")
        self.assertFalse(capture.images[1].draw.rectangle.called)

    def test_indexed_truecolor_and_incomplete_sgr_consumption(self):
        capture = RenderCapture()
        text = (
            "\x1b[38;5;9mA\x1b[38;5;16mB\x1b[38;5;231mC"
            "\x1b[38;5;232mD\x1b[38;5;255mE"
            "\x1b[38;2;1;2;3;48;2;4;5;6mF\x1b[38;2;31mG"
        )
        capture.render([snapshot(text), snapshot("", t=.2)])
        self.assertEqual(
            [g.kwargs["fill"] for g in capture.glyphs()],
            ["#f87171", (0, 0, 0), (255, 255, 255), (8, 8, 8), (238, 238, 238), (1, 2, 3), "#f87171"],
        )
        self.assertEqual(
            [c.kwargs["fill"] for c in capture.images[0].draw.rectangle.call_args_list],
            [(4, 5, 6)] * 2,
        )

    def test_cell_geometry_controls_combining_wide_and_symbol_fonts(self):
        capture = RenderCapture()
        capture.render([snapshot("A\t界e\u0301✓\ue000\x00Z"), snapshot("", t=.2)])
        glyphs = capture.glyphs()
        self.assertEqual(
            [g.args[1] for g in glyphs],
            ["A", "界", "e", "\u0301", "✓", "\ue000", "Z"],
        )
        self.assertEqual(
            [g.args[0] for g in glyphs],
            [(44, 151), (55, 151), (77, 151), (88, 151), (88, 151), (99, 151), (110, 151)],
        )
        self.assertIn("Meslo", glyphs[4].kwargs["font"][0])
        self.assertIn("Meslo", glyphs[5].kwargs["font"][0])
        self.assertIn("Noto", glyphs[1].kwargs["font"][0])
        without_symbols = RenderCapture(symbols=False)
        without_symbols.render([snapshot("✓"), snapshot("", t=.2)])
        self.assertIn("Noto", without_symbols.glyphs()[0].kwargs["font"][0])

    def test_background_geometry_includes_zero_and_double_width_cells(self):
        capture = RenderCapture()
        capture.render([snapshot("\x1b[48;5;0m界\u0301A"), snapshot("", t=.2)])
        self.assertEqual(
            [c.args[0] for c in capture.images[0].draw.rectangle.call_args_list],
            [(44, 151, 66, 173), (66, 151, 66, 173), (66, 151, 77, 173)],
        )

    def test_row_limit_and_existing_token_local_column_limit(self):
        capture = RenderCapture()
        text = "A" * 121 + "\x1b[31mBC\n" + "Z\n" * 44
        capture.render([snapshot(text), snapshot("", t=.2)])
        glyphs = capture.glyphs()
        self.assertEqual(len(glyphs), 120 + 1 + 43)
        self.assertEqual(glyphs[120].args, ((1364, 151), "B"))
        self.assertEqual(glyphs[-1].args, ((44, 1097), "Z"))

    def test_frame_schedule_audit_samples_and_encoder_contract(self):
        capture = RenderCapture()
        first = snapshot("A", t=.1)
        second = snapshot("B", t=.25, step="second")
        repeated = snapshot("C", t=.4, step="first")
        sentinel = snapshot("not-rendered", t=.61, step="end")
        capture.render([first, second, repeated, sentinel])
        self.assertEqual(capture.result, (4, 5))
        audits = [e for e in capture.events if e[0] == "audit"]
        self.assertEqual([(e[1], e[2]) for e in audits], [(0, 0), (1, .2), (2, .4), (3, .6)])
        self.assertIs(audits[0][3], first)
        self.assertIs(audits[1][3], first)
        self.assertIs(audits[2][3], repeated)
        self.assertIs(audits[3][3], repeated)
        self.assertEqual(
            [e for e in capture.events if e[0] == "save"],
            [("save", "/output/sample-first.png")],
        )
        self.assertEqual(
            [e[0] for e in capture.events],
            ["audit", "write", "audit", "write", "save", "audit", "write", "audit", "write", "close", "wait"],
        )
        self.assertEqual(
            capture.popen.call_args.args[0],
            [
                "ffmpeg", "-y", "-loglevel", "warning", "-f", "rawvideo",
                "-pixel_format", "rgb24", "-video_size", "1600x1200", "-framerate", "5",
                "-i", "pipe:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", "/output/video.mp4",
            ],
        )
        self.assertEqual(capture.popen.call_args.kwargs, {"stdin": renderer.subprocess.PIPE})
        self.assertEqual(capture.images[0].draw.rounded_rectangle.call_args.args[0], (30, 143, 1570, 1135))
        self.assertEqual(
            [c.args[1] for c in capture.images[0].draw.text.call_args_list[:3]],
            ["heading", "subheading", "caption-first"],
        )
        self.assertEqual(capture.images[0].draw.text.call_args_list[-1].args, ((36, 1155), "footer-0.0"))

    def test_audit_row_replacement_controls_sampling_after_write(self):
        capture = RenderCapture()
        first = snapshot("A")
        rows = [first, snapshot("", t=.2)]

        def replace_row(frame, t, row):
            self.assertIs(row, first)
            rows[0] = dict(row, t=1)
            # An incorrectly added sample save would also add an exception path.
            capture.images[-1].save.side_effect = OSError("unexpected sample save")

        capture.render(rows, audit_frame=replace_row)
        self.assertEqual(capture.result, (1, 5))
        self.assertEqual(rows[0]["t"], 1)
        self.assertIsNot(rows[0], first)
        self.assertEqual(capture.events, [("audit", 0, 0, first), ("write", b"\x00"), ("close",), ("wait",)])
        capture.images[0].save.assert_not_called()

    def test_sampling_each_step_once_and_rejecting_failed_encoder(self):
        capture = RenderCapture()
        capture.render([snapshot("A"), snapshot("B", t=.2, step="second"), snapshot("C", t=.4), snapshot("", t=.6)])
        self.assertEqual(
            [e for e in capture.events if e[0] == "save"],
            [("save", "/output/sample-first.png"), ("save", "/output/sample-second.png")],
        )
        failed_encoder = RenderCapture(exit_code=1)
        with self.assertRaises(AssertionError):
            failed_encoder.render([snapshot("A"), snapshot("", t=.2)])
        self.assertEqual(failed_encoder.events[-2:], [("close",), ("wait",)])


if __name__ == "__main__":
    unittest.main()
