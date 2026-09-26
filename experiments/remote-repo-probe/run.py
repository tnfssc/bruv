#!/usr/bin/env python3
"""Disposable Git-only current-repo handoff probe."""
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path


def git(repo, *args, input=None):
    return subprocess.run(['git', '-C', str(repo), *args], input=input,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout


def put(repo, name, text):
    (repo / name).write_text(text)


def identity(repo):
    return git(repo, 'rev-parse', 'HEAD').strip().decode()


def state(repo):
    return (identity(repo), hashlib.sha256(git(repo, 'diff', '--binary', 'HEAD', '--')).hexdigest(),
            hashlib.sha256(git(repo, 'ls-files', '--stage', '-z')).hexdigest())


def names(data):
    return [p.decode() for p in data.split(b'\0') if p]


def launch(local, remote, bundle, selected):
    if not selected or any(p.startswith(('-', '/')) or '..' in Path(p).parts for p in selected):
        raise ValueError('refuse invalid selection')
    tracked = set(names(git(local, 'ls-files', '-z')))
    if any(p not in tracked for p in selected):
        raise ValueError('refuse untracked or unknown selection')
    dirty = set(names(git(local, 'diff', '--name-only', '-z', 'HEAD', '--')))
    if not dirty.issubset(set(selected)):
        raise ValueError('refuse unselected dirty tracked changes')
    base, tracked_hash, index_hash = state(local)
    omitted = names(git(local, 'ls-files', '--others', '--exclude-standard', '-z'))
    patch = git(local, 'diff', '--binary', 'HEAD', '--', *selected)
    git(local, 'bundle', 'create', str(bundle), 'HEAD')
    subprocess.run(['git', '-c', 'advice.detachedHead=false', 'clone', '-q', str(bundle), str(remote)], check=True)
    git(remote, 'switch', '-q', '-c', 'task')
    if identity(remote) != base:
        raise ValueError('refuse base identity mismatch')
    if patch:
        git(remote, 'apply', '--index', '--binary', '-', input=patch)
    git(remote, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid',
        'commit', '-q', '--allow-empty', '-m', 'task input snapshot')
    return {'base': base, 'tracked_hash': tracked_hash, 'index_hash': index_hash, 'snapshot': identity(remote),
            'omitted_untracked': omitted, 'selected': selected, 'patch_bytes': len(patch)}


def receive(local, record, result_file):
    if state(local) != (record['base'], record['tracked_hash'], record['index_hash']):
        return 'refused: local HEAD, aggregate tracked edits, or index entries changed; result retained'
    patch = result_file.read_bytes()
    try:
        git(local, 'apply', '--check', '--binary', '-', input=patch)
    except subprocess.CalledProcessError:
        return 'refused: patch conflict; result retained'
    git(local, 'apply', '--binary', '-', input=patch)
    return 'applied'


def preserved(repo):
    """Capture HEAD, index entries (including blob OIDs/stages), and fixture file bytes."""
    return (identity(repo), git(repo, 'ls-files', '--stage', '-z'),
            {p.relative_to(repo).as_posix(): p.read_bytes()
             for p in repo.rglob('*') if p.is_file() and '.git' not in p.relative_to(repo).parts})


def refuse_unchanged(repo, action, expected):
    before = preserved(repo)
    outcome = action()
    assert expected in outcome, outcome
    assert preserved(repo) == before, 'refusal modified HEAD, index, or worktree'


def launch_refusal(repo, remote, bundle, selected, expected):
    def attempt():
        try:
            launch(repo, remote, bundle, selected)
        except ValueError as e:
            return str(e)
        raise AssertionError('launch unexpectedly accepted')
    refuse_unchanged(repo, attempt, expected)


def main():
    with tempfile.TemporaryDirectory(prefix='die-repo-probe-') as tmp:
        root = Path(tmp)
        local, remote = root / 'mac', root / 'linux'
        local.mkdir()
        git(local, 'init', '-q', '-b', 'main')
        put(local, 'code.txt', 'base\n')
        put(local, 'other.txt', 'unchanged\n')
        put(local, '.gitignore', 'ignored.env\n')
        git(local, 'add', '--', '.gitignore', 'code.txt', 'other.txt')
        git(local, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'base')
        put(local, 'code.txt', 'base\nselected local edit\n')
        git(local, 'add', '--', 'code.txt')  # selected staged-only edit
        put(local, 'secret.env', 'PRIVATE NOT SENT\n')
        put(local, 'ignored.env', 'IGNORED PRIVATE NOT SENT\n')
        launch_refusal(local, root / 'bad', root / 'bad.bundle', ['secret.env'], 'untracked')
        put(local, 'other.txt', 'unselected staged edit\n')
        git(local, 'add', '--', 'other.txt')
        launch_refusal(local, root / 'bad2', root / 'bad2.bundle', ['code.txt'], 'unselected')
        git(local, 'restore', '--staged', '--worktree', '--', 'other.txt')
        staged_remote = root / 'staged-only'
        staged_record = launch(local, staged_remote, root / 'staged.bundle', ['code.txt'])
        assert staged_record['selected'] == ['code.txt']
        assert (staged_remote / 'code.txt').read_text() == 'base\nselected local edit\n'
        put(local, 'code.txt', 'base\nselected local edit\nselected unstaged edit\n')
        bundle = root / 'task.bundle'
        record = launch(local, remote, bundle, ['code.txt'])
        assert record['omitted_untracked'] == ['secret.env']
        assert not (remote / 'secret.env').exists()
        assert not (remote / 'ignored.env').exists()
        assert (remote / 'code.txt').read_text() == (local / 'code.txt').read_text()
        put(remote, 'code.txt', (remote / 'code.txt').read_text() + 'remote edit\n')
        git(remote, 'add', '--', 'code.txt')
        git(remote, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'remote task')
        result_file = root / 'result.patch'
        result_file.write_bytes(git(remote, 'diff', '--binary', record['snapshot'], 'HEAD', '--'))
        put(local, 'code.txt', (local / 'code.txt').read_text() + 'new conflicting local edit\n')
        refuse_unchanged(local, lambda: receive(local, record, result_file), 'refused')
        put(local, 'code.txt', 'base\nselected local edit\nselected unstaged edit\n')
        put(local, 'other.txt', 'new local uncommitted edit\n')
        refuse_unchanged(local, lambda: receive(local, record, result_file), 'refused')
        git(local, 'restore', '--worktree', '--', 'other.txt')
        # Stage only: the aggregate HEAD-to-worktree diff remains identical.
        aggregate_before = git(local, 'diff', '--binary', 'HEAD', '--')
        git(local, 'add', '--', 'code.txt')
        assert git(local, 'diff', '--binary', 'HEAD', '--') == aggregate_before
        refuse_unchanged(local, lambda: receive(local, record, result_file), 'refused')
        # Return to launch staging layout; exercise the apply-check refusal too.
        git(local, 'reset', '-q', 'HEAD', '--', 'code.txt')
        put(local, 'code.txt', 'base\nselected local edit\n')
        git(local, 'add', '--', 'code.txt')
        put(local, 'code.txt', 'base\nselected local edit\nselected unstaged edit\n')
        assert state(local) == (record['base'], record['tracked_hash'], record['index_hash'])
        invalid = root / 'invalid.patch'
        invalid.write_bytes(b'not a patch\n')
        refuse_unchanged(local, lambda: receive(local, record, invalid), 'patch conflict')
        git(local, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qam', 'local advance')
        refuse_unchanged(local, lambda: receive(local, record, result_file), 'refused')
        fresh = root / 'fresh'
        subprocess.run(['git', '-c', 'advice.detachedHead=false', 'clone', '-q', str(bundle), str(fresh)], check=True)
        put(fresh, 'code.txt', 'base\nselected local edit\n')
        git(fresh, 'add', '--', 'code.txt')
        put(fresh, 'code.txt', 'base\nselected local edit\nselected unstaged edit\n')
        assert receive(fresh, record, result_file) == 'applied'
        assert (fresh / 'code.txt').read_text().endswith('remote edit\n')
        assert (local / 'secret.env').read_text() == 'PRIVATE NOT SENT\n'
        assert (local / 'ignored.env').read_text() == 'IGNORED PRIVATE NOT SENT\n'
        print(json.dumps({'base': record['base'], 'snapshot': record['snapshot'],
                          'bundle_bytes': bundle.stat().st_size, 'selected_patch_bytes': record['patch_bytes'],
                          'result_patch_bytes': result_file.stat().st_size, 'omitted_untracked': record['omitted_untracked'],
                          'checks': ['untracked selection refusal', 'unselected staged refusal',
                                     'selected staged-only and mixed transfer', 'untracked and ignored omission',
                                     'selected/unselected tracked edit refusal', 'index-only staging refusal',
                                     'apply-check refusal', 'advanced HEAD refusal', 'fresh return']}, indent=2))


if __name__ == '__main__':
    main()
