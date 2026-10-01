# v0.15.15 release

The user said "release" after the Codex checkpoint-switch fix passed full CI36817970940. This authorizes a fresh Release workflow from develop, not a rerun of failed run36813685812 with its old source.

Version0.15.15 was prepared but never published. prepare-manual-release.ts keeps a prepared version above the latest stable tag (v0.15.14). Refresh its old generated notes to describe the shipped result, not reverted experiments. The new source includes checkpoint fixd99f8e9 and Release environment fixture fix82cdcff.

Next: push notes, dispatch release.yml on develop, save run ID, await all gates, then check the public release and assets. Do not download binaries just to recheck hashes; see release-verification-preference.md. No device or paid model probe is part of this release request.

Values unchanged for release execution. The checkpoint work already refined value2: local guard tests do not prove an upstream limit. The release uses existing proof-scope and publication guidance.
