import Joi from "joi";

const nonEmptyString = Joi.string().min(1).required();

/** CloudEvents-style envelope (id, correlationId, type, data, etc.). */
export const envelopeSchema = Joi.object({
  id: nonEmptyString,
  source: Joi.string().optional(),
  type: nonEmptyString,
  specversion: Joi.string().optional(),
  time: Joi.string().optional(),
  correlationId: nonEmptyString,
  data: Joi.object().required(),
}).required();

/** orders.v1 event data */
export const orderDataSchema = Joi.object({
  order_id: nonEmptyString,
  txn_id: nonEmptyString,
  merchant_id: nonEmptyString,
  customer_id: nonEmptyString,
  amt: Joi.number().min(0).required(),
  currency: nonEmptyString,
  email: Joi.string().email().required(),
  billing_country: nonEmptyString,
  ip_address: nonEmptyString,
  device_fingerprint: nonEmptyString,
  ts: Joi.number().integer().min(0).required(),
}).required();

/** payments.v1 event data */
export const paymentDataSchema = Joi.object({
  orderId: nonEmptyString,
  paymentId: nonEmptyString,
  amount: Joi.number().min(0).required(),
  currency: nonEmptyString,
  binCountry: nonEmptyString,
  createdAt: Joi.string().required(),
}).required();

/** disputes.v1 event data */
export const disputeDataSchema = Joi.object({
  order_id: nonEmptyString,
  reason_code: nonEmptyString,
  amt: Joi.number().min(0).required(),
  openedAt: Joi.string().required(),
  note: Joi.string().allow("").optional(),
}).required();

export const orderEventSchema = envelopeSchema.keys({
  type: Joi.string().valid("order.created").required(),
  data: orderDataSchema,
});

export const paymentEventSchema = envelopeSchema.keys({
  type: Joi.string().valid("payment.authorized").required(),
  data: paymentDataSchema,
});

export const disputeEventSchema = envelopeSchema.keys({
  type: Joi.string().valid("dispute.opened").required(),
  data: disputeDataSchema,
});
