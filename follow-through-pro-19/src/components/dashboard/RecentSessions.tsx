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
    <div className="-mx-4 overflow-x-auto">
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
  );
}
