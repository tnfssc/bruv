# Die web release packaging

The release workflow builds the pinned T3 sidecar with Node 24 and pnpm 11.10.0, packages it as `die-web-linux-x64.tar.gz`, and publishes its SHA-256 checksum. `SOURCE.txt` records the T3 revision and integration patch checksum.
The existing Linux binary asset has not changed.


Prepared-source builds must complete the pinned HEAD and canonical patch checks before invalidating `dist/bruv-web.archive.manifest.json`. A rejected checkout has not started replacing the artifact, so it must leave a prior receipt intact; keep a focused regression using a disposable build root. The release receipt is only proof for the exact producer inputs: do not treat an older `dist` archive/receipt as fresh after builder source changes.
