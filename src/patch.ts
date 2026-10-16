import { realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type ExtensionAPI, type ExtensionContext, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** One `@@` section of an Update File: lines to find and what replaces them. */
type Chunk = { context?: string; old: string[]; new: string[]; eof: boolean };
export type Hunk =
  | { type: "add"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; moveTo?: string; chunks: Chunk[] };
export type PatchResult = {
  added: string[];
  modified: string[];
  deleted: string[];
  moved?: { from: string; to: string }[];
};

const ADD = "*** Add File: ";
const DELETE = "*** Delete File: ";
const UPDATE = "*** Update File: ";
const MOVE = "*** Move to: ";
const END_OF_FILE = "*** End of File";

const fail = (message: string): never => {
  throw new Error(message);
};

/** Reads the Codex patch format into hunks, or throws saying which line is wrong. */
export function parsePatch(input: string): Hunk[] {
  let lines = input.trim().split(/\r?\n/);
  // Like Codex, accept a patch still wrapped in the shell heredoc meant for `apply_patch <<'EOF'`.
  const heredoc = /^(?:apply_patch\s+)?<<-?\s*(['"]?)(\w+)\1$/.exec(lines[0]?.trim() ?? "");
  if (heredoc && lines.length >= 4 && lines.at(-1)?.trim() === heredoc[2]) lines = lines.slice(1, -1);
  if (lines[0]?.trim() !== "*** Begin Patch") fail("The first line of the patch must be '*** Begin Patch'.");
  if (lines.length < 2 || lines.at(-1)?.trim() !== "*** End Patch")
    fail("The last line of the patch must be '*** End Patch'.");
  const end = lines.length - 1;
  const hunks: Hunk[] = [];
  let i = 1;
  const where = () => `line ${i + 1}`;
  while (i < end) {
    const header = lines[i].trim();
    if (!header) {
      i++;
    } else if (header.startsWith(ADD)) {
      const path = header.slice(ADD.length).trim();
      let content = "";
      for (i++; i < end && lines[i].startsWith("+"); i++) content += `${lines[i].slice(1)}\n`;
      hunks.push({ type: "add", path, content });
    } else if (header.startsWith(DELETE)) {
      hunks.push({ type: "delete", path: header.slice(DELETE.length).trim() });
      i++;
    } else if (header.startsWith(UPDATE)) {
      const path = header.slice(UPDATE.length).trim();
      const start = where();
      i++;
      let moveTo: string | undefined;
      if (i < end && lines[i].trim().startsWith(MOVE)) moveTo = lines[i++].trim().slice(MOVE.length).trim();
      const chunks: Chunk[] = [];
      while (i < end) {
        if (!lines[i].trim()) {
          i++;
          continue;
        }
        if (lines[i].startsWith("***")) break;
        const chunk: Chunk = { old: [], new: [], eof: false };
        const marker = lines[i].trimEnd();
        if (marker === "@@") i++;
        else if (marker.startsWith("@@ ")) {
          // A unified diff header (`@@ -1,3 +1,4 @@`) says nothing Codex can use, so it counts as a bare @@.
          const context = marker.slice(3);
          if (!/^-\d+(,\d+)? \+\d+(,\d+)? @@/.test(context)) chunk.context = context;
          i++;
        } else if (chunks.length) fail(`Expected a line starting with @@ at ${where()}, got: ${lines[i]}`);
        let count = 0;
        for (; i < end; i++, count++) {
          const line = lines[i];
          if (line.trimEnd() === END_OF_FILE) {
            chunk.eof = true;
            i++;
            count++;
            break;
          }
          const mark = line[0];
          const text = line.slice(1);
          if (line === "") {
            chunk.old.push("");
            chunk.new.push("");
          } else if (mark === " ") {
            chunk.old.push(text);
            chunk.new.push(text);
          } else if (mark === "-") chunk.old.push(text);
          else if (mark === "+") chunk.new.push(text);
          else if (count === 0)
            fail(`Unexpected line at ${where()}: ${line}\nEvery change line starts with ' ', '-' or '+'.`);
          else break;
        }
        if (!count) fail(`A chunk for ${path} has no lines (${where()}).`);
        chunks.push(chunk);
      }
      if (!chunks.length) fail(`The update for ${path} at ${start} has no changes.`);
      hunks.push({ type: "update", path, moveTo, chunks });
    } else {
      fail(
        `'${header}' at ${where()} is not a file header. Use '*** Add File: path', '*** Delete File: path' or '*** Update File: path'.`,
      );
    }
  }
  if (!hunks.length) fail("The patch changes no files.");
  for (const hunk of hunks)
    if (!hunk.path || (hunk.type === "update" && hunk.moveTo === "")) fail("A file path is empty.");
  return hunks;
}

const normal = (line: string) =>
  line
    .trim()
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[  -   　]/g, " ");
// Codex's seek_sequence: exact first, then looser matches, so the closest match wins.
const loose = [(line: string) => line, (line: string) => line.trimEnd(), (line: string) => line.trim(), normal];

/** Where `pattern` starts in `lines` at or after `start`, or -1. At end of file only the last lines count. */
export function seek(lines: string[], pattern: string[], start: number, eof: boolean): number {
  if (!pattern.length) return start;
  if (pattern.length > lines.length) return -1;
  const last = lines.length - pattern.length;
  for (const same of loose)
    for (let at = eof ? last : start; at <= last; at++)
      if (pattern.every((line, j) => same(lines[at + j]) === same(line))) return at;
  return -1;
}

/** The new file text after the chunks, keeping the file's BOM, line endings and final newline. */
export function applyChunks(path: string, text: string, chunks: Chunk[]): string {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const crlf = text.includes("\r\n");
  const lines = text.slice(bom.length).replace(/\r\n/g, "\n").split("\n");
  const newline = lines.at(-1) === "";
  if (newline) lines.pop();
  const edits: [number, number, string[]][] = [];
  let next = 0;
  for (const chunk of chunks) {
    if (chunk.context !== undefined) {
      const at = seek(lines, [chunk.context], next, false);
      if (at < 0) fail(`Could not find the @@ line in ${path}:\n${chunk.context}`);
      next = at + 1;
    }
    if (!chunk.old.length) {
      // Pure additions go after the @@ line when there is one, else at the end of the file.
      const at = chunk.context === undefined ? lines.length : next;
      edits.push([at, 0, chunk.new]);
      next = at;
      continue;
    }
    let old = chunk.old;
    let replacement = chunk.new;
    let at = seek(lines, old, next, chunk.eof);
    // A blank line that only separated two hunks is not part of the file.
    if (at < 0 && old.at(-1) === "") {
      old = old.slice(0, -1);
      if (replacement.at(-1) === "") replacement = replacement.slice(0, -1);
      at = old.length ? seek(lines, old, next, chunk.eof) : -1;
    }
    if (at < 0) fail(`Could not find these lines in ${path}:\n${chunk.old.join("\n")}`);
    edits.push([at, old.length, replacement]);
    next = at + old.length;
  }
  for (const [at, count, replacement] of edits.sort((a, b) => a[0] - b[0]).reverse())
    lines.splice(at, count, ...replacement);
  const body = lines.length ? lines.join("\n") + (newline ? "\n" : "") : "";
  return bom + (crlf ? body.replace(/\n/g, "\r\n") : body);
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Checks every hunk against the files, then writes them all; a patch that fails writes nothing. */
export async function applyPatch(input: string, cwd: string): Promise<PatchResult> {
  const hunks = parsePatch(input);
  const full = (path: string) => resolve(cwd, path);
  // Pi's queue keys files by real path, so two names for one file must take one turn, not wait on themselves.
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const named = hunks.flatMap((hunk) => [hunk.path, ...(hunk.type === "update" && hunk.moveTo ? [hunk.moveTo] : [])]);
  const paths = [...new Set(named.map((path) => real(full(path))))].sort();
  // Hold every file's turn in Pi's queue, in a fixed order so two patches never wait on each other.
  const locked = paths.reduceRight<() => Promise<PatchResult>>(
    (inner, path) => () => withFileMutationQueue(path, inner),
    () => write(hunks, full),
  );
  return locked();
}

async function write(hunks: Hunk[], full: (path: string) => string): Promise<PatchResult> {
  // New contents by absolute path; null means delete. Later hunks see earlier ones.
  const files = new Map<string, string | null>();
  const current = async (path: string) => {
    const text = files.has(full(path)) ? files.get(full(path)) : await readText(full(path));
    return typeof text === "string" ? text : fail(`${path} does not exist.`);
  };
  const added = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  const moved: { from: string; to: string }[] = [];
  for (const hunk of hunks) {
    if (hunk.type === "add") {
      files.set(full(hunk.path), hunk.content);
      added.add(hunk.path);
    } else if (hunk.type === "delete") {
      await current(hunk.path);
      files.set(full(hunk.path), null);
      deleted.add(hunk.path);
    } else {
      const text = applyChunks(hunk.path, await current(hunk.path), hunk.chunks);
      if (hunk.moveTo && full(hunk.moveTo) !== full(hunk.path)) {
        files.set(full(hunk.path), null);
        files.set(full(hunk.moveTo), text);
        moved.push({ from: hunk.path, to: hunk.moveTo });
      } else {
        files.set(full(hunk.path), text);
        modified.add(hunk.path);
      }
    }
  }
  // Keep what was there, so a write that fails part way (permissions, a file where a folder goes) is undone.
  const before = new Map<string, string | undefined>();
  for (const path of files.keys()) before.set(path, await readText(path).catch(() => undefined));
  const put = async (path: string, text: string | null | undefined) => {
    if (typeof text !== "string") return rm(path, { force: true });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  };
  const done: string[] = [];
  try {
    for (const [path, text] of files) {
      done.push(path);
      await put(path, text);
    }
  } catch (error) {
    for (const path of done.reverse()) await put(path, before.get(path)).catch(() => {});
    throw error;
  }
  return {
    added: [...added],
    modified: [...modified],
    deleted: [...deleted],
    ...(moved.length ? { moved } : {}),
  };
}

export function summary(result: PatchResult): string {
  return [
    "Success. Updated the following files:",
    ...result.added.map((path) => `A ${path}`),
    ...result.modified.map((path) => `M ${path}`),
    ...(result.moved ?? []).map((move) => `M ${move.from} -> ${move.to}`),
    ...result.deleted.map((path) => `D ${path}`),
  ].join("\n");
}

/** The files a patch names, for showing a call before it runs. */
export function patchPaths(input: string): string[] {
  return [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim());
}

/** Codex's apply_patch grammar (codex-rs/core/assets/tools/apply_patch.lark). */
const grammar = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;
const trainedOn = new Set(["openai-responses", "openai-codex-responses"]);

export function registerPatch(pi: ExtensionAPI): void {
  // OpenAI models call apply_patch directly, next to codemode, as they do in Codex. Scripts can
  // call it on every model.
  const declare = (_event: unknown, ctx: ExtensionContext) => {
    const active = pi.getActiveTools();
    const wanted = trainedOn.has(ctx.model?.api ?? "");
    if (wanted === active.includes("apply_patch")) return;
    pi.setActiveTools(wanted ? [...active, "apply_patch"] : active.filter((name) => name !== "apply_patch"));
  };
  pi.on("session_start", declare);
  pi.on("model_select", declare);
  pi.registerTool({
    name: "apply_patch",
    label: "Apply patch",
    // Codex's own wording and grammar: GPT models write the patch as raw text, the way they were trained.
    description:
      "The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON. Every change is checked before any file is written, so a patch that fails changes nothing.",
    constrainedSampling: { type: "grammar", variants: { openai_lark: grammar } },
    promptGuidelines: [
      "Format: `*** Begin Patch`, then per file `*** Add File: path` (each line starts with +), `*** Delete File: path`, or `*** Update File: path` (optionally then `*** Move to: path`) followed by chunks, then `*** End Patch`.",
      "A chunk starts with `@@` or `@@ <a line above the change, like a function header>`, then lines starting with ' ' (unchanged), '-' or '+'. Give about 3 unchanged lines around each change. End a chunk that reaches the end of the file with `*** End of File`.",
      `Pass the patch as String.raw\`...\`; inside it write a backtick as \${"\`"} and a dollar sign followed by { as \${"$"}{.`,
    ],
    exposure: "codemode",
    parameters: Type.Object({
      input: Type.String({ description: "The whole patch, from *** Begin Patch to *** End Patch" }),
    }),
    outputSchema: Type.Object({
      added: Type.Array(Type.String()),
      modified: Type.Array(Type.String()),
      deleted: Type.Array(Type.String()),
      moved: Type.Optional(Type.Array(Type.Object({ from: Type.String(), to: Type.String() }))),
    }),
    async execute(_id, args, _signal, _update, ctx) {
      const result = await applyPatch(args.input, ctx.cwd);
      return { content: [{ type: "text", text: summary(result) }], details: result, structuredContent: result };
    },
  });
}
