FROM debian:bookworm-slim
COPY bun /opt/bun
COPY die /opt/die
COPY server.ts /opt/server.ts
WORKDIR /work
USER 65534:65534
EXPOSE 8080
CMD ["/opt/bun", "/opt/server.ts"]
