# Pi 1.0.3 host patch fixture

1.0.3-originals.json.gz contains a JSON path-to-text map of the nine pinned original files covered by scripts/pi-host-adaptation.ts. Recovery tests decompress this fixture and check every original SHA-256 before use. No node_modules reads, dependency install, or network are needed for the tests.

Fixture bytes were reconstructed in the recovery task's owned worktree by reversing existing host adaptations from inherited files (including the stale agent-session.js), and accepted only after each file matched its unchanged original SHA-256. This is exact fixture evidence, not proof of a real isolated installation. The tests generate the observed ef78c937779832d87a5a28bbd339e4c73e210d0b5da7ff570723f1d4313be876 stale variant by omitting its final host marker. No unknown source hash is added to production acceptance.

Upstream: @earendil-works/pi-coding-agent 1.0.3, MIT; see the repository's third-party notices. Compressed to avoid adding hundreds of kilobytes of generated dependency text to test source.
