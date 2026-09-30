# Same-workspace packed web reuse

Read with [input/provenance audit](ci-broad-fast-path.md) and [timing audit](ci-speed-timing-audit.md).

## Command interface

1. Run existing fresh producer: `bun run build` (web plus first CLI) or `bun run build:web` (web only).
2. Every additional target: `bun scripts/build.ts --reuse-packed-web --target=bun-linux-x64 --outfile=dist/die-linux-x64`. Other target strings and optional `--live-helper=...` work unchanged.
3. No bootstrap copy, chunk recheck, or packing in compile-only mode. Target/outfile/native helper are CLI inputs, not web payload inputs.

`--reuse-web` deliberately retains previous chunk verification/bootstrap copy/repack behavior. It invalidates the producer receipt; it cannot confer fresh producer validation. Combining the two reuse flags is an error. Normal builds remain fresh, invalidate receipts before work, and record a new receipt only after successful source/type/chunk/portable-dependency checks and packing.

## Boundary and inputs

`dist/die-web.archive.manifest.json` is an atomic local receipt, **not a remotely restorable cache or signature**. Consumers verify archive digest AND byte size independently of mutable `dist/die-web`; staging dist may be removed without affecting reuse. Missing/changed archive or receipt, unknown receipt schema/producer, future timestamp, age over 12 hours, changed workspace/source locator/pin/patch/bootstrap/producer/verifier/packer/lock/toolchain/environment fail closed with fresh-producer instructions.

Identity covers canonical real workspace/source paths, exact source HEAD plus verified HEAD+patch content, resulting source tree (including ignored env/config files, permissions and file symlink identities), all integrations/t3 code and verification tests, reuse helper, packer, root package/lock/tool pin, Bun/Node/pnpm versions, producer platform/arch, installed pnpm lock/modules metadata, and a digest of inherited environment. Environment values (possibly secrets) are never written into the receipt. Explicit npm lifecycle metadata (not npm_config install/build settings)/INIT_CWD/source locator/shell location/PATH and GitHub per-step output-file plumbing are normalized away; tool versions and other environment are checked. Generated dist/node_modules/.git/.turbo directories are excluded from source-tree hashing.

Scope is a **trusted same-workspace frozen-install build**, with sequential preparation followed by read-only consumers. Do not restore receipts/archives from another run or machine, modify installed dependency code, reinstall dependencies between targets, or overlap a fresh/repack writer with consumers. Installed package file bytes are not a hostile-cache attestation: lock/modules metadata represents the trusted install. This deliberately does not implement remote artifact origin validation. Additional targets can read the immutable archive concurrently after the producer finishes; they do not mutate the shared payload.

## Proof and remaining measurement

19 focused tests pass (16.77s, Bun 1.4.2), plus targeted CLI-key/installation-environment regressions. Tests exercise production payload dispatcher: one real pack, four compile-only target selections with fresh/repack callbacks that fail if called, identical archive bytes and unchanged archive mtime, even after staging dist removal. Mutation tests cover archive, missing/expired/malformed/foreign receipt, pin/patch/bootstrap/build/packer/helper/lock/tool pins, patched source and truly ignored .env.local, installed metadata and environment; legacy repack invalidates receipt before failure. A native Bun-compiled smoke embeds the fixture archive, runs the executable, and checks its embedded digest. This is not full release/browser proof or four actual cross-compiled CLI binaries. Typecheck passes after preparing runtime assets from existing root dependencies (no installation).

Prior hosted measurements suggest eliminating three ~17s packs saves ~50s. No new hosted/full-payload timing claim here: measure hash/source-validation overhead and release target timings in the workflow owner next approved run. No workflows or scripts/ci.sh edited. No publish/push/dispatch/install.

Values unchanged: existing truth-of-proof, input ownership, and leave-work-pickup values cover the lesson; this is a local recipe, not a new general value.

## Future exact-key trusted restore owner

`packedWebInputKey(root)` is exported by scripts/packed-web.ts and recorded as manifest.inputKey. It hashes versioned web content/tool/environment identity without workspace/source locator paths; CLI src edits and repository HEAD changes do not change the payload key. The current `--reuse-packed-web` consumer still enforces same-workspace source paths, receipt age and identical inputs. A trusted restored-archive lane must independently authorize origin, then adapt that local context boundary; this patch does not authorize remote restores or add workflow caches. Full inherited environment identity is conservative (including CI run identity), so this key is not yet a cross-run hit optimization; normalize a deliberately owned reproducible producer environment before enabling remote reuse. Missing/corrupt restored identity should send the workflow owner to the ordinary fresh producer, never silently embed bytes.

Local /tmp filled during the added CLI-key check; reran targeted checks under workspace .cache TMPDIR rather than deleting unrelated files. Parent review requested retaining npm install settings; exclusion now names lifecycle/package identity/execpath/user-agent/local-prefix metadata explicitly, not all npm_* variables.
