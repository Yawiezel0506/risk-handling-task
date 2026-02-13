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

## Validation (Joi)

Event payloads are validated with **Joi** before processing. Unknown topics are rejected; malformed or missing required fields throw `ValidationError` (with topic and details).

- **`src/validation/schemas.ts`** — CloudEvents envelope + per-topic data schemas: `orderEventSchema` (order.created), `paymentEventSchema` (payment.authorized), `disputeEventSchema` (dispute.opened). Required fields and types (e.g. `email`, `amt`, `order_id`) are enforced.
- **`src/validation/validate.ts`** — `validateEvent(topic, raw)` parses JSON if needed, validates against the topic schema, returns typed `ValidatedEvent` or throws `ValidationError`. Exports `TOPIC_ORDER`, `TOPIC_PAYMENT`, `TOPIC_DISPUTE` and types `ValidatedOrderEvent`, `ValidatedPaymentEvent`, `ValidatedDisputeEvent`.
- **`src/validation/index.ts`** — Re-exports schemas, `validateEvent`, `ValidationError`, and types.

The Kafka consumer calls `validateEvent(topic, message.value)` and skips or logs invalid events.

## Kafka consumer (consume + validate)

Single consumer subscribes to all three topics, validates each message, logs ok or invalid. No DB write yet.

- **`src/kafka/consumer.ts`** — Kafka client and consumer; config from env (`KAFKA_BROKERS`, `TOPIC_ORDERS`, `TOPIC_PAYMENTS`, `TOPIC_DISPUTES`, `KAFKA_GROUP_ID`). `startConsumer()`: connect, subscribe, `eachMessage` → parse value, `validateEvent(topic, raw)`, log `[kafka] ok` or `[kafka] invalid`; on non-validation errors rethrow.
- **`src/kafka/index.ts`** — Re-exports `startConsumer`.

Started in parallel with the HTTP server (fire-and-forget after `runMigrations()`). risk-engine now depends on `init-kafka` (completed) so topics exist before consume.

## Modular layout (risk-engine)

- **`src/db/pool.ts`** — PostgreSQL pool creation and `getPool()`.
- **`src/db/schema.sql`** — DDL only; `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` so startup is idempotent.
- **`src/db/migrate.ts`** — Loads and runs `schema.sql` once at startup.
- **`src/db/index.ts`** — Re-exports `getPool` and `runMigrations`.
- **`src/kafka/consumer.ts`** — Kafka consumer; `startConsumer()` subscribes to the three topics and validates each message.
- **`src/kafka/index.ts`** — Re-exports `startConsumer`.

The HTTP server and consumer start after `runMigrations()`; consumer runs in the background.

## Running

- `docker compose up --build` — starts Redpanda, Postgres, init-kafka, event-generator, risk-engine, and Redpanda Console.
- If the browser is blocked (e.g. Zscaler), health can be checked from inside the container:
  - `docker compose exec risk-engine bun -e "console.log(await (await fetch('http://127.0.0.1:3001/health')).text())"`

## After every change: verify

1. **Run:** `docker compose up --build`
2. **What you should see:**
   - All containers start; `risk-engine` logs: `[kafka] consumer running` then `risk-engine listening on 3001`. Shortly after, `[kafka] ok` lines as events are consumed and validated (event-generator emits every ~5s).
   - Optional: `event-generator` logs `chargeflow-event-generator connected`; you may see `TimeoutNegativeWarning` (harmless).
3. **Check inside Docker:**
   - **Health:**  
     `docker compose exec risk-engine bun -e "console.log(await (await fetch('http://127.0.0.1:3001/health')).text())"`  
     Expected: `{"status":"ok"}`
   - **Validation (Joi):**  
     `docker compose exec risk-engine bun run verify-validation`  
     Expected: lines like `Validating order event...`, `order id: e1`, then `Validation OK.`
   - **Consumer:** With stack up, risk-engine logs should show `[kafka] ok` every few seconds (one per event). No `[kafka] invalid` unless event-generator sends bad data.

## Next steps (implementation order)

1. ~~**Validation**~~ — Done (Joi schemas per topic; `validateEvent(topic, raw)`).
2. ~~**Kafka consumer (consume + validate)**~~ — Done. Next: insert into `processed_events` (idempotent), then correlation + scoring.
3. **Scoring** — For each correlation with at least order + payment, call the five risk-signal functions, sum (capped at 100), and upsert `risk_scores` with `signal_breakdown` and `expires_at`.
4. **REST API** — e.g. `GET /risk?merchantId=...&orderId=...` returning score + status (found / expired / missing).
5. **Polish** — Configurable TTL, logging, tests, small logical commits.
