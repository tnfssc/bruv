#!/usr/bin/env python3
"""Fixture ownership tests; no audio server or real helper is used."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

FIXTURE = Path(__file__).with_name('virtual.sh').resolve()


class VirtualFixtureTests(unittest.TestCase):
    def run_fixture(self, failure='', isolated=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake_tool = f'#!{sys.executable}\n' + r'''
import json, os, pathlib, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as log:
    log.write(json.dumps([name, *args]) + '\n')
failure = os.environ['FAILURE']
if name == 'pactl':
    if args[0] == 'load-module':
        mic = args[-1].endswith('-mic')
        if failure == ('microphone' if mic else 'output'): sys.exit(19)
        print(20 if mic else 10)
    elif args[:2] == ['unload-module', '20'] and failure == 'removed':
        # EXIT's repeat unload may fail; it must not replace the scenario failure.
        removed = pathlib.Path(os.environ['CALLS'] + '.removed')
        if removed.exists(): sys.exit(31)
        removed.touch()
elif name == 'python3':
    if args[0].endswith('/protocol.py'):
        if failure == 'protocol': sys.exit(23)
    else:
        if failure == 'removal': sys.exit(29)
        subprocess.run(['pactl', 'unload-module', args[-1]])
        if failure == 'removed': sys.exit(29)
'''
            for name in ('pactl', 'python3', 'bash'):
                tool = root / name
                tool.write_text(fake_tool)
                tool.chmod(0o700)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       CALLS=str(root / 'calls'), FAILURE=failure,
                       PULSE_SERVER='unix:/nonexistent-virtual-fixture-test')
            env.pop('BRUV_LIVE_ISOLATED', None)
            if isolated:
                env['BRUV_LIVE_ISOLATED'] = '1'
            result = subprocess.run(['/bin/bash', str(FIXTURE), '/a helper'], env=env,
                                    capture_output=True, text=True, timeout=5)
            calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()]
            return result, calls

    def unloads(self, calls):
        return [call[-1] for call in calls if call[:2] == ['pactl', 'unload-module']]

    def test_desktop_entry_hands_off_to_private_graph(self):
        result, calls = self.run_fixture(isolated=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [['bash', 'scripts/live/isolated-audio.sh', '--',
                                 'bash', 'native/live-linux/tests/virtual.sh', '/a helper']])

    def test_success_unplugs_microphone_once_then_releases_output(self):
        result, calls = self.run_fixture()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.unloads(calls), ['20', '10'])
        scenarios = [call for call in calls if call[0] == 'python3']
        self.assertEqual([Path(call[1]).name for call in scenarios],
                         ['protocol.py', 'source-removal.py'])
        self.assertEqual(scenarios[0][2], '/a helper')
        self.assertEqual(scenarios[0][3], '--source')
        self.assertTrue(scenarios[0][4].endswith('-mic.monitor'))
        self.assertEqual(scenarios[0][5], '--sink')
        self.assertTrue(scenarios[0][6].endswith('-out'))
        self.assertEqual(scenarios[1][2:],
                         ['/a helper', scenarios[0][4], scenarios[0][6], '20'])

    def test_partial_acquisition_releases_only_owned_modules(self):
        for failure, expected in [('output', []), ('microphone', ['10'])]:
            with self.subTest(failure=failure):
                result, calls = self.run_fixture(failure)
                self.assertEqual(result.returncode, 19, result.stderr)
                self.assertEqual(self.unloads(calls), expected)
                self.assertFalse(any(call[0] == 'python3' for call in calls))

    def test_protocol_failure_keeps_exit_status_and_skips_removal(self):
        result, calls = self.run_fixture('protocol')
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertEqual(self.unloads(calls), ['20', '10'])
        self.assertEqual(sum(call[0] == 'python3' for call in calls), 1)

    def test_removal_failure_retains_cleanup_ownership(self):
        for failure, expected in [('removal', ['20', '10']), ('removed', ['20', '20', '10'])]:
            with self.subTest(failure=failure):
                result, calls = self.run_fixture(failure)
                self.assertEqual(result.returncode, 29, result.stderr)
                self.assertEqual(self.unloads(calls), expected)


if __name__ == '__main__':
    unittest.main()
