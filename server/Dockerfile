FROM oven/bun:1
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY index.ts ./
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
