import http from "node:http";
import { handleGetRisk } from "./api";
import { getPool } from "./db";
import { runMigrations } from "./db";
import { startConsumer } from "./kafka";

const port = Number(process.env.PORT ?? "3001");

async function main() {
  await runMigrations();

  startConsumer().catch((err) => {
    console.error("[kafka] consumer error", err);
    process.exit(1);
  });

  const server = http.createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url?.startsWith("/risk") && req.method === "GET") {
      handleGetRisk(req, res, getPool());
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, () => {
    console.log(`risk-engine listening on ${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
