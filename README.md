<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="site/assets/brand/bruv-wordmark-light.svg">
    <img src="site/assets/brand/bruv-wordmark.svg" width="318" height="113" alt="bruv — custom cut-corner wordmark">
  </picture>
</p>

# bruv CLI

An opinionated coding agent. Built on [Pi](https://pi.dev).

Want a graphical frontend? Follow the [illustrated T3 Code setup guide](docs/t3-code/README.md).

## Install

```sh
curl -fsSL 'https://raw.githubusercontent.com/tnfssc/bruv/develop/scripts/install.sh' | sh
```

Supports Linux x64/arm64, macOS Apple Silicon, and Android Termux arm64 (API 28+).
Requires curl and either sha256sum or shasum.

The pair contains one compiled `bruv` binary and a small POSIX
`bruv-claude-compat` launcher. Keep them together. The launcher needs `/bin/sh`
on Linux/macOS or `/system/bin/sh` on Android. The Android binary runs natively
with `/system/bin/linker64`; no Bun, Node, glibc or proot runtime is needed.

The [installer](https://github.com/tnfssc/bruv/blob/develop/scripts/install.sh)
downloads Bruv and its matching `bruv-claude-compat` connector from one release,
verifies both executable checksums, and installs them in `~/.local/bin`.
Licenses and notices go in `~/.local/share/bruv/notices/<version>`.
It does not use sudo, edit shell profiles, or install T3.
Stop active Bruv/T3 sessions before replacing the pair.

Put `~/.local/bin` on your PATH, then start Bruv in your project:

```sh
bruv
```

Configure your provider with `/login` and choose a model with `/model`.
Credentials and model access come from your provider; they are not included.

### Updates

```sh
bruv update --check           # Check without changing files
bruv update                  # Update the sibling CLI and connector together
```

Stop active sessions first and restart afterward. Split/custom binary layouts
need a manual paired reinstall. External T3 updates separately with `t3 update`;
check its [accepted version and setup](wisdom/claude-compat/external-t3-setup.md)
before updating.

## What makes it opinionated

The [bundled guidance](src/prompts/system.md) tells the agent to act on clear
requests, try a small check instead of guessing what is unavailable, and report
what it actually found. It favors a simple working change over speculative
fallbacks, while keeping security and data-loss protections. Old behavior is
kept when you ask for it, rather than carried forward by default.

Project wisdom keeps decisions with the code. Agents read `wisdom/values.md`
before large changes and leave reasons, checks, and next steps in feature notes.
Set `wisdomDir` in `.bruv/settings.json` to use another directory; `/wisdom`
shows the resolved path. See [project wisdom](wisdom/wisdom-system/project-wisdom.md).

## Added to Pi

- Background jobs and subagents let the agent hand off work and collect results.
  Tasks can share a checkout or use a [separate Git worktree](wisdom/worktrees/subagent-workspaces.md).
- `/questions` keeps human decisions in a conversation inbox. `/remote` connects
  to human-authorized SSH targets and opens their separate task/question inbox.
  Remote state can be read offline; answering needs a fresh connection.
- Live voice shares the terminal session's tools and history. `/live` starts it,
  `/live model` selects a voice, and `/live setup` checks credentials.
- [Herdr integration](wisdom/integrations/herdr.md) reports working, idle, and
  waiting-for-input state when Bruv runs in a Herdr terminal pane. Herdr is optional.

Inside Bruv, type `/` to see available commands. In question menus, type to
search, use arrows and Enter to select, and Escape to go back. Local questions
are answered through `/questions`; remote-owned questions through `/remote`.

## Common commands

```sh
bruv                         # Start the interactive terminal
bruv -p "Describe this tree"  # Run one prompt and exit
bruv -c                      # Continue the latest session
bruv -r                      # Pick a saved session to resume
bruv web                     # Show external T3 setup guidance
```

## Live voice setup

macOS Apple Silicon releases include the native audio helper. Linux currently
requires a separately built helper. Live uses same-host audio, not browser
microphone transport, and sends audio to the selected provider with possible
API charges.

Gemini and OpenAI Realtime use session tools directly. GPT-Live (`gpt-live-1`)
uses your selected coding agent as its backend. `/live provider` configures
credentials without changing the voice model; model labels indicate local
credential readiness, not verified access. OpenAI Live needs an OpenAI API key;
Codex OAuth alone is not sufficient. Keep keys out of chat.

`/live stop` ends voice, not jobs. Speech interruption does not cancel work;
ask explicitly to stop work. GPT-Live transcripts are provisional, and ambiguous
requests may need clarification. For device checks, use `/live status`,
`/live mic-check`, or `/live speaker-check`. Checks ask before opening devices;
they do not connect to Google. `bruv --live-self-test` checks the embedded helper
without opening devices. See [Live onboarding](wisdom/live/cli-live-onboarding.md).

## External T3 frontend

Install official T3 separately and launch it normally. Add a separate **Claude
protocol** instance named **Bruv**, with the absolute connector binary path,
an isolated SDK history home field and exact custom Bruv model IDs. Auth defaults
to `~/.bruv/agent`, shared with ordinary Bruv; SDK history is distinct.
Do not change parent/global `CLAUDE_CONFIG_DIR` or use Claude login/updater.
`bruv web` only prints guidance, without installing T3 or rewriting settings.

Official **v0.0.46-nightly.20261004.2644** lacks the provider-scoped SDK history
fix: basic chat may work, but native fork can fail before Bruv starts.
After Stop, **Decline** any stale approval card before continuing.
See the [illustrated setup guide](docs/t3-code/README.md) for steps and limits.

## Build from source

Install Bun 1.4.2, then:

```sh
git clone https://github.com/tnfssc/bruv.git
cd bruv
bun install --frozen-lockfile
bun run check
bun run build
```

The build compiles `dist/bruv` once and writes the small executable
`dist/bruv-claude-compat` launcher beside it. The connector reports
`2.1.280 (Bruv compatibility; bruv <product>)` for `--version`; use
`--bruv-version` for the product version and paired packaging/update checks.
During an older updater’s private `.bruv-update-*` staging probe only, the
canonical launcher’s exact `--version` call retains the old truthful
`bruv-claude-compat <product>` response. After installation it uses the SDK-facing
compatibility identity above; new packaging/update checks use `--bruv-version`.

Install your local build:

```sh
bun run install:local
```

## Website

The static landing page lives in `site/`. See [the site README](site/README.md)
for local preview, content and demo edits, tests, and static hosting/Vercel setup.

## State and technical docs

State lives under `~/.bruv`. CLI sessions/configuration use `~/.bruv/agent`;
external T3 owns `~/.bruv/web/userdata` and SDK transcripts use
`~/.bruv/claude-compat-sdk`. Project prompts live in `.bruv/`;
app environment overrides use `BRUV_*`.

Existing `~/.die` data is not read or migrated. Bruv does not rename or remove
the old executable; old `die update` versions still expect old asset names.

- [Resource limits](wisdom/resources/resource-limits.md): output capture,
  truncation, and cache ownership. Original session history is not deleted.
- [Question inbox implementation](wisdom/questions/interactive-inbox-work.md)
  and [CLI surface](wisdom/questions/cli-surface-audit.md).
- [Project wisdom](wisdom/wisdom-system/project-wisdom.md),
  [worktree setup](wisdom/worktrees/subagent-workspaces.md), and
  [feature notes](wisdom/).

### Maintainer releases

On GitHub: **Actions → Release → Run workflow → develop → Run workflow**.
The workflow prepares the next patch unless a newer stable version is ready,
runs the native/build/updater/licensing gates, then publishes assets from the
exact tested commit. The Actions bot needs permission to push develop and tags.
Check that **Publish** succeeds; a preparation commit alone is not a release.
See [manual release recovery](wisdom/releases/manual-release-dispatch.md).

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependencies.
