import fs from "node:fs/promises";
import path from "node:path";
const lines = (s) => s.trim().split("\n").filter(Boolean).map(JSON.parse);
const markers = (value) => [
  ...new Set(JSON.stringify(value).match(/(?:ACCEPT_LOCAL_[A-Z_]+|ROOT_[A-Z_]+_REAL|CHILD_[A-Z_]+_REAL)/g) ?? []),
];
async function files(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else out.push(p);
  }
  return out;
}
// Capture BEFORE replay removes its private state, including on the bounded UI failure.
// Only fixture markers and correlation/status fields: no prompts, pairing tokens or auth rows.
export async function collectReturnEvidence(config, page) {
  const wire = lines(await fs.readFile(config.wire, "utf8"));
  const ids = new Map();
  const id = (v) => (v ? (ids.has(v) ? ids.get(v) : (ids.set(v, "id-" + (ids.size + 1)), ids.get(v))) : null);
  const correlation = wire
    .filter((e) => ["stdin", "stdout"].includes(e.kind))
    .map((e) => {
      const m = e.value;
      return {
        direction: e.kind,
        type: m.type,
        subtype: m.subtype,
        uuid: id(m.uuid),
        session: id(m.session_id),
        parentTool: id(m.parent_tool_use_id),
        echoedPrompt: id(m.user_message_uuid),
        echoedPrompts: (m.user_message_uuids ?? []).map(id),
        origin: m.origin ? { kind: m.origin.kind } : null,
        status: m.status,
        resultTurns: m.num_turns,
        markers: markers(m),
      };
    });
  const journals = [];
  for (const f of await files(path.join(config.env.BRUV_CODING_AGENT_DIR, "native-sessions"))) {
    if (!f.endsWith(".json")) continue;
    const index = JSON.parse(await fs.readFile(f, "utf8"));
    if (!index.file) continue;
    const rows = lines(await fs.readFile(index.file, "utf8"));
    const cursors = new Map();
    for (const r of rows) {
      const c = r.customType === "bruv-native-task-projection" ? r.data?.cursor : null;
      if (c)
        cursors.set(c.link.jobId, {
          job: id(c.link.jobId),
          phase: c.checkpoint?.phase,
          revision: c.revision,
          agentCall: c.agentCall,
          agentResult: c.agentResult,
          childEntries: c.childEntries?.length,
          tokens: c.tokens,
          toolUses: c.toolUses,
        });
    }
    journals.push({
      session: id(path.basename(f, ".json")),
      taskCursors: [...cursors.values()],
      entries: rows
        .filter((r) => ["message", "custom_message"].includes(r.type))
        .map((r) => ({
          id: id(r.id),
          parent: id(r.parentId),
          type: r.type,
          customType: r.customType,
          role: r.message?.role,
          markers: markers(r),
        })),
    });
  }
  const persistence = [];
  const { DatabaseSync } = await import("node:sqlite");
  const base = path.join(path.dirname(config.state), "t3-runtime", "t3-base");
  for (const f of await files(base)) {
    if (!/\.(sqlite|sqlite3|db)$/.test(f)) continue;
    const db = new DatabaseSync(f, { readOnly: true });
    try {
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
        if (!/^orchestration_v2_projection_(threads|runs|nodes|provider_turns|subagents)$/.test(name)) continue;
        const cols = db
          .prepare('PRAGMA table_info("' + name + '")')
          .all()
          .map((c) => c.name);
        const selected = cols.filter((c) => /(^id$|_id$|status|phase|role|started_at|completed_at|updated_at)/.test(c));
        if (!selected.length) continue;
        const rows = db
          .prepare("SELECT " + selected.map((c) => '"' + c + '"').join(",") + ' FROM "' + name + '" LIMIT 100')
          .all();
        persistence.push({ table: name, columns: cols, rows });
      }
    } finally {
      db.close();
    }
  }
  const report = {
    correlation,
    journals,
    persistence,
    url: page.url(),
    sameRootChildReturnReply: config.sameRootChildReturnReply ?? false,
    submitVisible: await page.getByRole("button", { name: "Submit message", exact: true }).isVisible(),
    stopVisible: await page.getByRole("button", { name: "Stop generation", exact: true }).isVisible(),
  };
  await fs.writeFile(path.join(config.proof, "same-root-return-evidence.json"), JSON.stringify(report, null, 2) + "\n");
}
