// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_TITLE_ATTR } from "@/components/a11y/RouteAnnouncer";
import { PageContainer, type PageContainerProps } from "@/components/layout/AppShell";

/**
 * The page heading is a navigation landmark before it is a piece of
 * visual design.
 *
 * <p>The settings page draws its own header -- the identity band -- and
 * so asks PageContainer to drop the visible one. The heading itself has
 * to survive that, because RouteAnnouncer finds it by attribute, moves
 * focus to it after every client navigation and reads its text aloud to
 * say where you landed. Deleting the "unused" hidden h1 would break
 * both, silently, and only for screen-reader and keyboard users.
 */
afterEach(cleanup);

describe("PageContainer", () => {
  it("shows the heading by default", () => {
    render(
      <PageContainer title="Analytics">
        <p>body</p>
      </PageContainer>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Analytics" });
    expect(heading.className).not.toContain("sr-only");
  });

  it("keeps the heading in the document when the page hides it", () => {
    render(
      <PageContainer title="Settings" hideHeader>
        <p>body</p>
      </PageContainer>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Settings" });
    expect(heading.className).toContain("sr-only");

    // The three things RouteAnnouncer needs: it finds the element by
    // this attribute, focuses it, and announces its text.
    expect(heading.hasAttribute(PAGE_TITLE_ATTR)).toBe(true);
    expect(document.querySelector(`[${PAGE_TITLE_ATTR}]`)).toBe(heading);
    expect(heading.tabIndex).toBe(-1);

    heading.focus();
    expect(document.activeElement).toBe(heading);
    expect(heading.textContent?.trim()).toBe("Settings");
  });

  it("will not accept a header's contents from a page that has no header", () => {
    // A hidden header has nowhere to render these, and the earlier
    // version of this component accepted them and dropped them
    // silently. The `ts-expect-error`s are the assertion, not the
    // values: if either prop is ever allowed back alongside
    // `hideHeader`, the directive goes unused and the type check
    // fails, so this cannot regress unnoticed.
    // @ts-expect-error -- a hidden header cannot show an actions row
    const withActions: PageContainerProps = {
      title: "Settings",
      children: null,
      hideHeader: true,
      actions: null,
    };
    // @ts-expect-error -- nor a description
    const withDescription: PageContainerProps = {
      title: "Settings",
      children: null,
      hideHeader: true,
      description: "unrenderable",
    };

    expect([withActions.hideHeader, withDescription.hideHeader]).toEqual([true, true]);
  });
});
