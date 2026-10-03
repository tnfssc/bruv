"""Dependency-free fixture checks, not proposal/runtime acceptance."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("activity_fixture", Path(__file__).resolve().parents[1] / "scripts/activity-terminal-acceptance.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def request(text, calls=()):
    return {"input": [{"role": "user", "content": [{"type": "input_text", "text": text}]}] +
            [{"type": "function_call_output", "call_id": call, "output": "Execution completed with exit code 0."} for call in calls]}


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.gettempdir()) / "activity-fixture-test"

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
