#!/bin/sh
# Download the matched Bruv pair. No sudo, build, or shell-profile changes.
set -eu
umask 077
source_guide=https://github.com/tnfssc/bruv#build-from-source
fail() { printf 'Bruv install: %s\nSource guide: %s\n' "$*" "$source_guide" >&2; exit 1; }
[ "$(id -u)" != 0 ] || fail 'Run as your normal user, not root.'
command -v curl >/dev/null 2>&1 || fail 'curl is required.'
if command -v sha256sum >/dev/null 2>&1; then
  digest() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  digest() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  fail 'sha256sum or shasum is required.'
fi
os=$(uname -s); arch=$(uname -m)
case "$os:$arch" in
  Linux:x86_64)
    [ -z "${ANDROID_ROOT:-}" ] && [ "${PREFIX:-}" != /data/data/com.termux/files/usr ] || fail 'Android requires Termux arm64.'
    platform=linux-x64 ;;
  Linux:aarch64|Linux:arm64)
    case "${PREFIX:-}" in
      /data/data/com.termux/files/usr) platform=android-arm64 ;;
      *) [ -z "${ANDROID_ROOT:-}" ] || fail 'Android requires Termux arm64.'; platform=linux-arm64 ;;
    esac ;;
  Darwin:arm64) platform=darwin-arm64 ;;
  *) fail "Unsupported platform $os $arch." ;;
esac
# Resolve latest once; every subsequent request uses this immutable tag URL.
release=$(curl -fsSL --proto '=https' --proto-redir '=https' -o /dev/null -w '%{url_effective}' https://github.com/tnfssc/bruv/releases/latest) || fail 'Cannot resolve latest release.'
tag=${release##*/}
printf '%s\n' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail 'Invalid stable release tag.'
[ "$release" = "https://github.com/tnfssc/bruv/releases/tag/$tag" ] || fail 'Unexpected release URL.'
version=${tag#v}
url=https://github.com/tnfssc/bruv/releases/download/$tag
bin_dir=${BRUV_INSTALL_DIR:-$HOME/.local/bin}
notice_dir=$HOME/.local/share/bruv/notices/$version
mkdir -p "$bin_dir" "$(dirname "$notice_dir")" || fail 'Cannot create user install directories.'
lock=$bin_dir/.bruv-install-lock
mkdir "$lock" 2>/dev/null || fail "Another install is running (lock: $lock)."
stage=; notice_stage=; committed=0; keep=0; bruv_changed=0; compat_changed=0; notices_changed=0
cleanup() {
  code=$?
  trap - 0 INT TERM HUP
  if [ "$committed" = 0 ] && [ -n "$stage" ]; then
    if [ "$bruv_changed" = 1 ]; then
      if [ -f "$stage/bruv.previous" ]; then mv -f "$stage/bruv.previous" "$bin_dir/bruv" || keep=1
      else rm -f "$bin_dir/bruv" || keep=1; fi
    fi
    if [ "$compat_changed" = 1 ]; then
      if [ -f "$stage/compat.previous" ]; then mv -f "$stage/compat.previous" "$bin_dir/bruv-claude-compat" || keep=1
      else rm -f "$bin_dir/bruv-claude-compat" || keep=1; fi
    fi
    if [ "$notices_changed" = 1 ]; then
      rm -rf "$notice_dir" || keep=1
      if [ -d "$stage/notices.previous" ]; then mv "$stage/notices.previous" "$notice_dir" || keep=1; fi
    fi
  fi
  if [ "$keep" = 1 ]; then
    printf 'Rollback failed. Recovery files retained at %s; restore *.previous before using Bruv.\n' "$stage" >&2
  elif [ -n "$stage" ]; then rm -rf "$stage"; fi
  [ -z "$notice_stage" ] || rm -rf "$notice_stage"
  rmdir "$lock" 2>/dev/null || :
  exit "$code"
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
stage=$(mktemp -d "$bin_dir/.bruv-install.XXXXXX") || fail 'Cannot stage install.'
mkdir "$stage/notices" "$stage/probe"
fetch() {
  curl -fsSL --proto '=https' --proto-redir '=https' "$url/$1" -o "$2" || fail "Missing or unavailable $tag asset: $1. Installed pair unchanged."
  [ -s "$2" ] || fail "Empty asset: $1."
}
for name in bruv-$platform bruv-claude-compat-$platform; do
  fetch "$name" "$stage/$name"
  fetch "$name.sha256" "$stage/$name.sha256"
  # Require one checksum for exactly this filename; never trust arbitrary -c paths.
  expected=$(awk -v name="$name" 'NF == 2 && length($1) == 64 && $1 !~ /[^a-fA-F0-9]/ && ($2 == name || $2 == "*" name) {print tolower($1); n++} END {if (NR != 1 || n != 1) exit 1}' "$stage/$name.sha256") || fail "Invalid checksum manifest: $name."
  actual=$(digest "$stage/$name")
  [ "$actual" = "$expected" ] || fail "Checksum verification failed: $name. Installed pair unchanged."
done
for name in LICENSE THIRD_PARTY_NOTICES.md THIRD_PARTY_LICENSES.txt SOURCE.txt; do
  fetch "$name" "$stage/notices/$name"
done
chmod 755 "$stage/bruv-$platform" "$stage/bruv-claude-compat-$platform"
chmod 644 "$stage/notices/"*
chmod 755 "$stage/notices"
# Both downloads are verified before either is executed. Isolate version probes.
probe() { HOME="$stage/probe" XDG_CONFIG_HOME="$stage/probe/config" XDG_CACHE_HOME="$stage/probe/cache" XDG_DATA_HOME="$stage/probe/data" "$@"; }
[ "$(probe "$stage/bruv-$platform" --version)" = "$version" ] || fail "Bruv version does not match $tag."
[ "$(probe "$stage/bruv-claude-compat-$platform" --bruv-version)" = "bruv-claude-compat $version" ] || fail "Connector version does not match $tag."
if [ "$platform" = darwin-arm64 ]; then probe "$stage/bruv-$platform" --live-self-test || fail 'macOS helper self-test failed.'; fi
# Stop running Bruv/T3 sessions before replacing a pair. Preserve originals for rollback.
for name in bruv bruv-claude-compat; do
  target=$bin_dir/$name
  [ ! -L "$target" ] || fail "Refusing symlink install target: $target."
  [ ! -e "$target" ] || [ -f "$target" ] || fail "Not a regular file: $target."
done
[ ! -L "$notice_dir" ] || fail "Refusing symlink notices: $notice_dir."
[ ! -e "$notice_dir" ] || [ -d "$notice_dir" ] || fail "Not a notices directory: $notice_dir."
if [ -f "$bin_dir/bruv" ]; then cp -p "$bin_dir/bruv" "$stage/bruv.previous"; fi
if [ -f "$bin_dir/bruv-claude-compat" ]; then cp -p "$bin_dir/bruv-claude-compat" "$stage/compat.previous"; fi
if [ -d "$notice_dir" ]; then cp -Rp "$notice_dir" "$stage/notices.previous"; fi
# Notices are staged on their own filesystem, then moved; binaries stage beside targets.
notice_stage=$(mktemp -d "$(dirname "$notice_dir")/.bruv-notices.XXXXXX")
cp -R "$stage/notices/." "$notice_stage/"
chmod 755 "$notice_stage"
notices_changed=1
rm -rf "$notice_dir"
if ! mv "$notice_stage" "$notice_dir"; then rm -rf "$notice_stage"; fail 'Cannot install notices.'; fi
compat_changed=1
mv -f "$stage/bruv-claude-compat-$platform" "$bin_dir/bruv-claude-compat" || fail 'Cannot install connector; restoring previous pair.'
bruv_changed=1
mv -f "$stage/bruv-$platform" "$bin_dir/bruv" || fail 'Cannot install Bruv; restoring previous pair.'
committed=1
printf 'Installed Bruv %s and matching bruv-claude-compat in %s\nNotices: %s\n' "$version" "$bin_dir" "$notice_dir"
case ":${PATH:-}:" in *":$bin_dir:"*) ;; *) printf 'Add %s to PATH to run bruv. No shell profiles changed.\n' "$bin_dir" ;; esac
