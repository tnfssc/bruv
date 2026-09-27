import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from handoff import capture, result, integrate, git, state


def put(repo, p, data):
    (repo / p).write_text(data)


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.local = self.root / 'local'
        self.local.mkdir()
        git(self.local, 'init', '-q')
        put(self.local, 'code.txt', 'base\n')
        put(self.local, 'other.txt', 'other\n')
        git(self.local, 'add', '.')
        git(self.local, '-c', 'user.name=Test', '-c', 'user.email=t@x', 'commit', '-qm', 'base')
        put(self.local, 'code.txt', 'base\nstaged\n')
        git(self.local, 'add', 'code.txt')
        put(self.local, 'code.txt', 'base\nstaged\nunstaged\n')
        put(self.local, 'secret.env', 'private')
        self.folder = self.root / 'artifact'
        self.manifest = capture(self.local, self.folder)
        self.remote = self.folder / 'snapshot'
        self.assertEqual((self.remote / 'code.txt').read_text(), 'base\nstaged\nunstaged\n')
        self.assertFalse((self.remote / 'secret.env').exists())

    def test_assume_unchanged_refuses_capture_and_return(self):
        patch = self.make_result()
        git(self.local, 'update-index', '--assume-unchanged', 'other.txt')
        put(self.local, 'other.txt', 'hidden tracked edit\n')
        before = git(self.local, 'ls-files', '--stage', '-z')
        with self.assertRaisesRegex(ValueError, 'assume-unchanged'):
            capture(self.local, self.root / 'hidden-snapshot')
        with self.assertRaisesRegex(ValueError, 'assume-unchanged'):
            self.integrate(patch)
        self.assertEqual((self.local / 'other.txt').read_text(), 'hidden tracked edit\n')
        self.assertEqual(before, git(self.local, 'ls-files', '--stage', '-z'))

    def make_result(self, path='code.txt', content='base\nstaged\nunstaged\nremote\n'):
        put(self.remote, path, content)
        git(self.remote, 'add', '--', path)
        git(self.remote, '-c', 'user.name=Test', '-c', 'user.email=t@x', 'commit', '-qm', 'remote')
        patch = self.folder / 'result.patch'
        result(self.remote, self.folder / 'manifest.json', patch)
        return patch

    def integrate(self, patch):
        return integrate(self.local, self.folder / 'manifest.json', patch, self.folder / 'receipts')

    def test_staged_unstaged_preserved_and_duplicate(self):
        patch = self.make_result()
        index = git(self.local, 'ls-files', '--stage', '-z')
        cached = git(self.local, 'diff', '--cached', '--binary')
        self.assertEqual(self.integrate(patch)['status'], 'applied')
        self.assertEqual(git(self.local, 'ls-files', '--stage', '-z'), index)
        self.assertEqual(git(self.local, 'diff', '--cached', '--binary'), cached)
        self.assertEqual((self.local / 'code.txt').read_text(), 'base\nstaged\nunstaged\nremote\n')
        self.assertEqual(self.integrate(patch)['status'], 'review')

    def test_changed_index_or_head_or_worktree_refuses_without_mutation(self):
        patch = self.make_result()
        put(self.local, 'other.txt', 'changed\n')
        before = (state(self.local), (self.local / 'other.txt').read_bytes())
        self.assertEqual(self.integrate(patch)['status'], 'review')
        self.assertEqual((state(self.local), (self.local / 'other.txt').read_bytes()), before)
        put(self.local, 'other.txt', 'other\n')
        git(self.local, 'add', 'code.txt')
        self.assertEqual(self.integrate(patch)['status'], 'review')
        git(self.local, 'reset', '-q', 'HEAD', '--', 'code.txt')
        put(self.local, 'code.txt', 'base\nstaged\n'); git(self.local, 'add', 'code.txt')
        put(self.local, 'code.txt', 'base\nstaged\nunstaged\n')
        git(self.local, '-c', 'user.name=Test', '-c', 'user.email=t@x', 'commit', '-qm', 'advance')
        self.assertEqual(self.integrate(patch)['status'], 'review')

    def test_conflict_and_new_file_review(self):
        patch = self.folder / 'bad.patch'
        patch.write_text('bad patch')
        self.assertEqual(self.integrate(patch)['status'], 'review')
        patch = self.make_result('new.txt', 'new\n')
        self.assertEqual(self.integrate(patch)['status'], 'review')
        self.assertFalse((self.local / 'new.txt').exists())

    def test_conflicting_patch_refusal(self):
        patch = self.make_result()
        patch.write_bytes(patch.read_bytes().replace(b' unstaged', b' missing!'))
        before = (state(self.local), (self.local / 'code.txt').read_bytes())
        self.assertEqual(self.integrate(patch)['status'], 'review')
        self.assertEqual((state(self.local), (self.local / 'code.txt').read_bytes()), before)

    def test_explicit_untracked_selection(self):
        with self.assertRaises(ValueError):
            capture(self.local, self.root / 'bad', 'not-listed')
        selected = capture(self.local, self.root / 'explicit', 'secret.env')
        self.assertEqual((self.root / 'explicit' / 'snapshot' / 'secret.env').read_text(), 'private')
        self.assertEqual(selected['selectedUntracked'], ['secret.env'])


if __name__ == '__main__':
    unittest.main()
