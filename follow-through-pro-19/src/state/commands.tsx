/**
 * Binds the command registry to things that actually happen, and listens
 * for the keyboard.
 *
 * <p>Every command is reachable two ways from one definition: a key
 * binding, and the command palette. That matters because a shortcut nobody
 * can discover is not a feature -- the palette is how people find out the
 * shortcut exists, which is why it shows each command's current binding.
 */

import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CommandPalette } from "@/components/command/CommandPalette";
import {
  COMMANDS,
  eventCombo,
  isTypingTarget,
  resolveBindings,
  type CommandDef,
} from "@/lib/shortcuts";
import { useNotifications } from "@/state/notifications";
import { useSettings } from "@/state/settings-provider";
import type { TextScale } from "@/state/settings";

export interface BoundCommand extends CommandDef {
  /** Current binding, or null when unbound. */
  combo: string | null;
  run: () => void;
}

interface CommandsContextValue {
  /** Only commands that something can actually perform right now. */
  commands: BoundCommand[];
  run: (id: string) => void;
  bindings: Map<string, string>;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** Opens the notification centre. Owned here because the shortcut and
   * the palette both need it, and the header hosts the panel. */
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;
  /**
   * Lets a screen claim a command while it is mounted.
   *
   * <p>Some commands only mean something somewhere — correcting a shot
   * needs the live screen's selection. Without this they would sit in the
   * palette doing nothing, and worse, the global key listener would
   * swallow their keystroke everywhere in the app.
   *
   * @returns an unregister function; call it on unmount.
   */
  registerCommand: (id: string, handler: () => void) => () => void;
}

const CommandsContext = createContext<CommandsContextValue | null>(null);

const TEXT_SCALES: TextScale[] = ["base", "large", "larger", "largest"];

export function CommandsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  const { snooze, isQuiet } = useNotifications();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // A counter rather than storing handlers in state: the map is read from a
  // ref by the key listener, and only the derived command list needs to
  // re-render when it changes.
  const dynamicHandlers = useRef(new Map<string, () => void>());
  const [dynamicVersion, setDynamicVersion] = useState(0);

  const registerCommand = useCallback((id: string, handler: () => void) => {
    dynamicHandlers.current.set(id, handler);
    setDynamicVersion((v) => v + 1);
    return () => {
      dynamicHandlers.current.delete(id);
      setDynamicVersion((v) => v + 1);
    };
  }, []);

  const handlers = useMemo<Record<string, () => void>>(() => {
    const step = (direction: 1 | -1) => {
      const index = TEXT_SCALES.indexOf(settings.textScale);
      const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, index + direction))];
      if (next) update({ textScale: next });
    };

    return {
      "palette.open": () => setPaletteOpen(true),

      "nav.dashboard": () => void navigate({ to: "/" }),
      "nav.live": () => void navigate({ to: "/live" }),
      "nav.analytics": () => void navigate({ to: "/analytics" }),
      "nav.videos": () => void navigate({ to: "/videos" }),
      "nav.calendar": () => void navigate({ to: "/calendar" }),
      "nav.settings": () => void navigate({ to: "/settings", search: { tab: "usability" } }),

      "appearance.toggleTheme": () => {
        // Cycles through the three states rather than flipping two, so the
        // "follow my system" option stays reachable from the keyboard.
        const order = { system: "light", light: "dark", dark: "system" } as const;
        update({ theme: order[settings.theme] });
      },
      "appearance.toggleContrast": () => update({ highContrast: !settings.highContrast }),
      "appearance.toggleReading": () => update({ readingMode: !settings.readingMode }),
      "appearance.textLarger": () => step(1),
      "appearance.textSmaller": () => step(-1),

      "notifications.open": () => setNotificationsOpen(true),
      "notifications.snooze": () => snooze(isQuiet ? null : 60),
    };
  }, [navigate, settings, update, snooze, isQuiet]);

  const bindings = useMemo(() => resolveBindings(settings.shortcuts), [settings.shortcuts]);

  const run = useCallback(
    (id: string) => {
      const dynamic = dynamicHandlers.current.get(id);
      if (dynamic) {
        dynamic();
        return;
      }
      handlers[id]?.();
    },
    [handlers],
  );

  /** True when something can perform this command right now. */
  const isRunnable = useCallback(
    (id: string) => id in handlers || dynamicHandlers.current.has(id),
    [handlers],
  );

  const commands = useMemo<BoundCommand[]>(
    () =>
      COMMANDS.filter((command) => isRunnable(command.id)).map((command) => ({
        ...command,
        combo: bindings.get(command.id) ?? null,
        run: () => run(command.id),
      })),
    // dynamicVersion is the signal that a screen claimed or released a
    // command; isRunnable reads the ref, so it is not enough on its own.
    [bindings, run, isRunnable, dynamicVersion],
  );

  // Read through a ref so the listener can be attached once instead of
  // being torn down and re-attached on every settings change.
  const latest = useRef({ bindings, run, isRunnable });
  latest.current = { bindings, run, isRunnable };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const combo = eventCombo(event);
      if (!combo) return;

      for (const [id, bound] of latest.current.bindings) {
        if (bound !== combo) continue;
        // Nothing can perform it here, so leave the keystroke alone rather
        // than swallowing it. This is what keeps "m" usable as a plain
        // letter everywhere except the screen that claims it.
        if (!latest.current.isRunnable(id)) continue;
        // The palette must be reachable from inside a search field -- that
        // is the whole point of it. Everything else yields to typing.
        if (id !== "palette.open" && isTypingTarget(event.target)) return;
        event.preventDefault();
        latest.current.run(id);
        return;
      }
    };

    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<CommandsContextValue>(
    () => ({
      commands,
      run,
      bindings,
      paletteOpen,
      setPaletteOpen,
      notificationsOpen,
      setNotificationsOpen,
      registerCommand,
    }),
    [commands, run, bindings, paletteOpen, notificationsOpen, registerCommand],
  );

  return (
    <CommandsContext.Provider value={value}>
      {children}
      <CommandPalette />
    </CommandsContext.Provider>
  );
}

export function useCommands(): CommandsContextValue {
  const ctx = useContext(CommandsContext);
  if (!ctx) throw new Error("useCommands must be used within a CommandsProvider");
  return ctx;
}
