import "dotenv/config";

/**
 * Centralized, validated environment configuration for pkg-oracle.
 *
 * Every value the rest of the app needs is resolved here once, at boot,
 * so a misconfigured deployment fails loudly on startup instead of
 * silently mispricing a request three hours into production traffic.
 */

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value.length === 0) {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optionalIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`[config] ${name} must be a non-negative integer, got: "${raw}"`);
  }
  return parsed;
}

const NODE_ENV = process.env.NODE_ENV ?? "development";
const isProduction = NODE_ENV === "production";

// The wallet that receives x402 USDC micropayments. Required in production;
// in development we fall back to a well-known Base testnet burn-style
// address so `npm run dev` boots without an .env file (though CDP
// credentials below are still required either way — the resource server
// authenticates against the real CDP facilitator regardless of environment).
const RECIPIENT_WALLET = requireEnv(
  "RECIPIENT_WALLET",
  isProduction ? undefined : "0x000000000000000000000000000000000000dEaD",
);

if (!/^0x[a-fA-F0-9]{40}$/.test(RECIPIENT_WALLET)) {
  throw new Error(
    `[config] RECIPIENT_WALLET must be a valid EVM address (0x + 40 hex chars), got: "${RECIPIENT_WALLET}"`,
  );
}

// CDP facilitator credentials. No safe dev fallback exists here — unlike
// the rest of this config, there is no harmless placeholder that lets the
// resource server boot without real auth, because `resourceServer.initialize()`
// makes a real authenticated call to CDP on startup regardless of NODE_ENV.
const CDP_API_KEY_ID = requireEnv("CDP_API_KEY_ID");
const CDP_API_KEY_SECRET = requireEnv("CDP_API_KEY_SECRET");

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: optionalIntEnv("PORT", 3000),

  /** Wallet (Base L2) that receives USDC micropayments via x402. Never custodied by CDP. */
  recipientWallet: RECIPIENT_WALLET,

  /** CDP (Coinbase Developer Platform) API credentials, for the hosted x402 facilitator. */
  cdpApiKeyId: CDP_API_KEY_ID,
  cdpApiKeySecret: CDP_API_KEY_SECRET,

  /** CAIP-2 network identifier for Base mainnet. */
  x402Network: "eip155:8453",

  /** Native USDC on Base mainnet — Circle-issued FiatTokenProxy. */
  usdcAssetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",

  /** Price per `verify_package` call once the free tier is exhausted, in atomic USDC units (6 decimals). */
  priceAtomicUsdc: optionalIntEnv("PRICE_ATOMIC_USDC", 3_000), // 3000 / 1e6 = $0.003

  /**
   * Number of free calls granted per wallet/client before x402 kicks in.
   * Caller identity here (a self-declared `Authorization: Bearer <wallet>`
   * header, or IP as fallback) is NOT cryptographically verified — nothing
   * stops a client from rotating the header to get a fresh allowance.
   * Kept deliberately small for exactly that reason: the abuse ceiling is
   * "free calls stay cheap to give away," not "free calls are unlimited."
   */
  freeTierLimit: optionalIntEnv("FREE_TIER_LIMIT", 5),

  /** Max distinct wallet/IP identities tracked in the freemium LRU counter. */
  rateLimitCacheMaxEntries: optionalIntEnv("RATE_LIMIT_CACHE_MAX_ENTRIES", 50_000),

  /** How long (ms) an identity's free-tier counter is remembered before resetting. */
  rateLimitCacheTtlMs: optionalIntEnv("RATE_LIMIT_CACHE_TTL_MS", 1000 * 60 * 60 * 24), // 24h

  /** Outbound HTTP timeout for upstream registry/vuln-DB calls, in ms. */
  upstreamTimeoutMs: optionalIntEnv("UPSTREAM_TIMEOUT_MS", 8_000),

  /** Age (days) under which a brand-new package is treated as suspicious. */
  newPackageThresholdDays: optionalIntEnv("NEW_PACKAGE_THRESHOLD_DAYS", 30),

  /** Max Levenshtein distance to a popular package name that still counts as a typosquat signal. */
  typosquatMaxDistance: optionalIntEnv("TYPOSQUAT_MAX_DISTANCE", 2),
} as const;
