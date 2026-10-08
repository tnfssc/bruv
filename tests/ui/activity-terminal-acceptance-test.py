"""Dependency-free fixture checks, not proposal/runtime acceptance."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("activity_fixture", Path(__file__).resolve().parents[2] / "scripts/activity-terminal-acceptance.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def request(text, calls=()):
    return {"input": [{"role": "user", "content": [{"type": "input_text", "text": text}]}] +
            [{"type": "function_call_output", "call_id": call, "output": "Execution completed with exit code 0."} for call in calls]}


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.gettempdir()) / "activity-fixture-test"

    def test_submission_requires_actual_editor_draft_not_transcript_token(self):
        self.assertFalse(fixture.draft_ready(" Ask about notes.\n", "Ask about notes."))
        self.assertTrue(fixture.draft_ready(" Ask about notes.\nproject · mode: orchestrator", "Ask about notes."))
        self.assertTrue(fixture.draft_ready("   /questions resume q_fixture", "/questions resume q_fixture"))

    def test_send_waits_for_visible_draft_before_enter(self):
        with patch.object(fixture, "tmux", side_effect=["", "", " /questions resume q_fixture", ""]) as tmux, patch.object(fixture.time, "sleep"):
            fixture.send(self.root, "/questions resume q_fixture")
        self.assertEqual(tmux.call_args_list[-1].args, (self.root, "send-keys", "-t", "activity", "Enter"))
        self.assertEqual([call.args[1] for call in tmux.call_args_list], ["send-keys", "capture-pane", "capture-pane", "send-keys"])

    def test_grouped_records_have_two_prose_separated_groups(self):
        calls, output = [], []
        for _ in range(6):
            output.extend(fixture.fixture(request("Inspect grouped records", calls), self.root))
            calls = [i["call_id"] for i in output if i["type"] == "function_call"]
        self.assertEqual(calls, ["record-a", "record-b", "record-c", "split-a", "split-b"])
        self.assertEqual([i["type"] for i in output], ["function_call"] * 3 + ["message"] + ["function_call"] * 2 + ["message"])
        code = json.loads(output[0]["arguments"])["code"]
        self.assertIn(r"\n", code)
        self.assertNotIn("\n", code)
        self.assertIn("RECORD-A_DETAIL", code)
        self.assertIn("length:12", code)

    def test_lifecycle_uses_real_jobs_and_short_review_checkpoint(self):
        items = fixture.fixture(request("Run lifecycle checks"), self.root)
        self.assertEqual(len(items), 1)
        code = json.loads(items[0]["arguments"])["code"]
        self.assertEqual(code.count("await shell("), 3)
        self.assertIn("exit 7", code)
        self.assertIn("jobs.snooze(cancel.id,{minutes:0.02})", code)
        self.assertIn("lifecycle-jobs.json", code)
        body = request("Run lifecycle checks", ["launch-lifecycle"])
        body["input"].append({"role":"user", "content":"Cancel fixture check"})
        cancel = fixture.fixture(body, self.root)
        self.assertEqual(cancel[0]["call_id"], "cancel-lifecycle")
        self.assertIn("jobs.stop(ids.cancel)", json.loads(cancel[0]["arguments"])["code"])
        body["input"].append({"type":"function_call_output", "call_id":"cancel-lifecycle", "output":"Stopped fixture task"})
        self.assertFalse(any(i["type"] == "function_call" for i in fixture.fixture(body, self.root)))

    def test_reopen_respawns_private_pane_instead_of_destroying_server(self):
        from unittest.mock import patch
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "state.json").write_text(json.dumps({"binary":"/owner/dist/bruv", "socket":"private"}))
            with patch.object(fixture, "tmux") as tmux:
                fixture.launch(root, reopen=True)
            args = tmux.call_args_list[0].args
            self.assertEqual(args[1], "respawn-pane")
            self.assertIn("--continue", args[-1])
            self.assertIn("env -i", args[-1])
            self.assertNotIn("kill-session", args)

    def test_replay_call_identity_and_saved_answer_take_precedence(self):
        body = request("Ask about notes", ["ask-question|replayed"])
        body["input"].append({"role": "user", "content": "Saved answer: Keep concise"})
        items = fixture.fixture(body, self.root)
        self.assertEqual([i["call_id"] for i in items], ["resolve-question"])
        body["input"].append({"type": "function_call_output", "call_id": "resolve-question|replayed", "output": "Used your preference"})
        settled = fixture.fixture(body, self.root)
        self.assertEqual(len(settled), 1)
        self.assertEqual(settled[0]["phase"], "final_answer")
        self.assertIn("preference is saved", settled[0]["content"][0]["text"])

    def test_scenario_priority_and_errors_survive_mixed_history(self):
        body = request("Inspect grouped records. Run lifecycle checks. Ask about notes. Keep concise.")
        self.assertEqual(fixture.fixture(body, self.root)[0]["call_id"], "record-a")
        body = request("Run lifecycle checks. Ask about notes. Keep concise.", ["launch-lifecycle"])
        body["input"].append({"role": "user", "content": "Cancel fixture check"})
        self.assertEqual(fixture.fixture(body, self.root)[0]["call_id"], "cancel-lifecycle")
        body["input"].append({"type": "function_call_output", "call_id": "cancel-lifecycle", "output": "Execution failed: cancelled action failed"})
        failed = fixture.fixture(body, self.root)
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["phase"], "final_answer")
        self.assertIn("fixture action failed", failed[0]["content"][0]["text"])

    def test_guide_count_and_original_evidence(self):
        calls = []
        outputs = []
        for _ in range(4):
            outputs.extend(fixture.fixture(request("Review the guide", calls), self.root))
            calls = [i["call_id"] for i in outputs if i["type"] == "function_call"]
        self.assertEqual(calls, ["guide-a", "guide-b", "guide-c"])
        self.assertEqual(outputs[-1]["phase"], "final_answer")
        note = next(i for i in outputs if "Important:" in json.dumps(i))
        self.assertNotIn("phase", note)  # Unknown settled prose must not be suppressed.
        code = next(json.loads(i["arguments"])["code"] for i in outputs if i.get("call_id") == "guide-b")
        self.assertIn(r"\nOriginal setup detail", code)
        self.assertNotIn("\n", code)

    def test_responses_events_have_phases_and_terminal_event(self):
        items = fixture.fixture(request("Review the guide"), self.root)
        events = list(fixture.events(items))
        self.assertEqual(events[-1]["type"], "response.completed")
        self.assertEqual(events[-1]["response"]["status"], "completed")
        done = [e["item"] for e in events if e["type"] == "response.output_item.done"]
        self.assertEqual(done[0]["phase"], "commentary")
        self.assertEqual(done[1]["arguments"], items[1]["arguments"])
        self.assertEqual({e["output_index"] for e in events if "output_index" in e}, {0, 1})

    def test_parallel_jobs_count_as_one_execute(self):
        items = fixture.fixture(request("Run parallel checks"), self.root)
        calls = [i for i in items if i["type"] == "function_call"]
        self.assertEqual(len(calls), 1)
        code = json.loads(calls[0]["arguments"])["code"]
        self.assertEqual(code.count("await shell("), 2)
        self.assertIn("gates/fast", code)
        self.assertIn("gates/slow", code)
        settled = fixture.fixture(request("Run parallel checks", ["launch-checks"]), self.root)
        self.assertFalse(any(i["type"] == "function_call" for i in settled))

    def test_foreground_is_releasable_and_continuation_does_not_relaunch(self):
        items = fixture.fixture(request("While checks run, read the release note"), self.root)
        code = json.loads(items[-1]["arguments"])["code"]
        self.assertIn("gates/foreground", code)
        body = request("While checks run, read the release note", ["foreground-read"])
        body["input"].append({"role": "user", "content": "1 asynchronous task completed."})
        settled = fixture.fixture(body, self.root)
        self.assertEqual(settled[-1]["phase"], "final_answer")
        self.assertFalse(any(i["type"] == "function_call" for i in settled))

    def test_question_answer_uses_saved_question_not_a_new_ask(self):
        items = fixture.fixture(request("Ask about notes"), self.root)
        self.assertIn("questions.block", json.loads(items[0]["arguments"])["code"])
        items = fixture.fixture(request("Saved answer: Keep concise", ["ask-question"]), self.root)
        self.assertEqual(items[0]["call_id"], "resolve-question")
        self.assertIn("questions.resolve", json.loads(items[0]["arguments"])["code"])
        settled = fixture.fixture(request("Saved answer: Keep concise", ["ask-question", "resolve-question"]), self.root)
        self.assertEqual(len(settled), 1)
        self.assertEqual(settled[0]["phase"], "final_answer")

    def test_observed_action_error_does_not_emit_success(self):
        body = request("Ask about notes", ["ask-question"])
        body["input"][-1]["output"] = "Execution failed: Persistent questions need the parent CLI session."
        items = fixture.fixture(body, self.root)
        self.assertIn("failed", items[0]["content"][0]["text"])
        self.assertEqual(len(items), 1)


if __name__ == "__main__":
    unittest.main()
