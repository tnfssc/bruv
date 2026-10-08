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

async function readWireEvidence(file, id) {
  const wire = lines(await fs.readFile(file, "utf8"));
  const lifecycle = wire.flatMap((e, sequence) =>
    e.kind === "lifecycle"
      ? [
          {
            sequence,
            owner: id(e.owner ?? e.value?.pid),
            event: e.value?.event,
            ...(e.value?.flags ? { flags: e.value.flags } : {}),
          },
        ]
      : [],
  );
  const correlation = wire
    .map((e, sequence) => ({ ...e, sequence }))
    .filter((e) => ["stdin", "stdout"].includes(e.kind))
    .map((e) => {
      const m = e.value;
      return {
        sequence: e.sequence,
        owner: id(e.owner),
        direction: e.kind,
        type: m.type,
        subtype: m.subtype,
        state: m.state,
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
  return { lifecycle, correlation };
}

async function readJournalEvidence(directory, id) {
  const journals = [];
  for (const f of await files(directory)) {
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
  return journals;
}

async function readProviderEvidence(runtimeFiles, id) {
  const provider = [];
  for (const f of runtimeFiles) {
    if (f.includes("/logs/provider/") && f.endsWith(".log")) {
      for (const [sequence, line] of (await fs.readFile(f, "utf8")).split("\n").entries()) {
        const start = line.indexOf("{");
        if (start < 0) continue;
        let record;
        try {
          record = JSON.parse(line.slice(start));
        } catch {
          continue;
        }
        const payload = record.event?.payload;
        if (!payload) continue;
        const m = payload.type === "prompt.offer" ? payload.message : payload;
        provider.push({
          sequence,
          thread: id(path.basename(f)),
          providerSession: id(record.providerSessionId),
          direction: record.event.direction,
          type: payload.type,
          subtype: m.subtype,
          state: m.state,
          uuid: id(m.uuid),
          session: id(m.session_id),
          parentTool: id(m.parent_tool_use_id),
          echoedPrompt: id(m.user_message_uuid),
          echoedPrompts: (m.user_message_uuids ?? []).map(id),
          origin: m.origin ? { kind: m.origin.kind } : null,
          resultTurns: m.num_turns,
          markers: markers(m),
        });
      }
    }
  }
  return provider;
}

async function readPersistenceEvidence(runtimeFiles) {
  const persistence = [];
  const events = [];
  const { DatabaseSync } = await import("node:sqlite");
  for (const f of runtimeFiles) {
    if (!/\.(sqlite|sqlite3|db)$/.test(f)) continue;
    const db = new DatabaseSync(f, { readOnly: true });
    try {
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
        if (name === "orchestration_events") {
          for (const row of db
            .prepare(
              "SELECT sequence,event_type,stream_id,occurred_at,payload_json,metadata_json FROM orchestration_events WHERE application_event_version=2 ORDER BY sequence",
            )
            .all()) {
            const payload = JSON.parse(row.payload_json);
            const metadata = JSON.parse(row.metadata_json);
            events.push({
              sequence: row.sequence,
              event_type: row.event_type,
              thread_id: row.stream_id,
              occurred_at: row.occurred_at,
              run_id: metadata.runId,
              node_id: metadata.nodeId,
              status:
                payload.status ?? payload.run?.status ?? payload.providerTurn?.status ?? payload.providerThread?.status,
              markers: markers(payload),
            });
          }
        }
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
  return { events, persistence };
}

// Capture BEFORE replay removes its private state, including on the bounded UI failure.
// Only fixture markers and correlation/status fields: no prompts, pairing tokens or auth rows.
export async function collectReturnEvidence(config, page, filename = "same-root-return-evidence.json") {
  // Share one ID namespace across sources, in capture order, so prompt/session echoes remain comparable.
  const ids = new Map();
  const id = (v) => (v ? (ids.has(v) ? ids.get(v) : (ids.set(v, "id-" + (ids.size + 1)), ids.get(v))) : null);
  const { lifecycle, correlation } = await readWireEvidence(config.wire, id);
  const journals = await readJournalEvidence(path.join(config.env.BRUV_CODING_AGENT_DIR, "native-sessions"), id);
  const runtimeFiles = await files(path.join(path.dirname(config.state), "t3-runtime", "t3-base"));
  const provider = await readProviderEvidence(runtimeFiles, id);
  const { events, persistence } = await readPersistenceEvidence(runtimeFiles);
  const report = {
    lifecycle,
    provider,
    events,
    correlation,
    journals,
    persistence,
    url: page?.url(),
    sameRootChildReturnReply: config.sameRootChildReturnReply ?? false,
    submitVisible: await page?.getByRole("button", { name: "Submit message", exact: true }).isVisible(),
    stopVisible: await page?.getByRole("button", { name: "Stop generation", exact: true }).isVisible(),
  };
  await fs.writeFile(path.join(config.proof, filename), JSON.stringify(report, null, 2) + "\n");
}
