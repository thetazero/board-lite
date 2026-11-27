# board-lite as a public website, the Rust server: one static binary with the
# pages inside it, and nothing else. See docs/rust-server.md.
FROM node:22-slim AS pages
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY web ./web
COPY docs/rules.md ./docs/rules.md
COPY rust/gen ./rust/gen
RUN NODE_NO_WARNINGS=1 node rust/gen/gen.ts

FROM rust:1.100-alpine AS build
RUN apk add --no-cache musl-dev && mkdir /data
WORKDIR /app/rust
COPY rust/Cargo.toml rust/Cargo.lock ./
# The dependencies in a layer of their own: they rarely change.
RUN mkdir -p src/bin && touch src/lib.rs && echo 'fn main() {}' | tee src/main.rs src/bin/parity.rs && cargo build --release --locked --bin board-lite
COPY --from=pages /app/rust/generated ./generated
COPY rust/src ./src
RUN touch src/*.rs && cargo build --release --locked --bin board-lite

FROM scratch
COPY --from=build --chown=1000:1000 /data /data
COPY --from=build /app/rust/target/release/board-lite /board-lite
ENV BOARD_LITE_DATA=/data PORT=8080
USER 1000:1000
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["/board-lite", "--health"]
CMD ["/board-lite"]
