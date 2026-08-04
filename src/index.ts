import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { buildMcpServer } from "./mcpServer.js";
import { x402PaymentGate } from "./middleware/payment.js";

/**
 * Handles one Streamable HTTP request end-to-end with a brand-new
 * server + transport pair (see `mcpServer.ts` for why stateless mode
 * requires this instead of one shared instance), then tears both down
 * once the HTTP response has finished.
 */
async function handleMcpRequest(
  req: express.Request,
  res: express.Response,
  body?: unknown,
): Promise<void> {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no session bookkeeping needed
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("[mcp] request handling failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

async function main(): Promise<void> {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true); // needed for req.ip to reflect the real client behind a reverse proxy
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "pkg-oracle",
      version: "1.0.0",
      time: new Date().toISOString(),
    });
  });

  // Tool invocation goes through the x402 payment gate; everything else
  // (health checks) stays free.
  app.post("/mcp", x402PaymentGate, (req, res) => {
    void handleMcpRequest(req, res, req.body);
  });

  // Streamable HTTP also defines GET (standalone SSE stream for
  // server-initiated notifications) and DELETE (session teardown). This
  // server never pushes unsolicited notifications and is stateless, so
  // these are protocol-completeness no-ops rather than load-bearing paths
  // — but a spec-compliant client may still probe them, so answer politely
  // instead of 404ing.
  app.get("/mcp", (req, res) => {
    void handleMcpRequest(req, res);
  });

  app.delete("/mcp", (req, res) => {
    void handleMcpRequest(req, res);
  });

  const httpServer = app.listen(config.port, () => {
    console.log(`pkg-oracle listening on port ${config.port} (${config.nodeEnv})`);
    console.log(`  MCP endpoint:      http://localhost:${config.port}/mcp`);
    console.log(`  Health check:      http://localhost:${config.port}/health`);
    console.log(`  Recipient wallet:  ${config.recipientWallet}`);
    console.log(
      `  Pricing:           ${config.freeTierLimit} free calls, then ` +
        `$${(config.priceAtomicUsdc / 1_000_000).toFixed(4)} USDC/call on ${config.x402Network}`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`\n[pkg-oracle] received ${signal}, shutting down gracefully...`);
    httpServer.close(() => process.exit(0));
    // Force-exit if close() hangs (e.g. a lingering keep-alive socket).
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[pkg-oracle] fatal startup error:", err);
  process.exit(1);
});
