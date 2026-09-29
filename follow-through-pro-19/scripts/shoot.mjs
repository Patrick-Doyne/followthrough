/**
 * Screenshot harness for visual work.
 *
 * Signs into the running dev server once, then captures the requested
 * routes at a laptop width in dark and light, and at a phone width. Exists
 * so visual changes are looked at rather than assumed.
 *
 * It drives the real app against the real backend, so both have to be up
 * (see LOCAL_DEV.md). Credentials default to the seeded local-dev demo
 * account; override them when that account's password differs:
 *
 *   BASE=http://localhost:8081 FT_EMAIL=... FT_PASSWORD=... \
 *     npm run shots -- <outDir> "<url-path>[,<url-path>...]"
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:8081";
const EMAIL = process.env.FT_EMAIL ?? "patrick.doyne@followthrough.app";
const PASSWORD = process.env.FT_PASSWORD ?? "followthrough-dev";
const outDir = process.argv[2] ?? "shots";
const paths = (process.argv[3] ?? "/settings?tab=profile").split(",");
const VIEWPORTS = [
  { name: "laptop", width: 1440, height: 1000, colorScheme: "dark" },
  { name: "laptop-light", width: 1440, height: 1000, colorScheme: "light" },
  { name: "phone", width: 390, height: 844, colorScheme: "dark" },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    // The app's theme default is "system", so this is what selects the
    // palette -- there is no in-app override to drive from here.
    colorScheme: vp.colorScheme,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  // Login is a client-side navigation, so there is no load event to wait
  // on. The persisted token is the unambiguous signal that it worked.
  await page.waitForFunction(
    () => Boolean(window.localStorage.getItem("followthrough.token")),
    null,
    { timeout: 15000 },
  );

  for (const p of paths) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    // Settle: fonts, the boot script's theme attributes, query results.
    await page.waitForTimeout(900);
    const slug = p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
    await page.screenshot({
      path: `${outDir}/${slug}--${vp.name}.png`,
      fullPage: true,
    });
    console.log(`${outDir}/${slug}--${vp.name}.png`);
  }
  await ctx.close();
}

await browser.close();
