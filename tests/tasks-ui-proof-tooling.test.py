"""Harness mechanics only. These fixtures are NOT native UI appearance proof."""
import importlib.util
import json
from pathlib import Path
import threading
import unittest
import urllib.request

spec = importlib.util.spec_from_file_location("proof", Path(__file__).resolve().parents[1] / "scripts/tasks-ui-native-proof.py")
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
        footer = "\n$0.000 · ctx 0.3% · cache est 60m       proof-model · medium\n"
        rows = {
            "spinner-only":"⠋", "partial-label":"⠙ Read", "label-code-stream":"⠹ Read guide",
            "foreground-running":"⠸ Read guide", "foreground-success":"✓ Read guide",
            "code-first":"⠼", "concise-failure":"✓ Read guide\n✗ Read restricted guide — permission denied",
            "background-launched":"✓ Read guide\n✗ Read restricted guide — permission denied\n↗ Run tests",
            "background-running":"✓ Read guide\n✗ Read restricted guide — permission denied\n↗ Run tests",
            "background-success":"✓ Read guide\n✗ Read restricted guide — permission denied\n✓ Run tests",
            "expanded-ctrl-o":"Tool output: expanded\n" + p.SUCCESS_CODE + "\nInstall, run, and open the local app.",
        }
        return {s:{"viewport":v+footer,"scrollback":v+footer} for s,v in rows.items()}

    def test_audit_approved_contract(self):
        self.assertTrue(all(p.audit(self.screens()).values()))

    def test_audit_rejects_old_draft_plain_success_and_code_leak(self):
        screens = self.screens()
        screens["foreground-success"]["scrollback"] = "Read guide"
        screens["code-first"]["scrollback"] = '⠋ throw new Error("permission'
        checks = p.audit(screens)
        self.assertFalse(checks["foreground_success"])
        self.assertFalse(checks["code_first_no_raw_source"])

    def test_audit_rejects_duplicate_or_moved_background_row(self):
        screens = self.screens()
        screens["background-success"]["scrollback"] += "✓ Run tests\n"
        self.assertFalse(p.audit(screens)["background_success"])
        screens = self.screens()
        screens["background-success"]["scrollback"] = "new duplicate delivery\n" + screens["background-success"]["scrollback"]
        self.assertFalse(p.audit(screens)["same_background_transcript_row"])

    def test_audit_does_not_hide_footer_or_expanded_regressions(self):
        screens = self.screens()
        screens["foreground-success"]["viewport"] = "✓ Read guide"
        screens["expanded-ctrl-o"]["scrollback"] = "✓ Read guide"
        checks = p.audit(screens)
        self.assertFalse(checks["footer_fields_visible"])
        self.assertFalse(checks["ctrl_o_code"])
        self.assertFalse(checks["ctrl_o_output"])
        self.assertFalse(checks["expanded_notice_preserved"])

if __name__ == "__main__": unittest.main()
