# UCP Analytics — Whiteboard Session Brief

**Audience:** Senior Director / VP (assumes no prior UCP knowledge)
**Duration:** ~30 minutes
**Goal:** Explain what we built, why it matters, and how it works

---

## 1. Setting the Scene: What Is UCP?

### The Problem UCP Solves

Today, when you shop online, every merchant has its own checkout flow, its own
payment integration, its own cart API. An AI agent that wants to buy flowers
from one store and electronics from another must learn two completely different
APIs.

**Universal Commerce Protocol (UCP)** standardizes this. It defines a single
set of APIs for the entire shopping journey:

```
Discover merchant  →  Browse / Cart  →  Checkout  →  Pay  →  Order shipped
```

Think of it like **USB for commerce** — one protocol, every merchant.

### Who's Behind It

UCP was publicly launched January 2026, co-developed by:

| Role | Companies |
|---|---|
| **Co-developers** | Google, Shopify, Etsy, Walmart, Target, Wayfair |
| **Payment partners** | Adyen, Mastercard, Visa, Stripe (20+ total) |
| **First consumers** | Google AI Mode in Search, Gemini app |

### Two Sides of Every Transaction

```
┌──────────────┐                    ┌──────────────────┐
│   PLATFORM   │                    │    BUSINESS       │
│  (AI Agent)  │ ──── UCP APIs ───► │  (Merchant)       │
│              │                    │                   │
│  "Buy roses" │                    │  "Flower Shop"    │
└──────────────┘                    └──────────────────┘
```

The **platform** is the AI agent doing the shopping.
The **business** is the merchant fulfilling the order.

---

## 2. The Gap: UCP Has No Observability

UCP defines the protocol but **ships zero analytics**. Once transactions start
flowing, nobody can answer:

| Question | Why It Matters |
|---|---|
| What % of checkouts complete? | Conversion = revenue |
| Where do buyers drop off? | UX/agent optimization |
| Which payment handlers fail? | Reliability |
| How fast are merchant responses? | Performance SLAs |
| Which capabilities do merchants support? | Ecosystem adoption |
| What does the error landscape look like? | Debugging at scale |

Every merchant and platform must independently build this instrumentation.
That's duplicated work across the entire ecosystem.

---

## 3. Our Solution: UCP Analytics

**One package** that automatically captures every UCP operation into BigQuery.

### The One-Liner

> Drop in a middleware or hook — zero changes to existing UCP code —
> and get structured commerce analytics in BigQuery.

### Three Integration Points

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   PLATFORM (Agent)              BUSINESS (Merchant)          │
│   ┌───────────────┐            ┌───────────────────┐        │
│   │ HTTPX Client   │            │ FastAPI Server     │        │
│   │ + EventHook ─────── HTTP ────► + Middleware     │        │
│   └───────┬───────┘            └────────┬──────────┘        │
│           │                             │                    │
│           │    ┌─────────────┐          │                    │
│           │    │ ADK Plugin   │          │                    │
│           │    │ (optional)   │          │                    │
│           │    └──────┬──────┘          │                    │
│           │           │                 │                    │
│           └───────────┼─────────────────┘                    │
│                       ▼                                      │
│             UCPAnalyticsTracker                               │
│             ├── Classify event                                │
│             ├── Extract fields                                │
│             └── Batch write ──────► BigQuery                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

| Integration | Where | Effort |
|---|---|---|
| **FastAPI middleware** | Merchant server | 2 lines of code |
| **HTTPX event hook** | Agent / platform | 3 lines of code |
| **ADK plugin** | Google ADK agent | Plugin config |

All three funnel into the same tracker → same BigQuery table.

---

## 4. What We Track: 27 Event Types

Everything an AI agent does during a shopping journey becomes a structured
event:

```
DISCOVERY          CART              CHECKOUT           ORDER
─────────          ────              ────────           ─────
profile_           cart_created      session_created    order_created
  discovered       cart_get          session_get        order_updated
capability_        cart_updated      session_updated    order_shipped
  negotiated       cart_canceled     escalation         order_delivered
                                     session_completed  order_returned
                                     session_canceled   order_canceled

IDENTITY           PAYMENT           FALLBACK
────────           ───────           ────────
link_initiated     handler_          request
link_completed       negotiated      error
link_revoked       instrument_
                     selected
                   payment_completed
                   payment_failed
```

**How classification works:** The system looks at the HTTP method + URL path +
response body and automatically determines the event type. No manual
annotation needed.

Example: `POST /checkout-sessions` + status 201 → `checkout_session_created`

---

## 5. Architecture Deep Dive

### The Pipeline

```
HTTP Request/Response
        │
        ▼
┌─────────────────────┐
│  1. CLASSIFY         │  HTTP method + path + body → event type
│     (regex matching) │  e.g., POST /checkout-sessions → "created"
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  2. EXTRACT          │  Parse UCP JSON → structured fields
│     (field mapping)  │  totals, payment, fulfillment, errors...
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  3. WRITE            │  Buffer → batch → streaming insert
│     (async batched)  │  Non-blocking, retry on failure
└─────────┬───────────┘
          │
          ▼
     ┌─────────┐
     │ BigQuery │  Partitioned by day, clustered by event type
     └─────────┘
```

### Key Design Decisions

| Decision | What We Chose | Why |
|---|---|---|
| **Storage** | BigQuery | Already in GCP ecosystem, handles scale, SQL-native |
| **Capture method** | Passive observer | Zero changes to existing UCP code |
| **Batching** | Async buffer (default 50) | Don't slow down HTTP responses |
| **Fire-and-forget** | Background tasks | Analytics never blocks commerce |
| **3 transports** | REST + MCP + A2A | Cover all UCP communication modes |
| **Partial failure** | Requeue only failed rows | Don't duplicate successful writes |
| **PII handling** | Optional redaction | Configurable per deployment |

### BigQuery Table Design

```
Table: {project}.ucp_analytics.ucp_events

PARTITION BY DATE(timestamp)         ← query efficiency
CLUSTER BY event_type,               ← filter by type
           checkout_session_id,      ← session replay
           merchant_host             ← per-merchant analytics

Key columns:
  event_id, event_type, timestamp    ← identity
  checkout_session_id, order_id      ← correlation
  checkout_status                    ← funnel stage
  currency, total_amount, tax_...    ← financials (7 total types)
  payment_handler_id, brand, type    ← payment analytics
  fulfillment_type, country          ← geography
  latency_ms                         ← performance
  error_code, error_message          ← debugging
  capabilities_json                  ← ecosystem tracking
```

All amounts are in **minor currency units** (cents) — no floating-point
currency bugs.

---

## 6. What This Enables (Business Value)

### Immediate Dashboards

| Dashboard | Question It Answers | Key Metric |
|---|---|---|
| **Checkout Funnel** | Where do buyers drop off? | created → completed % |
| **Revenue by Merchant** | Who drives the most GMV? | SUM(total_amount) |
| **Payment Handler Mix** | Which payment methods win? | Transactions by handler |
| **Latency Percentiles** | Are merchants fast enough? | p50 / p95 / p99 |
| **Error Analysis** | What's breaking? | Error code frequency |
| **Capability Adoption** | What UCP features are live? | Merchants per capability |
| **Fulfillment Geography** | Where do orders ship? | Revenue by country |
| **Escalation Rate** | How often do agents need humans? | Escalation / created |

### Example: Checkout Funnel Query

```sql
SELECT
    DATE(timestamp) AS day,
    COUNT(CASE WHEN event_type = 'checkout_session_created'   THEN 1 END) AS started,
    COUNT(CASE WHEN event_type = 'checkout_session_completed' THEN 1 END) AS completed,
    SAFE_DIVIDE(completed, started) AS conversion_rate
FROM `project.ucp_analytics.ucp_events`
GROUP BY day
ORDER BY day DESC;
```

10 ready-to-use queries are included in the repo.

---

## 7. Current State

### By the Numbers

| Metric | Value |
|---|---|
| Production code | ~1,750 lines |
| Test code | ~1,300 lines |
| Test count | 109 tests, all passing |
| Event types | 27 (full UCP coverage) |
| Transports | 3 (REST, MCP, A2A) |
| Integration points | 3 (middleware, hook, ADK plugin) |
| Runnable examples | 9 demos |
| Lint status | Clean (ruff) |

### What Ships

```
pip install ucp-analytics              # core
pip install ucp-analytics[fastapi]     # + middleware
pip install ucp-analytics[adk]         # + ADK plugin
```

### Repo Structure (simplified)

```
src/ucp_analytics/
  tracker.py      ← orchestrator (record_http, record_jsonrpc)
  parser.py       ← classify HTTP → event type, extract fields
  writer.py       ← async batched BigQuery writer
  middleware.py   ← FastAPI server-side capture
  client_hooks.py ← HTTPX client-side capture
  adk_plugin.py   ← Google ADK adapter
  events.py       ← event model + enums

tests/            ← 109 tests across 5 files
examples/         ← 9 runnable demos (1 local, 8 BigQuery)
dashboards/       ← 10 SQL queries for analytics
```

---

## 8. Discussion Prompts

These are good topics for the whiteboard:

1. **Adoption path:** Should this ship as part of the UCP reference
   implementation, or as a recommended companion package?

2. **Multi-tenant:** Platform operators running many merchants — do we need
   dataset-per-merchant isolation, or is `merchant_host` filtering sufficient?

3. **Real-time:** Current design is batch-to-BigQuery. Is there appetite for
   a streaming path (Pub/Sub → real-time dashboards)?

4. **Cost attribution:** Can we correlate LLM token costs (from ADK telemetry)
   with revenue per checkout session for ROI analysis?

5. **Conformance testing:** Should analytics events feed back into UCP
   conformance validation?

---

*Document prepared for whiteboard session. See the full design doc at
`docs/design_doc.md` and the BigQuery integration guide at
`docs/bigquery-ucp-analytics.md` for implementation details.*
