"""Harness mechanics only. These fixtures are NOT native UI appearance proof."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request

spec = importlib.util.spec_from_file_location("proof", Path(__file__).resolve().parents[2] / "scripts/tui/tasks-ui-native-proof.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class ProofToolingTests(unittest.TestCase):
    def test_arguments_really_stream_with_approved_key_order(self):
        events = p.plan(1)
        arguments = ""
        gates = []
        for event, stage in events:
            for call in event["choices"][0]["delta"].get("tool_calls", []):
                arguments += call["function"].get("arguments", "")
            if stage: gates.append((stage, arguments))
        self.assertEqual(json.loads(arguments), {"label":"Read guide", "code":p.SUCCESS_CODE})
        self.assertEqual([s for s,_ in gates], ["spinner-only", "partial-label", "label-code-stream"])
        self.assertEqual(gates[0][1], "")
        self.assertEqual(gates[1][1], '{"label":"Read')
        self.assertIn('"code":"await Bun.write', gates[2][1])
        with self.assertRaises(json.JSONDecodeError): json.loads(gates[2][1])

    def test_code_first_is_partial_json_not_a_complete_tool_call(self):
        arguments = ""
        for event, stage in p.plan(3):
            for call in event["choices"][0]["delta"].get("tool_calls", []):
                arguments += call["function"].get("arguments", "")
            if stage:
                self.assertEqual(stage, "code-first")
                self.assertIn("throw", arguments)
                self.assertNotIn("label", arguments)
                with self.assertRaises(json.JSONDecodeError): json.loads(arguments)
        self.assertEqual(json.loads(arguments), {"code":p.FAIL_CODE, "label":"Read restricted guide"})

    def test_background_launch_capture_precedes_assistant_narration(self):
        events = p.plan(6)
        self.assertEqual(events[0][1], "background-launch-result")
        self.assertNotIn("content", events[0][0]["choices"][0]["delta"])
        self.assertEqual(events[1][0]["choices"][0]["delta"]["content"], "The checks are running.")

    def test_requests_are_bounded(self):
        for n in range(1,8): self.assertTrue(p.plan(n))
        with self.assertRaisesRegex(RuntimeError, "Unexpected inference"): p.plan(8)

    def test_loopback_transport_waits_for_capture_ack(self):
        fixture = p.Fixture(3)
        fixture.start()
        errors, payload = [], []
        def consume():
            try:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{fixture.server.server_address[1]}/v1/chat/completions",
                    json.dumps({"model":"proof-model","messages":[]}).encode(),
                    {"Content-Type":"application/json"})
                with urllib.request.urlopen(request, timeout=5) as response:
                    payload.append(response.read().decode())
            except Exception as e: errors.append(e)
        worker = threading.Thread(target=consume)
        worker.start()
        try:
            for stage in ["spinner-only", "partial-label", "label-code-stream"]:
                self.assertTrue(fixture.arrived[stage].wait(2), stage)
                if stage == "spinner-only": self.assertFalse(fixture.arrived["partial-label"].is_set())
                if stage == "partial-label": self.assertFalse(fixture.arrived["label-code-stream"].is_set())
                fixture.released[stage].set()
            worker.join(3)
            self.assertFalse(worker.is_alive())
            self.assertFalse(errors)
            self.assertFalse(fixture.errors)
            self.assertEqual(len(fixture.records), 1)
            self.assertIn("data: [DONE]", payload[0])
        finally:
            fixture.stop(); worker.join(2)

    def screens(self):
        footer = "\n\n \n$0.000 · ctx 0.3% · cache est 60m       proof-model · medium\n"
        rows = {
            "spinner-only":"⠋", "partial-label":"⠙ Read", "label-code-stream":"⠹ Read guide",
            "foreground-running":"⠸ Read guide", "foreground-success":"✓ Read guide",
            "code-first":"⠼", "concise-failure":"✓ Read guide\n✗ Read restricted guide — permission denied",
            "background-launched":"✓ Read guide\n✗ Read restricted guide — permission denied\n↗ task_proof",
            "background-running":"✓ Read guide\n✗ Read restricted guide — permission denied\n↗ task_proof",
            "background-success":"✓ Read guide\n✗ Read restricted guide — permission denied\n✓ task_proof",
            "expanded-ctrl-o":"Tool output: expanded\n" + p.SUCCESS_CODE + "\nInstall, run, and open the local app.",
        }
        return {s:{"viewport":v+footer,"scrollback":v+footer} for s,v in rows.items()}

    def test_audit_approved_contract(self):
        self.assertTrue(all(p.audit(self.screens()).values()))

    def test_editor_spinner_cannot_pass_for_transcript_spinner(self):
        screens = self.screens()
        for step in ["spinner-only", "code-first"]:
            screens[step]["viewport"] = "Action\n\n⠋ \n$0.000 · ctx 1% · cache est 60m   proof-model · medium\n"
        checks = p.audit(screens)
        self.assertFalse(checks["spinner_only"])
        self.assertFalse(checks["code_first_spinner"])

    def test_audit_expanded_source_may_wrap(self):
        screens = self.screens()
        screens["expanded-ctrl-o"]["scrollback"] = screens["expanded-ctrl-o"]["scrollback"].replace("await Bun.sleep", "await\n Bun.sleep")
        self.assertTrue(p.audit(screens)["ctrl_o_code"])

    def test_audit_rejects_old_draft_plain_success_and_code_leak(self):
        screens = self.screens()
        screens["foreground-success"]["scrollback"] = "Read guide"
        screens["code-first"]["scrollback"] = '⠋ throw new Error("permission'
        checks = p.audit(screens)
        self.assertFalse(checks["foreground_success"])
        self.assertFalse(checks["code_first_no_raw_source"])

    def test_audit_rejects_duplicate_or_moved_background_row(self):
        screens = self.screens()
        screens["background-success"]["scrollback"] += "✓ task_proof\n"
        self.assertFalse(p.audit(screens)["background_success"])
        screens = self.screens()
        screens["background-success"]["scrollback"] = "new duplicate delivery\n" + screens["background-success"]["scrollback"]
        self.assertFalse(p.audit(screens)["same_background_transcript_row"])

    def test_audit_rejects_checked_launch_beside_canonical_task(self):
        screens = self.screens()
        screens["background-running"]["scrollback"] += "✓ Run tests\n"
        self.assertFalse(p.audit(screens)["no_launch_action_duplicate"])

    def test_audit_rejects_secondary_id_notice_and_partial_source(self):
        screens = self.screens()
        screens["background-success"]["scrollback"] += "✓ task_sample finished\n"
        screens["label-code-stream"]["scrollback"] += "await Bun.write(\n"
        checks = p.audit(screens)
        self.assertFalse(checks["no_secondary_task_notice"])
        self.assertFalse(checks["collapsed_code_output_hidden"])

    def test_audit_does_not_hide_footer_or_expanded_regressions(self):
        screens = self.screens()
        screens["foreground-success"]["viewport"] = "✓ Read guide"
        screens["expanded-ctrl-o"]["scrollback"] = "✓ Read guide"
        checks = p.audit(screens)
        self.assertFalse(checks["footer_fields_visible"])
        self.assertFalse(checks["ctrl_o_code"])
        self.assertFalse(checks["ctrl_o_output"])
        self.assertFalse(checks["expanded_notice_preserved"])


    @unittest.skipUnless(p.shutil.which("tmux"), "requires tmux for native launch mechanics")
    def test_launch_uses_private_pty_and_allowlisted_environment(self):
        # Real tmux executes this Python stub, NOT a compiled CLI or UI proof.
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            binary = root / "stub with 'quotes'"
            binary.write_text('#!/usr/bin/python3\nimport json, os, sys\nfrom pathlib import Path\n'
                              'Path("launched.json").write_text(json.dumps({"args":sys.argv[1:],"env":dict(os.environ),"cwd":os.getcwd()}))\n')
            binary.chmod(0o755)
            proof = p.NativeCapture("/explicit/bun", 5, root)
            with patch.dict(p.os.environ, {"REAL_USER_TOKEN":"must not leak"}), proof.session():
                proof.launch(binary)
                proof.wait("stub launch", lambda: (proof.repo / "launched.json").exists())
                launched = json.loads((proof.repo / "launched.json").read_text())
                self.assertEqual(launched["env"], proof.env)
                self.assertEqual(launched["cwd"], str(proof.repo))
                self.assertEqual(launched["args"], ["--no-session","--approve","--offline","--provider","proof",
                                                     "--model","proof-model","--thinking","medium","Read the project guide."])
            self.assertFalse(Path(proof.env["HOME"]).exists())

    def test_session_setup_failure_cleans_fixture_and_home(self):
        with tempfile.TemporaryDirectory() as root:
            proof = p.NativeCapture("/explicit/bun", 3, Path(root))
            write = Path.write_text
            def fail_models(path, *args, **kwargs):
                if path.name == "models.json": raise OSError("injected models write failure")
                return write(path, *args, **kwargs)
            with patch.object(Path, "write_text", fail_models), patch.object(p, "run") as run:
                with self.assertRaisesRegex(OSError, "injected models"):
                    with proof.session(): self.fail("setup must not yield")
            self.assertFalse(Path(proof.env["HOME"]).exists())
            self.assertFalse(proof.fixture.thread.is_alive())
            self.assertEqual(proof.fixture.server.fileno(), -1)
            run.assert_called_once_with(proof.tmux + ["kill-server"], env=proof.env, check=False)

    def test_session_teardown_releases_barriers_even_if_tmux_cleanup_fails(self):
        with tempfile.TemporaryDirectory() as root:
            proof = p.NativeCapture("/explicit/bun", 3, Path(root))
            def fail_shutdown(cmd, **kwargs):
                self.assertEqual(cmd, proof.tmux + ["kill-server"])
                self.assertTrue((proof.repo / "action-release").exists())
                self.assertTrue((proof.repo / "background-release").exists())
                raise OSError("injected tmux cleanup failure")
            with patch.object(p, "run", fail_shutdown):
                with self.assertRaisesRegex(OSError, "injected tmux"):
                    with proof.session(): raise RuntimeError("capture failed")
            self.assertFalse(Path(proof.env["HOME"]).exists())
            self.assertFalse(proof.fixture.thread.is_alive())
            self.assertTrue(all(gate.is_set() for gate in proof.fixture.released.values()))

    def test_capture_writes_full_ansi_and_plain_evidence(self):
        with tempfile.TemporaryDirectory() as root:
            proof = p.NativeCapture("/explicit/bun", 3, Path(root))
            viewport, scrollback = "\x1b[32m✓ guide\x1b[0m\n", "old history\n✓ guide\n"
            with patch.object(proof, "pane", side_effect=[viewport, scrollback]), patch.object(p.time, "sleep"):
                proof.capture("native-step")
            self.assertEqual(proof.frames["native-step"], {"viewport":viewport,"scrollback":scrollback})
            for kind, data in [("viewport.ansi",viewport),("viewport",p.plain(viewport)),
                               ("scrollback.ansi",scrollback),("scrollback",p.plain(scrollback))]:
                self.assertEqual((Path(root) / ("native-step." + kind + ".txt")).read_text(), data)
            self.assertEqual(json.loads((Path(root) / "timeline.json").read_text()), proof.timeline)
            self.assertEqual(proof.timeline[0]["nativeViewportSha256"], p.hashlib.sha256(viewport.encode()).hexdigest())

    def test_scenario_gates_and_launch_evidence_survive_late_failure(self):
        # Stub pane replies/launch only: this checks orchestration, not native UI.
        with tempfile.TemporaryDirectory() as root:
            proof = p.NativeCapture("/explicit/bun", 3, Path(root))
            steps, keys, launch = [], [], {}
            with patch.object(p, "run"), proof.session():
                for gate in proof.fixture.arrived.values(): gate.set()
                for name in ["action-started", "background-started"]: (proof.repo / name).touch()
                task = {"id":"task_actual_stub", "kind":"shell", "status":"running"}
                (proof.repo / "background-task.json").write_text(json.dumps(task))
                def capture(step):
                    steps.append(step)
                    if step == "foreground-running": self.assertFalse((proof.repo / "action-release").exists())
                    if step == "foreground-success": self.assertTrue((proof.repo / "action-release").exists())
                    if step == "background-launched": self.assertFalse(proof.fixture.released["background-launch-result"].is_set())
                    if step == "background-running":
                        self.assertTrue(proof.fixture.released["background-launch-result"].is_set())
                        raise RuntimeError("injected late capture failure")
                with patch.object(proof, "launch") as start, patch.object(proof, "capture", capture), \
                     patch.object(proof, "send_keys", lambda *args: keys.append(args)), \
                     patch.object(proof, "pane", return_value="The guide is ready. The restricted guide could not be read. The checks are running."):
                    with self.assertRaisesRegex(RuntimeError, "injected late"):
                        p.capture_scenario(proof, Path("stub-binary"), launch)
                start.assert_called_once_with(Path("stub-binary"))
                self.assertEqual(launch, task)
                self.assertEqual(steps, ["spinner-only","partial-label","label-code-stream","foreground-running",
                                        "foreground-success","expanded-ctrl-o","code-first","concise-failure",
                                        "background-launched","background-running"])
                self.assertEqual(keys, [("C-o",),("C-o",),("-l","Read the restricted guide."),("Enter",),
                                        ("-l","Run the project checks in the background."),("Enter",)])

    def stub_record(self, root):
        binary = root / "not-a-native-binary"
        binary.write_bytes(b"report mechanics stub; never executed")
        record = {"binary":str(binary),"binarySha256":p.digest(binary),"sourceCommit":"a" * 40,
                  "sourceRoot":"/compiled/source","trackedSourceClean":True,"purpose":"local proof stub"}
        path = root / "record.json"
        path.write_text(json.dumps(record))
        return path, record

    def test_cli_provenance_rejection_precedes_capture(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            path, record = self.stub_record(root)
            record["binarySha256"] = "0" * 64
            path.write_text(json.dumps(record))
            args = ["proof","--build-record",str(path),"--out",str(root / "capture")]
            with patch.object(p.shutil, "which", return_value="tmux"), patch("sys.argv", args), \
                 patch.object(p.NativeCapture, "session") as session, redirect_stdout(io.StringIO()), \
                 patch("sys.stderr", new_callable=io.StringIO):
                with self.assertRaises(SystemExit) as error: p.main()
            self.assertEqual(error.exception.code, 2)
            session.assert_not_called()
            self.assertFalse((root / "capture").exists())

    def test_report_preserves_record_and_diagnostic_cannot_pass(self):
        # Deliberately stub all frames/requests/screenshots, never claim UI acceptance.
        for diagnostics in [False, True]:
            with self.subTest(diagnostics=diagnostics), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                path, record = self.stub_record(root)
                out = root / "capture"
                def stub_scenario(proof, binary, launch):
                    self.assertEqual(binary, Path(record["binary"]))
                    proof.frames = self.screens()
                    proof.timeline = [{"step":step} for step in proof.frames]
                    proof.fixture.records = [{"request":n} for n in range(1,8)]
                    launch.update({"id":"task_proof","kind":"shell"})
                args = ["proof","--build-record",str(path),"--out",str(out)] + (["--no-screenshots"] if diagnostics else [])
                with patch.object(p.shutil, "which", return_value="tmux"), patch("sys.argv", args), \
                     patch.object(p, "run"), patch.object(p, "capture_scenario", stub_scenario), \
                     patch.object(p, "render_screenshots", return_value=True) as screenshots, redirect_stdout(io.StringIO()) as output:
                    status = p.main()
                report = json.loads((out / "report.json").read_text())
                self.assertEqual(json.loads(output.getvalue()), report)
                self.assertEqual(report["sourceCommit"], record["sourceCommit"])
                self.assertEqual(report["binarySha256"], record["binarySha256"])
                self.assertEqual(json.loads((out / "build.json").read_text()), record)
                self.assertEqual(len(json.loads((out / "requests.json").read_text())), 7)
                self.assertEqual(report["passed"], not diagnostics)
                self.assertEqual(status, 1 if diagnostics else 0)
                self.assertEqual(report["checks"]["screenshots_complete"], not diagnostics)
                self.assertIn("parent must open the PNGs", report["visualReview"])
                self.assertEqual(report["toolingSha256"]["tasks-ui-native-proof.py"], p.digest(Path(p.__file__)))
                if diagnostics: screenshots.assert_not_called()
                else: screenshots.assert_called_once()

    def test_screenshot_helper_status_and_all_files_are_required(self):
        # Stub helper output/files only, not rendered PNG evidence.
        with tempfile.TemporaryDirectory() as root:
            out = Path(root)
            timeline = [{"step":"first"},{"step":"second"}]
            success = p.subprocess.CompletedProcess([], 0, "stub stdout", "stub stderr")
            (out / "first.png").write_bytes(b"not a PNG; existence mechanics only")
            with patch.object(p, "run", return_value=success) as run:
                self.assertFalse(p.render_screenshots("/explicit/bun", out, timeline))
                run.assert_called_once_with(["/explicit/bun", str(p.ROOT / "scripts/tui/tasks-ui-proof-screenshots.ts"), str(out)], timeout=60, check=False)
                (out / "second.png").write_bytes(b"not a PNG; existence mechanics only")
                self.assertTrue(p.render_screenshots("/explicit/bun", out, timeline))
            self.assertEqual((out / "screenshot-log.txt").read_text(), "stub stdoutstub stderr")
            failed = p.subprocess.CompletedProcess([], 1, "", "injected helper failure")
            with patch.object(p, "run", return_value=failed):
                with self.assertRaisesRegex(RuntimeError, "Screenshot helper failed"):
                    p.render_screenshots("/explicit/bun", out, timeline)
            self.assertEqual((out / "screenshot-log.txt").read_text(), "injected helper failure")

    def test_failed_scenario_keeps_error_frame_and_launch_in_report(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            path, record = self.stub_record(root)
            out = root / "capture"
            def fail_scenario(proof, binary, launch):
                launch.update({"id":"task_actual_stub"})
                proof.fixture.records = [{"request":n} for n in range(1,4)]
                raise RuntimeError("injected late scenario failure")
            args = ["proof","--build-record",str(path),"--out",str(out)]
            with patch.object(p.shutil, "which", return_value="tmux"), patch("sys.argv", args), \
                 patch.object(p, "run"), patch.object(p, "capture_scenario", fail_scenario), \
                 patch.object(p.NativeCapture, "pane", return_value="stub error viewport"), \
                 patch.object(p.time, "sleep"), patch.object(p, "render_screenshots") as screenshots, redirect_stdout(io.StringIO()):
                self.assertEqual(p.main(), 1)
            report = json.loads((out / "report.json").read_text())
            self.assertFalse(report["passed"])
            self.assertEqual(report["error"], "RuntimeError: injected late scenario failure")
            self.assertEqual(report["taskLaunch"], {"id":"task_actual_stub"})
            self.assertEqual(report["checks"], {"seven_bounded_sdk_requests":False,"screenshots_complete":False})
            self.assertEqual((out / "error-state.viewport.ansi.txt").read_text(), "stub error viewport")
            self.assertEqual(json.loads((out / "build.json").read_text()), record)
            screenshots.assert_not_called()

if __name__ == "__main__": unittest.main()
