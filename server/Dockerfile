FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY index.ts ./
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
