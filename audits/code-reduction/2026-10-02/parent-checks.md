# Parent cross-area checks

Baseline: d80d7058a2f5481f067586fd7042fe2746cff4ae. Read-only audit.

- Searched src, integrations, scripts, .github, tests and package.json (excluding prose) for literal experiments/ references: none. This is evidence of isolation, not proof that every experiment is dead; standalone entrypoints still count.
- Searched the same areas for preview-v2, production-v2, remote-task-poc, remote-network-lab and remote-cli-experience. Output below. These names can occur in retained compatibility/config names, so check each hit.

```text
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "integrations/t3/**/*.ts", "tests/**/*.ts"]
}

```

- SHA-256 comparison found only three exact duplicate groups. See identical-files.json. Identical SSH fixture configs can be intentional Docker build inputs. Tiny exact duplicates are not the main savings opportunity.

## Extra compiler check

Ran bunx --no-install tsc --noEmit --noUnusedLocals --noUnusedParameters --incremental false. Exit 1 with 34 TS6133 unused-symbol diagnostics; no other diagnostic type. These flags are stricter than current project settings. This was not a failed product test. See unused-diagnostics.txt.

Do not delete every flagged item blindly. src/tasks/task-lifecycle.ts:40-60 intentionally retains the dlopen library handle in libc for process lifetime. That is a lifetime root even though no TypeScript reader accesses it. Keep unless Bun FFI ownership is proven otherwise. src/live/playback.ts:173,248 has unused rejection callback arguments; dropping argument names does not remove error handling or save meaningful lines. scripts/*.ts unused bindings can still have needed side-effectful initializers.

A narrow high-confidence cleanup is obsolete Codex/JWT scaffolding in tests/current-pipeline-sdk.test.ts:7,18,29-34, now that the scenario loop uses Anthropic at lines 45-46. Remove unused imports only after checking module side effects. This is small, not the main maintenance win.

## Live follow-up

Matched all 47 coverage records to the live manifest; reviewer reports all 7,754 lines read. Parent read the live ranked findings and independently read all 51 lines of src/live/transcript.ts. Search of src/tests/scripts/integrations confirms only tests/live-transcript.test.ts imports that module. Keep the mixed test file's TranscriptLog coverage. live-02 is a narrow high-confidence dead-code candidate (101 gross/net lines including only its obsolete tests/import). Other Live estimates remain review estimates, not tested deletion diffs.

## Remote and core follow-up

Parent diff confirms src/remote/ssh.ts and root-transport.ts differ in exactly three substitutions (type, exported function, control entrypoint). Repository code search confirms LocalCapabilities/allowOwnerGrant occur only in the implementation and tests/remote-capabilities.test.ts. registerRootRuntime has one production caller in src/agent/extension.ts. The remote-01 removal must retain readGrantedRepoFile and migrate unique real-store assertions.

Parent read all src/wisdom/extension.ts: its jobsChanged callback is literally async () => {}. This is code wiring, not deletion of wisdom/prose. Keep the actual /wisdom command and prompt hook. Searches confirm Herdr, cache countdown, conversation density, goals, and speaker-check are live product integrations, so none may be advertised as dead code. Their removal is an explicit feature choice.
