import Joi from "joi";
import {
  orderEventSchema,
  paymentEventSchema,
  disputeEventSchema,
} from "./schemas";

export const TOPIC_ORDER = "orders.v1";
export const TOPIC_PAYMENT = "payments.v1";
export const TOPIC_DISPUTE = "disputes.v1";

const schemaByTopic: Record<string, Joi.ObjectSchema> = {
  [TOPIC_ORDER]: orderEventSchema,
  [TOPIC_PAYMENT]: paymentEventSchema,
  [TOPIC_DISPUTE]: disputeEventSchema,
};

/** Validated order.created event (orders.v1) */
export interface ValidatedOrderEvent {
  id: string;
  correlationId: string;
  type: "order.created";
  data: {
    order_id: string;
    txn_id: string;
    merchant_id: string;
    customer_id: string;
    amt: number;
    currency: string;
    email: string;
    billing_country: string;
    ip_address: string;
    device_fingerprint: string;
    ts: number;
  };
}

/** Validated payment.authorized event (payments.v1) */
export interface ValidatedPaymentEvent {
  id: string;
  correlationId: string;
  type: "payment.authorized";
  data: {
    orderId: string;
    paymentId: string;
    amount: number;
    currency: string;
    binCountry: string;
    createdAt: string;
  };
}

/** Validated dispute.opened event (disputes.v1) */
export interface ValidatedDisputeEvent {
  id: string;
  correlationId: string;
  type: "dispute.opened";
  data: {
    order_id: string;
    reason_code: string;
    amt: number;
    openedAt: string;
    note?: string;
  };
}

export type ValidatedEvent =
  | ValidatedOrderEvent
  | ValidatedPaymentEvent
  | ValidatedDisputeEvent;

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly topic: string,
    public readonly details?: Joi.ValidationErrorItem[],
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Parse raw JSON and validate against the schema for the given topic.
 * @throws ValidationError if parsing fails or validation fails
 */
export function validateEvent(
  topic: string,
  raw: string | unknown,
): ValidatedEvent {
  const schema = schemaByTopic[topic];
  if (!schema) {
    throw new ValidationError(`Unknown topic: ${topic}`, topic);
  }

  const payload =
    typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;

  const { error, value } = schema.validate(payload, {
    stripUnknown: true,
    abortEarly: false,
  });

  if (error) {
    throw new ValidationError(
      error.message,
      topic,
      error.details,
    );
  }

  return value as ValidatedEvent;
}
