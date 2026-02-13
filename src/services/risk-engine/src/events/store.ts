import type { Pool } from "pg";

export interface ProcessedEventRow {
  eventId: string;
  correlationId: string;
  topic: string;
  payload: string;
}

/**
 * Idempotent insert: stores event if not already seen (by event_id).
 * @returns true if row was inserted, false if duplicate (conflict).
 */
export async function insertProcessedEvent(
  pool: Pool,
  row: ProcessedEventRow
): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO processed_events (event_id, correlation_id, topic, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [row.eventId, row.correlationId, row.topic, row.payload]
  );
  return (res.rowCount ?? 0) > 0;
}
