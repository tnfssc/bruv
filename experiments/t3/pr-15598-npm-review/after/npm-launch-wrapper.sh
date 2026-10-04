#!/bin/bash
# Supervise only this trial's process group; run the installed npm launcher.
/usr/bin/setsid /usr/bin/strace -f -e trace=execve,write -s 2048 -o /var/tmp/t3-pr-15598-npm-after/worker-trace.log /home/tnfssc/.local/share/mise/installs/node/24.21.0/bin/node /var/tmp/t3-pr-15598-npm-after/stage/dist/node_modules/t3/bin/t3.js "$@" &
child=$!
trap 'kill -TERM -- "-$child" 2>/dev/null; wait "$child"; exit 143' TERM INT
wait "$child"
