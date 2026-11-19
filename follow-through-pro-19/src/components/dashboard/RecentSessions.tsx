import { Link } from "@tanstack/react-router";
import { CalendarDays, ChevronRight } from "lucide-react";

import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { StatusBadge } from "@/components/common/ResultBadge";
import { fmtDate, fmtDuration } from "@/lib/format";
import type { TrainingSession } from "@/types/telemetry";

export function RecentSessions({
  sessions,
  isPending,
  isError,
  onRetry,
  limit,
}: {
  sessions: TrainingSession[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry?: () => void;
  limit?: number;
}) {
  if (isPending) return <LoadingState rows={4} label="Loading recent sessions…" />;
  if (isError)
    return (
      <ErrorState
        title="Your sessions didn't load"
        message="Check your connection, then try again."
        {...(onRetry ? { onRetry } : {})}
      />
    );
  if (!sessions?.length)
    return (
      <EmptyState
        title="No sessions yet"
        message="Start a live session or upload a video to see it here."
        icon={<CalendarDays className="size-5" />}
      />
    );

  const rows = limit ? sessions.slice(0, limit) : sessions;

  return (
    <>
      {/* On a phone the table needed 720px and scrolled sideways, so
          the name was all that showed. One row per session instead,
          with the facts that fit. */}
      <ul className="-mx-4 divide-y divide-border/60 sm:hidden">
        {rows.map((session) => (
          <li key={session.sessionId}>
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: session.sessionId }}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{session.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {fmtDate(session.date)} · {fmtDuration(session.durationMinutes)}
                </span>
                <span className="metric-value mt-1 block text-xs text-muted-foreground">
                  {session.makes}/{session.shots} ·{" "}
                  <span className="font-semibold text-foreground">
                    {session.shootingPercentage.toFixed(1)}%
                  </span>
                </span>
              </span>
              <StatusBadge status={session.status} />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="-mx-4 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {["Date", "Session", "Duration", "Shots", "Makes", "FG%", "Status", ""].map((h) => (
                <th key={h} scope="col" className="label-caps px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((session) => (
              <tr
                key={session.sessionId}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-accent/40"
              >
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                  {fmtDate(session.date)}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    to="/sessions/$sessionId"
                    params={{ sessionId: session.sessionId }}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {session.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{session.location}</span>
                </td>
                <td className="metric-value px-4 py-2.5 whitespace-nowrap">
                  {fmtDuration(session.durationMinutes)}
                </td>
                <td className="metric-value px-4 py-2.5">{session.shots}</td>
                <td className="metric-value px-4 py-2.5">{session.makes}</td>
                <td className="metric-value px-4 py-2.5 font-semibold">
                  {session.shootingPercentage.toFixed(1)}%
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={session.status} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    to="/sessions/$sessionId"
                    params={{ sessionId: session.sessionId }}
                    aria-label={`Open analytics for ${session.name}`}
                    className="inline-flex text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
