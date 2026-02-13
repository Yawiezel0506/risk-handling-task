const MAX_SCORE = 20;

const clampScore = (value: number): number => {
  if (value < 0) return 0;
  if (value > MAX_SCORE) return MAX_SCORE;
  return Math.round(value);
};

/**
 * Scores how "new" an IP looks in the recent history.
 * - If the IP was seen recently, score is 0.
 * - Otherwise, score increases with the number of unique recent IPs.
 */
export const ipVelocityScore = (ip: string, recentIps: string[]): number => {
  const normalized = ip.trim();
  const uniqueRecent = Array.from(new Set(recentIps.map((value) => value.trim())));

  if (!normalized || uniqueRecent.includes(normalized)) {
    return 0;
  }

  if (uniqueRecent.length >= 6) return MAX_SCORE;
  if (uniqueRecent.length >= 4) return 14;
  if (uniqueRecent.length >= 2) return 8;
  return 4;
};

/**
 * Scores risk based on how many devices have been seen before.
 * - Known device => 0
 * - New device + many historical devices => higher score
 */
export const deviceReuseScore = (
  deviceFingerprint: string,
  knownDevices: string[],
): number => {
  const normalized = deviceFingerprint.trim();
  const uniqueDevices = Array.from(new Set(knownDevices.map((value) => value.trim())));

  if (!normalized || uniqueDevices.includes(normalized)) {
    return 0;
  }

  if (uniqueDevices.length >= 8) return 18;
  if (uniqueDevices.length >= 5) return 12;
  if (uniqueDevices.length >= 2) return 6;
  return 3;
};

/**
 * Scores reputation based on the email domain.
 * - Disposable domains => 20
 * - Free providers => 8
 * - Otherwise => 0
 */
export const emailDomainReputationScore = (email: string): number => {
  const domain = email.split("@").pop()?.toLowerCase() ?? "";

  const disposableDomains = new Set([
    "mailinator.com",
    "tempmail.com",
    "10minutemail.com",
    "discard.email",
  ]);
  const freeProviders = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"]);

  if (!domain) return 5;
  if (disposableDomains.has(domain)) return MAX_SCORE;
  if (freeProviders.has(domain)) return 8;
  return 0;
};

/**
 * Scores mismatch risk between BIN country and billing country.
 * - Missing data => 5
 * - Match => 0
 * - Mismatch => 20
 */
export const binCountryMismatchScore = (
  binCountry: string,
  billingCountry: string,
): number => {
  const bin = binCountry.trim().toUpperCase();
  const billing = billingCountry.trim().toUpperCase();

  if (!bin || !billing) return 5;
  if (bin === billing) return 0;
  return MAX_SCORE;
};

/**
 * Deterministic scoring based on merchant + customer identifiers.
 * This simulates "history" without any storage or external calls.
 */
export const chargebackHistoryScore = (merchantId: string, customerId: string): number => {
  const input = `${merchantId}:${customerId}`.trim();
  if (!input) return 0;

  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) % 101;
  }

  return clampScore(Math.floor((hash / 100) * MAX_SCORE));
};
