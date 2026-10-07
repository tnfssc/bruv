#!/usr/bin/env python3
"""Bounded offline tmux acceptance. Requires owner's fresh binary; never builds.
Usage: python3 scripts/activity-runtime-acceptance.py BINARY NEW_EVIDENCE_ROOT
The loopback fixture, HOME, journal and tmux server are private. Evidence is retained.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

HARNESS = Path(__file__).with_name("activity-terminal-acceptance.py").resolve()
spec = importlib.util.spec_from_file_location("activity_fixture", HARNESS)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def result_row(frame, token):
    return bool(re.search(r"^\s*" + re.escape(token) + r"\s*[│┃]?\s*$", frame, re.M))


def notice_record(entry, kind, task_id=None, status=None):
    # Pi persists custom messages at the entry root, not inside message.
    if entry.get("type") != "custom_message" or entry.get("customType") != kind:
        return None
    if task_id is not None and not any(t.get("id") == task_id and t.get("status") == status for t in entry.get("details", {}).get("tasks", [])):
        return None
    return entry


def lifecycle_rows(frame):
    rows = [line.strip() for line in frame.splitlines() if "Start lifecycle checks" in line]
    assert len(rows) == 3, rows
    assert any(line.startswith("✓") for line in rows), rows
    assert any("exit 7" in line for line in rows), rows
    assert any("cancelled" in line for line in rows), rows


def saved_resume(records):
    q, = [q for q in records if q.get("text") == "How detailed should the notes be?"]
    assert q["status"] == "answered" and q["answer"] == "Keep concise", q
    assert q["delivery"] == "resume-needed", q
    return q["id"]


def startup_ready(frame):
    return "mode: orchestrator" in frame and "acceptance" in frame and "" in frame


def header_contract(frame, prose_tokens):
    """Headers share surrounding output's LEFT inset, not blank vertical rows."""
    lines = frame.splitlines()
    headers = [line for line in lines if re.search(r"[23] tools called", line)]
    assert len(headers) == 2, headers
    prose = [line for line in lines if any(token in line for token in prose_tokens)]
    assert prose, "Surrounding prose missing"
    insets = {len(line) - len(line.lstrip()) for line in prose}
    assert len(insets) == 1, ("Inconsistent surrounding output inset", prose)
    for line in headers:
        assert not any(arrow in line for arrow in "▸▾▶▼"), line
        assert len(line) - len(line.lstrip()) == next(iter(insets)), ("Header left alignment", line, prose)


def prepare_long_thread(root):
    """Install the private saved journal and select it for the next reopen.

    Return its original lines so acceptance can check replay without rewriting.
    This creates fixture data only; it does not run the CLI or prove rendering.
    """
    journal = root / "sessions" / "acceptance-long.jsonl"
    records = [{"type":"session", "version":3, "id":str(uuid.uuid4()), "timestamp":"2026-10-04T12:00:00.000Z", "cwd":str(root / "project")}]
    parent = None
    usage = {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}
    def append(message):
        nonlocal parent
        eid = uuid.uuid4().hex[:8]
        records.append({"type":"message","id":eid,"parentId":parent,"timestamp":"2026-10-04T12:00:00.000Z","message":message})
        parent = eid
    def assistant(content, stop):
        return {"role":"assistant","content":content,"api":"openai-responses","provider":"activity-fixture","model":"acceptance","usage":usage,"stopReason":stop,"timestamp":1791115200000}
    for turn in range(100):
        append({"role":"user","content":"Saved turn " + str(turn),"timestamp":1791115200000})
        for tool in range(10):
            cid = f"saved-{turn}-{tool}"
            token = "DETAIL_" + cid
            append(assistant([{"type":"toolCall","id":cid,"name":"execute","arguments":{"label":"Read saved file " + cid,"code":'console.log("' + token + '")'}}], "toolUse"))
            append({"role":"toolResult","toolCallId":cid,"toolName":"execute","content":[{"type":"text","text":token}],"details":{"exitCode":0,"stdout":token,"stderr":"","images":[]},"isError":False,"timestamp":1791115200000})
    append(assistant([{"type":"text","text":"LONG_THREAD_READY"}], "stop"))
    journal.write_text("".join(json.dumps(r) + "\n" for r in records))
    original_lines = journal.read_text().splitlines()
    state_path = root / "state.json"
    state = json.loads(state_path.read_text()); state["session"] = str(journal)
    state_path.write_text(json.dumps(state, indent=2))
    return journal, original_lines


class Run:
    def __init__(self, root, binary):
        self.root, self.binary = root, binary
        self.timings = {}

    def command(self, command, *args):
        argv = [sys.executable, str(HARNESS), command, str(self.root), *map(str, args)]
        with (self.root.parent / "commands.jsonl").open("a") as f:
            f.write(json.dumps({"time": time.time(), "argv": argv}) + "\n")
        r = subprocess.run(argv, capture_output=True, text=True, timeout=35)
        if r.returncode:
            raise RuntimeError(r.stderr + r.stdout)
        return r.stdout

    def wait(self, name, predicate, seconds=20):
        start = time.monotonic()
        while time.monotonic() - start < seconds:
            frame = h.tmux(self.root, "capture-pane", "-p", "-t", "activity")
            if predicate(frame):
                self.timings[name] = round(time.monotonic() - start, 3)
                return h.capture(self.root, name, display=False)
            time.sleep(.1)
        h.capture(self.root, name + "-TIMEOUT", display=False)
        raise AssertionError("No ready visible frame: " + name)

    def text(self, name, *tokens, seconds=20):
        return self.wait(name, lambda f: all(t in f for t in tokens), seconds)

    def click(self, frame, token, occurrence=None):
        rows = [(y, line) for y, line in enumerate(frame.splitlines(), 1) if token in line]
        if occurrence is None:
            assert len(rows) == 1, (token, rows)
        y, line = rows[occurrence or 0]
        self.command("click", line.index(token) + 2, y)

    def no_details(self, frame):
        assert "console.log" not in frame, "Group opening exposed full source"
        for token in ["RECORD-A_DETAIL", "RECORD-B_DETAIL", "RECORD-C_DETAIL", "SPLIT_A_DETAIL", "SPLIT_B_DETAIL"]:
            assert not result_row(frame, token), token

    def rows(self):
        self.command("resize", 120, 60)
        self.command("send", "Inspect grouped records.")
        f = self.text("settled", "Grouped records are ready.", "3 tools called", "2 tools called", "Saved note:")
        self.no_details(f)
        header_contract(f, ["Saved note:", "Grouped records are ready."])
        ansi = (self.root / "frames/settled.ansi").read_text()
        assert "\x1b[" in ansi, "ANSI theme evidence missing"
        before = len((self.root / "requests.jsonl").read_text().splitlines())
        self.click(f, "3 tools called")
        f = self.text("group-open-rows", "Read first record", "Read second record", "Read third record")
        self.no_details(f)
        self.click(f, "Read first record")
        f = self.wait("first-detail", lambda f: result_row(f, "RECORD-A_DETAIL"))
        assert not result_row(f, "RECORD-B_DETAIL") and not result_row(f, "RECORD-C_DETAIL")
        self.click(f, "Read second record")
        f = self.wait("two-independent-details", lambda f: result_row(f, "RECORD-A_DETAIL") and result_row(f, "RECORD-B_DETAIL"))
        # Native expanded execute rows use their original type heading, not the
        # collapsed action label. Click only the first expanded native row.
        self.click(f, "Execute · TypeScript", occurrence=0)
        f = self.wait("first-closed-second-open", lambda f: not result_row(f, "RECORD-A_DETAIL") and result_row(f, "RECORD-B_DETAIL"))
        self.click(f, "3 tools called")
        f = self.wait("group-closed", lambda f: "3 tools called" in f and "Read second record" not in f)
        self.click(f, "3 tools called")
        f = self.wait("group-reopened-independent", lambda f: result_row(f, "RECORD-B_DETAIL") and "Read first record" in f)
        assert not result_row(f, "RECORD-A_DETAIL") and not result_row(f, "RECORD-C_DETAIL")
        self.command("send", "/activity")
        self.text("activity-picker", "Activity", "Esc returns", "3 tools called", "2 tools called")
        self.command("key", "Escape")
        self.wait("activity-cancelled", lambda f: "Esc returns" not in f and result_row(f, "RECORD-B_DETAIL"))
        self.command("key", "C-o")
        self.wait("ctrl-o-expanded-ready", lambda f: result_row(f, "RECORD-A_DETAIL"))
        self.command("key", "End")
        self.wait("ctrl-o-all", lambda f: result_row(f, "SPLIT_B_DETAIL"))
        self.command("key", "C-o")
        f = self.wait("ctrl-o-collapsed", lambda f: "2 tools called" in f and not result_row(f, "SPLIT_B_DETAIL"))
        assert len((self.root / "requests.jsonl").read_text().splitlines()) == before, "Expansion called provider"
        self.command("send", "/reload")
        self.text("after-reload", "Reloaded keybindings", "2 tools called")
        self.command("send", "/activity")
        self.text("reloaded-picker", "Activity", "Esc returns")
        self.command("key", "Escape")
        self.command("reopen")
        self.text("reopened", "Grouped records are ready.", "2 tools called")
        assert len((self.root / "requests.jsonl").read_text().splitlines()) == before, "Replay called provider"
        self.command("send", "/activity")
        self.text("reopened-picker", "Activity", "Esc returns")
        self.command("key", "Escape")

        self.command("send", "/activity")
        self.text("activity-select-ready", "Activity", "Esc returns")
        self.command("key", "Enter")
        self.wait("activity-selected", lambda f: "Esc returns" not in f and any(t in f for t in ["Read first record", "Read fourth record"]))

    def question(self):
        self.command("send", "Ask about notes.")
        self.text("pending-question", "How detailed should the notes be?")
        self.command("reopen")
        self.text("pending-reopened", "How detailed should the notes be?")
        self.command("send", "/questions")
        self.text("question-picker", "Questions", "unanswered", "How detailed should the notes be?")
        self.command("key", "Enter")
        self.text("answer-picker", "How detailed should the notes be?", "Keep concise", "Include examples")
        self.command("key", "Enter")
        self.text("answer-saved-after-reopen", "No unanswered questions", "1 saved")
        ledger, = (self.root / "sessions").glob("*.questions.json")
        records = json.loads(ledger.read_text())
        (self.root / "answer-saved.json").write_text(json.dumps(records, indent=2))
        # A fresh process deliberately requires explicit resume of a saved reply.
        resume = "/questions resume " + saved_resume(records)
        self.submit_saved_resume(resume)
        self.text("answer-used", "I will keep the notes concise.")
        before = len((self.root / "requests.jsonl").read_text().splitlines())
        self.command("reopen")
        self.text("answered-reopened", "I will keep the notes concise.")
        assert len((self.root / "requests.jsonl").read_text().splitlines()) == before

    def submit_saved_resume(self, resume):
        self.command("send", resume)
        f = self.wait("resume-command-ready", lambda f: h.draft_ready(f, resume) or "Saved answer queued" in f or "I will keep the notes concise." in f)
        # Native argument completion consumes the first Enter. Submit once more
        # only when the exact command is still visibly the editor draft.
        if h.draft_ready(f, resume):
            self.command("key", "Enter")

    def notice(self, name, kind, task_id=None, status=None):
        start = time.monotonic()
        while time.monotonic() - start < 20:
            for path in (self.root / "sessions").glob("*.jsonl"):
                for line in path.read_text().splitlines():
                    try: entry = json.loads(line)
                    except json.JSONDecodeError: continue
                    message = notice_record(entry, kind, task_id, status)
                    if message is None: continue
                    (self.root / (name + "-notice.json")).write_text(json.dumps(message, indent=2))
                    self.timings[name] = round(time.monotonic()-start, 3)
                    return
            time.sleep(.1)
        raise AssertionError("No persisted real notice: " + name)

    def lifecycle(self):
        self.command("send", "Run lifecycle checks.")
        self.text("lifecycle-running", "Lifecycle checks are available for inspection.")
        ids = json.loads((self.root / "lifecycle-jobs.json").read_text())
        # Snooze's real 1.2s review checkpoint reaches the journal even when the
        # human view intentionally hides quiet attention. No fake custom entry.
        self.notice("attention-wake", "task-attention")
        h.capture(self.root, "attention-wake", display=False)
        for gate, status, name in [("complete", "completed", "late-complete"), ("fail", "failed", "late-fail")]:
            self.command("release", gate)
            self.notice(name, "task-complete", ids[gate], status)
            self.text(name, "Lifecycle checks are available for inspection.", "1 tool called")
        self.command("send", "Cancel fixture check.")
        self.notice("late-cancel", "task-complete", ids["cancel"], "killed")
        self.text("late-cancel", "Lifecycle checks are available for inspection.")
        for name in ["attention-wake", "late-complete", "late-fail", "late-cancel"]:
            frame = (self.root / "frames" / (name + ".txt")).read_text()
            assert "asynchronous task" not in frame and "reached an attention checkpoint" not in frame, "Raw standalone notice leaked"
        f = self.text("lifecycle-summary", "1 job failed", "1 cancelled")
        assert "Start lifecycle checks" not in f, "Collapsed group leaked child task rows"
        self.click(f, "1 tool called", occurrence=0)
        f = self.text("lifecycle-child-rows", "Start lifecycle checks", "exit 7", "cancelled")
        lifecycle_rows(f)
        assert "console.log" not in f, "Group opening exposed full task detail"
        self.click(f, "Start lifecycle checks", occurrence=0)
        f = self.text("task-detail", "console.log")
        self.click(f, "1 tool called", occurrence=0)
        f = self.wait("task-detail-hidden", lambda f: "1 job failed" in f and "console.log" not in f)
        assert "Start lifecycle checks" not in f
        self.click(f, "1 tool called", occurrence=0)
        self.text("task-detail-restored", "console.log")
        self.command("key", "C-o")
        self.text("lifecycle-expanded-ready", "console.log")
        self.command("key", "End")
        # End shows the last delivery, not all three source rows at once.
        self.text("lifecycle-details", ids["cancel"] + " killed", "Signal: SIGTERM")
        # Review collapsed/open captures for duplicate standalone canonical rows.
        # stdout "check started" is NOT a typed progress-notification claim.

    def long_thread(self):
        journal, original_lines = prepare_long_thread(self.root)
        self.command("resize", 100, 30)
        start = time.monotonic()
        self.command("reopen")
        self.text("long-loaded", "LONG_THREAD_READY", "10 tools called", seconds=45)
        self.timings["long-startup"] = round(time.monotonic()-start, 3)
        h.tmux(self.root, "send-keys", "-t", "activity", "-l", "long-thread-draft")
        self.text("long-draft", "long-thread-draft")
        self.command("key", "Home")
        f = self.text("oldest", "Saved turn 0", "10 tools called")
        anchor = next(line.strip() for line in f.splitlines() if "Saved turn 0" in line)
        self.click(f, "10 tools called", occurrence=0)
        f = self.text("oldest-rows", "Read saved file saved-0-0")
        assert anchor in f, "Opening rows lost the reading anchor"
        assert not result_row(f, "DETAIL_saved-0-0")
        self.click(f, "Read saved file saved-0-0")
        f = self.wait("oldest-detail", lambda f: result_row(f, "DETAIL_saved-0-0"))
        assert anchor in f, "Opening detail lost the reading anchor"
        self.command("key", "End")
        self.text("long-bottom", "LONG_THREAD_READY", "long-thread-draft")
        self.command("key", "C-o")
        self.wait("long-expanded-anchor", lambda f: "long-thread-draft" in f and bool(re.search(r"^\s*DETAIL_saved-\d+-\d+\s*[│┃]?\s*$", f, re.M)))
        self.command("key", "End")
        self.wait("long-last-detail", lambda f: result_row(f, "DETAIL_saved-99-9"))
        self.command("key", "C-o")
        self.wait("long-recollapsed", lambda f: "10 tools called" in f and not result_row(f, "DETAIL_saved-99-9"))
        self.command("resize", 48, 30)
        self.text("long-narrow", "long-thread-draft", "LONG_THREAD_READY")
        self.command("reopen")
        self.text("long-reopened", "LONG_THREAD_READY", "10 tools called", seconds=45)
        self.command("key", "C-o")
        self.wait("long-reopened-expanded-ready", lambda f: bool(re.search(r"^\s*DETAIL_saved-\d+-\d+\s*[│┃]?\s*$", f, re.M)))
        self.command("key", "End")
        self.wait("long-reopened-detail", lambda f: result_row(f, "DETAIL_saved-99-9"))
        replay_lines = journal.read_text().splitlines()
        assert replay_lines[:len(original_lines)] == original_lines, "Replay rewrote original journal"
        assert sum(json.loads(line).get("message", {}).get("role") == "toolResult" for line in replay_lines) == 1000
        assert not (self.root / "requests.jsonl").exists(), "Unsubmitted replay invoked provider"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("binary", type=Path)
    p.add_argument("root", type=Path)
    p.add_argument("--cases", nargs="+", choices=["rows", "lifecycle", "question", "long_thread"], default=["rows", "lifecycle", "question", "long_thread"])
    a = p.parse_args()
    binary, root = a.binary.resolve(), a.root.resolve()
    if not binary.is_file(): p.error("Owner's fresh compiled binary is not available")
    root.mkdir(parents=True, exist_ok=False)
    report = {"binary":str(binary), "sha256":hashlib.sha256(binary.read_bytes()).hexdigest(), "cases":{}, "visual_review":"required before product acceptance", "limits":["Loopback provider/Linux tmux only", "ANSI files require visual theme review", "No typed progress event, paid provider, remote, clipboard or web proof", "Long-thread timings are observations, not a benchmark"]}
    try:
        for case in a.cases:
            run = Run(root / case, binary)
            try:
                run.command("start", binary)
                run.wait("startup-ready", startup_ready)
                getattr(run, case)()
                report["cases"][case] = {"status":"passed", "timings":run.timings}
            except Exception as e:
                report["cases"][case] = {"status":"failed", "error":str(e), "timings":run.timings}
                if (run.root / "state.json").exists():
                    try: h.capture(run.root, "failure", display=False)
                    except subprocess.CalledProcessError: pass
            finally:
                if (run.root / "state.json").exists():
                    run.command("stop")
    finally:
        (root / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return int(any(c["status"] != "passed" for c in report["cases"].values()))

if __name__ == "__main__":
    sys.exit(main())
