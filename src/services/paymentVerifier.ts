import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  TransactionReceiptNotFoundError,
  type Hash,
} from "viem";
import { base } from "viem/chains";
import { LRUCache } from "lru-cache";
import { config } from "../config.js";

const client = createPublicClient({
  chain: base,
  transport: http(config.baseRpcUrl),
});

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

/**
 * Marks which payment proofs have already been redeemed, closing the
 * "pay once, replay the tx hash forever" hole. `"pending"` is written
 * *synchronously* the instant a hash passes the format check — before any
 * `await` — so two concurrent requests presenting the same proof can't
 * both slip through while the first one's on-chain lookup is in flight.
 * Node's single-threaded event loop guarantees nothing else runs between
 * the `.has()` check and the `.set()` reservation below.
 */
const redeemedProofs = new LRUCache<string, "pending" | "confirmed">({
  max: config.rateLimitCacheMaxEntries,
  ttl: config.rateLimitCacheTtlMs,
});

export interface PaymentVerificationResult {
  valid: boolean;
  reason: string;
}

/**
 * Verifies a claimed x402 payment against Base mainnet.
 *
 * Rejections here (bad format, already redeemed, wrong recipient/amount,
 * transaction reverted, too old) are *definitive* — the caller should pay
 * again. A thrown error means our own RPC call failed (network blip,
 * provider outage) — the caller's payment may well be fine; they should
 * retry shortly, not necessarily pay twice. The HTTP layer maps these two
 * cases to 402 vs 503 respectively.
 */
export async function verifyOnChainPayment(rawProof: string): Promise<PaymentVerificationResult> {
  const hash = rawProof.trim().toLowerCase() as Hash;

  if (!TX_HASH_PATTERN.test(hash)) {
    return { valid: false, reason: "X-PAYMENT-PROOF is not a valid transaction hash (expected 0x + 64 hex chars)." };
  }

  if (redeemedProofs.has(hash)) {
    return { valid: false, reason: "This payment proof has already been redeemed for a previous call." };
  }
  redeemedProofs.set(hash, "pending"); // reserve now, before the first await

  try {
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash });
    } catch (err) {
      if (err instanceof TransactionReceiptNotFoundError) {
        redeemedProofs.delete(hash);
        return {
          valid: false,
          reason: `Transaction ${hash} was not found — it may still be pending confirmation. Retry in a few seconds.`,
        };
      }
      throw err; // genuine RPC/network failure — let the caller distinguish this from a rejection
    }

    if (receipt.status !== "success") {
      redeemedProofs.delete(hash);
      return { valid: false, reason: `Transaction ${hash} did not succeed on-chain (status: ${receipt.status}).` };
    }

    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const ageSeconds = Date.now() / 1000 - Number(block.timestamp);
    if (ageSeconds > config.paymentMaxAgeSeconds) {
      redeemedProofs.delete(hash);
      return {
        valid: false,
        reason: `Transaction ${hash} is ${Math.round(ageSeconds)}s old, older than the ` +
          `${config.paymentMaxAgeSeconds}s payment window — it can't be redeemed for a new call.`,
      };
    }

    const paidEnough = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== config.usdcAssetAddress.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics });
        return (
          decoded.args.to.toLowerCase() === config.recipientWallet.toLowerCase() &&
          decoded.args.value >= BigInt(config.priceAtomicUsdc)
        );
      } catch {
        return false; // a log on the USDC contract that isn't a Transfer (rare, but not our concern)
      }
    });

    if (!paidEnough) {
      redeemedProofs.delete(hash);
      return {
        valid: false,
        reason: `Transaction ${hash} does not contain a USDC transfer of at least ` +
          `${config.priceAtomicUsdc} atomic units to ${config.recipientWallet}.`,
      };
    }

    redeemedProofs.set(hash, "confirmed");
    return { valid: true, reason: "Payment verified on-chain." };
  } catch (err) {
    redeemedProofs.delete(hash);
    throw err;
  }
}
