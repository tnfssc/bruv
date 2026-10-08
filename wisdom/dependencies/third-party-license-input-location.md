# Third-party license input location

Curated dependency-license inputs live under `licenses/third-party/`, and the repository notice guide lives at `licenses/THIRD_PARTY_NOTICES.md`, separate from build/runtime source. This is a source-layout change only: preserve the guide bytes and keep generated release notice names, archive contents, and install behavior unchanged. The release workflow copies the guide into its archive as `THIRD_PARTY_NOTICES.md`; keep that distributable basename stable.

The notice generator reads curated inputs from `licenses/third-party/` and writes the generated bundle to `dist/release/THIRD_PARTY_LICENSES.txt`. README and contributor links use the relocated guide; release packaging copies it from `licenses/` but retains the archive basename. Packaging/install tests assert that public basename. Historical wisdom and release reports retain original path wording as evidence; they are not active path consumers.

Validation: `bun test tests/packaging/generate-third-party-notices.test.ts tests/release/release-workflows.test.ts tests/packaging/production-packaging.test.ts tests/packaging/install-download.test.ts`, `bun x tsc --noEmit`, and `git diff --check`.
