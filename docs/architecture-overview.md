# Architecture

```
┌──────────────────┐
│  event-generator │  Publishes every 5s:
│  (provided)      │    order → payment → dispute
└────────┬─────────┘  (with duplicates + out-of-order)
         │
         ▼
┌─────────────────┐
│     Kafka       │  Topics:
│   (Redpanda)    │    orders.v1, payments.v1, disputes.v1
└────────┬────────┘
         │
         ▼
┌──────────────────┐     ┌────────────────┐
│   risk-engine    │────▶│   PostgreSQL   │
│   (you build)    │     └────────────────┘
└──────────────────┘
         │
    REST API :3001
```

The event generator produces bundles of correlated events (same `correlationId`). Duplicates are replayed ~10% of the time. Order and payment events are swapped ~20% of the time.

See `docs/event-examples.md` for sample payloads. See `packages/risk-signals` for the scoring functions you'll use.
