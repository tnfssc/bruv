"""Fixture-only checks; mocked encoding is not device, provider or video proof."""
import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).resolve().parents[2] / 'scripts/tui/task-placement-clean-video.py'
spec = importlib.util.spec_from_file_location('clean_video', SCRIPT)
video = importlib.util.module_from_spec(spec)
spec.loader.exec_module(video)


def atom(tag):
    return (8).to_bytes(4, 'big') + tag.encode('ascii')


class CleanVideoTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = pathlib.Path(self.temp.name)
        (self.out / 'diagnostics').mkdir()
        (self.out / 'failed-inspection').mkdir()
        self.screen = '\x1b[32mGuide ready\x1b[0m\n/home/tnfssc/.bruv/probes/take/home/NOTES.md\n'
        (self.out / 'guide.viewport.txt').write_text(self.screen)
        (self.out / 'diagnostics/guide.scrollback.txt').write_text(self.screen)
        (self.out / 'unused.txt').write_text('ROOT_unused diagnostic')
        (self.out / 'failure.txt').write_text('ROOT_ignored failure file')
        (self.out / 'failed-inspection/pane.txt').write_text('Tool started: execute')
        self.timeline = [{'step': 'guide', 't': 0, 'caption': 'Review the guide',
                          'path': 'guide.viewport.txt', 'capturedAt': 'fixture'}]
        self.save('timeline.json', self.timeline)
        self.save('capture-receipt.json', {
            'binarySha256': 'a' * 64, 'binarySource': 'b' * 40,
            'networkMode': 'none', 'durationSeconds': 0.4, 'checks': {'sourceReturnedOnClose': True},
        })
        private = {
            'customType': 'question-answer', 'display': False, 'content': 'private payload',
            'details': {'questionId': 'question-secret', 'replyKey': 'reply-secret',
                        'owner': {'sessionId': 'session-secret', 'branchId': 'branch-secret'}},
        }
        (self.out / 'server-journal.jsonl').write_text(json.dumps(private) + '\n')
        question = {'id': 'question-secret', 'owner': private['details']['owner'], 'version': 1}
        state = {'commands': {
            str(i): {'command': {'kind': 'questions.list'}, 'receipt': {'result': [copy.deepcopy(question)]}}
            for i in range(3)
        }}
        self.save('diagnostics/final-root-0.json', state)

    def save(self, name, value):
        (self.out / name).write_text(json.dumps(value))

    def render_fixture(self, rows, path, heading, subheading, footer, audit):
        self.assertEqual(heading, 'bruv — work on a named server')
        self.assertEqual(subheading, 'Actual CLI capture replay · isolated Docker SSH · fake inference')
        self.assertEqual(footer(0), '000.0s  |  Disposable HOME paths redacted · no real hosts or paid APIs')
        self.assertEqual(rows[-1]['t'], 0.4)
        for frame in range(2):
            audit(frame, frame / 5, rows[0])
        path.write_bytes(atom('ftyp') + atom('moov') + atom('mdat'))
        return 2, 5

    @contextlib.contextmanager
    def encoding_fixture(self):
        renderer = types.SimpleNamespace(render_video=self.render_fixture)
        with patch.dict(sys.modules, {'ansi_video_renderer': renderer}), \
                patch.object(subprocess, 'check_output', return_value=json.dumps({
                    'streams': [{'codec_name': 'h264', 'pix_fmt': 'yuv420p'}],
                }).encode()), \
                patch.object(subprocess, 'run') as decode:
            yield decode

    def run_cli(self):
        with patch.object(sys, 'argv', [str(SCRIPT), '--output', str(self.out)]), \
                contextlib.redirect_stdout(io.StringIO()):
            video.main()

    def test_capture_to_receipt_keeps_evidence_and_audits_each_frame(self):
        with self.encoding_fixture() as decode:
            self.run_cli()
        decode.assert_called_once_with([
            'ffmpeg', '-v', 'error', '-xerror', '-i', str(self.out / 'task-placement-clean.mp4'),
            '-f', 'null', '-',
        ], check=True)
        receipt = json.loads((self.out / 'receipt.json').read_text())
        audit = json.loads((self.out / 'all-frame-audit.json').read_text())
        screens = [json.loads(line) for line in (self.out / 'screens.jsonl').read_text().splitlines()]
        self.assertEqual(screens[0]['screen'], '\x1b[32mGuide ready\x1b[0m\n[demo HOME]/NOTES.md\n')
        self.assertEqual((self.out / 'guide.viewport.txt').read_text(), self.screen)
        self.assertEqual(receipt['homeRedactions'][0]['count'], 1)
        self.assertEqual(receipt['checks']['sameQuestionListObservations'], 3)
        self.assertEqual(receipt['checks']['privateTokensAbsentFromDefaultCaptures'], 2)
        self.assertTrue(receipt['checks']['sourceReturnedOnClose'])
        self.assertEqual(receipt['mp4Atoms'], ['ftyp', 'moov', 'mdat'])
        self.assertEqual([frame['frame'] for frame in audit['frames']], [0, 1])
        self.assertEqual(len(audit['captures']), 2)
        self.assertEqual(audit['captures'][1]['markerFindings'], ['ROOT_'])
        self.assertEqual(audit['failedAttemptCaptures'][0]['findings'], ['Tool (?:started|finished):'])

    def test_product_view_rejects_markers(self):
        (self.out / 'guide.viewport.txt').write_text('ROOT_protocol')
        with self.assertRaises(AssertionError):
            video.audit_original_captures(self.out, {'guide.viewport.txt'})

    def test_default_scrollback_rejects_markers(self):
        (self.out / 'diagnostics/guide.scrollback.txt').write_text('Tool started: execute')
        with self.assertRaises(AssertionError):
            video.audit_original_captures(self.out, {'guide.viewport.txt'})

    def test_default_scrollback_rejects_private_context(self):
        (self.out / 'diagnostics/guide.scrollback.txt').write_text('reply-secret')
        with self.assertRaises(AssertionError):
            video.verify_private_question(self.out)

    def test_reopened_question_must_retain_identity(self):
        state = json.loads((self.out / 'diagnostics/final-root-0.json').read_text())
        state['commands']['2']['receipt']['result'][0]['version'] = 2
        self.save('diagnostics/final-root-0.json', state)
        with self.assertRaises(AssertionError):
            video.verify_private_question(self.out)

    def test_replay_never_crops_terminal_rows(self):
        (self.out / 'guide.viewport.txt').write_text('row\n' * 45)
        with self.assertRaisesRegex(AssertionError, 'Never discard terminal rows'):
            video.prepare_replay(self.out, self.timeline, 0.4)

    def test_frame_audit_rejects_dirty_caption(self):
        timeline, _ = video.prepare_replay(self.out, self.timeline, 0.4)
        timeline[0]['caption'] = 'ROOT_protocol'
        with self.encoding_fixture() as decode, self.assertRaises(AssertionError):
            video.render_audited_replay(timeline, self.out / 'task-placement-clean.mp4')
        decode.assert_not_called()
        self.assertFalse((self.out / 'task-placement-clean.mp4').exists())

    def test_decode_failure_withholds_final_receipt(self):
        with self.encoding_fixture() as decode:
            decode.side_effect = subprocess.CalledProcessError(1, 'ffmpeg')
            with self.assertRaises(subprocess.CalledProcessError):
                self.run_cli()
        self.assertFalse((self.out / 'receipt.json').exists())

    def test_encoded_video_requires_faststart(self):
        path = self.out / 'task-placement-clean.mp4'
        path.write_bytes(atom('ftyp') + atom('mdat') + atom('moov'))
        with self.encoding_fixture(), self.assertRaises(AssertionError):
            video.verify_encoded_video(path)


if __name__ == '__main__':
    unittest.main()
