#!/usr/bin/env sh
set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: scripts/smoke.sh [--reuse-build]" >&2
  exit 2
fi

case "${1-}" in
  "") bun run build ;;
  --reuse-build)
    if [ ! -f ./dist/bruv ] || [ ! -x ./dist/bruv ]; then
      echo "smoke: --reuse-build requires executable dist/bruv" >&2
      exit 1
    fi
    ;;
  *) echo "usage: scripts/smoke.sh [--reuse-build]" >&2; exit 2 ;;
esac

expected_version="$(bun -e 'console.log(require("./package.json").version)')"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM
cp ./dist/bruv "$tmp_dir/bruv"

version="$(env -i HOME="$tmp_dir/home" PATH=/nonexistent "$tmp_dir/bruv" --version)"
help="$(env -i HOME="$tmp_dir/home" PATH=/nonexistent "$tmp_dir/bruv" --help)"

[ "$version" = "$expected_version" ]
printf '%s\n' "$help" | grep -q '^bruv - AI coding assistant'
[ -d "$tmp_dir/home/.bruv" ]
[ ! -e "$tmp_dir/home/.pi" ]

echo "bruv standalone smoke test passed"
