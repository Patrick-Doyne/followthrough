import type { ShotType } from "@/types/telemetry";

/**
 * The pipeline's own shot classification, by distance from the rim in
 * feet.
 *
 * <p>These are the cuts `get_shot_designation` makes in
 * `cpp/follow-through-batch.cpp`, copied rather than invented so a shot
 * classified here -- one whose event carried a distance but no
 * designation -- lands in the same class the pipeline would have given
 * it: LAY_UP under 5 ft, CLS_RNG to 10, MID_RNG to 19.9, HS_3PT to 22,
 * NCAA_3PT to 23, NBA_3PT beyond.
 */
export function classifyShotType(distanceFt: number): ShotType {
  if (distanceFt < 5) return "LAY_UP";
  if (distanceFt < 10) return "CLS_RNG";
  if (distanceFt < 19.9) return "MID_RNG";
  if (distanceFt < 22) return "HS_3PT";
  if (distanceFt < 23) return "NCAA_3PT";
  return "NBA_3PT";
}
