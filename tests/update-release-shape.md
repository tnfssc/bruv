# Raw paired release updater fixture

Run: `bun test tests/update-release-shape.test.ts` (Bun >= 1.4.1). This tests
current Bruv paired update with synthetic raw binary/checksum assets at canonical
URLs, fake fetch and temporary install targets. No network, provider, mic,
global installation or publication is required. Targets are never the executing
process. The version/helper runner is injected for synthetic cross-platform bytes.

Fixture preflight checks format magic and an embedded 0.8.0 label. The updater
checks both hashes, asset names and staged version responses; its default runner
executes both --version probes and the existing macOS helper self-test. These raw
fixtures do not prove actual release binaries boot on any platform. Actual staged
probe execution is covered separately in update.test.ts by a compiled updater
runner and local shell payloads, not by published release assets.
