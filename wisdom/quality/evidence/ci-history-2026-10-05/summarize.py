import collections,json,pathlib
ROOT=pathlib.Path("artifacts/ci-history")
runs=json.loads((ROOT/'runs.json').read_text())
def count(rows,key):
 out={}
 for r in rows:
  bucket=out.setdefault(key(r),{})
  c=r['conclusion'] or r['status'];bucket[c]=bucket.get(c,0)+1
 return out
latest_failed=[r for r in runs if r['conclusion']=='failure']
steps=collections.Counter();jobs=collections.Counter();examples={}
for r in latest_failed:
 f=ROOT/'jobs'/f"{r['id']}.json"
 if not f.exists(): continue
 for j in json.loads(f.read_text())['jobs']:
  if j.get('run_attempt',r['run_attempt'])!=r['run_attempt'] or j['conclusion']!='failure': continue
  jobs[(r['name'],j['name'])]+=1
  for s in j['steps']:
   if s['conclusion']=='failure':
    key=(r['name'],s['name']);steps[key]+=1;examples.setdefault(key,[]).append(r['id'])
summary={'total_runs':len(runs),'date_min':min(r['created_at'] for r in runs),'date_max':max(r['created_at'] for r in runs),'outcomes':count(runs,lambda r:'all'),'by_workflow':count(runs,lambda r:r['name']),'by_event':count(runs,lambda r:r['name']+' / '+r['event']),'reruns':[{'id':r['id'],'name':r['name'],'attempt':r['run_attempt'],'conclusion':r['conclusion'],'sha':r['head_sha']} for r in runs if r['run_attempt']>1],'failed_steps':[{'workflow':k[0],'step':k[1],'count':v,'runs':examples[k]} for k,v in steps.most_common()],'failed_jobs':[{'workflow':k[0],'job':k[1],'count':v} for k,v in jobs.most_common()]}
(ROOT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ('failed_steps','failed_jobs','reruns')},indent=2))
