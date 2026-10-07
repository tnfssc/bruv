#!/usr/bin/env python3
"""Preparation unit checks, not compiled product acceptance."""
import importlib.util
from pathlib import Path
import unittest
import sys
import json
import tempfile

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("runtime_acceptance", Path(__file__).resolve().parents[1] / "scripts/activity-runtime-acceptance.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

class EvidenceTests(unittest.TestCase):
    def test_result_requires_original_stdout_row_not_source_token(self):
        self.assertFalse(runner.result_row(' console.log("DETAIL_saved-99-9")', "DETAIL_saved-99-9"))
        self.assertFalse(runner.result_row(" Selected DETAIL_saved-99-9 preview", "DETAIL_saved-99-9"))
        self.assertTrue(runner.result_row(" DETAIL_saved-99-9", "DETAIL_saved-99-9"))
        self.assertTrue(runner.result_row(" DETAIL_saved-99-9 │", "DETAIL_saved-99-9"))

    def test_startup_requires_editor_and_model_footer(self):
        self.assertFalse(runner.startup_ready("Inspect grouped records."))
        self.assertFalse(runner.startup_ready("mode: orchestrator · acceptance"))
        self.assertTrue(runner.startup_ready("\nproject · mode: orchestrator · acceptance"))

    def test_header_contract_is_left_alignment_not_vertical_padding(self):
        runner.header_contract(" Saved note: lasting\n 3 tools called\n Grouped records are ready.\n 2 tools called", ["Saved note:", "Grouped records are ready."])
        runner.header_contract("   Saved note: lasting\n   3 tools called\n   2 tools called", ["Saved note:"])

    def test_header_contract_rejects_wrong_inset_and_arrows(self):
        for header in ["3 tools called", "  3 tools called", " ▸ 3 tools called"]:
            with self.subTest(header=header), self.assertRaises(AssertionError):
                runner.header_contract(" Saved note: lasting\n" + header + "\n 2 tools called", ["Saved note:"])

    def test_native_expanded_detail_click_targets_first_heading(self):
        run = runner.Run(Path("/unused"), Path("/owner/dist/bruv"))
        commands = []
        run.command = lambda *args: commands.append(args)
        run.click(" 3 tools called\n Execute · TypeScript\n RECORD-A_DETAIL\n Execute · TypeScript\n RECORD-B_DETAIL", "Execute · TypeScript", occurrence=0)
        self.assertEqual(commands, [("click", 3, 2)])

    def test_notice_reads_real_custom_message_entry(self):
        attention = {"type":"custom_message", "customType":"task-attention", "details":{"tasks":[]}}
        self.assertEqual(runner.notice_record(attention, "task-attention"), attention)
        complete = {"type":"custom_message", "customType":"task-complete", "details":{"tasks":[{"id":"task_fixture", "status":"completed"}]}}
        self.assertEqual(runner.notice_record(complete, "task-complete", "task_fixture", "completed"), complete)
        self.assertIsNone(runner.notice_record(complete, "task-complete", "task_fixture", "failed"))
        self.assertIsNone(runner.notice_record({"type":"custom", "customType":"task-attention"}, "task-attention"))

    def test_reopened_saved_answer_requires_explicit_resume(self):
        q = {"id":"q_fixture", "text":"How detailed should the notes be?", "status":"answered", "answer":"Keep concise", "delivery":"resume-needed"}
        self.assertEqual(runner.saved_resume([q]), "q_fixture")
        with self.assertRaises(AssertionError): runner.saved_resume([{**q, "delivery":"delivered"}])

    def test_outcomes_require_unique_source_rows_allowing_separate_notice_groups(self):
        frame = " 1 tool called\n ✓ Start lifecycle checks\n ✗ Start lifecycle checks — exit 7\n ⊘ Start lifecycle checks — cancelled"
        runner.lifecycle_rows(frame)
        runner.lifecycle_rows(frame + "\n Lasting reply\n 1 job notification")
        with self.assertRaises(AssertionError): runner.lifecycle_rows(frame + "\n ✓ Start lifecycle checks")

    def test_saved_resume_submits_only_when_completion_left_exact_draft(self):
        for frame, extra_enter in [(" /questions resume q_fixture", True), ("Saved answer queued for a new parent turn", False)]:
            run = runner.Run(Path("/unused"), Path("/owner/dist/bruv"))
            commands = []
            run.command = lambda *args: commands.append(args)
            run.wait = lambda name, predicate: frame if predicate(frame) else self.fail("Readiness predicate rejected fixture")
            run.submit_saved_resume("/questions resume q_fixture")
            expected = [("send", "/questions resume q_fixture")]
            if extra_enter: expected.append(("key", "Enter"))
            self.assertEqual(commands, expected)

    def test_long_thread_preparation_installs_linked_original_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sessions").mkdir()
            state_path = root / "state.json"
            state = {"binary": "/owner/dist/bruv", "socket": "private-fixture", "provider_pid": 123, "session": "old"}
            state_path.write_text(json.dumps(state))

            journal, original_lines = runner.prepare_long_thread(root)

            self.assertEqual(journal, root / "sessions" / "acceptance-long.jsonl")
            self.assertEqual(json.loads(state_path.read_text()), {**state, "session": str(journal)})
            self.assertFalse((root / "requests.jsonl").exists())
            self.assertEqual(original_lines, journal.read_text().splitlines())
            records = [json.loads(line) for line in original_lines]
            self.assertEqual(len(records), 2102)
            self.assertEqual(records[0]["type"], "session")
            self.assertEqual(records[0]["version"], 3)
            self.assertEqual(records[0]["cwd"], str(root / "project"))
            entries = records[1:]
            self.assertEqual(entries[0]["parentId"], None)
            self.assertEqual([entry["parentId"] for entry in entries[1:]], [entry["id"] for entry in entries[:-1]])
            for turn in range(100):
                turn_entries = entries[turn * 21:(turn + 1) * 21]
                self.assertEqual(turn_entries[0]["message"]["content"], "Saved turn " + str(turn))
                for tool in range(10):
                    call = turn_entries[1 + tool * 2]["message"]
                    result = turn_entries[2 + tool * 2]["message"]
                    cid = f"saved-{turn}-{tool}"
                    token = "DETAIL_" + cid
                    self.assertEqual(call["content"], [{"type": "toolCall", "id": cid, "name": "execute", "arguments": {"label": "Read saved file " + cid, "code": 'console.log("' + token + '")'}}])
                    self.assertEqual((call["role"], call["api"], call["provider"], call["model"], call["stopReason"]), ("assistant", "openai-responses", "activity-fixture", "acceptance", "toolUse"))
                    self.assertEqual((result["role"], result["toolCallId"], result["toolName"], result["isError"]), ("toolResult", cid, "execute", False))
                    self.assertEqual(result["content"], [{"type": "text", "text": token}])
                    self.assertEqual(result["details"], {"exitCode": 0, "stdout": token, "stderr": "", "images": []})
            self.assertEqual(entries[-1]["message"]["stopReason"], "stop")
            self.assertEqual(entries[-1]["message"]["content"], [{"type": "text", "text": "LONG_THREAD_READY"}])
            with journal.open("a") as f:
                f.write('{"type":"appended-evidence"}\n')
            self.assertEqual(journal.read_text().splitlines()[:-1], original_lines)

    def test_row_only_check_rejects_expanded_native_details(self):
        run = runner.Run(Path("/unused"), Path("/owner/dist/bruv"))
        run.no_details("3 tools called\nRead first record")
        with self.assertRaises(AssertionError): run.no_details("Read first record\nRECORD-A_DETAIL")
        with self.assertRaises(AssertionError): run.no_details('console.log("RECORD-A_DETAIL")')

if __name__ == "__main__": unittest.main()
