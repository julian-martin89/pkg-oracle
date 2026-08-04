import axios from "axios";
import { config } from "../config.js";
import type { Ecosystem, ScorecardResult } from "../types.js";

const http = axios.create({ timeout: config.upstreamTimeoutMs });

const DEPS_DEV_SYSTEM: Record<Ecosystem, string> = {
  npm: "npm",
  pypi: "pypi",
};

interface DepsDevRelatedProject {
  projectKey: { id: string };
  relationType?: string;
}

interface DepsDevVersionResponse {
  relatedProjects?: DepsDevRelatedProject[];
}

interface DepsDevProjectResponse {
  scorecard?: {
    overallScore?: number;
  };
}

const emptyResult: ScorecardResult = {
  queried: false,
  found: false,
  overallScore: null,
  sourceRepo: null,
};

/**
 * Resolves the OpenSSF Scorecard for a package by first finding its source
 * repository via deps.dev's per-version `relatedProjects`, then fetching
 * that project's scorecard. Two network round-trips, but deps.dev does not
 * expose a "give me the scorecard for this bare package name" shortcut.
 *
 * Not every package has a resolvable source repo or a computed scorecard
 * (private repos, no CI, brand-new packages) — that's a WARN-worthy signal
 * on its own, surfaced via `found: false`, not a hard failure.
 */
export async function queryScorecard(
  ecosystem: Ecosystem,
  name: string,
  version: string | null,
): Promise<ScorecardResult> {
  try {
    const system = DEPS_DEV_SYSTEM[ecosystem];
    const versionPath = version
      ? `/versions/${encodeURIComponent(version)}`
      : "";

    let sourceRepoId: string | null = null;

    if (version) {
      const { data } = await http.get<DepsDevVersionResponse>(
        `https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(name)}${versionPath}`,
      );
      sourceRepoId =
        data.relatedProjects?.find((p) => p.relationType === "SOURCE_REPO")
          ?.projectKey.id ??
        data.relatedProjects?.[0]?.projectKey.id ??
        null;
    } else {
      // Without a version we can't hit the per-version endpoint directly;
      // deps.dev's package index lists versions but each with its own
      // relatedProjects, so fall back to the latest default version.
      const { data } = await http.get<{
        versions?: Array<{ versionKey: { version: string }; isDefault?: boolean }>;
      }>(`https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(name)}`);
      const defaultVersion =
        data.versions?.find((v) => v.isDefault)?.versionKey.version ??
        data.versions?.[data.versions.length - 1]?.versionKey.version;
      if (defaultVersion) {
        const { data: verData } = await http.get<DepsDevVersionResponse>(
          `https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(defaultVersion)}`,
        );
        sourceRepoId =
          verData.relatedProjects?.find((p) => p.relationType === "SOURCE_REPO")
            ?.projectKey.id ??
          verData.relatedProjects?.[0]?.projectKey.id ??
          null;
      }
    }

    if (!sourceRepoId) {
      return { ...emptyResult, queried: true };
    }

    const { data: project } = await http.get<DepsDevProjectResponse>(
      `https://api.deps.dev/v3/projects/${encodeURIComponent(sourceRepoId)}`,
    );

    const overallScore = project.scorecard?.overallScore ?? null;

    return {
      queried: true,
      found: overallScore !== null,
      overallScore,
      sourceRepo: sourceRepoId,
    };
  } catch {
    // deps.dev being unreachable, or the project genuinely having no
    // scorecard (404), both degrade to "we don't know" rather than failing
    // the whole verify_package call.
    return { ...emptyResult, queried: false };
  }
}
