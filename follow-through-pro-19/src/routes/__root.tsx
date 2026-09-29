import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { RouteAnnouncer, SkipToContentLink } from "@/components/a11y/RouteAnnouncer";
import { SessionTimeout } from "@/components/a11y/SessionTimeout";
import { Toaster } from "@/components/ui/sonner";
import { settingsBootScript } from "@/lib/settings-boot";
import { AuthProvider } from "@/state/auth";
import { CommandsProvider } from "@/state/commands";
import { NotificationsProvider } from "@/state/notifications";
import { TOAST_DURATION_MS } from "@/state/settings";
import { SettingsProvider, useSettings } from "@/state/settings-provider";
import { UndoProvider } from "@/state/undo";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FollowThrough — Basketball Training Analytics" },
      {
        name: "description",
        content:
          "FollowThrough turns basketball training video into shot telemetry, live analytics and performance trends.",
      },
      { name: "author", content: "FollowThrough" },
      { property: "og:title", content: "FollowThrough — Basketball Training Analytics" },
      {
        property: "og:description",
        content:
          "Shot telemetry, live training analytics and video review for serious basketball players.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      /* The badge, not the whole logo: a tab is 16 to 32 pixels and
         cannot carry a wordmark, let alone two lines under it. Each
         file bakes in the dark ground the artwork needs, because a
         tab strip is light in most browsers. The .ico stays for the
         bare /favicon.ico request browsers make regardless. */
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/favicon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // No theme class here on purpose. The boot script below sets it from the
    // person's stored preference before first paint; hard-coding one would
    // guarantee a flash for everyone who chose the other.
    <html lang="en">
      <head>
        <HeadContent />
        {/* Must stay render-blocking and inline -- see settings-boot.ts. */}
        <script dangerouslySetInnerHTML={{ __html: settingsBootScript() }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    // Provider order is load-bearing. Settings needs auth (to know whether
    // to sync to an account), notifications need settings (quiet hours,
    // toast duration, sound), undo needs notifications (the undo toast),
    // and commands need all three.
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsProvider>
          <NotificationsProvider>
            <UndoProvider>
              <CommandsProvider>
                <SkipToContentLink />
                <RouteAnnouncer />
                <SessionTimeout />
                {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
                <Outlet />
                <AppToaster />
              </CommandsProvider>
            </UndoProvider>
          </NotificationsProvider>
        </SettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * The toaster, with its close button and duration driven by settings.
 *
 * <p>"Until dismissed" is only usable if there is something to dismiss
 * with, so the close button is forced on for that choice rather than
 * leaving a toast that can only be swiped away.
 */
function AppToaster() {
  const { settings } = useSettings();
  const preferred = TOAST_DURATION_MS[settings.toastDuration];
  return (
    <Toaster
      position="top-right"
      closeButton={settings.toastDuration === "sticky"}
      duration={preferred === Infinity ? Infinity : preferred}
    />
  );
}
