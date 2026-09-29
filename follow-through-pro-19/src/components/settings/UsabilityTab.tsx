import {
  Captions,
  Check,
  Clock,
  CloudOff,
  Compass,
  Film,
  Globe,
  Keyboard,
  Loader2,
  Palette,
  RotateCcw,
  ShieldCheck,
  Type,
  Volume2,
} from "lucide-react";

import { SectionCard } from "@/components/common/SectionCard";
import {
  ChoiceGroup,
  ResetButton,
  SelectRow,
  SliderRow,
  ToggleRow,
} from "@/components/settings/controls";
import { BrandMarkPicker } from "@/components/settings/BrandMarkPicker";
import { ThemePicker } from "@/components/settings/ThemePicker";
import { ShortcutEditor } from "@/components/settings/ShortcutEditor";
import { Button } from "@/components/ui/button";
import { LANGUAGE_OPTIONS, translationCoverage } from "@/lib/i18n";
import { REGION_OPTIONS, formatSample, resolveFormatConfig, timeZoneOptions } from "@/lib/intl";
import { isDefaultTriad, resolveAllPalettes } from "@/lib/theme";
import { paletteKeyFor } from "@/state/settings";
import { useSettings, useT } from "@/state/settings-provider";
import type {
  CaptionBackground,
  CaptionColor,
  CaptionFont,
  CaptionSize,
  Density,
  FirstDayOfWeek,
  HourCycle,
  LanguageChoice,
  MotionChoice,
  RegionChoice,
  TextScale,
  ThemeChoice,
  ToastDuration,
} from "@/state/settings";

/**
 * Display, accessibility and behaviour preferences.
 *
 * <p>Unlike the other tabs on this page there is no Save button anywhere:
 * every control applies the moment it changes, and because these settings
 * style the whole app, the surrounding page *is* the preview. Choosing
 * "Spacious" visibly loosens the panel you are choosing it in. That is
 * worth more than a preview swatch, and it removes the state where what
 * you see and what is stored disagree. The two settings whose effect is
 * not visible on this page -- captions and regional formats -- get an
 * explicit preview instead.
 *
 * <p>Each panel carries a stable `id` so the settings search can jump
 * straight to it.
 */
export function UsabilityTab() {
  const { settings, update, reset, resolvedTheme, reducedMotion, syncStatus } = useSettings();
  const t = useT();

  const formatConfig = resolveFormatConfig(settings);
  const [sampleDate, sampleTime, sampleNumber] = formatSample(formatConfig);
  const coverage = translationCoverage(settings.language === "system" ? "en" : settings.language);

  return (
    <div className="space-y-5">
      <SyncBanner status={syncStatus} />

      {/*
          Two columns that end level, not a flat grid.

          A flat grid makes every row as tall as its tallest card, so
          Appearance -- 1047px once it grew a theme picker, a palette
          and a logo uploader -- dragged Captions to the same height
          and left 675px of empty card below the caption preview. No
          re-pairing fixes that: nothing else on the tab is within
          600px of Appearance.

          Columns let each card size to its own content, and the split
          is by subject. The two subjects do not come out the same
          height though, and an 18px difference is not invisible: it
          left the full-width card below sitting 20px under one column
          and 38px under the other, which reads as a misalignment
          rather than as columns of different lengths. So the columns
          stretch to the taller of the two and the last card in each
          absorbs the slack, putting both bottom edges on one line.

          DOM order still matches reading order -- down the left, then
          down the right -- so focus order follows the eye, which a
          masonry that reflows cards between columns would not.
      */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* How it looks. */}
        <div className="flex flex-col gap-5 [&>:last-child]:grow">
          <SectionCard
            id="appearance"

            icon={Palette}
            title={t("usability.appearance")}
            description={t("usability.appearanceHint")}
            actions={
              <ResetButton
                label={t("common.reset")}
                onClick={() =>
                  reset(["theme", "themeColors", "themeTokens", "highContrast", "readingMode"])
                }
              />
            }
            bodyClassName="space-y-4"
          >
            <ChoiceGroup<ThemeChoice>
              name="theme"
              label={t("usability.theme")}
              description={
                settings.theme === "system"
                  ? t("usability.themeFollowing", { theme: t(`usability.theme.${resolvedTheme}`) })
                  : undefined
              }
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: "light", label: t("usability.theme.light") },
                { value: "dark", label: t("usability.theme.dark") },
                { value: "system", label: t("usability.theme.system") },
              ]}
            />
            {/* The theme is three colours now, and this is the whole of
                it -- there is no separate accent setting to keep in step. */}
            <ThemePicker
              value={settings.themeColors}
              palette={paletteKeyFor(resolvedTheme, settings.highContrast)}
              onChange={(themeColors) =>
                update({
                  themeColors,
                  themeTokens: isDefaultTriad(themeColors) ? null : resolveAllPalettes(themeColors),
                })
              }
            />
            <BrandMarkPicker
              value={settings.brandMark}
              onChange={(brandMark) => update({ brandMark })}
            />
            {/* A pair, spaced as one group. At the card's own 20px
                rhythm they read as two separate sections. */}
            <div className="space-y-2">
              <ToggleRow
                id="u-contrast"
                label={t("usability.highContrast")}
                description={t("usability.highContrastHint")}
                checked={settings.highContrast}
                onChange={(highContrast) => update({ highContrast })}
              />
              <ToggleRow
                id="u-reading"
                label={t("usability.readingMode")}
                description={t("usability.readingModeHint")}
                checked={settings.readingMode}
                onChange={(readingMode) => update({ readingMode })}
              />
            </div>
          </SectionCard>
          <SectionCard
            id="text-and-spacing"

            icon={Type}
            title={t("usability.textAndSpacing")}
            description={t("usability.textAndSpacingHint")}
            actions={
              <ResetButton
                label={t("common.reset")}
                onClick={() => reset(["textScale", "density"])}
              />
            }
            bodyClassName="space-y-4"
          >
            <ChoiceGroup<TextScale>
              name="textScale"
              label={t("usability.textSize")}
              value={settings.textScale}
              onChange={(textScale) => update({ textScale })}
              options={[
                { value: "base", label: t("usability.textSize.base") },
                { value: "large", label: t("usability.textSize.large") },
                { value: "larger", label: t("usability.textSize.larger") },
                { value: "largest", label: t("usability.textSize.largest") },
              ]}
            />
            <ChoiceGroup<Density>
              name="density"
              label={t("usability.density")}
              description={t("usability.densityHint")}
              value={settings.density}
              onChange={(density) => update({ density })}
              options={[
                { value: "compact", label: t("usability.density.compact") },
                { value: "comfortable", label: t("usability.density.comfortable") },
                { value: "spacious", label: t("usability.density.spacious") },
              ]}
            />
          </SectionCard>
          <SectionCard
            id="motion-and-media"

            icon={Film}
            title={t("usability.motionAndMedia")}
            actions={
              <ResetButton
                label={t("common.reset")}
                onClick={() => reset(["motion", "autoplayVideo"])}
              />
            }
            bodyClassName="space-y-4"
          >
            <ChoiceGroup<MotionChoice>
              name="motion"
              label={t("usability.motion")}
              description={
                settings.motion === "system"
                  ? t("usability.motionFollowing", {
                      motion: t(
                        reducedMotion ? "usability.motion.reduce" : "usability.motion.full",
                      ),
                    })
                  : undefined
              }
              value={settings.motion}
              onChange={(motion) => update({ motion })}
              options={[
                { value: "full", label: t("usability.motion.full") },
                { value: "reduce", label: t("usability.motion.reduce") },
                { value: "system", label: t("usability.motion.system") },
              ]}
            />
            <ToggleRow
              id="u-autoplay"
              label={t("usability.autoplay")}
              description={t("usability.autoplayHint")}
              checked={settings.autoplayVideo}
              onChange={(autoplayVideo) => update({ autoplayVideo })}
            />
          </SectionCard>
        </div>

        {/* How it behaves, sounds and asks. */}
        <div className="flex flex-col gap-5 [&>:last-child]:grow">
          <SectionCard
            id="captions"

            icon={Captions}
            title={t("usability.captions")}
            description={t("usability.captionsHint")}
            actions={
              <ResetButton
                label={t("common.reset")}
                onClick={() =>
                  reset([
                    "captionsEnabled",
                    "captionSize",
                    "captionFont",
                    "captionColor",
                    "captionBackground",
                    "captionOpacity",
                  ])
                }
              />
            }
            bodyClassName="space-y-4"
          >
            <ToggleRow
              id="u-captions"
              label={t("usability.captionsEnabled")}
              checked={settings.captionsEnabled}
              onChange={(captionsEnabled) => update({ captionsEnabled })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectRow<CaptionSize>
                id="u-caption-size"
                label={t("usability.captionSize")}
                value={settings.captionSize}
                onChange={(captionSize) => update({ captionSize })}
                options={[
                  { value: "small", label: "Small" },
                  { value: "medium", label: "Medium" },
                  { value: "large", label: "Large" },
                  { value: "xlarge", label: "Extra large" },
                ]}
              />
              <SelectRow<CaptionFont>
                id="u-caption-font"
                label={t("usability.captionFont")}
                value={settings.captionFont}
                onChange={(captionFont) => update({ captionFont })}
                options={[
                  { value: "sans", label: "Sans serif" },
                  { value: "serif", label: "Serif" },
                  { value: "mono", label: "Monospace" },
                  { value: "dyslexic", label: "Dyslexia-friendly" },
                ]}
              />
              <SelectRow<CaptionColor>
                id="u-caption-color"
                label={t("usability.captionColor")}
                value={settings.captionColor}
                onChange={(captionColor) => update({ captionColor })}
                options={[
                  { value: "white", label: "White" },
                  { value: "yellow", label: "Yellow" },
                  { value: "cyan", label: "Cyan" },
                  { value: "green", label: "Green" },
                ]}
              />
              <SelectRow<CaptionBackground>
                id="u-caption-bg"
                label={t("usability.captionBackground")}
                value={settings.captionBackground}
                onChange={(captionBackground) => update({ captionBackground })}
                options={[
                  { value: "translucent", label: "Translucent box" },
                  { value: "solid", label: "Solid box" },
                  { value: "outline", label: "Outline only" },
                  { value: "none", label: "None" },
                ]}
              />
            </div>
            {settings.captionBackground === "solid" ||
            settings.captionBackground === "translucent" ? (
              <SliderRow
                id="u-caption-opacity"
                label={t("usability.captionOpacity")}
                value={settings.captionOpacity}
                min={0}
                max={100}
                step={1}
                format={(value) => `${value}%`}
                onChange={(captionOpacity) => update({ captionOpacity })}
              />
            ) : null}
            <CaptionPreview label={t("usability.captionPreview")} />
          </SectionCard>
          <SectionCard
            id="feedback"

            icon={Volume2}
            title={t("usability.feedback")}
            actions={
              <ResetButton
                label={t("common.reset")}
                onClick={() =>
                  reset(["soundEnabled", "soundVolume", "hapticsEnabled", "toastDuration"])
                }
              />
            }
            bodyClassName="space-y-4"
          >
            <ToggleRow
              id="u-sound"
              label={t("usability.sound")}
              description={t("usability.soundHint")}
              checked={settings.soundEnabled}
              onChange={(soundEnabled) => update({ soundEnabled })}
            />
            {settings.soundEnabled ? (
              <SliderRow
                id="u-volume"
                label={t("usability.soundVolume")}
                value={settings.soundVolume}
                min={0}
                max={100}
                step={1}
                format={(value) => `${value}%`}
                onChange={(soundVolume) => update({ soundVolume })}
              />
            ) : null}
            <ToggleRow
              id="u-haptics"
              label={t("usability.haptics")}
              description={t("usability.hapticsHint")}
              checked={settings.hapticsEnabled}
              onChange={(hapticsEnabled) => update({ hapticsEnabled })}
            />
            <ChoiceGroup<ToastDuration>
              name="toastDuration"
              label={t("usability.toastDuration")}
              description={t("usability.toastDurationHint")}
              value={settings.toastDuration}
              onChange={(toastDuration) => update({ toastDuration })}
              options={[
                { value: "short", label: t("usability.toast.short") },
                { value: "normal", label: t("usability.toast.normal") },
                { value: "long", label: t("usability.toast.long") },
                { value: "sticky", label: t("usability.toast.sticky") },
              ]}
            />
          </SectionCard>
          <SectionCard
            id="safety"

            icon={ShieldCheck}
            title={t("usability.safety")}
            actions={
              <ResetButton
                label={t("common.reset")}
                onClick={() =>
                  reset(["undoInsteadOfConfirm", "undoWindowSeconds", "autoSaveDrafts"])
                }
              />
            }
            bodyClassName="space-y-4"
          >
            <ToggleRow
              id="u-undo"
              label={t("usability.undoInstead")}
              description={t("usability.undoInsteadHint")}
              checked={settings.undoInsteadOfConfirm}
              onChange={(undoInsteadOfConfirm) => update({ undoInsteadOfConfirm })}
            />
            {settings.undoInsteadOfConfirm ? (
              <SliderRow
                id="u-undo-window"
                label={t("usability.undoWindow")}
                value={settings.undoWindowSeconds}
                min={3}
                max={30}
                format={(value) => `${value}s`}
                onChange={(undoWindowSeconds) => update({ undoWindowSeconds })}
              />
            ) : null}
            <ToggleRow
              id="u-drafts"
              label={t("usability.autoSaveDrafts")}
              description={t("usability.autoSaveDraftsHint")}
              checked={settings.autoSaveDrafts}
              onChange={(autoSaveDrafts) => update({ autoSaveDrafts })}
            />
          </SectionCard>
          <SectionCard
            id="navigation"

            icon={Compass}
            title={t("usability.navigation")}
            description={t("usability.navigationHint")}
            actions={
              <ResetButton
                label={t("common.reset")}
                onClick={() => reset(["focusOnRouteChange", "announceRouteChange"])}
              />
            }
            bodyClassName="space-y-4"
          >
            <ToggleRow
              id="u-focus"
              label={t("usability.focusHeading")}
              description={t("usability.focusHeadingHint")}
              checked={settings.focusOnRouteChange}
              onChange={(focusOnRouteChange) => update({ focusOnRouteChange })}
            />
            <ToggleRow
              id="u-announce"
              label={t("usability.announce")}
              description={t("usability.announceHint")}
              checked={settings.announceRouteChange}
              onChange={(announceRouteChange) => update({ announceRouteChange })}
            />
          </SectionCard>
          <SectionCard
            id="session"

            icon={Clock}
            title={t("usability.session")}
            actions={
              <ResetButton
                label={t("common.reset")}
                onClick={() => reset(["sessionTimeoutMinutes", "sessionWarningSeconds"])}
              />
            }
            bodyClassName="space-y-4"
          >
            <SelectRow
              id="u-timeout"
              label={t("usability.sessionTimeout")}
              description={t("usability.sessionTimeoutHint")}
              value={String(settings.sessionTimeoutMinutes)}
              onChange={(value) => update({ sessionTimeoutMinutes: Number(value) })}
              options={[
                { value: "0", label: t("usability.sessionTimeout.never") },
                { value: "15", label: "15 min" },
                { value: "30", label: "30 min" },
                { value: "60", label: "1 hour" },
                { value: "120", label: "2 hours" },
                { value: "480", label: "8 hours" },
              ]}
            />
            {settings.sessionTimeoutMinutes > 0 ? (
              <SliderRow
                id="u-warning"
                label={t("usability.sessionWarning")}
                value={settings.sessionWarningSeconds}
                min={15}
                max={300}
                step={5}
                format={(value) => `${value}s`}
                onChange={(sessionWarningSeconds) => update({ sessionWarningSeconds })}
              />
            ) : null}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        id="language"

        icon={Globe}
        title={t("usability.language")}
        actions={
          <ResetButton
            label={t("common.reset")}
            onClick={() =>
              reset(["language", "regionFormat", "timeZone", "firstDayOfWeek", "hourCycle"])
            }
          />
        }
        bodyClassName="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SelectRow<LanguageChoice>
            id="u-language"
            label={t("usability.languageLabel")}
            description={t("usability.languageHint")}
            value={settings.language}
            onChange={(language) => update({ language })}
            options={LANGUAGE_OPTIONS}
          />
          <SelectRow<RegionChoice>
            id="u-region"
            label={t("usability.regionLabel")}
            description={t("usability.regionHint")}
            value={settings.regionFormat}
            onChange={(regionFormat) => update({ regionFormat })}
            options={REGION_OPTIONS}
          />
          <SelectRow
            id="u-timezone"
            label={t("usability.timeZone")}
            value={settings.timeZone}
            onChange={(timeZone) => update({ timeZone })}
            options={[
              { value: "system", label: "Use device setting" },
              ...timeZoneOptions().map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") })),
            ]}
          />
          <SelectRow<FirstDayOfWeek>
            id="u-firstday"
            label={t("usability.firstDay")}
            value={settings.firstDayOfWeek}
            onChange={(firstDayOfWeek) => update({ firstDayOfWeek })}
            options={[
              { value: "region", label: t("usability.firstDay.region") },
              { value: "sunday", label: t("usability.firstDay.sunday") },
              { value: "monday", label: t("usability.firstDay.monday") },
              { value: "saturday", label: t("usability.firstDay.saturday") },
            ]}
          />
          <SelectRow<HourCycle>
            id="u-hourcycle"
            label={t("usability.hourCycle")}
            value={settings.hourCycle}
            onChange={(hourCycle) => update({ hourCycle })}
            options={[
              { value: "region", label: t("usability.hourCycle.region") },
              { value: "h12", label: t("usability.hourCycle.h12") },
              { value: "h23", label: t("usability.hourCycle.h23") },
            ]}
          />
        </div>

        {/* Regional format is the one setting whose effect is invisible on
            this page, so it gets a literal worked example. */}
        <div className="field-note px-3 py-2.5">
          <p className="label-caps">{t("usability.formatPreview")}</p>
          <p className="metric-value mt-1 text-sm">
            {sampleDate} · {sampleTime} · {sampleNumber}
          </p>
          {coverage.translated < coverage.total ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {coverage.translated} of {coverage.total} interface strings are translated for this
              language; the rest stay in English.
            </p>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard
        id="shortcuts"

        icon={Keyboard}
        title={t("usability.shortcuts")}
        description={t("usability.shortcutsHint")}
        actions={<ResetButton label={t("common.reset")} onClick={() => reset(["shortcuts"])} />}
      >
        <ShortcutEditor />
      </SectionCard>

      <div className="sheet flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-xs text-muted-foreground">{t("usability.resetSection")}</p>
        <Button size="sm" variant="secondary" onClick={() => reset()}>
          <RotateCcw className="size-3.5" aria-hidden />
          {t("common.resetAll")}
        </Button>
      </div>
    </div>
  );
}

/** Renders the live `::cue` custom properties as a sample caption. */
function CaptionPreview({ label }: { label: string }) {
  return (
    <div className="field-note bg-black/80 p-4 text-center">
      <span className="sr-only">{label}</span>
      <span
        className="inline-block rounded-sm px-2 py-1"
        style={{
          fontSize: "var(--caption-size)",
          fontFamily: "var(--caption-font)",
          color: "var(--caption-color)",
          backgroundColor: "var(--caption-background)",
          textShadow: "var(--caption-shadow)",
        }}
      >
        Shot 12 — made from the left wing
      </span>
    </div>
  );
}

/**
 * Where these settings are stored, as a strip above the grid.
 *
 * <p>It was loose text sitting on the page background, which made the
 * first thing on the tab the one thing not built like everything else.
 * Same inset-row shape as the blocks inside the cards, so it reads as
 * part of the page rather than as a leftover.
 */
function SyncBanner({ status }: { status: "local" | "adopting" | "synced" | "saving" }) {
  const t = useT();
  const { icon, message } =
    status === "synced"
      ? {
          icon: <Check className="size-3.5 text-make" aria-hidden />,
          message: t("usability.syncedToAccount"),
        }
      : status === "saving" || status === "adopting"
        ? {
            icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />,
            message: t("usability.syncPending"),
          }
        : {
            icon: <CloudOff className="size-3.5" aria-hidden />,
            message: t("usability.syncOffline"),
          };

  return (
    <p className="field-note flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      {icon}
      {message}
    </p>
  );
}
