/**
 * Non-visual feedback: short tones and vibration.
 *
 * <p>Tones are synthesised with WebAudio rather than shipped as audio
 * files. Three sounds as assets would be a few hundred kilobytes and a
 * decode on first use; an oscillator is a few lines, instant, and lets the
 * volume setting be applied exactly rather than approximated by the
 * element's own gain.
 *
 * <p>Everything here is best-effort by design. Autoplay policy blocks audio
 * until the page has been interacted with, `navigator.vibrate` does not
 * exist on desktop and is ignored on iOS, and a locked-down browser may
 * refuse an AudioContext outright. None of that is an error worth surfacing
 * -- feedback is an enhancement, and the visual toast has already happened.
 */

export type FeedbackTone = "success" | "error" | "neutral";

/** Frequency pairs, in Hz. A rising pair reads as success, falling as
 * failure, without needing to be loud or long. */
const TONE_STEPS: Record<FeedbackTone, [number, number]> = {
  success: [660, 990],
  error: [440, 300],
  neutral: [520, 520],
};

const VIBRATION_MS: Record<FeedbackTone, number | number[]> = {
  success: 18,
  error: [24, 40, 24],
  neutral: 12,
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/**
 * Plays a short two-step tone.
 *
 * @param volume 0-100, as stored in settings.
 */
export function playTone(tone: FeedbackTone, volume: number): void {
  if (volume <= 0) return;
  const ctx = audioContext();
  if (!ctx) return;

  try {
    // A context created before any user gesture starts suspended; resuming
    // is a no-op once it is already running.
    if (ctx.state === "suspended") void ctx.resume();

    const [from, to] = TONE_STEPS[tone];
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + 0.09);

    // Scaled well below 1: this is a UI chirp sitting on top of whatever
    // else is playing, and the ramp to near-zero avoids the click that an
    // abrupt stop produces.
    const peak = Math.min(1, volume / 100) * 0.08;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.18);
  } catch {
    // Audio is an enhancement; never let it break the action it accompanies.
  }
}

export function vibrate(tone: FeedbackTone): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(VIBRATION_MS[tone]);
  } catch {
    // Some browsers throw instead of returning false when blocked.
  }
}
