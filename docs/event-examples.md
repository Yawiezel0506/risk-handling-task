# Event Samples

These are examples of the events published by the event generator. Open Redpanda Console at http://localhost:8080 to see live data.

## orders.v1

```json
{
  "id": "a1b2c3d4-...",
  "source": "com.chargeflow.event-generator",
  "type": "order.created",
  "specversion": "1.0",
  "time": "2026-01-15T12:22:01.000Z",
  "correlationId": "f8e7d6c5-...",
  "data": {
    "order_id": "ord_92b1fa1e",
    "txn_id": "txn_3e7d9a12",
    "merchant_id": "merch_acme_store",
    "customer_id": "cust_003",
    "amt": 119.99,
    "currency": "USD",
    "email": "alice@gmail.com",
    "billing_country": "US",
    "ip_address": "203.0.113.7",
    "device_fingerprint": "fp_a1b2c3d4",
    "ts": 1736913435123
  }
}
```

## payments.v1

```json
{
  "id": "b2c3d4e5-...",
  "source": "com.chargeflow.event-generator",
  "type": "payment.authorized",
  "specversion": "1.0",
  "time": "2026-01-15T12:22:02.000Z",
  "correlationId": "f8e7d6c5-...",
  "data": {
    "orderId": "ord_92b1fa1e",
    "paymentId": "pay_1b2c3d4e",
    "amount": 119.99,
    "currency": "USD",
    "binCountry": "CA",
    "createdAt": "2026-01-15T12:22:02.000Z"
  }
}
```

## disputes.v1

```json
{
  "id": "c3d4e5f6-...",
  "source": "com.chargeflow.event-generator",
  "type": "dispute.opened",
  "specversion": "1.0",
  "time": "2026-01-15T12:25:02.501Z",
  "correlationId": "f8e7d6c5-...",
  "data": {
    "order_id": "ord_92b1fa1e",
    "reason_code": "FRAUD",
    "amt": 119.99,
    "openedAt": "2026-01-15T12:25:02.501Z",
    "note": "customer says unauthorized"
  }
}
```
