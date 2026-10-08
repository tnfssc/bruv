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
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: list(pool.map(fetch,[r for r in runs if r["run_attempt"]>1]))
jobs={}
for f in (ROOT/"jobs").glob("*.json"):
 for j in json.loads(f.read_text())["jobs"]:
  if j["conclusion"] in ("failure","timed_out") and j["name"]!="CI policy": jobs[j["id"]]=j
def collect(j):
 f=ROOT/"logs"/f"{j['id']}.log.gz"
 if f.exists(): return
 p=subprocess.run(["gh","api","--allow-escape-sequences",f"repos/tnfssc/bruv/actions/jobs/{j['id']}/logs"],capture_output=True)
 if p.returncode:
  (ROOT/"logs"/f"{j['id']}.error.txt").write_bytes(p.stderr)
  print("LOG ERROR",j["id"],p.stderr.decode()[:300],flush=True);return
 with gzip.open(f,"wb") as o: o.write(p.stdout)
 (ROOT/"logs"/f"{j['id']}.error.txt").unlink(missing_ok=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: list(pool.map(collect,jobs.values()))
print(json.dumps({"failed_non_policy_jobs":len(jobs),"logs":len(list((ROOT/"logs").glob("*.gz"))),"errors":len(list((ROOT/"logs").glob("*.error.txt")))}),flush=True)
