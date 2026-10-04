#!/usr/bin/env python3
"""Preparation unit checks, not compiled product acceptance."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("runtime_acceptance", Path(__file__).resolve().parents[1] / "scripts/activity-runtime-acceptance.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

class EvidenceTests(unittest.TestCase):
    def test_result_requires_original_stdout_row_not_source_token(self):
        self.assertFalse(runner.result_row(' console.log("DETAIL_saved-99-9")', "DETAIL_saved-99-9"))
        self.assertFalse(runner.result_row(" Selected DETAIL_saved-99-9 preview", "DETAIL_saved-99-9"))
        self.assertTrue(runner.result_row(" DETAIL_saved-99-9", "DETAIL_saved-99-9"))
        self.assertTrue(runner.result_row(" DETAIL_saved-99-9 │", "DETAIL_saved-99-9"))

    def test_row_only_check_rejects_expanded_native_details(self):
        run = runner.Run(Path("/unused"), Path("/owner/dist/bruv"))
        run.no_details("3 tools called\nRead first record")
        with self.assertRaises(AssertionError): run.no_details("Read first record\nRECORD-A_DETAIL")
        with self.assertRaises(AssertionError): run.no_details('console.log("RECORD-A_DETAIL")')

if __name__ == "__main__": unittest.main()
