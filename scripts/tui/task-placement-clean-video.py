#!/usr/bin/env python3
"""Render newly recorded clean PTY snapshots. Never filters product text or outcomes."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess


BANNED_PATTERNS = [
    r'PLACEMENT_',
    r'ROOT_',
    r'typed-root',
    r'RootCommand',
    r'fixture verified',
    r'acceptance',
    r'nonce',
    r'receipt',
    r'(?i)toolcode',
    r'root-proof',
    r'ACK_ONLY',
    r'query\s+status',
    r'Saved (?:human )?answer for',
    r'(?m)^\s*(?:assistant|toolResult|user|custom)\s*$',
    r'Tool:?\s+execute',
    r'"code"\s*:',
    r'"owner"\s*:',
    r'"sessionId"\s*:',
    r'questions\.(?:ask|block|resolve)\(',
    r'"replyId"',
    r'"branchId"',
    r'Execution failed',
    r'BuildMessage',
    r'Pane is dead',
    r'Tool (?:started|finished):',
    r'(?m)^.*\] code:',
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def marker_findings(text):
    return [pattern for pattern in BANNED_PATTERNS if re.search(pattern, text)]


def audit_original_captures(out, rendered_paths):
    """Reject markers in product views, but retain findings in unused evidence."""
    originals = []
    for path in sorted(out.glob('*.txt')):
        if path.name == 'failure.txt':
            continue
        raw = path.read_bytes()
        findings = marker_findings(raw.decode())
        rendered = path.name in rendered_paths
        if rendered:
            assert not findings, (path.name, findings)
        originals.append({
            'path': str(path), 'sha256': sha(raw),
            'markerFindings': findings, 'rendered': rendered,
        })

    diagnostic_audit = []
    for path in sorted((out / 'diagnostics').glob('*.scrollback.txt')):
        raw = path.read_bytes()
        findings = marker_findings(raw.decode())
        assert not findings, (path.name, findings)
        diagnostic_audit.append({
            'path': str(path), 'sha256': sha(raw), 'findings': findings,
            'purpose': 'Offscreen full original scrollback; not a rendered viewport',
        })

    excluded_take_audit = []
    for path in sorted(out.glob('failed-*/**/*.txt')):
        raw = path.read_bytes()
        excluded_take_audit.append({
            'path': str(path), 'sha256': sha(raw),
            'findings': marker_findings(raw.decode()),
            'purpose': 'Preserved failed producer attempt; not used for final frames',
        })
    return originals, diagnostic_audit, excluded_take_audit


def verify_private_question(out):
    """Prove hidden context stayed private and the saved question survived reopen."""
    journal = [
        json.loads(line)
        for line in (out / 'server-journal.jsonl').read_text().splitlines()
    ]
    hidden = [entry for entry in journal if entry.get('customType') == 'question-answer']
    assert len(hidden) == 1 and hidden[0]['display'] is False
    private = hidden[0]
    details = private['details']
    private_tokens = [
        private['content'], details['questionId'], details['replyKey'],
        details['owner']['sessionId'], details['owner']['branchId'],
        'Use this saved reply in a new parent turn',
    ]
    default_paths = list(out.glob('*.viewport.txt')) + list(
        (out / 'diagnostics').glob('*.scrollback.txt')
    )
    for path in default_paths:
        text = path.read_text()
        assert not [value for value in private_tokens if value in text], path.name

    state = json.loads(next((out / 'diagnostics').glob('final-root-*.json')).read_text())
    question_lists = [
        command['receipt']['result'] for command in state['commands'].values()
        if command['command']['kind'] == 'questions.list'
    ]
    questions = [
        question for result in question_lists for question in result
        if question['id'] == details['questionId']
    ]
    assert len(questions) >= 3
    identity = lambda question: (question['id'], question['owner'], question['version'])
    assert all(identity(question) == identity(questions[0]) for question in questions)
    return {
        'hiddenCustomMessages': len(hidden), 'display': False,
        'privateTokensAbsentFromDefaultCaptures': len(default_paths),
        'sameQuestionListObservations': len(questions), 'sameQuestionAfterReopen': True,
    }


def prepare_replay(out, source_timeline, duration):
    timeline = []
    redactions = []
    for row in source_timeline:
        raw = (out / row['path']).read_bytes()
        # The only text substitution is this disclosed disposable HOME prefix.
        screen, count = re.subn(
            r'/home/tnfssc/\.bruv/(?:tmp-pi-removal|probes)/[^/\s]+/home',
            '[demo HOME]', raw.decode(),
        )
        assert len(screen.splitlines()) <= 44, 'Never discard terminal rows'
        timeline.append(dict(row, screen=screen))
        redactions.append({'step': row['step'], 'count': count, 'originalSha256': sha(raw)})
    timeline.append(dict(timeline[-1], t=duration))
    return timeline, redactions


def render_audited_replay(timeline, video):
    from ansi_video_renderer import render_video

    frame_audit = []

    def audit_frame(frame, t, row):
        # Every frame's complete visible text is audited, not only selected samples.
        for pattern in BANNED_PATTERNS:
            assert not re.search(pattern, row['screen'] + '\n' + row['caption']), (frame, pattern)
        frame_audit.append({
            'frame': frame, 't': t, 'step': row['step'],
            'screenSha256': sha(row['screen'].encode()),
        })

    frames, fps = render_video(
        timeline, video,
        'bruv — work on a named server',
        'Actual CLI capture replay · isolated Docker SSH · fake inference',
        lambda t: f'{t:05.1f}s  |  Disposable HOME paths redacted · no real hosts or paid APIs',
        audit_frame,
    )
    return frames, fps, frame_audit


def verify_encoded_video(video):
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(video),
    ]))
    stream = probe['streams'][0]
    assert stream['codec_name'] == 'h264' and stream['pix_fmt'] == 'yuv420p'
    # Fully decode every encoded frame; fail on corrupt playback.
    subprocess.run([
        'ffmpeg', '-v', 'error', '-xerror', '-i', str(video), '-f', 'null', '-',
    ], check=True)
    # Explicit MP4 atom order check for faststart.
    data = video.read_bytes()
    offset = 0
    atoms = []
    while offset + 8 <= len(data):
        size = int.from_bytes(data[offset:offset + 4], 'big')
        atoms.append(data[offset + 4:offset + 8].decode('ascii'))
        assert size >= 8
        offset += size
    assert atoms.index('moov') < atoms.index('mdat')
    return {
        'videoSha256': sha(data), 'videoBytes': len(data),
        'fullyDecoded': True, 'codec': 'h264', 'pixelFormat': 'yuv420p',
        'faststart': True, 'mp4Atoms': atoms,
    }


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    out = pathlib.Path(parser.parse_args().output).resolve()
    receipt = json.loads((out / 'capture-receipt.json').read_text())
    assert re.fullmatch(r'[0-9a-f]{64}', receipt['binarySha256'])
    assert re.fullmatch(r'[0-9a-f]{40}', receipt['binarySource'])
    assert receipt['networkMode'] == 'none'
    source_timeline = json.loads((out / 'timeline.json').read_text())

    originals, diagnostic_audit, excluded_take_audit = audit_original_captures(
        out, {row['path'] for row in source_timeline},
    )
    privacy_proof = verify_private_question(out)
    write_json(out / 'privacy-and-reopen-proof.json', privacy_proof)
    receipt['checks'].update(privacy_proof)

    timeline, redactions = prepare_replay(out, source_timeline, receipt['durationSeconds'])
    screens = out / 'screens.jsonl'
    screens.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in timeline))
    video = out / 'task-placement-clean.mp4'
    frames, fps, frame_audit = render_audited_replay(timeline, video)
    print(json.dumps({'duration': frames / fps, 'frames': frames, 'size': video.stat().st_size}))
    write_json(out / 'all-frame-audit.json', {
        'patterns': BANNED_PATTERNS, 'captures': originals,
        'diagnosticScrollback': diagnostic_audit,
        'failedAttemptCaptures': excluded_take_audit, 'frames': frame_audit,
    })

    receipt.update(verify_encoded_video(video))
    receipt.update({
        'originalCaptures': originals,
        'diagnosticScrollbackAudit': diagnostic_audit,
        'failedAttemptCaptureAudit': excluded_take_audit,
        'scrollbackDisclosure': 'All original default-view full scrollbacks pass the raw protocol/hidden-answer audit. Successful execute details are collapsed by the actual fixed CLI, not text filtering or large final output. Visual review is recorded separately; hashes and marker scans alone do not establish product cleanliness.',
        'homeRedactions': redactions,
        'captureSha256': sha(screens.read_bytes()), 'frameCount': frames, 'fps': fps,
        'allRenderedFramesAndCapturesMarkerAudit': 'passed',
        'omittedCaptureDisclosure': 'No scheduled product snapshot omitted. The successful detach snapshot retains the last actual terminal view; producer suppresses tmux dead-pane chrome. A separate diagnostic-inspection take is preserved and marked rejected, not reused.',
        'presentation': 'Retimed new actual compiled CLI PTY snapshots; no synthetic typed input/output, no deletion of diagnostic text. Producer uses natural prompts, tool labels and outputs; verification stays in side files.',
    })
    write_json(out / 'receipt.json', receipt)


if __name__ == '__main__':
    main()
