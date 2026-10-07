#!/usr/bin/env python3
"""Device-free checks for unplug evidence and helper response ownership."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'source_removal', Path(__file__).with_name('source-removal.py'),
)
removal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(removal)


class SourceRemovalTests(unittest.TestCase):
    def helper(self, code):
        return removal.RemovalHelper([sys.executable, '-u', '-c', code])

    def test_buffered_and_fragmented_events(self):
        with self.helper(r"""
import os, sys, time
os.write(1, b'{"type":"hel')
time.sleep(.02)
os.write(1, b'lo"}\n{"type":"ready"}\n')
sys.stdin.read()
""") as helper:
            self.assertEqual(helper.read('hello'), {'type': 'hello'})
            self.assertEqual(helper.read('ready'), {'type': 'ready'})

    def test_unplug_requires_stopped_even_after_device_error(self):
        with self.helper(r"""
import json, sys
print('{"type":"hello"}', flush=True)
for line in sys.stdin:
    command = json.loads(line)['type']
    if command == 'start':
        print('{"type":"ready"}', flush=True)
    elif command == 'stop':
        print('{"type":"error","code":"audio_device"}', flush=True)
        print('{"type":"capture","data":"AAAA"}', flush=True)
        print('{"type":"stopped"}', flush=True)
""") as helper, patch.object(removal.subprocess, 'run') as unload:
            with contextlib.redirect_stdout(io.StringIO()):
                removal.check_source_removal(helper, '42')
            unload.assert_called_once_with(['pactl', 'unload-module', '42'], check=True)
        self.assertEqual(helper.process.returncode, 0)

    def test_device_error_and_exit_are_not_stopped_evidence(self):
        with self.helper(r"""
import sys
print('{"type":"error","code":"audio_device"}', flush=True)
""") as helper:
            with self.assertRaisesRegex(AssertionError, 'missing stopped'):
                helper.read('stopped', timeout=.2)

    def test_partial_frame_at_eof_fails_without_spinning_until_deadline(self):
        with self.helper(r"""
import os
os.write(1, b'{"type":"stopped"')
""") as helper:
            start = time.monotonic()
            with self.assertRaisesRegex(AssertionError, 'helper closed stdout'):
                helper.read('stopped', timeout=2)
            self.assertLess(time.monotonic() - start, 1)

    def test_missing_response_has_bounded_wait(self):
        with self.helper('import sys; sys.stdin.read()') as helper:
            with self.assertRaisesRegex(AssertionError, 'missing stopped'):
                helper.read('stopped', timeout=.05)

    def test_unload_failure_aborts_scenario_and_reaps_helper(self):
        helper = self.helper(r"""
import sys
print('{"type":"hello"}', flush=True)
for line in sys.stdin:
    print('{"type":"ready"}', flush=True)
""")
        with self.assertRaises(subprocess.CalledProcessError):
            with helper, patch.object(
                removal.subprocess, 'run',
                side_effect=subprocess.CalledProcessError(1, 'pactl'),
            ):
                removal.check_source_removal(helper, '42')
        self.assertEqual(helper.process.returncode, 0)

    def test_nonzero_exit_retains_stderr_evidence(self):
        with self.assertRaisesRegex(AssertionError, 'device failure'):
            with self.helper("import sys; sys.stderr.write('device failure'); sys.exit(9)"):
                pass


if __name__ == '__main__':
    unittest.main()
