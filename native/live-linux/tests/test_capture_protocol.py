"""Device-free checks for the capture gate protocol test's event/lifetime rules."""
import base64
from contextlib import contextmanager
import importlib.util
import json
from pathlib import Path
import signal
import tempfile
import time
import unittest


spec = importlib.util.spec_from_file_location(
    "capture_protocol", Path(__file__).with_name("capture-protocol.py"),
)
capture_protocol = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture_protocol)
PCM = base64.b64encode(b"\x00" * 640).decode()


def capture(epoch, data=PCM):
    return {"type": "capture", "epoch": epoch, "data": data}


@contextmanager
def helper_events(events, delay=0):
    # Real pipes exercise batched reads, select timeouts and EOF shutdown.
    with tempfile.TemporaryDirectory() as directory:
        helper = Path(directory) / "helper"
        lines = "\n".join(json.dumps(event) for event in events)
        helper.write_text(
            "#!/usr/bin/env python3\nimport sys, time\n"
            f"time.sleep({delay!r})\n"
            f"print({lines!r}, flush=True)\n"
            "sys.stdin.read()\n"
        )
        helper.chmod(0o755)
        with capture_protocol.CaptureProtocol(str(helper), "mic.monitor", "out") as client:
            yield client


class CaptureProtocolTests(unittest.TestCase):
    def test_batched_events_and_epoch_matching(self):
        with helper_events([capture(0), {"type": "played"}, capture(1)]) as client:
            self.assertEqual(client.read("capture", 1), capture(1))

    def test_skipped_capture_is_validated(self):
        with helper_events([capture("0"), {"type": "ready"}]) as client:
            with self.assertRaises(AssertionError):
                client.read("ready")

    def test_mute_grace_accepts_only_the_closed_hold(self):
        with helper_events([capture(0), {"type": "played"}]) as client:
            client.assert_muted(closed_epoch=0)

    def test_mute_grace_rejects_new_epoch(self):
        with helper_events([capture(1)]) as client:
            with self.assertRaises(AssertionError):
                client.assert_muted(closed_epoch=0)

    def test_mute_grace_validates_pcm(self):
        with helper_events([capture(0, "bad")]) as client:
            with self.assertRaises((AssertionError, ValueError)):
                client.assert_muted(closed_epoch=0)

    def test_initial_mute_does_not_allow_any_capture(self):
        with helper_events([capture(0)]) as client:
            with self.assertRaises(AssertionError):
                client.assert_muted()

    def test_capture_after_settling_is_rejected(self):
        with helper_events([capture(0)], delay=.15) as client:
            with self.assertRaises(AssertionError):
                client.assert_muted(closed_epoch=0)

    def test_errors_fail_even_during_mute_grace(self):
        with helper_events([{"type": "error", "code": "capture_gate"}]) as client:
            with self.assertRaisesRegex(AssertionError, "capture_gate"):
                client.assert_muted(closed_epoch=0)

    def test_missing_event_has_bounded_wait(self):
        with helper_events([], delay=.2) as client:
            self.assertIsNone(client.next_event(time.monotonic() + .02))

    def test_failure_while_suspended_resumes_and_closes_helper(self):
        with self.assertRaisesRegex(RuntimeError, "scenario failed"):
            with helper_events([{"type": "hello"}]) as client:
                client.read("hello")
                client.process.send_signal(signal.SIGSTOP)
                raise RuntimeError("scenario failed")
        self.assertEqual(client.process.returncode, 0)
        self.assertTrue(client.process.stdout.closed)
        self.assertTrue(client.process.stderr.closed)


if __name__ == "__main__":
    unittest.main()
