/**
 * Drives the Live page end to end with a fake camera and reports what the
 * browser sent and what came back, so a deployment can be verified without
 * a phone: sign in, start a session, wait, read the WebRTC statistics and
 * the page, screenshot.
 *
 *   node scripts/live-check.mjs <camera.mjpeg> [screenshot.png]
 *
 *   BASE=https://<host>            the app's origin (default http://localhost:8081)
 *   FT_EMAIL / FT_PASSWORD         the account to sign in as (default: the seeded demo account)
 *   WAIT_SECONDS                   how long to stream before reading the statistics (default 20)
 *   VIEWPORT                       browser size as WxH (default 1280x800; 390x844 is a phone upright)
 *   END_SESSION=1                  also end the session and wait for the recording to be saved
 *
 * The camera file is a raw MJPEG stream (concatenated JPEG frames), which
 * Chromium's fake capture device plays at its native rate; one can be made
 * from the reference clip with OpenCV. Self-signed certificates are
 * accepted, so a local reverse proxy (scripts/edge-proxy.mjs) works too.
 *
 * Needs the whole stack running behind BASE: web app, API, relay and the
 * C++ backend. Exits non-zero when no video frames were sent or no
 * telemetry came back.
 */
import { chromium } from "playwright";

const [cam, shot] = process.argv.slice(2);
if (!cam) {
  console.error("usage: node scripts/live-check.mjs <camera.mjpeg> [screenshot.png]");
  process.exit(2);
}
const BASE = process.env.BASE ?? "http://localhost:8081";
const EMAIL = process.env.FT_EMAIL ?? "patrick.doyne@followthrough.app";
const PASSWORD = process.env.FT_PASSWORD ?? "followthrough-dev";
const WAIT = Number(process.env.WAIT_SECONDS ?? 20);

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${cam}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage({
  viewport: process.env.VIEWPORT
    ? {
        width: Number(process.env.VIEWPORT.split("x")[0]),
        height: Number(process.env.VIEWPORT.split("x")[1]),
      }
    : { width: 1280, height: 800 },
  ignoreHTTPSErrors: true,
});
page.on("pageerror", (e) => console.log("[page error]", String(e).slice(0, 200)));
// Keep a handle on the peer connection the page creates, for getStats().
await page.addInitScript(() => {
  window.__pcs = [];
  const Orig = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...a) {
    const pc = new Orig(...a);
    window.__pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Orig.prototype;
  Object.assign(window.RTCPeerConnection, Orig);
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click('button[type="submit"]');
await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 20000 });
await page.goto(`${BASE}/live`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page
  .getByRole("button", { name: /start session/i })
  .first()
  .click();
console.log(`session started on ${BASE}; streaming for ${WAIT} s`);
await page.waitForTimeout(WAIT * 1000);

const result = await page.evaluate(async (wait) => {
  const text = document.body.innerText;
  const out = {
    badge: /\b(OFFLINE|LIVE)\b/.exec(text)?.[1] ?? "?",
    encoderLine: text.split("\n").find((l) => /ms\/frame|×\d+/.test(l)) ?? null,
    placeholder:
      (text.match(
        /Initializing camera|No camera available|Camera error|Camera permission denied/g,
      ) || [])[0] ?? null,
    video: null,
    telemetryMessages: 0,
  };
  const pc = window.__pcs.at(-1);
  if (!pc) return out;
  out.connection = pc.connectionState;
  const report = await pc.getStats();
  report.forEach((e) => {
    if (e.type === "outbound-rtp" && e.kind === "video") {
      out.video = {
        framesSent: e.framesSent,
        fps: e.framesPerSecond ?? null,
        size: e.frameWidth && e.frameHeight ? `${e.frameWidth}×${e.frameHeight}` : null,
        kbps: Math.round((e.bytesSent * 8) / wait / 1000),
        encoder: e.encoderImplementation,
        limitation: e.qualityLimitationReason,
      };
    }
    if (e.type === "data-channel") out.telemetryMessages += e.messagesReceived ?? 0;
  });
  return out;
}, WAIT);

if (process.env.END_SESSION === "1") {
  await page
    .getByRole("button", { name: /end session/i })
    .first()
    .click();
  const outcome = await page
    .waitForFunction(
      () =>
        /Recording saved|Couldn't (save|upload|create)/.exec(document.body.innerText)?.[0] ?? null,
      null,
      { timeout: 30000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => "no outcome within 30 s");
  result.endSession = outcome;
}

console.log(JSON.stringify(result, null, 2));
if (shot) {
  await page.screenshot({ path: shot });
  console.log("screenshot:", shot);
}
await browser.close();

const ok =
  result.video &&
  result.video.framesSent > 0 &&
  result.telemetryMessages > 0 &&
  (result.endSession === undefined || result.endSession === "Recording saved");
console.log(
  ok
    ? "OK: video went up and telemetry came back"
    : "FAILED: no video sent or no telemetry received",
);
process.exit(ok ? 0 : 1);
