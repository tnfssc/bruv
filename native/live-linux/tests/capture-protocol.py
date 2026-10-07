"""Opt-in virtual-only native protocol test. Supply explicit monitor source/sink."""
import base64
import json
import os
import select
import signal
import subprocess
import sys
import time


class CaptureProtocol:
    """Own the helper and consume every event through the same checks."""

    def __init__(self, helper, source, sink):
        self.process = subprocess.Popen(
            [helper, "--source", source, "--sink", sink],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.pending = b""

    def __enter__(self):
        return self

    def __exit__(self, *exception):
        # A failed suspended-client scenario must still permit shutdown.
        self.process.send_signal(signal.SIGCONT)
        self.process.stdin.close()
        try:
            self.process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        try:
            assert self.process.returncode == 0, self.process.stderr.read().decode()
        finally:
            self.process.stdout.close()
            self.process.stderr.close()

    def command(self, **value):
        self.process.stdin.write((json.dumps(value) + "\n").encode())
        self.process.stdin.flush()

    def next_event(self, deadline):
        # Read bytes directly: select cannot see lines prefetched by readline.
        while b"\n" not in self.pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select(
                [self.process.stdout], [], [], remaining,
            )[0]:
                return None
            chunk = os.read(self.process.stdout.fileno(), 65536)
            assert chunk, "helper closed stdout"
            self.pending += chunk
        line, self.pending = self.pending.split(b"\n", 1)
        event = json.loads(line)
        assert event["type"] not in ("error", "eof"), event
        if event["type"] == "capture":
            assert isinstance(event["epoch"], int), event
            assert len(base64.b64decode(event["data"])) == 640, event
        return event

    def read(self, kind, epoch=None):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            event = self.next_event(deadline)
            if event is None:
                break
            if event["type"] == kind and (epoch is None or event.get("epoch") == epoch):
                return event
        raise AssertionError("missing " + kind)

    def assert_muted(self, closed_epoch=None):
        # The pipe may contain capture from the hold just closed, never a new hold.
        deadline = time.monotonic() + .1
        while time.monotonic() < deadline and (event := self.next_event(deadline)) is not None:
            if event["type"] == "capture":
                assert closed_epoch is not None and event["epoch"] == closed_epoch, event
        # After that output settles, observe a bounded interval with no capture.
        deadline = time.monotonic() + .2
        while time.monotonic() < deadline and (event := self.next_event(deadline)) is not None:
            assert event["type"] != "capture", event


def check_capture_gate(protocol):
    assert protocol.read("hello")["captureGate"] is True
    protocol.command(type="capture_gate", epoch=None)
    protocol.command(type="start")
    protocol.read("ready")
    protocol.assert_muted()

    protocol.command(type="capture_gate", epoch=0)
    protocol.read("capture", 0)
    protocol.command(type="capture_gate", epoch=None)
    protocol.assert_muted(closed_epoch=0)

    # The server accumulates capture while the client is suspended. It must be
    # rejected by a fresh server frontier on resume, not retagged by receive time.
    protocol.process.send_signal(signal.SIGSTOP)
    time.sleep(.25)
    protocol.command(type="capture_gate", epoch=1)
    protocol.process.send_signal(signal.SIGCONT)
    protocol.read("capture", 1)
    protocol.command(type="capture_gate", epoch=None)
    protocol.assert_muted(closed_epoch=1)

    protocol.command(type="stop")
    protocol.read("stopped")


def main():
    assert len(sys.argv) == 4, "usage: capture-protocol.py HELPER MIC.monitor SINK"
    helper, source, sink = sys.argv[1:]
    assert source.endswith(".monitor")
    with CaptureProtocol(helper, source, sink) as protocol:
        check_capture_gate(protocol)
    print("capture gate virtual protocol OK")


if __name__ == "__main__":
    main()
