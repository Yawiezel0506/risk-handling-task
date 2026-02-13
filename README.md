# Chargeflow — Risk Engine

> Senior Backend Engineer take-home. ~4 hours.

## What you're building

A **risk-engine** service that consumes order/payment/dispute events from Kafka, computes risk scores, and exposes a REST API.

```text
┌──────────────────┐     ┌─────────────┐     ┌──────────────────┐
│  event-generator │────▶│    Kafka    │────▶│   risk-engine    │
│  (provided)      │     │  (Redpanda) │     │   (you build)    │
└──────────────────┘     └─────────────┘     └────────┬─────────┘
                                                      │
                                              ┌───────▼────────┐
                                              │   PostgreSQL   │
                                              └────────────────┘
```

The event generator publishes realistic events with **duplicates** and **out-of-order delivery** enabled. Your service needs to handle that.

## What we provide

| Component                      | Description                                                     |
| ------------------------------ | --------------------------------------------------------------- |
| `docker-compose.yml`           | Redpanda (Kafka) + PostgreSQL + event generator                 |
| `packages/risk-signals`        | 5 deterministic scoring functions (each returns 0–20)           |
| `src/services/event-generator` | Publishes order → payment → dispute bundles every 5s            |
| `src/services/risk-engine`     | **Bare scaffold.** Dockerfile, package.json, empty entry point. |
| `docs/event-examples.md`       | Sample event payloads                                           |

## What you implement

### risk-engine service

**Kafka consumer** — subscribe to the event topics, validate, correlate, compute.

**Risk scoring** — use the 5 functions from `@chargeflow/risk-signals`. Each returns 0–20; aggregate into a 0–100 score. Track which signals contributed.

**REST API** — design the API yourself. At minimum: query a risk score by merchant + order, with clear status handling (found / expired / missing). Scores expire after a configurable TTL.

**Data layer** — PostgreSQL is available. Design your own schema.

**Validation** — events need validation. Choose your approach (Zod, JSON Schema, io-ts, or whatever you prefer).

### UI (optional, LLM-assisted)

Build a small live dashboard that shows what's happening in the system — events flowing in, scores being computed, etc. Use an LLM to help you build it fast. This is a showcase, not a test of frontend skill.

## Quick start

```bash
cp env.example .env
docker compose up --build
```

| URL                   | What                        |
| --------------------- | --------------------------- |
| http://localhost:8080 | Redpanda Console (Kafka UI) |
| http://localhost:3001 | risk-engine (your service)  |

## What we evaluate

1. **API design** — resource modeling, status codes, error format, documentation.
2. **Application layering** — separation of concerns, clean boundaries, testability.
3. **Production readiness** — the starter code and infrastructure have rough edges. We want to see you identify and fix them.
4. **Design decisions** — choices have trade-offs. Show your reasoning.

## Deliverables

1. Working `risk-engine` — `docker compose up --build` and it runs.
2. A short `SOLUTION.md` — what you built, what you changed, why. Prefer diagrams over walls of text. Keep it sharp.
3. Small, logical commits — `feat:`, `fix:`, `chore:`, etc.

## Submission

Private clone/fork → add **`moshem-cf`** as collaborator → push.

## Questions?

Make a reasonable assumption, document it, move on. We value seeing how you think through ambiguity.
