/**
 * The analysis overlay: everything drawn over the footage from the C++
 * pipeline's per-frame telemetry.
 *
 * One renderer serves both surfaces. During a live session
 * `renderFromPersistent` paints the camera frame and the overlay into one
 * canvas, which is what the recorder captures. During playback of a stored
 * recording `renderOverlayFromPersistent` paints the overlay alone onto a
 * transparent canvas that sits over the <video> element, driven by the
 * stored telemetry -- the upload itself is never modified, and the overlay
 * follows whichever theme is current when it is viewed (see
 * overlay-palette.ts and setOverlayAccent). The trail lifecycle rules
 * mirror the backend's own state transitions: which frames start, freeze
 * and clear a trail is decided by the telemetry, not re-derived here.
 *
 * Everything is authored against a fixed 2160-px short edge (see
 * OverlayViewport below) and scaled to the element on screen. Incoming
 * telemetry coordinates are remapped into that space once, per frame.
 */

import type {
  ApexPoint,
  FrameTelemetry,
  OverlayBox,
  OverlayPoint,
  PoseKeypoints,
  ShotDesignation,
  ShotEventMessage,
} from "@/types/overlay-telemetry";

import {
  isIdentityMap,
  mapWarmHex,
  overlayAccentMap,
  OVERLAY_ACCENT_IDENTITY,
  type OverlayAccentMap,
} from "@/lib/overlay-palette";

/**
 * The overlay's accent family, re-hued to the theme.
 *
 * <p>Nineteen warm colours are measured out of the artwork below: one
 * orange, ramped in lightness. `setOverlayAccent` moves the whole family
 * at once -- see overlay-palette.ts -- so each colour keeps its place in
 * that ramp; repainting them one at a time would flatten the thing the
 * ramp exists to do.
 *
 * <p>A lookup rather than constants, because the drawing runs long after
 * this module loads and the theme can change between two frames. The
 * identity map returns the literal untouched, so a caller that never sets
 * an accent gets the artwork's own colours.
 */
let warmMap: OverlayAccentMap = OVERLAY_ACCENT_IDENTITY;
const warmCache = new Map<string, string>();

function warm(hex: string): string {
  if (isIdentityMap(warmMap)) return hex;
  const hit = warmCache.get(hex);
  if (hit !== undefined) return hit;
  const mapped = mapWarmHex(hex, warmMap);
  warmCache.set(hex, mapped);
  return mapped;
}

/**
 * The same rotation, for a warm colour written with an alpha channel.
 *
 * <p>These were missed the first time round: the sweep that found the
 * accent family only looked at `"#rrggbb"` literals, so the glow, the
 * floor wash and the make burst -- all written as `rgba(255,140,0,...)`
 * -- stayed orange while everything around them turned. Anything warm
 * goes through one of these two, whatever notation it is written in.
 */
function warmA(hex: string, alpha: number): string {
  const rotated = warm(hex);
  const r = parseInt(rotated.slice(1, 3), 16);
  const g = parseInt(rotated.slice(3, 5), 16);
  const b = parseInt(rotated.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Points the overlay at a theme accent. Passing the shipped accent for
 * both restores the artwork exactly as drawn.
 */
export function setOverlayAccent(accentCss: string, defaultAccentCss: string): void {
  const next = overlayAccentMap(accentCss, defaultAccentCss);
  if (next.dh === warmMap.dh && next.cr === warmMap.cr) return;
  warmMap = next;
  warmCache.clear();
}

export const CANVAS_WIDTH = 3840;
export const CANVAS_HEIGHT = 2160;

/**
 * The surface the overlay is drawn on, in the artwork's own units.
 *
 * <p>Everything below is authored in absolute pixels against a 3840x2160
 * frame, and for a 16:9 source that is exactly what it stays. A portrait
 * clip is the problem this type exists for: a phone shoots 2160x3840, and
 * squeezing that into a 16:9 surface stretched the whole overlay to almost
 * twice its height and a bit over half its width: the panels came out
 * narrow and tall, and the condensed type inside them narrower still.
 *
 * <p>So the surface takes the source's aspect ratio, and only its aspect
 * ratio: the short edge stays {@link OVERLAY_SHORT_EDGE} whatever the clip
 * is. That is the single invariant that makes every hard-coded number in
 * this file keep its meaning -- a 40px label is 40px of a 2160-px short
 * edge in portrait exactly as it is in landscape -- while the long edge
 * simply gets longer or shorter. A 16:9 source of any resolution resolves
 * to 3840x2160 and is therefore untouched, which is what keeps the
 * approved artwork approved.
 */
export interface OverlayViewport {
  width: number;
  height: number;
}

/** The edge the artwork's absolute pixel values are measured against. */
export const OVERLAY_SHORT_EDGE = CANVAS_HEIGHT;

/** The 16:9 surface everything here was authored in. */
export const AUTHORED_VIEWPORT: OverlayViewport = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
};

/**
 * The surface to draw a given source on.
 *
 * <p>Falls back to the authored 16:9 surface when the source's size is
 * unknown, which is what a live session and any telemetry written before
 * the pipeline reported frame size both get.
 */
export function viewportForFrame(frameWidth: number, frameHeight: number): OverlayViewport {
  if (!(frameWidth > 0) || !(frameHeight > 0)) return AUTHORED_VIEWPORT;
  const scale = OVERLAY_SHORT_EDGE / Math.min(frameWidth, frameHeight);
  return {
    width: Math.round(frameWidth * scale),
    height: Math.round(frameHeight * scale),
  };
}

/*
 * The accent family is deliberately NOT hoisted into constants beside
 * these. A `const` is evaluated once at import, when no theme has been
 * applied yet, which froze the overlay orange however the app was themed
 * -- the bug this comment exists to prevent coming back. Every accent
 * colour is read through warm() at the moment it is drawn.
 *
 * The neutrals below are genuine constants: they are the dark chrome the
 * overlay sits on, and they do not follow the theme.
 */
const THEME_TEXT_PRIMARY = "#f0f0f0";

/** Condensed display face for panel chrome: wordmarks, stat numerals and
 * tracked micro-labels. Condensed caps are what give sports-broadcast
 * graphics their density, and a narrower face buys real estate for larger
 * type. Browsers fall through to whichever condensed face the OS has, so
 * the same frame can set slightly differently on two machines; exact
 * glyph parity would need a bundled webfont.
 *
 * <p>No family name in any stack here may begin with a hyphen.
 * "-apple-system" is a browser-only CSS keyword, and when this renderer
 * was once run under node-canvas its font parser rejected the ENTIRE font
 * string on the leading hyphen and silently fell back to 10px sans-serif
 * -- an invisible failure (the text still draws, just at the wrong size)
 * that is not worth reintroducing for the sake of one keyword. */
const FONT_DISPLAY = (weight: "" | "bold ", size: number) =>
  `${weight}${size}px 'DejaVu Sans Condensed', 'Roboto Condensed', 'Arial Narrow', 'Segoe UI', Arial, sans-serif`;

/** Monospaced numerals for every value that changes frame to frame.
 * Proportional digits have different advance widths, so a value ticking
 * from 9 to 10 (or 0.57 to 0.61) shifts everything around it by a few
 * pixels -- imperceptible in a still, but at 60fps it reads as the
 * numbers twitching. A fixed advance holds every
 * column still, and it is also what lets the stat table stay aligned as a
 * session grows from single- to triple-digit counts. */
const FONT_MONO = (weight: "" | "bold ", size: number) =>
  `${weight}${size}px 'DejaVu Sans Mono', 'SF Mono', Consolas, 'Courier New', monospace`;

// ---- HUD panel palette --------------------------------------------------
// Near-black, slightly blue-shifted panel bodies so the warm accent is the
// only chromatic element on screen and its glow has something to read
// against; bodies stay translucent enough to feel composited onto the
// footage rather than pasted over it.
const PANEL_BODY_TOP = "rgba(11,13,17,0.94)";
const PANEL_BODY_BOTTOM = "rgba(18,22,28,0.88)";
const PANEL_SHADOW = "rgba(0,0,0,0.30)";
const HAIRLINE = "rgba(255,255,255,0.10)";
const HAIRLINE_BRIGHT = "rgba(255,255,255,0.18)";
const PANEL_TEXT_PRIMARY = "#f5f7fa";
const PANEL_TEXT_SECONDARY = "#9aa4b2";
const PANEL_TEXT_MUTED = "#6b7480";
const CHIP_TEXT_DARK = "#0b0d10";

const CATEGORY_ORDER: ShotDesignation[] = [
  "LAY_UP",
  "CLS_RNG",
  "MID_RNG",
  "HS_3PT",
  "NCAA_3PT",
  "NBA_3PT",
];
const CATEGORY_LABELS: Record<ShotDesignation, string> = {
  LAY_UP: "LAYUP",
  CLS_RNG: "CLOSE",
  MID_RNG: "MID RANGE",
  HS_3PT: "HS 3PT",
  NCAA_3PT: "NCAA 3PT",
  NBA_3PT: "NBA 3PT",
};

/** Cross-section width of the flight band at the release and at the rim,
 * before perspective scaling. Narrower at the start than the finish, so the
 * band opens up as it travels and the eye is carried along it. */
const TRAIL_MIN_THICKNESS = 33;
const TRAIL_MAX_THICKNESS = 54;
/** Extruded depth of the slab -- how tall its side walls stand. Kept as a
 * meaningful fraction of the band width; below roughly a fifth the walls
 * stop reading as thickness and just look like a dark outline. */
const SLAB_THICKNESS = 12;

/**
 * How large the flight band should be drawn for this shot, from how large
 * the shooter appears on screen.
 *
 * <p>A shot from the back of the court is further from the camera, so a
 * fixed-width band would look oversized there and undersized up close --
 * it would sit on the frame rather than in it. The player's on-screen
 * bounding-box height is the most direct depth cue available (the schema
 * carries no camera geometry), so the band is scaled by it. Clamped at both
 * ends so a bad detection can never blow the arrow up or shrink it away.
 */
function perspectiveScale(playerBox: OverlayBox | null) {
  if (!playerBox || playerBox.y1 == null || playerBox.y2 == null) return 1;
  const height = Math.abs(playerBox.y2 - playerBox.y1);
  if (height < 1) return 1;
  // ~900px is a mid-court shooter in a 2160-tall frame.
  return Math.max(0.55, Math.min(1.5, height / 900));
}

/**
 * Broadcast HUD layout, authored directly in the fixed 3840x2160 canvas
 * space (no scale factor -- every value below is final device pixels).
 *
 * <p>Type is sized for the size the video is actually *watched* at, not
 * the size it's rendered at: the overlay is drawn on a 4K surface that
 * typically displays in a ~1280px-wide player, so everything here is
 * effectively divided by three on screen. A 40px row label is ~13px to
 * the viewer, and a 30px micro-label is ~10px -- which is why nothing in
 * this panel goes below 26px even though that looks oversized when the
 * raw 4K frame is inspected at 1:1.
 */
const PANEL_X = 48;
const PANEL_Y = 48;
const PANEL_PAD = 40;
const PANEL_CHAMFER = 34;
const TAB_H = 62;
/** Space either side of a panel title inside its tab. */
const TAB_PAD = 22;
/** Letter spacing on a panel title. Broadcast caps are tracked out. */
const TAB_TRACKING = 6;

/** Wide enough that every column still clears its neighbour at the widest
 * value it can ever hold -- a 10-pip record strip, a "999-999" count and a
 * "100.0%" rate. Verified by measuring those strings in the condensed and
 * monospaced faces rather than by eye: at the previous 840 the record strip
 * and the count column overlapped once a category reached three digits. */
const SUMMARY_W = 920;
/** Tall enough for the six category rows plus the recent-form strip that
 * sits under them (its hairline lands at SUMMARY_H - 104). */
const SUMMARY_H = 790;
const TRACKER_W = 680;
/** Tall enough that the verdict banner gets its own band under the last
 * metric row. At 520 the banner was drawn over the DISTANCE row and its
 * meter -- the metrics end at ~462px and the banner started at 436px. */
const TRACKER_H = 570;
const PANEL_GAP = 24;

/**
 * The panels' authored sizes, for anything that needs to reason about
 * where they sit without drawing them -- placement, hit-testing, the
 * drag handles.
 */
export const PANEL_METRICS = {
  summary: { width: SUMMARY_W, height: SUMMARY_H },
  tracker: { width: TRACKER_W, height: TRACKER_H },
  /** Between the two panels, and from the frame edge. */
  gap: PANEL_GAP,
  margin: PANEL_X,
} as const;

export type PanelId = "summary" | "tracker";

/** Where one panel sits and how big it is drawn, in viewport pixels. */
export interface PanelPlacement {
  x: number;
  y: number;
  /** Uniform. The panel's internals are tuned to its authored width, so
   * it is scaled rather than reflowed -- see drawShotSummaryPanel. */
  scale: number;
}

export interface OverlayPanelLayout {
  summary: PanelPlacement;
  tracker: PanelPlacement;
}

/**
 * How big the panels are before anyone drags them.
 *
 * <p>Three quarters of their authored size, which is a deliberate
 * reduction rather than a re-tuning: at 1.0 they read as slightly larger
 * than the job needs, and scaling the whole panel keeps the column guides
 * and the type floor in exactly the proportion they were approved at.
 */
export const DEFAULT_PANEL_SCALE = 0.75;

/** The size a panel is actually drawn at, in viewport pixels. */
export function panelSize(id: PanelId, scale: number): { width: number; height: number } {
  const metrics = PANEL_METRICS[id];
  return { width: metrics.width * scale, height: metrics.height * scale };
}

/**
 * Where the pair sits with nothing else to go on: the authored corner,
 * with the tracker beside the summary or under it.
 *
 * <p>Side by side is the authored arrangement and the one a 16:9 frame
 * gets. It does not survive a portrait frame, though, and not because it
 * fails to fit -- at full size the pair is 1752px across and a 2160-wide
 * surface holds that. It is that 1752 of 2160 is **81% of the width**,
 * where the same pair is 46% of a 16:9 frame, so the chrome stops being a
 * corner and becomes a band across the top with the rim behind it.
 *
 * <p>Rather than pick a threshold, both arrangements are measured against
 * the frame and the less intrusive one wins: each is scored by the larger
 * of the two fractions of the frame it takes up, which is the dimension
 * it crowds.
 *
 * <p>This is the fallback. A recording whose telemetry says where the play
 * actually happens gets a better answer -- see overlay-panels.ts.
 */
export function staticPanelLayout(
  viewport: OverlayViewport,
  scale: number = DEFAULT_PANEL_SCALE,
): OverlayPanelLayout {
  const summary = panelSize("summary", scale);
  const tracker = panelSize("tracker", scale);
  const gap = PANEL_GAP * scale;
  const margin = PANEL_X * scale;

  const beside = Math.max(
    (margin + summary.width + gap + tracker.width) / viewport.width,
    (margin + Math.max(summary.height, tracker.height)) / viewport.height,
  );
  const below = Math.max(
    (margin + summary.width) / viewport.width,
    (margin + summary.height + gap + tracker.height) / viewport.height,
  );

  return {
    summary: { x: margin, y: margin, scale },
    tracker:
      beside <= below
        ? { x: margin + summary.width + gap, y: margin, scale }
        : { x: margin, y: margin + summary.height + gap, scale },
  };
}

/** Shots-made/attempted pips. Capped so a long session degrades to
 * "first N + overflow count" instead of running out of panel. */
const PIP_MAX = 10;
const PIP_W = 22;
const PIP_GAP = 6;
const PIP_H = 26;

// ============================================================
// COORDINATE REMAPPING
// ============================================================

export function remapFrameCoordinates(
  f: FrameTelemetry,
  viewport: OverlayViewport = AUTHORED_VIEWPORT,
): FrameTelemetry {
  if (!f.frame_width || !f.frame_height) return f;

  /*
   * Deliberately two independent factors, not one uniform fit: the
   * telemetry has to land wherever the picture lands. A live session
   * stretches the camera frame across the whole authored surface with a
   * single drawImage, so its coordinates must stretch with it. A playback
   * surface is given the source's own aspect ratio, so the two factors
   * come out equal there and nothing is distorted. Forcing a uniform fit
   * here would fix playback by breaking live.
   */
  const sx = viewport.width / f.frame_width;
  const sy = viewport.height / f.frame_height;

  function remapBox<T extends OverlayBox | null>(box: T): T {
    if (!box) return box;
    const out = { ...box } as OverlayBox & { center_x?: number | null; center_y?: number | null };
    if (out.x1 != null) out.x1 *= sx;
    if (out.x2 != null) out.x2 *= sx;
    if (out.y1 != null) out.y1 *= sy;
    if (out.y2 != null) out.y2 *= sy;
    if ("center_x" in out && out.center_x != null) out.center_x *= sx;
    if ("center_y" in out && out.center_y != null) out.center_y *= sy;
    return out as T;
  }

  const remapped: FrameTelemetry = { ...f };
  remapped.ball = remapBox(f.ball);
  remapped.player = remapBox(f.player);
  remapped.rim = remapBox(f.rim);
  remapped.net = remapBox(f.net);

  if (f.court_keypoints) {
    remapped.court_keypoints = f.court_keypoints.map((kp) => ({
      x: kp.x * sx,
      y: kp.y * sy,
      valid: kp.valid,
    }));
  }

  if (f.pose) {
    const pose: PoseKeypoints = {};
    for (const key of Object.keys(f.pose) as (keyof PoseKeypoints)[]) {
      const kp = f.pose[key];
      pose[key] = kp ? { x: kp.x * sx, y: kp.y * sy, valid: kp.valid } : (kp ?? null);
    }
    remapped.pose = pose;
  }

  if (f.apex_point) {
    remapped.apex_point = { x: f.apex_point.x * sx, y: f.apex_point.y * sy };
  }

  return remapped;
}

// ============================================================
// PERSISTENT STATE — shared trail/stats rules, applied one message at a
// time as it arrives live. court_keypoints especially is only sent on
// actual change, so this state must be held incrementally rather than
// derived fresh from each message.
// ============================================================

/**
 * Everything animated is driven from telemetry frame_id, never wall-clock
 * time. The overlay has to produce identical pixels in two very different
 * environments -- a live session drawing as messages arrive, and playback
 * of a stored recording, where a seek replays a window of frames as fast
 * as the machine allows (see overlay-replay.ts) -- and a Date.now()-based
 * animation would run at whatever rate frames happen to be replayed rather
 * than on the video's timeline. frame_id is the video's own clock, so both
 * paths agree.
 */
interface OverlayAnimationState {
  /** Eased 0..1 values chasing their real targets, so meters glide instead
   * of snapping when a shot lands. */
  fgDisplay: number;
  categoryDisplay: Record<ShotDesignation, number>;
  /** frame_id of the most recent resolved shot, for the verdict flash. */
  lastShotFrame: number | null;
  lastShotResult: "make" | "miss" | null;
  lastShotDesignation: ShotDesignation | null;
  /** frame_id at which the current shot began, for the designation reveal. */
  shotStartFrame: number | null;
  /** Where the rim was when the shot resolved -- the burst, shockwave and
   * verdict all originate there, and the live rim box may have moved or
   * dropped out by the time the animation finishes. */
  lastShotRim: { x: number; y: number } | null;
  /** A copy of the ball's flight path at the moment of resolution. The live
   * trail is cleared as soon as the shot ends, so replaying the arc needs
   * its own snapshot. */
  lastShotTrail: { x: number; y: number }[];
  /** Perspective scale captured with that path, so the replay keeps the
   * size the shot was actually drawn at even if the player has since moved
   * or been lost. */
  lastShotScale: number;
  /** Previous frame_id, so easing can advance by real elapsed frames rather
   * than assuming every render is exactly one frame apart. */
  lastFrameId: number | null;
}

export interface OverlayPersistentState {
  courtKeypoints: OverlayPoint[] | null;
  trail: { x: number; y: number }[];
  trailFrozen: boolean;
  prevPotentialShot: boolean;
  prevShotStarted: boolean;
  categoryStats: Record<ShotDesignation, { makes: number; misses: number }>;
  makes: number;
  misses: number;
  lastFrame: FrameTelemetry | null;
  anim: OverlayAnimationState;
  /** Recent player foot positions, newest last, used to derive the heading
   * of the motion vector. Speed itself comes from telemetry; this only
   * supplies direction, which the schema does not carry. */
  playerTrack: { x: number; y: number; frameId: number }[];
  /** Last good player/rim detections and the smoothed readout derived from
   * them -- see PlayerReadoutState. */
  readout: PlayerReadoutState;
  /** The ball path of the most recently *completed* flight, saved at the
   * moment the live trail is cleared. A shot_event frequently arrives one
   * or more frames after shot_started has already gone false -- verified
   * against real telemetry, where two of three makes resolved this way --
   * by which point state.trail is empty, so snapshotting only at event
   * time would silently lose the arc for those shots. */
  lastCompletedTrail: { x: number; y: number }[];
  /** Newest last, bounded -- drives the recent-form strip. */
  shotHistory: ("make" | "miss")[];
  /** Consecutive makes; resets on any miss. */
  streak: number;
}

const PLAYER_TRACK_MAX = 14;
const SHOT_HISTORY_MAX = 14;

/**
 * Holds the player/rim readout across the short gaps where the detector
 * loses a box for a frame or two.
 *
 * <p>Without this the player outline blinks out and back whenever a
 * detection drops. Nothing here invents a position: the boxes are the last
 * ones actually measured, held for at most READOUT_HOLD_FRAMES (~0.4s at
 * 60fps) and faded out if the gap runs longer, so a genuinely lost player
 * still disappears rather than leaving a stale bracket on screen. The rim
 * is held for the same reason plus one more -- the shot-resolution burst
 * originates from it after the shot has already ended.
 *
 */
interface PlayerReadoutState {
  playerBox: OverlayBox | null;
  rimBox: OverlayBox | null;
  playerSeenFrame: number | null;
  rimSeenFrame: number | null;
  projected: boolean;
  /** Smoothed top-centre of the player box, where the tag is pinned, so it
   * glides instead of twitching as the box breathes. */
  anchorX: number | null;
  anchorY: number | null;
  /** Eased figures, so a rounded readout does not flicker between two
   * adjacent integers. */
  displayDistanceFt: number | null;
  displaySpeedMph: number | null;
}

const READOUT_HOLD_FRAMES = 24;

export function makeFreshPersistentState(): OverlayPersistentState {
  const categoryStats = {} as Record<ShotDesignation, { makes: number; misses: number }>;
  for (const cat of CATEGORY_ORDER) categoryStats[cat] = { makes: 0, misses: 0 };
  const categoryDisplay = {} as Record<ShotDesignation, number>;
  for (const cat of CATEGORY_ORDER) categoryDisplay[cat] = 0;

  return {
    courtKeypoints: null,
    trail: [],
    trailFrozen: false,
    prevPotentialShot: false,
    prevShotStarted: false,
    categoryStats,
    makes: 0,
    misses: 0,
    lastFrame: null,
    anim: {
      fgDisplay: 0,
      categoryDisplay,
      lastShotFrame: null,
      lastShotResult: null,
      lastShotDesignation: null,
      shotStartFrame: null,
      lastShotRim: null,
      lastShotTrail: [],
      lastShotScale: 1,
      lastFrameId: null,
    },
    playerTrack: [],
    lastCompletedTrail: [],
    readout: {
      playerBox: null,
      rimBox: null,
      playerSeenFrame: null,
      rimSeenFrame: null,
      projected: false,
      anchorX: null,
      anchorY: null,
      displayDistanceFt: null,
      displaySpeedMph: null,
    },
    shotHistory: [],
    streak: 0,
  };
}

export function applyShotEvent(state: OverlayPersistentState, ev: ShotEventMessage) {
  if (ev.result === "make") {
    state.makes++;
    if (ev.shot_designation && state.categoryStats[ev.shot_designation]) {
      state.categoryStats[ev.shot_designation].makes++;
    }
  } else if (ev.result === "miss") {
    state.misses++;
    if (ev.shot_designation && state.categoryStats[ev.shot_designation]) {
      state.categoryStats[ev.shot_designation].misses++;
    }
  }

  if (ev.result === "make" || ev.result === "miss") {
    // Timestamped against the last frame seen rather than a counter of its
    // own: a shot event carries no frame_id, but it always arrives between
    // two frames, and the flash only needs to know which one.
    state.anim.lastShotFrame = state.lastFrame?.frame_id ?? null;
    state.anim.lastShotResult = ev.result;
    state.anim.lastShotDesignation = ev.shot_designation ?? null;

    const rim = state.readout.rimBox;
    state.anim.lastShotRim =
      rim && rim.x1 != null && rim.x2 != null && rim.y1 != null && rim.y2 != null
        ? { x: (rim.x1 + rim.x2) / 2, y: (rim.y1 + rim.y2) / 2 }
        : null;
    // Prefer the still-live trail; fall back to the last completed flight
    // for the common case where the trail was cleared a few frames before
    // the result was published.
    const flight = state.trail.length >= 3 ? state.trail : state.lastCompletedTrail;
    state.anim.lastShotTrail = flight.map((p) => ({ x: p.x, y: p.y }));
    state.anim.lastShotScale = perspectiveScale(state.readout.playerBox);

    state.shotHistory.push(ev.result);
    if (state.shotHistory.length > SHOT_HISTORY_MAX) state.shotHistory.shift();
    state.streak = ev.result === "make" ? state.streak + 1 : 0;
  }
}

/** Keeps a copy of a flight path as it is discarded, so a shot result that
 * lands after the trail was cleared can still replay the arc. */
function preserveCompletedTrail(state: OverlayPersistentState) {
  if (state.trail.length >= 3) {
    state.lastCompletedTrail = state.trail.map((p) => ({ x: p.x, y: p.y }));
  }
}

export function applyFrame(state: OverlayPersistentState, f: FrameTelemetry) {
  if (f.court_keypoints) {
    state.courtKeypoints = f.court_keypoints;
  }

  // Trail lifecycle, driven purely by flags already in the schema, matching
  // the backend's own transitions: clear when a release candidate expires
  // without confirming, or when an active shot just ended.
  if (state.prevPotentialShot && !f.potential_shot && !state.prevShotStarted) {
    preserveCompletedTrail(state);
    state.trail = [];
    state.trailFrozen = false;
  }
  if (state.prevShotStarted && !f.shot_started) {
    preserveCompletedTrail(state);
    state.trail = [];
    state.trailFrozen = false;
  }

  if (f.trail_frozen_at_rim) {
    state.trailFrozen = true;
  }

  if (
    (f.potential_shot || f.shot_started) &&
    !state.trailFrozen &&
    f.ball?.center_x != null &&
    f.ball.center_y != null
  ) {
    state.trail.push({ x: f.ball.center_x, y: f.ball.center_y });
  }

  if (f.shot_started && !state.prevShotStarted) {
    state.anim.shotStartFrame = f.frame_id;
  }

  if (f.player?.x1 != null && f.player.x2 != null && f.player.y2 != null) {
    state.playerTrack.push({
      x: (f.player.x1 + f.player.x2) / 2,
      y: f.player.y2,
      frameId: f.frame_id,
    });
    if (state.playerTrack.length > PLAYER_TRACK_MAX) state.playerTrack.shift();
  }

  updatePlayerReadout(state, f);

  tickAnimation(state, f);

  state.prevPotentialShot = f.potential_shot;
  state.prevShotStarted = f.shot_started;
  state.lastFrame = f;
}

/**
 * Latches the newest player/rim detections and eases the figures the tag
 * displays. A frame that carries no player box leaves the previous one in
 * place (see PlayerReadoutState) rather than clearing it, which is what
 * keeps the readout from blinking in and out with the detector.
 */
function updatePlayerReadout(state: OverlayPersistentState, f: FrameTelemetry) {
  const readout = state.readout;

  if (f.player?.x1 != null && f.player.x2 != null && f.player.y1 != null) {
    readout.playerBox = f.player;
    readout.playerSeenFrame = f.frame_id;
    readout.projected = Boolean(f.player_stat_is_projected);

    const targetX = ((f.player.x1 ?? 0) + (f.player.x2 ?? 0)) / 2;
    const targetY = f.player.y1 ?? 0;
    readout.anchorX =
      readout.anchorX == null ? targetX : readout.anchorX + (targetX - readout.anchorX) * 0.25;
    readout.anchorY =
      readout.anchorY == null ? targetY : readout.anchorY + (targetY - readout.anchorY) * 0.25;
  }

  if (f.player_distance_ft != null) {
    readout.displayDistanceFt =
      readout.displayDistanceFt == null
        ? f.player_distance_ft
        : readout.displayDistanceFt + (f.player_distance_ft - readout.displayDistanceFt) * 0.25;
  }

  if (f.player_speed_mph != null) {
    readout.displaySpeedMph =
      readout.displaySpeedMph == null
        ? f.player_speed_mph
        : readout.displaySpeedMph + (f.player_speed_mph - readout.displaySpeedMph) * 0.25;
  }

  if (f.rim?.x1 != null && f.rim.x2 != null && f.rim.y2 != null) {
    readout.rimBox = f.rim;
    readout.rimSeenFrame = f.frame_id;
  }
}

/** Advances the eased display values toward their real targets. Step size
 * is derived from how many frames actually elapsed, so a dropped or sparse
 * telemetry frame slows the glide down rather than letting it jump. */
function tickAnimation(state: OverlayPersistentState, f: FrameTelemetry) {
  const previous = state.anim.lastFrameId;
  const elapsed = previous == null ? 1 : Math.max(1, Math.min(12, f.frame_id - previous));
  state.anim.lastFrameId = f.frame_id;

  // Per-frame retention of 0.88 -> ~0.5s to close most of the gap at 60fps.
  const blend = 1 - Math.pow(0.88, elapsed);

  const attempts = state.makes + state.misses;
  const fgTarget = attempts > 0 ? state.makes / attempts : 0;
  state.anim.fgDisplay += (fgTarget - state.anim.fgDisplay) * blend;

  for (const cat of CATEGORY_ORDER) {
    const stats = state.categoryStats[cat];
    const catAttempts = stats.makes + stats.misses;
    const target = catAttempts > 0 ? stats.makes / catAttempts : 0;
    state.anim.categoryDisplay[cat] += (target - state.anim.categoryDisplay[cat]) * blend;
  }
}

// ============================================================
// GLOSSY TAPERED ARROW PATH — direct port of draw_glossy_arrow_path().
// ============================================================

/**
 * Fits a ballistic arc through the tracked points and returns a clean curve
 * to draw instead of the raw path.
 *
 * <p>A shot is a projectile, so its flight is a parabola. Tracing the
 * detections directly means the band inherits every wobble in the tracker,
 * and -- worse -- the shape keeps changing as points arrive, so the arc
 * appears to writhe as the shot progresses. Fitting means the drawn curve is
 * a smooth arc by construction, and because a least-squares fit over many
 * points barely moves when one more is added, it is stable frame to frame.
 * The goal here is a highly stable, approximately correct estimate rather
 * than a pinpoint trace.
 *
 * <p>The fit is parameterised by <b>sample index</b>, not by x: points arrive
 * one per frame, so index stands in for time, and the true ballistic model
 * is then x linear in time and y quadratic in it. Fitting y against x would
 * have blown up on a steep shot, where x barely changes over the whole
 * flight.
 *
 * <p>The index is centred before solving, which keeps the normal equations
 * well conditioned (otherwise the quadratic terms reach i^4 and lose
 * precision). The apex falls out of the fit analytically as -q1/2q2, which
 * is far steadier than picking whichever tracked point currently happens to
 * be highest.
 */
function fitBallisticArc(points: { x: number; y: number }[], samples: number) {
  const n = points.length;
  if (n < 6) return null;

  const meanI = (n - 1) / 2;
  let s0 = 0,
    s1 = 0,
    s2 = 0,
    s3 = 0,
    s4 = 0;
  let tx0 = 0,
    tx1 = 0;
  let ty0 = 0,
    ty1 = 0,
    ty2 = 0;

  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const u = i - meanI;
    const u2 = u * u;
    s0 += 1;
    s1 += u;
    s2 += u2;
    s3 += u2 * u;
    s4 += u2 * u2;
    tx0 += p.x;
    tx1 += u * p.x;
    ty0 += p.y;
    ty1 += u * p.y;
    ty2 += u2 * p.y;
  }

  // x is linear in time: solve the 2x2 directly.
  const denomX = s0 * s2 - s1 * s1;
  if (Math.abs(denomX) < 1e-9) return null;
  const px0 = (tx0 * s2 - tx1 * s1) / denomX;
  const px1 = (tx1 * s0 - tx0 * s1) / denomX;

  // y is quadratic in time: 3x3 normal equations by Cramer's rule.
  const det = (a: number[], b: number[], c: number[]) =>
    a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
    a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
    a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);

  const m0 = [s0, s1, s2];
  const m1 = [s1, s2, s3];
  const m2 = [s2, s3, s4];
  const base = det(m0, m1, m2);
  if (Math.abs(base) < 1e-9) return null;

  const t = [ty0, ty1, ty2];
  const col = (k: number, a: number[], b: number[], c: number[]) => {
    const A = [...a],
      B = [...b],
      C = [...c];
    A[k] = t[0]!;
    B[k] = t[1]!;
    C[k] = t[2]!;
    return det(A, B, C);
  };
  const q0 = col(0, m0, m1, m2) / base;
  const q1 = col(1, m0, m1, m2) / base;
  const q2 = col(2, m0, m1, m2) / base;

  const uMin = -meanI;
  const uMax = n - 1 - meanI;
  const fitted: { x: number; y: number }[] = [];
  for (let k = 0; k < samples; k++) {
    const u = uMin + ((uMax - uMin) * k) / (samples - 1);
    fitted.push({ x: px0 + px1 * u, y: q0 + q1 * u + q2 * u * u });
  }

  // Apex of the fitted parabola, as a position along the drawn curve. Only
  // meaningful if the fit actually curves and the turning point lies inside
  // the flight we have seen.
  let tApex: number | null = null;
  if (Math.abs(q2) > 1e-6) {
    const uApex = -q1 / (2 * q2);
    const normalised = (uApex - uMin) / (uMax - uMin);
    if (normalised > 0.15 && normalised < 0.9) tApex = normalised;
  }

  return { points: fitted, tApex };
}

/**
 * Conditions a raw trail into something a ribbon can be built on without
 * deforming.
 *
 * <p>Three problems in the raw path all show up as the same symptom -- a
 * squiggle or a kink in the band, worst near the apex and at the very start
 * of a shot:
 *
 * <ul>
 *   <li><b>Near-duplicate points.</b> A jittering detection emits several
 *       points within a pixel or two of each other. The direction between
 *       them is essentially noise, and a curve threaded through them can
 *       loop around them.
 *   <li><b>Uneven spacing.</b> Points bunch where the ball moves slowly --
 *       which is precisely the apex, since vertical speed passes through
 *       zero there. Central-difference tangents across bunched points are
 *       ill-conditioned, so the surface normal swings wildly exactly where
 *       the band is most visible.
 *   <li><b>Residual high-frequency noise</b>, which a wide ribbon amplifies
 *       into a visible wobble because the edges sit far from the centreline.
 * </ul>
 *
 * <p>So: drop the duplicates, resample to uniform arc length (which fixes
 * the conditioning), then smooth once more now that the samples are evenly
 * spaced and a moving average is well behaved.
 */
function prepareFlightPath(points: { x: number; y: number }[], samples: number) {
  const deduped: { x: number; y: number }[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 4) deduped.push(p);
  }
  if (deduped.length < 3) return deduped;

  const cumulative = [0];
  for (let i = 1; i < deduped.length; i++) {
    const a = deduped[i - 1]!;
    const b = deduped[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total <= 1) return deduped;

  const count = Math.max(12, Math.min(samples, Math.round(total / 18)));
  const resampled: { x: number; y: number }[] = [];
  let seg = 1;
  for (let k = 0; k < count; k++) {
    const d = (total * k) / (count - 1);
    while (seg < cumulative.length - 1 && cumulative[seg]! < d) seg++;
    const segStart = cumulative[seg - 1]!;
    const segLen = cumulative[seg]! - segStart;
    const local = segLen > 0 ? (d - segStart) / segLen : 0;
    const a = deduped[seg - 1]!;
    const b = deduped[seg]!;
    resampled.push({ x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local });
  }

  // Endpoints are pinned: smoothing them would pull the band off the
  // release point and away from the ball.
  const smoothed = resampled.map((p) => ({ ...p }));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < smoothed.length - 1; i++) {
      smoothed[i] = {
        x: (resampled[i - 1]!.x + 2 * resampled[i]!.x + resampled[i + 1]!.x) / 4,
        y: (resampled[i - 1]!.y + 2 * resampled[i]!.y + resampled[i + 1]!.y) / 4,
      };
    }
    for (let i = 0; i < smoothed.length; i++) resampled[i] = { ...smoothed[i]! };
  }
  return smoothed;
}

/**
 * The ball's flight path, drawn as a solid extruded slab rather than a
 * stroked line or a zero-thickness ribbon.
 *
 * <p>The thing that makes a 3D arrow read as 3D is that you can see which
 * surface you are looking at. This builds three distinct families of facet
 * and shades them differently:
 *
 * <ul>
 *   <li><b>Top face</b> -- the band itself, bright amber, seen wherever the
 *       band is tilted toward the viewer.
 *   <li><b>Undercarriage</b> -- the same face after the band has rolled past
 *       edge-on, shaded dark burnt amber. This is what you see on the far
 *       side of the fold.
 *   <li><b>Side wall</b> -- the extruded thickness between the top surface
 *       and its offset copy, mid-toned. It is what gives the band mass; a
 *       zero-thickness ribbon has no side to show.
 * </ul>
 *
 * <p>Geometry: each cross-section has a signed half-width of
 * `baseWidth * cos(roll)`, so the two edges swap sides where cos(roll)
 * crosses zero and the band genuinely turns over. The roll is anchored so
 * that crossing lands on the apex of the shot. The slab is then formed by
 * duplicating the surface along a constant screen-space extrusion vector
 * and filling the walls between the two copies. Facets are painted back to
 * front -- offset copy, then walls, then the near surface -- which is enough
 * ordering for a path that only folds once.
 *
 * <p>Deliberately much more solid than the previous treatment: heavy bloom
 * made it read as light rather than as an object, and an object is the whole
 * point.
 */
function drawFlightPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  minThickness: number,
  maxThickness: number,
  frameId: number,
  alpha = 1,
  scale = 1,
) {
  // Draw the fitted arc when there is enough flight to fit one; fall back
  // to the conditioned raw path for the first few frames of a shot.
  const fit = fitBallisticArc(points, 56);
  const path = fit ? fit.points : prepareFlightPath(points, 56);
  const n = path.length;
  if (n < 3 || alpha <= 0) return;

  const head = path[n - 1];
  const beforeHead = path[n - 2];
  if (!head || !beforeHead) return;

  // Prefer the fitted parabola's analytic turning point; it is stable in a
  // way that scanning for the highest tracked point never was.
  let tApex = fit?.tApex ?? null;
  if (tApex == null && !fit) {
    let apexIdx = 0;
    for (let i = 1; i < n; i++) {
      if ((path[i]?.y ?? Infinity) < (path[apexIdx]?.y ?? Infinity)) apexIdx = i;
    }
    const candidate = apexIdx / (n - 1);
    if (n >= 14 && candidate > 0.18 && candidate < 0.88) tApex = candidate;
  }
  const apexPassed = tApex != null;
  const apexT = tApex ?? 0.5;

  const breathe = 0.08 * Math.sin(phase(frameId, 80) * Math.PI * 2);
  const SPREAD = 2.6;
  const rollAt = (t: number) =>
    apexPassed ? Math.PI / 2 + (t - apexT) * SPREAD + breathe : 0.55 + t * 0.5 + breathe;
  /** Never let the band collapse to exactly zero width at the fold. A true
   * zero pinches both edges onto the centreline, where any remaining noise
   * is magnified into a visible kink, and the two edge polygons can cross
   * through each other. Holding a minimum keeps the turn-over reading as a
   * fold while leaving the surface well formed. */
  const MIN_FACING = 0.2;
  const facingAt = (t: number) => {
    const c = Math.cos(rollAt(t));
    return Math.abs(c) < MIN_FACING ? MIN_FACING * Math.sign(c || 1) : c;
  };
  const widthAt = (t: number) => (minThickness + t * (maxThickness - minThickness)) * scale;

  // Extrusion: a constant screen-space offset. Downward reads as the slab
  // having depth under it, matching how a curved 3D arrow is normally lit.
  const extrudeX = 5 * scale;
  const extrudeY = SLAB_THICKNESS * scale;

  const surface: { lx: number; ly: number; rx: number; ry: number; facing: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = path[i];
    // Wider stencil than a single-step difference: with uniformly spaced
    // samples this averages out what noise survives conditioning, and the
    // normal stops swinging where the curve flattens.
    const prev = path[Math.max(0, i - 2)];
    const next = path[Math.min(n - 1, i + 2)];
    if (!p || !prev || !next) continue;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const t = i / (n - 1);
    const facing = facingAt(t);
    const hw = (widthAt(t) * facing) / 2;
    surface.push({
      lx: p.x + nx * hw,
      ly: p.y + ny * hw,
      rx: p.x - nx * hw,
      ry: p.y - ny * hw,
      facing,
    });
  }
  if (surface.length < 2) return;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const bottom = surface.map((s) => ({
    lx: s.lx + extrudeX,
    ly: s.ly + extrudeY,
    rx: s.rx + extrudeX,
    ry: s.ry + extrudeY,
  }));

  /** Fills one continuous strip between two edges. Drawn as a single
   * polygon rather than per-segment quads: adjacent quads each anti-alias
   * against the background instead of against each other, which leaves fine
   * seams along every join -- visible as a corduroy texture across the whole
   * band. One polygon per surface has no internal edges to seam. */
  const strip = (
    from: number,
    to: number,
    edgeA: (i: number) => { x: number; y: number },
    edgeB: (i: number) => { x: number; y: number },
    fill: string | CanvasGradient,
  ) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    const first = edgeA(from);
    ctx.moveTo(first.x, first.y);
    for (let i = from; i <= to; i++) {
      const p = edgeA(i);
      ctx.lineTo(p.x, p.y);
    }
    for (let i = to; i >= from; i--) {
      const p = edgeB(i);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  };

  // Ground shadow under the whole slab.
  ctx.globalAlpha = 0.3 * alpha;
  strip(
    0,
    surface.length - 1,
    (i) => ({ x: surface[i]!.lx + 8 * scale, y: surface[i]!.ly + 20 * scale }),
    (i) => ({ x: surface[i]!.rx + 8 * scale, y: surface[i]!.ry + 20 * scale }),
    "rgba(0,0,0,0.9)",
  );

  // Split the path into runs that show the same face, so the flip at the
  // fold lands on a polygon boundary instead of being blended across it.
  const runs: { from: number; to: number; front: boolean }[] = [];
  let runStart = 0;
  for (let i = 1; i < surface.length; i++) {
    const prevFront = (surface[i - 1]!.facing ?? 0) >= 0;
    const front = (surface[i]!.facing ?? 0) >= 0;
    if (front !== prevFront) {
      runs.push({ from: runStart, to: i, front: prevFront });
      runStart = i;
    }
  }
  runs.push({
    from: runStart,
    to: surface.length - 1,
    front: (surface[runStart]!.facing ?? 0) >= 0,
  });

  ctx.globalAlpha = alpha;
  const shade = phase(frameId, 52);

  for (const run of runs) {
    if (run.to <= run.from) continue;
    const a = surface[run.from]!;
    const b = surface[run.to]!;
    const tMid = (run.from + run.to) / 2 / (surface.length - 1);

    // 1. Underside of the slab.
    strip(
      run.from,
      run.to,
      (i) => ({ x: bottom[i]!.lx, y: bottom[i]!.ly }),
      (i) => ({ x: bottom[i]!.rx, y: bottom[i]!.ry }),
      lerpColor(warm("#2a1400"), warm("#4a2400"), 0.4 + 0.6 * tMid),
    );

    // 2. Extruded side walls, one per edge.
    const wall = lerpColor(warm("#5c2f00"), warm("#bd6200"), 0.45 + 0.55 * tMid);
    strip(
      run.from,
      run.to,
      (i) => ({ x: surface[i]!.lx, y: surface[i]!.ly }),
      (i) => ({ x: bottom[i]!.lx, y: bottom[i]!.ly }),
      wall,
    );
    strip(
      run.from,
      run.to,
      (i) => ({ x: surface[i]!.rx, y: surface[i]!.ry }),
      (i) => ({ x: bottom[i]!.rx, y: bottom[i]!.ry }),
      wall,
    );

    // 3. The face actually presented to the viewer, lit along its length
    //    with a gradient so there is variation without per-segment seams.
    const grad = ctx.createLinearGradient(a.lx, a.ly, b.rx, b.ry);
    const litAt = (t: number) => {
      const square = Math.abs(facingAt(t));
      const spec = Math.max(0, 1 - Math.abs(t - shade) / 0.18) * 0.3;
      return Math.min(1, 0.45 + 0.55 * square + spec);
    };
    const t0 = run.from / (surface.length - 1);
    const t1 = run.to / (surface.length - 1);
    if (run.front) {
      grad.addColorStop(0, lerpColor(warm("#ff9410"), warm("#ffd071"), litAt(t0)));
      grad.addColorStop(0.5, lerpColor(warm("#ff9410"), warm("#ffd071"), litAt((t0 + t1) / 2)));
      grad.addColorStop(1, lerpColor(warm("#ff9410"), warm("#ffd071"), litAt(t1)));
    } else {
      grad.addColorStop(0, lerpColor(warm("#5e2f00"), warm("#b25a00"), litAt(t0)));
      grad.addColorStop(0.5, lerpColor(warm("#5e2f00"), warm("#b25a00"), litAt((t0 + t1) / 2)));
      grad.addColorStop(1, lerpColor(warm("#5e2f00"), warm("#b25a00"), litAt(t1)));
    }
    strip(
      run.from,
      run.to,
      (i) => ({ x: surface[i]!.lx, y: surface[i]!.ly }),
      (i) => ({ x: surface[i]!.rx, y: surface[i]!.ry }),
      grad,
    );
  }

  // Crisp highlight along both boundaries of the top surface.
  ctx.globalAlpha = alpha * 0.5;
  ctx.strokeStyle = warm("#fff3d8");
  ctx.lineWidth = 2 * scale;
  for (const edge of ["l", "r"] as const) {
    ctx.beginPath();
    surface.forEach((s, i) => {
      const x = edge === "l" ? s.lx : s.rx;
      const y = edge === "l" ? s.ly : s.ry;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;

  drawSlabArrowhead(ctx, head, beforeHead, surface[surface.length - 1]!, extrudeX, extrudeY, alpha);
  ctx.restore();
}

/** The arrowhead as a wedge with the same three surfaces as the band: an
 * offset under-copy, extruded side walls, and a bright top face. A flat
 * triangle here would give the whole thing away no matter how solid the
 * band looks. */
function drawSlabArrowhead(
  ctx: CanvasRenderingContext2D,
  head: { x: number; y: number },
  beforeHead: { x: number; y: number },
  endSection: { lx: number; ly: number; rx: number; ry: number },
  extrudeX: number,
  extrudeY: number,
  alpha: number,
) {
  const dx = head.x - beforeHead.x;
  const dy = head.y - beforeHead.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;

  // The wings sit on the band's own final cross-section, splayed wider, so
  // the head grows out of the band instead of floating next to it.
  const FLARE = 1.95;
  const wingL = {
    x: head.x + (endSection.lx - head.x) * FLARE,
    y: head.y + (endSection.ly - head.y) * FLARE,
  };
  const wingR = {
    x: head.x + (endSection.rx - head.x) * FLARE,
    y: head.y + (endSection.ry - head.y) * FLARE,
  };
  const halfSpan = Math.hypot(wingL.x - wingR.x, wingL.y - wingR.y) / 2;
  const tip = { x: head.x + tx * halfSpan * 1.6, y: head.y + ty * halfSpan * 1.6 };
  const shift = (p: { x: number; y: number }) => ({ x: p.x + extrudeX, y: p.y + extrudeY });

  const tri = (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    fill: string,
    a: number,
  ) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fill();
  };

  // Under-copy first, then the two visible walls, then the lit top face.
  tri(shift(tip), shift(wingL), shift(wingR), warm("#5c2f00"), alpha);

  for (const [from, to] of [
    [tip, wingL],
    [tip, wingR],
    [wingL, wingR],
  ] as const) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = warm("#a55200");
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(to.x + extrudeX, to.y + extrudeY);
    ctx.lineTo(from.x + extrudeX, from.y + extrudeY);
    ctx.closePath();
    ctx.fill();
  }

  tri(tip, wingL, wingR, warm("#ffd992"), alpha);

  // Spine highlight down the centre of the head, the cue that it is a
  // folded plane rather than a flat cut-out.
  ctx.globalAlpha = alpha * 0.85;
  ctx.strokeStyle = warm("#ffe2a8");
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();
}

// ============================================================
// RENDERING — ports of the backend's own drawing sections, in the same
// order: video background, boxes, court skeleton, pose skeleton, trail,
// apex marker, overlay panels, floating player label.
// ============================================================

interface RenderInput {
  frame: FrameTelemetry;
  trail: { x: number; y: number }[];
  categoryStats: Record<ShotDesignation, { makes: number; misses: number }>;
  makes: number;
  misses: number;
  anim: OverlayAnimationState;
  playerTrack: { x: number; y: number; frameId: number }[];
  shotHistory: ("make" | "miss")[];
  streak: number;
  readout: PlayerReadoutState;
}

export function renderFromPersistent(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  state: OverlayPersistentState,
  viewport: OverlayViewport = AUTHORED_VIEWPORT,
  layout: OverlayPanelLayout = staticPanelLayout(viewport),
) {
  if (!state.lastFrame) return; // nothing arrived yet to draw
  render(ctx, videoEl, toRenderInput(state), viewport, layout);
}

/**
 * Draws the overlay alone onto a transparent canvas, with no video
 * underneath.
 *
 * <p>For playback of a stored recording: TelemetryOverlayCanvas lays a
 * transparent canvas over the <video> element and draws the analysis on it
 * from the stored telemetry, so the recording is never touched and the
 * overlay takes the viewer's current theme. Live sessions keep using
 * renderFromPersistent, because there the whole point is that video and
 * overlay share one canvas for captureStream to record.
 */
export function renderOverlayFromPersistent(
  ctx: CanvasRenderingContext2D,
  state: OverlayPersistentState,
  viewport: OverlayViewport = AUTHORED_VIEWPORT,
  layout: OverlayPanelLayout = staticPanelLayout(viewport),
) {
  if (!state.lastFrame) return;
  render(ctx, null, toRenderInput(state), viewport, layout);
}

/** Callers above have already established lastFrame is present. */
function toRenderInput(state: OverlayPersistentState): RenderInput {
  return {
    frame: state.lastFrame!,
    trail: state.trail,
    categoryStats: state.categoryStats,
    makes: state.makes,
    misses: state.misses,
    anim: state.anim,
    playerTrack: state.playerTrack,
    shotHistory: state.shotHistory,
    streak: state.streak,
    readout: state.readout,
  };
}

function render(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement | null,
  state: RenderInput,
  viewport: OverlayViewport,
  layout: OverlayPanelLayout,
) {
  const f = state.frame;

  if (!videoEl) {
    // Overlay-only: leave the background transparent so the canvas can
    // sit over the <video> element.
    ctx.clearRect(0, 0, viewport.width, viewport.height);
  } else if (videoEl.readyState >= 2) {
    // readyState 2 = HAVE_CURRENT_DATA: the standard check for "safe to
    // drawImage this without pulling a stale/black frame."
    ctx.drawImage(videoEl, 0, 0, viewport.width, viewport.height);
  } else {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
  }

  // Under the detection chrome so brackets and tags stay on top of it.
  drawVelocityVector(ctx, f, state.playerTrack);

  drawDetectionBoxes(ctx, f, state.readout, f.frame_id);

  drawFlightPath(
    ctx,
    state.trail,
    TRAIL_MIN_THICKNESS,
    TRAIL_MAX_THICKNESS,
    f.frame_id,
    1,
    perspectiveScale(state.readout.playerBox),
  );

  // Resolution sequence sits above the play but below the panels, so the
  // burst never washes out the numbers a viewer might be reading.
  drawGhostTrail(ctx, state.anim, f.frame_id);
  drawRimBurst(ctx, state.anim, f.frame_id, state.streak);
  drawApexMarker(ctx, f.apex_point);
  drawVerdictCallout(ctx, state.anim, f.frame_id, state.streak);
  drawResultVignette(ctx, state.anim, f.frame_id, viewport);

  drawOverlayPanels(ctx, f, state, layout);
  drawPlayerLabel(ctx, state.readout, f.frame_id, viewport);
}

/** Corner brackets instead of a closed rectangle: the tracked subject stays
 * unobscured, and the L-corner is the visual shorthand for "this is a
 * machine-vision lock" in both broadcast and HUD design. Corner length is a
 * fraction of the box so small detections don't collapse into solid
 * rectangles and large ones don't read as full boxes. */
function drawCornerBracket(
  ctx: CanvasRenderingContext2D,
  box: OverlayBox,
  color: string,
  lineWidth: number,
) {
  if (box.x1 == null || box.y1 == null || box.x2 == null || box.y2 == null) return;
  const w = box.x2 - box.x1;
  const h = box.y2 - box.y1;
  const len = Math.max(12, Math.min(w, h) * 0.24);

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "square";
  ctx.beginPath();
  // top-left
  ctx.moveTo(box.x1, box.y1 + len);
  ctx.lineTo(box.x1, box.y1);
  ctx.lineTo(box.x1 + len, box.y1);
  // top-right
  ctx.moveTo(box.x2 - len, box.y1);
  ctx.lineTo(box.x2, box.y1);
  ctx.lineTo(box.x2, box.y1 + len);
  // bottom-right
  ctx.moveTo(box.x2, box.y2 - len);
  ctx.lineTo(box.x2, box.y2);
  ctx.lineTo(box.x2 - len, box.y2);
  // bottom-left
  ctx.moveTo(box.x1 + len, box.y2);
  ctx.lineTo(box.x1, box.y2);
  ctx.lineTo(box.x1, box.y2 - len);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawDetectionBoxes(
  ctx: CanvasRenderingContext2D,
  f: FrameTelemetry,
  readout: PlayerReadoutState,
  frameId: number,
) {
  ctx.textBaseline = "alphabetic";

  if (f.ball && f.ball.x1 != null) {
    drawCornerBracket(ctx, f.ball, warm("#ff8c00"), 5);
    if (f.ball.center_x != null && f.ball.center_y != null) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.ball.center_x, f.ball.center_y, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = THEME_TEXT_PRIMARY;
      ctx.beginPath();
      ctx.arc(f.ball.center_x, f.ball.center_y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (f.ball?.predicted && f.ball.center_x != null && f.ball.center_y != null) {
    // Predicted-only position: dashed ring, so an inferred ball never reads
    // as a confirmed detection.
    ctx.strokeStyle = warm("#af5f00");
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.arc(f.ball.center_x, f.ball.center_y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Player and rim come from the held readout on the same fade as the
  // telemetry tag: holding the figures steady while the bracket underneath
  // them blinked would have looked stranger than either alone.
  // Only the player is outlined, and only with corner brackets -- no word
  // above it. The rim and net brackets were removed for being the
  // jitteriest things in frame; the rim is still tracked in the readout,
  // because the shot-resolution burst originates from it, it is just no
  // longer drawn. The "PLAYER" caption went for the same reason the boxes
  // did: it labelled something the viewer can already see.
  const box = readout.playerBox;
  const fade = readoutFade(readout.playerSeenFrame, frameId);
  if (box && box.x1 != null && box.y1 != null && fade > 0) {
    ctx.save();
    ctx.globalAlpha = fade;
    drawCornerBracket(ctx, box, warm("#ff8c00"), 5);
    ctx.restore();
  }
}

/** Apex is the single most meaningful instant in a shot's arc, so it gets a
 * proper reticle -- ring, four ticks and a centre dot -- rather than the
 * plain X it used to be, plus a tracked label so the moment is legible
 * without needing the panel for context. */
function drawApexMarker(ctx: CanvasRenderingContext2D, apexPoint: ApexPoint | null) {
  if (!apexPoint) return;

  const radius = 26;
  const tick = 14;

  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(apexPoint.x, apexPoint.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = THEME_TEXT_PRIMARY;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(apexPoint.x, apexPoint.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(apexPoint.x, apexPoint.y - radius - tick);
  ctx.lineTo(apexPoint.x, apexPoint.y - radius + 4);
  ctx.moveTo(apexPoint.x, apexPoint.y + radius - 4);
  ctx.lineTo(apexPoint.x, apexPoint.y + radius + tick);
  ctx.moveTo(apexPoint.x - radius - tick, apexPoint.y);
  ctx.lineTo(apexPoint.x - radius + 4, apexPoint.y);
  ctx.moveTo(apexPoint.x + radius - 4, apexPoint.y);
  ctx.lineTo(apexPoint.x + radius + tick, apexPoint.y);
  ctx.stroke();

  ctx.fillStyle = warm("#ff8c00");
  ctx.beginPath();
  ctx.arc(apexPoint.x, apexPoint.y, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = FONT_DISPLAY("bold ", 26);
  ctx.fillStyle = THEME_TEXT_PRIMARY;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 4;
  const labelX = apexPoint.x + radius + tick + 8;
  const labelY = apexPoint.y + 9;
  ctx.strokeText("APEX", labelX, labelY);
  fillTracked(ctx, "APEX", labelX, labelY, 4);
}

/** Letter-spaced ("tracked") uppercase micro-labels are most of what makes
 * broadcast chrome read as broadcast chrome, and ctx.letterSpacing does not
 * exist in node-canvas (verified), so spacing is applied per glyph here --
 * which is why the cache below exists. */

/** Glyph advance widths, cached per (font, glyph).
 *
 * <p>Tracked text has to measure every glyph to place the next one, and the
 * panels redraw ~250 measurements per frame -- almost all of them the same
 * handful of characters in the same few fonts, on every one of a video's
 * ~1700 frames. Advance width is a pure function of font and glyph, so it
 * is memoised. The key space is tiny (uppercase, digits and a few symbols
 * across five font strings), and this changes nothing about the output. */
const glyphWidths = new Map<string, number>();

function glyphWidth(ctx: CanvasRenderingContext2D, glyph: string) {
  const key = `${ctx.font}\u0000${glyph}`;
  const cached = glyphWidths.get(key);
  if (cached !== undefined) return cached;
  const width = ctx.measureText(glyph).width;
  glyphWidths.set(key, width);
  return width;
}

function trackedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number) {
  const glyphs = [...text];
  if (glyphs.length === 0) return 0;
  let total = 0;
  for (const glyph of glyphs) total += glyphWidth(ctx, glyph) + tracking;
  return total - tracking;
}

function fillTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "right" = "left",
) {
  const startX = align === "right" ? x - trackedWidth(ctx, text, tracking) : x;
  const previousAlign = ctx.textAlign;
  ctx.textAlign = "left";
  let cursor = startX;
  for (const glyph of [...text]) {
    ctx.fillText(glyph, cursor, y);
    cursor += glyphWidth(ctx, glyph) + tracking;
  }
  ctx.textAlign = previousAlign;
}

function hairline(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

/** Angular panel silhouette: large chamfers on the top-left and
 * bottom-right, small ones on the other two. The asymmetry is what stops a
 * clipped-corner box from reading as a plain octagon and gives the frame
 * its directional, HUD-like bias. */
function chamferPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  big: number,
  small: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + big, y);
  ctx.lineTo(x + w - small, y);
  ctx.lineTo(x + w, y + small);
  ctx.lineTo(x + w, y + h - big);
  ctx.lineTo(x + w - big, y + h);
  ctx.lineTo(x + small, y + h);
  ctx.lineTo(x, y + h - small);
  ctx.lineTo(x, y + big);
  ctx.closePath();
}

// ---- Animation easing/phase helpers -------------------------------------

/** 0..1 saw wave over `period` frames, for looping motion. */
function phase(frameId: number, period: number) {
  return (((frameId % period) + period) % period) / period;
}

/** 0..1 triangle-ish pulse, for breathing glows. */
function pulse(frameId: number, period: number) {
  return 0.5 - 0.5 * Math.cos(phase(frameId, period) * Math.PI * 2);
}

function easeOutCubic(t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** 1 immediately after an event, decaying to 0 over `frames`. Returns 0
 * when the event has not happened or is long past. */
function decay(frameId: number, since: number | null, frames: number) {
  if (since == null) return 0;
  const elapsed = frameId - since;
  if (elapsed < 0 || elapsed > frames) return 0;
  return 1 - easeOutCubic(elapsed / frames);
}

/** Fake bloom: the same path stroked a few times, widest and faintest
 * first. ctx.shadowBlur / ctx.filter would be the "correct" tools but both
 * are real per-frame costs on a 4K surface, and ctx.filter is not
 * available in every browser. */
function glowStroke(
  ctx: CanvasRenderingContext2D,
  drawPath: () => void,
  color: string,
  coreWidth: number,
  glowAlpha: number,
) {
  const passes: [number, number][] = [
    [coreWidth + 10, glowAlpha * 0.16],
    [coreWidth + 5, glowAlpha * 0.3],
    [coreWidth, 1],
  ];
  for (const [width, alpha] of passes) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    drawPath();
    ctx.stroke();
    ctx.restore();
  }
}

/** Slanted tab that carries a panel's title -- the parallelogram is the
 * single most recognisable shape in modern game HUDs. */
function skewTabPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  skew: number,
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - skew, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

/** Fine diagonal hatch, clipped to the caller's current path. Gives the
 * header a machined texture instead of a flat fill -- the detail that most
 * separates a game HUD from a plain dark rectangle. */
function hatchFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  spacing: number,
  color: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -h; i < w; i += spacing) {
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Short accent ticks sitting just off the panel's chamfered corners. */
function cornerTicks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const len = 26;
  ctx.strokeStyle = warm("#ff8c00");
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + w - len, y - 8);
  ctx.lineTo(x + w + 4, y - 8);
  ctx.moveTo(x - 4, y + h + 8);
  ctx.lineTo(x + len, y + h + 8);
  ctx.stroke();
}

function drawPanelChrome(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  /** The width the tab keeps when its title does not need more. */
  tabFloor: number,
  frameId: number,
) {
  const path = () => chamferPath(ctx, x, y, w, h, PANEL_CHAMFER, 12);

  ctx.fillStyle = PANEL_SHADOW;
  chamferPath(ctx, x + 4, y + 8, w, h, PANEL_CHAMFER, 12);
  ctx.fill();

  const body = ctx.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, PANEL_BODY_TOP);
  body.addColorStop(1, PANEL_BODY_BOTTOM);
  ctx.fillStyle = body;
  path();
  ctx.fill();

  ctx.save();
  path();
  ctx.clip();
  hatchFill(ctx, x, y, w, TAB_H + 40, 26, "rgba(255,255,255,0.022)");

  // Sweep: a soft accent band travelling down the panel on a long loop, so
  // the surface reads as live rather than static even between shots.
  const sweepY = y - 220 + phase(frameId, 420) * (h + 440);
  const sweep = ctx.createLinearGradient(0, sweepY - 200, 0, sweepY + 200);
  sweep.addColorStop(0, warmA("#ff8c00", 0));
  sweep.addColorStop(0.5, warmA("#ff8c00", 0.055));
  sweep.addColorStop(1, warmA("#ff8c00", 0));
  ctx.fillStyle = sweep;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  glowStroke(ctx, path, warm("#ff8c00"), 2, 0.85);
  cornerTicks(ctx, x, y, w, h);

  // Inner keyline, inset from the border, for a sense of panel thickness.
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 2;
  chamferPath(ctx, x + 10, y + 10, w - 20, h - 20, PANEL_CHAMFER - 8, 8);
  ctx.stroke();

  /*
   * Title tab, inset so the panel's own chamfer still reads underneath
   * it.
   *
   * <p>`tabFloor` is a floor, not the width. The tab used to be exactly
   * the number the caller passed, which held only for as long as no title
   * outgrew it -- and a title that does is clipped mid-word rather than
   * given room. Measuring the title and taking whichever is larger keeps
   * every tab that already fitted at exactly the size it was approved at,
   * and lets a longer one have what it needs.
   */
  ctx.font = FONT_DISPLAY("bold ", 38);
  const tabX = x + PANEL_CHAMFER;
  const tabW = Math.max(tabFloor, TAB_PAD * 2 + trackedWidth(ctx, title, TAB_TRACKING));
  const tab = () => skewTabPath(ctx, tabX, y, tabW, TAB_H, 26);
  const tabFill = ctx.createLinearGradient(tabX, y, tabX + tabW, y);
  tabFill.addColorStop(0, warm("#ffb249"));
  tabFill.addColorStop(1, warm("#ff8c00"));
  ctx.fillStyle = tabFill;
  tab();
  ctx.fill();
  ctx.save();
  tab();
  ctx.clip();
  hatchFill(ctx, tabX, y, tabW, TAB_H, 18, "rgba(0,0,0,0.07)");
  ctx.restore();

  ctx.font = FONT_DISPLAY("bold ", 38);
  ctx.fillStyle = CHIP_TEXT_DARK;
  ctx.textBaseline = "middle";
  fillTracked(ctx, title, tabX + TAB_PAD, y + TAB_H / 2 + 1, TAB_TRACKING);
  ctx.textBaseline = "alphabetic";

  // Bright rule running out of the tab across the rest of the header, with
  // a travelling highlight riding along it.
  const ruleX1 = tabX + tabW + 8;
  const ruleX2 = x + w - 14;
  hairline(ctx, ruleX1, ruleX2, y + TAB_H - 2, HAIRLINE_BRIGHT);
  const runnerX = ruleX1 + phase(frameId, 180) * (ruleX2 - ruleX1);
  const runner = ctx.createLinearGradient(runnerX - 90, 0, runnerX + 90, 0);
  runner.addColorStop(0, warmA("#ffb249", 0));
  runner.addColorStop(0.5, warmA("#ffb249", 0.8));
  runner.addColorStop(1, warmA("#ffb249", 0));
  ctx.strokeStyle = runner;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(Math.max(ruleX1, runnerX - 90), y + TAB_H - 2);
  ctx.lineTo(Math.min(ruleX2, runnerX + 90), y + TAB_H - 2);
  ctx.stroke();
}

/** Angular status flag with a leading notch, filled while a shot is being
 * tracked and outlined when it is showing the previous one. */
function drawStatusChip(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  centerY: number,
  text: string,
  active: boolean,
  frameId: number,
) {
  ctx.font = FONT_DISPLAY("bold ", 24);
  const tracking = 5;
  const textW = trackedWidth(ctx, text, tracking);
  const padX = 18;
  const notch = 12;
  const chipW = padX * 2 + textW + notch;
  const chipH = 44;
  const x = rightX - chipW;
  const y = centerY - chipH / 2;

  const chip = () => {
    ctx.beginPath();
    ctx.moveTo(x + notch, y);
    ctx.lineTo(x + chipW, y);
    ctx.lineTo(x + chipW - notch, y + chipH);
    ctx.lineTo(x, y + chipH);
    ctx.closePath();
  };

  if (active) {
    ctx.fillStyle = warm("#ff8c00");
    chip();
    ctx.fill();
    // Breathing bloom while a shot is actually in flight -- the one piece
    // of idle motion that tells a paused-looking HUD it is live.
    glowStroke(ctx, chip, warm("#ff8c00"), 2, 0.5 + 0.5 * pulse(frameId, 72));
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    chip();
    ctx.fill();
    ctx.strokeStyle = HAIRLINE_BRIGHT;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.textBaseline = "middle";
  ctx.fillStyle = active ? CHIP_TEXT_DARK : PANEL_TEXT_SECONDARY;
  fillTracked(ctx, text, x + padX + notch / 2, centerY + 1, tracking);
  ctx.textBaseline = "alphabetic";
}

/**
 * A category's record, drawn two different ways depending on how many shots
 * it holds.
 *
 * <p>Up to PIP_MAX attempts every shot gets its own slanted pip, which is
 * the most legible and most satisfying form early in a session -- you can
 * count the makes at a glance. Past that the pips would either shrink to
 * illegibility or overflow the column, so the row switches to a continuous
 * proportional bar: the same information, now read as a ratio rather than
 * counted. The exact numbers are always present in the adjacent count
 * column either way, so nothing is lost in the transition.
 *
 * <p>`freshness` (0..1) pops the most recent pip in, so a landed shot is
 * visible as motion rather than only as a changed number.
 */
function drawShotRecord(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  makes: number,
  misses: number,
  displayRatio: number,
  freshness: number,
) {
  const attempts = makes + misses;
  if (attempts === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(x, y + PIP_H / 2 - 2, 34, 4);
    return;
  }

  if (attempts <= PIP_MAX) {
    const skew = 7;
    for (let i = 0; i < attempts; i++) {
      const isNewest = i === attempts - 1;
      const grow = isNewest ? easeOutCubic(1 - freshness) : 1;
      const inset = (PIP_H * (1 - grow)) / 2;
      const px = x + i * (PIP_W + PIP_GAP);
      const top = y + inset;
      const bottom = y + PIP_H - inset;

      ctx.beginPath();
      ctx.moveTo(px + skew, top);
      ctx.lineTo(px + PIP_W, top);
      ctx.lineTo(px + PIP_W - skew, bottom);
      ctx.lineTo(px, bottom);
      ctx.closePath();

      if (i < makes) {
        ctx.fillStyle = warm("#ff8c00");
        ctx.fill();
        if (isNewest && freshness > 0) {
          ctx.save();
          ctx.globalAlpha = freshness;
          ctx.strokeStyle = warm("#ffb249");
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        }
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    return;
  }

  // Volume mode: proportional bar, eased so it slides as the rate moves.
  const barH = 16;
  const barY = y + (PIP_H - barH) / 2;
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(x, barY, width, barH);

  const filled = Math.max(0, Math.min(1, displayRatio)) * width;
  const fill = ctx.createLinearGradient(x, 0, x + Math.max(filled, 1), 0);
  fill.addColorStop(0, warm("#c96a00"));
  fill.addColorStop(1, warm("#ff8c00"));
  ctx.fillStyle = fill;
  ctx.fillRect(x, barY, filled, barH);

  // Bright leading edge, plus a flare on a freshly landed shot.
  ctx.fillStyle = warm("#ffb249");
  ctx.fillRect(x + filled - 3, barY - 3, 3, barH + 6);
  if (freshness > 0) {
    ctx.save();
    ctx.globalAlpha = freshness * 0.6;
    ctx.fillStyle = warm("#ffb249");
    ctx.fillRect(x, barY - 4, width, barH + 8);
    ctx.restore();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, barY, width, barH);
}

/** Segmented meter -- the shared "charge bar" idiom, used for the overall
 * field-goal rate and for each tracked shot measurement. */
function drawMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  segments: number,
) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const gap = 5;
  const segW = (w - gap * (segments - 1)) / segments;
  const filledUpTo = clamped * w;

  for (let i = 0; i < segments; i++) {
    const sx = x + i * (segW + gap);
    const lit = sx + segW * 0.5 <= x + filledUpTo;
    ctx.fillStyle = lit ? warm("#ff8c00") : "rgba(255,255,255,0.07)";
    ctx.fillRect(sx, y, segW, h);
  }

  if (clamped > 0) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = warm("#ff8c00");
    ctx.fillRect(x, y - 3, filledUpTo, h + 6);
    ctx.restore();
  }
}

/**
 * Draws both panels wherever the layout puts them.
 *
 * <p>Position and size are applied as a transform around drawing code
 * that still lays itself out from (0, 0) at its authored size. That is
 * what makes a resized panel identical to the approved one rather than a
 * re-tuned one: every column guide, hairline and type size keeps its
 * proportion, because none of them ever learns it is being scaled.
 *
 * <p>Safe to nest: the panels' own transforms (the hero numeral, the rim
 * burst) are all inside save/restore pairs and multiply into this one.
 * Nothing in this file calls setTransform, which would replace it.
 */
function drawOverlayPanels(
  ctx: CanvasRenderingContext2D,
  f: FrameTelemetry,
  state: RenderInput,
  layout: OverlayPanelLayout,
) {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  place(ctx, layout.summary, () => drawShotSummaryPanel(ctx, state));
  place(ctx, layout.tracker, () => drawShotTrackerPanel(ctx, f, state.anim));
  ctx.restore();
}

function place(ctx: CanvasRenderingContext2D, at: PanelPlacement, draw: () => void) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(at.scale, at.scale);
  draw();
  ctx.restore();
}

/**
 * Summary panel, built to stay readable from the first shot of a session to
 * the several-hundredth.
 *
 * <p>Three things do the scaling work. Every numeral is monospaced, so a
 * column's width is set by its digit count rather than its digits and
 * nothing reflows as values tick over. Each row carries an explicit
 * makes-misses count alongside its record, so the visual form never has to
 * be the sole carrier of the numbers. And the record itself switches from
 * per-shot pips to a proportional bar once a category passes PIP_MAX --
 * see drawShotRecord.
 *
 * <p>Column guides are fixed and sized for the widest value each can hold
 * (three-digit counts, "100.0%"), so no cell can grow into its neighbour.
 */
function drawShotSummaryPanel(ctx: CanvasRenderingContext2D, state: RenderInput) {
  // Local coordinates: drawOverlayPanels has already translated and
  // scaled the context to wherever this panel lives.
  const x = 0;
  const y = 0;
  const w = SUMMARY_W;
  const frameId = state.frame.frame_id;
  drawPanelChrome(ctx, x, y, w, SUMMARY_H, "FOLLOW THROUGH", 400, frameId);

  const left = x + PANEL_PAD;
  const right = x + w - PANEL_PAD;
  const recordX = left + 260;
  const recordW = 280;
  const countRight = right - 148;

  const attempts = state.makes + state.misses;
  const fgPct = attempts > 0 ? (state.makes / attempts) * 100 : 0;
  const flash = decay(frameId, state.anim.lastShotFrame, 45);

  ctx.fillStyle = PANEL_TEXT_MUTED;
  ctx.font = FONT_DISPLAY("", 24);
  fillTracked(ctx, "SHOT SUMMARY", right, y + 40, 7, "right");

  // --- hero: rate, eased, with a pop on a landed shot
  const heroScale = 1 + flash * 0.06;
  ctx.save();
  ctx.translate(left, y + 162);
  ctx.scale(heroScale, heroScale);
  ctx.fillStyle = attempts > 0 ? warm("#ff8c00") : PANEL_TEXT_MUTED;
  ctx.font = FONT_MONO("bold ", 76);
  ctx.fillText(`${fgPct.toFixed(1)}%`, 0, 0);
  ctx.restore();

  ctx.fillStyle = PANEL_TEXT_MUTED;
  ctx.font = FONT_DISPLAY("", 24);
  fillTracked(ctx, "FIELD GOAL", left, y + 196, 7);

  ctx.textAlign = "right";
  ctx.fillStyle = PANEL_TEXT_PRIMARY;
  ctx.font = FONT_MONO("bold ", 44);
  ctx.fillText(`${state.makes}/${attempts}`, right, y + 162);
  ctx.textAlign = "left";
  ctx.fillStyle = PANEL_TEXT_MUTED;
  ctx.font = FONT_DISPLAY("", 24);
  fillTracked(ctx, "MADE / ATTEMPTS", right, y + 196, 7, "right");

  drawMeter(ctx, left, y + 214, right - left, 18, state.anim.fgDisplay, 24);

  // --- category table
  const headerBaseline = y + 296;
  ctx.fillStyle = PANEL_TEXT_MUTED;
  ctx.font = FONT_DISPLAY("", 24);
  fillTracked(ctx, "CATEGORY", left, headerBaseline, 6);
  fillTracked(ctx, "RECORD", recordX, headerBaseline, 6);
  fillTracked(ctx, "M-X", countRight, headerBaseline, 6, "right");
  fillTracked(ctx, "FG%", right, headerBaseline, 6, "right");
  hairline(ctx, left, right, headerBaseline + 18, HAIRLINE);

  let rowCenter = y + 346;
  const rowSpacing = 54;

  for (const cat of CATEGORY_ORDER) {
    const stats = state.categoryStats[cat];
    const rowAttempts = stats.makes + stats.misses;
    const live = rowAttempts > 0;
    // Only the category the shot actually belonged to flashes.
    const rowFlash = state.anim.lastShotDesignation === cat ? flash : 0;

    if (rowFlash > 0) {
      ctx.save();
      ctx.globalAlpha = rowFlash * 0.16;
      ctx.fillStyle = warm("#ff8c00");
      ctx.fillRect(x + 12, rowCenter - rowSpacing / 2, w - 24, rowSpacing);
      ctx.restore();
    }

    ctx.textBaseline = "middle";
    ctx.fillStyle = live ? PANEL_TEXT_PRIMARY : PANEL_TEXT_MUTED;
    ctx.font = FONT_DISPLAY(live ? "bold " : "", 34);
    fillTracked(ctx, CATEGORY_LABELS[cat], left, rowCenter, 2);

    drawShotRecord(
      ctx,
      recordX,
      rowCenter - PIP_H / 2,
      recordW,
      stats.makes,
      stats.misses,
      state.anim.categoryDisplay[cat],
      rowFlash,
    );

    ctx.textAlign = "right";
    ctx.font = FONT_MONO("", 26);
    ctx.fillStyle = live ? PANEL_TEXT_SECONDARY : PANEL_TEXT_MUTED;
    ctx.fillText(live ? `${stats.makes}-${stats.misses}` : "-", countRight, rowCenter);

    ctx.font = FONT_MONO("bold ", 30);
    ctx.fillStyle = live ? PANEL_TEXT_PRIMARY : PANEL_TEXT_MUTED;
    ctx.fillText(
      live ? `${((stats.makes / rowAttempts) * 100).toFixed(1)}%` : "--",
      right,
      rowCenter,
    );
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    rowCenter += rowSpacing;
  }

  drawRecentForm(ctx, left, right, y + SUMMARY_H - 62, state, frameId);
}

/**
 * Recent form: the last shots in order, newest on the right, plus a streak
 * flag once three consecutive makes land. The category table answers "how
 * has the whole session gone"; this answers "how is it going right now",
 * which is the question a shooter actually has mid-session and which a
 * cumulative percentage is slow to reflect.
 */
function drawRecentForm(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  centerY: number,
  state: RenderInput,
  frameId: number,
) {
  hairline(ctx, left, right, centerY - 42, HAIRLINE);

  ctx.fillStyle = PANEL_TEXT_MUTED;
  ctx.font = FONT_DISPLAY("", 22);
  fillTracked(ctx, "RECENT", left, centerY - 14, 6);

  const dotR = 11;
  const gap = 30;
  const history = state.shotHistory;
  const flash = decay(frameId, state.anim.lastShotFrame, 40);

  for (let i = 0; i < history.length; i++) {
    const cx = left + 4 + dotR + i * gap;
    const made = history[i] === "make";
    const isNewest = i === history.length - 1;
    const grow = isNewest ? 1 + flash * 0.5 : 1;

    ctx.beginPath();
    ctx.arc(cx, centerY + 24, dotR * grow, 0, Math.PI * 2);
    if (made) {
      ctx.fillStyle = warm("#ff8c00");
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  if (history.length === 0) {
    ctx.fillStyle = PANEL_TEXT_MUTED;
    ctx.font = FONT_DISPLAY("", 26);
    fillTracked(ctx, "AWAITING FIRST SHOT", left + 4, centerY + 34, 4);
    return;
  }

  if (state.streak >= 3) {
    const label = `${state.streak} IN A ROW`;
    ctx.font = FONT_DISPLAY("bold ", 28);
    const textW = trackedWidth(ctx, label, 6);
    const padX = 20;
    const chipW = textW + padX * 2 + 14;
    const chipH = 46;
    const chipX = right - chipW;
    const chipY = centerY + 24 - chipH / 2;
    const chip = () => {
      ctx.beginPath();
      ctx.moveTo(chipX + 14, chipY);
      ctx.lineTo(chipX + chipW, chipY);
      ctx.lineTo(chipX + chipW - 14, chipY + chipH);
      ctx.lineTo(chipX, chipY + chipH);
      ctx.closePath();
    };
    ctx.fillStyle = warm("#ff8c00");
    chip();
    ctx.fill();
    // Streak is the one thing worth an unprompted pulse -- it is the only
    // state the overlay reports that the shooter would want to notice
    // without looking for it.
    glowStroke(ctx, chip, warm("#ffb249"), 2, 0.4 + 0.6 * pulse(frameId, 54));

    ctx.fillStyle = CHIP_TEXT_DARK;
    ctx.textBaseline = "middle";
    fillTracked(ctx, label, chipX + padX + 7, centerY + 25, 6);
    ctx.textBaseline = "alphabetic";
  }
}

/**
 * Tracker panel. Beyond the per-shot measurements it carries the two pieces
 * of motion that make the HUD feel live: the status chip breathes while a
 * shot is in flight, and a verdict banner flares in when one resolves.
 */
function drawShotTrackerPanel(
  ctx: CanvasRenderingContext2D,
  f: FrameTelemetry,
  anim: OverlayAnimationState,
) {
  // Local coordinates -- see drawShotSummaryPanel.
  const x = 0;
  const y = 0;
  const w = TRACKER_W;
  const frameId = f.frame_id;
  drawPanelChrome(ctx, x, y, w, TRACKER_H, "SHOT TRACKER", 400, frameId);

  const left = x + PANEL_PAD;
  const right = x + w - PANEL_PAD;

  drawStatusChip(
    ctx,
    right,
    y + TAB_H + 44,
    f.shot_started ? "TRACKING" : "LAST SHOT",
    Boolean(f.shot_started),
    frameId,
  );

  ctx.fillStyle = PANEL_TEXT_MUTED;
  ctx.font = FONT_DISPLAY("", 22);
  fillTracked(ctx, "DESIGNATION", left, y + 96, 6);

  // Designation wipes in from the left over the first ~0.4s of a shot.
  const reveal = f.shot_started
    ? easeOutCubic((frameId - (anim.shotStartFrame ?? frameId)) / 24)
    : 1;
  const designation = f.shot_designation ? CATEGORY_LABELS[f.shot_designation] : "--";
  ctx.save();
  ctx.globalAlpha = 0.25 + 0.75 * reveal;
  ctx.fillStyle = f.shot_designation ? warm("#ff8c00") : PANEL_TEXT_MUTED;
  ctx.font = FONT_DISPLAY("bold ", 62);
  fillTracked(ctx, designation, left + (1 - reveal) * -24, y + 158, 3);
  ctx.restore();

  hairline(ctx, left, right, y + 186, HAIRLINE);

  const metrics: [string, string, number][] = [
    [
      "TIME TO APEX",
      f.time_to_apex != null ? `${f.time_to_apex.toFixed(2)} s` : "--",
      f.time_to_apex != null ? f.time_to_apex / 1.2 : 0,
    ],
    [
      "SHOT DURATION",
      f.shot_duration != null ? `${f.shot_duration.toFixed(2)} s` : "--",
      f.shot_duration != null ? f.shot_duration / 2.5 : 0,
    ],
    [
      // Latched once per shot rather than recomputed every frame, so the
      // decimals are stable to read and worth keeping -- unlike the
      // continuously-updating player readout, where the last digit churned.
      "DISTANCE",
      f.shot_distance_ft != null ? `${f.shot_distance_ft.toFixed(2)} ft` : "--",
      f.shot_distance_ft != null ? f.shot_distance_ft / 30 : 0,
    ],
  ];

  let baseline = y + 246;
  for (const [label, value, ratio] of metrics) {
    const hasValue = value !== "--";

    ctx.fillStyle = PANEL_TEXT_SECONDARY;
    ctx.font = FONT_DISPLAY("", 24);
    fillTracked(ctx, label, left, baseline, 6);

    ctx.textAlign = "right";
    ctx.fillStyle = hasValue ? PANEL_TEXT_PRIMARY : PANEL_TEXT_MUTED;
    ctx.font = FONT_MONO("bold ", 40);
    ctx.fillText(value, right, baseline);
    ctx.textAlign = "left";

    drawMeter(ctx, left, baseline + 18, right - left, 6, hasValue ? ratio : 0, 30);

    baseline += 96;
  }

  drawVerdictBanner(ctx, x, y, w, anim, frameId);
}

/** Verdict flare: fills the panel's lower edge for about three quarters of
 * a second when a shot resolves, so a make or miss registers as an event
 * rather than as a silently incremented counter. */
function drawVerdictBanner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  anim: OverlayAnimationState,
  frameId: number,
) {
  const life = decay(frameId, anim.lastShotFrame, 48);
  if (life <= 0 || !anim.lastShotResult) return;

  const made = anim.lastShotResult === "make";
  const bandH = 72;
  const bandY = y + TRACKER_H - bandH - 12;
  const color = made ? warm("#ff8c00") : PANEL_TEXT_SECONDARY;

  ctx.save();
  ctx.globalAlpha = life;

  const wash = ctx.createLinearGradient(x, 0, x + w, 0);
  wash.addColorStop(0, made ? warmA("#ff8c00", 0.3) : "rgba(154,164,178,0.20)");
  wash.addColorStop(1, warmA("#ff8c00", 0));
  ctx.fillStyle = wash;
  ctx.fillRect(x + 12, bandY, w - 24, bandH);

  ctx.fillStyle = color;
  ctx.fillRect(x + 12, bandY, 6, bandH);

  ctx.font = FONT_DISPLAY("bold ", 46);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  fillTracked(ctx, made ? "MAKE" : "MISS", x + 36, bandY + bandH / 2, 10);
  ctx.textBaseline = "alphabetic";

  ctx.restore();
}

// ============================================================
// SHOT RESOLUTION SEQUENCE
//
// Everything a made or missed shot triggers, all of it derived from
// (frame_id - lastShotFrame) so the sequence plays at the video's own pace
// in both the live and offline paths. A make and a miss deliberately get
// different vocabularies rather than the same effect in two colours: a make
// is radial and energetic (burst, shockwave, rising score, relit arc), a
// miss is a single soft contraction inward. The asymmetry is what makes the
// result readable from across a room without reading a word of it.
// ============================================================

const MAKE_BURST_FRAMES = 50;
const SHOCKWAVE_FRAMES = 46;
const VERDICT_FRAMES = 58;
const VIGNETTE_FRAMES = 40;
const GHOST_TRAIL_FRAMES = 64;
const BURST_PARTICLES = 30;

/** Deterministic pseudo-random in 0..1. Particle directions have to be
 * identical every time a given frame is drawn -- playback redraws a frame
 * whenever the panels move or the theme changes, and the live path
 * re-renders on every message -- so a stateful RNG would make the burst
 * jitter. */
function hash01(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Relights the ball's flight path on a make, through the same renderer the
 * live arc uses so it is visibly the same object rather than a lookalike --
 * it simply keeps marching and blooming for a beat after the ball has gone,
 * then fades. The arc the shot actually travelled is the most expressive
 * thing on screen at that moment and is otherwise discarded the instant the
 * shot ends.
 */
function drawGhostTrail(
  ctx: CanvasRenderingContext2D,
  anim: OverlayAnimationState,
  frameId: number,
) {
  if (anim.lastShotResult !== "make" || anim.lastShotTrail.length < 3) return;
  const life = decay(frameId, anim.lastShotFrame, GHOST_TRAIL_FRAMES);
  if (life <= 0) return;

  // Slightly heavier than the live arc, so the replay reads as a flare-up
  // of the same path rather than a repeat of it.
  drawFlightPath(
    ctx,
    anim.lastShotTrail,
    TRAIL_MIN_THICKNESS,
    TRAIL_MAX_THICKNESS + 8,
    frameId,
    life,
    anim.lastShotScale,
  );
}

/**
 * The burst at the rim. Rings expand and thin out; on a make they are
 * joined by a particle spray whose count and reach scale with the current
 * streak, so a hot streak visibly escalates rather than every make looking
 * identical. A miss gets a single ring that contracts inward instead --
 * same location, opposite gesture.
 */
function drawRimBurst(
  ctx: CanvasRenderingContext2D,
  anim: OverlayAnimationState,
  frameId: number,
  streak: number,
) {
  const rim = anim.lastShotRim;
  if (!rim || !anim.lastShotResult) return;

  const made = anim.lastShotResult === "make";
  const life = decay(frameId, anim.lastShotFrame, made ? MAKE_BURST_FRAMES : SHOCKWAVE_FRAMES);
  if (life <= 0) return;
  const t = 1 - life;

  ctx.save();

  if (made) {
    // Expanding shockwave rings, staggered so they read as a pulse.
    for (let ring = 0; ring < 3; ring++) {
      const offset = ring * 0.14;
      const rt = (t - offset) / (1 - offset);
      if (rt <= 0 || rt >= 1) continue;
      const radius = 60 + easeOutCubic(rt) * (360 + streak * 24);
      ctx.globalAlpha = (1 - rt) * 0.8;
      ctx.strokeStyle = ring === 0 ? warm("#fff3d6") : warm("#ff8c00");
      ctx.lineWidth = 14 * (1 - rt) + 2;
      ctx.beginPath();
      ctx.arc(rim.x, rim.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Particle spray. Deterministic per index, with a little gravity so it
    // arcs instead of expanding as a flat disc.
    const count = Math.min(BURST_PARTICLES + streak * 4, 56);
    for (let i = 0; i < count; i++) {
      const angle = hash01(i) * Math.PI * 2;
      const reach = 220 + hash01(i + 101) * (300 + streak * 30);
      const size = 5 + hash01(i + 211) * 11;
      const travel = easeOutCubic(t);
      const px = rim.x + Math.cos(angle) * reach * travel;
      const py = rim.y + Math.sin(angle) * reach * travel + 280 * t * t;
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.95;
      ctx.fillStyle = hash01(i + 307) > 0.45 ? warm("#ff8c00") : warm("#fff3d6");
      ctx.beginPath();
      ctx.arc(px, py, size * (1 - t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    // Rim flare.
    ctx.globalAlpha = life * 0.9;
    const flare = ctx.createRadialGradient(rim.x, rim.y, 0, rim.x, rim.y, 200);
    flare.addColorStop(0, warmA("#fff3d6", 0.65));
    flare.addColorStop(1, warmA("#ff8c00", 0));
    ctx.fillStyle = flare;
    ctx.beginPath();
    ctx.arc(rim.x, rim.y, 200, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Miss: one ring collapsing inward, cool and quiet.
    const radius = 300 * (1 - easeOutCubic(t)) + 40;
    ctx.globalAlpha = life * 0.7;
    ctx.strokeStyle = PANEL_TEXT_SECONDARY;
    ctx.lineWidth = 6 * life + 2;
    ctx.beginPath();
    ctx.arc(rim.x, rim.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Verdict callout at the rim: the word plus, on a make, a rising score
 * counter. Scales in quickly and drifts upward as it fades, so it reads as
 * a reaction to the shot rather than a label that happens to be there.
 */
function drawVerdictCallout(
  ctx: CanvasRenderingContext2D,
  anim: OverlayAnimationState,
  frameId: number,
  streak: number,
) {
  const rim = anim.lastShotRim;
  if (!rim || !anim.lastShotResult) return;
  const life = decay(frameId, anim.lastShotFrame, VERDICT_FRAMES);
  if (life <= 0) return;

  const made = anim.lastShotResult === "make";
  const t = 1 - life;
  const pop = easeOutCubic(Math.min(1, t / 0.22));
  const rise = easeOutCubic(t) * 120;
  const scale = 0.7 + pop * 0.3;
  const alpha = t > 0.7 ? (1 - t) / 0.3 : 1;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(rim.x, rim.y - 190 - rise);
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const word = made ? (streak >= 3 ? "ON FIRE" : "MAKE") : "MISS";
  ctx.font = FONT_DISPLAY("bold ", 92);
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(word, 0, 0);
  ctx.fillStyle = made ? warm("#fff3d6") : PANEL_TEXT_SECONDARY;
  ctx.fillText(word, 0, 0);

  if (made) {
    ctx.font = FONT_MONO("bold ", 54);
    ctx.strokeText("+1", 0, 86);
    ctx.fillStyle = warm("#ff8c00");
    ctx.fillText("+1", 0, 86);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

/** Full-frame edge wash on a resolution -- warm for a make, cool and much
 * fainter for a miss. Keeps the centre of the frame clear so it colours the
 * moment without obscuring the play. */
function drawResultVignette(
  ctx: CanvasRenderingContext2D,
  anim: OverlayAnimationState,
  frameId: number,
  viewport: OverlayViewport,
) {
  if (!anim.lastShotResult) return;
  const life = decay(frameId, anim.lastShotFrame, VIGNETTE_FRAMES);
  if (life <= 0) return;

  const made = anim.lastShotResult === "make";
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  // Sized off the short edge so the wash keeps its shape when the surface
  // is portrait, rather than becoming a thin band across the middle.
  const short = Math.min(viewport.width, viewport.height);
  const long = Math.max(viewport.width, viewport.height);
  const wash = ctx.createRadialGradient(cx, cy, short * 0.34, cx, cy, long * 0.62);
  wash.addColorStop(0, "rgba(0,0,0,0)");
  wash.addColorStop(1, made ? warmA("#ff8c00", 0.42) : "rgba(150,163,178,0.26)");

  ctx.save();
  ctx.globalAlpha = life;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  ctx.restore();
}

/** Blend two #rrggbb colours. Used to make speed readouts run hotter as the
 * player moves faster, so the colour carries the magnitude too. */
function lerpColor(from: string, to: string, t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  const channel = (hex: string, index: number) =>
    parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mix = (index: number) => {
    const a = channel(from, index);
    const b = channel(to, index);
    return Math.round(a + (b - a) * clamped);
  };
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

const SPEED_MAX_MPH = 15;

/** Continuously-updating estimates are shown as tilde-prefixed whole
 * numbers. The decimal place they used to carry was below the real
 * precision of the estimate and changed almost every frame, so it read as
 * flicker rather than as detail; the tilde is the honest way to drop it.
 * Values latched once per shot (see the tracker panel) keep their decimals,
 * because those do not churn. */
function approx(value: number) {
  return `~${Math.round(value)}`;
}

/** 1 while a detection is current, easing to 0 across the frames after it
 * was last seen, so a lost player fades out instead of popping. */
function readoutFade(seenFrame: number | null, frameId: number) {
  if (seenFrame == null) return 0;
  const gap = frameId - seenFrame;
  if (gap <= 0) return 1;
  if (gap >= READOUT_HOLD_FRAMES) return 0;
  // Hold fully bright for the first half of the window, then fade.
  const half = READOUT_HOLD_FRAMES / 2;
  return gap <= half ? 1 : 1 - (gap - half) / half;
}

/**
 * Motion vector: a tapered streak from the player's feet pointing where
 * they are actually travelling, scaled by speed. Speed was previously a
 * bare number with no visual weight at all -- this gives it direction and
 * magnitude in the scene.
 *
 * <p>Heading comes from the recent foot-position track because the
 * telemetry schema carries speed but not bearing. Gated below walking pace
 * so a stationary shooter does not get a jittering arrow driven by
 * detection noise.
 */
function drawVelocityVector(
  ctx: CanvasRenderingContext2D,
  f: FrameTelemetry,
  track: { x: number; y: number; frameId: number }[],
) {
  const speed = f.player_speed_mph;
  if (speed == null || speed < 1.5 || track.length < 4) return;
  const head = track[track.length - 1];
  const tail = track[0];
  if (!head || !tail) return;
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const travelled = Math.hypot(dx, dy);
  if (travelled < 12) return;

  const ux = dx / travelled;
  const uy = dy / travelled;
  const nx = -uy;
  const ny = ux;
  const intensity = Math.min(1, speed / SPEED_MAX_MPH);
  const length = 70 + intensity * 190;
  const halfWidth = 16 + intensity * 12;

  const tipX = head.x + ux * length;
  const tipY = head.y + uy * length;

  const fade = ctx.createLinearGradient(head.x, head.y, tipX, tipY);
  fade.addColorStop(0, warmA("#ff8c00", 0.05));
  fade.addColorStop(1, lerpColor(warm("#ff8c00"), warm("#ffd9a0"), intensity));

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = fade;
  ctx.beginPath();
  ctx.moveTo(head.x + nx * halfWidth, head.y + ny * halfWidth);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(head.x - nx * halfWidth, head.y - ny * halfWidth);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Player telemetry tag, pinned above the player's bounding box.
 *
 * <p>It stays above rather than flipping below when space is tight: the
 * flip made it jump between two positions as the player moved up and down
 * the frame, which was more distracting than the clipping it avoided. It
 * clamps to the top of the frame instead.
 *
 * <p>Both figures are drawn from the held, eased readout, so a one-frame
 * detection drop neither blanks the tag nor makes it jitter.
 */
function drawPlayerLabel(
  ctx: CanvasRenderingContext2D,
  readout: PlayerReadoutState,
  frameId: number,
  viewport: OverlayViewport,
) {
  const fade = readoutFade(readout.playerSeenFrame, frameId);
  if (fade <= 0) return;
  if (readout.anchorX == null || readout.anchorY == null) return;
  if (readout.displayDistanceFt == null) return;

  const isProjected = readout.projected;
  const speed = readout.displaySpeedMph;
  const hasSpeed = speed != null;
  const intensity = hasSpeed ? Math.min(1, speed / SPEED_MAX_MPH) : 0;

  const distText = approx(readout.displayDistanceFt);
  const speedText = hasSpeed ? approx(speed) : "--";

  const chipW = 430;
  const chipH = hasSpeed ? 138 : 96;
  let chipX = readout.anchorX - chipW / 2;
  chipX = Math.max(12, Math.min(chipX, viewport.width - chipW - 12));
  const chipY = Math.max(12, readout.anchorY - chipH - 20);

  ctx.save();
  ctx.globalAlpha = fade;

  ctx.fillStyle = PANEL_SHADOW;
  chamferPath(ctx, chipX + 3, chipY + 6, chipW, chipH, 18, 8);
  ctx.fill();

  const body = ctx.createLinearGradient(0, chipY, 0, chipY + chipH);
  body.addColorStop(0, PANEL_BODY_TOP);
  body.addColorStop(1, PANEL_BODY_BOTTOM);
  ctx.fillStyle = body;
  chamferPath(ctx, chipX, chipY, chipW, chipH, 18, 8);
  ctx.fill();

  ctx.strokeStyle = isProjected ? "rgba(255,255,255,0.16)" : warmA("#ff8c00", 0.55);
  ctx.lineWidth = 2;
  chamferPath(ctx, chipX, chipY, chipW, chipH, 18, 8);
  ctx.stroke();

  const padX = 24;
  const colLeft = chipX + padX;
  const colRight = chipX + chipW - padX;
  const divideX = chipX + chipW / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(divideX, chipY + 16);
  ctx.lineTo(divideX, chipY + (hasSpeed ? 80 : chipH - 16));
  ctx.stroke();

  ctx.fillStyle = PANEL_TEXT_MUTED;
  ctx.font = FONT_DISPLAY("", 20);
  fillTracked(ctx, "DISTANCE", colLeft, chipY + 34, 6);
  if (hasSpeed) fillTracked(ctx, "SPEED", divideX + padX, chipY + 34, 6);

  ctx.font = FONT_MONO("bold ", 40);
  ctx.fillStyle = isProjected ? PANEL_TEXT_SECONDARY : PANEL_TEXT_PRIMARY;
  ctx.fillText(distText, colLeft, chipY + 76);
  ctx.font = FONT_DISPLAY("", 22);
  ctx.fillStyle = PANEL_TEXT_MUTED;
  ctx.fillText("ft", colLeft + ctx.measureText(distText).width + 58, chipY + 76);

  if (hasSpeed) {
    ctx.font = FONT_MONO("bold ", 40);
    ctx.fillStyle = isProjected
      ? warm("#af5f00")
      : lerpColor(warm("#ff8c00"), warm("#ffe0b0"), intensity);
    ctx.fillText(speedText, divideX + padX, chipY + 76);
    ctx.font = FONT_DISPLAY("", 22);
    ctx.fillStyle = PANEL_TEXT_MUTED;
    ctx.fillText("mph", divideX + padX + ctx.measureText(speedText).width + 58, chipY + 76);

    drawMeter(ctx, colLeft, chipY + 102, colRight - colLeft, 10, isProjected ? 0 : intensity, 20);
  }

  ctx.restore();
}
