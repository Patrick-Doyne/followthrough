/**
 * CameraSource — the single boundary between the browser camera and the
 * live video component.
 *
 *   Browser camera -> CameraSource -> LiveVideo -> WebRTCLiveSession
 *
 * `LocalCameraSource` is plain `getUserMedia`. The stream it returns is what
 * `WebRTCLiveSession` publishes to the C++ pipeline; the frontend itself
 * does no computer vision — capture and transport only.
 */

export type CameraFailure = "denied" | "unavailable" | "error";

export interface CameraSource {
  /** Acquires the camera and returns the stream to render locally. */
  start(): Promise<MediaStream>;
  /** Releases the camera. */
  stop(): void;
}

export function classifyCameraError(err: unknown): CameraFailure {
  const name = (err as Error | undefined)?.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "unavailable";
  return "error";
}

class LocalCameraSource implements CameraSource {
  private stream: MediaStream | null = null;

  async start(): Promise<MediaStream> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const error = new Error("No camera available");
      error.name = "NotFoundError";
      throw error;
    }
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
    return this.stream;
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

export function createCameraSource(): CameraSource {
  return new LocalCameraSource();
}
