#!/usr/bin/env sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
install_dir="${BRUV_INSTALL_DIR:-$HOME/.local/bin}"
target="$install_dir/bruv"
stage=""
bruv_replaced=0
connector_replaced=0
committed=0

cleanup() {
  code=$?
  trap - 0 INT TERM
  keep=0
  if [ "$committed" != 1 ]; then
    if [ "$bruv_replaced" = 1 ]; then
      if [ -f "$stage/bruv.previous" ]; then mv -f "$stage/bruv.previous" "$target" || keep=1
      else rm -f "$target" || keep=1; fi
    fi
    if [ "$connector_replaced" = 1 ]; then
      if [ -f "$stage/compat.previous" ]; then mv -f "$stage/compat.previous" "$install_dir/bruv-claude-compat" || keep=1
      else rm -f "$install_dir/bruv-claude-compat" || keep=1; fi
    fi
  fi
  if [ "$keep" = 1 ]; then
    printf 'Rollback failed; recovery files retained at %s\n' "$stage" >&2
  elif [ -n "$stage" ]; then rm -rf "$stage"; fi
  exit "$code"
}
trap cleanup 0
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
install_dir="$(CDPATH= cd -- "$install_dir" && pwd -P)"
target="$install_dir/bruv"
stage=$(mktemp -d "$install_dir/.bruv-install-XXXXXX")
temporary="$stage/bruv"
connector_temporary="$stage/bruv-claude-compat"
install -m 755 ./dist/bruv "$temporary"
install -m 755 ./dist/bruv-claude-compat "$connector_temporary"
# Verify the staged artifact before replacing a working executable. These probes
# do not open audio devices or contact a provider, including for trusted prebuilts.
unset BRUV_CLAUDE_COMPAT_BRUV_PATH
normal_version=$("$temporary" --bruv-version)
connector_version=$(BRUV_CLAUDE_COMPAT_BRUV_PATH="$temporary" "$connector_temporary" --bruv-version)
[ "$connector_version" = "$normal_version" ] || { echo "Bruv pair version mismatch" >&2; exit 1; }
if [ "$mac_arm64" = "1" ]; then
  "$temporary" --live-self-test
fi
# Back up the old pair until both renames succeed; two renames are not a transaction.
for name in bruv bruv-claude-compat; do
  [ ! -L "$install_dir/$name" ] && { [ ! -e "$install_dir/$name" ] || [ -f "$install_dir/$name" ]; } || {
    echo "Unsafe install target: $install_dir/$name" >&2; exit 1;
  }
done
if [ -f "$target" ]; then cp -p "$target" "$stage/bruv.previous"; fi
if [ -f "$install_dir/bruv-claude-compat" ]; then cp -p "$install_dir/bruv-claude-compat" "$stage/compat.previous"; fi
mv -f "$connector_temporary" "$install_dir/bruv-claude-compat"
connector_replaced=1
mv -f "$temporary" "$target"
bruv_replaced=1
committed=1

printf 'Installed bruv to %s\n' "$target"
printf 'Installed bruv-claude-compat to %s\n' "$install_dir/bruv-claude-compat"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to invoke bruv from any terminal.\n' "$install_dir" ;;
esac
