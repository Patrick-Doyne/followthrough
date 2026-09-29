/**
 * Domain models. These mirror the payloads the Spring Boot REST API returns
 * (see the DTOs under springboot/src/main/java/com/followthrough/api/dto).
 * Shot-level records are not stored by the backend at all: a `Shot` here is
 * derived on the client from a processed video's telemetry stream (see
 * `lib/telemetry-shots.ts`) or from the live DataChannel (`lib/live-shot.ts`).
 */

export type ShotResult = "MAKE" | "MISS";

/**
 * The pipeline's shot classifications, derived from shot distance (feet):
 * LAY_UP < 5 · CLS_RNG 5–10 · MID_RNG 10–19.9 · HS_3PT 19.9–22 ·
 * NCAA_3PT 22–23 · NBA_3PT >= 23
 */
export type ShotType = "LAY_UP" | "CLS_RNG" | "MID_RNG" | "HS_3PT" | "NCAA_3PT" | "NBA_3PT";

export type CourtZone =
  | "PAINT"
  | "MID_RANGE_LEFT"
  | "MID_RANGE_CENTER"
  | "MID_RANGE_RIGHT"
  | "CORNER_LEFT"
  | "CORNER_RIGHT"
  | "WING_LEFT"
  | "WING_RIGHT"
  | "TOP_OF_KEY"
  | "FREE_THROW_LINE";

export type ProcessingStatus = "QUEUED" | "PROCESSING" | "COMPLETE" | "FAILED";

/** A position on the half-court diagram, in metres -- see
 * `services/court-geometry.ts` for the three coordinate spaces. */
export interface CourtLocation {
  /** metres from the left baseline corner along the baseline */
  x: number;
  /** metres from the baseline towards half court */
  y: number;
}

/**
 * The five validated FollowThrough telemetry fields. The pipeline may add
 * more later; extend this interface rather than fabricating derived metrics.
 */
export interface ShotTelemetry {
  shotId: string;
  sessionId: string;
  timestamp: string;
  result: ShotResult;
  shotType: ShotType;
  /** feet from the rim */
  shotDistance: number;
  /** seconds from release to rim */
  shotDuration: number;
  /** seconds from release to the apex of the flight path */
  timeToApex: number;
}

export interface Shot extends ShotTelemetry {
  shotNumber: number;
  /**
   * Which part of the floor the shot came from.
   *
   * <p>Optional because it is classified from the release position,
   * and a shot the pipeline could not place has none. Inferring a
   * zone from distance alone would invent a direction -- the same
   * mistake as parking an unplaced shot at the rim.
   */
  zone?: CourtZone;
  /**
   * Where the shot was taken, in court space.
   *
   * <p>Optional because the pipeline cannot always tell: the court may not
   * have calibrated yet, or the shooter may not have been detected at
   * release. Consumers must skip a shot without one rather than
   * substituting a default — substituting the rim is what previously
   * stacked every live shot on a single spot.
   */
  location?: CourtLocation;
  videoId?: string;
  /** offset in seconds into the session video */
  videoOffset?: number;
  /** forward-compatible bag for telemetry fields added by the pipeline later */
  extra?: Record<string, number | string | boolean>;
}

export interface TrainingSession {
  sessionId: string;
  name: string;
  date: string;
  durationMinutes: number;
  shots: number;
  makes: number;
  shootingPercentage: number;
  avgShotDistance: number;
  avgShotDuration: number;
  avgTimeToApex: number;
  status: ProcessingStatus;
  location: string;
  trainingType: TrainingType;
}

/** What POST/PUT /sessions expects -- shots/makes/status/the averages are
 * pipeline-computed, never hand-entered, so they aren't part of this input
 * (a fresh session always starts zeroed with status QUEUED). */
export interface TrainingSessionInput {
  name: string;
  date: string;
  durationMinutes: number;
  location: string;
  trainingType: TrainingType;
}

/** What PUT /videos/{id} expects -- just the human-editable fields, not
 * the pipeline-computed ones (status, storageKey, analyzedShots, etc). */
export interface VideoAssetUpdateInput {
  title: string;
  thumbnailUrl?: string;
}

/** What POST /sessions/{sessionId}/videos/process expects, once a
 * pre-recorded file has already been PUT to the URL from
 * videosService.getUploadUrl -- unlike VideoIngestInput, no shot stats are
 * supplied here (offline processing is what computes those), but
 * durationSeconds/sizeMb aren't guessed either -- the browser reads them
 * straight off the picked File. */
export interface VideoProcessingInput {
  title: string;
  date: string;
  storageKey: string;
  durationSeconds: number;
  sizeMb: number;
}

export interface AnalyticsSummary {
  totalSessions: number;
  totalShots: number;
  totalMakes: number;
  shootingPercentage: number;
  avgShotDistance: number;
  avgShotDuration: number;
  avgTimeToApex: number;
  totalTrainingMinutes: number;
  deltas: {
    shootingPercentage: number;
    totalShots: number;
    avgShotDistance: number;
    avgShotDuration: number;
  };
}

export interface SeriesPoint {
  sessionId: string;
  label: string;
  date: string;
  shootingPercentage: number;
  shots: number;
  makes: number;
  avgShotDistance: number;
  avgShotDuration: number;
  avgTimeToApex: number;
}

export interface VideoAsset {
  videoId: string;
  sessionId: string;
  title: string;
  date: string;
  durationSeconds: number;
  status: ProcessingStatus;
  analyzedShots: number;
  shootingPercentage: number;
  thumbnailUrl: string;
  /** Raw storage key, never a playable URL directly — fetch
   * videosService.getPlaybackUrl(videoId) for one right before playback. */
  storageKey: string;
  sizeMb: number;
}

export type TrainingType = "SHOOTING" | "CONDITIONING" | "SKILLS" | "SCRIMMAGE" | "RECOVERY";

export type CalendarEventStatus = "COMPLETED" | "UPCOMING" | "MISSED" | "IN_PROGRESS";

export interface CalendarEvent {
  eventId: string;
  title: string;
  date: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  location: string;
  notes?: string;
  trainingType: TrainingType;
  goals?: string;
  status: CalendarEventStatus;
  sessionId?: string;
}

export type CalendarEventInput = Omit<CalendarEvent, "eventId" | "status"> & {
  status?: CalendarEventStatus;
};

export type SubscriptionTier = "FREE" | "BASIC" | "PREMIUM";

export interface UserProfile {
  userId: string;
  name: string;
  email: string;
  position: string;
  team: string;
  avatarInitials: string;
  tier: SubscriptionTier;
  usage: {
    videosProcessed: number;
    videoLimit: number;
    storageUsedGb: number;
    storageLimitGb: number;
    liveMinutesUsed: number;
    liveMinutesLimit: number;
  };
  preferences: {
    defaultSessionDuration: number;
    preferredTrainingTypes: TrainingType[];
    units: "METRIC" | "IMPERIAL";
    defaultMetric: MetricKey;
    defaultChartType: "LINE" | "BAR" | "SCATTER";
    showTrendlines: boolean;
    denseTables: boolean;
    notifications: {
      trainingReminders: boolean;
      sessionCompletion: boolean;
      weeklyDigest: boolean;
      missedSession: boolean;
    };
    /**
     * The usability settings document (see state/settings.ts), stored as
     * the JSON string the client wrote.
     *
     * <p>Opaque to the server on purpose. The client already owns the
     * schema, its version and its migrations, so mirroring ~30 fields into
     * columns would duplicate all of that and make every new setting a
     * backend change, a DTO change and a migration. Absent for an account
     * that has never saved any.
     */
    usabilitySettings?: string | null;
  };
}

export type MetricKey =
  | "shootingPercentage"
  | "shotDistance"
  | "shotDuration"
  | "timeToApex"
  | "shotVolume"
  | "makes"
  | "misses";

/**
 * The stored telemetry for a processed video, as
 * `GET /videos/{videoId}/telemetry` returns it.
 *
 * <p>`messages` is the ordered frame/shot_event stream the detection
 * pipeline produced, in the same schema the live DataChannel carries, so
 * replay can reuse everything that reads live telemetry.
 */
export interface VideoTelemetryResponse {
  fps: number;
  messages: unknown[];
}
