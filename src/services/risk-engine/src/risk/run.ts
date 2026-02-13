import type { Pool } from "pg";
import { getCorrelationEvents } from "./assemble";
import { computeScore } from "./score";
import { upsertRiskScore } from "./store";

const TTL_HOURS = Number(process.env.RISK_SCORE_TTL_HOURS ?? "24");

/**
 * If this correlation has order + payment, compute risk and upsert into risk_scores.
 * No-op otherwise (e.g. only dispute so far). Idempotent.
 */
export async function tryComputeAndStoreRisk(
  pool: Pool,
  correlationId: string
): Promise<boolean> {
  const { order, payment } = await getCorrelationEvents(pool, correlationId);
  if (!order || !payment) return false;

  const { score, signalBreakdown } = computeScore(order, payment);
  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);

  await upsertRiskScore(pool, {
    merchantId: order.data.merchant_id,
    orderId: order.data.order_id,
    correlationId,
    score,
    signalBreakdown,
    expiresAt,
  });

  return true;
}
