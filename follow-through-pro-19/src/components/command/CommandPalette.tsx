import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { DialogTitle } from "@/components/ui/dialog";
import { formatCombo, type CommandGroup as Group } from "@/lib/shortcuts";
import { useCommands } from "@/state/commands";
import { useT } from "@/state/settings-provider";

const GROUP_ORDER: Group[] = ["navigate", "actions", "appearance"];

const GROUP_LABEL = {
  navigate: "palette.group.navigate",
  actions: "palette.group.actions",
  appearance: "palette.group.appearance",
} as const;

/**
 * Cmd/Ctrl+K palette.
 *
 * <p>Doubles as the discovery surface for keyboard shortcuts: each row
 * shows its current binding, so the palette teaches the shortcut rather
 * than competing with it. Commands stay searchable by their keywords as
 * well as their names, because people look for "dark" long before they
 * look for "theme".
 */
export function CommandPalette() {
  const { commands, paletteOpen, setPaletteOpen } = useCommands();
  const t = useT();

  // Opening the palette is itself a command, so hide it from its own list.
  const listed = commands.filter((command) => command.id !== "palette.open");

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogTitle className="sr-only">{t("palette.open")}</DialogTitle>
      <CommandInput placeholder={t("palette.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>
        {GROUP_ORDER.map((group) => {
          const rows = listed.filter((command) => command.group === group);
          if (rows.length === 0) return null;
          return (
            <CommandGroup key={group} heading={t(GROUP_LABEL[group])}>
              {rows.map((command) => (
                <CommandItem
                  key={command.id}
                  // cmdk matches on this string, so the keywords have to be
                  // part of it for "dark" to find the theme command.
                  value={`${t(command.titleKey)} ${command.keywords?.join(" ") ?? ""}`}
                  onSelect={() => {
                    setPaletteOpen(false);
                    command.run();
                  }}
                >
                  {t(command.titleKey)}
                  {command.combo ? (
                    <CommandShortcut>{formatCombo(command.combo)}</CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
