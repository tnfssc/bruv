#!/usr/bin/env python3
import concurrent.futures,gzip,json,pathlib,subprocess
ROOT=pathlib.Path("artifacts/ci-history")
runs=json.loads((ROOT/"runs.json").read_text())
(ROOT/"logs").mkdir(exist_ok=True)
def fetch(r):
 f=ROOT/"jobs"/f"{r['id']}.json"
 if f.exists(): return
 p=subprocess.run(["gh","api",f"repos/tnfssc/bruv/actions/runs/{r['id']}/jobs?filter=all&per_page=100"],capture_output=True)
 if p.returncode: print("JOBS ERROR",r["id"],p.stderr.decode(),flush=True); return
 f.write_bytes(p.stdout)
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: list(pool.map(fetch,[r for r in runs if r["name"]=="Release" or r["conclusion"] in ("cancelled","skipped")]))
print("Release and cancellation jobs captured",flush=True)
