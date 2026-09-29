import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, LogIn, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { PasswordField } from "@/components/auth/PasswordField";
import { BrandLockup } from "@/components/brand/BrandMark";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — FollowThrough" },
      {
        name: "description",
        content: "Sign in to FollowThrough to review shot telemetry and live training analytics.",
      },
      { property: "og:title", content: "Sign in — FollowThrough" },
      {
        property: "og:description",
        content: "Access your basketball training analytics workspace.",
      },
    ],
  }),
  component: LoginPage,
});

/**
 * What the product can say for itself, kept to three figures.
 *
 * <p>Not what it is -- the logo says that, in the artwork, and the line
 * under it says what it measures. These are the only claim on the page
 * that is a number, which is why they are the one thing set in the
 * tabular face.
 */
const PROOF = [
  ["Shots analysed", "580+"],
  ["Telemetry fields", "5"],
  ["Live latency", "<1s"],
] as const;

/**
 * The shell both auth pages sit in.
 *
 * <p>A full-height split: the logo owns the left panel, the form owns
 * the right. It used to stack the logo, a headline, a paragraph and
 * three tiles in one centred column, where the logo was one item in a
 * list rather than the subject -- 320px of mark in a 754x1000 panel,
 * with a headline eight pixels under it saying a second tagline over
 * the top of the one already inside the artwork.
 *
 * <p>So the panel is three bands now: a greeting at the head, the logo
 * at the optical centre with a single line under it, and the figures at
 * the foot. Nothing is said twice -- the artwork carries the name, the
 * tagline and what the product is; the line carries what it measures;
 * the figures carry the proof.
 *
 * <p>Every colour on it is a theme token -- `--hero` and `--hero-2` for
 * the ground, `--hero-fg` and `--hero-muted` for the type, `--sec` for
 * the rule and the bloom -- all of which `theme.ts` regenerates from the
 * accent. The one thing that cannot follow the theme is the logo, which
 * is a raster lit in its own orange.
 */
export function AuthLayout({
  greeting,
  title,
  subtitle,
  icon: Icon,
  children,
  footer,
}: {
  /** The line that speaks to the person rather than about the product. */
  greeting: string;
  title: string;
  subtitle: string;
  /** The section symbol above the heading, in the accent, as everywhere else. */
  icon: LucideIcon;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.08fr_1fr]">
      {/* The breakpoint lives on a plain wrapper, not on the band.
          `.hero` is declared outside Tailwind's layers, so its own
          `display: flex` beat `hidden lg:flex` and the band rendered at
          every width -- which put the logo on the page twice on a
          phone, once here and once in the card header. */}
      <div className="hidden lg:block">
        <div className="hero auth-band h-full rounded-none p-10 xl:p-12">
          <div className="relative z-10">
            {/* The accent rule the band's eyebrow already uses, on its
                own here: an eyebrow reading "Sign in" would be the
                heading on the right-hand side said a second time. */}
            <span aria-hidden className="block h-0.5 w-10 bg-[var(--sec)]" />
            <p className="mt-4 text-2xl leading-snug font-semibold tracking-tight text-[var(--hero-fg)]">
              {greeting}
            </p>
          </div>

          {/* The subject. */}
          <div className="relative z-10 flex flex-col items-center py-6 text-center">
            <BrandLockup ground="dark" className="w-full max-w-sm xl:max-w-md" />
            <p className="mt-7 max-w-sm text-sm leading-relaxed text-[var(--hero-muted)]">
              Shot type, distance, result, shot duration and time to apex — measured from your
              training video and streamed live to your bench.
            </p>
          </div>

          <div className="relative z-10">
            {/* Hairlines rather than tiles. `.tier` paints the *page's*
                surface, which in the light theme is a near-white slab
                dropped onto a band that is dark in every palette -- the
                same trap `.hero-rail` exists to avoid. Plain figures on
                the band's own ground cannot fall into it. */}
            <dl className="flex">
              {PROOF.map(([label, value], i) => (
                <div
                  key={label}
                  className={cn(
                    "flex-1",
                    i === 0
                      ? "pe-4"
                      : "border-s border-[color-mix(in_oklab,var(--hero-fg)_16%,transparent)] px-4",
                  )}
                >
                  {/* Two lines' worth of room whether the label needs
                      them or not: two of the three wrap and one does
                      not, and without this their figures sat at three
                      heights. */}
                  <dt className="flex min-h-8 items-start text-[0.625rem] font-semibold tracking-[0.2em] text-[var(--hero-muted)] uppercase">
                    {label}
                  </dt>
                  <dd className="metric-value mt-1 text-xl font-semibold text-[var(--hero-fg)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* No band on a narrow screen, so the logo brings its own dark
              ground -- without one the silver half of the wordmark
              disappears into the light theme. */}
          <BrandLockup className="mb-7 w-full max-w-[17rem] lg:hidden" />

          {/* The card carries its own heading. Set above it, the card
              opened straight onto a field label, which is what made it
              read as a box drawn round some inputs rather than as the
              thing the page is for. */}
          <div className="sheet auth-card glow">
            <div className="p-7">
              <span className="block text-[var(--sec)]" aria-hidden>
                <Icon className="size-6" />
              </span>
              <h1 className="mt-3 text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>

              <div className="mt-6">{children}</div>
            </div>
          </div>

          <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
        </div>
      </main>
    </div>
  );
}

function LoginPage() {
  const { login, isAuthenticated, isReady } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (isReady && isAuthenticated) navigate({ to: "/", replace: true });
  }, [isReady, isAuthenticated, navigate]);

  return (
    <AuthLayout
      icon={LogIn}
      greeting="Welcome back,"
      title="Sign in"
      subtitle="Access your training analytics workspace."
      footer={
        <>
          No account?{" "}
          <Link to="/register" className="text-primary hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setPending(true);
          try {
            await login(email, password);
            navigate({ to: "/", replace: true });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Sign in failed.");
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@team.com"
            className="field h-11"
          />
        </div>

        <PasswordField
          id="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        <FormError message={error} />

        <Button type="submit" className="h-11 w-full text-sm" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * What went wrong, where it went wrong.
 *
 * <p>A bare red line under the last field was easy to miss and said
 * nothing about itself. This is a block with a symbol, in the app's
 * own destructive colour, and it still announces through `role="alert"`
 * so it does not depend on being seen.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-destructive)_10%,transparent)] px-3 py-2.5 text-sm text-foreground"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      {message}
    </p>
  );
}
