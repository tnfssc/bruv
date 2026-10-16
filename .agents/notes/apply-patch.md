# apply_patch (`src/patch.ts`)

## Why

GPT models are trained on Codex's `apply_patch` format and use it better than exact-text edits.
In Codex it is a freeform tool: the model writes the raw patch as the tool input, constrained by a
Lark grammar (`codex-rs/core/assets/tools/apply_patch.lark`, declared in
`codex-rs/core/src/tools/handlers/apply_patch_spec.rs`), not JSON and not code. bruv declares it
the same way, with Codex's grammar and description, so that is what the model writes.

It is registered with `exposure: "codemode"` and switched on for OpenAI models. Pi's
`codemode.mode: "only"` hides only callable `direct` tools, so the model sees `apply_patch` next
to `codemode`, and scripts can still call `tools.apply_patch({ input })` on any model. Putting it
only inside codemode was tried first: the model would have had to write the patch inside a
JavaScript string and escape backticks and `${`, which is not what it was trained to write.

No binaries are shipped; another package's Rust applier was looked at and not used.

## Choices

- Follows Codex `codex-rs/apply-patch`: same headers, `@@` chunks, `*** End of File`, heredoc
  wrapper accepted, and context matched exact, then ignoring trailing spaces, then trimmed, then
  with Unicode dashes, quotes and spaces made plain. A trailing blank context line that only
  separated hunks is dropped on retry, as Codex does.
- Differs from Codex on purpose:
  - Every hunk is checked in memory before any file is written. Codex writes as it goes.
    If a write still fails part way, the files already written are put back.
  - The file's final newline (or its absence), CRLF endings and BOM are kept. Codex always ends
    with `\n`.
  - A chunk with only `+` lines goes right after its `@@` line. Codex appends it to the end of
    the file whatever the `@@` line says. With a bare `@@` it still goes at the end.
  - A unified diff header (`@@ -1,3 +1,4 @@`) counts as a bare `@@`.
- `Add File` on an existing file replaces it, as in Codex.
- All files a patch touches take their turn in Pi's `withFileMutationQueue`, sorted by real path
  so two patches cannot wait on each other, and so a symlink and its target take one turn.
- Content is the Codex summary text (`A`/`M`/`D` lines) the models know; scripts get
  `{ added, modified, deleted, moved? }`.
- Nested call rows show the patched file names (`src/render.ts`).
