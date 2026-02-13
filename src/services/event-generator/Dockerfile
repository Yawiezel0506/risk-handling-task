FROM oven/bun:latest

WORKDIR /app/services/event-generator

COPY src/services/event-generator/package.json ./package.json
RUN bun install

COPY src/services/event-generator/src ./src

CMD ["bun", "run", "dev"]
