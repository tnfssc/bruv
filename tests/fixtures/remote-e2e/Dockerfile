FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY bun /usr/local/bin/bun
COPY bruv /usr/local/bin/bruv
COPY fake-provider.ts /opt/fixture/fake-provider.ts
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/remote-fixture-entrypoint
RUN chmod 755 /usr/local/bin/bun /usr/local/bin/bruv /usr/local/bin/remote-fixture-entrypoint && mkdir -p /fixture/repo /root/.bruv/agent && git -C /fixture/repo init -q && git -C /fixture/repo config user.email fixture@example.invalid && git -C /fixture/repo config user.name Fixture && printf 'fixture base\n' > /fixture/repo/README.md && git -C /fixture/repo add README.md && git -C /fixture/repo commit -qm initial
COPY models.json /root/.bruv/agent/models.json
COPY subagents.json /root/.bruv/subagents.json
ENV BRUV_CODING_AGENT_DIR=/root/.bruv/agent
ENTRYPOINT ["/usr/local/bin/remote-fixture-entrypoint"]
