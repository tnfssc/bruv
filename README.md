# bruv CLI

A coding agent built on [Pi](https://pi.dev). The normal CLI gives you a terminal interface, Herdr integration, background jobs, sub-agents, and project wisdom. A separate native connector pairs it with external, unmodified T3 Code.

The product is **bruv CLI**, and the command is `bruv`. The GitHub repository is
[`tnfssc/bruv`](https://github.com/tnfssc/bruv). Release assets use `bruv-*`.

## Install

Release assets ship normal bruv and bruv-claude-compat together. Use
[Build from source](#build-from-source) until the accepted paired release is
available; older releases may not contain the connector.

Linux x64/arm64, macOS Apple Silicon, and Android Termux arm64:

Stop active Bruv/connector sessions before replacing executables. Install the
matched pair from one release, including both checksums and notices:

~~~sh
set -eu
os="$(uname -s | tr A-Z a-z)"
if [ "$(uname -o 2>/dev/null || true)" = Android ]; then os=android; fi
arch="$(uname -m | sed s/aarch64/arm64/ | sed s/x86_64/x64/)"
asset="bruv-$os-$arch"
connector="bruv-claude-compat-$os-$arch"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
url="https://github.com/tnfssc/bruv/releases/latest/download"
for name in "$asset" "$connector"; do
  curl -fLO "$url/$name"
  curl -fLO "$url/$name.sha256"
  (sha256sum -c "$name.sha256" 2>/dev/null || shasum -a 256 -c "$name.sha256")
  chmod 755 "$name"
done
for name in LICENSE THIRD_PARTY_NOTICES.md THIRD_PARTY_LICENSES.txt SOURCE.txt; do
  curl -fLO "$url/$name"
done
# Only these version probes use a temporary home, never the running T3 backend.
version="$(HOME="$tmp/probe" "./$asset" --version)"
test "$(HOME="$tmp/probe" "./$connector" --version)" = "bruv-claude-compat $version"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/bruv/notices/$version"
install -m 755 "$asset" "$HOME/.local/bin/bruv"
install -m 755 "$connector" "$HOME/.local/bin/bruv-claude-compat"
install -m 644 LICENSE THIRD_PARTY_NOTICES.md THIRD_PARTY_LICENSES.txt SOURCE.txt "$HOME/.local/share/bruv/notices/$version/"
~~~

Put ~/.local/bin on PATH, then run bruv. This does **not** install T3.
`bruv update --check` is read-only; `bruv update` updates the sibling CLI and
connector together. Split/custom layouts need manual paired reinstall. Stop
active Bruv/T3 sessions first and restart afterward. External T3 updates
separately with `t3 update`, subject to renewed native acceptance. See
[external T3 setup](wisdom/claude-compat/external-t3-setup.md).

## Common commands

```sh
bruv                         # Start the interactive TUI
bruv web                     # Show external T3 setup
bruv -p "Describe this tree" # Run one prompt and exit
bruv -c                      # Continue the latest session
bruv -r                      # Pick a saved session to resume
```

Inside `bruv`, type `/` to see available commands.

## Questions and remote work

In the terminal, `/questions` opens the current conversation’s question inbox.
`/remote` opens the SSH remote-work inbox, including questions from remote tasks.
These are separate owners: a remote task’s question is answered through `/remote`,
not the local `/questions` inbox.

Type to search a menu, use arrow keys and Enter to select, and Escape to go back
without submitting. PgUp/PgDn scroll long question or choice text.
Questions offer their saved choices and, when allowed, a
custom-answer editor. Command completion also supports explicit `/remote`
subcommands and task/question targets; copying IDs is not required for the menus.

Remote cached state remains readable offline. Answering requires a fresh owner
and question version. An uncertain reply is not a confirmed answer: reconcile
the saved reply rather than replacing it with a new one. Explicit commands and
the noninteractive RPC interface remain available.

## Project wisdom

Project wisdom defaults to `wisdom/` at the project root. Set one field in
`.bruv/settings.json` to use another directory:

```json
{
  "wisdomDir": "docs/agent-notes"
}
```

Merge the field into existing settings. Relative paths start at the project root,
not the current shell directory. `/wisdom` reports the resolved location; agent
guidance points to that same directory and its `values.md`. This only changes
where agents look and write: it does not create or move files. See
[project wisdom](./wisdom/wisdom-system/project-wisdom.md) for scope and workspaces.

## Subagent workspaces

Subagents share the current checkout by default. Work that needs isolation can use a separate Git worktree and branch. The configured setup runs there. CLI worktrees do not need the web server. See [subagent workspaces](./wisdom/worktrees/subagent-workspaces.md) for the API and retention behavior.

## Herdr integration

Run bruv in a Herdr-managed terminal pane and it automatically reports whether it is working, idle, or waiting for input. Background jobs and sub-agents keep the pane marked as working even after the foreground turn ends.

The integration is built in. It needs no extra extension or setup. Herdr is optional. Bruv also works on its own. See [Herdr integration](./wisdom/integrations/herdr.md) for lifecycle and compatibility details.

## External T3 web frontend

`bruv web` prints setup guidance without downloading T3 or rewriting settings.
Install unmodified T3 separately. Pin the tested official
**v0.0.46-nightly.20261004.2644**; old 2623 is not an acceptable target. Add a separate
Claude protocol instance pointing to the absolute `bruv-claude-compat` binary, select exact Bruv provider/model IDs,
and align parent server SDK `CLAUDE_CONFIG_DIR` with the isolated instance home.
Claude is a protocol label, not an Anthropic account or verified access.
See [external T3 setup](wisdom/claude-compat/external-t3-setup.md) for real paths,
auth/resource sharing and paired updates. 2644 passes bounded native gates, not
full parity; its upstream Effect race remains unfixed. Stop leaves a stale approval
card requiring explicit **Decline**. Version/update banners remain honest warnings.
Live is same-host opt-in audio, **not browser microphone transport**.

## Build from source

Install Bun 1.4.2, then run:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

Install your local build:

```sh
bun run install:local
```

## Maintainer release

On GitHub (including mobile): **Actions → Release → Run workflow → develop → Run workflow**. No version input is needed: the workflow uses latest develop, prepares the next patch version and notes unless a newer stable version is already prepared, runs the native/build/updater/licensing gates, then publishes the checked assets from the exact tested commit. Check that the **Publish** job succeeds; a preparation commit alone is not a release. Requires the Actions bot to have permission to push develop and tags. Failed gates leave an untagged preparation commit; see [manual release recovery and limitations](wisdom/releases/manual-release-dispatch.md).

## Project wisdom

- Released binaries currently support Linux x64/arm64, macOS Apple Silicon, and Android Termux arm64.
- Credentials and model configuration are supplied at runtime, like Pi.
- State is stored under `~/.bruv`. This is a fresh namespace: existing `~/.die` data is untouched and is not automatically migrated or read.
- CLI sessions/configuration stay at `~/.bruv/agent`. External T3 owns
  `~/.bruv/web/userdata`; SDK transcripts use `~/.bruv/claude-compat-sdk`.
  No web runtime is bundled or extracted. Project prompt files live in `.bruv/`;
  app environment overrides use `BRUV_*`.
- Install bruv separately from die. The old executable is not renamed or removed; old `die update` versions still expect old asset names.
- See `wisdom/` for durable project context and deeper feature notes.

## Resource limits

Bruv limits stored job output, execute capture, and persistent session-body caching. It does not delete original session history. See [resource limits](./wisdom/resources/resource-limits.md) for defaults, truncation semantics, storage ownership, and web shutdown behavior.

## Live voice

The native helper is included in macOS Apple Silicon builds. Linux Live currently requires a separately built helper; Linux releases do not bundle it.

Type `/live` in the local terminal to start talking; type it again to stop. Choose any supported voice with `/live model` (the provider follows the model); `/live provider` configures provider credentials without changing the voice model. Model labels show local credential readiness, not verified provider access. Gemini and OpenAI Realtime use the session’s tools directly. GPT-Live (`gpt-live-1`) is a voice frontend paired with your selected coding agent in the same session, retaining its model settings, tools, permissions, and history. Typed and spoken work share that coding backend. Starting Live sends audio to the selected provider and may incur API charges.

Use `/live setup` to check provider credentials. OpenAI Live requires a configured OpenAI API key; Codex OAuth alone is not sufficient. Keys stay out of chat. `/live stop` ends voice, not your agent’s jobs. Speech interruption does not cancel work; ask explicitly to stop work. GPT-Live speech transcripts remain provisional, and ambiguous requests may require clarification.

For troubleshooting, use `/live status`, `/live mic-check`, or `/live speaker-check`. The checks ask before opening devices and do not connect to Google. The speaker check plays a short test sound; it is not proof that speech echo or interruptions work on every route. `bruv --live-self-test` checks the embedded helper without opening devices.
