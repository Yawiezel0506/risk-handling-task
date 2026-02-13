FROM oven/bun:latest

WORKDIR /app/services/risk-engine

COPY packages/risk-signals /app/packages/risk-signals
COPY src/services/risk-engine/package.json ./package.json
RUN bun install

COPY src/services/risk-engine/src ./src

CMD ["bun", "run", "dev"]
