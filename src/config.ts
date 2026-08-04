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
// address so `npm run dev` works out of the box without an .env file.
const RECIPIENT_WALLET = requireEnv(
  "RECIPIENT_WALLET",
  isProduction ? undefined : "0x000000000000000000000000000000000000dEaD",
);

if (!/^0x[a-fA-F0-9]{40}$/.test(RECIPIENT_WALLET)) {
  throw new Error(
    `[config] RECIPIENT_WALLET must be a valid EVM address (0x + 40 hex chars), got: "${RECIPIENT_WALLET}"`,
  );
}

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: optionalIntEnv("PORT", 3000),

  /** Wallet (Base L2) that receives USDC micropayments via x402. */
  recipientWallet: RECIPIENT_WALLET,

  /** Native USDC on Base mainnet — Circle-issued FiatTokenProxy. */
  usdcAssetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",

  /** x402 network identifier for Base mainnet. */
  x402Network: "base",

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

  /**
   * Base mainnet JSON-RPC endpoint used to verify x402 payments on-chain.
   * The public endpoint has no auth and is fine for low/medium volume, but
   * carries no uptime guarantee — swap in a dedicated provider (Alchemy,
   * Infura, QuickNode) once real traffic depends on this.
   */
  baseRpcUrl: process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org",

  /**
   * How old (seconds) a settled payment transaction may be and still be
   * accepted as proof for the *current* call. Bounds the replay window to
   * "recent enough to plausibly be this payment" rather than accepting any
   * USDC transfer to the wallet ever made.
   */
  paymentMaxAgeSeconds: optionalIntEnv("PAYMENT_MAX_AGE_SECONDS", 600),
} as const;
