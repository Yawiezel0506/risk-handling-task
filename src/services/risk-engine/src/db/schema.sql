-- Idempotency and raw event storage: one row per ingested event.
-- Duplicate events (same event.id) are ignored on insert.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id    TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  topic       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processed_events_correlation_id
  ON processed_events (correlation_id);

-- Computed risk scores per (merchant, order). Upserted when we have enough events for a correlation.
CREATE TABLE IF NOT EXISTS risk_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     TEXT NOT NULL,
  order_id        TEXT NOT NULL,
  correlation_id  TEXT NOT NULL,
  score           SMALLINT NOT NULL CHECK (score >= 0 AND score <= 100),
  signal_breakdown JSONB NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_risk_scores_merchant_order
  ON risk_scores (merchant_id, order_id);

CREATE INDEX IF NOT EXISTS idx_risk_scores_expires_at
  ON risk_scores (expires_at);
