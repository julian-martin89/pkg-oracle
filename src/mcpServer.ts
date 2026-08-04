import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { verifyPackage } from "./services/oracle.js";
import type { Ecosystem } from "./types.js";

/**
 * Builds a fresh `McpServer` instance with `verify_package` registered.
 *
 * This is a factory, not a singleton, because the Streamable HTTP transport
 * in stateless mode (`sessionIdGenerator: undefined`) can only be attached
 * to a single request — reusing one transport/server pair across requests
 * throws "Stateless transport cannot be reused across requests" from the
 * SDK. Registration is cheap (one tool, no I/O), so paying that cost once
 * per HTTP request is the correct tradeoff for a stateless, horizontally
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
        "package you have not already verified in this session.",
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
    async ({ ecosystem, name, version }) => {
      try {
        const result = await verifyPackage(ecosystem as Ecosystem, name, version ?? null);

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
    },
  );

  return server;
}
