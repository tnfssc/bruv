"""Harness regressions; no audio server or compiled helper required."""
import base64
import sys
import time
import unittest
from unittest.mock import Mock, patch

import protocol


class ProtocolTests(unittest.TestCase):
    def helper(self, script):
        return protocol.Protocol([sys.executable, '-c', script])

    def test_batched_lines_do_not_wait_for_more_pipe_output(self):
        with self.helper(
            "import sys;sys.stdout.write('{\"type\":\"hello\"}\\n{\"type\":\"stopped\"}\\n');"
            "sys.stdout.flush();sys.stdin.read()"
        ) as helper:
            self.assertEqual(helper.read('hello')['type'], 'hello')
            self.assertEqual(helper.read('stopped', timeout=.2)['type'], 'stopped')

    def test_partial_line_is_completed_before_json_decode(self):
        with self.helper(
            "import sys,time;sys.stdout.write('{\"type\":');sys.stdout.flush();"
            "time.sleep(.05);sys.stdout.write('\"hello\"}\\n');sys.stdout.flush();sys.stdin.read()"
        ) as helper:
            self.assertEqual(helper.read('hello')['type'], 'hello')

    def test_timeout_does_not_block_on_unterminated_line(self):
        with self.helper(
            "import sys;sys.stdout.write('{');sys.stdout.flush();sys.stdin.read()"
        ) as helper:
            start = time.monotonic()
            with self.assertRaisesRegex(AssertionError, 'missing ready'):
                helper.read('ready', timeout=.1)
            self.assertLess(time.monotonic() - start, 1)

    def test_unexpected_error_and_capture_before_ready_still_fail(self):
        for event, message in [
            ({'type': 'error', 'code': 'audio_device'}, 'audio_device'),
            ({'type': 'capture', 'data': ''}, 'capture preceded ready'),
        ]:
            with self.subTest(event=event), self.helper(
                f"import json,sys;print(json.dumps({event!r}),flush=True);sys.stdin.read()"
            ) as helper:
                with self.assertRaisesRegex(AssertionError, message):
                    helper.read('ready')

    def test_rejection_skips_valid_capture_and_checks_exact_error(self):
        capture = {'type': 'capture', 'data': base64.b64encode(bytes(640)).decode()}
        error = {'type': 'error', 'code': 'generation', 'message': 'Invalid generation'}
        with self.helper(
            "import json,sys;command=json.loads(sys.stdin.readline());"
            "assert command == dict(type='flush',generation=True);"
            f"print(json.dumps({capture!r}),flush=True);"
            f"print(json.dumps({error!r}),flush=True);sys.stdin.read()"
        ) as helper:
            helper.reject('generation', 'Invalid generation', type='flush', generation=True)

    def test_context_closes_helper_even_when_scenario_fails(self):
        helper = self.helper("import sys;sys.stdin.read()")
        with self.assertRaisesRegex(RuntimeError, 'scenario failed'):
            with helper:
                raise RuntimeError('scenario failed')
        self.assertEqual(helper.process.returncode, 0)
        self.assertTrue(helper.process.stdout.closed)


class MicrophoneTests(unittest.TestCase):
    def pulse(self):
        pulse = Mock()
        pulse.pa_simple_new.return_value = 123
        pulse.pa_simple_write.return_value = 0
        return pulse

    def test_write_failure_reaches_test_thread_and_frees_stream(self):
        pulse = self.pulse()
        pulse.pa_simple_write.return_value = -1
        with patch.object(protocol.ctypes, 'CDLL', return_value=pulse):
            with self.assertRaises(AssertionError):
                with protocol.synthetic_microphone('isolated-mic'):
                    pass
        pulse.pa_simple_free.assert_called_once_with(123)

    def test_scenario_failure_still_waits_for_feeder(self):
        pulse = self.pulse()

        def write(*arguments):
            time.sleep(.002)
            return 0

        pulse.pa_simple_write.side_effect = write
        with patch.object(protocol.ctypes, 'CDLL', return_value=pulse):
            with self.assertRaisesRegex(RuntimeError, 'scenario failed'):
                with protocol.synthetic_microphone('isolated-mic'):
                    raise RuntimeError('scenario failed')
        self.assertEqual(pulse.pa_simple_write.call_count, 30)
        pulse.pa_simple_free.assert_called_once_with(123)

    def test_stream_open_failure_precedes_scenario(self):
        pulse = self.pulse()
        pulse.pa_simple_new.return_value = None
        with patch.object(protocol.ctypes, 'CDLL', return_value=pulse):
            with self.assertRaises(AssertionError):
                with protocol.synthetic_microphone('isolated-mic'):
                    self.fail('scenario started without microphone stream')
        pulse.pa_simple_write.assert_not_called()
        pulse.pa_simple_free.assert_not_called()


if __name__ == '__main__':
    unittest.main()
