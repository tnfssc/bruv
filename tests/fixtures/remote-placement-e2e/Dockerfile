# Local, explicitly selected OS/SSH fixture base. No pull or package installation.
ARG PLACEMENT_BASE
FROM ${PLACEMENT_BASE}
USER root
RUN rm -rf /root/.die /fixture /tmp/* && mkdir -p /root/.die/agent /opt/fixture /run/sshd
COPY runtime/ /usr/local/bin/
COPY fake-provider.ts scenario.ts ssh-proxy.ts /opt/fixture/
COPY models.json /root/.die/agent/models.json
COPY subagents.json /root/.die/subagents.json
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/placement-fixture-entrypoint
RUN chmod 755 /usr/local/bin/bun /usr/local/bin/placement-fixture-entrypoint && printf 'isolated placement fixture\n' > /opt/fixture/placement-host
ENV DIE_CODING_AGENT_DIR=/root/.die/agent
ENTRYPOINT ["/usr/local/bin/placement-fixture-entrypoint"]
