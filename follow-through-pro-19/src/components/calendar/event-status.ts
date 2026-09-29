import { Activity, Check, Clock, X, type LucideIcon } from "lucide-react";

import type { CalendarEventStatus } from "@/types/telemetry";

/*
 * Status is carried by a bar down the leading edge and a glyph, not by
 * a tinted box.
 *
 * <p>Two reasons. A grid of filled colour blocks is most of what made
 * the month read as noisy -- tinted rectangles with coloured borders
 * and a coloured dot is three marks saying one thing. And the old chip
 * encoded status in colour alone, which the app's own rule forbids;
 * the glyph is what makes it survive being unable to tell green from
 * red.
 *
 * <p>Shared by the month cells and the week/day time grid so the two
 * cannot drift apart.
 */
export const STATUS_BAR: Record<CalendarEventStatus, string> = {
  COMPLETED: "bg-make",
  UPCOMING: "bg-primary",
  MISSED: "bg-miss",
  IN_PROGRESS: "bg-warn",
};

export const STATUS_TEXT: Record<CalendarEventStatus, string> = {
  COMPLETED: "text-make",
  UPCOMING: "text-primary",
  MISSED: "text-miss",
  IN_PROGRESS: "text-warn",
};

export const STATUS_ICON: Record<CalendarEventStatus, LucideIcon> = {
  COMPLETED: Check,
  UPCOMING: Clock,
  MISSED: X,
  IN_PROGRESS: Activity,
};
