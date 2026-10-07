# Raw paired release updater fixture

Run: `bun test tests/update-release-shape.test.ts` (Bun >= 1.4.1). Updates
use temporary sibling installations and fake canonical GitHub responses, never
installed executables or the network.

The release contains synthetic ELF/Mach-O-shaped normal Bruv bytes and the actual
shell connector emitted by `connectorLauncher`, including Android's interpreter.
The injected probe reads staged bytes: normal Bruv supplies its embedded product
version; the connector must match the emitted launcher and derives its version
from the explicitly selected staged normal sibling. These probes do **not** prove
published binaries boot on any target OS or execute the launcher on those targets.

The tests exercise the current updater's four-asset metadata authority before
download, both named checksums, staged product/version probes, macOS helper probe
selection, and ownership of both installed siblings. Metadata, transport,
checksum and payload-shape failures leave both originals unchanged; concurrent-owner
failures preserve the new owner's bytes and the untouched sibling. All remove staging files. Checksum-valid tar-shaped downloads reach the updater's
staged probes rather than failing only a test-owned fixture preflight.

Actual staged execution is covered separately by `update.test.ts` (compiled updater
and local shell payloads) and `connector-update.test.ts` (compiled connector route),
not by published release assets.
