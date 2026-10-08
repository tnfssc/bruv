#!/usr/bin/env python3
"""Read-only Actions history capture. No workflow runs are started or changed."""
import concurrent.futures, datetime, json, pathlib, subprocess
ROOT=pathlib.Path("artifacts/ci-history")
ROOT.mkdir(parents=True, exist_ok=True)
REPO='tnfssc/bruv'
def api(path):
 p=subprocess.run(['gh','api',path],capture_output=True,text=True)
 if p.returncode: raise RuntimeError(p.stderr)
 return json.loads(p.stdout)
def save(name,data): (ROOT/name).write_text(json.dumps(data,indent=2)+'\n')
meta=api(f'repos/{REPO}/actions/runs?per_page=100&page=1')
runs=meta['workflow_runs']
for page in range(2,(meta['total_count']+99)//100+1):
 runs+=api(f'repos/{REPO}/actions/runs?per_page=100&page={page}')['workflow_runs']
runs=list({r['id']:r for r in runs}.values())
save('runs.json',runs)
save('capture.json',{'captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repo':REPO,'api_total_count':meta['total_count'],'unique_runs':len(runs),'scope':'All retained Actions runs returned by unfiltered repository endpoint. First response sets page count; concurrent new runs can shift pages.'})
failed=[r for r in runs if r['conclusion'] in ('failure','timed_out','action_required','startup_failure','stale')]
(ROOT/'jobs').mkdir(exist_ok=True)
def collect(r):
 f=ROOT/'jobs'/f"{r['id']}.json"
 if f.exists(): return
 try:
  data=api(f"repos/{REPO}/actions/runs/{r['id']}/jobs?filter=all&per_page=100")
  if data['total_count']>100:
   for page in range(2,(data['total_count']+99)//100+1):
    data['jobs']+=api(f"repos/{REPO}/actions/runs/{r['id']}/jobs?filter=all&per_page=100&page={page}")['jobs']
  f.write_text(json.dumps(data,indent=2)+'\n')
 except Exception as e: print('ERROR',r['id'],str(e),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: list(pool.map(collect,failed))
print(json.dumps({'runs':len(runs),'failed_like_runs':len(failed),'jobs_captured':len(list((ROOT/'jobs').glob('*.json')))},indent=2))
