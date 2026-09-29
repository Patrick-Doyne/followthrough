import { Bell, BellOff, Check, Trash2 } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCommands } from "@/state/commands";
import { useNotifications, type NotificationKind } from "@/state/notifications";
import { useT } from "@/state/settings-provider";

const KIND_DOT: Record<NotificationKind, string> = {
  success: "bg-make",
  error: "bg-miss",
  warning: "bg-warn",
  info: "bg-primary",
};

/**
 * Notification history, and the quiet-hours escape hatch.
 *
 * <p>This is what makes suppression safe to offer. Quiet hours and snooze
 * only withhold the interruption; every notification still lands here, so
 * turning them on cannot cause something to be missed entirely. The bell
 * also shows when suppression is active, because silently swallowing
 * notifications with no visible indication is how people end up thinking
 * the app is broken.
 */
export function NotificationBell() {
  const { history, unreadCount, markAllRead, clearHistory, snooze, isQuiet } = useNotifications();
  const { notificationsOpen, setNotificationsOpen } = useCommands();
  const t = useT();

  // Opening it is what marks things read; leaving them unread after the
  // person has plainly looked at the list would be noise.
  useEffect(() => {
    if (notificationsOpen && unreadCount > 0) markAllRead();
  }, [notificationsOpen, unreadCount, markAllRead]);

  return (
    <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `${t("notifications.open")} (${unreadCount})`
              : t("notifications.open")
          }
        >
          {isQuiet ? (
            <BellOff className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <Bell className="size-4" aria-hidden />
          )}
          {unreadCount > 0 ? (
            <span
              className="absolute top-1 right-1 flex size-2 rounded-full bg-primary"
              aria-hidden
            />
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">{t("notifications.history")}</p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => snooze(isQuiet ? null : 60)}
            >
              {isQuiet ? t("notifications.resume") : t("notifications.snooze")}
            </Button>
            {history.length > 0 ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={clearHistory}
                aria-label={t("notifications.clearHistory")}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>

        {isQuiet ? (
          <p className="border-b border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {t("notifications.quietHoursHint")}
          </p>
        ) : null}

        {history.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("notifications.historyEmpty")}
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y divide-border">
              {history.map((row) => (
                <li key={row.id} className="flex gap-2.5 px-3 py-2.5">
                  <span
                    className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", KIND_DOT[row.kind])}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{row.title}</p>
                    {row.body ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.body}</p>
                    ) : null}
                    <p className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                      {fmtRelative(row.at)}
                      {row.suppressed ? (
                        <span className="inline-flex items-center gap-0.5">
                          <BellOff className="size-2.5" aria-hidden />
                          {t("notifications.quietHours")}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {row.read ? (
                    <Check className="mt-1 size-3 shrink-0 text-muted-foreground" aria-hidden />
                  ) : null}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
