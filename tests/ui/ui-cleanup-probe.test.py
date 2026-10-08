"""Focused contracts for the scripted terminal probe; run directly with Python."""
import contextlib
import importlib.util
import io
import json
import shlex
import subprocess
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import Mock, call, patch

spec = importlib.util.spec_from_file_location(
    "ui_cleanup_probe", Path(__file__).resolve().parents[2] / "scripts" / "ui-cleanup-probe.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

SETTLED = """Read fixture output

DIRECT_PROSE_MARKER
✗ Failed · Trigger expected error
truncated · Read large output
THINK_FIRST_MARKER

FINAL_FIRST_MARKER
↪ TASKS_WAITING_MARKER
✓ task_a finished, ✗ task_b failed, ✓ task_c finished
THINK_BATCH_MARKER

FINAL_BATCH_MARKER
"""
ANSI = "\x1b[32m" + SETTLED + "\x1b[0m"
ASSERTION_NAMES = set("""inflight_row inflight_quiet expanded_source expanded_output
six_bounded_requests success_row settled_quiet_actions error_row long_row_truncated_only
no_output_file_count handoff_row ordered_task_batch direct_prose_spacing first_spacing
batch_spacing markers_present no_unexpected_request ansi_evidence""".split())


class ProbeContracts(unittest.TestCase):
    def test_six_scripted_responses_keep_tool_and_marker_protocol(self):
        responses = {}
        for request in range(1, 8):
            payload = p.sse_for(request).decode()
            self.assertTrue(payload.endswith("data: [DONE]\n\n"))
            responses[request] = [json.loads(row[6:]) for row in payload.splitlines()
                                  if row.startswith("data: ") and row != "data: [DONE]"]

        tool_cases = (
            (1, "Read fixture output", 'console.log("SUCCESS_OUTPUT"); await Bun.sleep(1200)'),
            (2, "Trigger expected error", 'throw new Error("EXPECTED_BOOM")'),
            (3, "Read large output", 'console.log("L".repeat(6000))'),
            (5, None, '''const a = await shell("sleep 0.20; exit 0", { waitSeconds: 0 });
const b = await shell("sleep 0.21; exit 7", { waitSeconds: 0 });
const c = await shell("sleep 0.22; exit 0", { waitSeconds: 0 });
await handoff("TASKS_WAITING_MARKER");'''),
        )
        for request, label, code in tool_cases:
            with self.subTest(request=request):
                events = responses[request]
                tool = next(e["choices"][0]["delta"]["tool_calls"][0] for e in events
                            if "tool_calls" in e["choices"][0]["delta"])
                self.assertEqual(tool["function"]["name"], "execute")
                self.assertEqual(events[-1]["choices"][0]["finish_reason"], "tool_calls")
                arguments = json.loads(tool["function"]["arguments"])
                self.assertEqual(arguments.get("label"), label)
                self.assertEqual(arguments["code"], code)

        self.assertEqual(responses[2][0]["choices"][0]["delta"]["content"], "DIRECT_PROSE_MARKER")
        for request, think, final in ((4, "THINK_FIRST_MARKER", "FINAL_FIRST_MARKER"),
                                      (6, "THINK_BATCH_MARKER", "FINAL_BATCH_MARKER")):
            with self.subTest(request=request):
                events = responses[request]
                self.assertEqual(events[1]["choices"][0]["delta"], {"reasoning_content": think})
                self.assertEqual(events[2]["choices"][0]["delta"], {"content": final})
                self.assertEqual(events[-1]["choices"][0]["finish_reason"], "stop")
        self.assertEqual(responses[7][0]["choices"][0]["delta"]["content"], "UNEXPECTED_REQUEST_MARKER")

    def test_loopback_fixture_records_request_without_credentials(self):
        fixture = p.Fixture()
        fixture.start()
        try:
            self.assertEqual(fixture.server.server_address[0], "127.0.0.1")
            body = json.dumps({"messages": [{"role": "user"}, {}, "ignored"]}).encode()
            request = urllib.request.Request(f"http://127.0.0.1:{fixture.port}/v1/chat/completions", body)
            with urllib.request.urlopen(request, timeout=3) as response:
                self.assertEqual(response.headers["Content-Type"], "text/event-stream")
                self.assertEqual(response.read(), p.sse_for(1))
            self.assertEqual(fixture.records, [{"request": 1, "path": "/v1/chat/completions",
                "request_bytes": len(body), "message_roles": ["user", "?"], "response_status": 200}])
        finally:
            fixture.stop()
        self.assertFalse(fixture.thread.is_alive())

    def test_scenario_preserves_phase_evidence_and_all_assertions(self):
        terminal = Mock()
        active = "Read fixture output\n"
        expanded = 'console.log("SUCCESS_OUTPUT"); await Bun.sleep(1200)\nSUCCESS_OUTPUT\n'
        terminal.capture.side_effect = [active, "\x1b[32m" + active, expanded, SETTLED, ANSI]
        with tempfile.TemporaryDirectory() as directory, patch.object(p.time, "sleep"):
            prefix = Path(directory) / "evidence"
            plain, ansi, assertions, error = p.exercise_terminal(terminal, prefix)
            self.assertIsNone(error)
            self.assertEqual(Path(str(prefix) + "-inflight-plain.txt").read_text(), active)
            self.assertEqual(Path(str(prefix) + "-inflight-ansi.txt").read_text(), "\x1b[32m" + active)
            self.assertEqual(Path(str(prefix) + "-expanded-plain.txt").read_text(), expanded)
        self.assertEqual(terminal.wait_for.call_args_list,
                         [call("Read fixture output"), call("FINAL_FIRST_MARKER"), call("FINAL_BATCH_MARKER")])
        self.assertEqual(terminal.send_keys.call_args_list,
                         [call("C-o"), call("C-o"), call("-l", "SECOND_USER_MARKER"), call("Enter")])
        assertions.update(p.settled_assertions(plain, ansi, 6))
        self.assertEqual(set(assertions), ASSERTION_NAMES)
        self.assertTrue(all(assertions.values()), assertions)

    def test_settled_checks_reject_wrong_rows_counts_spacing_and_extra_requests(self):
        plain = SETTLED.replace("truncated · Read large output", "Read large output")
        plain = plain.replace("✗ task_b failed", "✓ task_b finished")
        plain = plain.replace("THINK_FIRST_MARKER\n\n", "THINK_FIRST_MARKER\n")
        plain += "Read fixture output\nRunning\n2 output files\nUNEXPECTED_REQUEST_MARKER\n"
        checks = p.settled_assertions(plain, "", 7)
        for name in ("six_bounded_requests", "success_row", "settled_quiet_actions",
                     "long_row_truncated_only", "no_output_file_count", "ordered_task_batch",
                     "first_spacing", "no_unexpected_request", "ansi_evidence"):
            self.assertFalse(checks[name], name)

    def test_terminal_keeps_private_socket_environment_flags_and_capture_modes(self):
        home, binary = Path("/tmp/probe home"), Path("/tmp/bruv binary")
        terminal = p.Terminal(home, binary, 35)
        with (
            patch.object(p, "run", return_value=Mock(stdout="frame")) as run,
            patch.object(p.time, "monotonic", return_value=100),
        ):
            terminal.start()
            args, kwargs = run.call_args
            self.assertEqual(args[0][:4], ["tmux", "-S", str(home / "tmux.sock"), "-f"])
            self.assertEqual(args[0][5:-1], ["new-session", "-d", "-s", "probe", "-x", "120",
                                           "-y", "36", "-c", str(home)])
            command = shlex.split(args[0][-1])
            self.assertEqual(command[0], "env")
            self.assertEqual(command[1:7], ["HOME=/tmp/probe home", "BRUV_CODING_AGENT_DIR=/tmp/probe home/.bruv/agent",
                "TMPDIR=/tmp/probe home/tmp", "PI_OFFLINE=1", "NO_COLOR=0", "TERM=xterm-256color"])
            self.assertEqual(command[7:], [str(binary), "--no-session", "--no-approve", "--offline", "--provider",
                "fixture", "--model", "fixture-model", "--thinking", "medium", "FIRST_USER_MARKER"])
            self.assertEqual(kwargs["env"]["HOME"], str(home))
            self.assertEqual(terminal.deadline, 135)
            terminal.capture(esc=True, history=False)
            self.assertEqual(run.call_args.args[0][3:], ["capture-pane", "-p", "-e", "-t", "probe"])
            terminal.capture()
            self.assertEqual(run.call_args.args[0][3:], ["capture-pane", "-p", "-S", "-", "-t", "probe"])

    def test_wait_retries_missing_pane_without_resetting_scenario_deadline(self):
        terminal = p.Terminal(Path("/tmp/probe"), Path("/bin/true"), 35)
        unavailable = subprocess.CalledProcessError(1, ["tmux", "capture-pane"])
        with (
            patch.object(p, "run"),
            patch.object(p.time, "monotonic", side_effect=[100]) as clock,
            patch.object(p.time, "sleep") as sleep,
            patch.object(terminal, "capture", side_effect=[unavailable, "\x1b[32mREADY\x1b[0m"]) as capture,
        ):
            terminal.start()
            self.assertEqual(clock.call_count, 1)
            clock.side_effect = [101, 102]
            terminal.wait_for("READY")
            self.assertEqual(clock.call_count, 3)
            clock.side_effect = [136]
            with self.assertRaisesRegex(TimeoutError, "timed out waiting for SECOND"):
                terminal.wait_for("SECOND")
            self.assertEqual(clock.call_count, 4)
        self.assertEqual(terminal.deadline, 135)
        self.assertEqual(capture.call_args_list, [call(history=False), call(history=False)])
        sleep.assert_called_once_with(.08)

    def test_setup_write_failure_releases_fixture_and_temporary_home(self):
        fixture = p.Fixture()
        real_write = Path.write_text
        def fail_models(path, *args, **kwargs):
            if path.name == "models.json":
                raise OSError("injected models write failure")
            return real_write(path, *args, **kwargs)
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(p, "Fixture", return_value=fixture),
            patch.object(Path, "write_text", fail_models),
            patch.object(p.Terminal, "stop") as stop,
        ):
            with self.assertRaisesRegex(OSError, "injected models write failure"):
                with p.isolated_terminal(Path("/bin/true"), Path(directory) / "evidence", 1):
                    self.fail("setup failure must not reach the scenario")
            self.assertFalse(fixture.thread.is_alive())
            self.assertEqual(list(Path(directory).glob("ui-cleanup-work-*")), [])
            stop.assert_called_once()

    def test_launch_failure_still_publishes_partial_evidence_after_cleanup(self):
        fixture = p.Fixture()
        commands = []
        def fail_launch(cmd, **kwargs):
            commands.append(cmd)
            if "new-session" in cmd:
                raise subprocess.CalledProcessError(1, cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout="PARTIAL_FRAME", stderr="")
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(p, "Fixture", return_value=fixture),
            patch.object(p, "run", side_effect=fail_launch),
            patch.object(p.shutil, "which", return_value="tmux"),
        ):
            prefix = Path(directory) / "evidence"
            with (
                patch("sys.argv", ["probe", "--binary", "/bin/true", "--artifact-prefix", str(prefix)]),
                contextlib.redirect_stdout(io.StringIO()) as stdout,
            ):
                self.assertEqual(p.main(), 1)
            report = json.loads(Path(str(prefix) + "-report.json").read_text())
            self.assertEqual(report, json.loads(stdout.getvalue()))
            self.assertFalse(report["passed"])
            self.assertTrue(report["error"].startswith("CalledProcessError:"))
            self.assertEqual(report["request_count"], 0)
            self.assertNotIn("inflight_row", report["assertions"])
            self.assertEqual(Path(str(prefix) + "-plain.txt").read_text(), "PARTIAL_FRAME")
            self.assertEqual(json.loads(Path(str(prefix) + "-requests.json").read_text()), [])
            self.assertEqual(list(Path(directory).glob("ui-cleanup-work-*")), [])
        self.assertEqual(commands[-1][3:], ["kill-server"])
        self.assertFalse(fixture.thread.is_alive())


if __name__ == "__main__":
    unittest.main()
