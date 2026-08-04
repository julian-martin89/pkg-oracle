/** Ecosystems the oracle currently understands. */
export type Ecosystem = "npm" | "pypi";

/** Final synthetic verdict handed back to the calling agent. */
export type Verdict = "ALLOW" | "WARN" | "BLOCK";

/** Normalized severity ranking used to compare vulnerabilities across sources. */
export type SeverityLevel = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export interface RegistryInfo {
  /** Whether the registry has any record of this package name at all. */
  exists: boolean;
  /** ISO-8601 timestamp of the package's very first publish (the whole name, not the version). */
  firstPublishedAt: string | null;
  /** ISO-8601 timestamp of the most recent publish. */
  lastPublishedAt: string | null;
  /** Age in days since first publish (fractional). Null if `exists` is false. */
  ageDays: number | null;
  /** The specific version requested, if it exists on the registry. Null if unspecified or not found. */
  requestedVersionExists: boolean | null;
  /** Latest version string reported by the registry. */
  latestVersion: string | null;
  /** Number of distinct maintainer accounts (npm) or absent for PyPI (not reliably exposed). */
  maintainerCount: number | null;
  /** License identifier(s) as reported by the registry, if any. */
  license: string | null;
}

export interface VulnerabilitySummary {
  id: string;
  summary: string;
  severity: SeverityLevel;
  aliases: string[];
}

export interface OsvResult {
  queried: boolean;
  vulnerabilities: VulnerabilitySummary[];
  highestSeverity: SeverityLevel;
}

export interface ScorecardResult {
  queried: boolean;
  found: boolean;
  overallScore: number | null;
  sourceRepo: string | null;
}

export interface TyposquatResult {
  suspected: boolean;
  nearestPopularPackage: string | null;
  distance: number | null;
  /** True only when the distance signal AND the package-age signal both fire. */
  redFlag: boolean;
}

export interface OracleFinding {
  code: string;
  message: string;
}

export interface OracleResult {
  ecosystem: Ecosystem;
  name: string;
  version: string | null;
  verdict: Verdict;
  findings: OracleFinding[];
  registry: RegistryInfo;
  osv: OsvResult;
  scorecard: ScorecardResult;
  typosquat: TyposquatResult;
  checkedAt: string;
}
