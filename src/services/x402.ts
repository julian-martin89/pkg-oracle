import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { SOLANA_MAINNET_CAIP2, USDC_MAINNET_ADDRESS as SOLANA_USDC_MAINNET_ADDRESS } from "@x402/svm";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { config } from "../config.js";

/** CAIP-2 identifier for Solana mainnet-beta, re-exported so callers don't need to import @x402/svm directly. */
export const SOLANA_NETWORK = SOLANA_MAINNET_CAIP2 as `${string}:${string}`;

/**
 * The single shared x402 resource server, wired to CDP's hosted facilitator
 * and the Bazaar discovery extension. Both the MCP payment wrapper
 * (mcpServer.ts) and the plain-HTTP payment gate (httpVerify.ts) build,
 * verify, and settle payments through this one instance — so the facilitator
 * only initializes once at boot, not once per transport.
 *
 * `initialize()` is a real authenticated network call to CDP; importing this
 * module blocks on it, so a bad key or an unreachable facilitator fails the
 * whole process at startup instead of at the first paid request.
 */
const facilitatorClient = createCdpFacilitatorClient({
  apiKeyId: config.cdpApiKeyId,
  apiKeySecret: config.cdpApiKeySecret,
});

let builder = new x402ResourceServer(facilitatorClient).register(config.x402Network, new ExactEvmScheme());

// Solana is additive and opt-in via SOLANA_RECIPIENT_WALLET — registering it
// unconditionally would offer a network we have nowhere to settle funds to.
if (config.solanaRecipientWallet) {
  builder = builder.register(SOLANA_NETWORK, new ExactSvmScheme());
}

export const resourceServer = builder.registerExtension(bazaarResourceServerExtension);

await resourceServer.initialize();

/**
 * Price for one verify_package call, as an explicit AssetAmount.
 *
 * Two things a live test forced us to spell out by hand here:
 *   - `amount` is in atomic USDC units, not dollars. A bare string like
 *     "3000" would be parsed as *Money* ($3000). The AssetAmount form keeps
 *     it as 3000 atomic units = $0.003.
 *   - `extra` carries USDC's EIP-712 domain (name/version). The Money path
 *     auto-fills this while resolving the network's default stablecoin;
 *     the AssetAmount path skips that step, and without it no real client
 *     can construct a valid EIP-3009 signature.
 */
export const verifyPackagePrice = {
  asset: config.usdcAssetAddress,
  amount: String(config.priceAtomicUsdc),
  extra: { name: "USD Coin", version: "2" },
} as const;

/**
 * Same price on Solana — USDC is 6-decimal on both chains, so the atomic
 * amount is identical. No `extra` domain fields needed here: unlike EIP-712
 * on EVM, ExactSvmScheme fills in what it needs (fee payer, blockhash)
 * itself via `enhancePaymentRequirements`.
 */
export const verifyPackagePriceSolana = {
  asset: SOLANA_USDC_MAINNET_ADDRESS,
  amount: String(config.priceAtomicUsdc),
} as const;
