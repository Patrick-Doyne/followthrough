import { SHOT_ZONE_GROUPS, zoneGroupOf, type ShotZoneGroup } from "@/services/court-geometry";
import type { Shot, ShotType } from "@/types/telemetry";

/**
 * The derivations behind the analysis charts.
 *
 * <p>Separated from the components because each one is a claim about
 * the player -- "your arc is inconsistent", "most of your attempts come
 * from where you are least effective" -- and a claim shown to someone
 * about their own shooting has to be arithmetic they can check, not
 * something buried in a render function.
 *
 * <p>Three principles run through all of it.
 *
 * <p>**Distance is context, not a verdict.** Everyone shoots worse from
 * further out, so a metric that only rediscovers that teaches nothing.
 * The mechanical metrics here are all measured against what this player
 * normally does at that distance.
 *
 * <p>**A band with too few shots in it states nothing.** Every function
 * reports the sample size beside the rate and returns null rather than a
 * percentage when the sample is too small to mean anything.
 *
 * <p>**Thresholds are found in the player's own data, not asserted.**
 * The app does not know what a good arc is; it knows what has gone in
 * for this player. Nothing here hard-codes a coaching rule of thumb.
 */

/**
 * The floor for **plotting** a rate.
 *
 * <p>One, so a chart draws whatever it has. This started at eight, which
 * was right for a demo dataset of hundreds of shots per session and wrong
 * for a player who has processed one clip: every chart on the page met them
 * with "needs 8 to score" and told them nothing at all. A thin bar next to a
 * thick one already says which is thin, and every readout here carries the
 * attempt count beside the percentage, so the reader can discount a spike
 * without the chart refusing to draw it.
 */
export const MIN_SAMPLE = 1;

/**
 * The floor for **saying something in words**, which is a higher bar.
 *
 * <p>Plotting 100% above a bar of one is fine -- the bar is visibly one shot
 * tall. Writing "the paint is your best range" off that same shot is not,
 * because a sentence carries no sample size in it. The significance test
 * below does most of this work on its own, since the error on a tiny sample
 * is enormous, but it cannot stop the extreme cases: four from four really
 * does clear two sigma against a 53% baseline. This stops those.
 */
export const MIN_CLAIM_SAMPLE = 5;

/**
 * The floor for fitting a release line, which is a mathematical limit
 * rather than a judgement call.
 *
 * <p>Two points define a line exactly, so the scatter around it is zero by
 * construction and the chart would claim a perfectly repeatable release off
 * two shots. Three is the first sample that leaves anything to measure.
 */
export const MIN_FIT_SAMPLE = 3;

export interface Rate {
  attempts: number;
  makes: number;
  /** 0-100, or null when there are too few attempts to mean anything. */
  percentage: number | null;
}

export function rateOf(shots: Shot[], minSample = MIN_SAMPLE): Rate {
  const attempts = shots.length;
  const makes = shots.filter((shot) => shot.result === "MAKE").length;
  return {
    attempts,
    makes,
    percentage: attempts < minSample ? null : (makes / attempts) * 100,
  };
}

/**
 * Standard error of a rate, in percentage points.
 *
 * <p>Adjusted the Agresti-Coull way -- one imagined make and one imagined
 * miss added before the arithmetic. Without it a band where every shot
 * went in reports an error of exactly zero, which would make eight-for-
 * eight look like a certainty rather than a small sample.
 */
export function rateStandardError(rate: Rate): number {
  const p = (rate.makes + 1) / (rate.attempts + 2);
  return Math.sqrt((p * (1 - p)) / (rate.attempts + 2)) * 100;
}

/**
 * Whether a rate is far enough from a reference to be worth saying out loud.
 *
 * <p>The reason this exists: 7 makes from 9 attempts is 78%, and against a
 * 63% average that looks like a 15-point strength. It is not -- the standard
 * error on nine attempts is about 13 points, so that gap is nearly all
 * sampling noise. Telling a player their best range is one they took nine
 * shots from is exactly the invented, unstructured information the analysis
 * charts were rebuilt to get rid of.
 *
 * <p>Two sigmas, measured across the sample sessions: at that bar a distance
 * finding survives in roughly a third of single sessions and a floor finding
 * in over half, while the all-sessions view clears it four to five times
 * over. Looser and single sessions start making claims they cannot support.
 */
export function beatsNoise(rate: Rate, reference: number, sigmas = 2): boolean {
  if (rate.percentage === null || rate.attempts < MIN_CLAIM_SAMPLE) return false;
  return Math.abs(rate.percentage - reference) >= sigmas * rateStandardError(rate);
}

/** The same test between two measured rates rather than against a constant. */
export function ratesDiffer(a: Rate, b: Rate, sigmas = 2): boolean {
  if (a.percentage === null || b.percentage === null) return false;
  if (a.attempts < MIN_CLAIM_SAMPLE || b.attempts < MIN_CLAIM_SAMPLE) return false;
  const combined = Math.hypot(rateStandardError(a), rateStandardError(b));
  return Math.abs(a.percentage - b.percentage) >= sigmas * combined;
}

/* ================================================================== *
 * Where the shots came from
 * ================================================================== */

export interface DistanceBand extends Rate {
  label: string;
  /** The pipeline's own name for shots in this band. */
  kind: string;
  from: number;
  /** Infinity on the last band. */
  to: number;
}

/**
 * The bands accuracy is reported over.
 *
 * <p>These are **the pipeline's own shot-type boundaries**, not equal-width
 * bins: `classify_shot_type` in follow-through-batch.cpp cuts at 5, 10, 19.9,
 * 22 and 23 feet, and a band that straddled one of those cuts would put two
 * different shot types in one bar. The two midrange bands split a 10ft class
 * that is otherwise too wide to act on, and the two three-point classes that
 * are only a foot deep (NCAA, 22-23ft) are merged with the HS line rather
 * than shown as a sliver that can never reach a reportable sample.
 */
const DISTANCE_EDGES: { label: string; kind: string; from: number; to: number }[] = [
  { label: "0–5", kind: "Layup", from: 0, to: 5 },
  { label: "5–10", kind: "Close range", from: 5, to: 10 },
  { label: "10–15", kind: "Midrange", from: 10, to: 15 },
  { label: "15–20", kind: "Long midrange", from: 15, to: 19.9 },
  { label: "20–23", kind: "Three (HS/NCAA)", from: 19.9, to: 23 },
  { label: "23+", kind: "Three (NBA)", from: 23, to: Infinity },
];

export function distanceBands(shots: Shot[]): DistanceBand[] {
  return DISTANCE_EDGES.map((edge) => {
    const inBand = shots.filter(
      (shot) => shot.shotDistance >= edge.from && shot.shotDistance < edge.to,
    );
    return { ...edge, ...rateOf(inBand) };
  });
}

export interface DesignationRate extends Rate {
  shotType: ShotType;
  label: string;
  /** The distance range the pipeline assigns this class, for labelling. */
  range: string;
}

/**
 * The pipeline's own six shot classes, in order.
 *
 * <p>These edges are `get_shot_designation` in follow-through-batch.cpp,
 * copied rather than invented so a bar here can never disagree with the
 * label on the same shot in the shot log or the detail panel.
 */
const DESIGNATIONS: { shotType: ShotType; label: string; range: string }[] = [
  { shotType: "LAY_UP", label: "Layup", range: "under 5 ft" },
  { shotType: "CLS_RNG", label: "Close range", range: "5–10 ft" },
  { shotType: "MID_RNG", label: "Midrange", range: "10–19.9 ft" },
  { shotType: "HS_3PT", label: "HS three", range: "19.9–22 ft" },
  { shotType: "NCAA_3PT", label: "NCAA three", range: "22–23 ft" },
  { shotType: "NBA_3PT", label: "NBA three", range: "23 ft and out" },
];

/**
 * Accuracy by the pipeline's own shot classification.
 *
 * <p>This replaced a breakdown by part of the floor, which grouped shots by
 * `zoneGroupOf(location)`. That reading depended on the court position
 * being right, and the position is the least trustworthy thing the pipeline
 * reports -- it needs the homography to have calibrated and the shooter to
 * have been detected at release, and it is simply absent on many shots. A
 * chart that silently drops the shots it could not place, and quietly
 * mis-files the ones it placed badly, is worse than no chart.
 *
 * <p>The designation is derived from distance alone, so this does overlap
 * the distance profile. What it adds is that it is the *same label* the
 * shot log, the filters and the detail panel use, so the analysis and the
 * rest of the app speak one vocabulary.
 */
export function designationRates(shots: Shot[]): DesignationRate[] {
  return DESIGNATIONS.map((entry) => ({
    ...entry,
    ...rateOf(shots.filter((shot) => shot.shotType === entry.shotType)),
  }));
}

/*
 * `zoneRates`, which reported accuracy per part of the floor, was removed
 * with the chart and the finding that used it. It read `zoneGroupOf` off
 * each shot's court position, and that position is the pipeline's least
 * dependable output -- it needs the homography calibrated and the shooter
 * detected at release, and is absent on many shots. `designationRates`
 * above is the replacement: same shape, derived from distance, which the
 * pipeline measures far more reliably. `zoneGroupOf` itself stays, and is
 * still right for the shot map's zone filters, where the position is the
 * thing being displayed rather than the basis of a percentage.
 */

/* ================================================================== *
 * What the pipeline actually recorded
 * ================================================================== */

export interface FieldCoverage {
  shots: number;
  /** Shots carrying a usable value for each field the charts need. */
  distance: number;
  duration: number;
  apex: number;
  location: number;
}

/**
 * How many of these shots carry each field the charts need.
 *
 * <p>Exists because "no flight timings" is a true statement that answers
 * the wrong question. A chart that goes blank has to say which field it is
 * missing and how many shots are affected, or the reader cannot tell a bug
 * in the chart from a clip processed by an older build of the pipeline --
 * and the second is what it almost always is.
 *
 * <p>Zero is treated as absent, not as a measurement. The pipeline writes
 * null for a value it could not measure and the reader turns that into
 * zero; a shot cannot take zero seconds to reach the rim, so a zero here
 * always means "not recorded".
 */
export function fieldCoverage(shots: Shot[]): FieldCoverage {
  return {
    shots: shots.length,
    distance: shots.filter((shot) => shot.shotDistance > 0).length,
    duration: shots.filter((shot) => shot.shotDuration > 0).length,
    apex: shots.filter((shot) => shot.timeToApex > 0).length,
    location: shots.filter((shot) => Boolean(shot.location)).length,
  };
}

/* ================================================================== *
 * Mechanics
 * ================================================================== */

/**
 * How much of the flight was spent rising.
 *
 * <p>A higher ratio is a higher, slower arc; a lower one is flatter. It is
 * the one mechanical number that does not scale with distance, which is
 * what makes it comparable across a whole session.
 *
 * <p>Null when either timing is missing. Both are left at zero when the
 * pipeline could not measure them, and 0/0 is not an arc -- returning 0
 * there would put unmeasured shots in the flattest bucket and make the
 * player look like they shoot line drives.
 */
export function apexRatio(shot: Shot): number | null {
  if (!(shot.shotDuration > 0) || !(shot.timeToApex > 0)) return null;
  const ratio = shot.timeToApex / shot.shotDuration;
  return ratio > 0 && ratio < 1 ? ratio : null;
}

export interface Bucket extends Rate {
  from: number;
  to: number;
  mid: number;
  label: string;
}

/** Equal-width buckets of a derived value, with the rate in each. */
export function bucketBy(
  shots: Shot[],
  value: (shot: Shot) => number | null,
  from: number,
  to: number,
  step: number,
  label: (lo: number, hi: number) => string,
): Bucket[] {
  const buckets: Bucket[] = [];
  for (let edge = from; edge < to - 1e-9; edge += step) {
    const lo = edge;
    const hi = edge + step;
    const inBucket = shots.filter((shot) => {
      const v = value(shot);
      return v !== null && v >= lo && v < hi;
    });
    buckets.push({
      from: lo,
      to: hi,
      mid: lo + step / 2,
      label: label(lo, hi),
      ...rateOf(inBucket),
    });
  }
  return buckets;
}

export const APEX_BUCKET_STEP = 0.03;

/**
 * Arc buckets, spanning whatever the player actually produced.
 *
 * <p>The range used to be a fixed 0.45-0.75. Anything outside it was
 * counted by no bucket at all, so a flat-arc or very high-arc shot vanished
 * from the bars while the readout above them still said "Measured 54 of 54
 * shots" -- the chart quietly disagreeing with its own caption. Deriving
 * the ends from the data means every measured shot is on the chart.
 */
export function apexRatioBuckets(shots: Shot[]): Bucket[] {
  const ratios = shots.map(apexRatio).filter((ratio): ratio is number => ratio !== null);
  if (ratios.length === 0) return [];

  const step = APEX_BUCKET_STEP;
  const from = Math.max(0, Math.floor(Math.min(...ratios) / step) * step);
  // Nudged before rounding up so the largest ratio lands inside the last
  // bucket rather than on its exclusive upper edge.
  const to = Math.min(1, Math.ceil((Math.max(...ratios) + 1e-9) / step) * step);

  return bucketBy(
    shots,
    apexRatio,
    from,
    Math.max(to, from + step),
    step,
    (lo) => `${(lo * 100).toFixed(0)}%`,
  );
}

/**
 * The run of buckets the player actually shoots best from.
 *
 * <p>Found in their own data rather than asserted from a coaching rule of
 * thumb. "Within four points of the best" rather than "the best" keeps the
 * window from collapsing onto a single lucky bucket.
 */
export function bestRun(
  buckets: Bucket[],
  minAttempts = MIN_CLAIM_SAMPLE,
): { from: number; to: number; percentage: number } | null {
  // Shading a band and calling it "where you shoot best" is a claim, so it
  // holds to the claim floor even though the bars beside it draw from one
  // attempt. Otherwise a single made shot in an outlying bucket reads 100%
  // and drags the highlight onto itself.
  const scored = buckets.filter((b) => b.percentage !== null && b.attempts >= minAttempts);
  if (scored.length === 0) return null;
  const best = Math.max(...scored.map((b) => b.percentage as number));
  const near = scored.filter((b) => (b.percentage as number) >= best - 4);
  return {
    from: Math.min(...near.map((b) => b.from)),
    to: Math.max(...near.map((b) => b.to)),
    percentage: best,
  };
}

/** Attempts and rate inside versus outside a window of a derived value. */
export function splitAtWindow(
  shots: Shot[],
  value: (shot: Shot) => number | null,
  window: { from: number; to: number },
): { inside: Rate; outside: Rate } {
  const inside: Shot[] = [];
  const outside: Shot[] = [];
  for (const shot of shots) {
    const v = value(shot);
    if (v === null) continue;
    (v >= window.from && v < window.to ? inside : outside).push(shot);
  }
  return { inside: rateOf(inside), outside: rateOf(outside) };
}

export interface ReleaseFit {
  /** Seconds of flight added per foot of distance. */
  slope: number;
  /** Seconds of flight at zero feet. */
  intercept: number;
  /**
   * Spread of the shots around the line, in seconds. Lower is more
   * repeatable -- this is the consistency number.
   */
  residualSd: number;
  /** How much of the variation in flight time distance explains, 0-1. */
  r2: number;
  samples: number;
}

/**
 * The player's own flight-time-versus-distance line.
 *
 * <p>Longer shots take longer, so raw duration mostly restates distance.
 * Fitting the player's own line and measuring the scatter around it
 * separates "that shot was from far away" from "that release was rushed",
 * and the scatter is a repeatability score rather than a restatement of
 * where they chose to stand.
 */
export function releaseFit(shots: Shot[]): ReleaseFit | null {
  const usable = shots.filter((s) => s.shotDuration > 0 && s.shotDistance > 0);
  const n = usable.length;
  if (n < MIN_FIT_SAMPLE) return null;

  const meanX = usable.reduce((a, s) => a + s.shotDistance, 0) / n;
  const meanY = usable.reduce((a, s) => a + s.shotDuration, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const s of usable) {
    const dx = s.shotDistance - meanX;
    const dy = s.shotDuration - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  // Every shot from the same spot: there is no line to fit, so report a
  // flat one rather than dividing by zero.
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ss = 0;
  for (const s of usable) {
    ss += (s.shotDuration - (intercept + slope * s.shotDistance)) ** 2;
  }
  // n-2 because two parameters were fitted.
  const residualSd = Math.sqrt(ss / Math.max(1, n - 2));
  const r2 = syy === 0 ? 0 : 1 - ss / syy;

  return { slope, intercept, residualSd, r2, samples: n };
}

/**
 * How far a shot's flight time ran from what this player's line expects,
 * in seconds. Positive is slower than usual for that distance.
 */
export function releaseDeviation(shot: Shot, fit: ReleaseFit): number | null {
  if (!(shot.shotDuration > 0) || !(shot.shotDistance > 0)) return null;
  return shot.shotDuration - (fit.intercept + fit.slope * shot.shotDistance);
}

/**
 * Deviation buckets in units of the player's own scatter.
 *
 * <p>Fixed second-wide buckets would be meaningless across players: a
 * repeatable shooter's whole range might fit inside one of them. Measuring
 * in standard deviations makes the middle bucket "a normal release for you"
 * by construction.
 */
export function deviationBuckets(shots: Shot[], fit: ReleaseFit): Bucket[] {
  const sd = fit.residualSd;
  if (!(sd > 0)) return [];
  const edges = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
  const labels = ["Much faster", "Faster", "Normal", "Slower", "Much slower"];
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1] as number;
    // The outer buckets catch everything beyond them, so a wild outlier is
    // counted rather than silently dropped off the end of the chart.
    const lowEdge = i === 0 ? -Infinity : lo * sd;
    const highEdge = i === edges.length - 2 ? Infinity : hi * sd;
    const inBucket = shots.filter((shot) => {
      const d = releaseDeviation(shot, fit);
      return d !== null && d >= lowEdge && d < highEdge;
    });
    return {
      from: lo,
      to: hi,
      mid: (lo + hi) / 2,
      label: labels[i] as string,
      ...rateOf(inBucket),
    };
  });
}

/** Buckets with nothing in them at either end, dropped.
 *
 * <p>Interior empties are kept: a gap in the middle of a distribution is
 * information, while empty columns on the ends are just wasted axis. */
export function trimEmptyEnds(buckets: Bucket[]): Bucket[] {
  let start = 0;
  let end = buckets.length;
  while (start < end && buckets[start]!.attempts === 0) start += 1;
  while (end > start && buckets[end - 1]!.attempts === 0) end -= 1;
  return buckets.slice(start, end);
}

/* ================================================================== *
 * How the session unfolded
 * ================================================================== */

/**
 * How many distinct sessions these shots came from.
 *
 * <p>The derivations below this line are session-shaped: shot order only
 * means something inside one session. Run over a filter spanning several,
 * a trailing window straddles two different days and the "closing third"
 * is whatever session happened to sort last. Callers check this rather
 * than plotting a shape that is not there.
 */
export function sessionCount(shots: Shot[]): number {
  return new Set(shots.map((shot) => shot.sessionId)).size;
}

export interface RollingPoint {
  /** 1-based position across every shot passed in, which is what the axis
   * plots: shot numbers restart per session and would sawtooth. */
  index: number;
  sessionId: string;
  /** True on the first shot of a session after the first. */
  startsSession: boolean;
  shotNumber: number;
  result: Shot["result"];
  /** Rate over the trailing window, null until the window is full. */
  percentage: number | null;
  /** Rate over every shot so far. */
  cumulative: number;
}

/**
 * Rate over a trailing window of shots, alongside the cumulative rate.
 *
 * <p>The cumulative line answers "how did the session go" and flattens as
 * it grows -- by shot 60 a cold run of ten barely moves it. The trailing
 * window is what shows the warm-up, the hot stretch and the late fade,
 * which is the part a player can act on. Shown together, the gap between
 * them is the story.
 *
 * <p>Works across several sessions as well as one. The cumulative line
 * runs through the whole set, which is the trend over everything selected;
 * the trailing window restarts at each session boundary, so no single
 * point is ever an average of two different days.
 *
 * <p>`minWindow` is how many shots must be in hand before the trailing rate
 * is reported at all. It defaults to the full window, which is the strict
 * reading -- "the last ten" means ten. Passing 1 instead starts the line at
 * the first shot with a window that grows to size and then slides, so a
 * twelve-shot session still gets a line rather than two points at the end.
 */
export function rollingRate(shots: Shot[], window = 10, minWindow = window): RollingPoint[] {
  let makes = 0;
  // Where the current session's shots begin. The trailing window never
  // reaches back past it: a window spanning two sessions would average
  // the end of one day with the start of the next, which is not a
  // stretch the player ever shot.
  let sessionStart = 0;

  return shots.map((shot, i) => {
    const previous = i > 0 ? shots[i - 1] : undefined;
    const startsSession = previous !== undefined && previous.sessionId !== shot.sessionId;
    if (startsSession) sessionStart = i;

    if (shot.result === "MAKE") makes += 1;

    const start = Math.max(sessionStart, i - window + 1);
    const slice = shots.slice(start, i + 1);
    const windowMakes = slice.filter((s) => s.result === "MAKE").length;

    return {
      index: i + 1,
      sessionId: shot.sessionId,
      startsSession,
      shotNumber: shot.shotNumber,
      result: shot.result,
      percentage: slice.length < minWindow ? null : (windowMakes / slice.length) * 100,
      cumulative: (makes / (i + 1)) * 100,
    };
  });
}

export interface SessionThird extends Rate {
  label: string;
  /** Shot numbers this stretch covers, inclusive, for labelling. */
  fromShot: number;
  toShot: number;
}

/**
 * The session split into three equal stretches.
 *
 * <p>Deliberately by shot count rather than by clock: a player who took a
 * long break mid-session would otherwise get a third that is mostly rest.
 * Thirds rather than halves because a fade shows up in the last third while
 * a warm-up shows up in the first, and halves blur the two together.
 */
export function sessionThirds(shots: Shot[]): SessionThird[] {
  const labels = ["Opening", "Middle", "Closing"];

  /*
   * Pooled per session, not cut across the whole set. Over several
   * sessions a single three-way cut would compare early *sessions* with
   * late ones, which is the trend the shooting-over-time chart already
   * draws. Taking each session's own opening third and pooling them
   * answers the different question -- whether this player starts cold or
   * finishes tired, on a typical day -- and more sessions make that
   * answer stronger rather than changing what it means.
   */
  const bySession = new Map<string, Shot[]>();
  for (const shot of shots) {
    const list = bySession.get(shot.sessionId);
    if (list) list.push(shot);
    else bySession.set(shot.sessionId, [shot]);
  }

  const pooled: Shot[][] = [[], [], []];
  for (const sessionShots of bySession.values()) {
    const size = Math.floor(sessionShots.length / 3);
    // A session with fewer than three shots cannot be split into three
    // stretches, so it contributes to none of them rather than landing
    // entirely in the opening.
    if (size === 0) continue;
    pooled[0]!.push(...sessionShots.slice(0, size));
    pooled[1]!.push(...sessionShots.slice(size, size * 2));
    // The last stretch absorbs the remainder so no shot is left out.
    pooled[2]!.push(...sessionShots.slice(size * 2));
  }

  const single = bySession.size === 1;
  return labels.map((label, i) => {
    const slice = pooled[i] as Shot[];
    return {
      label,
      // Shot numbers only mean something within one session; across
      // several they are pooled from different days, so they are left at
      // zero and the caller labels the row differently.
      fromShot: single ? (slice[0]?.shotNumber ?? 0) : 0,
      toShot: single ? (slice[slice.length - 1]?.shotNumber ?? 0) : 0,
      ...rateOf(slice),
    };
  });
}

/** The longest unbroken run of one result. */
export function longestRun(shots: Shot[], result: Shot["result"]): number {
  let best = 0;
  let current = 0;
  for (const shot of shots) {
    current = shot.result === result ? current + 1 : 0;
    if (current > best) best = current;
  }
  return best;
}

export interface SessionTrendPoint {
  sessionId: string;
  /** The earliest shot in the session. */
  date: string;
  attempts: number;
  percentage: number | null;
  /** Scatter around that session's own release line, in seconds. */
  residualSd: number | null;
  /** Mean share of the flight spent rising, 0-1. */
  apexRatio: number | null;
}

/**
 * Per-session mechanics, for trending across sessions.
 *
 * <p>Both figures here were chosen because they are **independent of where
 * the player stood**. Measured across the sample sessions, mean flight time
 * correlates with mean distance at r = 0.98 and mean time to apex at
 * r = 0.93 -- so a session-level chart of either is a redraw of a distance
 * chart, which is what the dashboard used to show next to its distance
 * chart. The apex ratio and the release scatter come in at r = -0.19 and
 * r = -0.19 against distance, so they carry something distance does not.
 */
export function sessionTrend(shots: Shot[]): SessionTrendPoint[] {
  const grouped = new Map<string, Shot[]>();
  for (const shot of shots) {
    const list = grouped.get(shot.sessionId);
    if (list) list.push(shot);
    else grouped.set(shot.sessionId, [shot]);
  }
  return [...grouped]
    .map(([sessionId, sessionShots]) => {
      const ratios = sessionShots.map(apexRatio).filter((ratio): ratio is number => ratio !== null);
      const fit = releaseFit(sessionShots);
      return {
        sessionId,
        date: sessionShots.reduce(
          (earliest, shot) => (shot.timestamp < earliest ? shot.timestamp : earliest),
          sessionShots[0]!.timestamp,
        ),
        ...rateOf(sessionShots),
        residualSd: fit?.residualSd ?? null,
        apexRatio:
          ratios.length >= MIN_SAMPLE ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ================================================================== *
 * Shot quality against shot making
 * ================================================================== */

/** A make rate per distance band, learned from a reference set of shots. */
export type DistanceBaseline = Map<string, number>;

export function distanceBaseline(shots: Shot[]): DistanceBaseline {
  const baseline: DistanceBaseline = new Map();
  for (const band of distanceBands(shots)) {
    if (band.percentage !== null) baseline.set(band.label, band.percentage);
  }
  return baseline;
}

/**
 * What this set of shots would be expected to produce, given only where
 * they were taken from.
 *
 * <p>Each shot is scored at the player's own long-run rate for its distance
 * band and the scores averaged, so the result is a property of the *shot
 * selection* alone -- nothing about whether they actually went in.
 *
 * <p>Null when too few of the shots fall in bands the baseline knows about,
 * which is the case early on or after a filter has cut the set down.
 */
export function expectedRate(shots: Shot[], baseline: DistanceBaseline): number | null {
  const scored = distanceBands(shots)
    .map((band) => ({ attempts: band.attempts, rate: baseline.get(band.label) }))
    .filter((entry): entry is { attempts: number; rate: number } => entry.rate !== undefined);
  const covered = scored.reduce((sum, entry) => sum + entry.attempts, 0);
  if (covered < MIN_SAMPLE) return null;
  return scored.reduce((sum, entry) => sum + entry.rate * entry.attempts, 0) / covered;
}

export interface QualityPoint {
  sessionId: string;
  date: string;
  attempts: number;
  /** What the session's shot selection alone would normally return. */
  expected: number | null;
  actual: number | null;
  /** actual - expected, in percentage points. */
  gap: number | null;
}

/**
 * Shot quality against shot making, session by session.
 *
 * <p>The split a raw percentage cannot make. A 52% session is a good one if
 * the shots taken were hard and a poor one if they were layups, and the two
 * cases call for opposite responses -- keep taking those shots, or stop
 * settling. The expected line is the shot selection; the gap between the
 * lines is the shooting.
 *
 * <p>The baseline is the player's own long-run rate by distance over the set
 * passed in, so it says "against how you normally shoot", not against some
 * league average the app has no business asserting.
 */
export function qualityTrend(shots: Shot[]): QualityPoint[] {
  const baseline = distanceBaseline(shots);
  const grouped = new Map<string, Shot[]>();
  for (const shot of shots) {
    const list = grouped.get(shot.sessionId);
    if (list) list.push(shot);
    else grouped.set(shot.sessionId, [shot]);
  }
  return [...grouped]
    .map(([sessionId, sessionShots]) => {
      const expected = expectedRate(sessionShots, baseline);
      const actual = rateOf(sessionShots).percentage;
      return {
        sessionId,
        date: sessionShots.reduce(
          (earliest, shot) => (shot.timestamp < earliest ? shot.timestamp : earliest),
          sessionShots[0]!.timestamp,
        ),
        attempts: sessionShots.length,
        expected,
        actual,
        gap: expected === null || actual === null ? null : actual - expected,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ================================================================== *
 * The findings, in words
 * ================================================================== */

export type InsightKind = "strength" | "gap" | "note";

export interface Insight {
  kind: InsightKind;
  title: string;
  detail: string;
}

const pct = (value: number) => `${value.toFixed(0)}%`;

/**
 * The ranked findings shown above the charts.
 *
 * <p>Every one of these is generated from a measured gap that cleared a
 * sample floor, never from a template with numbers dropped into it. If
 * nothing in the data clears the floor the list is empty, which is the
 * honest answer for a short session -- padding it with "you took 12 shots"
 * would be the random information this is meant to replace.
 */
export function insights(shots: Shot[]): Insight[] {
  const found: Insight[] = [];
  const overall = rateOf(shots);
  if (overall.percentage === null) return found;

  // Volume against efficiency. The single most actionable finding: it says
  // where to move the reps, not just where the misses were.
  const bands = distanceBands(shots).filter((b) => b.percentage !== null);
  if (bands.length >= 2) {
    const busiest = bands.reduce((a, b) => (b.attempts > a.attempts ? b : a));
    const best = bands.reduce((a, b) =>
      (b.percentage as number) > (a.percentage as number) ? b : a,
    );
    // Requiring the busiest band to be literally the worst was too strict:
    // it missed the case that matters most, where the reps pile into a band
    // that is merely well below the best one. A quarter of the attempts is
    // the floor for calling it "most of them".
    const busiestShare = busiest.attempts / overall.attempts;
    const shortfall = (best.percentage as number) - (busiest.percentage as number);
    if (
      busiest.label !== best.label &&
      busiestShare >= 0.25 &&
      shortfall >= 10 &&
      ratesDiffer(busiest, best)
    ) {
      found.push({
        kind: "gap",
        // Not "most of your attempts": a quarter of them is enough to be the
        // busiest band and not enough to be most of anything.
        title: "Your busiest range is one of your weaker ones",
        detail: `${busiest.attempts} of ${overall.attempts} attempts were from ${busiest.label} ft, where you shot ${pct(busiest.percentage as number)} — ${shortfall.toFixed(0)} points below the ${pct(best.percentage as number)} you shoot from ${best.label} ft.`,
      });
    }
    if (
      (best.percentage as number) - overall.percentage >= 8 &&
      beatsNoise(best, overall.percentage)
    ) {
      found.push({
        kind: "strength",
        title: `${best.kind} is your best range`,
        detail: `${pct(best.percentage as number)} from ${best.label} ft on ${best.attempts} attempts, ${((best.percentage as number) - overall.percentage).toFixed(0)} points above your ${pct(overall.percentage)} overall.`,
      });
    }
  }

  /*
   * There was a finding here comparing the best part of the floor with the
   * worst. It has been removed along with the chart it referred to: it
   * rested on `zoneGroupOf(location)`, and the court position is the least
   * dependable thing the pipeline reports -- absent whenever the homography
   * had not calibrated or the shooter was not detected at release. A
   * sentence asserting a 30-point left-right split, built on positions that
   * may simply be wrong, is exactly the invented information these findings
   * exist to replace. Distance is measured far more reliably, and the
   * distance findings above already carry the useful part.
   */

  // Arc. Reported only when the player's own best window actually
  // separates from the rest of their shots.
  const arc = bestRun(apexRatioBuckets(shots));
  if (arc) {
    const split = splitAtWindow(shots, apexRatio, arc);
    if (
      split.inside.percentage !== null &&
      split.outside.percentage !== null &&
      split.inside.percentage - split.outside.percentage >= 10 &&
      ratesDiffer(split.inside, split.outside)
    ) {
      found.push({
        kind: "note",
        title: "Your arc has a window that works",
        detail: `Shots spending ${pct(arc.from * 100)}–${pct(arc.to * 100)} of their flight rising went in ${pct(split.inside.percentage)} of the time (${split.inside.attempts} attempts), against ${pct(split.outside.percentage)} outside it.`,
      });
    }
  }

  // Repeatability of the release, measured against the player's own line.
  const fit = releaseFit(shots);
  if (fit) {
    const normal = deviationBuckets(shots, fit).find((b) => b.label === "Normal");
    const rest = rateOf(
      shots.filter((shot) => {
        const d = releaseDeviation(shot, fit);
        return d !== null && Math.abs(d) >= 0.5 * fit.residualSd;
      }),
    );
    if (
      normal?.percentage != null &&
      rest.percentage !== null &&
      normal.percentage - rest.percentage >= 8 &&
      ratesDiffer(normal, rest)
    ) {
      found.push({
        kind: "note",
        title: "Your normal release is your best release",
        detail: `Within ${(0.5 * fit.residualSd).toFixed(2)}s of your usual flight time for the distance you shot ${pct(normal.percentage)}; outside it, ${pct(rest.percentage)}. Scatter around the line is ±${fit.residualSd.toFixed(2)}s.`,
      });
    }
  }

  // Fade or warm-up. Only meaningful inside one session -- across several,
  // the "closing third" is whichever session sorted last.
  const thirds = sessionCount(shots) === 1 ? sessionThirds(shots) : [];
  const opening = thirds[0];
  const closing = thirds[2];
  if (opening?.percentage != null && closing?.percentage != null) {
    const delta = closing.percentage - opening.percentage;
    const real = ratesDiffer(opening, closing);
    if (delta <= -12 && real) {
      found.push({
        kind: "gap",
        title: "You finished colder than you started",
        detail: `${pct(opening.percentage)} over the first ${opening.attempts} shots, ${pct(closing.percentage)} over the last ${closing.attempts}. Worth checking against how long the session ran.`,
      });
    } else if (delta >= 12 && real) {
      found.push({
        kind: "strength",
        title: "You warmed into it",
        detail: `${pct(opening.percentage)} over the first ${opening.attempts} shots, rising to ${pct(closing.percentage)} over the last ${closing.attempts}.`,
      });
    }
  }

  return found;
}
