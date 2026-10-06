import { compareRuns, summarizeCase, type PerfRun } from "./report.js";

/** One offline file. No CDN, server or provider is needed to inspect a run. */
export function dashboard(run: PerfRun, baseline?: PerfRun): string {
  const payload = JSON.stringify({
    run,
    comparison: baseline ? compareRuns(run, baseline) : null,
    summaries: run.cases.map((entry) => summarizeCase(entry, run.budgetMs)),
  })
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `<!doctype html>${page.replace("/*PAYLOAD*/", () => payload)}`;
}

const page = String.raw`<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bruv &#x00B7; Terminal frame lab</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0b1018;color:#e3eaf4}body{max-width:1400px;margin:auto;padding:32px}h1{font-size:34px;margin-bottom:8px}h2{font-size:20px}p{color:#9dacc2;line-height:1.6}header{border-bottom:1px solid #273449;padding-bottom:20px}.tag{color:#69e4c7;font:13px monospace;letter-spacing:2px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.card,section{background:#131d2b;border:1px solid #273449;border-radius:12px;padding:20px}.card strong{display:block;font:28px monospace;margin-top:8px}.good{color:#69e4c7}.bad{color:#ff847d}table{min-width:980px;width:100%;border-collapse:collapse;font-size:13px}th,td{padding:11px 8px;text-align:right;border-bottom:1px solid #273449}td:first-child,th:first-child{text-align:left}tbody tr{cursor:pointer}tbody tr:hover,tbody tr.selected{background:#203149}section{margin:16px 0;overflow:auto}select{background:#203149;color:inherit;padding:8px;border:1px solid #465772;border-radius:6px}svg{width:100%;height:240px;display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#9dacc2}.legend{font:12px monospace}.row{display:flex;gap:16px;align-items:center;flex-wrap:wrap}#tooltip{min-height:24px;font:13px monospace;color:#9dacc2}a{color:#69e4c7}@media(max-width:700px){body{padding:12px}.cards{grid-template-columns:repeat(2,1fr)}}
</style>
<header><div class="tag">BRUV / TERMINAL FRAME LAB</div><h1>Every frame counts.</h1><p>Synchronous main-thread work. Cold frames stay visible. Spikes do not disappear into an average.</p><div id="env" class="legend"></div><p class="legend"><a href="run.json">Raw frames</a> · <a href="report.txt">Plain report</a> · <a href="trace.json">Timeline trace</a></p></header>
<div class="cards"><div class="card">Frame budget<strong id="budget"></strong></div><div class="card">Worst frame<strong id="worst"></strong></div><div class="card">Budget misses<strong id="misses"></strong></div><div class="card">Measured frames<strong id="count"></strong></div></div>
<section><h2>Workloads</h2><table><thead><tr><th>Case</th><th>Cold max</th><th>p50</th><th>p95</th><th>p99</th><th>Max</th><th>Misses cold / steady</th><th>Changed steady</th></tr></thead><tbody id="cases"></tbody></table></section>
<section><div class="row"><h2 id="case-title"></h2><select id="phase"><option value="frames">Steady frames</option><option value="cold">Cold frames</option></select><select id="metric"><option value="durationMs">Total frame</option></select></div><p id="description"></p><svg id="chart" viewBox="0 0 1000 240" role="img" aria-label="Per-frame timing, with budget line"></svg><div id="tooltip">Hover a frame to inspect its time and work.</div><p class="legend">Red: at or above budget. Green: below budget. Observable phases use exclusive time. Imported layout and inline diff remain in inlineLayoutDiffAndOther.</p><h2>Slowest frames</h2><pre id="slow"></pre></section>
<section><h2>Before / after</h2><pre id="compare"></pre></section>
<section><h2>What this proves</h2><p>This runs actual TUI layout, screen diff and terminal write calls into a counting terminal. It does not measure a terminal emulator's paint, OS output backpressure, provider latency or every possible session. Request / input delay is separate from CPU work. These samples locate regressions; no run proves that lag can never happen. Keep machine, runtime, viewport and workload settings the same for comparisons.</p><pre id="config"></pre></section>
<script>
const data=/*PAYLOAD*/;
const {run,summaries,comparison}=data;
const el=id=>document.getElementById(id), fmt=n=>n.toFixed(3)+' ms';
const all=run.cases.flatMap(c=>[...c.cold,...c.frames]);
el('budget').textContent='< '+run.budgetMs+' ms';el('worst').textContent=fmt(all.reduce((max,f)=>Math.max(max,f.durationMs),0));el('misses').textContent=all.filter(f=>f.durationMs>=run.budgetMs).length;el('misses').className=all.some(f=>f.durationMs>=run.budgetMs)?'bad':'good';el('count').textContent=all.length;
el('env').textContent=run.environment.revision+(run.environment.dirty?' \u00B7 dirty':'')+' \u00B7 Bun '+run.environment.bun+' \u00B7 '+run.environment.cpu+' \u00B7 '+run.startedAt;
el('config').textContent=JSON.stringify({config:run.config,environment:run.environment},null,2);
el('compare').textContent=comparison?JSON.stringify(comparison,null,2):'No baseline supplied. Rerun with --baseline path/to/run.json to compare.';
let selected=0;
run.cases.forEach((c,i)=>{const s=summaries[i],t=s.steady.timing;const row=document.createElement('tr');const values=[c.id,fmt(s.cold.timing.max),fmt(t.p50),fmt(t.p95),fmt(t.p99),fmt(t.max),s.cold.timing.overBudget+' / '+t.overBudget,s.steady.changed+' / '+t.count];values.forEach((v,j)=>{const td=document.createElement('td');td.textContent=v;if(j===5)td.className=t.max>=run.budgetMs?'bad':'good';row.append(td)});row.tabIndex=0;row.onclick=()=>choose(i);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(i)}};el('cases').append(row)});
function choose(i){selected=i;[...el('cases').children].forEach((r,j)=>r.classList.toggle('selected',i===j));el('case-title').textContent=run.cases[i].id;el('description').textContent=run.cases[i].description;const metric=el('metric');metric.replaceChildren();const names=['durationMs',...new Set([...run.cases[i].cold,...run.cases[i].frames].flatMap(f=>Object.keys(f.phases)))];for(const name of names){const o=document.createElement('option');o.value=name;o.textContent=name==='durationMs'?'Total frame':name;metric.append(o)}draw()}
const ns='http://www.w3.org/2000/svg';
function shape(tag,attrs){const n=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));el('chart').append(n);return n}
function draw(){const frames=run.cases[selected][el('phase').value],metric=el('metric').value,value=f=>metric==='durationMs'?f.durationMs:(f.phases[metric]||0);const max=frames.reduce((max,f)=>Math.max(max,value(f)),run.budgetMs*1.25), y=n=>210-(n/max)*190;el('chart').replaceChildren();const label=shape('text',{x:40,y:15,fill:'#9dacc2','font-size':12});label.textContent='Scale: 0 \u2013 '+fmt(max);frames.forEach((f,i)=>{const w=950/frames.length,x=40+i*w,v=value(f);const bar=shape('rect',{x,y:y(v),width:Math.max(.5,w-1),height:Math.max(1,210-y(v)),fill:v>=run.budgetMs?'#ff847d':'#69e4c7'});const title=document.createElementNS(ns,'title');title.textContent='#'+f.index+' '+f.action+': '+fmt(v);bar.append(title);bar.onmouseenter=()=>{el('tooltip').textContent='#'+f.index+' '+f.action+' \u00B7 '+fmt(v)+' \u00B7 '+f.bytes+' bytes / '+f.writes+' writes \u00B7 changed='+f.changed+' \u00B7 work='+JSON.stringify(f.work||{})}});shape('line',{x1:40,y1:y(run.budgetMs),x2:990,y2:y(run.budgetMs),stroke:'#ffe1a3','stroke-width':2,'stroke-dasharray':'5 5'});const budgetLabel=shape('text',{x:45,y:y(run.budgetMs)-6,fill:'#ffe1a3','font-size':12});budgetLabel.textContent='budget '+run.budgetMs+' ms';el('slow').textContent=[...frames].sort((a,b)=>b.durationMs-a.durationMs).slice(0,5).map(f=>'#'+f.index+' '+f.action+' \u00B7 '+fmt(f.durationMs)+'\n  phases '+JSON.stringify(f.phases)+'\n  work '+JSON.stringify(f.work||{})).join('\n')}
el('phase').onchange=draw;el('metric').onchange=draw;choose(0);
</script></html>`;
