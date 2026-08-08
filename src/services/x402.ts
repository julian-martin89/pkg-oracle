import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { config } from "../config.js";

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

export const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(config.x402Network, new ExactEvmScheme())
  .registerExtension(bazaarResourceServerExtension);

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
