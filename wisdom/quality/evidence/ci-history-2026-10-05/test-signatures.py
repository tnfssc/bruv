import collections,gzip,json,pathlib,re
ROOT=pathlib.Path("artifacts/ci-history")
runs={r['id']:r for r in json.loads((ROOT/'runs.json').read_text())}
seen={};snippets=[]
for f in (ROOT/'jobs').glob('*.json'):
 for j in json.loads(f.read_text())['jobs']:
  if j['conclusion']!='failure' or j['name']=='CI policy':continue
  p=ROOT/'logs'/f"{j['id']}.log.gz"
  if not p.exists():continue
  text=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',gzip.open(p,'rt').read())
  names={re.sub(r' \[\d+(?:\.\d+)?(?:ms|s)\]$','',m.group(1)) for m in re.finditer(r'\(fail\) (.+)',text)}
  for name in names:
   seen.setdefault(name,set()).add(j['run_id'])
rows=[{'test':n,'run_count':len(ids),'runs':sorted(ids),'workflows':dict(collections.Counter(runs[i]['name'] for i in ids))} for n,ids in sorted(seen.items(),key=lambda x:(-len(x[1]),x[0]))]
(ROOT/'test-signatures.json').write_text(json.dumps(rows,indent=2)+'\n')
for r in rows[:30]:print(r['run_count'],r['workflows'],r['test'])
