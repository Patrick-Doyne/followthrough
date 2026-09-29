/**
 * The maths behind the week and day time grids.
 *
 * <p>Separated from the components because positioning an event by its
 * start time and sizing it by its duration is arithmetic, and because
 * laying overlapping sessions out is the part most likely to be wrong
 * in a way nobody notices until two sessions are drawn on top of each
 * other.
 *
 * <p>Everything here is in rem rather than percentages. Rows are not
 * all the same height -- an hour holding stacked sessions grows to fit
 * them -- so "40% down the grid" stopped meaning anything and offsets
 * have to be accumulated row by row.
 */

/**
 * The axis: every hour of the day, midnight to 23:00.
 *
 * <p>It used to open on a 06:00-21:00 band and widen for anything
 * outside it, which meant the axis changed length as you paged through
 * the weeks and one early session shifted every other row on the
 * screen. A calendar's hour axis is a fixed ruler.
 */
export const GRID_HOURS: readonly number[] = Array.from({ length: 24 }, (_, i) => i);

const MINUTES_PER_DAY = 24 * 60;

/** The height of an ordinary hour row. */
export const HOUR_REM = 3;

/** A stacked block, and the step between two of them. */
export const STACK_BLOCK_REM = 1.35;
export const STACK_STEP_REM = STACK_BLOCK_REM + 0.15;

/** Breathing room above and below a stack inside its hour. */
const STACK_PAD_REM = 0.3;

/** The shortest a block may be drawn and still be read and hit. */
export const MIN_BLOCK_REM = 1.35;

/**
 * How far an hour may grow to keep a short session readable.
 *
 * <p>Without a cap, one five-minute entry would stretch its hour to
 * sixteen rem and bend the whole day around it. At four hours' worth
 * of room a session of about seven minutes still reaches the minimum,
 * which is well under any real training block.
 */
const MAX_HOUR_REM = HOUR_REM * 4;

/** "09:30" -> 570. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface Span {
  start: number;
  end: number;
}

/**
 * An event's span in minutes from midnight.
 *
 * <p>An end at or before its start is a session running past midnight,
 * not a negative one; it is carried to the next day so the block has a
 * height rather than disappearing.
 */
export function spanOf(event: { startTime: string; endTime: string }): Span {
  const start = minutesOf(event.startTime);
  const end = minutesOf(event.endTime);
  return { start, end: end <= start ? end + MINUTES_PER_DAY : end };
}

export type Placement =
  | { kind: "lane"; lane: number; lanes: number }
  /** Drawn at a fixed height inside the hour it starts in, which grows
   * to hold however many land there. */
  | { kind: "stack"; hour: number; index: number };

/** Clusters of transitively overlapping spans, in start order. */
function clustersOf(spans: Span[]): { index: number; start: number; end: number }[][] {
  const order = spans
    .map((span, index) => ({ ...span, index }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters: (typeof order)[] = [];
  let current: typeof order = [];
  let clusterEnd = -Infinity;

  for (const span of order) {
    if (current.length > 0 && span.start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(span);
    clusterEnd = Math.max(clusterEnd, span.end);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Lay out one column, and say how many stack slots each hour needs.
 *
 * <p>Sessions that overlap sit side by side while the lanes stay wide
 * enough to read. Past that the cluster stacks -- and each session
 * stacks **inside the hour it starts in**, not from the top of the
 * cluster. Stacking a whole cluster from its first start ran the
 * blocks down through the hours after it, so a session at 11:00 was
 * drawn against 10:00 on the axis. The hour grows instead.
 */
export function layoutColumn(
  spans: Span[],
  maxLanes = Infinity,
): { placements: Placement[]; stackSlots: number[]; minHeights: number[] } {
  const placements: Placement[] = new Array(spans.length);
  const stackSlots = new Array<number>(24).fill(0);
  const minHeights = new Array<number>(24).fill(0);

  for (const cluster of clustersOf(spans)) {
    const laneEnds: number[] = [];
    const assignment: { index: number; lane: number }[] = [];
    for (const span of cluster) {
      let lane = laneEnds.findIndex((end) => end <= span.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(span.end);
      } else {
        laneEnds[lane] = span.end;
      }
      assignment.push({ index: span.index, lane });
    }

    if (laneEnds.length > maxLanes) {
      for (const span of cluster) {
        const hour = Math.min(23, Math.floor(span.start / 60));
        placements[span.index] = { kind: "stack", hour, index: stackSlots[hour] ?? 0 };
        stackSlots[hour] = (stackSlots[hour] ?? 0) + 1;
      }
    } else {
      for (const { index, lane } of assignment) {
        placements[index] = { kind: "lane", lane, lanes: laneEnds.length };
        /*
         * A block is drawn at exactly its share of the hour, so a
         * short one is short. Rather than floor its height -- which
         * makes three twenty-minute blocks overlap each other inside
         * a one-hour row -- the hour itself grows until the shortest
         * session in it reaches the readable minimum. Proportions
         * hold, and three twenty-minute blocks still divide their
         * hour into exact thirds.
         *
         * Only a session that fits inside a single hour can force
         * this; one that spans hours is already tall enough.
         */
        const span = spans[index];
        if (!span) continue;
        const hour = Math.floor(span.start / 60);
        const duration = span.end - span.start;
        if (duration > 0 && Math.floor((span.end - 1) / 60) === hour && hour < 24) {
          minHeights[hour] = Math.max(minHeights[hour] ?? 0, (MIN_BLOCK_REM * 60) / duration);
        }
      }
    }
  }

  return { placements, stackSlots, minHeights };
}

/**
 * The height of each hour row, in rem.
 *
 * <p>An hour is its normal height unless a column needs to stack
 * sessions inside it, in which case it grows to hold them. Rows span
 * every column, so the tallest requirement across the columns wins --
 * otherwise the hour would be a different height in each one and the
 * axis would stop lining up.
 */
export function rowHeights(stackSlots: number[], minHeights: number[] = []): number[] {
  return GRID_HOURS.map((hour) => {
    const slots = stackSlots[hour] ?? 0;
    const stacked = slots === 0 ? 0 : slots * STACK_STEP_REM + STACK_PAD_REM * 2;
    return Math.min(MAX_HOUR_REM, Math.max(HOUR_REM, stacked, minHeights[hour] ?? 0));
  });
}

/** Where a minute of the day falls, in rem from the top of the grid. */
export function offsetOf(minutes: number, heights: number[]): number {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, minutes));
  const hour = Math.floor(clamped / 60);
  // Midnight at the far end is the bottom of the grid, not the top of
  // a twenty-fifth row.
  if (hour >= 24) return gridHeight(heights);
  let offset = 0;
  for (let h = 0; h < hour; h++) offset += heights[h] ?? HOUR_REM;
  return offset + ((clamped % 60) / 60) * (heights[hour] ?? HOUR_REM);
}

/** The top of an hour row, in rem. */
export function rowTop(hour: number, heights: number[]): number {
  let offset = 0;
  for (let h = 0; h < hour; h++) offset += heights[h] ?? HOUR_REM;
  return offset;
}

/** The whole grid's height, in rem. */
export function gridHeight(heights: number[]): number {
  return heights.reduce((total, h) => total + h, 0);
}
