# Model text, one voice

User asked for one subagent per line we send to the model. Read [value-based prompting](writing-without-clutter.md#value-based-prompting) first. Short words. Short sentences. Plain talk. Say what matters and why. Leave room for judgment.

## Scope and coverage

Our prompt templates, tool descriptions, schema help, injected notices, model-facing errors and output framing. User text, external tool data, wire keys, API names and upstream package prose stay as they are. Arbitrary files an agent might read are not shipped prompt copy.

Each owner used a worktree. Each line got a read-only fast child. Owners fit the proposals together; parent read the merged prompts again. Final manifests have 1,221 rows with 1,221 distinct line job IDs. Rate-limited attempts were retried. All returned. Some rows were extra syntax, dormant templates or later exclusions.

| Slice | Reviewed rows | Active model rows | Rewrites | Note |
| --- | ---: | ---: | ---: | --- |
| Templates | 169 | 143 | 33 | [Templates](line-pass-templates.md) |
| Agent, tasks, goals, session | 233 | 233 | 18 | [Runtime](line-pass-agent-tasks.md) |
| Live | 26 | 26 | 10 | [Live](line-pass-live.md) |
| Remote | 484 | 475 | 34 variants | [Remote](line-pass-remote.md) |
| Compat and T3 | 82 | 82 | 10 | [Compat](line-pass-compat-t3.md) |
| Tools | 182 | 182 | 10 | [Tools](line-pass-tools.md) |
| Audit gaps | 45 | 45 | 9 | [Gaps](line-pass-gaps.md) |

[Boundary trace](line-pass-boundaries.md) found no more shipped prose in src/ui or native helpers. UI rows carry caller data. Native error prose is dropped. No tracked skill source is auto-loaded here.

A separate coverage audit found more return paths. Its heading said 40 locations; its tables list 44, with 45 text variants. [Gap review](line-pass-gaps.md) covered all 45 with distinct workers. Most are Live shutdown errors returned by live.stop(), not only UI callbacks. Job helper errors and goal-field labels also add text. Gap commit 0c324db is integrated as 2f43c66b. No known supplied audit gaps remain. This is source/sink coverage, not a capture of every possible provider payload.

There are 124 accepted rewrite decisions across the slices. Counts include emitted variants, not just physical source edits.

## Choices that matter

- Tool facts are not optional values. Kept exact signatures, limits, IDs, permission ownership, retry identity and data-loss facts.
- Shorter can change meaning. Whole-prompt review restored simple design rather than “less care,” speculative test matrices rather than tests in general, and showing sources rather than only finding them.
- A UI-looking error can reach the model through a stop report. Follow the full return path before excluding it.
- Root assembled prompt shrank from 14,965 to 14,057 characters. Root, fast, normal, orchestrator and goal captures keep the tool schemas unchanged. Preview does not cover every runtime notice, handoff or compaction path.

Values unchanged. Values 8 and 10 already cover plain voice, purpose over rules and checking that the pieces fit. This pass applies those values. It does not need another one.

## Checks and limits

Final merged rebuild, typecheck and format checks pass. Final prompt, Live and native-delivery run: 231 pass, 0 fail across 14 files. Diff whitespace check passes. Five missed wording assertions were fixed without weakening behavior checks.

Combined suite: 3,084 pass, 31 skip, 73 fail, one error. Not green. Read-only triage reproduced 42 failures from existing manual-shake/disk-manager install order; reverse order passes. Both source files match base. Other failures came from old wording, timing, full /tmp, long tmux paths and temporary-directory assumptions. Five history-runner failures and one blank-frame TUI failure lacked a fully proved cause in that run.

Fresh processes checked fifty affected/failing test files. Forty-six files pass at their default budget: 544 tests. Three slow fixture files pass with a 30s runner budget: 37 tests. No source timeout or assertion was weakened. The remaining untouched tui-harness demo auto-kill timing check still fails. No full-suite green claim. SDK-wrap, wisdom-location, interactive questions and execution-preview checks pass in the fresh reruns.

/tmp tmpfs was full. Kept other work alone. Git signing used TMPDIR=$PWD/.tmp/git-tmp. Most evidence stays in worktree .tmp/. Test fixtures that need no parent project or short Unix-socket paths use the exact owned root /var/tmp/bp-kzhQSd. A worktree-local temp root changes the wisdom-location test's parent lookup. Never clean arbitrary shared temp data to make tests pass.

## Where to pick up

Parent: /home/tnfssc/.t3/worktrees/bruv/t3-6c093fbb, branch t3/6c093fbb. Base: de874ac98e53dadc1117e4ba6cd0bcf306a81dc2. Owner notes list their worktrees and branches. All owner commits are integrated. Final meaning, format and assertion fixes go in the same local commit as this note. No push, PR, release or installed binary change.

Line inputs, IDs and decisions stay in each owner's ignored .tmp/prompt-line-review/<slice>/ folder. Parent copy: .tmp/prompt-line-review/final/all-lines.json. Coverage audit, test triage, prompt captures and check logs sit beside it. Install-order probes live in .tmp/prompt-line-review/research/.

Prompt work and its focused checks are complete. Broader test failures remain as described above; do not call the full suite green. No release or push was requested. For later test-suite repair, use a new task and worktree.
