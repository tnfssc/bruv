#!/bin/sh
# Install bruv: Pi plus the bruv package. bruv 0.x was installed from this same URL,
# so running it again is also the upgrade from 0.x.
set -eu
package=${BRUV_PACKAGE:-git:github.com/tnfssc/bruv}
bin=${BRUV_INSTALL_DIR:-$HOME/.local/bin}
say() { printf '%s\n' "$*"; }
fail() { printf 'bruv install: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" != 0 ] || fail 'Run as your normal user, not root.'
command -v curl >/dev/null 2>&1 || fail 'curl is required.'

find_pi() {
  command -v pi 2>/dev/null && return 0
  agent=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
  for path in "$HOME/.local/bin/pi" "$HOME/bin/pi" "$agent/bin/pi" "$agent/install/bin/pi"; do
    [ -x "$path" ] && printf '%s\n' "$path" && return 0
  done
  return 1
}
ask() {
  ( : <>/dev/tty ) 2>/dev/null || return 1
  printf '%s [Y/n] ' "$1" >/dev/tty
  read -r answer </dev/tty || return 1
  case "$answer" in n | N | no | NO) return 1 ;; esac
}

if ! pi=$(find_pi); then
  say 'Installing Pi...'
  # Through cat, Pi's installer finishes instead of offering to start pi.
  curl -fsSL https://pi.dev/install.sh | sh | cat
  pi=$(find_pi) || fail 'Pi is installed, but this shell cannot find it yet. Open a new terminal and run this again.'
fi
say "Adding bruv to Pi ($pi)..."
"$pi" install "$package"

old=0
start=pi
[ -d "$HOME/.bruv/agent" ] && old=1
if [ -f "$bin/bruv" ] && ! grep -q 'bruv-pi-command' "$bin/bruv" 2>/dev/null; then
  old=1
  if ask "Replace bruv 0.x in $bin with a bruv command that starts Pi? The old files move to ~/.bruv/0.x."; then
    mkdir -p "$HOME/.bruv/0.x"
    for name in bruv bruv-claude-compat; do
      if [ -e "$bin/$name" ]; then mv -f "$bin/$name" "$HOME/.bruv/0.x/$name"; fi
    done
    printf '#!/bin/sh\n# bruv-pi-command: bruv runs inside Pi now.\nexec "%s" "$@"\n' "$pi" >"$bin/bruv"
    chmod 755 "$bin/bruv"
    start=bruv
    say "bruv now starts Pi. The old binaries are in ~/.bruv/0.x."
  else
    say "Kept bruv 0.x in $bin. Start the new bruv with: pi"
  fi
fi

say ''
say "Done. Start it with: $start"
if [ "$old" = 1 ]; then
  say 'Then run /bruv-migrate to bring your sign-in, settings, agent models and sessions from bruv 0.x.'
  say 'Using T3 Code? Turn on its Pi provider (binary: pi) and turn off the "bruv (not Claude)" provider.'
else
  say 'Then sign in with /login and run /bruv-setup.'
  say 'Using T3 Code? Turn on its Pi provider (binary: pi).'
fi
