import {
  ipVelocityScore,
  deviceReuseScore,
  emailDomainReputationScore,
  binCountryMismatchScore,
  chargebackHistoryScore,
} from "@chargeflow/risk-signals";
import type { ValidatedOrderEvent, ValidatedPaymentEvent } from "../validation";

export interface SignalBreakdown {
  ipVelocity: number;
  deviceReuse: number;
  emailDomainReputation: number;
  binCountryMismatch: number;
  chargebackHistory: number;
}

export interface RiskResult {
  score: number;
  signalBreakdown: SignalBreakdown;
}

/**
 * Compute 0–100 risk score from order + payment using @chargeflow/risk-signals.
 * Each signal contributes 0–20; we sum and clamp to 100.
 * No history DB yet: ipVelocity and deviceReuse use empty lists (score 0).
 */
export function computeScore(
  order: ValidatedOrderEvent,
  payment: ValidatedPaymentEvent
): RiskResult {
  const o = order.data;
  const p = payment.data;

  const ipVelocity = ipVelocityScore(o.ip_address, []);
  const deviceReuse = deviceReuseScore(o.device_fingerprint, []);
  const emailDomainReputation = emailDomainReputationScore(o.email);
  const binCountryMismatch = binCountryMismatchScore(p.binCountry, o.billing_country);
  const chargebackHistory = chargebackHistoryScore(o.merchant_id, o.customer_id);

  const signalBreakdown: SignalBreakdown = {
    ipVelocity,
    deviceReuse,
    emailDomainReputation,
    binCountryMismatch,
    chargebackHistory,
  };

  const sum =
    ipVelocity +
    deviceReuse +
    emailDomainReputation +
    binCountryMismatch +
    chargebackHistory;
  const score = Math.min(100, Math.max(0, sum));

  return { score, signalBreakdown };
}
