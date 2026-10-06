"""Serial compiled PTY probes; shell state and complete captured restore bytes checked.
Usage: python3 pty-check.py BINARY OUTPUT_PREFIX [reader_delay_ms]
"""
import os, sys, pty, termios, fcntl, struct, select, time, json, hashlib, shlex
binary, prefix = map(os.path.abspath, sys.argv[1:3])
delay_ms = int(sys.argv[3]) if len(sys.argv) > 3 else 0
for suffix in [".json", ".json.ready", ".before", ".after"]:
    try: os.unlink(prefix + suffix)
    except FileNotFoundError: pass
pid, fd = pty.fork()
if pid == 0:
    os.environ.update(TERM="xterm-256color", COLUMNS="100", LINES="32", PI_PACKAGE_DIR=os.path.abspath("runtime-assets"), PS1="STOP_PROBE_PROMPT> ")
    os.execv("/bin/bash", ["bash", "--noprofile", "--norc", "-i"])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 100, 0, 0))
command = "stty -g > " + shlex.quote(prefix + ".before") + "; " + shlex.quote(binary) + " " + shlex.quote(prefix + ".json") + "; stty -g > " + shlex.quote(prefix + ".after") + "; printf '\nSHELL_RESUMED:0\n'\n"
os.write(fd, command.encode())
chunks = []; held = False; start = time.monotonic(); hold_elapsed_ms = 0
try:
    while time.monotonic() - start < 20:
        if not held and os.path.exists(prefix + ".json.ready"):
            held = True
            hold_start = time.monotonic(); time.sleep(delay_ms / 1000); hold_elapsed_ms = (time.monotonic() - hold_start) * 1000
        ready, _, _ = select.select([fd], [], [], .005)
        if ready:
            try: data = os.read(fd, 65536)
            except OSError: break
            if not data: break
            chunks.append(data)
        if os.path.exists(prefix + ".after") and b"SHELL_RESUMED:0\r\n" in b"".join(chunks[-3:]): break
    elapsed_ms = (time.monotonic() - start) * 1000
    raw = b"".join(chunks)
    report = json.load(open(prefix + ".json"))
    restore = open(prefix + ".json.restore.bin", "rb").read()
    begin = raw.index(b"\x1b[?2026h\x1b[?1049l\x1b[?7l")
    end = raw.index(b"\x1b[?25h\x1b[?2026l", begin) + len(b"\x1b[?25h\x1b[?2026l")
    captured = raw[begin:end]
    # The shell's restored ONLCR converts LF while writing main-screen transcript.
    assert captured == restore or captured == restore.replace(b"\n", b"\r\n"), "PTY lost/changed transcript"
    before = open(prefix + ".before").read().strip(); after = open(prefix + ".after").read().strip()
    assert before == after, "shell termios did not restore"
    assert not report["rawAfterStop"] and report["frames"] == 0 and report["renders"] == 1
    # Check follow-up input is handled by bash, not the TUI.
    os.write(fd, b"printf 'FOLLOWUP:%s\\n' shell-ok\n")
    followup = b""
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and b"FOLLOWUP:shell-ok" not in followup:
        if select.select([fd], [], [], .05)[0]: followup += os.read(fd, 65536)
    assert b"FOLLOWUP:shell-ok" in followup
    open(prefix + ".pty.bin", "wb").write(raw)
    result = {"binary": binary, "readerDelayRequestedMs": delay_ms, "readerHoldElapsedMs": hold_elapsed_ms,
              "shellElapsedMs": elapsed_ms, "stop": report, "termiosBefore": before, "termiosAfter": after,
              "capturedRestoreBytes": len(captured), "capturedRestoreHash": hashlib.sha256(captured).hexdigest(),
              "restoreComplete": True, "followupShellInput": True,
              "checks": "exact complete restore bytes (with optional kernel ONLCR); termios parity; main screen + autowrap + cursor restore; no frame"}
    open(prefix + ".pty.json", "w").write(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
finally:
    try: os.write(fd, b"exit\n"); os.waitpid(pid, 0)
    finally: os.close(fd)
