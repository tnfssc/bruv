# v0.15.28

## Readable task names and project wisdom location

- Keep readable task names through launch, completion and resume. Background shell rows use their execute label when available; unnamed agents use a short prompt preview. Old tasks can recover names from saved typed metadata without changing task identity or outcome.
- Add one project setting: `wisdomDir` in `.bruv/settings.json`. It defaults to `wisdom`; relative paths start at the project root. `/wisdom` and agent guidance use the same location and `values.md` path. No files are moved automatically.
