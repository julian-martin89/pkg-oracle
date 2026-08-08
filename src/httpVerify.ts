import type { Request, Response } from "express";
import { paymentMiddleware } from "@x402/express";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { resourceServer, verifyPackagePrice } from "./services/x402.js";
import { verifyPackage } from "./services/oracle.js";
import { config } from "./config.js";
import type { Ecosystem } from "./types.js";

/**
 * Plain-HTTP twin of the MCP `verify_package` tool.
 *
 * Why this exists alongside the MCP endpoint: the CDP Bazaar's public
 * discovery catalog only surfaces HTTP-transport resources — an MCP tool
 * declaring Bazaar discovery does not appear there, even after a real
 * payment settles. This POST /verify route is the same oracle logic behind
 * a plain HTTP x402 gate, so it lands in the Bazaar catalog and becomes
 * discoverable by autonomous agents without any human configuration.
 *
 * Unlike the MCP path, there is NO free tier here — every call pays. Agents
 * that discover this through the Bazaar expect pay-per-call from the first
 * request; the free tier is a landing ramp for human-configured MCP clients,
 * which doesn't apply to autonomous discovery.
 */
const routes = {
  "POST /verify": {
    accepts: {
      scheme: "exact",
      network: config.x402Network,
      payTo: config.recipientWallet,
      price: verifyPackagePrice,
      maxTimeoutSeconds: 60,
    },
    description:
      "Verify an npm/PyPI package before installing it: existence, known CVEs (OSV.dev), OpenSSF Scorecard, and typosquat/slopsquat similarity. Returns an ALLOW/WARN/BLOCK verdict.",
    serviceName: "pkg-oracle",
    tags: ["security", "supply-chain", "npm", "pypi", "typosquatting"],
    extensions: {
      // HTTP variant of the Bazaar discovery declaration (method inferred
      // from the "POST /verify" route key, so it's omitted here).
      ...declareDiscoveryExtension({
        input: { ecosystem: "npm", name: "express" },
        inputSchema: {
          properties: {
            ecosystem: { type: "string", enum: ["npm", "pypi"] },
            name: { type: "string" },
            version: { type: "string" },
          },
          required: ["ecosystem", "name"],
        },
        bodyType: "json",
        output: {
          example: {
            verdict: "WARN",
            findings: [{ code: "TYPOSQUAT_NAME_SIMILARITY", message: "..." }],
          },
        },
      }),
    },
  },
};

/**
 * The x402 payment gate for POST /verify. Applied app-wide but only acts on
 * the configured route — /mcp and /health pass straight through. Facilitator
 * sync is disabled here because services/x402.ts already initialized it.
 */
export const httpVerifyPaymentGate = paymentMiddleware(routes, resourceServer, undefined, undefined, false);

/** The actual POST /verify handler, reached only after payment is verified. */
export async function handleHttpVerify(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { ecosystem?: unknown; name?: unknown; version?: unknown };
  const { ecosystem, name, version } = body;

  if (ecosystem !== "npm" && ecosystem !== "pypi") {
    res.status(400).json({ error: "'ecosystem' must be 'npm' or 'pypi'." });
    return;
  }
  if (typeof name !== "string" || name.length === 0 || name.length > 214) {
    res.status(400).json({ error: "'name' must be a non-empty string of at most 214 characters." });
    return;
  }
  if (version !== undefined && (typeof version !== "string" || version.length === 0 || version.length > 100)) {
    res.status(400).json({ error: "'version', if provided, must be a non-empty string of at most 100 characters." });
    return;
  }

  try {
    const result = await verifyPackage(ecosystem as Ecosystem, name, version ?? null);
    console.log(
      JSON.stringify({
        event: "verify_package_call",
        transport: "http",
        time: new Date().toISOString(),
        paid: true,
        ecosystem,
        name,
        version: version ?? null,
        verdict: result.verdict,
      }),
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `verify_package failed while checking "${name}": ${message}` });
  }
}
