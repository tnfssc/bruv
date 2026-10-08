# Tooling map

Run commands from the repository root. The package scripts are the short entry
points; this tree groups their implementations by job.

| Folder | Job |
| --- | --- |
| `build/` | Paired binaries, launcher, runtime assets and Pi host adaptation |
| `ci/` | Shared gates, change selection and offline smoke |
| `release/` | Release preparation, verification, publication and local install |
| `dependencies/` | Dependency updates and third-party notices |
| `history/` | Storage and SDK history probes |
| `remote/` | Remote integration and recovery probes |
| [`live/`](live/README.md) | Voice helpers and explicit Live probes |
| `tui/` | Terminal acceptance, screenshots and video capture |
| `terminal-perf/` | Terminal performance and interaction measurements |
| `resource-harness/` | Task history resource measurements |
| `leak-audit/` | Focused lifetime and retention probes |
| `claude-native-acceptance/` | Native host acceptance |
| `fixtures/` | Shared offline fixture processes and presentation inputs |

`install.sh` stays at its published download URL. `prompt-preview.ts` is a
single standalone command, not another tool family. Tests belong under
`tests/`, including the presentation tooling tests that used to sit here.

Historical commands in wisdom keep their original paths. The current package
commands and this map describe the maintained layout.
