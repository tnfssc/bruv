# bruv

**GPT models keep going until the work is done or they need you.**

A reply halfway through no longer ends the run: the model writes its answer and calls `finish`.

Give it a goal, let agents work in parallel, and come back to results—not another request to continue.
bruv runs inside [Pi](https://pi.dev), an alternative to the Codex CLI, not a plugin for it.

- **Keep working without “continue.”** GPT runs keep going by default. `/keep-going on|off|auto` changes this; `/goal` adds an objective, evidence and an optional token budget.
- **Don't wait on one thing at a time.** Run tests in the background while agents investigate bugs or build separate parts in their own copies of your repo.
- **Do more per turn.** The model can read files, make edits, and run checks in one script, filtering long logs before they fill the conversation.

## Get started

Install [Pi](https://pi.dev), then add bruv:

```sh
pi install git:github.com/tnfssc/bruv
pi
```

Inside Pi, use `/login` to sign in to your model provider.
Run `/bruv-setup`, confirm, then `/reload`. You're ready to work.

### Give it the whole job

```text
/goal Add CSV export --criteria "handles empty data; tests pass"
```

The agent keeps going between turns instead of waiting for another prompt.
You can set a token budget, pause it, or stop it at any time. It also stops if it repeatedly hits the same blocker.
Completion evidence is the agent's report, not a substitute for reviewing the code.

### Stay in the loop, not in the way

Watch live jobs and agent progress in the terminal. Send a message to steer the work, or press Esc to stop it.
`/usage` shows ChatGPT plan limits and session usage; `/fast` opts into faster OpenAI/Codex responses at the cost of more quota.
Parallel agents use more quota too.

**Using T3 Code?** Enable its Pi provider and set the binary to `pi`. No launch arguments needed.

## Commands

`/keep-going` · `/goal` · `/review` · `/import-codex` · `/usage` · `/fast` · `/bruv-setup`

Coming from Codex? `/import-codex` previews your model, MCP servers, skills, prompts and trusted projects, then asks before importing. Sign in to Pi with `/login`; Codex sign-in tokens stay separate.

## Reference

[Commands and examples](docs/USAGE.md#commands) ·
[Agent configuration](docs/USAGE.md#configuration) ·
[Background work and stopping](docs/USAGE.md#how-background-work-behaves) ·
[Tools](docs/USAGE.md#what-the-model-can-call-from-scripts)

## Coming from bruv 0.x

- Sign in again with `/login` in Pi, or copy `~/.bruv/agent/auth.json` to `~/.pi/agent/auth.json`.
- Old sessions under `~/.bruv/agent/sessions` are not migrated.
- Move `~/.bruv/subagents.json` profiles to `~/.pi/agent/bruv.json` ([format](docs/USAGE.md#configuration)).
- In T3, enable the Pi provider with binary `pi` and disable the "bruv (not Claude)" provider.
- Remove `~/.local/bin/bruv` and `~/.local/bin/bruv-claude-compat`.

## Development

```sh
bun install
bunx biome ci . && bunx tsc --noEmit && bun test
pi install /path/to/checkout
```

Local installs load directly from the checkout. Read [docs/REWRITE.md](docs/REWRITE.md) before changing a module.
