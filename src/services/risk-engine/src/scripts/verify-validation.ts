/**
 * Run inside the container to verify Joi validation works:
 *   docker compose exec risk-engine bun run verify-validation
 */
import { validateEvent, ValidationError, TOPIC_ORDER, TOPIC_PAYMENT } from "../validation";

const validOrder = {
  id: "e1",
  correlationId: "c1",
  type: "order.created",
  data: {
    order_id: "ord_1",
    txn_id: "txn_1",
    merchant_id: "m1",
    customer_id: "c1",
    amt: 10,
    currency: "USD",
    email: "a@b.com",
    billing_country: "US",
    ip_address: "1.2.3.4",
    device_fingerprint: "fp_1",
    ts: 123,
  },
};

const validPayment = {
  id: "e2",
  correlationId: "c1",
  type: "payment.authorized",
  data: {
    orderId: "ord_1",
    paymentId: "pay_1",
    amount: 10,
    currency: "USD",
    binCountry: "US",
    createdAt: "2026-01-15T12:00:00.000Z",
  },
};

console.log("Validating order event...");
const order = validateEvent(TOPIC_ORDER, validOrder);
console.log("  order id:", order.id, "order_id:", order.data.order_id);

console.log("Validating payment event...");
const payment = validateEvent(TOPIC_PAYMENT, validPayment);
console.log("  payment id:", payment.id, "orderId:", payment.data.orderId);

console.log("Validating invalid payload (expect ValidationError)...");
try {
  validateEvent(TOPIC_ORDER, { id: "x", correlationId: "c", type: "order.created", data: { amt: -1 } });
  console.log("  FAIL: should have thrown");
  process.exit(1);
} catch (err) {
  if (err instanceof ValidationError) {
    console.log("  caught ValidationError:", err.message.slice(0, 60) + "...");
  } else {
    throw err;
  }
}

console.log("\nValidation OK.");
