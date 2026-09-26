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
    return identity(repo), hashlib.sha256(git(repo, 'diff', '--binary', 'HEAD', '--')).hexdigest()


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
    base, tracked_hash = state(local)
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
    return {'base': base, 'tracked_hash': tracked_hash, 'snapshot': identity(remote),
            'omitted_untracked': omitted, 'selected': selected, 'patch_bytes': len(patch)}


def receive(local, record, result_file):
    if state(local) != (record['base'], record['tracked_hash']):
        return 'refused: local HEAD or tracked edits changed; result retained'
    patch = result_file.read_bytes()
    try:
        git(local, 'apply', '--check', '--binary', '-', input=patch)
    except subprocess.CalledProcessError:
        return 'refused: patch conflict; result retained'
    git(local, 'apply', '--binary', '-', input=patch)
    return 'applied'


def main():
    with tempfile.TemporaryDirectory(prefix='die-repo-probe-') as tmp:
        root = Path(tmp)
        local, remote = root / 'mac', root / 'linux'
        local.mkdir()
        git(local, 'init', '-q', '-b', 'main')
        put(local, 'code.txt', 'base\n')
        put(local, 'other.txt', 'unchanged\n')
        git(local, 'add', '--', 'code.txt', 'other.txt')
        git(local, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'base')
        put(local, 'code.txt', 'base\nselected local edit\n')
        put(local, 'secret.env', 'PRIVATE NOT SENT\n')
        try:
            launch(local, root / 'bad', root / 'bad.bundle', ['secret.env'])
            raise AssertionError('untracked selection accepted')
        except ValueError as e:
            assert 'untracked' in str(e)
        put(local, 'other.txt', 'unselected edit\n')
        try:
            launch(local, root / 'bad2', root / 'bad2.bundle', ['code.txt'])
            raise AssertionError('unselected dirty accepted')
        except ValueError as e:
            assert 'unselected' in str(e)
        put(local, 'other.txt', 'unchanged\n')
        bundle = root / 'task.bundle'
        record = launch(local, remote, bundle, ['code.txt'])
        assert record['omitted_untracked'] == ['secret.env']
        assert not (remote / 'secret.env').exists()
        assert (remote / 'code.txt').read_text() == 'base\nselected local edit\n'
        put(remote, 'code.txt', 'base\nselected local edit\nremote edit\n')
        git(remote, 'add', '--', 'code.txt')
        git(remote, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'remote task')
        result_file = root / 'result.patch'
        result_file.write_bytes(git(remote, 'diff', '--binary', record['snapshot'], 'HEAD', '--'))
        put(local, 'code.txt', 'base\nselected local edit\nnew conflicting local edit\n')
        assert receive(local, record, result_file).startswith('refused')
        assert 'new conflicting local edit' in (local / 'code.txt').read_text()
        put(local, 'code.txt', 'base\nselected local edit\n')
        put(local, 'other.txt', 'new local uncommitted edit\n')
        assert receive(local, record, result_file).startswith('refused')
        assert (local / 'other.txt').read_text() == 'new local uncommitted edit\n'
        assert 'remote edit' not in (local / 'code.txt').read_text()
        put(local, 'other.txt', 'unchanged\n')
        git(local, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qam', 'local advance')
        assert receive(local, record, result_file).startswith('refused')
        assert 'remote edit' not in (local / 'code.txt').read_text()
        fresh = root / 'fresh'
        subprocess.run(['git', '-c', 'advice.detachedHead=false', 'clone', '-q', str(bundle), str(fresh)], check=True)
        put(fresh, 'code.txt', 'base\nselected local edit\n')
        assert receive(fresh, record, result_file) == 'applied'
        assert (fresh / 'code.txt').read_text() == 'base\nselected local edit\nremote edit\n'
        assert (local / 'secret.env').read_text() == 'PRIVATE NOT SENT\n'
        print(json.dumps({'base': record['base'], 'snapshot': record['snapshot'],
                          'bundle_bytes': bundle.stat().st_size, 'selected_patch_bytes': record['patch_bytes'],
                          'result_patch_bytes': result_file.stat().st_size, 'omitted_untracked': record['omitted_untracked'],
                          'checks': ['untracked refusal', 'unselected dirty refusal', 'remote isolation',
                                     'local edit refusal', 'advanced HEAD refusal', 'fresh return']}, indent=2))


if __name__ == '__main__':
    main()
