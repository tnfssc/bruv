# Local, explicitly selected OS/SSH fixture base. No pull or package installation.
ARG PLACEMENT_BASE
FROM ${PLACEMENT_BASE}
USER root
RUN rm -rf /root/.bruv /fixture /tmp/* && mkdir -p /root/.bruv/agent /opt/fixture /run/sshd
COPY runtime/ /usr/local/bin/
COPY fake-provider.ts scenario.ts ssh-proxy.ts /opt/fixture/
COPY models.json /root/.bruv/agent/models.json
COPY subagents.json /root/.bruv/subagents.json
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/placement-fixture-entrypoint
RUN chmod 755 /usr/local/bin/bun /usr/local/bin/placement-fixture-entrypoint && printf 'isolated placement fixture\n' > /opt/fixture/placement-host
ENV BRUV_CODING_AGENT_DIR=/root/.bruv/agent
ENTRYPOINT ["/usr/local/bin/placement-fixture-entrypoint"]
