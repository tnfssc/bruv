#!/bin/sh
set -eu
mkdir -p /run/sshd
install -m 600 /keys/hostkey /run/sshd/hostkey
install -m 600 /keys/client.pub /run/sshd/client.pub
bun /opt/fixture/fake-provider.ts >>/tmp/provider.log 2>&1 &
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
