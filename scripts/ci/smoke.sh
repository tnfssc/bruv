#!/usr/bin/env sh
set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: scripts/ci/smoke.sh [--reuse-build]" >&2
  exit 2
fi

case "${1-}" in
  "") bun run build ;;
  --reuse-build) ;;
  *) echo "usage: scripts/ci/smoke.sh [--reuse-build]" >&2; exit 2 ;;
esac

# The build and reuse paths must both supply the binary and exec launcher.
for binary in ./dist/bruv ./dist/bruv-claude-compat; do
  if [ ! -f "$binary" ] || [ ! -x "$binary" ]; then
    echo "smoke: requires executable $binary" >&2
    exit 1
  fi
done

expected_version="$(bun -e 'console.log(require("./package.json").version)')"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM
cp ./dist/bruv "$tmp_dir/bruv"
cp ./dist/bruv-claude-compat "$tmp_dir/bruv-claude-compat"

version="$(env -i HOME="$tmp_dir/home" PATH=/nonexistent "$tmp_dir/bruv" --version)"
help="$(env -i HOME="$tmp_dir/home" PATH=/nonexistent "$tmp_dir/bruv" --help)"

[ "$version" = "$expected_version" ]
printf '%s\n' "$help" | grep -q '^bruv - AI coding assistant'
[ -d "$tmp_dir/home/.bruv" ]
[ ! -e "$tmp_dir/home/.pi" ]

connector_version="$(env -i HOME="$tmp_dir/connector-home" PATH=/nonexistent "$tmp_dir/bruv-claude-compat" --bruv-version)"
[ "$connector_version" = "bruv-claude-compat $expected_version" ]
connector_identity="$(env -i HOME="$tmp_dir/connector-home" PATH=/nonexistent "$tmp_dir/bruv-claude-compat" --version 2>"$tmp_dir/connector-version.stderr")"
[ "$connector_identity" = "Bruv connector" ]
[ ! -s "$tmp_dir/connector-version.stderr" ]
[ ! -e "$tmp_dir/connector-home/.bruv" ]
[ ! -e "$tmp_dir/connector-home/.claude" ]
web="$(env -i HOME="$tmp_dir/web-home" PATH=/nonexistent "$tmp_dir/bruv" web --setup)"
printf '%s\n' "$web" | grep -q 'Setup guide only.'
[ ! -e "$tmp_dir/web-home/.bruv" ]
[ ! -e "$tmp_dir/web-home/.claude" ]
echo "bruv paired standalone smoke test passed (not native parity acceptance)"
