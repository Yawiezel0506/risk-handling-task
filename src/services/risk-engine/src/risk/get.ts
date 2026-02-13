import type { Pool } from "pg";
import type { SignalBreakdown } from "./score";

export interface RiskScoreLookup {
  score: number;
  signalBreakdown: SignalBreakdown;
  expiresAt: Date;
}

/**
 * Fetch risk score by merchant and order. Returns null if not found.
 */
export async function getRiskByMerchantAndOrder(
  pool: Pool,
  merchantId: string,
  orderId: string
): Promise<RiskScoreLookup | null> {
  const res = await pool.query<{
    score: number;
    signal_breakdown: SignalBreakdown;
    expires_at: Date;
  }>(
    `SELECT score, signal_breakdown, expires_at
     FROM risk_scores
     WHERE merchant_id = $1 AND order_id = $2`,
    [merchantId, orderId]
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    score: row.score,
    signalBreakdown: row.signal_breakdown,
    expiresAt: row.expires_at,
  };
}
