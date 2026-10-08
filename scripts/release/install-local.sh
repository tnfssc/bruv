#!/usr/bin/env sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
install_dir="${BRUV_INSTALL_DIR:-$HOME/.local/bin}"
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$root_dir"
mac_arm64=0
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  mac_arm64=1
fi
if [ "${BRUV_SKIP_BUILD:-0}" != "1" ]; then
  if [ "$mac_arm64" = "1" ]; then
    sh scripts/live/build-helper.sh
    bun run build --live-helper=dist/live-audio
  else
    bun run build
  fi
fi
mkdir -p "$install_dir"
install_dir="$(CDPATH= cd -- "$install_dir" && pwd -P)"

# The stage and replacement journal live only for this installation attempt.
stage=""
replaced=""
cleanup() {
  code=$?
  trap - 0 INT TERM
  keep=0
  for name in $replaced; do
    if [ -f "$stage/$name.previous" ]; then
      mv -f "$stage/$name.previous" "$install_dir/$name" || keep=1
    else
      rm -f "$install_dir/$name" || keep=1
    fi
  done
  if [ "$keep" = 1 ]; then
    printf 'Rollback failed; recovery files retained at %s\n' "$stage" >&2
  elif [ -n "$stage" ]; then
    rm -rf "$stage"
  fi
  exit "$code"
}
replace_executable() {
  mv -f "$stage/$1" "$install_dir/$1"
  # Prepend so a failed pair installation rolls back in reverse rename order.
  replaced="$1 $replaced"
}
trap cleanup 0

stage=$(mktemp -d "$install_dir/.bruv-install-XXXXXX")
for name in bruv bruv-claude-compat; do
  install -m 755 "./dist/$name" "$stage/$name"
done
# Verify the staged pair before touching the installed files. These probes do not
# open audio devices or contact a provider, including for trusted prebuilts.
unset BRUV_CLAUDE_COMPAT_BRUV_PATH
normal_version=$("$stage/bruv" --version)
connector_version=$(BRUV_CLAUDE_COMPAT_BRUV_PATH="$stage/bruv" "$stage/bruv-claude-compat" --bruv-version)
[ "$connector_version" = "bruv-claude-compat $normal_version" ] || { echo "Bruv pair version mismatch" >&2; exit 1; }
if [ "$mac_arm64" = "1" ]; then
  "$stage/bruv" --live-self-test
fi
for name in bruv bruv-claude-compat; do
  [ ! -L "$install_dir/$name" ] && { [ ! -e "$install_dir/$name" ] || [ -f "$install_dir/$name" ]; } || {
    echo "Unsafe install target: $install_dir/$name" >&2; exit 1;
  }
done
# Back up the old pair until both renames succeed; two renames are not a transaction.
for name in bruv bruv-claude-compat; do
  if [ -f "$install_dir/$name" ]; then
    cp -p "$install_dir/$name" "$stage/$name.previous"
  fi
done
replace_executable bruv-claude-compat
replace_executable bruv
replaced=""

printf 'Installed bruv to %s\n' "$install_dir/bruv"
printf 'Installed bruv-claude-compat to %s\n' "$install_dir/bruv-claude-compat"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH to invoke bruv from any terminal.\n' "$install_dir" ;;
esac
