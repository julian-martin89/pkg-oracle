# pkg-oracle — Dependency Trust Oracle

A pay-per-call MCP (Model Context Protocol) server that verifies an npm or
PyPI package **before** an AI coding agent writes it into a manifest.
Monetized per call with the real [x402](https://x402.gitbook.io/x402/)
protocol (signed EIP-3009 authorizations, settled through Coinbase's
hosted facilitator) in USDC on Base — no API keys, no signup, no dashboard.
An agent calls the tool, pays a fraction of a cent, gets a verdict.

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

## Frequently asked questions

### How do I check if an npm package is safe before installing it?

Call the `verify_package` MCP tool with the package name and ecosystem
(`npm` or `pypi`). One call confirms the package actually exists, checks
[OSV.dev](https://osv.dev) for known CVEs, pulls its OpenSSF Scorecard,
and flags typosquat-style name similarity to popular packages. It
returns a single verdict — `ALLOW`, `WARN`, or `BLOCK` — instead of four
separate reports to reason about.

### What is slopsquatting?

Slopsquatting is a supply-chain attack that exploits LLMs hallucinating
plausible-but-nonexistent package names. Attackers register those exact
names in advance; when a coding agent installs the "hallucinated"
package without checking, it actually installs the attacker's package.
pkg-oracle catches this by confirming the name is real, on the actual
registry, before anything gets installed.

### How do coding agents avoid installing a malicious or hallucinated package?

By calling `verify_package` before writing the dependency into a
manifest (`package.json`, `requirements.txt`, `pyproject.toml`). If the
name doesn't exist on the registry at all, or is a recent near-miss of a
popular package, the verdict is `BLOCK` — the strongest available signal
of hallucination or typosquatting.

### Is there an MCP server for verifying npm or PyPI packages?

Yes — pkg-oracle. It's a remote MCP server over Streamable HTTP: no
local install, no API key, no signup. Point any MCP client at
`https://mcp-snowy-dew-9447.fly.dev/mcp`.

### How much does it cost to verify a package?

The first 5 calls per wallet/IP are free. After that, $0.003 USDC per
call, paid via the [x402](https://x402.gitbook.io/x402/) protocol on
Base — no subscription, no API key, no dashboard.

### Does it work with Claude Desktop, Cursor, or Claude Code?

Yes, for the free tier — any Streamable-HTTP-compatible MCP client can
connect (see [Client configuration](#client-configuration) below).
Paying past the free tier needs an x402-aware client, since neither
Claude Desktop nor Cursor ships a built-in x402 signer yet.

## Architecture

```
Agent (Claude, Cursor, custom SDK / x402-aware MCP client)
        │  MCP tools/call verify_package  (_meta["x402/payment"] once paid)
        ▼
StreamableHTTPServerTransport (fresh per request, stateless mode)
        │
        ▼
McpServer → verify_package
        │
        ├─ under free tier? ──▶ raw handler (no charge)
        │
        └─ else ──▶ x402 payment wrapper (@x402/mcp)
                       │
                       ├──▶ CDP facilitator: verify signed payment, settle on-chain
                       └──▶ raw handler
                              │
                              ├──▶ registry.ts   (registry.npmjs.org | pypi.org)
                              ├──▶ osv.ts        (api.osv.dev)
                              ├──▶ depsdev.ts    (api.deps.dev — OpenSSF Scorecard)
                              └──▶ typosquat.ts  (fast-levenshtein vs. curated popular list)
                                     │
                                     ▼
                              oracle.ts aggregates → { verdict, findings[] }
```

Payment gating happens **per MCP tool**, not per HTTP route — `initialize`
and `tools/list` are never charged, only an actual `verify_package` call
past the free tier is.

## Quickstart

```bash
npm install
cp .env.example .env   # RECIPIENT_WALLET + CDP_API_KEY_ID/SECRET are required, even in dev
npm run build
npm start
```

Or for local iteration with hot reload:

```bash
npm run dev
```

Unlike most values in `.env.example`, `RECIPIENT_WALLET` and the two CDP
credentials have no safe placeholder — the resource server authenticates
against CDP's real hosted facilitator at boot, regardless of environment.
There's no way to run this server against fake/mock payment infrastructure.

The server listens on `PORT` (default `3000`) and exposes:

| Endpoint      | Method            | Purpose                                    |
| ------------- | ----------------- | ------------------------------------------- |
| `/mcp`        | `POST`            | MCP tool calls — `verify_package` is payment-gated past the free tier |
| `/mcp`        | `GET`, `DELETE`   | Streamable HTTP protocol completeness (no-ops) |
| `/health`     | `GET`             | Liveness check, always free                 |

## Environment variables

See [`.env.example`](.env.example) for the full list with defaults.

| Variable                     | Default                                     | Meaning |
| ----------------------------- | -------------------------------------------- | ------- |
| `RECIPIENT_WALLET`            | *(dev-only burn address)*                    | Base L2 wallet that receives USDC payments — required |
| `CDP_API_KEY_ID`              | *(none — required)*                          | Coinbase Developer Platform API key ID |
| `CDP_API_KEY_SECRET`          | *(none — required)*                          | Coinbase Developer Platform API key secret |
| `PRICE_ATOMIC_USDC`           | `3000` (= $0.003)                            | Price per call once the free tier is spent |
| `FREE_TIER_LIMIT`             | `5`                                          | Free calls per wallet/IP before payment is required |
| `UPSTREAM_TIMEOUT_MS`         | `8000`                                       | Timeout for registry/OSV/deps.dev calls |
| `NEW_PACKAGE_THRESHOLD_DAYS`  | `30`                                         | Age under which a package is "new" |
| `TYPOSQUAT_MAX_DISTANCE`      | `2`                                          | Max Levenshtein distance still flagged |

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

## Monetization: x402 on Base, via the CDP facilitator

`verify_package` is wrapped with `@x402/mcp`'s `createPaymentWrapper` in
[`src/mcpServer.ts`](src/mcpServer.ts) — the real x402 "exact" scheme, not
a homegrown variant:

1. The caller is identified by `Authorization: Bearer <wallet>` (or an
   `X-Wallet-Address` header), falling back to the client IP Fly's edge
   proxy reports if neither is present. **This identity is self-declared,
   not verified** — nothing stops a client from rotating the header to
   claim a fresh free allowance. `FREE_TIER_LIMIT` defaults to `5`
   specifically because of this: the free tier is a landing ramp, not an
   authenticated quota, sized to keep casual abuse cheap to give away
   rather than to be unbeatable.
2. The first `FREE_TIER_LIMIT` calls per identity run the raw handler
   directly, no payment involved — a tool that requires payment on the
   very first call never gets tried by an agent, and never gets adopted.
3. Past the free tier, a call without a payment payload gets a payment
   error carrying a standard x402 `PaymentRequired` descriptor (`scheme:
   "exact"`, `network: "eip155:8453"`, `payTo: RECIPIENT_WALLET`,
   `amount: "3000"`). Any x402-aware MCP client — `x402MCPClient` from
   `@x402/mcp`, or an agent SDK with built-in x402 support — signs an
   EIP-3009 `transferWithAuthorization` (no gas, no waiting for
   confirmation) and retries with the payload in
   `_meta["x402/payment"]`. The server verifies the signature and settles
   the on-chain transfer through CDP's facilitator, then runs the tool.

**Funds are never custodied by Coinbase.** The facilitator only verifies
the client's signature and submits the resulting transfer on-chain
(`payTo` is `RECIPIENT_WALLET`, resolved at server startup from your own
env var) — CDP never holds the money mid-flight.

Settling through CDP's *hosted* facilitator (as opposed to a generic one)
is also what makes `verify_package` auto-discoverable in the
[x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar): the
`bazaarResourceServerExtension` registered on the resource server plus the
`declareDiscoveryExtension({ toolName: "verify_package", ... })` call in
`mcpServer.ts` get indexed automatically the first time a real payment
settles — there's no separate registration step.

## Client configuration

`pkg-oracle` speaks MCP over Streamable HTTP, so any MCP-compatible client
pointed at `http://<host>:<port>/mcp` works for the free tier. Paying past
the free tier requires an x402-aware MCP client. Below are the common
integrations.

### Claude Desktop / Cursor (free tier only)

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

Neither ships a built-in x402 signer today, so once the free tier is spent
these clients will surface the payment-required error as a tool failure
rather than paying automatically.

### Custom agent with x402 support

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { wrapMCPClientWithPaymentFromConfig } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const mcpClient = new Client({ name: "my-agent", version: "1.0.0" });
await mcpClient.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp")),
);

// account: any viem-compatible signer holding USDC on Base
const x402Client = wrapMCPClientWithPaymentFromConfig(mcpClient, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
});

const result = await x402Client.callTool("verify_package", {
  ecosystem: "npm",
  name: "expres",
});

if (result.paymentMade) {
  console.log("Paid:", result.paymentResponse?.transaction);
}
```

`autoPayment: true` (the default) signs and retries automatically once a
payment-required error is received — no manual 402 handling needed.

## Docker

```bash
docker build -t pkg-oracle .
docker run -p 3000:3000 \
  -e RECIPIENT_WALLET=0xYourWalletAddress \
  -e CDP_API_KEY_ID=your-cdp-key-id \
  -e CDP_API_KEY_SECRET=your-cdp-key-secret \
  -e FREE_TIER_LIMIT=5 \
  pkg-oracle
```

The image is a multistage, non-root, production-only build (dev
dependencies and TypeScript source are stripped from the final layer).

## Despliegue en producción (Fly.io)

`fly.toml` ya está configurado para desplegar directamente desde el
`Dockerfile` — HTTPS automático, health check contra `/health`. Pasos:

```bash
# 1. Instala flyctl y autentícate (una sola vez)
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. Desde la raíz del proyecto: crea la app (usa el fly.toml existente)
fly launch --no-deploy   # detecta fly.toml, no lo sobreescribas si pregunta

# 3. Configura los secretos (nunca los pongas en fly.toml ni los commitees)
fly secrets set RECIPIENT_WALLET=0xTuWalletReal
fly secrets set CDP_API_KEY_ID=tu-cdp-key-id
fly secrets set CDP_API_KEY_SECRET=tu-cdp-key-secret

# 4. Despliega
fly deploy

# 5. Verifica
curl https://tu-app.fly.dev/health
```

Tu servidor queda con TLS ya resuelto en el dominio `*.fly.dev` que Fly
asigne (o el dominio custom que configures con `fly certs add`) — sin eso,
x402 no tiene sentido: el `resource` del reto de pago necesita ser una URL
real y segura para que un cliente x402 confíe en ella.

**Antes de escalar a más de una máquina:** el contador freemium vive en
memoria (LRU) por proceso. Con `min_machines_running = 1` (el valor por
defecto en `fly.toml`) esto no es un problema. Si escalas horizontalmente,
un mismo wallet obtendría `FREE_TIER_LIMIT` llamadas gratis *por
instancia* en vez de en total — en ese punto, mueve el contador a Redis
(Fly ofrece Upstash Redis como addon) antes de subir `min_machines_running`.

## Known limitations / honest scope notes

- **Popular-package list is curated, not a live top-1000 feed.** It's a
  hand-picked shortlist of the highest-value typosquat targets in each
  ecosystem (`src/services/popularPackages.ts`), not a synced download-rank
  API. Good enough to catch `expres` → `express`; won't catch a typo of a
  mid-tier package outside the list. Syncing against npm's/PyPI's real
  download-rank data on a cron is the natural next step.
- **The free-tier counter is in-memory (LRU)**, not persisted — it resets
  on restart and doesn't share state across multiple server instances.
  Fine at `min_machines_running: 1` (the default); back it with Redis
  before scaling horizontally (see Despliegue en producción above).
- **Payment replay protection is delegated to the protocol itself** — the
  EIP-3009 `nonce` in each signed authorization is enforced on-chain by
  USDC's contract, and CDP's facilitator rejects already-settled or
  expired authorizations. Nothing custom to maintain here.
- **Claude Desktop and Cursor have no built-in x402 signer** — they work
  fine for the free tier, but a payment-required response surfaces as a
  tool failure rather than being paid automatically. Use an x402-aware
  MCP client (see Client configuration) to actually pay past the free tier.
- **CVSS-vector severity estimation is a conservative heuristic**, used
  only when OSV doesn't supply an explicit `database_specific.severity`
  string (see the doc comment in `src/services/osv.ts`).
