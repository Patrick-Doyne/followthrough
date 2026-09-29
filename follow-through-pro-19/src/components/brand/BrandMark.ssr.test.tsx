import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandLockup } from "@/components/brand/BrandMark";
import { AuthProvider } from "@/state/auth";
import { SettingsProvider } from "@/state/settings-provider";

/**
 * The logo renders on the server.
 *
 * <p>Re-hueing the artwork needs a canvas, and a canvas needs a document.
 * The work is therefore confined to an effect, which never runs during a
 * server render -- but "confined to an effect" is exactly the kind of
 * claim that quietly stops being true when somebody moves a line. This is
 * the node environment, so `document` genuinely does not exist here and
 * the test fails for real if it is reached.
 *
 * <p>It also pins the first-paint contract: before hydration the shipped
 * file is what goes out, so the server's HTML and the client's first
 * render agree and there is nothing for React to complain about.
 */
describe("BrandLockup on the server", () => {
  it("renders the shipped artwork without touching a document", () => {
    expect(typeof document).toBe("undefined");

    // The same providers the real tree has above it, since the hook
    // reads the accent out of settings.
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <SettingsProvider>
            <BrandLockup />
          </SettingsProvider>
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain("/brand/followthrough-lockup.png");
    expect(html).not.toContain("data:image");
  });
});
