import sqlite3,json,pathlib,sys
base=pathlib.Path(sys.argv[1])
c=sqlite3.connect('file:'+str(base/'t3-base/userdata/statev2.sqlite')+'?mode=ro',uri=True)
c.row_factory=sqlite3.Row
out={}
out['runs']=[dict(r) for r in c.execute('select run_id,thread_id,ordinal,status,requested_at,completed_at from orchestration_v2_projection_runs order by ordinal')]
out['messages']=[{k:p.get(k) for k in ['id','threadId','runId','role','text','streaming','createdAt','updatedAt']} for r in c.execute('select payload_json from orchestration_v2_projection_messages order by created_at') for p in [json.loads(r[0])]]
out['turnItems']=[{k:p.get(k) for k in ['id','runId','type','status','title','toolName','input','output','text','startedAt','completedAt']} for r in c.execute('select payload_json from orchestration_v2_projection_turn_items order by updated_at') for p in [json.loads(r[0])] if p['type'] in ['dynamic_tool','command_execution','assistant_message','user_message']]
out['eventCounts']=[dict(r) for r in c.execute('select event_type,count(*) as count from orchestration_events group by event_type')]
# All exported prompt/tool text comes from our local deterministic fixture; reject authorization-bearing data.
s=json.dumps(out,indent=2)
assert 'Bearer ' not in s and 'T3_ACP_MCP_AUTHORIZATION=' not in s
(base/'projection-summary.json').write_text(s)
print(json.dumps({'runs':out['runs'],'messageCount':len(out['messages']),'toolNames':[(i['title'],i['toolName']) for i in out['turnItems'] if i['type']=='dynamic_tool']},indent=2))

# Bounded local-job acceptance, not production parity.
late=[m for m in out['messages'] if 'AUTOMATIC_LATE_COMPLETION_OBSERVED_FILTERED' in (m.get('text') or '')]
follow=[m for m in out['messages'] if 'CONCURRENT_FOLLOWUP_COMPLETE_FILTERED' in (m.get('text') or '')]
user=[m for m in out['messages'] if m.get('role')=='user' and 'CONCURRENT_PROBE' in (m.get('text') or '')]
assert len(late)==len(follow)==len(user)==1
assert late[0]['runId']==follow[0]['runId']==user[0]['runId']
assert any(r['run_id']==late[0]['runId'] and r['status']=='completed' for r in out['runs'])
assert (base/'project/stop-survived.txt').read_text().strip()=='survived'
assert any('managed jobs are not stopped' in (m.get('text') or '') for m in out['messages'])
print('Bounded late-output/input/foreground-Stop assertions passed')
