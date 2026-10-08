#!/usr/bin/env python3
"""Real-terminal acceptance probe for Bruv's compact tool/task conversation UI.

Runs a compiled binary in an isolated tmux PTY against a loopback-only scripted
OpenAI-completions endpoint.  It writes screen/request evidence under the chosen
artifact prefix and never needs credentials or Internet access.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import http.server
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path

ANSI_RE = re.compile(r"(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\))")


def chunk(delta: dict, finish=None) -> dict:
    return {"id":"ui-cleanup-fixture", "object":"chat.completion.chunk",
            "created":1700000000, "model":"fixture-model",
            "choices":[{"index":0,"delta":delta,"finish_reason":finish}]}


def sse_for(n: int) -> bytes:
    calls = {
        1: ("success_call", 'console.log("SUCCESS_OUTPUT"); await Bun.sleep(1200)'),
        2: ("error_call", 'throw new Error("EXPECTED_BOOM")'),
        3: ("long_call", 'console.log("L".repeat(6000))'),
        5: ("jobs_call", '''const a = await shell("sleep 0.20; exit 0", { waitSeconds: 0 });
const b = await shell("sleep 0.21; exit 7", { waitSeconds: 0 });
const c = await shell("sleep 0.22; exit 0", { waitSeconds: 0 });
await handoff("TASKS_WAITING_MARKER");'''),
    }
    if n in calls:
        call_id, code = calls[n]
        arguments = {"code": code}
        if n in (1, 2, 3):
            arguments["label"] = {1: "Read fixture output", 2: "Trigger expected error", 3: "Read large output"}[n]
        events = [chunk({"role":"assistant", "tool_calls":[{"index":0,"id":call_id,
            "type":"function","function":{"name":"execute","arguments":json.dumps(arguments)}}]}),
                  chunk({}, "tool_calls")]
        if n == 2:
            events.insert(0, chunk({"content":"DIRECT_PROSE_MARKER"}))
    elif n == 4:
        events = [chunk({"role":"assistant"}),
                  chunk({"reasoning_content":"THINK_FIRST_MARKER"}),
                  chunk({"content":"FINAL_FIRST_MARKER"}), chunk({}, "stop")]
    elif n == 6:
        events = [chunk({"role":"assistant"}),
                  chunk({"reasoning_content":"THINK_BATCH_MARKER"}),
                  chunk({"content":"FINAL_BATCH_MARKER"}), chunk({}, "stop")]
    else:
        events = [chunk({"role":"assistant", "content":"UNEXPECTED_REQUEST_MARKER"}), chunk({}, "stop")]
    return ("".join("data: "+json.dumps(e,separators=(",",":"))+"\n\n" for e in events)+"data: [DONE]\n\n").encode()


class Fixture:
    def __init__(self):
        self.records: list[dict] = []
        self.lock = threading.Lock()
        fixture = self
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, fmt, *args):
                return
            def do_POST(self):
                try:
                    length = int(self.headers.get("content-length", "0"))
                    if length > 4_000_000:
                        self.send_error(413); return
                    raw = self.rfile.read(length)
                    body = json.loads(raw)
                except Exception:
                    self.send_error(400); return
                with fixture.lock:
                    n = len(fixture.records) + 1
                    roles = [m.get("role", "?") for m in body.get("messages", []) if isinstance(m, dict)]
                    fixture.records.append({"request":n, "path":self.path, "request_bytes":length,
                                            "message_roles":roles, "response_status":200})
                payload = sse_for(n)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Connection", "close")
                self.end_headers(); self.wfile.write(payload)
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
    @property
    def port(self): return self.server.server_address[1]
    def start(self): self.thread.start()
    def stop(self): self.server.shutdown(); self.server.server_close(); self.thread.join(2)


def run(cmd: list[str], *, timeout=10, check=True, env=None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=check, env=env)


def strip_ansi(s: str) -> str:
    return ANSI_RE.sub("", s).replace("\r", "")


class Terminal:
    """Commands for the probe's private tmux server, with one scenario deadline."""

    def __init__(self, home: Path, binary: Path, timeout: float):
        self.home = home
        self.binary = binary
        self.tmux = ["tmux", "-S", str(home / "tmux.sock")]
        self.timeout = timeout

    def start(self):
        env = os.environ.copy()
        env.update({"HOME": str(self.home), "BRUV_CODING_AGENT_DIR": str(self.home / ".bruv" / "agent"),
                    "TMPDIR": str(self.home / "tmp"), "PI_OFFLINE": "1", "NO_COLOR": "0", "TERM": "xterm-256color"})
        launch = [str(self.binary), "--no-session", "--no-approve", "--offline", "--provider", "fixture",
                  "--model", "fixture-model", "--thinking", "medium", "FIRST_USER_MARKER"]
        command = "env " + " ".join(shlex.quote(k + "=" + env[k]) for k in
            ["HOME", "BRUV_CODING_AGENT_DIR", "TMPDIR", "PI_OFFLINE", "NO_COLOR", "TERM"])
        command += " " + " ".join(map(shlex.quote, launch))
        self.deadline = time.monotonic() + self.timeout
        run(self.tmux + ["-f", str(self.home / "tmux.conf"), "new-session", "-d", "-s", "probe",
                         "-x", "120", "-y", "36", "-c", str(self.home), command], env=env)

    def capture(self, esc=False, history=True):
        cmd = self.tmux + ["capture-pane", "-p"]
        if esc:
            cmd.append("-e")
        if history:
            cmd += ["-S", "-"]
        return run(cmd + ["-t", "probe"], timeout=3).stdout

    def wait_for(self, marker: str):
        while time.monotonic() < self.deadline:
            try:
                if marker in strip_ansi(self.capture(history=False)):
                    return
            except subprocess.CalledProcessError:
                pass
            time.sleep(.08)
        raise TimeoutError(f"timed out waiting for {marker}")

    def send_keys(self, *keys: str):
        run(self.tmux + ["send-keys", "-t", "probe", *keys], timeout=3)

    def stop(self):
        # Teardown remains best effort; it is not proof that child work exited.
        try:
            run(self.tmux + ["kill-server"], timeout=3, check=False)
        except Exception:
            pass


@contextmanager
def isolated_terminal(binary: Path, prefix: Path, timeout: float):
    """Own the disposable HOME, loopback fixture and private tmux server together."""
    home = prefix.parent / ("ui-cleanup-work-" + uuid.uuid4().hex)
    try:
        agent_dir, tmpdir = home / ".bruv" / "agent", home / "tmp"
        agent_dir.mkdir(parents=True)
        tmpdir.mkdir()
        terminal = Terminal(home, binary, timeout)
        fixture = Fixture()
        fixture.start()
        try:
            models = {"providers": {"fixture": {"baseUrl": f"http://127.0.0.1:{fixture.port}/v1",
                "api": "openai-completions", "apiKey": "fixture",
                "models": [{"id": "fixture-model", "name": "fixture", "reasoning": True,
                            "contextWindow": 32000, "maxTokens": 2000}]}}}
            (agent_dir / "models.json").write_text(json.dumps(models), encoding="utf-8")
            (home / "tmux.conf").write_text(
                "set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g history-limit 20000\n",
                encoding="utf-8")
            yield terminal, fixture.records
        finally:
            terminal.stop()
            fixture.stop()
    finally:
        shutil.rmtree(home, ignore_errors=True)


def exercise_terminal(terminal: Terminal, prefix: Path):
    """Capture the in-flight, expanded and settled frames; retain evidence on error."""
    plain = ansi = ""
    assertions: dict[str, bool] = {}
    error = None
    try:
        terminal.start()
        terminal.wait_for('Read fixture output')
        active_plain, active_ansi = terminal.capture(False), terminal.capture(True)
        Path(str(prefix)+"-inflight-plain.txt").write_text(active_plain, encoding="utf-8")
        Path(str(prefix)+"-inflight-ansi.txt").write_text(active_ansi, encoding="utf-8")
        assertions["inflight_row"] = len(re.findall(r'^\s*Read fixture output\s*$', strip_ansi(active_plain), re.MULTILINE)) == 1
        assertions["inflight_quiet"] = not re.search(r'\b(executing|executed|Running|completed)\b', strip_ansi(active_plain))
        terminal.wait_for("FINAL_FIRST_MARKER")
        terminal.send_keys("C-o")
        time.sleep(.25)
        expanded = terminal.capture(False)
        Path(str(prefix)+"-expanded-plain.txt").write_text(expanded, encoding="utf-8")
        assertions["expanded_source"] = 'console.log("SUCCESS_OUTPUT"); await Bun.sleep(1200)' in expanded
        assertions["expanded_output"] = any(x.strip() == "SUCCESS_OUTPUT" for x in expanded.splitlines())
        terminal.send_keys("C-o")
        time.sleep(.25)
        terminal.send_keys("-l","SECOND_USER_MARKER")
        terminal.send_keys("Enter")
        terminal.wait_for("FINAL_BATCH_MARKER")
        time.sleep(.5)
        plain, ansi = terminal.capture(False), terminal.capture(True)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        try: plain, ansi = terminal.capture(False), terminal.capture(True)
        except Exception: pass
    return plain, ansi, assertions, error


def settled_assertions(plain: str, ansi: str, request_count: int) -> dict[str, bool]:
    clean = strip_ansi(plain)
    lines = [x.rstrip() for x in clean.splitlines()]
    def has(pattern): return re.search(pattern, clean, re.MULTILINE) is not None
    assertions: dict[str, bool] = {}
    assertions["six_bounded_requests"] = request_count == 6
    assertions["success_row"] = len(re.findall(r'^\s*Read fixture output\s*$', clean, re.MULTILINE)) == 1
    assertions["settled_quiet_actions"] = not re.search(r'\b(executing|executed|Running)\b', clean)
    assertions["error_row"] = has(r'^\s*✗ Failed · Trigger expected error\s*$')
    assertions["long_row_truncated_only"] = has(r'^\s*truncated · Read large output\s*$')
    assertions["no_output_file_count"] = not has(r'(?i)(output file|output artifact|\d+ output)')
    assertions["handoff_row"] = has(r'^\s*↪ TASKS_WAITING_MARKER\s*$') and not has(r'^\s*\d+ background')
    batch_re = r'^\s*✓ (task_[A-Za-z0-9_-]+) finished, ✗ (task_[A-Za-z0-9_-]+) failed, ✓ (task_[A-Za-z0-9_-]+) finished\s*$'
    assertions["ordered_task_batch"] = has(batch_re)
    def spacing(think, prose, preceding_pattern):
        ti = next((i for i,x in enumerate(lines) if think in x), -1)
        pi = next((i for i,x in enumerate(lines) if prose in x), -1)
        if ti < 1 or pi < 0: return False
        before = ti - 1
        no_gap_thinking = bool(re.search(preceding_pattern, lines[before]))
        exactly_one_blank = pi == ti + 2 and lines[ti+1].strip() == ""
        return no_gap_thinking and exactly_one_blank
    direct = next((i for i,x in enumerate(lines) if "DIRECT_PROSE_MARKER" in x), -1)
    assertions["direct_prose_spacing"] = direct >= 2 and lines[direct-1].strip() == "" and 'Read fixture output' in lines[direct-2]
    assertions["first_spacing"] = spacing("THINK_FIRST_MARKER", "FINAL_FIRST_MARKER", r"truncated")
    assertions["batch_spacing"] = spacing("THINK_BATCH_MARKER", "FINAL_BATCH_MARKER", r"✓ task_.*finished, ✗ task_.*failed, ✓ task_.*finished")
    assertions["markers_present"] = all(x in clean for x in ["THINK_FIRST_MARKER","FINAL_FIRST_MARKER","THINK_BATCH_MARKER","FINAL_BATCH_MARKER"])
    assertions["no_unexpected_request"] = "UNEXPECTED_REQUEST_MARKER" not in clean
    assertions["ansi_evidence"] = chr(27) + "[" in ansi
    return assertions


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", default="dist/bruv", help="compiled bruv binary to exercise")
    ap.add_argument("--artifact-prefix", default="artifacts/ui-cleanup-final")
    ap.add_argument("--timeout", type=float, default=35.0)
    args = ap.parse_args()
    root = Path(__file__).resolve().parents[2]
    binary = Path(args.binary)
    if not binary.is_absolute(): binary = (root / binary).resolve()
    if not binary.is_file(): ap.error(f"binary not found: {binary}")
    if not shutil.which("tmux"): ap.error("tmux is required")
    prefix = Path(args.artifact_prefix)
    if not prefix.is_absolute(): prefix = root / prefix
    prefix.parent.mkdir(parents=True, exist_ok=True)
    with isolated_terminal(binary, prefix, args.timeout) as (terminal, records):
        plain, ansi, assertions, error = exercise_terminal(terminal, prefix)
    assertions.update(settled_assertions(plain, ansi, len(records)))
    (Path(str(prefix)+"-plain.txt")).write_text(plain, encoding="utf-8")
    (Path(str(prefix)+"-ansi.txt")).write_text(ansi, encoding="utf-8")
    (Path(str(prefix)+"-requests.json")).write_text(json.dumps(records, indent=2)+"\n", encoding="utf-8")
    report = {"binary":str(binary), "error":error, "request_count":len(records),
              "assertions":assertions, "passed":error is None and all(assertions.values())}
    (Path(str(prefix)+"-report.json")).write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
