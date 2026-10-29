# AOT: `bun build --compile --aot` type checks the program and compiles it to machine code (no JIT). Canary Bun for now:
# --aot is not in a stable release as of 1.4.4. The build must run on the platform it deploys to (amd64 in CI).
FROM oven/bun:canary-slim AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY index.ts ./
RUN bun build --compile --aot index.ts --outfile /boo-display-server

# the binary carries its own runtime: plain Debian is enough
FROM debian:bookworm-slim
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=build /boo-display-server /usr/local/bin/boo-display-server
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 3000
CMD ["boo-display-server"]
