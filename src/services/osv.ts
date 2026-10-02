import axios from "axios";
import { config } from "../config.js";
import type { Ecosystem, OsvResult, SeverityLevel, VulnerabilitySummary } from "../types.js";

const http = axios.create({ timeout: config.upstreamTimeoutMs });

/** OSV.dev ecosystem identifiers — distinct from our internal `Ecosystem` type. */
const OSV_ECOSYSTEM: Record<Ecosystem, string> = {
  npm: "npm",
  pypi: "PyPI",
  "crates.io": "crates.io",
};

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MODERATE: 2,
  LOW: 1,
  UNKNOWN: 0,
};

function normalizeSeverity(raw: string | undefined): SeverityLevel {
  if (!raw) return "UNKNOWN";
  const upper = raw.toUpperCase();
  if (upper === "CRITICAL") return "CRITICAL";
  if (upper === "HIGH") return "HIGH";
  if (upper === "MODERATE" || upper === "MEDIUM") return "MODERATE";
  if (upper === "LOW") return "LOW";
  return "UNKNOWN";
}

/**
 * Best-effort CVSSv3 base-score bucket extraction from a raw vector string
 * (e.g. "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L"). OSV does not always
 * supply a numeric score alongside the vector, and the GHSA-sourced entries
 * usually carry `database_specific.severity` directly (handled by the
 * caller before falling back to this). This heuristic looks only at the
 * Attack Vector / Privileges Required / Impact triad to bucket severity
 * when nothing more authoritative is available — it is deliberately
 * conservative (skews toward MODERATE/HIGH rather than LOW) because the
 * cost of a missed BLOCK is much higher than the cost of an extra WARN.
 */
function estimateSeverityFromCvssVector(vector: string): SeverityLevel {
  const hasHighImpact = /\/C:H|\/I:H|\/A:H/.test(vector);
  const noPrivilegesNeeded = /\/PR:N/.test(vector);
  const networkAttack = /\/AV:N/.test(vector);

  if (hasHighImpact && noPrivilegesNeeded && networkAttack) return "CRITICAL";
  if (hasHighImpact) return "HIGH";
  if (noPrivilegesNeeded && networkAttack) return "MODERATE";
  return "MODERATE"; // conservative default — see doc comment above
}

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  severity?: Array<{ type: string; score: string }>;
}

interface OsvQueryResponse {
  vulns?: OsvVuln[];
}

function severityOf(vuln: OsvVuln): SeverityLevel {
  const explicit = normalizeSeverity(vuln.database_specific?.severity);
  if (explicit !== "UNKNOWN") return explicit;

  const cvss = vuln.severity?.find((s) => s.type.startsWith("CVSS"));
  if (cvss?.score) return estimateSeverityFromCvssVector(cvss.score);

  return "UNKNOWN";
}

export async function queryOsv(
  ecosystem: Ecosystem,
  name: string,
  version: string | null,
): Promise<OsvResult> {
  try {
    const body: Record<string, unknown> = {
      package: { name, ecosystem: OSV_ECOSYSTEM[ecosystem] },
    };
    if (version) body.version = version;

    const { data } = await http.post<OsvQueryResponse>(
      "https://api.osv.dev/v1/query",
      body,
      { headers: { "Content-Type": "application/json" } },
    );

    const vulns = data.vulns ?? [];
    const summaries: VulnerabilitySummary[] = vulns.map((v) => ({
      id: v.id,
      summary: v.summary ?? v.details?.slice(0, 200) ?? "No summary provided.",
      severity: severityOf(v),
      aliases: v.aliases ?? [],
    }));

    const highestSeverity = summaries.reduce<SeverityLevel>((acc, v) => {
      return SEVERITY_RANK[v.severity] > SEVERITY_RANK[acc] ? v.severity : acc;
    }, "UNKNOWN");

    return { queried: true, vulnerabilities: summaries, highestSeverity };
  } catch (err) {
    // A failed OSV lookup should degrade the verdict confidence, not crash
    // the whole tool call — the registry + typosquat signals still stand.
    return { queried: false, vulnerabilities: [], highestSeverity: "UNKNOWN" };
  }
}

export { SEVERITY_RANK };
