# Commands / durable inputs

Read-only original source: /home/tnfssc/.bruv/upstream-preparation/t3-ui-history-2644 (c1310b2429625e704ef20a175e8b2847f58589ba). Independent source: /home/tnfssc/.bruv/upstream-preparation/t3-pr-15598-npm-review (aeee9df0337bcfa35230e8cd69816815a54e648f).

The independent clone was made with git clone --no-hardlinks --no-checkout and detached checkout of c1310b242. Reused the original immutable dependency files via cp -al node_modules and copied package-level node_modules links for apps/server, apps/web, packages/{contracts,shared,ssh,tailscale,effect-acp,effect-codex-app-server}, scripts, oxlint-plugin-t3code. Copied .generated. No source builds or clean commands ran in the original clone. No shared dist assets were symlinked.

## Source checks

~~~sh
export PATH=/home/tnfssc/.local/share/mise/installs/node/24.21.0/bin:$PATH
cd /home/tnfssc/.bruv/upstream-preparation/t3-pr-15598-npm-review
node_modules/.bin/vp test run apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts
node_modules/.bin/tsc --noEmit -p apps/server/tsconfig.json
node_modules/.bin/vp fmt --check apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts
node_modules/.bin/vp lint apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts
~~~

Fresh before-fix stall test was added to c1310b242 first, then run with the same vp test command and -t "times out and terminates a stalled history worker". It failed on its 2s live-clock watchdog after advancing the test clock 30s. Applied the one-line production timeout and reran: passes, including child.isRunning=false. Actual logs saved. For after packaging a clean source commit was created first.

## Actual production npm packaging (each head)

Private Node 26.8.2 downloaded from https://nodejs.org/dist/v26.8.2/node-v26.8.2-linux-x64.tar.xz and unpacked under /var/tmp/t3-pr-15598-npm/toolchain. No global install.

~~~sh
repo=/home/tnfssc/.bruv/upstream-preparation/t3-pr-15598-npm-review
out=/var/tmp/t3-pr-15598-npm-after # Before used /var/tmp/t3-pr-15598-npm
export PATH=/var/tmp/t3-pr-15598-npm/toolchain/node-v26.8.2-linux-x64/bin:$repo/node_modules/.bin:$PATH
cd "$repo/apps/server"
../../node_modules/.bin/vp pack
T3CODE_PACK_EXE=1 ../../node_modules/.bin/vp pack
# Both bundles clean only their OWN private output directory.
cp -a /home/tnfssc/.bruv/upstream-preparation/t3-ui-history-2644/apps/server/dist/client dist/client
cp -a /home/tnfssc/.bruv/upstream-preparation/t3-ui-history-2644/apps/server/dist/resource-monitor dist/resource-monitor
cd "$repo"
node scripts/build-cli-archive.ts --platform linux --arch x64 --version 0.0.45 --output-dir "$out/archives"
node scripts/build-npm-platform-packages.ts --archives-dir "$out/archives" --version 0.0.45 --output-dir "$out/packages" --allow-missing
mkdir -p "$out/stage/dist"
cd "$out/stage/dist"
npm install --ignore-scripts --no-audit --no-fund "$out/packages/@t3code/t3-linux-x64.tgz" "$out/packages/t3.tgz"
./node_modules/.bin/t3 --version
~~~

The obsolete direct apps/server pnpm-pack attempt was **not** the tested npm artifact: it failed resolving unversioned private @t3tools/ssh. Production npm packaging above uses the repository's SEA/platform builder and successfully installs both generated tarballs. No unsupported legacy-manifest install is claimed.

## Installed artifact strict UI trial

The existing parent strict harness was copied privately to each out/harness. Only identity wording/metadata changed, as shown in npm-harness-identity.diff. No behavioral assertions changed. Pair binaries physically copied from /home/tnfssc/.bruv/upstream-preparation/history-minimal-pair, unchanged hashes. stage/provenance.json records actual installed tree, pair, wrapper and harness hashes. Wrapper contents are saved as before/npm-launch-wrapper.sh and after/npm-launch-wrapper.sh. It enters the real installed npm launcher and uses strace only for exec/write observation plus process-group supervision. It does not add T3 arguments/environment.

~~~sh
/home/tnfssc/.local/share/mise/installs/node/24.21.0/bin/node /var/tmp/t3-pr-15598-npm-after/run.mjs /var/tmp/t3-pr-15598-npm-after/stage /absolute/new-proof-directory
~~~

Runner asserts installed tree unchanged and sets history-only scope. Each proof invocation records args=[], HOME/PATH only, provider UI configuration, no credentials, no synthetic connector events. The canonical full-all-scenarios flag remains false. Binary/tarball inventories saved in package-proof.json; all installed tree hashes saved in proof/source-provenance.json. Real worker trace extracts retained separately; full raw traces stay private under each out.
