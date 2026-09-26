FROM debian:bookworm-slim
COPY bun /opt/bun
COPY die /opt/die
COPY owner.ts /opt/owner.ts
RUN mkdir /work && chown 65534:65534 /work
WORKDIR /work
USER 65534:65534
CMD ["/opt/bun","/opt/owner.ts"]
