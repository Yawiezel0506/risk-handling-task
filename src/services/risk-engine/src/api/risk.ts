import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { getRiskByMerchantAndOrder } from "../risk/get";

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * GET /risk?merchantId=...&orderId=...
 * Responds: found (score + breakdown + expiresAt) | expired (same, but status expired) | missing.
 */
export function handleGetRisk(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool
): void {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const merchantId = url.searchParams.get("merchantId")?.trim();
  const orderId = url.searchParams.get("orderId")?.trim();

  if (!merchantId || !orderId) {
    sendJson(res, 400, {
      error: "Missing query params",
      required: ["merchantId", "orderId"],
    });
    return;
  }

  getRiskByMerchantAndOrder(pool, merchantId, orderId)
    .then((row) => {
      if (!row) {
        sendJson(res, 200, { status: "missing" });
        return;
      }
      const expired = row.expiresAt.getTime() < Date.now();
      sendJson(res, 200, {
        status: expired ? "expired" : "found",
        score: row.score,
        signalBreakdown: row.signalBreakdown,
        expiresAt: row.expiresAt.toISOString(),
      });
    })
    .catch((err) => {
      console.error("[api] getRisk error", err);
      sendJson(res, 500, { error: "Internal server error" });
    });
}
