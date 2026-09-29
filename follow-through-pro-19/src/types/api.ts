import type { ProcessingStatus, UserProfile } from "./telemetry";

/**
 * Generic page envelope, matching the Spring Boot API's PageResponse<T>
 * exactly. Only /videos is actually paginated — see services/followthrough.ts
 * for why /sessions and /calendar/events deliberately aren't.
 */
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

/**
 * A short-lived, playable URL for a video whose storageKey points at S3.
 * Never cache or persist this — fetch a fresh one right before playback,
 * since a real presigned URL expires.
 */
export interface PlaybackUrlResponse {
  url: string;
  expiresAt: string;
}

/**
 * A short-lived, writable URL for PUTting a finished recording's bytes
 * straight to storage, plus the storageKey to remember for the follow-up
 * ingest call once the upload succeeds. Bypasses this app's own backend for
 * the actual bytes, same as a real S3 presigned PUT URL would.
 */
export interface UploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

/**
 * What POST /sessions/{sessionId}/videos expects, mirroring the Spring Boot
 * API's VideoIngestRequest exactly. Sent once a live session's recording has
 * finished uploading, to attach it to that session's video list.
 */
export interface VideoIngestInput {
  title: string;
  date: string;
  durationSeconds: number;
  storageKey: string;
  analyzedShots: number;
  shootingPercentage: number;
  thumbnailUrl?: string;
  sizeMb: number;
  status?: ProcessingStatus;
}

/**
 * What POST /auth/register and POST /auth/login both return: a bearer
 * token to attach as "Authorization: Bearer <token>" on every later
 * request (see services/http.ts's getAuthToken), plus the account's own
 * profile so the frontend doesn't need a separate /users/me round trip
 * right after authenticating.
 */
export interface AuthResponse {
  token: string;
  user: UserProfile;
}
