# bruv

https://github.com/user-attachments/assets/15b3eb18-e5eb-438e-9a76-d6f118d39bf3

**Talk to your coding agent.** Type `/voice` and talk. bruv answers out loud, puts what's better seen on
your screen, and stops the moment you talk over it. Use it from your terminal, or from your phone anywhere.

Your words are recognised on your machine. With an OpenRouter key, bruv speaks with Fish Audio Drama 3, which
sounds like a person thinking aloud, for about 10¢ an hour of talk; without one, it speaks on your machine for
free. bruv runs inside [Pi](https://pi.dev), an alternative to the Codex CLI, with your
ChatGPT plan or any model Pi supports.

- **Talk, don't type.** `/voice` turns it on in your terminal; replies are spoken as they stream. Talk over a reply to cut in, or keep working while it talks.
- **It shows you things.** Charts, pages, pictures and video appear in your terminal and on the voice page, with a link to open them.
- **Take it with you.** `/voice web` opens the same session in your browser; `/voice tunnel` puts it on your own domain through Cloudflare and shows a QR code to scan with your phone. Hold the button to talk, or tap it for hands-free.
- **It finishes.** GPT runs don't stop halfway. A fresh agent checks the work against what you asked, and you get a receipt.
- **Don't wait on one thing at a time.** Run tests in the background while agents investigate bugs or build separate parts in their own copies of your repo.
- **Keep what the team learns.** bruv reads and writes the project's notes in `.agents/notes/`: choices, reasons, what was tried. They're shared through git, and the next session starts from them.
- **Do more per turn.** The model can read files, make edits, and run checks in one script, filtering long logs before they fill the conversation.

## Get started

One command installs [Pi](https://pi.dev) if you don't have it, then adds bruv:

```sh
curl -fsSL https://bruv.sharath.page/install.sh | sh
```

Already have Pi? `pi install git:github.com/tnfssc/bruv` does the same.

Inside Pi, use `/login` to sign in to your model provider.
Run `/bruv-setup`, confirm, then `/reload`. Then type `/voice` and start talking.

### Talk to it

```text
/voice          talk here, with this machine's microphone and speaker
/voice web      open the same session in your browser
/voice tunnel   serve it on your own domain, for your phone
/voice          again, to turn it off
```

The first `/voice` asks before downloading the speech models (about 800 MB). Use headphones in the terminal:
nothing cancels the speaker's echo there; the browser page does. A phone needs https, which `/voice tunnel`
gives you with a Cloudflare token and a host name. See [Voice](docs/USAGE.md#voice).

### Give it the whole job

![A real bruv run, sped up: it works through an app, a fresh agent finds two gaps, they get fixed, and a receipt appears](site/assets/done.gif)

```text
/goal Add CSV export --criteria "handles empty data; tests pass"
```

The agent keeps going between turns instead of waiting for another prompt. A reply halfway through no longer
ends the run: the model writes its answer and calls `finish`. When files changed, a fresh check tries the result
before accepting done, and the terminal receipt lists the request, checks, remaining gaps, changed files, time
and usage. `/keep-going on|off|auto` and `/check on|off` change this. You can set a token budget, pause the goal,
or stop it at any time; it also stops if it repeatedly hits the same blocker.

### Stay in the loop, not in the way

Watch live jobs and agent progress in the terminal. Talk or send a message to steer the work, or press Esc to stop it.
`/usage` shows ChatGPT plan limits and session usage; `/fast` opts into faster OpenAI/Codex responses at the cost of more quota.
Parallel agents use more quota too.

**Using T3 Code?** Enable its Pi provider and set the binary to `pi`. No launch arguments needed.

## Commands

`/voice` · `/keep-going` · `/check` · `/goal` · `/review` · `/import-codex` · `/usage` · `/fast` · `/notes` · `/ps` · `/subagents` · `/bruv-compact` · `/bruv-setup` · `/bruv-migrate`

Coming from Codex? `/import-codex` previews your model, MCP servers, skills, prompts and trusted projects, then asks before importing. Sign in to Pi with `/login`; Codex sign-in tokens stay separate.

## Reference

[Commands and examples](docs/USAGE.md#commands) ·
[Agent configuration](docs/USAGE.md#configuration) ·
[Background work and stopping](docs/USAGE.md#how-background-work-behaves) ·
[Tools](docs/USAGE.md#what-the-model-can-call-from-scripts)

## Coming from bruv 0.x

Run the install command above. The command you used for 0.x does the same thing now:

```sh
curl -fsSL https://raw.githubusercontent.com/tnfssc/bruv/develop/scripts/install.sh | sh
```

It installs Pi if needed, adds bruv, and offers to turn your `bruv` command into one that starts Pi.
The old binaries move to `~/.bruv/0.x`. Then start `bruv` and run `/bruv-migrate`. It lists what it will
bring over and asks first: your sign-in, model, thinking and theme settings, agent models from
`subagents.json`, and sessions for folders that still exist (open them with `/resume`). Nothing in
`~/.bruv` changes.

In T3, turn on the Pi provider (binary `pi`) and turn off "bruv (not Claude)".

## Development

```sh
bun install
bunx biome ci . && bunx tsc --noEmit && bun test
pi install /path/to/checkout
```

Local installs load directly from the checkout. Read [AGENTS.md](AGENTS.md) and the notes in [.agents/notes/](.agents/notes/) before changing a module.
