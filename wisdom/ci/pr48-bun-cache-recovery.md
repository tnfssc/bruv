# PR #48 hosted Bun cache recovery

Run 37685931065 failed in Linux prepare:assets/typecheck with Unsupported Pi host file dist/core/session-manager.js. The failing job restored bun-1.4.2-Linux-X64-f7d5c51aa9dde1b3f84bff2a143ab3b4ad4800c17bb2039b71c167a576767809 through restore prefix bun-1.4.2-Linux-X64-.

The Pi-host atomic copy/rename writer from mainline prevents future writes from mutating hardlinked cache files. It cannot repair content already stored in the shared hosted cache. A fresh private Bun cache with the copy backend passed the merged build, typecheck, and 14 Pi-host tests. This isolates the observed failure to stale contaminated cache content; no source/result hash drift was needed.

CI and release now use the bun-download-v2-1.4.2- family for both exact keys and restore prefixes. This is a one-time cache namespace rotation. Bun version, runner OS/architecture, lockfile/package identity, and cached download path remain unchanged. The new restore prefixes cannot match the old family. No cache contents are deleted or silently repaired.

Focused workflow regression assertions cover CI and release cache keys, restore prefixes, path, and Bun version. No new value is needed; existing cache-isolation guidance covers this recovery.
