// Copy buttons and two small terminal replays. No dependencies.
for (const button of document.querySelectorAll(".copy")) {
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.textContent = "Copied";
    button.classList.add("done");
    setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("done");
    }, 1500);
  });
}

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const esc = (text) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;
const clock = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`);
const tokensFmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

// A screen is a list of fixed lines plus live board rows that tick on their own.
function screen(el) {
  const state = { lines: [], rows: [], typing: null, frame: 0, sim: 0 };
  const draw = () => {
    const out = [...state.lines];
    for (const row of state.rows) out.push(row.render(state));
    if (state.typing !== null) out.push(`${span("acc", "❯")} ${esc(state.typing)}<span class="caret"> </span>`);
    el.innerHTML = out.map((line) => `<div class="ln">${line || " "}</div>`).join("");
  };
  const timer = setInterval(() => {
    state.frame++;
    if (state.rows.some((row) => !row.done)) state.sim++;
    draw();
  }, 100);
  return {
    state,
    draw,
    line(html) {
      state.lines.push(html);
      draw();
    },
    async type(text, speed = 38) {
      state.typing = "";
      for (const ch of text) {
        state.typing += ch;
        draw();
        await sleep(speed + Math.random() * 30);
      }
      await sleep(350);
      state.typing = null;
      state.lines.push(`${span("acc", "❯")} ${esc(text)}`);
      draw();
    },
    clear() {
      state.lines = [];
      state.rows = [];
      state.sim = 0;
      draw();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A live row: spinner while running, then a fixed result line.
function row(id, title, steps, result, pace = 1, lag = 0) {
  return {
    id,
    done: false,
    start: 0,
    render(state) {
      if (this.done) return this.final;
      const t = Math.max(0, (state.sim - lag) * pace);
      const step = steps.find((s) => t < s.until) ?? steps.at(-1);
      const glyph = SPIN[state.frame % SPIN.length];
      const used = Math.round(2400 + t * 380 * pace);
      const tool = step.tool ? ` · ${step.tool}` : "";
      return `${span("acc", glyph)} · ${id} · ${esc(title)}${esc(tool)} · ${tokensFmt(used)} tokens · ${clock(Math.round(t * 1.2))}`;
    },
    finish(ok = true) {
      this.done = true;
      this.final = `${ok ? span("ok", "✓") : span("bad", "✗")} · ${id} · ${esc(title)} · ${esc(result)}`;
    },
  };
}

async function board(el) {
  const s = screen(el);
  const steps = [
    { until: 14, tool: "read" },
    { until: 999, tool: "edit" },
  ];
  for (;;) {
    s.clear();
    await sleep(500);
    await s.type("run the whole suite in the bg and fix lint meanwhile", 30);
    const job = row("j1", "bun test", [{ until: 999 }], "180 pass · 2m03s");
    const a1 = row("a1", "fix lint in src/api", steps, "+12 −8 · 4 files · 48s", 0.9, 1);
    const a2 = row("a2", "fix lint in src/web", steps, "+6 −3 · 2 files · 39s", 1.2, 3);
    s.state.rows = [job, a1, a2];
    await sleep(3800);
    a2.finish();
    await sleep(900);
    a1.finish();
    await sleep(1800);
    job.finish();
    s.draw();
    await sleep(600);
    s.state.lines.push(...[job, a1, a2].map((r) => r.final));
    s.state.rows = [];
    s.line("");
    s.line("All 180 tests pass and lint is clean in src/api and src/web.");
    s.line(span("dim", "3 scripts · 9 calls · 2 agents · 2m04s · +1% week"));
    await sleep(4800);
  }
}

function finalFrame() {
  document.getElementById("board-demo").innerHTML = [
    `${span("acc", "❯")} run the whole suite in the bg and fix lint meanwhile`,
    `${span("ok", "✓")} · j1 · bun test · 180 pass · 2m03s`,
    `${span("ok", "✓")} · a1 · fix lint in src/api · +12 −8 · 4 files · 48s`,
    `${span("ok", "✓")} · a2 · fix lint in src/web · +6 −3 · 2 files · 39s`,
    span("dim", "3 scripts · 9 calls · 2 agents · 2m04s · +1% week"),
  ]
    .map((line) => `<div class="ln">${line}</div>`)
    .join("");
}

const demo = document.getElementById("board-demo");
if (still) finalFrame();
else {
  // Start the replay when it scrolls into view.
  const seen = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    seen.disconnect();
    board(demo);
  });
  seen.observe(demo);
}
