#!/usr/bin/env python3
"""Bounded SDK/native-PTY acceptance capture. No provider traffic except local fake SSE.

Requires a compiled binary and its tasks-ui-proof-build.ts provenance record.
Screenshots are full, text-identical ANSI terminal replays (see screenshot helper),
not edited images, desktop photographs, or render-unit-test fixture output.
"""
import argparse
from contextlib import contextmanager
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
ANSI = re.compile(r"\x1b\[[0-9;]*m")
SPINNER = r"[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]"
HIDDEN = "Private reasoning is not a transcript row."
SUCCESS_CODE = ('await Bun.write("action-started", ""); '
                'while (!(await Bun.file("action-release").exists())) await Bun.sleep(50); '
                'console.log(await Bun.file("GUIDE.md").text());')
FAIL_CODE = 'throw new Error("permission denied")'
BACKGROUND_CODE = ('const task = await shell("/bin/sh background-check.sh", {waitSeconds:0}); '
                   'await Bun.write("background-task.json", JSON.stringify({id:task.id, title:task.title, kind:task.kind, status:task.status}));')

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def plain(text):
    return ANSI.sub("", text)

def chunk(delta, finish=None):
    return {"id":"local-ui-proof", "object":"chat.completion.chunk", "created":1,
            "model":"proof-model", "choices":[{"index":0,"delta":delta,"finish_reason":finish}],
            "usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}

def tool_start(id):
    return chunk({"tool_calls":[{"index":0,"id":id,"type":"function",
                                   "function":{"name":"execute","arguments":""}}]})

def tool_delta(arguments):
    return chunk({"tool_calls":[{"index":0,"function":{"arguments":arguments}}]})

# Every intentional pause is acknowledged by the capture driver, not a timed
# blind screenshot. Label and code chunks really pass through the SDK parser.
def plan(n):
    events = [(chunk({"role":"assistant"}), None)]
    if n == 1:
        events += [(chunk({"reasoning_content":HIDDEN}), None),
                   (tool_start("read-guide"), "spinner-only")]
        args = json.dumps({"label":"Read guide", "code":SUCCESS_CODE}, separators=(",",":"))
        partial = '{"label":"Read'
        code_prefix = args[:args.index('await Bun.write') + len('await Bun.write')]
        events += [(tool_delta(partial), "partial-label"),
                   (tool_delta(code_prefix[len(partial):]), "label-code-stream"),
                   (tool_delta(args[len(code_prefix):]), None), (chunk({}, "tool_calls"), None)]
    elif n == 3:
        events += [(tool_start("read-restricted"), None)]
        args = json.dumps({"code":FAIL_CODE,"label":"Read restricted guide"}, separators=(",",":"))
        prefix = args[:args.index('permission') + len('permission')]
        events += [(tool_delta(prefix), "code-first"), (tool_delta(args[len(prefix):]), None),
                   (chunk({}, "tool_calls"), None)]
    elif n == 5:
        events += [(tool_start("run-tests"), None),
                   (tool_delta(json.dumps({"label":"Run tests","code":BACKGROUND_CODE})), None),
                   (chunk({}, "tool_calls"), None)]
    else:
        say = {2:"The guide is ready.", 4:"The restricted guide could not be read.",
               6:"The checks are running.", 7:"The checks passed."}
        if n not in say:
            raise RuntimeError("Unexpected inference request: " + str(n))
        if n == 6: events[0] = (events[0][0], "background-launch-result")
        events += [(chunk({"content":say[n]}), None), (chunk({}, "stop"), None)]
    return events

class Fixture:
    def __init__(self, timeout):
        self.records = []
        self.errors = []
        self.lock = threading.Lock()
        self.arrived = {s:threading.Event() for s in ["spinner-only","partial-label","label-code-stream","code-first","background-launch-result"]}
        self.released = {s:threading.Event() for s in self.arrived}
        self.timeout = timeout
        fixture = self
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *_): pass
            def do_POST(self):
                try:
                    if self.path != "/v1/chat/completions": raise RuntimeError("Unexpected route: " + self.path)
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= 4_000_000: raise RuntimeError("Request size outside bound")
                    body = json.loads(self.rfile.read(size))
                    if body.get("model") != "proof-model": raise RuntimeError("Unexpected model")
                    with fixture.lock:
                        n = len(fixture.records) + 1
                        fixture.records.append({"request":n,"path":self.path,"requestBytes":size,
                                                "body":body,"time":time.time()})
                    events = plan(n)
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    for event, stage in events:
                        self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
                        self.wfile.flush()
                        if stage:
                            fixture.arrived[stage].set()
                            if not fixture.released[stage].wait(fixture.timeout):
                                raise RuntimeError("Capture did not release stage " + stage)
                    self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
                    self.close_connection = True
                except Exception as error:
                    fixture.errors.append(str(error))
                    self.close_connection = True
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
    def start(self): self.thread.start()
    def stop(self):
        for gate in self.released.values(): gate.set()
        self.server.shutdown(); self.server.server_close(); self.thread.join(2)

# Assertions target approved collapsed presentation, never old fixture markers.
# Footer/Ctrl-O are captured for review; this does not claim unchanged source.
def audit(frames, task_id="task_proof"):
    # shell has no title metadata: use its actual typed launch ID, not execute.label.
    checks = {}
    def full(step): return plain(frames[step]["scrollback"])
    def rows(step, label): return [x.strip() for x in full(step).splitlines() if label in x]
    def transcript(step):
        lines = plain(frames[step]["viewport"]).splitlines()
        footer = next((i for i in range(len(lines)-1, -1, -1) if "proof-model" in lines[i] and "ctx" in lines[i]), len(lines))
        # The SDK editor/activity loader is immediately above the footer.
        # Do not mistake its spinner for the new transcript action spinner.
        return "\n".join(lines[:max(0, footer-1)])
    def one(step, pattern, *, tool_spinner=False):
        text = transcript(step) if tool_spinner else full(step)
        return len(re.findall(pattern, text, re.M)) == 1
    checks["spinner_only"] = one("spinner-only", r"^\s*" + SPINNER + r"\s*$", tool_spinner=True)
    checks["partial_label"] = one("partial-label", r"^\s*" + SPINNER + r" Read\s*$", tool_spinner=True)
    for step in ["label-code-stream", "foreground-running"]:
        checks[step] = one(step, r"^\s*" + SPINNER + r" Read guide\s*$", tool_spinner=True)
    checks["foreground_success"] = one("foreground-success", r"^\s*✓ Read guide\s*$")
    checks["code_first_spinner"] = one("code-first", r"^\s*" + SPINNER + r"\s*$", tool_spinner=True)
    checks["code_first_no_raw_source"] = not any(s in full("code-first") for s in ["throw", "permission", "Error(", "execute", "TypeScript"])
    checks["concise_failure"] = one("concise-failure", r"^\s*✗ Read restricted guide — (?:Error: )?permission denied\s*$")
    active = ["background-launched", "background-running"]
    identity = re.escape(task_id)
    for step in active:
        checks[step] = one(step, r"^\s*↗ " + identity + r"\s*$") and len(rows(step, task_id)) == 1
    checks["background_success"] = one("background-success", r"^\s*✓ " + identity + r"\s*$") and len(rows("background-success", task_id)) == 1
    indices = [next((i for i,x in enumerate(full(s).splitlines()) if task_id in x), -1)
               for s in active + ["background-success"]]
    checks["same_background_transcript_row"] = indices[0] >= 0 and len(set(indices)) == 1
    checks["no_launch_action_duplicate"] = all(not rows(s, "Run tests") for s in active + ["background-success"])
    checks["no_secondary_task_notice"] = len(re.findall(r"^\s*[✓✗↗].*\btask_[\w-]+", full("background-success"), re.M)) == 1
    collapsed = [s for s in frames if s != "expanded-ctrl-o"]
    checks["fixture_trust_warning_absent"] = all("This project is not trusted" not in full(s) for s in frames)
    checks["thinking_hidden"] = all(HIDDEN not in full(s) and "Thinking..." not in full(s) for s in frames)
    checks["collapsed_notice_hidden"] = all("Tool output: collapsed" not in full(s) for s in collapsed)
    checks["collapsed_code_output_hidden"] = all(not any(token in full(s) for token in ["await Bun.write", "action-started", "action-release", "GUIDE.md", "throw new Error", "Install, run, and open the local app."]) for s in collapsed)
    expanded = full("expanded-ctrl-o")
    checks["ctrl_o_code"] = SUCCESS_CODE in re.sub(r"\s+", " ", expanded)
    checks["ctrl_o_output"] = "Install, run, and open the local app." in expanded
    checks["expanded_notice_preserved"] = "Tool output: expanded" in expanded
    checks["footer_fields_visible"] = all(
        all(re.search(p, plain(frames[s]["viewport"])) for p in [r"\$0\.000", r"ctx\s*\d", r"cache est", r"proof-model.*medium"])
        for s in ["foreground-success", "background-success"])
    checks["routine_lifecycle_chatter_hidden"] = all(not re.search(r"\b(?:executing|executed)\b", full(s)) for s in collapsed)
    return checks

def run(cmd, *, env=None, timeout=10, check=True):
    return subprocess.run(cmd, env=env, text=True, capture_output=True, timeout=timeout, check=check)

class NativeCapture:
    """Own the disposable PTY, inference fixture, and captured terminal evidence."""
    def __init__(self, bun, timeout, out):
        self.bun, self.timeout, self.out = bun, timeout, out
        self.timeline, self.frames = [], {}

    @contextmanager
    def session(self):
        tmpbase = Path(os.environ.get("TMPDIR", "/tmp"))
        with tempfile.TemporaryDirectory(prefix="tasks-ui-proof-", dir=tmpbase) as directory:
            home = Path(directory)
            agent, self.repo, temp = home / "agent", home / "repo", home / "tmp"
            conf = home / "tmux.conf"
            # No inherited tokens, roles/depth, proxies, SSH agent or user config.
            # Tool scripts and session-only trust stay in this disposable repo.
            self.env = {"PATH":"/usr/bin:/bin:" + str(Path(self.bun).parent), "HOME":str(home),
                        "SHELL":"/bin/sh", "TMPDIR":str(temp), "TERM":"xterm-256color", "LANG":"C.UTF-8",
                        "BRUV_CODING_AGENT_DIR":str(agent), "PI_OFFLINE":"1", "NO_COLOR":"0",
                        "XDG_CONFIG_HOME":str(home / "config"), "XDG_CACHE_HOME":str(home / "cache"),
                        "XDG_STATE_HOME":str(home / "state"), "GIT_CONFIG_GLOBAL":"/dev/null", "GIT_CONFIG_NOSYSTEM":"1"}
            self.tmux = ["tmux", "-f", str(conf), "-S", str(home / "tmux.sock")]
            self.fixture = Fixture(self.timeout)
            try:
                self.fixture.start()
                for d in [agent, self.repo, temp]: d.mkdir()
                (self.repo / "GUIDE.md").write_text("Install, run, and open the local app.\n")
                (self.repo / "background-check.sh").write_text(
                    'set -eu\n: > background-started\nwhile [ ! -f background-release ]; do sleep 0.05; done\nprintf "Checks passed.\n"\n')
                (agent / "settings.json").write_text(json.dumps({"hideThinkingBlock":True}))
                (agent / "models.json").write_text(json.dumps({"providers":{"proof":{
                    "baseUrl":f"http://127.0.0.1:{self.fixture.server.server_address[1]}/v1",
                    "api":"openai-completions", "apiKey":"local-proof-only", "models":[{
                        "id":"proof-model", "name":"proof-model", "reasoning":True,
                        "contextWindow":32000, "maxTokens":2000,
                        "cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}]}}}))
                conf.write_text("set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g history-limit 20000\n")
                self.deadline = time.monotonic() + self.timeout
                yield self
            finally:
                # Startup and capture failures have the same cleanup owner.
                try:
                    if self.repo.is_dir():
                        for name in ["action-release", "background-release"]: (self.repo / name).touch()
                finally:
                    try: run(self.tmux + ["kill-server"], env=self.env, check=False)
                    finally: self.fixture.stop()

    def launch(self, binary):
        # --approve is only a session trust override for our disposable fixture cwd.
        command = "env -i " + " ".join(shlex.quote(k + "=" + v) for k,v in self.env.items()) + " " + " ".join(map(shlex.quote, [
            str(binary), "--no-session", "--approve", "--offline", "--provider", "proof",
            "--model", "proof-model", "--thinking", "medium", "Read the project guide."]))
        run(self.tmux + ["new-session", "-d", "-x", "110", "-y", "40", "-s", "proof", "-c", str(self.repo), command], env=self.env)

    def pane(self, history=False):
        cmd = self.tmux + ["capture-pane", "-e", "-p", "-t", "proof"]
        if history: cmd += ["-S", "-"]
        return run(cmd, env=self.env, timeout=3).stdout

    def wait(self, name, predicate):
        while time.monotonic() < self.deadline:
            if self.fixture.errors: raise RuntimeError("; ".join(self.fixture.errors))
            if predicate(): return
            time.sleep(.05)
        raise TimeoutError(name)

    def capture(self, step):
        # Render debounce has time to process the acknowledged SDK event.
        time.sleep(.25)
        viewport, scrollback = self.pane(), self.pane(True)
        self.frames[step] = {"viewport":viewport, "scrollback":scrollback}
        for kind, data in [("viewport.ansi",viewport), ("viewport",plain(viewport)),
                           ("scrollback.ansi",scrollback), ("scrollback",plain(scrollback))]:
            (self.out / (step + "." + kind + ".txt")).write_text(data)
        self.timeline.append({"step":step,"capturedAt":time.time(), "nativeViewportSha256":hashlib.sha256(viewport.encode()).hexdigest()})
        (self.out / "timeline.json").write_text(json.dumps(self.timeline, indent=2) + "\n")

    def stage(self, name):
        self.wait(name, lambda: self.fixture.arrived[name].is_set())
        self.capture(name)
        self.fixture.released[name].set()

    def send_keys(self, *keys):
        run(self.tmux + ["send-keys", "-t", "proof", *keys], env=self.env)

    def type_text(self, message):
        self.send_keys("-l", message)
        self.send_keys("Enter")


def capture_scenario(proof, binary, task_launch):
    proof.launch(binary)
    proof.stage("spinner-only"); proof.stage("partial-label"); proof.stage("label-code-stream")
    proof.wait("actual foreground execution", lambda: (proof.repo / "action-started").exists())
    proof.capture("foreground-running")
    (proof.repo / "action-release").touch()
    proof.wait("foreground reply", lambda: "The guide is ready." in plain(proof.pane()))
    proof.capture("foreground-success")
    proof.send_keys("C-o")
    proof.capture("expanded-ctrl-o")
    proof.send_keys("C-o")
    proof.type_text("Read the restricted guide.")
    proof.stage("code-first")
    proof.wait("failed action reply", lambda: "The restricted guide could not be read." in plain(proof.pane()))
    proof.capture("concise-failure")
    proof.type_text("Run the project checks in the background.")
    proof.wait("background launch result", lambda: (proof.repo / "background-started").exists() and proof.fixture.arrived["background-launch-result"].is_set())
    # Keep launch evidence even if a later capture fails.
    task_launch.update(json.loads((proof.repo / "background-task.json").read_text()))
    if not re.fullmatch(r"task_[\w-]+", task_launch.get("id", "")) or task_launch.get("title"):
        raise RuntimeError("Expected actual untitled shell launch identity")
    proof.capture("background-launched")
    proof.fixture.released["background-launch-result"].set()
    proof.wait("background running reply", lambda: "The checks are running." in plain(proof.pane()))
    proof.capture("background-running")
    (proof.repo / "background-release").touch()
    proof.wait("background terminal delivery", lambda: "The checks passed." in plain(proof.pane()))
    proof.capture("background-success")


def render_screenshots(bun, out, timeline):
    result = run([bun, str(ROOT / "scripts/tui/tasks-ui-proof-screenshots.ts"), str(out)], timeout=60, check=False)
    (out / "screenshot-log.txt").write_text(result.stdout + result.stderr)
    if result.returncode: raise RuntimeError("Screenshot helper failed; see screenshot-log.txt")
    return all((out / (frame["step"] + ".png")).is_file() for frame in timeline)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--build-record", required=True)
    ap.add_argument("--out", required=True, help="new empty capture directory")
    ap.add_argument("--bun", default="/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun")
    ap.add_argument("--timeout", type=float, default=75)
    ap.add_argument("--no-screenshots", action="store_true", help="mechanics diagnostics only; never acceptance")
    args = ap.parse_args()
    if not shutil.which("tmux"): ap.error("tmux is required")
    record = json.loads(Path(args.build_record).read_text())
    binary = Path(record["binary"]).resolve()
    if digest(binary) != record["binarySha256"]: ap.error("Binary digest differs from build record")
    if not re.fullmatch(r"[a-f0-9]{40}", record["sourceCommit"]): ap.error("Missing source commit")
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    proof = NativeCapture(args.bun, args.timeout, out)
    error, screenshots, task_launch = None, False, {}
    with proof.session():
        try:
            capture_scenario(proof, binary, task_launch)
            if not args.no_screenshots:
                screenshots = render_screenshots(args.bun, out, proof.timeline)
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            try: proof.capture("error-state")
            except Exception: pass
    frames, fixture = proof.frames, proof.fixture
    checks = audit(frames, task_launch.get("id", "MISSING_TYPED_ID")) if all(s in frames for s in ["spinner-only","partial-label","label-code-stream","foreground-running","foreground-success","expanded-ctrl-o","code-first","concise-failure","background-launched","background-running","background-success"]) else {}
    checks["seven_bounded_sdk_requests"] = len(fixture.records) == 7 and not fixture.errors
    checks["screenshots_complete"] = screenshots
    (out / "requests.json").write_text(json.dumps(fixture.records, indent=2) + "\n")
    (out / "build.json").write_text(json.dumps(record, indent=2) + "\n")
    report = {"sourceCommit":record["sourceCommit"], "binarySha256":record["binarySha256"],
              "error":error, "fixtureErrors":fixture.errors, "checks":checks, "taskLaunch":task_launch,
              "passed":error is None and bool(checks) and all(checks.values()),
              "screenshotKind":"unedited full ANSI native-PTY replay in cached Chromium",
              "visualReview":"required: parent must open the PNGs; assertion pass is not visual acceptance",
              "toolingSha256":{p.name:digest(p) for p in [Path(__file__), ROOT / "scripts/tui/tasks-ui-proof-screenshots.ts", ROOT / "scripts/tui/tasks-ui-proof-build.ts"]}}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
