import type { Pool } from "pg";
import type { SignalBreakdown } from "./score";

export interface RiskScoreRow {
  merchantId: string;
  orderId: string;
  correlationId: string;
  score: number;
  signalBreakdown: SignalBreakdown;
  expiresAt: Date;
}

/**
 * Upsert risk_scores for (merchant_id, order_id). One row per order.
 */
export async function upsertRiskScore(
  pool: Pool,
  row: RiskScoreRow
): Promise<void> {
  await pool.query(
    `INSERT INTO risk_scores (merchant_id, order_id, correlation_id, score, signal_breakdown, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (merchant_id, order_id)
     DO UPDATE SET
       correlation_id = EXCLUDED.correlation_id,
       score = EXCLUDED.score,
       signal_breakdown = EXCLUDED.signal_breakdown,
       expires_at = EXCLUDED.expires_at`,
    [
      row.merchantId,
      row.orderId,
      row.correlationId,
      row.score,
      JSON.stringify(row.signalBreakdown),
      row.expiresAt,
    ]
  );
}
