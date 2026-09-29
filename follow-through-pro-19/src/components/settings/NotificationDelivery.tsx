import { Send } from "lucide-react";

import { SectionCard } from "@/components/common/SectionCard";
import { ResetButton, SelectRow, SliderRow, ToggleRow } from "@/components/settings/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDateTime } from "@/lib/format";
import { useNotifications } from "@/state/notifications";
import { useSettings, useT } from "@/state/settings-provider";
import type { DigestFrequency } from "@/state/settings";

const SNOOZE_CHOICES = [30, 60, 240] as const;

/**
 * When notifications are allowed to interrupt, as opposed to which ones
 * exist at all (that is the toggle list above it on the same tab).
 *
 * <p>Separating the two matters: "I want to know when processing finishes"
 * and "but not at 2am" are different decisions, and collapsing them forces
 * people to turn a notification off entirely to get a quiet night.
 */
export function NotificationDelivery() {
  const { settings, update, reset } = useSettings();
  const { snooze, isQuiet, history, clearHistory } = useNotifications();
  const t = useT();

  const snoozedUntil = settings.snoozedUntil;
  const snoozeActive = snoozedUntil !== null && snoozedUntil > Date.now();

  return (
    <SectionCard
      id="notification-delivery"
      icon={Send}
      title={t("notifications.delivery")}
      actions={
        <ResetButton
          label={t("common.reset")}
          onClick={() =>
            reset([
              "quietHoursEnabled",
              "quietHoursStart",
              "quietHoursEnd",
              "snoozedUntil",
              "digestFrequency",
              "notificationHistoryLimit",
            ])
          }
        />
      }
      bodyClassName="space-y-4"
    >
      <ToggleRow
        id="n-quiet"
        label={t("notifications.quietHours")}
        description={t("notifications.quietHoursHint")}
        checked={settings.quietHoursEnabled}
        onChange={(quietHoursEnabled) => update({ quietHoursEnabled })}
      />

      {settings.quietHoursEnabled ? (
        <div className="grid max-w-sm grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="n-quiet-from">{t("notifications.quietFrom")}</Label>
            <Input
              id="n-quiet-from"
              type="time"
              value={settings.quietHoursStart}
              onChange={(e) => update({ quietHoursStart: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-quiet-to">{t("notifications.quietTo")}</Label>
            <Input
              id="n-quiet-to"
              type="time"
              value={settings.quietHoursEnd}
              onChange={(e) => update({ quietHoursEnd: e.target.value })}
            />
          </div>
        </div>
      ) : null}

      <div className="field-row flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="text-sm">
          {snoozeActive && snoozedUntil !== null
            ? t("notifications.snoozedUntil", { time: fmtDateTime(new Date(snoozedUntil)) })
            : t("notifications.snooze")}
        </span>
        <span className="flex-1" />
        {snoozeActive ? (
          <Button size="sm" variant="secondary" onClick={() => snooze(null)}>
            {t("notifications.resume")}
          </Button>
        ) : (
          SNOOZE_CHOICES.map((minutes) => (
            <Button key={minutes} size="sm" variant="ghost" onClick={() => snooze(minutes)}>
              {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
            </Button>
          ))
        )}
      </div>

      {isQuiet ? (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Notifications are being held right now. They still appear in the notification list.
        </p>
      ) : null}

      <SelectRow<DigestFrequency>
        id="n-digest"
        label={t("notifications.digest")}
        value={settings.digestFrequency}
        onChange={(digestFrequency) => update({ digestFrequency })}
        options={[
          { value: "off", label: t("notifications.digest.off") },
          { value: "daily", label: t("notifications.digest.daily") },
          { value: "weekly", label: t("notifications.digest.weekly") },
          { value: "monthly", label: t("notifications.digest.monthly") },
        ]}
      />

      <SliderRow
        id="n-history"
        label={t("notifications.historyLimit")}
        value={settings.notificationHistoryLimit}
        min={10}
        max={500}
        step={5}
        format={(value) => `${value}`}
        onChange={(notificationHistoryLimit) => update({ notificationHistoryLimit })}
      />

      {history.length > 0 ? (
        <Button size="sm" variant="ghost" onClick={clearHistory}>
          {t("notifications.clearHistory")} ({history.length})
        </Button>
      ) : null}
    </SectionCard>
  );
}
