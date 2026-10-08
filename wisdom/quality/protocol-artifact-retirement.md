# Protocol artifact retirement

Protocol notes retain conclusions and contract/evidence data; these UI screenshots were output-only historical captures, not test or script inputs. Removed 92 PNGs from wisdom/claude-compat/proof and 14 ACP screenshots (106 files, 35,923,938 bytes: 31,775,335 + 4,148,603). Exact recovery point for every removed byte: baf2fcd5c9976ee19a8cbc0ae8839875d714cc38. Git history is unchanged; no history rewrite.

Retained the maintained wisdom/claude-compat/proof/native-ui-fixture/{fixture,native-actions,replay}.mjs modules, all wisdom/claude-compat/proof/official-2644 fetch/verify/driver/provenance/release-gate inputs and required screenshots, and concise compatibility/ACP conclusions. No active tests or scripts read the retired screenshots. Output producers remain: wisdom/claude-compat/proof/{connector-version-probe/realT3.mjs, version-defaults/realT3.mjs,runtime-teardown/replay.mjs}; wisdom/acp/prototypes/pi-acp-only-lifecycle/browser-driver.mjs. They write local replay artifacts, not required inputs; no producer under scripts/ was found.

Navigation now points to retained text/JSON evidence. The removed screenshots can be recovered from baf2fcd5c9976ee19a8cbc0ae8839875d714cc38 if needed; do not restore them as dependencies.
