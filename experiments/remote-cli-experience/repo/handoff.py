"""Git handoff adapter for the integrated CLI. JSON commands: capture REPO ARTIFACT_DIR
[UNTRACKED...], result REMOTE MANIFEST PATCH, integrate REPO MANIFEST PATCH RECEIPTS.
Artifacts belong to the caller; this module does not start remote jobs or transfer bytes.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def git(repo, *args, input=None):
    p = subprocess.run(['git', '-C', str(repo), '-c', 'core.hooksPath=/dev/null', *args],
                       input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode:
        raise ValueError(f'git {args[0]} failed: {p.stderr.decode(errors="replace").strip()}')
    return p.stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def state(repo):
    return dict(head=git(repo, 'rev-parse', 'HEAD').decode().strip(),
                index=digest(git(repo, 'ls-files', '--stage', '-z')),
                tracked=digest(git(repo, 'diff', '--binary', 'HEAD', '--')))


def guard(repo):
    if git(repo, 'rev-parse', '--show-toplevel').decode().strip() != str(Path(repo).resolve()):
        raise ValueError('repository must be worktree root')
    sparse = subprocess.run(['git', '-C', str(repo), 'config', '--bool', '--get', 'core.sparseCheckout'], capture_output=True)
    if sparse.stdout.strip() == b'true' or any(x.startswith(b'S ') for x in git(repo, 'ls-files', '-v', '-z').split(b'\0') if x):
        raise ValueError('sparse checkout / skip-worktree requires review')
    if any(x[:1].islower() for x in git(repo, 'ls-files', '-v', '-z').split(b'\0') if x):
        raise ValueError('assume-unchanged entries require review')
    entries = git(repo, 'ls-files', '--stage', '-z').split(b'\0')[:-1]
    if git(repo, 'ls-files', '-u', '-z') or any(not x.startswith((b'100644 ', b'100755 ')) for x in entries):
        raise ValueError('unmerged entries, symlinks or gitlinks require review')


def untracked(repo):
    return [x.decode('utf-8', 'surrogateescape') for x in git(repo, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0') if x]


def capture(repo, folder, *selected):
    repo = Path(repo).resolve(); folder = Path(folder).resolve()
    guard(repo)
    available = set(untracked(repo))
    if len(set(selected)) != len(selected) or any(p not in available for p in selected):
        raise ValueError('untracked selection must name exact currently untracked files; ask user first')
    for p in selected:
        if not (repo / p).is_file() or (repo / p).is_symlink():
            raise ValueError('only regular untracked files supported')
    selected_bytes = {p: digest((repo / p).read_bytes()) for p in selected}
    before = state(repo)
    patch = git(repo, 'diff', '--binary', 'HEAD', '--')
    folder.mkdir(parents=True, exist_ok=False)
    bundle = folder / 'base.bundle'
    git(repo, 'bundle', 'create', str(bundle), 'HEAD')
    remote = folder / 'snapshot'
    subprocess.run(['git', 'clone', '-q', str(bundle), str(remote)], check=True)
    if patch:
        git(remote, 'apply', '--index', '--binary', input=patch)
    for p in selected:
        dest = remote / p; dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / p, dest)
        dest.chmod((repo / p).stat().st_mode & 0o777)
        git(remote, 'add', '--', p)
    git(remote, '-c', 'user.name=Remote snapshot', '-c', 'user.email=snapshot@example.invalid',
        'commit', '-q', '--allow-empty', '-m', 'Immutable task input')
    if (state(repo) != before or set(untracked(repo)) != available or
        any(digest((repo / p).read_bytes()) != h for p, h in selected_bytes.items())):
        raise ValueError('repository changed during capture; discard snapshot')
    manifest = dict(base=before, snapshot=git(remote, 'rev-parse', 'HEAD').decode().strip(),
                    selectedUntracked=list(selected), omittedUntracked=sorted(available - set(selected)),
                    bundle=str(bundle), snapshotRepo=str(remote))
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def result(remote, manifest_path, patch_path):
    manifest = json.loads(Path(manifest_path).read_text())
    remote = Path(remote).resolve()
    git(remote, 'merge-base', '--is-ancestor', manifest['snapshot'], 'HEAD')
    patch = git(remote, 'diff', '--binary', '--no-renames', manifest['snapshot'], 'HEAD', '--')
    Path(patch_path).write_bytes(patch)
    return dict(patch=str(Path(patch_path).resolve()), sha256=digest(patch), bytes=len(patch))


def integrate(repo, manifest_path, patch_path, receipt_dir):
    repo = Path(repo).resolve(); guard(repo)
    manifest = json.loads(Path(manifest_path).read_text())
    patch = Path(patch_path).read_bytes()
    receipt_dir = Path(receipt_dir).resolve()
    receipt_dir.mkdir(parents=True, exist_ok=True)
    key = digest((manifest['snapshot'] + ':' + digest(patch)).encode())
    receipt = receipt_dir / (key + '.json')
    if receipt.exists():
        return dict(status='review', reason='result already attempted; inspect receipt and worktree', receipt=str(receipt))
    if state(repo) != manifest['base']:
        return dict(status='review', reason='HEAD, index or tracked edits changed since capture', artifact=str(patch_path))
    if not patch:
        return dict(status='no_changes', artifact=str(patch_path))
    try:
        summary = git(repo, 'apply', '--summary', input=patch).decode(errors='replace')
        stats = git(repo, 'apply', '--numstat', '-z', input=patch).split(b'\0')
    except ValueError:
        return dict(status='review', reason='invalid result patch; no mutation', artifact=str(patch_path))
    if summary.strip():
        return dict(status='review', reason='creation, deletion or mode change requires review', artifact=str(patch_path))
    paths = []
    for item in stats:
        if not item: continue
        fields = item.split(b'\t', 2)
        if len(fields) != 3 or not fields[2]:
            return dict(status='review', reason='complex patch paths require review', artifact=str(patch_path))
        paths.append(fields[2].decode('utf-8', 'surrogateescape'))
    tracked_paths = set(git(repo, 'ls-files', '-z').split(b'\0'))
    for p in paths:
        parts = Path(p).parts
        parents = [repo.joinpath(*parts[:i]) for i in range(1, len(parts))]
        if (not parts or any(x in ('.git', '..') for x in parts) or
            p.encode('utf-8', 'surrogateescape') not in tracked_paths or
            p in manifest['selectedUntracked'] or any(x.is_symlink() for x in parents) or
            (repo / p).is_symlink() or not (repo / p).is_file()):
            return dict(status='review', reason='non-regular or selected untracked result path requires review', artifact=str(patch_path))
    try:
        git(repo, 'apply', '--check', '--binary', input=patch)
    except ValueError:
        return dict(status='review', reason='patch conflict; no mutation', artifact=str(patch_path))
    # Prewrite receipt: a crash/ambiguous application never triggers blind replay.
    try:
        fd = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return dict(status='review', reason='result already being applied', receipt=str(receipt))
    with os.fdopen(fd, 'w') as stream:
        stream.write(json.dumps(dict(status='attempting', patch=digest(patch), paths=paths)) + '\n')
        stream.flush(); os.fsync(stream.fileno())
    try:
        git(repo, 'apply', '--binary', input=patch)
    except ValueError:
        return dict(status='review', reason='apply outcome uncertain; inspect worktree', receipt=str(receipt))
    receipt.write_text(json.dumps(dict(status='applied', patch=digest(patch), paths=paths)) + '\n')
    return dict(status='applied', receipt=str(receipt))


if __name__ == '__main__':
    try:
        command, *args = sys.argv[1:]
        print(json.dumps({'capture': capture, 'result': result, 'integrate': integrate}[command](*args)))
    except (ValueError, KeyError, IndexError, subprocess.CalledProcessError) as exc:
        print(json.dumps(dict(status='error', reason=str(exc))), file=sys.stderr)
        sys.exit(1)
