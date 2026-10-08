"""Offline check: historical collectors put new captures in ignored artifacts."""
import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "wisdom/quality/evidence/ci-history-2026-10-05"


class CaptureTests(unittest.TestCase):
    def test_capture_and_extract_use_artifacts_not_wisdom(self):
        runs = [dict(id=i, name=name, conclusion=result, status="completed",
                     created_at="2026-10-05T18:00:00Z", head_sha="fixture-sha",
                     event="push", run_attempt=1, head_branch="fixture")
                for i, name, result in [(1, "CI", "failure"),
                                        (2, "Release", "failure"),
                                        (3, "CI", "success")]]
        jobs = {str(r["id"]): {"total_count": 1, "jobs": [dict(
            id=r["id"] + 10, run_id=r["id"], name="Linux",
            workflow_name=r["name"], conclusion=r["conclusion"],
            run_attempt=1, head_sha=r["head_sha"],
            started_at=r["created_at"],
            steps=[dict(name="Tests", conclusion=r["conclusion"])])]}
                for r in runs}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            gh = bin_dir / "gh"
            gh.write_text("#!/usr/bin/env python3\nimport json, sys\n"
                          + "runs=" + repr(runs) + "\n"
                          + "jobs=" + repr(jobs) + "\n"
                          + "endpoint=next(arg for arg in sys.argv if arg.startswith('repos/'))\n"
                          + "if '/jobs/' in endpoint: print('(fail) fixture assertion [1ms]\\nerror: fixture failure')\n"
                          + "elif '/jobs?' in endpoint: print(json.dumps(jobs[endpoint.split('/runs/')[1].split('/')[0]]))\n"
                          + "else: print(json.dumps({'total_count':len(runs), 'workflow_runs':runs}))\n")
            gh.chmod(0o755)
            env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]}
            def run(name):
                return subprocess.run(["python3", str(SCRIPTS / name)], cwd=root,
                                      env=env, check=True, capture_output=True,
                                      text=True).stdout
            for name in ["collect.py", "collect-logs.py", "collect-release-jobs.py",
                         "collect-ci-success-jobs.py", "summarize.py", "test-signatures.py"]:
                run(name)
            out = root / "artifacts/ci-history"
            self.assertEqual(json.loads((out / "capture.json").read_text())["unique_runs"], 3)
            self.assertEqual(json.loads((out / "summary.json").read_text())["total_runs"], 3)
            signatures = json.loads((out / "test-signatures.json").read_text())
            self.assertEqual(signatures[0]["runs"], [1, 2])
            self.assertEqual(signatures[0]["test"], "fixture assertion")
            contexts = json.loads(run("extract-owned-failure-contexts.py"))
            self.assertEqual(contexts["inspected_available_logs"], 1)
            self.assertEqual(contexts["jobs"][0]["run_id"], 1)
            self.assertIn("fixture failure", run("release-extract.py"))
            self.assertIn("fixture assertion", gzip.open(out / "logs/11.log.gz", "rt").read())
            self.assertEqual(len(list((out / "jobs").glob("*.json"))), 3)
            self.assertFalse((root / "wisdom").exists())


if __name__ == "__main__":
    unittest.main()
