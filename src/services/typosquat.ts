import levenshtein from "fast-levenshtein";
import { config } from "../config.js";
import { getPopularList, isKnownPopular } from "./popularPackages.js";
import type { Ecosystem, TyposquatResult } from "../types.js";

/**
 * Compares `name` against the curated popular-package shortlist and flags
 * near-miss spellings. A distance of 0 means the name IS a popular
 * package (not a typosquat candidate at all — handled by the caller).
 *
 * `ageDays` is `null` when the package doesn't exist on the registry at
 * all (the strongest possible signal — an alucinated or freshly-squatted
 * name) and is treated as "as suspicious as day zero" for the red-flag
 * check below.
 */
export function checkTyposquat(
  ecosystem: Ecosystem,
  name: string,
  ageDays: number | null,
): TyposquatResult {
  const lowerName = name.toLowerCase();

  if (isKnownPopular(ecosystem, lowerName)) {
    return { suspected: false, nearestPopularPackage: null, distance: null, redFlag: false };
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestMatch: string | null = null;

  for (const popular of getPopularList(ecosystem)) {
    // Cheap length-based prune before paying for the DP table.
    if (Math.abs(popular.length - lowerName.length) > config.typosquatMaxDistance) continue;

    const distance = levenshtein.get(lowerName, popular.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = popular;
    }
    if (bestDistance === 1) break; // can't do better than 1 without being an exact match
  }

  const suspected = bestMatch !== null && bestDistance <= config.typosquatMaxDistance;
  const isNew = ageDays === null || ageDays < config.newPackageThresholdDays;
  const redFlag = suspected && isNew;

  return {
    suspected,
    nearestPopularPackage: suspected ? bestMatch : null,
    distance: suspected ? bestDistance : null,
    redFlag,
  };
}
