# Cache Linux fixture tools, not another version manager

PR51's hosted Linux job spent over nine minutes in the ffmpeg install step,
before tests. The old workflow could refresh every apt feed three times: tmux,
ffmpeg, then the private native-audio fixture. The runner has unrelated vendor
feeds. Logs were still in progress, so the exact stalled mirror was not proven.

CI and release now share scripts/install-ci-linux-tools.sh. It checks installed
packages, refreshes only the hosted Noble Ubuntu source file, and installs all
missing prerequisites together without recommended packages. CI includes native
Pulse/WebRTC build prerequisites; release needs tmux and ffmpeg. The original
audio and capture protocol tests still run. Missing packages remain failures.

Cache only downloaded .deb files under runner.temp/bruv-apt-cache. apt still
validates package metadata and digests. Keys include Noble, architecture, cache
generation and installer hash. Do not cache locks, /usr, or installed dpkg state.
A warm package install skips apt entirely. Downloads have 15-second transport
timeouts and one retry. apt update/install have 90/180-second whole-command limits;
the workflow step has five minutes. This bounds failure, not a promise every
cold runner will finish faster. Hosted rerun supplies the real timing.

Mise is useful for language runtimes, not an improvement for this linked system
package set. Keep the existing pinned Node/Bun setup. No new FFmpeg provider,
unverified binary download or replaced audio test is needed.

The focused shell fixture checks one update/install pair, missing-package
selection, deb-cache location, bounded waits and skipping installed tools.
Workflow contracts check both lanes and release still install tools before tests.
Values unchanged: existing whole-path proof and bounded-resource rules cover this.
