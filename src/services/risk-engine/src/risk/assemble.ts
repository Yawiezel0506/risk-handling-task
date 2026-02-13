import type { Pool } from "pg";
import { validateEvent } from "../validation";
import { TOPIC_ORDER, TOPIC_PAYMENT, TOPIC_DISPUTE } from "../validation";
import type {
  ValidatedOrderEvent,
  ValidatedPaymentEvent,
  ValidatedDisputeEvent,
} from "../validation";

export interface CorrelationEvents {
  order: ValidatedOrderEvent | null;
  payment: ValidatedPaymentEvent | null;
  dispute: ValidatedDisputeEvent | null;
}

/**
 * Load all processed events for a correlation and parse into typed order/payment/dispute.
 * Uses latest event per topic when multiple exist (e.g. replays).
 */
export async function getCorrelationEvents(
  pool: Pool,
  correlationId: string
): Promise<CorrelationEvents> {
  const res = await pool.query<{ topic: string; payload: unknown }>(
    `SELECT topic, payload FROM processed_events WHERE correlation_id = $1`,
    [correlationId]
  );

  const byTopic: Record<string, unknown> = {};
  for (const row of res.rows) {
    byTopic[row.topic] = row.payload;
  }

  let order: ValidatedOrderEvent | null = null;
  let payment: ValidatedPaymentEvent | null = null;
  let dispute: ValidatedDisputeEvent | null = null;

  if (byTopic[TOPIC_ORDER]) {
    order = validateEvent(TOPIC_ORDER, byTopic[TOPIC_ORDER]) as ValidatedOrderEvent;
  }
  if (byTopic[TOPIC_PAYMENT]) {
    payment = validateEvent(TOPIC_PAYMENT, byTopic[TOPIC_PAYMENT]) as ValidatedPaymentEvent;
  }
  if (byTopic[TOPIC_DISPUTE]) {
    dispute = validateEvent(TOPIC_DISPUTE, byTopic[TOPIC_DISPUTE]) as ValidatedDisputeEvent;
  }

  return { order, payment, dispute };
}
