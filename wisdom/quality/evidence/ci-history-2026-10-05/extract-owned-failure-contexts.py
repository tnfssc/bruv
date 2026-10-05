#!/usr/bin/env python3
"""Read available assigned-workflow gzip logs; emit bounded contexts, not full logs."""
import gzip, json, pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent
owned = {"CI", "Daily dependency PR", "Native Live Lab"}
records = {}
for path in sorted((root / "jobs").glob("*.json")):
    for job in json.loads(path.read_text())["jobs"]:
        if job["workflow_name"] not in owned or job["name"] == "CI policy":
            continue
        if job["conclusion"] not in {"failure", "timed_out"}:
            continue
        log = root / "logs" / f"{job['id']}.log.gz"
        if not log.exists():
            continue
        try:
            with gzip.open(log, "rt", errors="replace") as stream:
                lines = stream.read().splitlines()
        except (EOFError, OSError):
            continue  # Collector may still be writing a gzip member.
        clean = [re.sub(r"^\d{4}-\d\d-\d\dT\S+\s*", "", re.sub(r"\x1b\[[0-9;]*m", "", line)) for line in lines]
        contexts, seen = [], set()
        for index, line in enumerate(clean):
            if "(fail)" in line or line.startswith("FAIL "):
                key = re.sub(r" \[.*?ms\]$", "", line)
                if key in seen:
                    continue
                seen.add(key)
                contexts.append({"failure": key, "line": index + 1,
                    "before": [{"line": n + 1, "text": clean[n][:900]} for n in range(max(0, index - 32), index)],
                    "after": clean[index + 1:index + 3]})
        diagnostics = [{"line": n + 1, "text": line[:900]} for n, line in enumerate(clean)
            if re.search(r"^error: (?!script)|^native/.*error:|^.*error TS\d|^TypeError:|^SyntaxError:|^fatal:|^Error: projection|^\S+ (?:format|parse) ━", line)]
        records[job["id"]] = {"run_id": job["run_id"], "job_id": job["id"], "workflow": job["workflow_name"],
            "job": job["name"], "date": job["started_at"], "sha": job["head_sha"], "attempt": job["run_attempt"],
            "contexts": contexts, "diagnostics": diagnostics[:40]}
json.dump({"inspected_available_logs": len(records), "jobs": list(records.values())}, sys.stdout, indent=2)
print()
