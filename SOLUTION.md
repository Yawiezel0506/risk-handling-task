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

## Kafka consumer (consume + validate + store + score)

Single consumer subscribes to all three topics. For each message: validate → idempotent insert into `processed_events` → if new event, try to compute and store risk for that correlation.

- **`src/kafka/consumer.ts`** — Kafka client and consumer; config from env. `eachMessage`: parse, `validateEvent`, `insertProcessedEvent`; if inserted, `tryComputeAndStoreRisk(correlationId)`; log `[kafka] ok` and optionally `[kafka] risk scored`.
- **`src/kafka/index.ts`** — Re-exports `startConsumer`.

Started in parallel with the HTTP server after `runMigrations()`. Depends on `init-kafka` so topics exist.

## Risk scoring (modular)

When a **new** event is stored for a correlation, the engine tries to compute risk for that correlation. If both order and payment events exist, it scores and upserts into `risk_scores`.

- **`src/risk/score.ts`** — Pure: `computeScore(order, payment)` using all five `@chargeflow/risk-signals` (ipVelocity, deviceReuse, emailDomainReputation, binCountryMismatch, chargebackHistory). Sum 0–20 each → clamp 0–100; returns `{ score, signalBreakdown }`. No history DB yet: ipVelocity and deviceReuse use empty lists (score 0).
- **`src/risk/assemble.ts`** — `getCorrelationEvents(pool, correlationId)`: loads rows from `processed_events` by `correlation_id`, parses payloads with `validateEvent`, returns `{ order?, payment?, dispute? }`.
- **`src/risk/store.ts`** — `upsertRiskScore(pool, row)`: INSERT … ON CONFLICT (merchant_id, order_id) DO UPDATE; row includes `expires_at` (TTL).
- **`src/risk/run.ts`** — `tryComputeAndStoreRisk(pool, correlationId)`: get events; if order + payment, compute score, set `expires_at` from `RISK_SCORE_TTL_HOURS` (default 24), upsert; returns true if score was stored.
- **`src/risk/index.ts`** — Re-exports score, assemble, store, run.

Consumer calls `tryComputeAndStoreRisk` only after a **new** event (inserted), so we don’t recompute on every duplicate.

## REST API (risk lookup)

**`GET /risk?merchantId=...&orderId=...`** — Look up risk by merchant and order.

- **`src/risk/get.ts`** — `getRiskByMerchantAndOrder(pool, merchantId, orderId)`: single SELECT, returns `{ score, signalBreakdown, expiresAt } | null`.
- **`src/api/risk.ts`** — `handleGetRisk(req, res, pool)`: parses query params; calls get; responds 200 with `status: "found" | "expired" | "missing"`. For found/expired includes `score`, `signalBreakdown`, `expiresAt` (ISO). Missing params → 400; other methods → 405.
- **`src/api/index.ts`** — Re-exports `handleGetRisk`.
- **`src/index.ts`** — For `GET` and URL starting with `/risk`, delegates to `handleGetRisk(req, res, getPool())`.

## Modular layout (risk-engine)

- **`src/db/pool.ts`** — PostgreSQL pool creation and `getPool()`.
- **`src/db/schema.sql`** — DDL only; `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` so startup is idempotent.
- **`src/db/migrate.ts`** — Loads and runs `schema.sql` once at startup.
- **`src/db/index.ts`** — Re-exports `getPool` and `runMigrations`.
- **`src/events/store.ts`** — `insertProcessedEvent(pool, row)`; idempotent by `event_id`.
- **`src/events/index.ts`** — Re-exports events store.
- **`src/risk/*`** — score (pure), assemble (load by correlation), store (upsert risk_scores), run (tryComputeAndStoreRisk).
- **`src/kafka/consumer.ts`** — Consume → validate → insert event → try score.
- **`src/kafka/index.ts`** — Re-exports `startConsumer`.

HTTP server and consumer start after `runMigrations()`; consumer runs in background.

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
   - **Consumer:** Logs show `[kafka] ok` (with `stored: "new"` or `"duplicate"`) and `[kafka] risk scored` when a correlation has order + payment and a score is written.
   - **Risk scores in DB:**  
     `docker compose exec postgres psql -U chargeflow -d chargeflow -c 'SELECT merchant_id, order_id, score, expires_at FROM risk_scores LIMIT 5;'`  
     Should show rows once correlations have both order and payment.
   - **Risk API:**  
     `curl "http://localhost:3001/risk?merchantId=merch_globex&orderId=ord_7efa68db"`  
     Expected: `{"status":"found","score":55,"signalBreakdown":{...},"expiresAt":"..."}` (or `expired` / `missing`).

## Next steps (implementation order)

1. ~~**Validation**~~ — Done (Joi schemas per topic; `validateEvent(topic, raw)`).
2. ~~**Kafka consumer + idempotent events**~~ — Done.
3. ~~**Scoring**~~ — Done. On each new event, `tryComputeAndStoreRisk` loads correlation; if order + payment, computes via five risk-signals and upserts `risk_scores` with `signal_breakdown` and `expires_at` (env `RISK_SCORE_TTL_HOURS`).
4. ~~**REST API**~~ — Done. `GET /risk?merchantId=...&orderId=...` returns 200 with `status` (found / expired / missing) and when found/expired: `score`, `signalBreakdown`, `expiresAt`.
5. **Polish** — Configurable TTL, logging, tests, small logical commits.
