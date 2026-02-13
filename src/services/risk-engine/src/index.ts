import http from "node:http";
import { Kafka } from "kafkajs";
import { getPool } from "./db";

const port = Number(process.env.PORT ?? "3001");

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, () => {
  console.log(`risk-engine listening on ${port}`);
});
