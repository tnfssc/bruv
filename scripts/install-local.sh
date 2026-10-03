#!/usr/bin/env sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
install_dir="${BRUV_INSTALL_DIR:-$HOME/.local/bin}"
target="$install_dir/bruv"
temporary="$install_dir/.bruv-install-$$"
connector_temporary="$install_dir/.bruv-claude-compat-install-$$"

cleanup() {
  rm -f "$temporary" "$connector_temporary"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$root_dir"
mac_arm64=0
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  mac_arm64=1
fi
if [ "${BRUV_SKIP_BUILD:-0}" != "1" ]; then
  if [ "$mac_arm64" = "1" ]; then
    sh scripts/build-live-helper.sh
    bun run build --live-helper=dist/live-audio
  else
    bun run build
  fi
fi
mkdir -p "$install_dir"
install -m 755 ./dist/bruv "$temporary"
install -m 755 ./dist/bruv-claude-compat "$connector_temporary"
# Verify the staged artifact before replacing a working executable. These probes
# do not open audio devices or contact a provider, including for trusted prebuilts.
normal_version=$("$temporary" --version)
connector_version=$("$connector_temporary" --version)
[ "$connector_version" = "bruv-claude-compat $normal_version" ] || { echo "Bruv pair version mismatch" >&2; exit 1; }
if [ "$mac_arm64" = "1" ]; then
  "$temporary" --live-self-test
fi
mv -f "$connector_temporary" "$install_dir/bruv-claude-compat"
mv -f "$temporary" "$target"
trap - EXIT INT TERM

printf 'Installed bruv to %s\n' "$target"
printf 'Installed bruv-claude-compat to %s\n' "$install_dir/bruv-claude-compat"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to invoke bruv from any terminal.\n' "$install_dir" ;;
esac
