import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Film,
  LayoutDashboard,
  LogOut,
  Crown,
  Menu,
  Settings,
  User,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { MAIN_CONTENT_ID, PAGE_TITLE_ATTR } from "@/components/a11y/RouteAnnouncer";
import { CommandPaletteButton } from "@/components/command/CommandPaletteButton";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LoadingState } from "@/components/common/states";
import type { MessageKey } from "@/lib/i18n";
import { userQuery } from "@/services/queries";
import { useAuth } from "@/state/auth";
import { useT } from "@/state/settings-provider";
import { useEntitlements } from "@/state/subscription";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/live", labelKey: "nav.live", icon: Activity },
  { to: "/analytics", labelKey: "nav.analytics", icon: BarChart3 },
  { to: "/videos", labelKey: "nav.videos", icon: Film },
  { to: "/calendar", labelKey: "nav.calendar", icon: CalendarDays },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
] as const satisfies readonly { to: string; labelKey: MessageKey; icon: LucideIcon }[];

function Wordmark({ labelOnPhone = true }: { labelOnPhone?: boolean }) {
  const t = useT();
  return (
    /* px-2.5 is the nav row's own padding: inside the same container
       the rows sit in, that puts the badge's left edge exactly where
       every nav icon's left edge is. It was px-1, which left it a
       little under 18px to the left of them. */
    <Link to="/" className="flex items-center gap-2 px-2.5" aria-label={t("nav.home")}>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-primary text-[0.8125rem] font-bold text-primary-foreground"
        aria-hidden
      >
        FT
      </span>
      {/* The word drops on a phone, where the badge is enough and the
          bar has five other controls to fit. The nav sheet still
          shows it in full. The link keeps its aria-label either way,
          so nothing is lost to a screen reader. */}
      <span
        className={cn(
          "text-sm font-semibold tracking-tight",
          labelOnPhone ? "" : "hidden sm:inline",
        )}
      >
        Follow<span className="text-primary">Through</span>
      </span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const t = useT();
  return (
    <nav aria-label={t("nav.primary")} className="flex flex-col gap-0.5">
      {NAV.map(({ to, labelKey, icon: Icon }) => {
        const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors",
              // The 3px accent edge is the app's "this one" mark -- the
              // same width a card carries along its top. It was 2px
              // here, which read as a different device rather than the
              // same one turned on its side.
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_3px_0_0_0_var(--color-primary)]"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

function TierBadge() {
  const { tier } = useEntitlements();
  const t = useT();
  return (
    <Link
      to="/settings"
      search={{ tab: "subscription" }}
      className="glow mx-1 flex items-center gap-2.5 rounded-sm border border-border bg-surface px-2 py-2 text-xs transition-colors hover:border-primary/40"
    >
      <span className="shrink-0 text-[var(--sec)]" aria-hidden>
        <Crown className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="label-caps block">{t("nav.plan")}</span>
        <span className="metric-value block truncate text-[0.8125rem] font-semibold text-foreground">
          {titleCase(tier)}
        </span>
      </span>
    </Link>
  );
}

function UserMenu() {
  const { identity, logout } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  // The profile is the account's real name; the identity's is whatever
  // the sign-in returned, which for the demo account is a single
  // letter -- so the bar showed that letter as both avatar and label.
  const profile = useQuery(userQuery());
  const name = profile.data?.name ?? identity?.name ?? "";
  const initials =
    name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "FT";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2" aria-label={t("nav.account")}>
          {/* The notch, matching the section tiles and the name plate. */}
          <span className="notch grid size-6 shrink-0 place-items-center bg-[var(--sec)] text-[0.625rem] font-bold text-[var(--sec-on)]">
            {initials}
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {identity?.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" search={{ tab: "profile" }}>
            <User className="size-4" aria-hidden />
            {t("nav.profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings" search={{ tab: "profile" }}>
            <Settings className="size-4" aria-hidden />
            {t("nav.accountSettings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            logout();
            navigate({ to: "/login", replace: true });
          }}
        >
          <LogOut className="size-4" aria-hidden />
          {t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A page's frame: the heading row, and the width the content sits in.
 *
 * <p>Split into two shapes rather than one with optional fields. A page
 * that draws its own header has nowhere to put a description or an
 * actions row, and the earlier single shape accepted both and dropped
 * them on the floor -- the kind of thing that is only ever found by
 * noticing a missing button. Passing either alongside `hideHeader` is
 * now a type error, so the page has to put them in its own header.
 */
export type PageContainerProps = {
  title: string;
  children: ReactNode;
  className?: string;
} & (
  | {
      /**
       * Drops the visible header row for a page that provides its own.
       *
       * <p>The heading itself stays in the document either way: it is
       * the landmark RouteAnnouncer moves focus to after a navigation,
       * and it is what a screen reader reads to say where it landed.
       * Only its appearance goes.
       */
      hideHeader: true;
      description?: never;
      actions?: never;
    }
  | {
      hideHeader?: false | undefined;
      description?: string | undefined;
      actions?: ReactNode;
    }
);

export function PageContainer({
  title,
  description,
  actions,
  children,
  className,
  hideHeader = false,
}: PageContainerProps) {
  return (
    <div
      data-page-container
      className={cn("mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6", className)}
    >
      {/* tabIndex -1 makes the heading programmatically focusable so
          RouteAnnouncer can land focus here after a navigation, without
          putting it in the normal tab order. */}
      {hideHeader ? (
        <h1 {...{ [PAGE_TITLE_ATTR]: "" }} tabIndex={-1} className="sr-only">
          {title}
        </h1>
      ) : (
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1
              {...{ [PAGE_TITLE_ATTR]: "" }}
              tabIndex={-1}
              className="metric-value text-2xl font-bold outline-none"
            >
              {title}
            </h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}

/** Route protection + persistent chrome. */
export function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isReady } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (isReady && !isAuthenticated) navigate({ to: "/login", replace: true });
  }, [isReady, isAuthenticated, navigate]);

  if (!isReady || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState variant="inline" label={t("common.checkingSession")} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        data-app-sidebar
        className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar py-4 lg:flex"
      >
        <div className="flex flex-col gap-5 px-2">
          <Wordmark />
          <NavLinks />
        </div>
        <div className="flex flex-col gap-2 px-1">
          <TierBadge />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={t("nav.open")}
                >
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 bg-sidebar p-4">
                <SheetTitle className="sr-only">{t("nav.primary")}</SheetTitle>
                <div className="mb-5">
                  <Wordmark />
                </div>
                <NavLinks onNavigate={() => setMobileOpen(false)} />
                <div className="mt-4">
                  <TierBadge />
                </div>
              </SheetContent>
            </Sheet>
            <span className="lg:hidden">
              <Wordmark labelOnPhone={false} />
            </span>
            {/* The bar was a 1100px empty strip with three controls
                pushed into the right corner. Search leads it because
                it is the one control that is about going somewhere,
                and it is what the space is for. */}
            <div className="ms-1 hidden lg:block">
              <CommandPaletteButton />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="lg:hidden">
              <CommandPaletteButton compact />
            </span>
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
