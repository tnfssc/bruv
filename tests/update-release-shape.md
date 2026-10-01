# Raw release updater fixture

Run: `bun test tests/update-release-shape.test.ts` (Bun >= 1.4.1). This tests the current Bruv updater, not a historical binary or rename migration. No git tag, network, provider, mic, installation or publication is required. Only fetch, compiled status, version, platform, architecture and a temporary executable path are injected through the updater's public dependencies. URLs retain the actual tnfssc/die GitHub repository; response bytes come from staged local bruv release assets and checksums. Temporary targets are never the executing process.

Fixtures are synthetic, with format magic and an embedded 0.8.0 label. Fixture preflight rejects wrong version or tar-shaped bytes; the updater rejects release metadata advertising a tarball instead of a raw asset. The updater checks hashes and asset names, not executable format/version. These tests do not prove actual release binaries boot, run on macOS, or are published on GitHub.
