/**
 * FollowThrough API service layer.
 *
 * Maps 1:1 onto the Spring Boot REST contract (the controllers under
 * springboot/src/main/java/com/followthrough/api/controller). UI components
 * never call fetch directly — they use these functions, usually via the
 * query options in src/services/queries.ts.
 *
 * There is no shot-level endpoint: the backend stores per-video telemetry
 * streams and session-level aggregates, and the client derives individual
 * shots from the stream (see lib/telemetry-shots.ts).
 */

import { getAuthToken, request } from "./http";
import type {
  AuthResponse,
  PageResponse,
  PlaybackUrlResponse,
  UploadUrlResponse,
  VideoIngestInput,
} from "@/types/api";
import type {
  AnalyticsSummary,
  CalendarEvent,
  CalendarEventInput,
  SeriesPoint,
  TrainingSession,
  TrainingSessionInput,
  UserProfile,
  VideoAsset,
  VideoAssetUpdateInput,
  VideoProcessingInput,
  VideoTelemetryResponse,
} from "@/types/telemetry";

export const sessionsService = {
  /** Every session, newest first. Deliberately not paginated: the
   * analytics session picker and the dashboard need the whole list. */
  list: () => request<TrainingSession[]>("/sessions"),

  get: (sessionId: string) => request<TrainingSession>(`/sessions/${sessionId}`),

  /** A fresh session always starts zeroed with status QUEUED -- real
   * numbers only ever come from live telemetry or offline video
   * processing, never from this call directly. */
  create: (input: TrainingSessionInput) =>
    request<TrainingSession>("/sessions", { method: "POST", body: input }),

  /** Only touches the editable fields TrainingSessionInput carries --
   * shots/makes/the averages are left exactly as the pipeline last set
   * them (see TrainingSessionService.update on the backend). */
  update: (sessionId: string, input: TrainingSessionInput) =>
    request<TrainingSession>(`/sessions/${sessionId}`, { method: "PUT", body: input }),

  /** A session's videos are removed with it; any calendar event linked to
   * it just loses that link. */
  remove: (sessionId: string) => request<void>(`/sessions/${sessionId}`, { method: "DELETE" }),

  videos: (sessionId: string) => request<VideoAsset[]>(`/sessions/${sessionId}/videos`),

  /** Called once a live session's recording has finished uploading (see
   * videosService.getUploadUrl/uploadRecording) — attaches it to this
   * session's video list with the stats the live pipeline already
   * produced, so nothing is re-processed. */
  ingestVideo: (sessionId: string, input: VideoIngestInput) =>
    request<VideoAsset>(`/sessions/${sessionId}/videos`, { method: "POST", body: input }),

  /** For a pre-recorded file the user couldn't live-stream -- stats aren't
   * known yet, so this returns a QUEUED video immediately and the backend
   * runs the C++ detector over the upload asynchronously (see
   * VideoProcessingRunner). The gallery polls the video's status until it
   * reaches COMPLETE or FAILED. */
  processVideo: (sessionId: string, input: VideoProcessingInput) =>
    request<VideoAsset>(`/sessions/${sessionId}/videos/process`, {
      method: "POST",
      body: input,
    }),
};

export const analyticsService = {
  /** GET /analytics/summary — lifetime totals plus recent-vs-prior deltas,
   * computed server-side from the session aggregates. */
  summary: () => request<AnalyticsSummary>("/analytics/summary"),

  /** GET /analytics/shooting — session-level series used by trend charts. */
  shooting: () => request<SeriesPoint[]>("/analytics/shooting"),
};

/**
 * The one genuinely paginated resource: videos accumulate without bound as
 * training sessions pile up, unlike sessions (needed whole, for analytics'
 * session picker and the dashboard) or calendar events (needed as a bounded
 * date-range window, not an arbitrary page — see calendarService.list).
 */
export const videosService = {
  list: (page = 0, size = 20) =>
    request<PageResponse<VideoAsset>>("/videos", { params: { page, size } }),

  get: (videoId: string) => request<VideoAsset>(`/videos/${videoId}`),

  /** Only touches the human-editable fields -- status/storageKey/
   * analyzedShots etc. are left exactly as the pipeline last set them. */
  update: (videoId: string, input: VideoAssetUpdateInput) =>
    request<VideoAsset>(`/videos/${videoId}`, { method: "PUT", body: input }),

  /**
   * Deletes a recording and everything derived from it, for good.
   *
   * <p>No optimistic update and no undo, unlike the shot corrections. The
   * server removes the upload, its browser-playable copy, its thumbnail
   * and its telemetry, then recounts the session that is left; there is
   * nothing to put back. The confirmation in the gallery is the only
   * chance to stop it, which is why it is worded as plainly as it is.
   */
  remove: (videoId: string) => request<void>(`/videos/${videoId}`, { method: "DELETE" }),

  /**
   * The stored per-frame telemetry for a processed video: a metadata
   * record, then the frame and shot_event stream the C++ detector wrote,
   * in the same schema the live DataChannel carries.
   *
   * <p>Playback draws the overlay from this at view time -- the upload
   * itself is never modified -- and the review UI derives the running
   * score and each shot from the same stream.
   */
  getTelemetry: (videoId: string) =>
    request<VideoTelemetryResponse>(`/videos/${videoId}/telemetry`),

  /**
   * Never cache the result — a presigned URL expires, so this is fetched
   * fresh right before playback, not stored alongside the video's other
   * (durable) metadata. Locally it resolves to the API's own
   * /videos/local-blob/{storageKey} route.
   */
  getPlaybackUrl: (videoId: string) =>
    request<PlaybackUrlResponse>(`/videos/${videoId}/playback-url`),

  /** Called right as a live session ends, or as soon as a file is picked
   * for upload, before any bytes are sent anywhere — see uploadRecording. */
  getUploadUrl: (sessionId: string, contentType: string) =>
    request<UploadUrlResponse>("/videos/upload-url", {
      method: "POST",
      body: { sessionId, contentType },
    }),

  /**
   * PUTs a finished recording's bytes to the URL from getUploadUrl. Goes
   * around request()/API_BASE_URL entirely — uploadUrl is already an
   * absolute URL (S3 in production, the local blob route in development),
   * never this app's own /api/v1 base path.
   */
  uploadRecording: async (uploadUrl: string, blob: Blob) => {
    const token = getAuthToken();
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        // A real presigned S3 PUT needs a real Content-Type too (see
        // LocalBlobStorageController) -- a File picked via <input
        // type="file"> can have an empty .type for formats the browser
        // doesn't recognize, so this never sends a blank one.
        "Content-Type": blob.type || "application/octet-stream",
        // This PUT goes straight to uploadUrl, bypassing request() (see
        // this function's own doc comment above) -- so unlike every other
        // call in this file, it has to attach the bearer token itself.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: blob,
    });
    if (!response.ok) {
      throw new Error(`Recording upload failed with status ${response.status}`);
    }
  },
};

export const calendarService = {
  /**
   * Omit from/to for every event (the dashboard's Reminders widget, which
   * has no month concept). Pass both for a bounded window — the calendar
   * page requests its previous/current/next-month range rather than
   * paginating, since a page boundary could otherwise split a month's
   * events across two requests with no way for a non-paginating UI to
   * know it needs to fetch page 2.
   */
  list: (from?: string, to?: string) =>
    request<CalendarEvent[]>("/calendar/events", { params: { from, to } }),

  create: (input: CalendarEventInput) =>
    request<CalendarEvent>("/calendar/events", { method: "POST", body: input }),

  update: (eventId: string, input: CalendarEventInput) =>
    request<CalendarEvent>(`/calendar/events/${eventId}`, { method: "PUT", body: input }),

  remove: (eventId: string) => request<void>(`/calendar/events/${eventId}`, { method: "DELETE" }),
};

/**
 * Registration/login. Both return a bearer token plus the account's own
 * profile (see AuthResponse); the login route persists them under the
 * `followthrough.token` / `followthrough.identity` localStorage keys.
 */
export const authService = {
  register: (name: string, email: string, password: string) =>
    request<AuthResponse>("/auth/register", { method: "POST", body: { name, email, password } }),

  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: { email, password } }),
};

export const userService = {
  me: () => request<UserProfile>("/users/me"),
  /**
   * `preferences` is a partial patch, matching the backend's
   * UserPreferencesUpdateRequest, where every field is nullable and an
   * absent field leaves the stored value alone. Typing it as a full object
   * would force callers to round-trip fields they are not changing.
   */
  update: (
    patch: Partial<Omit<UserProfile, "preferences">> & {
      preferences?: Partial<UserProfile["preferences"]>;
    },
  ) => request<UserProfile>("/users/me", { method: "PUT", body: patch }),
};
