#!/bin/sh
set -eu
# Only host private key and authorized client public key enter this container.
install -m 600 /keys/hostkey /run/sshd/hostkey
install -m 600 /keys/client.pub /run/sshd/client.pub
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
