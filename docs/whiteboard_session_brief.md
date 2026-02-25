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

UCP uses two terms consistently:

- **Platform** (= the "agent side"): The AI-powered application that shops on
  behalf of users. Examples: Google's AI Mode in Search, the Gemini app, or any
  LLM agent built with Google's Agent Development Kit (ADK). The platform
  initiates every UCP API call — creating carts, starting checkouts, and
  submitting payments.

- **Business** (= the "merchant side"): The online store that fulfills orders.
  Examples: a Shopify storefront, a Walmart product listing, or any retailer
  running a UCP-compatible server. The business receives UCP API requests,
  processes them against its catalog/inventory, and returns structured responses.

In short: the **platform calls**, the **business responds**.

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

> Drop in a middleware or hook — no business-logic changes to existing UCP code —
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

| Integration | Where | Who Runs This | Effort |
|---|---|---|---|
| **FastAPI middleware** | Merchant server (business) | The retailer or marketplace hosting a UCP-compatible store. Their FastAPI server handles incoming checkout/cart/order requests from AI agents. | 2 lines of code |
| **HTTPX event hook** | Agent / platform client | The team building the AI shopping agent. Their HTTPX client makes outbound UCP calls to merchants. | 3 lines of code |
| **ADK plugin** | Google ADK agent (platform) | The team building an agent on Google's Agent Development Kit. The plugin wraps ADK tool calls with analytics. | Plugin config |

All three funnel into the same `UCPAnalyticsTracker` → same BigQuery table.

---

## 4. Integration Deep Dive

### 4.1 FastAPI Middleware (`middleware.py`)

**What it is:** A Starlette `BaseHTTPMiddleware` that wraps every incoming
HTTP request on the merchant's UCP server.

**Where it runs:** On the **business (merchant) side**. The merchant runs a
FastAPI server that handles UCP requests from AI agents. This middleware
intercepts those requests/responses without modifying any handler logic.

**How it works step by step:**

```
AI Agent (platform)                    Merchant FastAPI Server (business)
    │                                      │
    │  POST /checkout-sessions             │
    │ ────────────────────────────────────► │
    │                                      │ ┌──────────────────────────────┐
    │                                      │ │  UCPAnalyticsMiddleware      │
    │                                      │ │                              │
    │                                      │ │  1. Check path prefix        │
    │                                      │ │     Is it /checkout-sessions,│
    │                                      │ │     /carts, /orders, etc.?   │
    │                                      │ │     If not → pass through    │
    │                                      │ │                              │
    │                                      │ │  2. Read request body (JSON) │
    │                                      │ │     (POST/PUT/PATCH only)    │
    │                                      │ │                              │
    │                                      │ │  3. Start timer              │
    │                                      │ │  4. call_next(request)       │
    │                                      │ │     → actual handler runs    │
    │                                      │ │  5. Stop timer (latency_ms)  │
    │                                      │ │                              │
    │                                      │ │  6. Read response body       │
    │                                      │ │                              │
    │                                      │ │  7. Fire-and-forget:         │
    │                                      │ │     asyncio.create_task(     │
    │                                      │ │       tracker.record_http()  │
    │                                      │ │     )                        │
    │                                      │ │     → task registered on     │
    │                                      │ │       tracker for shutdown   │
    │                                      │ │                              │
    │                                      │ │  8. Re-create response with  │
    │                                      │ │     consumed body bytes,     │
    │                                      │ │     preserve raw headers     │
    │                                      │ └──────────────────────────────┘
    │  ◄─── 201 {"id": "chk_abc", ...}    │
    │                                      │
```

**Path filtering:** The middleware checks if the request path starts with one
of 8 known UCP prefixes. Non-UCP traffic (like health checks or static assets)
passes through with zero overhead.

```python
UCP_PATH_PREFIXES = (
    "/checkout-sessions",   # Checkout lifecycle
    "/carts",               # Cart CRUD
    "/.well-known/ucp",     # Merchant discovery profile
    "/orders",              # Order creation & queries
    "/identity",            # OAuth identity linking
    "/testing/simulate",    # Simulated shipping (test env)
    "/webhooks",            # Order lifecycle webhooks
    "/webhook",             # Singular variant
)
```

**Fire-and-forget pattern:** Analytics recording is dispatched as a background
`asyncio.Task` so it never adds latency to the HTTP response. The task is
registered on the tracker (`tracker.register_pending_task(task)`) so that
`tracker.close()` can await all in-flight tasks before shutting down — no lost
events on server restart.

**Setup (2 lines):**

```python
from ucp_analytics import UCPAnalyticsTracker, UCPAnalyticsMiddleware

tracker = UCPAnalyticsTracker(project_id="my-project", app_name="flower_shop")
app.add_middleware(UCPAnalyticsMiddleware, tracker=tracker)

@app.on_event("shutdown")
async def shutdown():
    await tracker.close()  # drains in-flight tasks, then flushes
```

**Why `app.add_middleware()` not direct instantiation:** FastAPI/Starlette owns
the middleware lifecycle. `app.add_middleware(Class, **kwargs)` creates the
instance internally and wires it into the ASGI stack. Direct instantiation
(`UCPAnalyticsMiddleware(app, tracker=tracker)`) does **not** register it with
FastAPI — the middleware would never receive requests.

---

### 4.2 HTTPX Event Hook (`client_hooks.py`)

**What it is:** A callable class that plugs into HTTPX's response event hook
system to capture every outbound UCP HTTP call made by an AI agent.

**Where it runs:** On the **platform (agent) side**. The AI shopping agent
uses an HTTPX `AsyncClient` to call merchant UCP APIs. This hook fires after
every HTTP response and records UCP interactions.

**How it works step by step:**

```
AI Agent (platform)                           Merchant (business)
    │                                              │
    │  HTTPX AsyncClient                           │
    │  ┌──────────────────────────────────┐       │
    │  │ 1. Agent calls:                   │       │
    │  │    client.post("/checkout-sessions",      │
    │  │      json={...})                  │       │
    │  │                                   │       │
    │  │ 2. HTTPX sends request ──────────────────►│
    │  │                                   │       │
    │  │ 3. Response received ◄───────────────────│
    │  │                                   │       │
    │  │ 4. Event hook fires:              │       │
    │  │    UCPClientEventHook.__call__()  │       │
    │  │                                   │       │
    │  │    a. Check path patterns          │       │
    │  │       Is "/checkout-sessions" in   │       │
    │  │       the URL path? If not → skip │       │
    │  │                                   │       │
    │  │    b. await response.aread()      │       │
    │  │       Read full response body     │       │
    │  │                                   │       │
    │  │    c. Parse request body from     │       │
    │  │       request.content bytes       │       │
    │  │                                   │       │
    │  │    d. Get latency from            │       │
    │  │       response.elapsed            │       │
    │  │                                   │       │
    │  │    e. await tracker.record_http() │       │
    │  │       (blocking in hook context — │       │
    │  │        buffered, not flushed      │       │
    │  │        immediately)               │       │
    │  └──────────────────────────────────┘       │
    │                                              │
```

**Key difference from middleware:** The middleware runs server-side in a
fire-and-forget `asyncio.Task`. The event hook runs client-side and `await`s
`record_http()` directly — but since `record_http()` only enqueues to an
in-memory buffer (flushed asynchronously at batch threshold), it adds
negligible latency.

**Path filtering:** Uses `in` substring matching (not `startswith`) because
the agent may call full URLs like `https://merchant.example.com/checkout-sessions/123`:

```python
UCP_PATH_PATTERNS = (
    "/checkout-sessions",
    "/carts",
    "/.well-known/ucp",
    "/orders",
    "/identity",
    "/simulate-shipping",
    "/webhooks",
    "/webhook",
)
```

**Setup (3 lines):**

```python
import httpx
from ucp_analytics import UCPAnalyticsTracker, UCPClientEventHook

tracker = UCPAnalyticsTracker(project_id="my-project", app_name="shopping_agent")
hook = UCPClientEventHook(tracker)

client = httpx.AsyncClient(event_hooks={"response": [hook]})
# Every UCP call through this client is now recorded
```

---

### 4.3 ADK Plugin (`adk_plugin.py`)

**What it is:** A Google Agent Development Kit (ADK) `BasePlugin` that
intercepts ADK tool calls, detects which ones are UCP operations, and records
structured analytics events.

**Where it runs:** On the **platform (agent) side**, specifically for agents
built with Google's ADK framework. ADK agents use "tools" (Python functions
exposed to the LLM) to interact with UCP merchants. This plugin hooks into
ADK's `before_tool_callback` / `after_tool_callback` lifecycle.

**How it works step by step:**

```
User: "Buy me roses from FlowerShop"
    │
    ▼
┌──────────────────────────────────────────────┐
│  ADK Agent (LLM + Tools)                      │
│                                                │
│  LLM decides to call tool: create_checkout     │
│       │                                        │
│       ▼                                        │
│  ┌─────────────────────────────────────┐      │
│  │ UCPAgentAnalyticsPlugin             │      │
│  │                                     │      │
│  │ before_tool_callback():             │      │
│  │   Record start time                 │      │
│  │                                     │      │
│  │ ─── tool executes (HTTP to merchant)│      │
│  │                                     │      │
│  │ after_tool_callback():              │      │
│  │   1. Is this a UCP tool?            │      │
│  │      Check tool name against        │      │
│  │      _UCP_PATTERNS list             │      │
│  │      ("checkout", "cart", "order",  │      │
│  │       "payment", "discover", etc.)  │      │
│  │                                     │      │
│  │   2. Map tool name → HTTP equivalent│      │
│  │      "create_checkout"              │      │
│  │        → POST /checkout-sessions    │      │
│  │      "start_payment"               │      │
│  │        → PUT /checkout-sessions/{id}│      │
│  │                                     │      │
│  │   3. Classify via parser            │      │
│  │      UCPResponseParser.classify(    │      │
│  │        "POST",                      │      │
│  │        "/checkout-sessions",        │      │
│  │        200, response_body           │      │
│  │      )                              │      │
│  │      → CHECKOUT_SESSION_CREATED     │      │
│  │                                     │      │
│  │   4. Extract fields from response   │      │
│  │      (totals, payment, fulfillment) │      │
│  │                                     │      │
│  │   5. Build UCPEvent + enqueue       │      │
│  │      to BigQuery writer             │      │
│  └─────────────────────────────────────┘      │
└──────────────────────────────────────────────┘
```

**Tool-to-HTTP mapping:** ADK tools have names like `create_checkout` or
`start_payment`, not HTTP paths. The plugin maintains a mapping table that
translates tool names to their HTTP equivalents so the same classifier works
for all three transports:

```python
_TOOL_TO_HTTP = {
    "discover":               ("GET",  "/.well-known/ucp"),
    "create_checkout":        ("POST", "/checkout-sessions"),
    "update_checkout":        ("PUT",  "/checkout-sessions/{id}"),
    "complete_checkout":      ("POST", "/checkout-sessions/{id}/complete"),
    "cancel_checkout":        ("POST", "/checkout-sessions/{id}/cancel"),
    "get_checkout":           ("GET",  "/checkout-sessions/{id}"),
    "create_cart":            ("POST", "/carts"),
    "update_cart":            ("PUT",  "/carts/{id}"),
    "cancel_cart":            ("POST", "/carts/{id}/cancel"),
    "create_order":           ("POST", "/orders"),
    "add_to_checkout":        ("PUT",  "/checkout-sessions/{id}"),
    "remove_from_checkout":   ("PUT",  "/checkout-sessions/{id}"),
    "update_customer_details":("PUT",  "/checkout-sessions/{id}"),
    "start_payment":          ("PUT",  "/checkout-sessions/{id}"),
    # ... plus A2A prefixed variants (a2a.ucp.checkout.create, etc.)
}
```

**UCP tool detection:** Not every ADK tool is a UCP operation (agents may have
tools for weather, search, etc.). The plugin checks tool names against keyword
patterns: `"checkout"`, `"cart"`, `"order"`, `"payment"`, `"discover"`,
`"identity"`, `"negotiate"`, `"customer_details"`. Non-UCP tools are skipped
unless `track_all_tools=True`.

**Setup (plugin config):**

```python
from ucp_analytics.adk_plugin import UCPAgentAnalyticsPlugin
from google.adk.runners import InMemoryRunner

plugin = UCPAgentAnalyticsPlugin(
    project_id="my-project",
    dataset_id="ucp_analytics",
)
runner = InMemoryRunner(agent=agent, plugins=[plugin])
```

---

## 5. The Shared Core: Tracker → Parser → Writer

All three integration points converge on the same internal pipeline. This means
regardless of whether an event enters via the merchant middleware, the agent
hook, or the ADK plugin, it goes through identical classification, extraction,
and storage — producing **one unified BigQuery table**.

### 5.1 UCPAnalyticsTracker (`tracker.py`)

The orchestrator. Every integration calls one of two methods:

| Method | Used By | Input |
|---|---|---|
| `record_http()` | Middleware, HTTPX hook | HTTP method, URL, path, status code, request/response JSON, latency |
| `record_jsonrpc()` | Direct MCP/A2A callers | Tool name, transport type, response JSON, latency |
| `record_event()` | ADK plugin | Pre-built `UCPEvent` object |

`record_http()` does:
1. Parse URL to extract `merchant_host`
2. Call `UCPResponseParser.classify()` → event type
3. Build a `UCPEvent` dataclass with identity, context, HTTP metadata
4. Call `UCPResponseParser.extract()` on the response body → fill in checkout
   session ID, order ID, totals, payment, fulfillment, errors, capabilities
5. Optionally redact PII fields (`email`, `phone`, `street_address`, etc.)
6. Enqueue the serialized row to the BigQuery writer buffer

**PII redaction:** When `redact_pii=True`, the tracker recursively walks the
response body and replaces configured field names with `[REDACTED]` before
extraction. Default PII fields: `email`, `phone`, `first_name`, `last_name`,
`phone_number`, `street_address`, `postal_code`.

### 5.2 UCPResponseParser (`parser.py`)

Two jobs: **classify** and **extract**.

**Classify** — Determines the event type from HTTP signals. Uses a priority
chain of regex matches:

```
Input:  method=POST, path="/checkout-sessions", status=201, body={...}
Output: UCPEventType.CHECKOUT_SESSION_CREATED

Input:  method=PUT, path="/checkout-sessions/chk_123", status=200,
        body={"status": "requires_escalation", ...}
Output: UCPEventType.CHECKOUT_ESCALATION

Input:  method=POST, path="/webhooks/partners/p1/events/order", status=200,
        request_body={"status": "shipped", ...}
Output: UCPEventType.ORDER_SHIPPED
```

For JSON-RPC transports (MCP/A2A), `classify_jsonrpc()` maps tool names to
HTTP equivalents via `_TOOL_TO_HTTP`, then delegates to the same `classify()`.

**Extract** — Parses UCP JSON bodies into ~40 structured BigQuery columns:

| UCP JSON field | BigQuery column(s) | Example |
|---|---|---|
| `id` | `checkout_session_id` or `order_id` | `"chk_abc123"` |
| `status` | `checkout_status` (checkout only) | `"completed"` |
| `currency` | `currency` | `"USD"` |
| `totals[type=total]` | `total_amount` (minor units) | `1299` (= $12.99) |
| `totals[type=tax]` | `tax_amount` | `104` |
| `totals[type=fulfillment]` | `fulfillment_amount` | `500` |
| `payment.instruments[0]` | `payment_handler_id`, `payment_brand`, `payment_instrument_type` | `"stripe"`, `"visa"`, `"card"` |
| `fulfillment.methods[0]` | `fulfillment_type`, `fulfillment_destination_country` | `"shipping"`, `"US"` |
| `ucp.capabilities[]` | `capabilities_json` | `[{"name":"dev.ucp.shopping.checkout"}]` |
| `messages[type=error]` | `error_code`, `error_message` | `"INVALID_CART"`, `"Cart expired"` |
| `line_items[]` | `line_items_json`, `line_item_count` | JSON array, `3` |
| `discounts.codes[]` | `discount_codes_json` | `["SAVE10"]` |
| `order.permalink_url` | `permalink_url` | `"https://shop.example/order/123"` |

### 5.3 AsyncBigQueryWriter (`writer.py`)

Async-safe, batched streaming insert writer.

```
enqueue(row)
    │
    ▼
┌──────────────┐    buffer.length >= batch_size?
│ In-memory    │ ──── yes ───► flush()
│ buffer       │                  │
│ (list)       │                  ▼
│              │           ┌─────────────────────┐
│ Protected by │           │ asyncio.to_thread(   │
│ asyncio.Lock │           │   client.insert_rows │
│              │           │ )                     │
└──────────────┘           └──────────┬──────────┘
                                      │
                              ┌───────┴────────┐
                              │  Partial error? │
                              └───────┬────────┘
                                yes   │   no
                                ▼     │    ▼
                          Requeue only │  Done
                          failed rows  │
                          (by index)   │
```

Key behaviors:
- **Batch size:** Default 50 rows. Configurable via `batch_size` param.
- **Max buffer:** 10,000 rows. If exceeded, oldest events are dropped with a warning.
- **Thread offloading:** BigQuery client calls are synchronous, so `flush()`
  runs them via `asyncio.to_thread()` to avoid blocking the event loop.
- **Auto-create:** On first flush, creates the dataset and table if they don't
  exist (partitioned by day, clustered by event_type + session + merchant).
- **Partial failure handling:** `insert_rows_json` returns per-row errors with
  indices. Only the failed rows are re-queued — successful rows are not
  duplicated.
- **Full failure:** If the entire `insert_rows_json` call throws, the whole
  batch is re-queued (up to `max_buffer_size`).

---

## 6. What We Track: 27 Event Types

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

## 7. Architecture Deep Dive

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
| **Capture method** | Passive observer | No business-logic changes to existing UCP code |
| **Batching** | Async buffer (default 50) | Don't slow down HTTP responses |
| **Fire-and-forget** | Background tasks | Analytics never blocks commerce |
| **3 transports** | REST + MCP + A2A | Cover all UCP communication modes |
| **Partial failure** | Retry failed rows only | Minimizes duplication and data loss risk |
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

## 8. What This Enables (Business Value)

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
    SAFE_DIVIDE(
        COUNT(CASE WHEN event_type = 'checkout_session_completed' THEN 1 END),
        COUNT(CASE WHEN event_type = 'checkout_session_created'   THEN 1 END)
    ) AS conversion_rate
FROM `project.ucp_analytics.ucp_events`
GROUP BY day
ORDER BY day DESC;
```

10 ready-to-use queries are included in the repo.

---

## 9. Current State

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

## 10. Discussion Prompts

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
