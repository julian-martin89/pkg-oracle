import axios, { AxiosError } from "axios";
import { config } from "../config.js";
import type { Ecosystem, RegistryInfo } from "../types.js";

const http = axios.create({ timeout: config.upstreamTimeoutMs });

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (1000 * 60 * 60 * 24);
}

function notFoundResult(): RegistryInfo {
  return {
    exists: false,
    firstPublishedAt: null,
    lastPublishedAt: null,
    ageDays: null,
    requestedVersionExists: null,
    latestVersion: null,
    maintainerCount: null,
    license: null,
  };
}

interface NpmRegistryDoc {
  "dist-tags"?: { latest?: string };
  versions?: Record<string, unknown>;
  time?: Record<string, string> & { created?: string; modified?: string };
  license?: string | { type?: string };
  maintainers?: unknown[];
}

/**
 * Fetches the *full* npm registry document (not the abbreviated
 * `install-v1+json` form) because only the full doc carries `time.created` —
 * the single most important signal for the typosquat/age check.
 */
async function fetchNpm(name: string, version: string | null): Promise<RegistryInfo> {
  try {
    const { data } = await http.get<NpmRegistryDoc>(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    );

    const created = data.time?.created ?? null;
    const modified = data.time?.modified ?? null;
    const now = new Date().toISOString();
    const licenseRaw = data.license;
    const license =
      typeof licenseRaw === "string" ? licenseRaw : licenseRaw?.type ?? null;

    return {
      exists: true,
      firstPublishedAt: created,
      lastPublishedAt: modified,
      ageDays: created ? daysBetween(created, now) : null,
      requestedVersionExists: version
        ? Boolean(data.versions && Object.prototype.hasOwnProperty.call(data.versions, version))
        : null,
      latestVersion: data["dist-tags"]?.latest ?? null,
      maintainerCount: Array.isArray(data.maintainers) ? data.maintainers.length : null,
      license,
    };
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return notFoundResult();
    }
    throw new Error(`npm registry lookup failed for "${name}": ${(err as Error).message}`);
  }
}

interface PypiRelease {
  upload_time_iso_8601?: string;
  yanked?: boolean;
}

interface PypiDoc {
  info?: {
    version?: string;
    license?: string | null;
    author?: string | null;
  };
  releases?: Record<string, PypiRelease[]>;
}

async function fetchPypi(name: string, version: string | null): Promise<RegistryInfo> {
  try {
    const { data } = await http.get<PypiDoc>(
      `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
    );

    const releases = data.releases ?? {};
    const allUploadTimes: string[] = Object.values(releases)
      .flat()
      .map((r) => r.upload_time_iso_8601)
      .filter((t): t is string => Boolean(t))
      .sort();

    const firstPublishedAt = allUploadTimes[0] ?? null;
    const lastPublishedAt = allUploadTimes[allUploadTimes.length - 1] ?? null;
    const now = new Date().toISOString();

    return {
      exists: true,
      firstPublishedAt,
      lastPublishedAt,
      ageDays: firstPublishedAt ? daysBetween(firstPublishedAt, now) : null,
      requestedVersionExists: version
        ? Object.prototype.hasOwnProperty.call(releases, version)
        : null,
      latestVersion: data.info?.version ?? null,
      // PyPI's JSON API does not reliably expose a maintainer roster.
      maintainerCount: null,
      license: data.info?.license ?? null,
    };
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return notFoundResult();
    }
    throw new Error(`PyPI registry lookup failed for "${name}": ${(err as Error).message}`);
  }
}

interface CratesIoVersion {
  num: string;
  created_at?: string;
  license?: string | null;
}

interface CratesIoDoc {
  crate?: {
    created_at?: string;
    updated_at?: string;
    max_stable_version?: string;
    max_version?: string;
  };
  versions?: CratesIoVersion[];
}

/**
 * crates.io requires a descriptive, non-browser User-Agent on every request
 * (undocumented-but-enforced policy — a generic/missing one gets rate-limited
 * or blocked) and has no abbreviated-metadata endpoint, so this fetches the
 * full crate document in one call.
 */
async function fetchCratesIo(name: string, version: string | null): Promise<RegistryInfo> {
  try {
    const { data } = await http.get<CratesIoDoc>(
      `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
      { headers: { "User-Agent": "pkg-oracle (https://github.com/julian-martin89/pkg-oracle)" } },
    );

    const created = data.crate?.created_at ?? null;
    const now = new Date().toISOString();
    const versions = data.versions ?? [];
    const matchedVersion = version ? versions.find((v) => v.num === version) : undefined;

    return {
      exists: true,
      firstPublishedAt: created,
      lastPublishedAt: data.crate?.updated_at ?? null,
      ageDays: created ? daysBetween(created, now) : null,
      requestedVersionExists: version ? Boolean(matchedVersion) : null,
      latestVersion: data.crate?.max_stable_version ?? data.crate?.max_version ?? null,
      // crates.io exposes owners via a separate /owners endpoint, not the
      // crate document itself — not worth a second round-trip for this one
      // enrichment field (PyPI, below, makes the same trade-off).
      maintainerCount: null,
      license: matchedVersion?.license ?? versions[0]?.license ?? null,
    };
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 404) {
      return notFoundResult();
    }
    throw new Error(`crates.io registry lookup failed for "${name}": ${(err as Error).message}`);
  }
}

export async function fetchRegistryInfo(
  ecosystem: Ecosystem,
  name: string,
  version: string | null,
): Promise<RegistryInfo> {
  if (ecosystem === "npm") return fetchNpm(name, version);
  if (ecosystem === "crates.io") return fetchCratesIo(name, version);
  return fetchPypi(name, version);
}
