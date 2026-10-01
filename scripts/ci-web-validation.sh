#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
log_dir="$root/artifacts/ci"
source_pin="$(cd "$root" && bun -e 'console.log(require("./integrations/t3/upstream/source.json").revision)')"
web_source="${BRUV_T3_SOURCE:-$root/.cache/bruv-t3code-$source_pin}"
run_step() {
  local label="$1" log="$2" directory="$3"
  shift 3
  echo "==> $label"
  (cd "$directory" && "$@") 2>&1 | tee "$log_dir/$log"
}
# Backend/client tsc already passed in the exact-input web producer; the
# independent client-runtime graph and every behavioral suite still run.
run_step 'Typecheck terminal client' terminal-client-typecheck.log "$web_source/packages/client-runtime" ../../node_modules/.bin/tsc --noEmit
run_step 'Validate web backend' web-tests.log "$web_source/apps/server" ../../node_modules/.bin/vp test run \
  src/provider/Layers/PiProvider.test.ts src/auth/EnvironmentAuth.test.ts src/serverRuntimeStartup.test.ts \
  src/terminal/NodePtyAdapter.test.ts src/terminal/BunPtyAdapter.test.ts src/terminal/Manager.test.ts \
  src/terminal/SubscriberStream.test.ts src/mcp/BruvTaskService.test.ts src/mcp/OrchestratorMcpService.test.ts \
  src/orchestration-v2/NativeBruvIntegration.production.test.ts src/orchestration-v2/ProjectionStore.test.ts \
  src/orchestration-v2/ProviderContinuationService.test.ts src/orchestration-v2/LocalJobNotification.test.ts \
  src/orchestration-v2/NativeUsageAccounting.test.ts src/orchestration-v2/Adapters/PiAdapterV2.test.ts \
  src/resourceTelemetry/ResourceTelemetry.test.ts src/device/AgentDeviceTarget.test.ts src/provider/Layers/EventNdjsonLogger.test.ts --maxWorkers=1
run_step 'Validate focused web model behavior' web-model-tests.log "$web_source/apps/web" \
  ../../node_modules/.bin/vp test run --project unit src/composerDraftStore.test.ts src/lib/chatThreadActions.test.ts --maxWorkers=1
run_step 'Validate web contracts' web-contract-tests.log "$web_source/packages/contracts" \
  ../../node_modules/.bin/vp test run src/browserProfile.test.ts src/orchestratorMcp.test.ts src/providerRuntime.test.ts --maxWorkers=1
run_step 'Validate client projection' web-client-runtime-tests.log "$web_source/packages/client-runtime" \
  ../../node_modules/.bin/vp test run src/state/orchestrationV2Projection.test.ts --maxWorkers=1
run_step 'Validate web cache regressions' web-cache-tests.log "$web_source/apps/web" \
  ../../node_modules/.bin/vp test run src/lib/syntaxHighlighting.test.ts src/components/pullRequest/pullRequestDetail.logic.test.ts src/components/chat/nativeUsageCost.logic.test.ts --maxWorkers=1
run_step 'Validate terminal client recovery' terminal-client-tests.log "$web_source/packages/client-runtime" \
  ../../node_modules/.bin/vp test run src/rpc/client.test.ts src/state/terminalSession.test.ts --maxWorkers=1
