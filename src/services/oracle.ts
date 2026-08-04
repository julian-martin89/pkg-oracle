import { config } from "../config.js";
import { fetchRegistryInfo } from "./registry.js";
import { queryOsv } from "./osv.js";
import { queryScorecard } from "./depsdev.js";
import { checkTyposquat } from "./typosquat.js";
import type { Ecosystem, OracleFinding, OracleResult, Verdict } from "../types.js";

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1, UNKNOWN: 0 } as const;

/**
 * The Dependency Trust Oracle: runs every check in parallel and folds the
 * results into a single synthetic verdict an agent can act on without
 * having to reason about five different data sources itself.
 *
 * Verdict precedence (first match wins):
 *   1. BLOCK — package doesn't exist on the registry at all (probable
 *      hallucination / slopsquat target waiting to be registered).
 *   2. BLOCK — name is a near-miss of a popular package AND is brand new
 *      (the canonical typosquat pattern: register the day the LLM starts
 *      hallucinating it).
 *   3. BLOCK — a known CRITICAL or HIGH severity vulnerability applies to
 *      the requested version (or the package as a whole, if no version
 *      was given).
 *   4. WARN  — a MODERATE/LOW/UNKNOWN-severity vulnerability exists, OR
 *      the package is brand new without a typosquat match, OR the name is
 *      a near-miss of a popular package but old enough to plausibly be
 *      unrelated, OR the OpenSSF Scorecard is unusually low.
 *   5. ALLOW — nothing above fired.
 */
export async function verifyPackage(
  ecosystem: Ecosystem,
  name: string,
  version: string | null,
): Promise<OracleResult> {
  const registry = await fetchRegistryInfo(ecosystem, name, version);

  // OSV.dev has no notion of "current" — querying it without a version
  // returns every vulnerability ever disclosed for the package across its
  // entire history, patched or not. An agent that didn't pin a version
  // (the common case: it's about to write "lodash": "^4.17.21", not yet
  // committed to an exact version) means "check what I'd actually get
  // right now" — i.e. the latest published version — not "has this name
  // ever had a CVE." Resolving to `latestVersion` here is what keeps a
  // long-lived, well-maintained package like lodash from permanently
  // reading as CRITICAL for CVEs patched years ago.
  const effectiveVersion = version ?? registry.latestVersion;

  const [osv, scorecard] = await Promise.all([
    queryOsv(ecosystem, name, effectiveVersion),
    queryScorecard(ecosystem, name, effectiveVersion),
  ]);

  const typosquat = checkTyposquat(ecosystem, name, registry.ageDays);

  const findings: OracleFinding[] = [];
  let verdict: Verdict = "ALLOW";

  const escalate = (next: Verdict) => {
    const order: Record<Verdict, number> = { ALLOW: 0, WARN: 1, BLOCK: 2 };
    if (order[next] > order[verdict]) verdict = next;
  };

  if (!registry.exists) {
    escalate("BLOCK");
    findings.push({
      code: "PACKAGE_NOT_FOUND",
      message: `"${name}" does not exist on the ${ecosystem} registry. This is the single strongest ` +
        `signal of an LLM-hallucinated package name — do not install it. If you believe this is a ` +
        `mistake, double-check the spelling and the ecosystem.`,
    });
  }

  if (version && registry.exists && registry.requestedVersionExists === false) {
    escalate("BLOCK");
    findings.push({
      code: "VERSION_NOT_FOUND",
      message: `Package "${name}" exists, but version "${version}" does not. Verify the version string ` +
        `before pinning it in a manifest.`,
    });
  }

  if (typosquat.redFlag) {
    escalate("BLOCK");
    findings.push({
      code: "TYPOSQUAT_SUSPECTED",
      message: `"${name}" is a Levenshtein distance of ${typosquat.distance} from the popular package ` +
        `"${typosquat.nearestPopularPackage}" and was ${
          registry.ageDays === null ? "never published" : `published only ${Math.round(registry.ageDays)} day(s) ago`
        }. This is the exact pattern of a typosquat/slopsquat attack: a name close enough to fool an ` +
        `autocomplete or a hallucinating LLM, registered recently enough that it can't yet have earned trust.`,
    });
  } else if (typosquat.suspected) {
    escalate("WARN");
    findings.push({
      code: "TYPOSQUAT_NAME_SIMILARITY",
      message: `"${name}" is close (distance ${typosquat.distance}) to the popular package ` +
        `"${typosquat.nearestPopularPackage}". The package is old enough that this is plausibly ` +
        `coincidental, but confirm this is really the package you meant to depend on.`,
    });
  }

  if (version === null && effectiveVersion !== null) {
    findings.push({
      code: "CHECKED_LATEST_VERSION",
      message: `No version was specified, so vulnerability and scorecard checks were run against the ` +
        `latest published version (${effectiveVersion}) rather than the package's entire history.`,
    });
  }

  if (osv.queried) {
    if (SEVERITY_RANK[osv.highestSeverity] >= SEVERITY_RANK.HIGH) {
      escalate("BLOCK");
      findings.push({
        code: "CRITICAL_VULNERABILITY",
        message: `${osv.vulnerabilities.length} known vulnerabilities found via OSV.dev, highest severity ` +
          `${osv.highestSeverity}: ${osv.vulnerabilities
            .filter((v) => SEVERITY_RANK[v.severity] >= SEVERITY_RANK.HIGH)
            .map((v) => v.id)
            .join(", ")}.`,
      });
    } else if (osv.vulnerabilities.length > 0) {
      escalate("WARN");
      findings.push({
        code: "KNOWN_VULNERABILITY",
        message: `${osv.vulnerabilities.length} known vulnerabilit${osv.vulnerabilities.length === 1 ? "y" : "ies"} ` +
          `found via OSV.dev (highest severity ${osv.highestSeverity}): ` +
          `${osv.vulnerabilities.map((v) => v.id).join(", ")}.`,
      });
    }
  } else {
    findings.push({
      code: "OSV_UNAVAILABLE",
      message: "Could not reach OSV.dev to check for known vulnerabilities — verdict is based on the remaining signals only.",
    });
  }

  if (
    registry.exists &&
    !typosquat.redFlag &&
    registry.ageDays !== null &&
    registry.ageDays < config.newPackageThresholdDays
  ) {
    escalate("WARN");
    findings.push({
      code: "NEW_PACKAGE",
      message: `Published only ${Math.round(registry.ageDays)} day(s) ago. New packages haven't had time ` +
        `to accumulate community scrutiny — treat with extra caution regardless of name similarity.`,
    });
  }

  if (scorecard.queried && scorecard.found && scorecard.overallScore !== null && scorecard.overallScore < 3) {
    escalate("WARN");
    findings.push({
      code: "LOW_SCORECARD",
      message: `OpenSSF Scorecard overall score is ${scorecard.overallScore.toFixed(1)}/10 for ` +
        `${scorecard.sourceRepo}, indicating weak supply-chain hygiene (branch protection, code review, ` +
        `pinned dependencies, etc.) upstream.`,
    });
  }

  if (verdict === "ALLOW" && findings.length === 0) {
    findings.push({
      code: "NO_ISSUES_FOUND",
      message: `No red flags found. Registry age: ${
        registry.ageDays !== null ? `${Math.round(registry.ageDays)} day(s)` : "unknown"
      }. No known vulnerabilities. No typosquat signal.`,
    });
  }

  return {
    ecosystem,
    name,
    version,
    verdict,
    findings,
    registry,
    osv,
    scorecard,
    typosquat,
    checkedAt: new Date().toISOString(),
  };
}
