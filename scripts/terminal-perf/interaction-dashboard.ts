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
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
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
const data = JSON.parse(document.getElementById('interaction-data').textContent);
const el = id => document.getElementById(id);
const pretty = value => JSON.stringify(value, null, 2);
const ms = value => value == null ? 'n/a' : value.toFixed(3) + ' ms';

el('meta').textContent = data.run.startedAt + ' | strict observed budget < ' + data.run.budgetMs + ' ms | repetitions ' + data.run.config.repetitions;
el('environment').textContent = pretty({environment: data.run.environment, config: data.run.config, sources: data.run.sources, limits: data.run.limits});
el('comparison').textContent = data.comparison ? pretty(data.comparison) : 'No baseline supplied. Use --baseline run.json (works offline in report mode).';

function slowObservedSpans(sample) {
  const spans = sample.spans.concat(sample.frameMs.map((durationMs, i) => ({name: 'full frame ' + i, kind: 'frame', durationMs})));
  if (sample.contiguousSyncMs != null) {
    spans.push({name: 'full contiguous slice', durationMs: sample.contiguousSyncMs});
  }
  return spans.sort((a, b) => b.durationMs - a.durationMs).slice(0, 20);
}

function showSample(sample) {
  el('sample').textContent = pretty(sample);
  el('slow').textContent = pretty(slowObservedSpans(sample));
  el('raw').textContent = pretty(data.run.evidence[sample.rawEvidence]);
}

function showCase(row) {
  el('detail-title').textContent = row.id;
  el('scope').textContent = pretty({scope: row.scope, parameters: row.parameters});
  const samples = el('samples');
  samples.replaceChildren();
  row.samples.forEach((sample, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = 'repetition ' + sample.iteration + ' / ' + sample.phase + ' / ' + ms(sample.peakSyncMs);
    samples.append(option);
  });
  // The picker belongs to this case; filtering the table leaves its drill-down intact.
  const showSelectedSample = () => showSample(row.samples[Number(samples.value)]);
  samples.onchange = showSelectedSample;
  showSelectedSample();
}

function textCell(text, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text;
  cell.className = className;
  return cell;
}

function caseRow(row) {
  const tr = document.createElement('tr');
  const button = document.createElement('button');
  button.textContent = row.id;
  button.onclick = () => showCase(row);
  const caseCell = document.createElement('td');
  caseCell.append(button);
  const summary = row.summary;
  tr.append(caseCell);
  tr.append(textCell(ms(summary.peakSync.p95) + ' / ' + ms(summary.peakSync.max)));
  tr.append(textCell(summary.peakSync.overBudget + '/' + summary.peakSync.count, summary.peakSync.overBudget ? 'miss' : ''));
  tr.append(textCell(ms(summary.mutation.max) + ' / ' + ms(summary.frames?.max)));
  tr.append(textCell(ms(summary.ack?.max)));
  tr.append(textCell(ms(summary.inputLateness?.max)));
  tr.append(textCell([...new Set(row.samples.map(sample => sample.boundary))].join(', ')));
  return tr;
}

function drawCases() {
  const group = el('group').value;
  const filter = el('filter').value;
  const rows = el('rows');
  rows.replaceChildren();
  for (const row of data.rows) {
    if ((group === 'all' || row.group === group) && row.id.includes(filter)) {
      rows.append(caseRow(row));
    }
  }
}

el('group').onchange = drawCases;
el('filter').oninput = drawCases;
drawCases();
if (data.rows.length) showCase(data.rows[0]);
</script></html>`;
}
