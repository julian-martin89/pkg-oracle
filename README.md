# pkg-oracle — Dependency Trust Oracle

A pay-per-call MCP (Model Context Protocol) server that verifies an npm or
PyPI package **before** an AI coding agent writes it into a manifest.
Monetized per call with [x402](https://x402.gitbook.io/x402/) micropayments
in USDC on Base — no API keys, no signup, no dashboard. An agent calls the
tool, pays a fraction of a cent, gets a verdict.

## Why this exists

AI coding agents hallucinate package names and skip the verification a
human developer would normally do — they check one thing ("does this name
resolve?") and if it resolves, they install it. That gap is now an active
attack surface known as **slopsquatting**: attackers register the package
names LLMs are statistically likely to hallucinate, then wait.

`verify_package` closes that gap with a single tool call that:

1. Confirms the package **actually exists** on its registry (npm or PyPI).
2. Cross-references [OSV.dev](https://osv.dev) for known CVEs affecting the
   resolved version.
3. Pulls the package's [OpenSSF Scorecard](https://deps.dev) via deps.dev
   (branch protection, code review practices, maintenance signal, ...).
4. Runs a Levenshtein-distance **typosquat check** against a curated list
   of high-value popular package names, combined with the package's
   publish age — a near-miss spelling that's also brand new is the exact
   shape of a typosquat/slopsquat attack.

It returns one synthetic verdict an agent can act on without reasoning
about four different data sources itself: **ALLOW**, **WARN**, or
**BLOCK**.

## Architecture

```
Agent (Claude, Cursor, custom SDK)
        │  MCP tools/call verify_package
        ▼
Express  ──▶  x402 payment gate (freemium LRU counter, then 402)
        │
        ▼
StreamableHTTPServerTransport (fresh per request, stateless mode)
        │
        ▼
McpServer → verify_package
        │
        ├──▶ registry.ts   (registry.npmjs.org | pypi.org)
        ├──▶ osv.ts        (api.osv.dev)
        ├──▶ depsdev.ts    (api.deps.dev — OpenSSF Scorecard)
        └──▶ typosquat.ts  (fast-levenshtein vs. curated popular list)
                │
                ▼
        oracle.ts aggregates → { verdict, findings[] }
```

## Quickstart

```bash
npm install
cp .env.example .env   # fill in RECIPIENT_WALLET for production use
npm run build
npm start
```

Or for local iteration with hot reload:

```bash
npm run dev
```

The server listens on `PORT` (default `3000`) and exposes:

| Endpoint      | Method            | Purpose                                    |
| ------------- | ----------------- | ------------------------------------------- |
| `/mcp`        | `POST`            | MCP tool calls — gated by the x402 middleware |
| `/mcp`        | `GET`, `DELETE`   | Streamable HTTP protocol completeness (no-ops) |
| `/health`     | `GET`             | Liveness check, always free                 |

## Environment variables

See [`.env.example`](.env.example) for the full list with defaults. The
only one you must set for a real deployment is `RECIPIENT_WALLET` — every
other value has a sane fallback (see `src/config.ts`).

| Variable                     | Default                                     | Meaning |
| ----------------------------- | -------------------------------------------- | ------- |
| `RECIPIENT_WALLET`            | *(dev-only burn address)*                    | Base L2 wallet that receives USDC payments |
| `PRICE_ATOMIC_USDC`           | `3000` (= $0.003)                            | Price per call once the free tier is spent |
| `FREE_TIER_LIMIT`             | `5`                                          | Free calls per wallet/IP before the 402 gate |
| `UPSTREAM_TIMEOUT_MS`         | `8000`                                       | Timeout for registry/OSV/deps.dev calls |
| `NEW_PACKAGE_THRESHOLD_DAYS`  | `30`                                         | Age under which a package is "new" |
| `TYPOSQUAT_MAX_DISTANCE`      | `2`                                          | Max Levenshtein distance still flagged |
| `BASE_RPC_URL`                | `https://mainnet.base.org`                   | RPC endpoint used to verify payments on-chain |
| `PAYMENT_MAX_AGE_SECONDS`     | `600`                                        | Max age of a settled tx still accepted as proof |

## The `verify_package` tool

**Input schema:**

```json
{
  "ecosystem": "npm | pypi",
  "name": "string (required)",
  "version": "string (optional — exact version to check)"
}
```

**Example call and response:**

```jsonc
// request
{ "ecosystem": "npm", "name": "expres" }

// response (verdict text + machine-readable JSON in content[])
{
  "verdict": "WARN",
  "findings": [
    {
      "code": "TYPOSQUAT_NAME_SIMILARITY",
      "message": "\"expres\" is close (distance 1) to the popular package \"express\". ..."
    }
  ],
  "registry": { "exists": true, "ageDays": 4800, "...": "..." },
  "osv": { "vulnerabilities": [], "highestSeverity": "UNKNOWN" },
  "scorecard": { "overallScore": 1.5, "sourceRepo": "github.com/..." },
  "typosquat": { "suspected": true, "distance": 1, "redFlag": false }
}
```

When no `version` is given, the oracle resolves the registry's **latest**
published version internally before querying OSV/deps.dev — querying OSV
with no version at all returns every vulnerability ever disclosed for the
package, patched or not, which would make a long-lived, well-maintained
package like `lodash` permanently read as `BLOCK`. A `CHECKED_LATEST_VERSION`
finding tells you which version was actually evaluated.

### Verdict logic (first match wins)

1. **BLOCK** — the name doesn't exist on the registry at all (the
   strongest possible hallucination/slopsquat signal).
2. **BLOCK** — a pinned version was requested but doesn't exist.
3. **BLOCK** — near-miss of a popular package name **and** published
   within `NEW_PACKAGE_THRESHOLD_DAYS`.
4. **BLOCK** — a known CRITICAL or HIGH severity vulnerability applies.
5. **WARN** — a MODERATE/LOW/UNKNOWN vulnerability, a new package without
   a typosquat match, an older near-miss name, or a low OpenSSF Scorecard.
6. **ALLOW** — nothing above fired.

## Monetization: x402 on Base

Every `POST /mcp` call is gated by `src/middleware/payment.ts`:

1. The caller is identified by `Authorization: Bearer <wallet>` (or an
   `X-Wallet-Address` header), falling back to remote IP if neither is
   present. **This identity is self-declared, not verified** — nothing
   stops a client from rotating the header to claim a fresh free
   allowance. `FREE_TIER_LIMIT` defaults to `5` specifically because of
   this: the free tier is a landing ramp, not an authenticated quota, so
   it's sized to keep casual abuse cheap to give away rather than to be
   unbeatable. Closing this properly means requiring a signed proof of
   wallet ownership (e.g. a signed nonce) — not implemented here.
2. The first `FREE_TIER_LIMIT` calls per identity are free — a tool that
   402s on the very first call never gets tried by an agent, and never
   gets adopted.
3. Once the free tier is spent, a request without a valid
   `X-PAYMENT-PROOF` header gets `402 Payment Required` with a
   machine-readable [x402 payment descriptor](https://x402.gitbook.io/x402/core-concepts/x402-specification):

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "3000",
    "payTo": "0xYourWalletAddress",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "resource": "https://your-domain.example/mcp",
    "mimeType": "application/json",
    "maxTimeoutSeconds": 60
  }]
}
```

`asset` is native USDC's real contract address on Base mainnet
([BaseScan](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)) —
not a placeholder.

### Payment verification (real, on-chain)

`src/services/paymentVerifier.ts` verifies every `X-PAYMENT-PROOF` directly
against Base mainnet via `viem` — no facilitator, no third party. For a
claimed transaction hash, it confirms, in order:

1. It's syntactically a transaction hash.
2. It hasn't already been redeemed for a previous call (replay guard,
   reserved *before* the RPC round-trip so two concurrent requests can't
   both spend the same payment).
3. The transaction is mined and succeeded.
4. It happened recently enough (`PAYMENT_MAX_AGE_SECONDS`, default 10 min)
   to plausibly be *this* payment, not an old unrelated transfer.
5. It contains an ERC-20 `Transfer` log from the configured USDC contract,
   to `RECIPIENT_WALLET`, for at least `PRICE_ATOMIC_USDC`.

An RPC-level failure (the node itself unreachable) is distinguished from a
rejected payment: the middleware returns `503` for the former (the client
should retry the *same* proof, not pay twice) and `402` for the latter
(the client needs a new payment). Every branch above — malformed hash,
not-yet-mined, wrong recipient, too old, and the happy path plus replay
rejection — was exercised against live Base mainnet data during
development; see the git history / session notes if you want the exact
transactions used.

The public `BASE_RPC_URL` default has no uptime guarantee. Once real
volume depends on this, switch to a dedicated provider (Alchemy, Infura,
QuickNode) via the env var — no code change needed.

## Client configuration

`pkg-oracle` speaks MCP over Streamable HTTP, so any MCP-compatible client
pointed at `http://<host>:<port>/mcp` works. Below are the three most
common integrations.

### Claude Desktop

Edit your `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "pkg-oracle": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer 0xYourAgentWalletAddress"
      }
    }
  }
}
```

Restart Claude Desktop; `verify_package` will appear in the tool picker.

### Cursor

Add to `.cursor/mcp.json` (project-level) or the global MCP settings:

```json
{
  "mcpServers": {
    "pkg-oracle": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer 0xYourAgentWalletAddress"
      }
    }
  }
}
```

### Custom agent (Claude Agent SDK / any MCP client SDK)

```ts
import { experimental_createMCPClient as createMcpClient } from "ai"; // or your SDK's MCP client
// Any MCP-over-HTTP client works the same way — point it at /mcp and
// attach the wallet identity header. Once the free tier is spent, wrap
// the transport's fetch with an x402-aware HTTP client (e.g. x402-fetch,
// x402-axios) so 402 responses are paid and retried automatically instead
// of surfacing as an error to the agent.

const client = await createMcpClient({
  transport: {
    type: "http",
    url: "http://localhost:3000/mcp",
    headers: { Authorization: "Bearer 0xYourAgentWalletAddress" },
  },
});

const result = await client.tools().verify_package({
  ecosystem: "npm",
  name: "expres",
});
```

If you're not using an x402-aware HTTP client yet, you can also drive the
raw handshake yourself: call once, read the `402` body's `accepts[0]`,
settle that payment, then retry the same request with
`X-PAYMENT-PROOF: <tx-hash>`.

## Docker

```bash
docker build -t pkg-oracle .
docker run -p 3000:3000 \
  -e RECIPIENT_WALLET=0xYourWalletAddress \
  -e FREE_TIER_LIMIT=5 \
  pkg-oracle
```

The image is a multistage, non-root, production-only build (dev
dependencies and TypeScript source are stripped from the final layer).

## Despliegue en producción (Fly.io)

`fly.toml` ya está configurado para desplegar directamente desde el
`Dockerfile` — HTTPS automático, health check contra `/health`, y un
`primary_region` en Madrid para baja latencia. Pasos:

```bash
# 1. Instala flyctl y autentícate (una sola vez)
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. Desde la raíz del proyecto: crea la app (usa el fly.toml existente)
fly launch --no-deploy   # detecta fly.toml, no lo sobreescribas si pregunta

# 3. Configura los secretos (nunca los pongas en fly.toml ni los commitees)
fly secrets set RECIPIENT_WALLET=0xTuWalletReal
# Opcional, solo si usas un RPC dedicado en vez del público:
fly secrets set BASE_RPC_URL=https://tu-endpoint-alchemy-o-quicknode.example

# 4. Despliega
fly deploy

# 5. Verifica
curl https://pkg-oracle.fly.dev/health
```

Tu servidor queda en `https://pkg-oracle.fly.dev/mcp` (o el dominio custom
que configures con `fly certs add`) con TLS ya resuelto — sin eso, x402
no tiene sentido: el campo `resource` del reto de pago necesita ser una
URL real y segura para que un cliente x402 confíe en ella.

**Antes de escalar a más de una máquina:** el contador freemium y el
registro de pagos redimidos viven en memoria (LRU) por proceso. Con
`min_machines_running = 1` (el valor por defecto en `fly.toml`) esto no es
un problema. Si escalas horizontalmente, un mismo wallet obtendría
`FREE_TIER_LIMIT` llamadas gratis *por instancia* en vez de en total —
en ese punto, mueve ambos contadores a Redis (Fly ofrece Upstash Redis
como addon) antes de subir `min_machines_running`.

## Known limitations / honest scope notes

- **Popular-package list is curated, not a live top-1000 feed.** It's a
  hand-picked shortlist of the highest-value typosquat targets in each
  ecosystem (`src/services/popularPackages.ts`), not a synced download-rank
  API. Good enough to catch `expres` → `express`; won't catch a typo of a
  mid-tier package outside the list. Syncing against npm's/PyPI's real
  download-rank data on a cron is the natural next step.
- **The free-tier counter and the redeemed-payments ledger are both
  in-memory (LRU)**, not persisted — they reset on restart and don't
  share state across multiple server instances. Fine at `min_machines_running: 1`
  (the default); back both with Redis before scaling horizontally (see
  Despliegue en producción above).
- **Public `BASE_RPC_URL` has no uptime SLA.** Switch to a dedicated
  provider once real revenue depends on payment verification staying up.
- **CVSS-vector severity estimation is a conservative heuristic**, used
  only when OSV doesn't supply an explicit `database_specific.severity`
  string (see the doc comment in `src/services/osv.ts`).
