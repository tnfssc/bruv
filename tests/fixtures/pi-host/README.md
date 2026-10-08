# Pi 1.1.0 host patch fixture

1.1.0-originals.json.gz contains a JSON path-to-text map of the nine pinned original files covered by scripts/build/pi-host-adaptation.ts. Recovery tests decompress this fixture and check every original SHA-256 before use. Tests need no node_modules reads, install, network, or Bun cache.

Generated from the actual published @earendil-works/pi-coding-agent 1.1.0 npm tarball in an owned temporary directory, after verifying its SHA-512 against registry metadata. Applied patches/@earendil-works%2Fpi-coding-agent@1.1.0.patch with git apply before collecting files: “original” here means the reviewed Bun-patched source, before runtime host adaptations. All nine files matched the upgrade's existing originalSha256 values, and adaptPiHostFile produced each existing adaptedSha256. No source/result hashes or dependency pins were changed.

To reproduce: fetch the version metadata and tarball from registry.npmjs.org, verify dist.integrity, extract into a temporary package directory, apply the tracked coding-agent patch there, read piHostPatches paths in declaration order, validate both source/result digests, then gzipSync(JSON.stringify(pathToText)). Source URL, integrity, fixture digest, and per-file hashes are recorded in wisdom/dependencies/evidence/pi-host-1.1-recovery/fixture-source.json. No inherited installation bytes were used.

The tests synthesize a stale 1.1.0 agent-session.js by omitting the final compaction getModelContextBranch adaptation. Its fc59d68420c94f67f3ed818766eee20ec2ad95126db9038b95b18f2fb4589d6b hash is a regression fixture, not an observed polluted-cache hash or a production-accepted hash. The historically observed ef78… hash belongs to 1.0.3 and remains documented in the sibling task's wisdom only.

Upstream: @earendil-works/pi-coding-agent 1.1.0, MIT; see third-party/pi/LICENSE and third-party notices. Compressed to avoid hundreds of kilobytes of generated dependency text in test source.
