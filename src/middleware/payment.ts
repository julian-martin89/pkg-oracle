import type { NextFunction, Request, Response } from "express";
import { LRUCache } from "lru-cache";
import { config } from "../config.js";
import { verifyOnChainPayment } from "../services/paymentVerifier.js";

/**
 * x402 pay-per-call gate for the MCP endpoint.
 *
 * Flow per request:
 *   1. Identify the caller — from a wallet address on `Authorization: Bearer
 *      <wallet>` if present, falling back to remote IP for callers that
 *      haven't attached a wallet yet (so the free tier still has a concept
 *      of "who" even before a client integrates payment).
 *   2. Look up (and increment) that identity's call count in an in-memory
 *      LRU counter. The first `FREE_TIER_LIMIT` calls are free — this is
 *      the "freemium-to-land" pattern: a tool that 402s on the very first
 *      call never gets tried by an agent, and never gets adopted.
 *   3. Once the free tier is exhausted, the caller must present payment
 *      proof via `X-PAYMENT-PROOF` (a settled Base transaction hash),
 *      checked on-chain by `verifyOnChainPayment` (see paymentVerifier.ts).
 *      Absent or invalid proof → `402 Payment Required` with a
 *      machine-readable x402 payment-accepts descriptor. An RPC-level
 *      failure while checking a proof that *might* be valid → `503`,
 *      distinct from 402, so a client doesn't pay twice for a payment
 *      that already went through.
 */

interface CallerState {
  callCount: number;
}

const callerCounters = new LRUCache<string, CallerState>({
  max: config.rateLimitCacheMaxEntries,
  ttl: config.rateLimitCacheTtlMs,
});

function identifyCaller(req: Request): string {
  const authHeader = req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const wallet = authHeader.slice("Bearer ".length).trim();
    if (wallet.length > 0) return `wallet:${wallet.toLowerCase()}`;
  }

  const walletHeader = req.header("x-wallet-address");
  if (walletHeader) return `wallet:${walletHeader.toLowerCase()}`;

  // No wallet attached yet — fall back to remote address so the free tier
  // still has *some* identity to count against instead of being global.
  return `ip:${req.ip ?? "unknown"}`;
}

function buildX402Challenge(req: Request, rejectionReason?: string) {
  const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  return {
    x402Version: 1,
    error: rejectionReason ?? "Payment required to continue calling pkg-oracle.",
    accepts: [
      {
        scheme: "exact",
        network: config.x402Network,
        maxAmountRequired: String(config.priceAtomicUsdc),
        resource: resourceUrl,
        description:
          "pkg-oracle verify_package call — dependency trust check for AI coding agents.",
        mimeType: "application/json",
        payTo: config.recipientWallet,
        maxTimeoutSeconds: 60,
        asset: config.usdcAssetAddress,
        extra: {
          name: "USD Coin",
          decimals: 6,
        },
      },
    ],
  };
}

/**
 * Express middleware implementing the freemium + x402 gate described above.
 * Mount it in front of the MCP request handler.
 */
export function x402PaymentGate(req: Request, res: Response, next: NextFunction): void {
  const callerId = identifyCaller(req);
  const state = callerCounters.get(callerId) ?? { callCount: 0 };

  if (state.callCount < config.freeTierLimit) {
    state.callCount += 1;
    callerCounters.set(callerId, state);
    res.setHeader("X-Oracle-Free-Calls-Remaining", String(config.freeTierLimit - state.callCount));
    next();
    return;
  }

  const proof = req.header("x-payment-proof");
  if (!proof) {
    res.status(402).json(buildX402Challenge(req));
    return;
  }

  verifyOnChainPayment(proof)
    .then((result) => {
      if (result.valid) {
        // Payment accepted for this call. We deliberately do NOT increment
        // callCount further once the free tier is spent — paid calls are
        // unlimited by design; only the first N are metered.
        next();
        return;
      }
      res.status(402).json(buildX402Challenge(req, result.reason));
    })
    .catch((err) => {
      // Our own RPC call failed — the client's payment may be perfectly
      // valid. 503 (not 402) tells an x402-aware client "retry, don't pay
      // again" instead of triggering a second, wasted payment.
      console.error("[x402] on-chain payment verification failed:", err);
      res.status(503).json({
        error: "Payment verification is temporarily unavailable. Retry shortly with the same X-PAYMENT-PROOF.",
      });
    });
}
