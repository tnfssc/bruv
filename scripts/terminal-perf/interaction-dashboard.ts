import {
  compareInteractions,
  type InteractionRun,
  samplePeakSync,
  summarizeInteraction,
  validateInteractionRun,
} from "./interaction-report";
export function escapeInteractionJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
export function interactionDashboard(run: InteractionRun, baseline?: InteractionRun): string {
  validateInteractionRun(run);
  if (baseline) validateInteractionRun(baseline);
  const rows = run.cases.map((c) => ({
    id: c.id,
    group: c.group,
    scope: c.scope,
    parameters: c.parameters,
    summary: summarizeInteraction(c, run.budgetMs),
    samples: c.samples.map((s) => ({ ...s, peakSyncMs: samplePeakSync(s) })),
  }));
  const data = { run, rows, comparison: baseline ? compareInteractions(run, baseline) : null };
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Terminal interaction evidence</title>
<style>*{box-sizing:border-box}body{font:15px system-ui;background:#111820;color:#e5edf5;margin:clamp(1rem,3vw,2rem)}button,select,input{font:inherit;padding:.4rem;background:#243242;color:inherit;border:1px solid #607386}.table-wrap{overflow:auto;max-height:34rem;margin-top:1rem;border:1px solid #526173;border-radius:8px}table{border-collapse:collapse;width:100%;min-width:900px}thead{position:sticky;top:0;background:#19232d}button{overflow-wrap:anywhere;max-width:100%}input{max-width:100%}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #526173}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:36rem;overflow:auto;background:#19232d;padding:1rem}.miss{color:#ffae9e}.note{color:#bccbd8}summary{cursor:pointer}h2{margin-top:2rem}</style>
<h1>Terminal interaction evidence</h1><p id="meta"></p><p class="note">Observed synchronous scopes only. Inclusive/nested spans are never added. Elapsed, provider waits, heartbeat gaps and scheduler delay are not CPU. Missing contiguous boundaries are NOT a pass for the full interaction. Counting terminal: no PTY/emulator paint or actual Bruv extension lifecycle guarantee.</p>
<details><summary>Environment, source fingerprints and coverage limits</summary><pre id="environment"></pre></details>
<h2>Baseline comparison</h2><pre id="comparison"></pre>
<label>Group <select id="group"><option value="all">All</option><option>send</option><option>tools</option><option>navigation</option></select></label> <label>Case filter <input id="filter" type="search"></label>
<div class="table-wrap"><table><thead><tr><th>Case / drill down</th><th>Sync p95 / max</th><th>Misses</th><th>Mutation lower bound / frame max</th><th>Ack elapsed max</th><th>Input lateness max</th><th>Coverage</th></tr></thead><tbody id="rows"></tbody></table></div>
<h2 id="detail-title">Select a case</h2><pre id="scope"></pre><label>Raw sample <select id="samples"></select></label>
<h3>Top slow observed spans (inclusive; not additive)</h3><pre id="slow"></pre>
<details open><summary>Normalized sample / checks / boundary limits</summary><pre id="sample"></pre></details>
<details><summary>Complete raw fixture + profiler evidence</summary><pre id="raw"></pre></details>
<script id="interaction-data" type="application/json">${escapeInteractionJson(data)}</script>
<script>
const data=JSON.parse(document.getElementById('interaction-data').textContent);
const el=id=>document.getElementById(id), pretty=v=>JSON.stringify(v,null,2), ms=v=>v==null?'n/a':v.toFixed(3)+' ms';
el('meta').textContent=data.run.startedAt+' | strict observed budget < '+data.run.budgetMs+' ms | repetitions '+data.run.config.repetitions;
el('environment').textContent=pretty({environment:data.run.environment,config:data.run.config,sources:data.run.sources,limits:data.run.limits});
el('comparison').textContent=data.comparison?pretty(data.comparison):'No baseline supplied. Use --baseline run.json (works offline in report mode).';
let selected;
function sample(){if(!selected)return; const s=selected.samples[Number(el('samples').value)];
 el('sample').textContent=pretty(s);
 const spans=s.spans.concat(s.frameMs.map((durationMs,i)=>({name:'full frame '+i,kind:'frame',durationMs})));
 if(s.contiguousSyncMs!=null)spans.push({name:'full contiguous slice',durationMs:s.contiguousSyncMs});
 el('slow').textContent=pretty(spans.sort((a,b)=>b.durationMs-a.durationMs).slice(0,20));
 el('raw').textContent=pretty(data.run.evidence[s.rawEvidence]);
}
function choose(row){selected=row;el('detail-title').textContent=row.id;el('scope').textContent=pretty({scope:row.scope,parameters:row.parameters});el('samples').replaceChildren();
 row.samples.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent='repetition '+s.iteration+' / '+s.phase+' / '+ms(s.peakSyncMs);el('samples').append(o)});sample();}
function draw(){el('rows').replaceChildren();data.rows.filter(r=>(el('group').value==='all'||r.group===el('group').value)&&r.id.includes(el('filter').value)).forEach(r=>{
 const tr=document.createElement('tr'),s=r.summary,b=document.createElement('button');b.textContent=r.id;b.onclick=()=>choose(r);
 const values=[b,ms(s.peakSync.p95)+' / '+ms(s.peakSync.max),s.peakSync.overBudget+'/'+s.peakSync.count,ms(s.mutation.max)+' / '+ms(s.frames?.max),ms(s.ack?.max),ms(s.inputLateness?.max),[...new Set(r.samples.map(x=>x.boundary))].join(', ')];
 values.forEach((v,i)=>{const td=document.createElement('td');if(v instanceof Node)td.append(v);else td.textContent=v;if(i===2&&s.peakSync.overBudget)td.className='miss';tr.append(td)});el('rows').append(tr);
 });}
el('group').onchange=draw;el('filter').oninput=draw;el('samples').onchange=sample;draw();if(data.rows.length)choose(data.rows[0]);
</script></html>`;
}
