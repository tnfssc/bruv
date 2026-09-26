FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /run/sshd
COPY sshd_config /etc/ssh/sshd_config
COPY sshd-entrypoint.sh /usr/local/bin/ssh-fixture-entrypoint
RUN chmod 755 /usr/local/bin/ssh-fixture-entrypoint
CMD ["/usr/local/bin/ssh-fixture-entrypoint"]
