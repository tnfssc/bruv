"""Opt-in virtual-only native protocol test. Supply explicit monitor source/sink."""
import base64
import json
import queue
import signal
import subprocess
import sys
import threading
import time

assert len(sys.argv) == 4, "usage: capture-protocol.py HELPER MIC.monitor SINK"
helper, source, sink = sys.argv[1:]
assert source.endswith(".monitor")
p = subprocess.Popen([helper, "--source", source, "--sink", sink], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
events = queue.Queue()
def collect():
    for line in p.stdout:
        events.put(json.loads(line))
    events.put({"type": "eof"})
reader = threading.Thread(target=collect, daemon=True)
reader.start()
def command(**value):
    p.stdin.write(json.dumps(value) + "\n")
    p.stdin.flush()
def read(kind, epoch=None):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        m = events.get(timeout=max(.01, deadline - time.monotonic()))
        assert m["type"] not in ("error", "eof"), m
        if m["type"] == "capture":
            assert isinstance(m["epoch"], int), m
            assert len(base64.b64decode(m["data"])) == 640
        if m["type"] == kind and (epoch is None or m.get("epoch") == epoch):
            return m
    raise AssertionError("missing " + kind)
def muted():
    # Output already in the pipe is legal with its OLD epoch. Drain it first.
    time.sleep(.1)
    while not events.empty():
        m = events.get_nowait()
        assert m["type"] not in ("error", "eof"), m
    time.sleep(.2)
    while not events.empty():
        m = events.get_nowait()
        assert m["type"] not in ("capture", "error", "eof"), m
try:
    assert read("hello")["captureGate"] is True
    command(type="capture_gate", epoch=None)
    command(type="start")
    read("ready")
    muted()
    command(type="capture_gate", epoch=0)
    read("capture", 0)
    command(type="capture_gate", epoch=None)
    muted()
    # The server accumulates capture while the client is suspended. It must be
    # rejected by a fresh server frontier on resume, not retagged by receive time.
    p.send_signal(signal.SIGSTOP)
    time.sleep(.25)
    command(type="capture_gate", epoch=1)
    p.send_signal(signal.SIGCONT)
    read("capture", 1)
    command(type="capture_gate", epoch=None)
    muted()
    command(type="stop")
    read("stopped")
    print("capture gate virtual protocol OK")
finally:
    p.send_signal(signal.SIGCONT)
    p.stdin.close()
    try:
        p.wait(timeout=4)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait()
    assert p.returncode == 0, p.stderr.read()
