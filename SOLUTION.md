# Risk Engine — Solution Notes

## Overview

The risk-engine consumes order, payment, and dispute events from Kafka, correlates them by `correlationId`, computes a 0–100 risk score using `@chargeflow/risk-signals`, and stores results in PostgreSQL. It exposes a REST API to look up risk by merchant + order (with support for found / expired / missing). Duplicates and out-of-order delivery are handled via idempotency and correlation-based assembly.

## Database Schema

Schema is applied at service startup via a single idempotent SQL file (`src/services/risk-engine/src/db/schema.sql`). No external migration runner is required.

### Tables

**`processed_events`** — Idempotency and raw event storage

| Column          | Type         | Description |
|-----------------|--------------|-------------|
| `event_id`      | TEXT PK      | Event `id` from the payload; prevents processing the same event twice. |
| `correlation_id`| TEXT         | Used to group order + payment + dispute for one flow. |
| `topic`         | TEXT         | Kafka topic (e.g. `orders.v1`, `payments.v1`, `disputes.v1`). |
| `payload`       | JSONB        | Full event payload for reassembly and scoring. |
| `created_at`    | TIMESTAMPTZ  | When the event was first stored. |

- **Index:** `correlation_id` — used to fetch all events for a given correlation when computing or recomputing risk.

**`risk_scores`** — Computed risk per (merchant, order)

| Column           | Type         | Description |
|------------------|--------------|-------------|
| `id`             | UUID PK      | Surrogate key. |
| `merchant_id`    | TEXT         | From order data. |
| `order_id`       | TEXT         | From order data. |
| `correlation_id` | TEXT         | Links back to the event bundle. |
| `score`          | SMALLINT     | 0–100; CHECK constraint enforced. |
| `signal_breakdown` | JSONB      | Per-signal contributions (e.g. `ipVelocity`, `deviceReuse`, `emailDomainReputation`, `binCountryMismatch`, `chargebackHistory`). |
| `expires_at`     | TIMESTAMPTZ  | TTL for “expired” API response (configurable, e.g. env). |
| `created_at`     | TIMESTAMPTZ  | When the score was (last) computed. |

- **Unique:** `(merchant_id, order_id)` — one score per order; upsert when new events arrive for the same correlation.
- **Indexes:** `(merchant_id, order_id)` for API lookup; `expires_at` for optional cleanup or expiry queries.

### Design choices

- **Idempotency:** `processed_events.event_id` is the sole idempotency key. Insert is “insert or ignore” (e.g. `ON CONFLICT (event_id) DO NOTHING` or equivalent in app); duplicates and replays are skipped.
- **Correlation:** All events with the same `correlation_id` are read from `processed_events` and assembled in the engine (order + payment + dispute). When at least order + payment are present, a score can be computed and written/updated in `risk_scores`.
- **Out-of-order:** Recomputing on every new event for a correlation (or when a “complete” bundle is detected) keeps the stored score consistent regardless of event order.
- **TTL:** `expires_at` is set at write time from a configurable TTL (e.g. `RISK_SCORE_TTL_HOURS`). The API can return 410 Gone or “expired” when `now() > expires_at`.

## Modular layout (risk-engine)

- **`src/db/pool.ts`** — PostgreSQL pool creation and `getPool()`.
- **`src/db/schema.sql`** — DDL only; `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` so startup is idempotent.
- **`src/db/migrate.ts`** — Loads and runs `schema.sql` once at startup.
- **`src/db/index.ts`** — Re-exports `getPool` and `runMigrations`.

The HTTP server runs only after `runMigrations()` has completed successfully.

## Running

- `docker compose up --build` — starts Redpanda, Postgres, init-kafka, event-generator, risk-engine, and Redpanda Console.
- If the browser is blocked (e.g. Zscaler), health can be checked from inside the container:
  - `docker compose exec risk-engine bun -e "console.log(await (await fetch('http://127.0.0.1:3001/health')).text())"`

## Next steps (implementation order)

1. **Validation** — Reject malformed or unknown event types; validate required fields per topic.
2. **Kafka consumer** — Subscribe to `orders.v1`, `payments.v1`, `disputes.v1`; insert into `processed_events` with idempotency; trigger correlation assembly.
3. **Scoring** — For each correlation with at least order + payment, call the five risk-signal functions, sum (capped at 100), and upsert `risk_scores` with `signal_breakdown` and `expires_at`.
4. **REST API** — e.g. `GET /risk?merchantId=...&orderId=...` returning score + status (found / expired / missing).
5. **Polish** — Configurable TTL, logging, tests, small logical commits.
