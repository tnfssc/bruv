import gzip,json,pathlib,re
root=pathlib.Path("artifacts/ci-history")
runs=json.loads((root/'runs.json').read_text())
for r in sorted(runs,key=lambda r:r['created_at']):
 if r['name']!='Release' or r['conclusion']!='failure': continue
 jobs=json.loads((root/'jobs'/f"{r['id']}.json").read_text())['jobs']
 for j in jobs:
  if j['conclusion']!='failure': continue
  p=root/'logs'/f"{j['id']}.log.gz"
  print('\nRUN',r['id'],r['created_at'][:10],r['head_branch'],'JOB',j['id'],j['name'],'STEP',[s['name'] for s in j['steps'] if s['conclusion']=='failure'])
  if not p.exists(): print('LOG NOT YET CAPTURED');continue
  lines=gzip.open(p,'rt').read().splitlines()
  hits=[(i,l) for i,l in enumerate(lines) if re.search(r'\(fail\)|error:|##\[error\]|timed out|AssertionError|Error:|error TS',l,re.I)]
  for i,l in hits[-12:]: print(re.sub(r'^\S+Z ','',l)[:400])
