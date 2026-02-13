# Risk Engine — Technical File Overview

This document lists every important file in the risk-engine service, its role in the flow, and the main functions or exports. Files are grouped by layer and follow the order data moves: entry point → database → validation → event storage → Kafka consumer → risk (assemble, score, store, lookup, orchestration) → API.

---

## Entry point

| File | Role in flow | Main exports / behavior |
|------|----------------|--------------------------|
| **`src/index.ts`** | Application bootstrap and HTTP routing. Runs migrations, starts the Kafka consumer in the background, and creates the HTTP server. | **`main()`** — Calls `runMigrations()`, then `startConsumer()` (fire-and-forget), then creates the server. **Server** — For each request: `/health` → 200 + `{ status: "ok" }`; `/risk` (GET) → delegates to `handleGetRisk(req, res, getPool())`; anything else → 404. Listens on `PORT` (default 3001). |

---

## Database layer (`src/db/`)

| File | Role in flow | Main exports / behavior |
|------|----------------|--------------------------|
| **`src/db/pool.ts`** | Creates the single PostgreSQL connection pool used by the whole service. | **`getPool()`** — Returns the shared `pg.Pool` instance. Config from env: `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`. |
| **`src/db/schema.sql`** | DDL only. Defines the two tables and indexes. Idempotent (`IF NOT EXISTS`). | **Tables:** `processed_events` (event_id PK, correlation_id, topic, payload JSONB, created_at); `risk_scores` (merchant_id, order_id, correlation_id, score, signal_breakdown JSONB, expires_at, UNIQUE(merchant_id, order_id)). **Indexes:** correlation_id on processed_events; (merchant_id, order_id) and expires_at on risk_scores. |
| **`src/db/migrate.ts`** | Applies the schema at startup so tables exist before any consumer or API runs. | **`runMigrations()`** — Reads `schema.sql` from disk and executes it with `getPool().query(sql)`. |
| **`src/db/index.ts`** | Public facade for the db layer. | Re-exports **`getPool`**, **`runMigrations`**. |

---

## Validation (`src/validation/`)

| File | Role in flow | Main exports / behavior |
|------|----------------|--------------------------|
| **`src/validation/schemas.ts`** | Joi schemas for the CloudEvents envelope and for each topic’s `data` shape. Used to validate incoming event payloads. | **`envelopeSchema`** — id, correlationId, type, data (required). **`orderDataSchema`**, **`paymentDataSchema`**, **`disputeDataSchema`** — required fields per event type. **`orderEventSchema`**, **`paymentEventSchema`**, **`disputeEventSchema`** — envelope + type + data. |
| **`src/validation/validate.ts`** | Single entry point for event validation. Parses JSON if needed and validates against the schema for the given topic. | **`validateEvent(topic, raw)`** — Returns typed `ValidatedEvent` or throws **`ValidationError`**. **`TOPIC_ORDER`**, **`TOPIC_PAYMENT`**, **`TOPIC_DISPUTE`** — topic name constants. **Types:** `ValidatedOrderEvent`, `ValidatedPaymentEvent`, `ValidatedDisputeEvent`, `ValidatedEvent`. **`ValidationError`** — Error subclass with `topic` and `details`. |
| **`src/validation/index.ts`** | Public facade for validation. | Re-exports **`validateEvent`**, **`ValidationError`**, topic constants, event types, and schemas. |

---

## Event storage (`src/events/`)

| File | Role in flow | Main exports / behavior |
|------|----------------|--------------------------|
| **`src/events/store.ts`** | Idempotent write of a single event into `processed_events`. Used by the Kafka consumer after validation. | **`insertProcessedEvent(pool, row)`** — `row`: eventId, correlationId, topic, payload (string). Runs `INSERT ... ON CONFLICT (event_id) DO NOTHING`. Returns **`true`** if a row was inserted, **`false`** if duplicate. **`ProcessedEventRow`** — type for the row. |
| **`src/events/index.ts`** | Public facade for event storage. | Re-exports **`insertProcessedEvent`**, **`ProcessedEventRow`**. |

---

## Kafka consumer (`src/kafka/`)

| File | Role in flow | Main exports / behavior |
|------|----------------|--------------------------|
| **`src/kafka/consumer.ts`** | Connects to Kafka, subscribes to the three topics, and for each message: validate → store (idempotent) → optionally trigger risk computation. | **`startConsumer()`** — Connects consumer, subscribes to `topicOrders`, `topicPayments`, `topicDisputes` (from env), runs `eachMessage`. **Per message:** (1) Parse value as UTF-8; (2) `validateEvent(topic, raw)`; (3) `insertProcessedEvent(getPool(), { eventId, correlationId, topic, payload: raw })`; (4) if `inserted`, `tryComputeAndStoreRisk(getPool(), correlationId)`; (5) log ok/duplicate and optionally “risk scored”. On **`ValidationError`** logs and skips; other errors rethrown. Config from env: `KAFKA_BROKERS`, `TOPIC_ORDERS`, `TOPIC_PAYMENTS`, `TOPIC_DISPUTES`, `KAFKA_GROUP_ID`. |
| **`src/kafka/index.ts`** | Public facade for Kafka. | Re-exports **`startConsumer`**. |

---

## Risk layer (`src/risk/`)

| File | Role in flow | Main exports / behavior |
|------|----------------|--------------------------|
| **`src/risk/score.ts`** | Pure scoring: given a validated order and payment, computes the 0–100 score and per-signal breakdown using `@chargeflow/risk-signals`. No I/O. | **`computeScore(order, payment)`** — Calls all five signal functions (ipVelocity, deviceReuse, emailDomainReputation, binCountryMismatch, chargebackHistory); sums and clamps to 0–100. Returns **`RiskResult`** { score, signalBreakdown }. **`SignalBreakdown`** — type with the five signal names and numbers. **`RiskResult`** — score + signalBreakdown. |
| **`src/risk/assemble.ts`** | Loads all events for a correlation from `processed_events` and parses them into typed order / payment / dispute. Used when we need to decide if we can score and to pass data into `computeScore`. | **`getCorrelationEvents(pool, correlationId)`** — SELECT by correlation_id; groups by topic; runs `validateEvent(topic, payload)` for each topic present. Returns **`CorrelationEvents`** { order \| null, payment \| null, dispute \| null }. **`CorrelationEvents`** — type. |
| **`src/risk/store.ts`** | Writes or updates the risk score for a (merchant_id, order_id) in `risk_scores`. Used after computing a score. | **`upsertRiskScore(pool, row)`** — row: merchantId, orderId, correlationId, score, signalBreakdown, expiresAt. Runs `INSERT ... ON CONFLICT (merchant_id, order_id) DO UPDATE` so one row per order. **`RiskScoreRow`** — type. |
| **`src/risk/get.ts`** | Reads the latest risk score for a (merchant_id, order_id). Used by the API to answer GET /risk. | **`getRiskByMerchantAndOrder(pool, merchantId, orderId)`** — Single SELECT; returns **`RiskScoreLookup`** { score, signalBreakdown, expiresAt } or **`null`** if not found. **`RiskScoreLookup`** — type. |
| **`src/risk/run.ts`** | Orchestrates “try to compute and store risk for this correlation”: load events → if order + payment, score and upsert. Called by the consumer after a new event is stored. | **`tryComputeAndStoreRisk(pool, correlationId)`** — Calls `getCorrelationEvents`; if both order and payment exist, calls `computeScore`, builds `expiresAt` from **`RISK_SCORE_TTL_HOURS`** (default 24), calls `upsertRiskScore`. Returns **`true`** if a score was written, **`false`** otherwise. |
| **`src/risk/index.ts`** | Public facade for the risk layer. | Re-exports **`computeScore`**, **`getCorrelationEvents`**, **`upsertRiskScore`**, **`getRiskByMerchantAndOrder`**, **`tryComputeAndStoreRisk`** and their related types. |

---

## API layer (`src/api/`)

| File | Role in flow | Main exports / behavior |
|------|----------------|--------------------------|
| **`src/api/risk.ts`** | HTTP handler for GET /risk. Parses query params, calls the risk lookup, and returns JSON with status found / expired / missing. | **`handleGetRisk(req, res, pool)`** — If method !== GET → 405. Parses **merchantId** and **orderId** from query; missing → 400. Calls **`getRiskByMerchantAndOrder(pool, merchantId, orderId)`**. If null → 200 **{ status: "missing" }**. If row: if **expiresAt < now** → 200 **{ status: "expired", score, signalBreakdown, expiresAt }**; else 200 **{ status: "found", score, signalBreakdown, expiresAt }**. Errors → 500. **`sendJson(res, status, body)`** — helper to set JSON content-type and end response. |
| **`src/api/index.ts`** | Public facade for the API. | Re-exports **`handleGetRisk`**. |

---

## Scripts

| File | Role in flow | Main exports / behavior |
|------|----------------|--------------------------|
| **`src/scripts/verify-validation.ts`** | Standalone script to verify that Joi validation works as expected. Not part of the runtime flow. | Run with `bun run verify-validation` (or `bun run ./src/scripts/verify-validation.ts`). Validates a sample order and payment with **`validateEvent`**, then asserts that an invalid payload throws **`ValidationError`**. Used for quick sanity check (e.g. in Docker: `docker compose exec risk-engine bun run verify-validation`). |

---

## Flow summary (which file does what, in order)

1. **`index.ts`** — Runs **`runMigrations()`** (db/migrate + schema.sql), starts **`startConsumer()`** (kafka/consumer), creates HTTP server.
2. **Kafka message arrives** → **consumer.ts** reads value → **validate.ts** **`validateEvent(topic, raw)`** → **events/store.ts** **`insertProcessedEvent`** → if inserted, **risk/run.ts** **`tryComputeAndStoreRisk`**.
3. **`tryComputeAndStoreRisk`** → **risk/assemble.ts** **`getCorrelationEvents`** (reads from **db** via pool) → if order + payment, **risk/score.ts** **`computeScore`** → **risk/store.ts** **`upsertRiskScore`** (writes to **db**).
4. **HTTP GET /risk** → **index.ts** calls **api/risk.ts** **`handleGetRisk`** → **risk/get.ts** **`getRiskByMerchantAndOrder`** (reads from **db**) → response with status found / expired / missing.

All DB access goes through **`getPool()`** from **db/pool.ts**; validation is centralized in **validation/validate.ts**; risk logic is isolated in **risk/** (score = pure, assemble = read, store = write, get = read, run = orchestration); API is a thin HTTP wrapper in **api/risk.ts** that uses **risk/get.ts** and the shared pool.
