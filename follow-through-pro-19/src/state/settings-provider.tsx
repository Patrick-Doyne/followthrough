import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createTranslate, resolveLanguage, textDirection, type Locale } from "@/lib/i18n";
import type { Translate } from "@/lib/i18n";
import { formatConfigKey, resolveFormatConfig, setFormatConfig } from "@/lib/intl";
import { useAuth } from "@/state/auth";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  applyCaptionStyle,
  applyDocumentChrome,
  beginThemeShift,
  loadSettings,
  migrateSettings,
  resolveMotion,
  resolveTheme,
  saveSettings,
  type UsabilitySettings,
} from "@/state/settings";
import { useSettingsSync, type SyncStatus } from "@/state/settings-sync";

interface SettingsContextValue {
  settings: UsabilitySettings;
  /** Concrete theme after resolving the "system" choice. */
  resolvedTheme: "light" | "dark";
  /** True when animations should be suppressed. */
  reducedMotion: boolean;
  /** Resolved interface language. */
  locale: Locale;
  /** Translator bound to the resolved language. */
  t: Translate;
  /** Whether the document is stored locally only, or synced to the account. */
  syncStatus: SyncStatus;
  /**
   * False until the stored settings have been read on the client.
   * Components that would otherwise render server defaults into a form can
   * wait on this; the document itself is already correct from the boot
   * script.
   */
  hydrated: boolean;
  update: (patch: Partial<UsabilitySettings>) => void;
  /** Restores the given keys to their defaults, or everything if omitted. */
  reset: (keys?: (keyof UsabilitySettings)[]) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * `useLayoutEffect`, except on the server, where React warns because
 * there is no layout to read and nothing to paint.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Always start from the defaults, even on the client, so the first render
  // matches what the server produced and hydration stays clean. The stored
  // values arrive in the effect below. This is not a flash: the boot script
  // in the document head has already put the real theme, density and text
  // size on <html>, and the apply effect deliberately does not overwrite
  // that until it has the stored values in hand.
  const [settings, setSettings] = useState<UsabilitySettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  // One effect owns persistence and the DOM, so the stored value and the
  // rendered document can never disagree.
  //
  // A *layout* effect, because this is what makes a theme change land
  // all at once. Components that read `resolvedTheme` re-render in the
  // commit; the tokens they are supposed to match are written here. A
  // passive effect is allowed to run after the browser has painted, so
  // the two could land in different frames and the page would change
  // in two visible steps. A layout effect is guaranteed to run before
  // the paint that shows the commit.
  const lastPalette = useRef<string | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (!hydrated) return;
    saveSettings(settings);

    // Cross-fade only when the palette actually moved, and never on the
    // first application -- there is nothing to fade from at that point,
    // and fading in from the stylesheet's defaults would be the flash
    // the boot script exists to prevent.
    const palette = JSON.stringify([settings.themeColors, settings.theme, settings.highContrast]);
    if (lastPalette.current !== null && lastPalette.current !== palette) {
      beginThemeShift(document.documentElement);
    }
    lastPalette.current = palette;

    applyDocumentChrome(document.documentElement, settings);
    applyCaptionStyle(document.documentElement, settings);
  }, [hydrated, settings]);

  // Follow the OS while either choice is still "system". Re-running
  // applyDocumentChrome is enough because it re-resolves both on every call.
  useEffect(() => {
    if (!hydrated) return;
    if (settings.theme !== "system" && settings.motion !== "system") return;
    if (typeof matchMedia !== "function") return;

    const queries = [
      matchMedia("(prefers-color-scheme: light)"),
      matchMedia("(prefers-reduced-motion: reduce)"),
    ];
    const onChange = () => {
      applyDocumentChrome(document.documentElement, settings);
      // Bump state so consumers of resolvedTheme/reducedMotion re-render.
      setSettings((prev) => ({ ...prev }));
    };
    queries.forEach((q) => q.addEventListener("change", onChange));
    return () => queries.forEach((q) => q.removeEventListener("change", onChange));
  }, [hydrated, settings]);

  // Keep other tabs of the same app in step. The storage event only fires
  // in tabs that did not perform the write, so this cannot loop.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SETTINGS_STORAGE_KEY || event.newValue === null) return;
      try {
        setSettings(migrateSettings(JSON.parse(event.newValue)));
      } catch {
        // Another tab wrote something unreadable; keep what we have.
      }
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((patch: Partial<UsabilitySettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback((keys?: (keyof UsabilitySettings)[]) => {
    setSettings((prev) => {
      if (!keys) return { ...DEFAULT_SETTINGS };
      const next = { ...prev };
      for (const key of keys) {
        // The cast is safe because key and value come from the same record.
        (next as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key];
      }
      return next;
    });
  }, []);

  const adopt = useCallback((incoming: UsabilitySettings) => setSettings(incoming), []);
  const syncStatus = useSettingsSync({ settings, hydrated, isAuthenticated, adopt });

  const locale = useMemo(
    () => (hydrated ? resolveLanguage(settings.language) : "en"),
    [hydrated, settings.language],
  );
  const t = useMemo(() => createTranslate(locale), [locale]);

  // The document language is what a screen reader uses to pick a voice and
  // pronunciation, so it has to track the interface language rather than
  // stay at the server-rendered default.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = textDirection(locale);
  }, [locale]);

  // Regional formatting is read by ~110 plain `fmt*` calls rather than a
  // hook, so it is published to a module-level slot. Setting it during
  // render (not in an effect) guarantees it is in place before any child
  // formats anything, and the remount key below guarantees nothing keeps a
  // value formatted under the previous locale.
  const formatConfig = useMemo(() => resolveFormatConfig(settings), [settings]);
  const formatKey = formatConfigKey(formatConfig);
  setFormatConfig(formatConfig);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      resolvedTheme: hydrated ? resolveTheme(settings.theme) : "dark",
      reducedMotion: hydrated ? resolveMotion(settings.motion) === "reduce" : false,
      locale,
      t,
      syncStatus,
      hydrated,
      update,
      reset,
    }),
    [settings, hydrated, locale, t, syncStatus, update, reset],
  );

  return (
    <SettingsContext.Provider value={value}>
      {/* Remounting on a locale change is what lets every `fmt*` call site
          stay a plain function call instead of a hook. Changing region is a
          rare, deliberate action, so the cost is paid almost never. */}
      <div key={formatKey} className="contents">
        {children}
      </div>
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}

/** The translator on its own, which is what most components want. */
export function useT(): Translate {
  return useSettings().t;
}
