#!/usr/bin/env python3
"""Proposal #23 compiled-terminal preparation. No source CLI fallback, build or paid API."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import time
import uuid


def tool(call_id, label, code):
    return {"type": "function_call", "id": "fc_" + call_id, "call_id": call_id,
            "name": "execute", "arguments": json.dumps({"label": label, "code": code})}


def prose(text, phase=None):
    item = {"type": "message", "id": "msg_" + uuid.uuid4().hex, "role": "assistant",
            "content": [{"type": "output_text", "text": text, "annotations": []}]}
    if phase:
        item["phase"] = phase
    return item


def fixture(body, root):
    """Select from retained tool identities, not request number (safe on reopen)."""
    items = body.get("input", [])
    called = {i.get("call_id", "").split("|")[0] for i in items if i.get("type") == "function_call_output"}
    users = [json.dumps(i.get("content", "")) for i in items if i.get("role") == "user"]
    latest = users[-1] if users else ""
    # Deliveries can add user-role task/question messages; consult the explicit request too.
    user_text = "\n".join(users)
    failed = [i for i in items if i.get("type") == "function_call_output" and
              any(error in str(i.get("output", "")) for error in ["Execution failed", "BuildMessage:", "Persistent questions need"])]
    if failed:
        return [prose("The fixture action failed. Inspect its original error before continuing this acceptance run.", "final_answer")]
    if "Inspect grouped records" in user_text:
        for call_id, label in [("record-a", "Read first record"), ("record-b", "Read second record"), ("record-c", "Read third record")]:
            if call_id not in called:
                return [tool(call_id, label, 'console.log("' + call_id.upper() + '_DETAIL\\n" + Array.from({length:12}, (_,i)=>"' + call_id.upper() + '_LINE_"+i).join("\\n"));')]
        if "split-a" not in called:
            return [prose("Saved note: the next records belong to a separate step.", "commentary"),
                    tool("split-a", "Read fourth record", 'console.log("SPLIT_A_DETAIL");')]
        if "split-b" not in called:
            return [tool("split-b", "Read fifth record", 'console.log("SPLIT_B_DETAIL");')]
        return [prose("Grouped records are ready. The saved note remains visible.", "final_answer")]
    if "Run lifecycle checks" in user_text:
        if "launch-lifecycle" not in called:
            code = []
            for name, status in [("complete", 0), ("fail", 7), ("cancel", 0)]:
                gate = shlex.quote(str(root / "gates" / name))
                cmd = "sh -c " + shlex.quote("printf '" + name + " check started\n'; while [ ! -e " + gate + " ]; do sleep 0.1; done; printf '" + name + " check settled\n'; exit " + str(status))
                code.append('const ' + name + ' = await shell(' + json.dumps(cmd) + ', {waitSeconds:0});')
            code.append('await Bun.write(' + json.dumps(str(root / "lifecycle-jobs.json")) + ', JSON.stringify({complete:complete.id,fail:fail.id,cancel:cancel.id}));')
            code.append('console.log({complete,fail,cancel}); await jobs.snooze(cancel.id,{minutes:0.02});')
            return [tool("launch-lifecycle", "Start lifecycle checks", " ".join(code))]
        if "Cancel fixture check" in user_text and "cancel-lifecycle" not in called:
            return [tool("cancel-lifecycle", "Cancel the fixture check", 'const ids = await Bun.file(' + json.dumps(str(root / "lifecycle-jobs.json")) + ').json(); console.log(await jobs.stop(ids.cancel));')]
        return [prose("Lifecycle checks are available for inspection.", "final_answer")]
    if "Keep concise" in user_text:
        if "resolve-question" not in called:
            return [tool("resolve-question", "Use the notes preference",
                         'const q = (await questions.list()).find(q => q.text === "How detailed should the notes be?"); '
                         'if (q) await questions.resolve({id:q.id,owner:q.owner,version:q.version,reason:"Used your preference"});')]
        return [prose("I will keep the notes concise. Your preference is saved.", "final_answer")]
    if "Ask about notes" in user_text:
        if "ask-question" not in called:
            return [tool("ask-question", "Ask about the notes",
                         'const q = await questions.ask({text:"How detailed should the notes be?",'
                         'choices:["Keep concise","Include examples"],dedupKey:"activity-acceptance-notes"}); '
                         'await questions.block({id:q.id,owner:q.owner,version:q.version,checkpoint:"Write notes using the saved answer",foreground:true});')]
        return [prose("How detailed should the notes be? Please choose a saved answer.", "final_answer")]
    if "While checks run" in user_text:
        if "foreground-read" not in called:
            gate = json.dumps(str(root / "gates" / "foreground"))
            return [prose("I am checking the release note while the checks run.", "commentary"),
                    tool("foreground-read", "Read the release note",
                         'while (!(await Bun.file(' + gate + ').exists())) await Bun.sleep(100); '
                         'console.log("Release note: keep the setup instructions short.");')]
        # A completion delivery after the foreground result gets a separate lasting answer.
        if "While checks run" not in latest:
            return [prose("The background check update is available. The release note remains unchanged.", "final_answer")]
        return [prose("The release note recommends short setup instructions.", "final_answer")]
    if "Run parallel checks" in user_text:
        if "launch-checks" not in called:
            commands = []
            for name in ["slow", "fast"]:
                gate = shlex.quote(str(root / "gates" / name))
                cmd = "sh -c " + shlex.quote("while [ ! -e " + gate + " ]; do sleep 0.1; done; printf '" + name + " check complete\n'")
                commands.append('console.log(await shell(' + json.dumps(cmd) + ', {waitSeconds:0}));')
            return [prose("I am starting two independent checks.", "commentary"),
                    tool("launch-checks", "Start parallel checks", " ".join(commands))]
        if "Run parallel checks" not in latest:
            return [prose("A background check update is available; inspect the check results.", "final_answer")]
        return [prose("The checks are running. You can continue while they finish.", "final_answer")]
    if "guide-a" not in called:
        return [prose("I am reading the project guide.", "commentary"),
                tool("guide-a", "Read the project guide", 'console.log(await Bun.file("README.md").text());')]
    if "guide-b" not in called:
        return [prose("I am checking the setup command.", "commentary"),
                tool("guide-b", "Check the setup command", r'console.log("Install dependencies, then run the local app.\nOriginal setup detail: npm install");')]
    if "guide-c" not in called:
        return [prose("Important: the example configuration is not a production credential."),
                tool("guide-c", "Check the example configuration", 'console.log("Example configuration contains no production credential.");')]
    return [prose("The guide needs three steps: install dependencies, run the local app, and open the browser. The example configuration is safe to share.", "final_answer")]


def events(items):
    response_id = "resp_" + uuid.uuid4().hex
    for index, item in enumerate(items):
        yield {"type": "response.output_item.added", "output_index": index, "item": {**item, "status": "in_progress", **({"arguments": ""} if item["type"] == "function_call" else {"content": []})}}
        if item["type"] == "message":
            text = item["content"][0]["text"]
            yield {"type": "response.content_part.added", "output_index": index, "content_index": 0,
                   "item_id": item["id"], "part": {"type": "output_text", "text": "", "annotations": []}}
            yield {"type": "response.output_text.delta", "output_index": index, "content_index": 0,
                   "item_id": item["id"], "delta": text}
        else:
            yield {"type": "response.function_call_arguments.delta", "output_index": index,
                   "item_id": item["id"], "delta": item["arguments"]}
        yield {"type": "response.output_item.done", "output_index": index, "item": {**item, "status": "completed"}}
    yield {"type": "response.completed", "response": {"id": response_id, "status": "completed", "output": items,
           "usage": {"input_tokens": 80, "output_tokens": 40, "total_tokens": 120}}}


def serve(root):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            if not self.path.endswith("/responses"):
                self.send_error(404)
                return
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            with (root / "requests.jsonl").open("a") as f:
                f.write(json.dumps(body) + "\n")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                for event in events(fixture(body, root)):
                    self.wfile.write(("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n").encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    (root / "port").write_text(str(server.server_port))
    server.serve_forever()


def tmux(root, *args, check=True):
    state = json.loads((root / "state.json").read_text())
    return subprocess.run(["tmux", "-L", state["socket"], "-f", str(Path(__file__).with_name("tmux.conf")), *args],
                          check=check, capture_output=True, text=True).stdout


def draft_ready(frame, text):
    return any(line.lstrip().startswith(" " + text) for line in frame.splitlines())


def send(root, text):
    tmux(root, "send-keys", "-t", "activity", "-l", text)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if draft_ready(tmux(root, "capture-pane", "-p", "-t", "activity"), text):
            tmux(root, "send-keys", "-t", "activity", "Enter")
            return
        time.sleep(.05)
    capture(root, "submit-draft-TIMEOUT", display=False)
    raise AssertionError("Editor did not display the intended draft before Enter")


def capture(root, name, display=True):
    out = root / "frames"
    out.mkdir(exist_ok=True)
    frame = tmux(root, "capture-pane", "-p", "-t", "activity")
    (out / (name + ".txt")).write_text(frame)
    (out / (name + ".ansi")).write_text(tmux(root, "capture-pane", "-p", "-e", "-t", "activity"))
    if display:
        print(frame, end="")
    return frame


def launch(root, reopen=False):
    state = json.loads((root / "state.json").read_text())
    env = {"HOME": str(root / "home"), "BRUV_CODING_AGENT_DIR": str(root / "agent"),
           "HERDR_ENV": "0", "TERM": "xterm-256color", "PATH": os.environ["PATH"],
           "SHELL": "/bin/sh", "LANG": "C.UTF-8"}
    args = [state["binary"], "--offline", "--no-approve", "--provider", "activity-fixture", "--model", "acceptance",
            "--tui-mode", "fullscreen", "--session-dir", str(root / "sessions")]
    if state.get("session"):
        args += ["--session", state["session"]]
    elif reopen:
        args += ["--continue"]
    command = "env -i " + " ".join(shlex.quote(k + "=" + v) for k, v in env.items())
    command += " " + shlex.join(args)
    if reopen:
        tmux(root, "respawn-pane", "-k", "-t", "activity", "-c", str(root / "project"), command)
    else:
        tmux(root, "new-session", "-d", "-s", "activity", "-x", "120", "-y", "40", "-c", str(root / "project"), command)
    tmux(root, "pipe-pane", "-o", "-t", "activity", "cat >> " + shlex.quote(str(root / "transcript.ansi")))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["start", "serve", "send", "key", "click", "frame", "record", "resize", "release", "reopen", "stop"])
    parser.add_argument("root", type=Path, help="Dedicated disposable evidence directory (absolute recommended)")
    parser.add_argument("args", nargs="*")
    a = parser.parse_args()
    root = a.root.resolve()
    if a.command == "serve":
        return serve(root)
    if a.command == "start":
        if len(a.args) != 1:
            parser.error("start requires an already compiled bruv binary")
        binary = Path(a.args[0]).resolve()
        if not binary.is_file() or not os.access(binary, os.X_OK) or binary.suffix in [".ts", ".js"]:
            parser.error("An executable compiled CLI is required; no source/build fallback")
        root.mkdir(parents=True, exist_ok=False)
        for name in ["home", "agent", "project", "gates", "sessions"]:
            (root / name).mkdir()
        (root / "project" / "README.md").write_text("# Local app\n\nInstall dependencies.\nRun the development server.\nOpen the local app in your browser.\nOriginal guide detail: use the example configuration for local testing only.\n")
        state = {"binary": str(binary), "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
                 "socket": "bruv-activity-" + uuid.uuid4().hex[:10], "created": time.time()}
        with (root / "provider.log").open("w") as log:
            provider = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "serve", str(root)], stdout=log, stderr=log, start_new_session=True)
        state["provider_pid"] = provider.pid
        (root / "state.json").write_text(json.dumps(state, indent=2))
        for _ in range(100):
            if (root / "port").exists():
                break
            time.sleep(.05)
        else:
            raise RuntimeError("Fixture failed to start; inspect provider.log and use stop for cleanup")
        port = int((root / "port").read_text())
        models = {"providers": {"activity-fixture": {"baseUrl": f"http://127.0.0.1:{port}/v1", "api": "openai-responses",
                  "apiKey": "fixture-only-no-real-credentials", "models": [{"id": "acceptance", "name": "Activity acceptance", "contextWindow": 32000, "maxTokens": 2048}]}}}
        (root / "agent" / "models.json").write_text(json.dumps(models, indent=2))
        launch(root)
        print("Started compiled terminal. Evidence:", root)
        print("Attach: tmux -L", state["socket"], "attach -t activity")
        return
    if a.command == "send":
        send(root, " ".join(a.args))
    elif a.command == "key":
        tmux(root, "send-keys", "-t", "activity", *a.args)
    elif a.command == "click":
        x, y = map(int, a.args)
        # Literal SGR bytes reach the CLI, not tmux copy-mode. Coordinates are 1-based visible cells.
        tmux(root, "send-keys", "-t", "activity", "-l", f"\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m")
    elif a.command == "frame":
        name = a.args[0] if a.args else str(time.time_ns())
        if Path(name).name != name:
            parser.error("frame name must be a basename")
        capture(root, name)
    elif a.command == "record":
        seconds = float(a.args[0]) if a.args else 5
        if not 0 < seconds <= 60:
            parser.error("record duration must be 0 < seconds <= 60")
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            capture(root, "record-" + str(time.time_ns()), display=False)
            time.sleep(.15)
    elif a.command == "resize":
        width, height = map(int, a.args)
        tmux(root, "resize-window", "-t", "activity", "-x", str(width), "-y", str(height))
    elif a.command == "release":
        for name in a.args:
            if name not in ["fast", "slow", "foreground", "complete", "fail", "cancel"]:
                parser.error("Unknown fixture gate")
            (root / "gates" / name).touch()
    elif a.command == "reopen":
        capture(root, "before-reopen")
        launch(root, reopen=True)
    elif a.command == "stop":
        # Let shell jobs finish before terminating the terminal; evidence is retained.
        for name in ["fast", "slow", "foreground", "complete", "fail", "cancel"]:
            (root / "gates" / name).touch()
        tmux(root, "kill-server", check=False)
        state = json.loads((root / "state.json").read_text())
        try:
            os.kill(state["provider_pid"], signal.SIGTERM)
        except ProcessLookupError:
            pass
        print("Stopped fixture and tmux; evidence retained at", root)


if __name__ == "__main__":
    main()
