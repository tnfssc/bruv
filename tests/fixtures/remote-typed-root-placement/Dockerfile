# Cached local SSH/git base only. No package installs, pulls, or server tmux.
ARG ROOT_PLACEMENT_BASE
FROM ${ROOT_PLACEMENT_BASE}
USER root
RUN rm -rf /root/.bruv /fixture /tmp/* && mkdir -p /root/.bruv/agent /opt/fixture /run/sshd
COPY runtime/ /usr/local/bin/
COPY fake-provider.ts scenario.ts ssh-proxy.ts /opt/fixture/
COPY models.json settings.json /root/.bruv/agent/
COPY subagents.json /root/.bruv/subagents.json
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/root-placement-fixture-entrypoint
RUN chmod 755 /usr/local/bin/bun /usr/local/bin/root-placement-fixture-entrypoint && printf 'isolated typed root fixture\n' > /opt/fixture/typed-root-host
ENV BRUV_CODING_AGENT_DIR=/root/.bruv/agent
ENTRYPOINT ["/usr/local/bin/root-placement-fixture-entrypoint"]
