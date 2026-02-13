# Risk Engine — Business and Technical Guide

This document explains the risk-engine flow topic by topic: what the events mean, why we validate and store them, how correlation and scoring work, what the API returns, and what business need the whole system serves. It is written so that both business and technical readers can follow.

---

## 1. What are the events sent to Kafka, and what do they mean in business terms?

We send **three types of events** into Kafka. Each describes something that **actually happened** in the commerce world: a customer placed an order, a payment was authorized, or a dispute was opened. The system does not invent these; it receives them (here, from a simulator; in production, from your order/payment/dispute systems).

| Event type | Topic | Business meaning |
|------------|--------|-------------------|
| **Order created** | `orders.v1` | A customer placed an order. We get the order id, merchant, customer, amount, currency, email, billing country, IP, device fingerprint, and timestamp. This is the “who, what, where, and when” of the purchase. |
| **Payment authorized** | `payments.v1` | A payment for that order was authorized. We get the order it belongs to, the payment id, amount, currency, and **card BIN country** (the country of the bank that issued the card). This tells us “money was committed” and “where the card is from.” |
| **Dispute opened** | `disputes.v1` | A dispute (e.g. chargeback) was opened for that order. We get the order, reason code (e.g. FRAUD), amount, and when it was opened. This is a signal that something went wrong after the fact. |

**In short:**  
The events are **facts from the commerce lifecycle**: order → payment → (optionally) dispute. They are the raw material the risk engine uses to decide “how risky is this order?”

---

## 2. What is the business goal of the risk engine? What do we want to achieve?

The **business goal** is to assign a **risk score (0–100)** to each order so the business can:

- **Decide what to do with the order** — e.g. auto-approve low risk, manually review medium risk, block or challenge high risk.
- **Reduce fraud and chargebacks** — by spotting suspicious patterns (wrong country, disposable email, many IPs/devices, etc.) before or after payment.
- **Answer “how risky was this order?”** — for reporting, auditing, or post-dispute analysis.

The risk engine does **not** make the decision (approve/block). It only **computes and stores the score** and **exposes it via an API**. Other systems (checkout, fraud ops, dashboards) call the API and then apply their own rules.

**In short:**  
We want to **turn raw order/payment/dispute events into a single, queryable risk score per order**, so the rest of the business can act on risk in a consistent way.

---

## 3. What is the event validation process?

Before we store or use an event, we **validate** it: we check that it is well-formed and that required business fields are present and valid.

- **Well-formed** — The message is valid JSON and has the expected envelope: an event `id`, a `correlationId`, a `type`, and a `data` block.
- **Topic-specific rules** — For orders we require, for example, a valid email, order_id, merchant_id, amount, billing country, IP, device fingerprint. For payments we require orderId, amount, binCountry, etc. For disputes we require order_id, reason_code, amount, openedAt.

If validation fails (e.g. missing email or invalid email format), we **do not store** the event and we **do not use it** for scoring. We log it and skip. This way we never base a risk score on broken or incomplete data.

**In short:**  
Validation is the **gatekeeper**: only events that meet our data-quality and business rules are allowed into the rest of the pipeline (storage and scoring).

---

## 4. What is special about saving in PostgreSQL? What is the business element?

Saving in PostgreSQL does two jobs that are important both technically and for the business.

**A) We never process the same event twice (idempotency)**  
Each event has a unique `id`. We store events in a table where that `id` is the key. If the same event is delivered again (e.g. Kafka retry or duplicate), we try to insert it again; the database rejects the duplicate, so we do not create a second row. So: **one event in the real world = at most one row in our system**. That means we never double-count an order or a payment when we compute risk.

**B) We keep a clear record of what we know**  
We store the **full event payload** (and correlation_id, topic, etc.). So we have a durable record of “what actually happened” for each order/payment/dispute. We can recompute risk later if we change the scoring logic, or use this data for analytics and audits.

We also store **risk scores** in another table: one row per (merchant, order) with the score, the breakdown of how each signal contributed, and an expiry time. So the API can answer “what is the risk for this order?” by reading from the database, without recomputing on every request.

**In short:**  
PostgreSQL is our **single source of truth**: it ensures we process each event once and only once, and it holds both the raw events and the computed scores so the business can query risk reliably and consistently.

---

## 5. What is the meaning of the link by correlationId, and why do we need it?

In the real world, **one customer journey** produces **three separate events**: first an order, then a payment for that order, then possibly a dispute for that same order. They are three different messages in Kafka, possibly arriving in any order and sometimes duplicated.

The **correlationId** is an identifier that is **shared by all three events** that belong to the same journey. So:

- One correlationId = one “story”: one order + one payment + (optionally) one dispute.
- When we see an event, we know which story it belongs to by reading its correlationId.

We need this link because **risk is computed per order**, and to score an order we need **both** the order data (email, IP, billing country, device, etc.) **and** the payment data (e.g. card country). Those pieces live in **different events**. So we must:

1. Group all events that share the same correlationId.
2. Find the order event and the payment event in that group.
3. Use them together in the scoring formula.

Without correlationId we would have no reliable way to know which payment belongs to which order. With it, we can assemble the full picture for each order and compute one score per order.

**In short:**  
correlationId **ties together the three events of one customer journey**. We need it to know which order and which payment belong together, so we can compute one risk score per order using both.

---

## 6. How is the score calculated, and what is its business significance?

The score is a **number from 0 to 100** that summarizes “how risky does this order look?” based on several **signals**. Each signal is a small question we can answer from the order and payment data; each contributes between 0 and 20 points. We add them up and cap the total at 100.

The five signals we use today are:

| Signal | What it checks | Business meaning |
|--------|----------------------------------|------------------|
| **IP velocity** | Has this IP been seen a lot recently (across many different sessions)? | Many different IPs can suggest shared or automated abuse. |
| **Device reuse** | Is this device new, or have we seen it before? | New device with little history can be riskier. |
| **Email domain reputation** | Is the email from a disposable or free provider? | Disposable emails are often used for fraud; free providers are neutral. |
| **BIN–billing country mismatch** | Does the card’s country (BIN) match the billing country? | Mismatch (e.g. card from one country, billing in another) is a classic fraud signal. |
| **Chargeback history** | A deterministic score from merchant + customer id (simulating “have we had chargebacks for this combo before?”). | Past chargebacks for the same merchant/customer suggest higher risk. |

So: **low score (e.g. 0–25)** = the order looks consistent and familiar (matching country, known device, reputable email, etc.). **High score (e.g. 75–100)** = several red flags (mismatch, disposable email, many IPs, etc.). The business can then set **thresholds** (e.g. “auto-approve under 30, review 30–60, block over 60”) and use the score to route orders, trigger reviews, or block high-risk transactions.

We also store a **breakdown**: how many points came from each signal. That helps the business understand *why* a score is high (e.g. “mostly because of BIN mismatch and disposable email”) and tune rules or processes.

**In short:**  
The score is a **single number that combines several risk signals** from the order and payment. It tells the business “how risky is this order?” so they can approve, review, or block in a consistent way; the breakdown explains *why*.

---

## 7. What do we want to get from the API?

The API is the way the rest of the world **asks** the risk engine: “What is the risk for this order?”

The caller sends: **merchant id** and **order id** (e.g. in the URL: `GET /risk?merchantId=merch_acme&orderId=ord_123`).

The API returns a **status** and, when we have a score, the **score and its breakdown**:

| Status | Meaning | What the caller gets |
|--------|--------|----------------------|
| **found** | We have a score for this order and it is still valid (not expired). | The score (0–100), the signal breakdown, and the expiry time. The caller can use this to decide (e.g. approve / review / block). |
| **expired** | We had a score, but it has passed its validity period (e.g. 24 hours). | We still return the last score and breakdown for context, but mark it as expired so the caller knows it is no longer “current” for decision-making. |
| **missing** | We have never computed a score for this order (e.g. we never saw both order and payment events). | No score. The caller knows “risk engine has nothing for this order” and can treat it accordingly (e.g. wait, or use a default policy). |

So the **business outcome** of the API is: for any (merchant, order), the caller gets a clear answer — **found** (use this score), **expired** (we had one but it’s old), or **missing** (we don’t have one). That way checkout, fraud tools, or dashboards can behave consistently without guessing.

**In short:**  
From the API we want a **clear, machine-readable answer**: “Do you have a risk score for this order? If yes, is it still valid? And what is the score and breakdown?” So other systems can base decisions on risk without reimplementing the logic.

---

## 8. Conclusion: What need does this application solve?

In one sentence:  
**The application turns messy, real-world events (orders, payments, disputes) into a single, reliable risk score per order, and exposes it so the business can act on risk in a consistent way.**

In more detail:

- **The problem:** Orders, payments, and disputes arrive as separate, possibly duplicated or out-of-order events. The business needs to know “how risky is this order?” to approve, review, or block — but that answer must be based on correct, deduplicated, and correlated data.
- **What the risk engine does:** It **ingests** those events, **validates** them, **stores** them once (no double-counting), **links** them by correlationId so it knows which order and payment belong together, **computes** a 0–100 risk score (and breakdown) when it has both order and payment, **stores** that score with an expiry, and **exposes** it via an API so any system can ask “what is the risk for this order?” and get a clear found / expired / missing answer.
- **The need it solves:** So that **fraud and risk decisions** are based on a **single, authoritative, up-to-date risk score per order**, computed from real events and available to all systems that need it, without each system having to replay or re-correlate the events themselves.

So the flow is both **technical** (events → validate → store → correlate → score → store → API) and **business** (facts from the commerce lifecycle → one number per order → clear API so the business can act on risk). This document has walked that flow topic by topic so you can see both sides in one place.
