FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /run/sshd
COPY sshd_config /etc/ssh/sshd_config
CMD ["/usr/sbin/sshd", "-D", "-e", "-f", "/etc/ssh/sshd_config"]
