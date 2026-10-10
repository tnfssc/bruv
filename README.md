# bruv

bruv is a Pi package for working on code with scripting, background work, subagents, and goals. The rewrite currently adds prompt guidance and codemode setup; the other features come in later phases.

## Install

```sh
# Install Pi (see https://pi.dev), then:
pi install git:github.com/tnfssc/bruv
pi            # then /bruv-setup once
```

For development: `pi install /path/to/bruv/checkout`.

## Coming from bruv 0.x

- Sign in again with `/login` in Pi, or copy `~/.bruv/agent/auth.json` to `~/.pi/agent/auth.json`.
- Old sessions under `~/.bruv/agent/sessions` are not migrated.
- Move `~/.bruv/subagents.json` profiles to `~/.pi/agent/bruv.json` using the format in `docs/REWRITE.md`, section 3.7.
- In T3, enable the Pi provider with binary `pi` and disable the "bruv (not Claude)" provider.
- Remove `~/.local/bin/bruv` and `~/.local/bin/bruv-claude-compat`.

More docs coming.
