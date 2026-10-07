#!/usr/bin/env bash
set -euo pipefail
packages=(tmux ffmpeg)
case "${1:-}" in
  --native-audio) packages+=(clang pkg-config meson ninja-build libabsl-dev libpulse-dev libjson-c-dev libglib2.0-dev pulseaudio pulseaudio-utils) ;;
  "") ;;
  *) echo "Usage: $0 [--native-audio]" >&2; exit 2 ;;
esac
missing=()
for package in "${packages[@]}"; do
  if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" != "install ok installed" ]]; then
    missing+=("$package")
  fi
done
if (( ${#missing[@]} )); then
  # Hosted Noble includes unrelated third-party apt feeds. These fixture tools
  # all come from Ubuntu; don't refresh other vendors just to install ffmpeg.
  sources=/etc/apt/sources.list.d/ubuntu.sources
  test -s "$sources" || { echo "Expected hosted Ubuntu 24.04 sources: $sources" >&2; exit 1; }
  cache="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/bruv-apt-cache"
  mkdir -p "$cache"
  apt_options=(-o "Dir::Cache::archives=$cache" -o APT::Keep-Downloaded-Packages=true -o "Dir::Etc::sourcelist=$sources" -o Dir::Etc::sourceparts=- -o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o APT::Update::Error-Mode=any)
  sudo timeout 90 apt-get "${apt_options[@]}" update
  sudo timeout 180 apt-get "${apt_options[@]}" install -y --no-install-recommends "${missing[@]}"
fi
tmux -V
ffmpeg -version
echo "CPU slots: $(getconf _NPROCESSORS_ONLN)"
