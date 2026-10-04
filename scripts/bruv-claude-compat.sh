#!/bin/sh
# Bruv connector launcher. Keep this file beside its matching normal bruv.
set -eu
fail() { printf '%s\n' "bruv-claude-compat: $*" >&2; exit 1; }
self=$0
case "$self" in */*) ;; *) self=$(command -v "$self") ;; esac
case "$self" in /*) ;; *) self=$PWD/$self ;; esac
links=0
while :; do
  directory=$(CDPATH= cd -P "${self%/*}" && pwd) || exit 1
  self=$directory/${self##*/}
  [ -L "$self" ] || break
  links=$((links + 1))
  [ "$links" -le 40 ] || fail "launcher symlink loop"
  link=$(readlink "$self") || exit 1
  case "$link" in /*) self=$link ;; *) self=$directory/$link ;; esac
done
name=${self##*/}
suffix=${name#bruv-claude-compat}
bruv=${BRUV_CLAUDE_COMPAT_BRUV_PATH:-$directory/bruv$suffix}
case "$bruv" in
  "~") bruv=${HOME:?HOME is required for a tilde override} ;;
  "~/"*) bruv=${HOME:?HOME is required for a tilde override}/${bruv#\~/} ;;
esac
case "$bruv" in /*) ;; *) fail "BRUV_CLAUDE_COMPAT_BRUV_PATH must be an absolute normal bruv path" ;; esac
[ -x "$bruv" ] && [ ! -d "$bruv" ] || fail "normal Bruv executable not found: $bruv; install the matching pair"
[ ! "$bruv" -ef "$self" ] || fail "normal Bruv path must not point to the connector launcher"
# 0.16.3 probes a downloaded pair inside its private .bruv-update-* directory
# and requires this exact legacy product label. It cannot understand the SDK
# compatibility version. Only this staged --version probe uses the old label;
# after rename the same launcher exposes the connector's SDK-facing version.
case "${directory##*/}/$name" in
  .bruv-update-*/bruv-claude-compat)
    if [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then
      product=$("$directory/bruv" --version) || exit $?
      printf 'bruv-claude-compat %s\n' "$product"
      exit 0
    fi
    ;;
esac
export BRUV_CLAUDE_COMPAT_BRUV_PATH="$bruv"
exec "$bruv" claude-compat "$@"
