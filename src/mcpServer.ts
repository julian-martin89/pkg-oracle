import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LRUCache } from "lru-cache";
import { createPaymentWrapper, type MCPToolContext, type ToolResult } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { verifyPackage } from "./services/oracle.js";
import { resourceServer, verifyPackagePrice } from "./services/x402.js";
import { config } from "./config.js";
import type { Ecosystem } from "./types.js";

/**
 * x402 payment wiring for `verify_package`, set up once at module load. The
 * shared resource server (facilitator + Bazaar extension, already
 * initialized) lives in services/x402.ts; here we just build this tool's
 * payment requirements and wrap its handler.
 */
const verifyPackageAccepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: config.x402Network,
  payTo: config.recipientWallet,
  price: verifyPackagePrice,
  maxTimeoutSeconds: 60,
});

/**
 * The actual dependency-trust-oracle logic, shape-compatible with both the
 * free path (called directly below) and the paid path (wrapped by
 * `createPaymentWrapper` — it verifies payment, calls this, then settles).
 */
async function rawVerifyPackageHandler(
  args: { ecosystem: Ecosystem; name: string; version?: string },
  _context: MCPToolContext,
): Promise<ToolResult> {
  const { ecosystem, name, version } = args;
  try {
    const result = await verifyPackage(ecosystem, name, version ?? null);

    const header = [
      `Verdict: ${result.verdict}`,
      `Package: ${result.ecosystem}/${result.name}${result.version ? `@${result.version}` : ""}`,
      "",
    ];
    const findingLines = result.findings.map((f) => `- [${f.code}] ${f.message}`);

    return {
      content: [
        { type: "text" as const, text: [...header, ...findingLines].join("\n") },
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `verify_package failed while checking "${name}": ${message}`,
        },
      ],
    };
  }
}

const paidVerifyPackageHandler = createPaymentWrapper(resourceServer, {
  accepts: verifyPackageAccepts,
  resource: {
    // Explicit — the default is `mcp://tool/{toolName}`, but the wrapper
    // doesn't know which tool name it'll be attached to, so it falls back
    // to a generic "paid_tool" placeholder if we don't set this.
    url: "mcp://tool/verify_package",
    description: "Dependency trust check for AI coding agents — npm/PyPI typosquat, CVE, and scorecard verdicts.",
    serviceName: "pkg-oracle",
    tags: ["security", "supply-chain", "npm", "pypi", "typosquatting"],
  },
  extensions: declareDiscoveryExtension({
    toolName: "verify_package",
    description: "Verify an npm/PyPI package for typosquatting, known CVEs, and OpenSSF Scorecard before installing it.",
    inputSchema: {
      type: "object",
      properties: {
        ecosystem: { type: "string", enum: ["npm", "pypi"] },
        name: { type: "string" },
        version: { type: "string" },
      },
      required: ["ecosystem", "name"],
    },
    output: {
      example: {
        verdict: "WARN",
        findings: [{ code: "TYPOSQUAT_NAME_SIMILARITY", message: "..." }],
      },
    },
  }),
})(rawVerifyPackageHandler);

/**
 * Marks which caller identities have exhausted their free tier. Identity is
 * a self-declared `Authorization: Bearer <wallet>` header (or IP as
 * fallback) — NOT cryptographically verified. See the `freeTierLimit`
 * doc comment in config.ts for why that's an accepted, bounded risk
 * rather than a bug to fix here.
 */
const callerCounters = new LRUCache<string, { callCount: number }>({
  max: config.rateLimitCacheMaxEntries,
  ttl: config.rateLimitCacheTtlMs,
});

type IsomorphicHeaders = Record<string, string | string[] | undefined>;

function headerValue(headers: IsomorphicHeaders | undefined, name: string): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function identifyCaller(headers: IsomorphicHeaders | undefined): string {
  const authHeader = headerValue(headers, "authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const wallet = authHeader.slice("Bearer ".length).trim();
    if (wallet.length > 0) return `wallet:${wallet.toLowerCase()}`;
  }

  const walletHeader = headerValue(headers, "x-wallet-address");
  if (walletHeader) return `wallet:${walletHeader.toLowerCase()}`;

  // No wallet attached yet — fall back to the client IP Fly's edge proxy
  // reports, so the free tier still has *some* identity to count against.
  const forwardedFor = headerValue(headers, "x-forwarded-for");
  if (forwardedFor) return `ip:${forwardedFor.split(",")[0]?.trim()}`;

  return "ip:unknown";
}

/** Consumes one free-tier credit for `callerId` if any remain; returns whether this call is free. */
function isUnderFreeTier(callerId: string): boolean {
  const state = callerCounters.get(callerId) ?? { callCount: 0 };
  if (state.callCount >= config.freeTierLimit) return false;
  state.callCount += 1;
  callerCounters.set(callerId, state);
  return true;
}

/**
 * One structured JSON line per `verify_package` call, to stdout — Fly
 * captures this automatically and makes it searchable via `fly logs` and
 * the dashboard. Without this, the only way to know traffic is happening
 * at all is checking the recipient wallet on BaseScan.
 */
function logCall(fields: {
  callerId: string;
  paid: boolean;
  ecosystem: string;
  name: string;
  version: string | undefined;
  result: ToolResult;
}): void {
  const verdict = fields.result.isError
    ? "ERROR"
    : (fields.result.content[0]?.text.match(/^Verdict: (\w+)/)?.[1] ?? "UNKNOWN");

  console.log(
    JSON.stringify({
      event: "verify_package_call",
      time: new Date().toISOString(),
      callerId: fields.callerId,
      paid: fields.paid,
      ecosystem: fields.ecosystem,
      name: fields.name,
      version: fields.version ?? null,
      verdict,
    }),
  );
}

/**
 * Builds a fresh `McpServer` instance with `verify_package` registered.
 *
 * This is a factory, not a singleton, because the Streamable HTTP transport
 * in stateless mode (`sessionIdGenerator: undefined`) can only be attached
 * to a single request — reusing one transport/server pair across requests
 * throws "Stateless transport cannot be reused across requests" from the
 * SDK. Registration is cheap (one tool, no I/O — the expensive x402 setup
 * above already ran once at module load), so paying that cost once per
 * HTTP request is the correct tradeoff for a stateless, horizontally
 * scalable oracle.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "pkg-oracle", version: "1.0.0" });

  server.registerTool(
    "verify_package",
    {
      title: "Verify Package",
      description:
        "Dependency Trust Oracle. Call this BEFORE writing any package into a manifest " +
        "(package.json, requirements.txt, pyproject.toml, ...). It checks whether the " +
        "package actually exists on its registry, cross-references OSV.dev for known " +
        "CVEs, pulls the package's OpenSSF Scorecard via deps.dev, and runs a " +
        "Levenshtein-distance typosquat/slopsquat check against a curated list of " +
        "popular packages combined with the package's publish age. Returns a synthetic " +
        "verdict: ALLOW (no issues found), WARN (proceed with caution — read the " +
        "findings before installing), or BLOCK (do not install — likely a hallucinated " +
        "package name, an active typosquat, or a known critical/high-severity " +
        "vulnerability). Always call this before running an install command for a " +
        "package you have not already verified in this session. " +
        `First ${config.freeTierLimit} calls per caller are free; after that this tool ` +
        "requires x402 payment (USDC on Base) and will return a payment-required error " +
        "with the amount and address to pay.",
      inputSchema: {
        ecosystem: z
          .enum(["npm", "pypi"])
          .describe("Package registry to check the name against."),
        name: z
          .string()
          .min(1)
          .max(214)
          .describe("Exact package name as it would appear in the manifest (case-sensitive for npm scoped packages)."),
        version: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe('Optional exact version string to verify (e.g. "4.17.21"). Omit to check only the package name.'),
      },
    },
    async (args, extra) => {
      const callerId = identifyCaller(extra.requestInfo?.headers);
      const toolArgs = { ecosystem: args.ecosystem as Ecosystem, name: args.name, version: args.version };
      const free = isUnderFreeTier(callerId);

      const result = free
        ? await rawVerifyPackageHandler(toolArgs, { toolName: "verify_package", arguments: args })
        : await paidVerifyPackageHandler(toolArgs, extra);

      logCall({ callerId, paid: !free, ...toolArgs, result });
      return result;
    },
  );

  return server;
}
