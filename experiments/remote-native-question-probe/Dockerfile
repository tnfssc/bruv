FROM debian:bookworm-slim
COPY bun /opt/bun
COPY die /opt/die
COPY server.ts /opt/server.ts
COPY policy.ts /opt/policy.ts
RUN mkdir /work && chown 65534:65534 /work
WORKDIR /work
USER 65534:65534
EXPOSE 8080
CMD ["/opt/bun","/opt/server.ts"]
