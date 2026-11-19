/**
 * Phone-side diagnostics for a live session.
 *
 * A phone has no developer console to hand, and the one place every live
 * session already reaches is the signaling relay, whose log sits next to the
 * backend's. The live session sends these lines there as "diagnostic"
 * messages -- the relay prints them and forwards nothing -- so a session that
 * went wrong on a phone can be read from the server afterwards: connection
 * states, the network path in use, what the encoder was doing, and any error
 * the page hit. Nothing here affects the session itself.
 *
 * This module is the sink the rest of the page reports to. The live
 * component plugs the current session in (setDiagnosticsReporter); a line
 * reported while there is none -- the camera refusing before a session
 * exists, or the error page after the session has been torn down -- goes to
 * the relay on a socket of its own, opened for just that line.
 */
import { signalingConfig } from "@/config/streaming";

type Reporter = (detail: string) => void;

let reporter: Reporter | null = null;

/** The live session that currently carries diagnostics, or null when none
 * does. */
export function setDiagnosticsReporter(next: Reporter | null): void {
  reporter = next;
}

export function reportDiagnostic(detail: string): void {
  if (reporter) {
    reporter(detail);
  } else {
    sendOnItsOwn(`${new Date().toISOString()} ${detail}`);
  }
}

/** Best effort and fire-and-forget: a page that cannot reach the relay has
 * nothing to report to anyway. */
function sendOnItsOwn(line: string): void {
  if (typeof WebSocket === "undefined") return;
  try {
    const ws = new WebSocket(signalingConfig.relayUrl);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "diagnostic", detail: line }));
      setTimeout(() => ws.close(), 250);
    });
    ws.addEventListener("error", () => ws.close());
  } catch {
    /* no relay to tell */
  }
}

/** An error as one readable line: its name, message and first few stack
 * frames, which is what a server-side log can hold and a person can read
 * off a phone's error page. */
export function describeError(error: unknown, stackFrames = 4): string {
  if (error instanceof Error) {
    const heading = `${error.name}: ${error.message}`;
    const frames = (error.stack ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== heading && line !== error.message)
      .slice(0, stackFrames);
    return [heading, ...frames].join(" | ");
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
