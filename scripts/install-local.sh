#!/usr/bin/env sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
install_dir="${BRUV_INSTALL_DIR:-$HOME/.local/bin}"
target="$install_dir/bruv"
temporary="$install_dir/.bruv-install-$$"

cleanup() {
  rm -f "$temporary"
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
# Verify the staged artifact before replacing a working executable. These probes
# do not open audio devices or contact a provider, including for trusted prebuilts.
"$temporary" --version >/dev/null
if [ "$mac_arm64" = "1" ]; then
  "$temporary" --live-self-test
fi
mv -f "$temporary" "$target"
trap - EXIT INT TERM

printf 'Installed bruv to %s\n' "$target"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to invoke bruv from any terminal.\n' "$install_dir" ;;
esac
