import { v4 as uuidv4 } from "uuid";

const randomItem = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const randomAmount = (): number => Number((Math.random() * 200 + 5).toFixed(2));

const emails = [
  "alice@gmail.com",
  "bob@corp.example",
  "fraudster@mailinator.com",
  "user@outlook.com",
  "jane@tempmail.com",
];

const countries = ["US", "CA", "GB", "FR", "DE"];

const ips = [
  "192.168.1.42",
  "10.0.0.15",
  "203.0.113.7",
  "172.16.0.99",
  "198.51.100.3",
  "100.24.58.112",
];

const devices = [
  "fp_a1b2c3d4",
  "fp_e5f6g7h8",
  "fp_i9j0k1l2",
  "fp_m3n4o5p6",
];

const merchants = [
  "merch_acme_store",
  "merch_widget_co",
  "merch_globex",
];

const customers = [
  "cust_001",
  "cust_002",
  "cust_003",
  "cust_004",
  "cust_005",
];

const generateBaseEvent = (type: string, correlationId?: string) => ({
  id: uuidv4(),
  source: "com.chargeflow.event-generator",
  type,
  specversion: "1.0" as const,
  time: new Date().toISOString(),
  correlationId: correlationId || uuidv4(),
});

export const buildOrderEvt = (correlationId?: string) => {
  const orderId = `ord_${uuidv4().slice(0, 8)}`;
  return {
    ...generateBaseEvent("order.created", correlationId),
    data: {
      order_id: orderId,
      txn_id: `txn_${uuidv4().slice(0, 8)}`,
      merchant_id: randomItem(merchants),
      customer_id: randomItem(customers),
      amt: randomAmount(),
      currency: "USD",
      email: randomItem(emails),
      billing_country: randomItem(countries),
      ip_address: randomItem(ips),
      device_fingerprint: randomItem(devices),
      ts: Date.now(),
    },
  };
};

export const buildPaymentEvt = (orderId?: string, correlationId?: string) => {
  return {
    ...generateBaseEvent("payment.authorized", correlationId),
    data: {
      orderId: orderId ?? `ord_${uuidv4().slice(0, 8)}`,
      paymentId: `pay_${uuidv4().slice(0, 8)}`,
      amount: randomAmount(),
      currency: "USD",
      binCountry: randomItem(countries),
      createdAt: new Date().toISOString(),
    },
  };
};

export const buildDisputeEvt = (orderId?: string, correlationId?: string) => {
  return {
    ...generateBaseEvent("dispute.opened", correlationId),
    data: {
      order_id: orderId ?? `ord_${uuidv4().slice(0, 8)}`,
      reason_code: randomItem(["FRAUD", "NOT_RECEIVED", "DUPLICATE"]),
      amt: randomAmount(),
      openedAt: new Date().toISOString(),
      note: randomItem(["customer says unauthorized", "item not received", "duplicate charge", ""]),
    },
  };
};
