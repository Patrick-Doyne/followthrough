/**
 * Interface language.
 *
 * <p>Separate from regional format (intl.ts) by design: this decides what
 * language the words are in, that decides how dates and numbers are
 * written. People routinely want them to differ, and a single "locale"
 * setting cannot express that.
 *
 * <p>English is the source of truth. Its catalogue defines {@link MessageKey},
 * so adding a key without adding it to English is a type error, while a
 * translation that is missing a key simply falls back to the English string
 * rather than rendering a raw key at someone. That is the right failure
 * mode for a product shipping translations incrementally.
 *
 * <p>Coverage is honest rather than total: the navigation shell, page
 * headings, shared states and the whole settings surface are translated.
 * Analytics copy and domain terminology are not yet, and fall back to
 * English. Extending coverage is mechanical -- move a literal into the
 * catalogue and call `t()` -- and needs no further infrastructure.
 */

import type { LanguageChoice } from "@/state/settings";

const en = {
  // -- Navigation ------------------------------------------------------
  "nav.dashboard": "Dashboard",
  "nav.live": "Live Training",
  "nav.analytics": "Analytics",
  "nav.videos": "Video Gallery",
  "nav.calendar": "Training Calendar",
  "nav.settings": "Settings",
  "nav.primary": "Primary",
  "nav.open": "Open navigation",
  "nav.home": "FollowThrough home",
  "nav.skipToContent": "Skip to main content",
  "nav.plan": "Plan",
  "nav.account": "Account menu",
  "nav.profile": "Profile",
  "nav.accountSettings": "Account settings",
  "nav.signOut": "Sign out",

  // -- Shared states and actions ---------------------------------------
  "common.loading": "Loading…",
  "common.checkingSession": "Checking your session…",
  "common.retry": "Try again",
  "common.cancel": "Cancel",
  "common.save": "Save changes",
  "common.saved": "Saved",
  "common.delete": "Delete",
  "common.undo": "Undo",
  "common.close": "Close",
  "common.reset": "Reset",
  "common.resetAll": "Reset all",
  "common.search": "Search",
  "common.noResults": "No results",

  // -- Settings page ----------------------------------------------------
  "settings.title": "Settings",
  "settings.description": "Account, analytics defaults, notifications and plan.",
  "settings.tab.profile": "Profile",
  "settings.tab.preferences": "Preferences",
  "settings.tab.usability": "Usability",
  "settings.tab.notifications": "Notifications",
  "settings.tab.subscription": "Subscription",
  "settings.searchPlaceholder": "Search settings…",
  "settings.searchLabel": "Search all settings",
  "settings.loadError": "Your settings didn't load",
  "settings.loadErrorBody": "Check your connection, then try again.",

  // -- Usability tab ----------------------------------------------------
  "usability.appearance": "Appearance",
  "usability.appearanceHint": "Applies immediately, and is remembered on this device.",
  "usability.theme": "Theme",
  "usability.theme.light": "Light",
  "usability.theme.dark": "Dark",
  "usability.theme.system": "System",
  "usability.themeFollowing": "Following your system setting, currently {theme}.",
  "usability.highContrast": "High contrast",
  "usability.highContrastHint":
    "Stronger borders, brighter secondary text and a heavier focus ring.",
  "usability.readingMode": "Reading mode",
  "usability.readingModeHint": "Hides the sidebar and narrows body text to a comfortable measure.",

  "usability.textAndSpacing": "Text and spacing",
  "usability.textAndSpacingHint":
    "Everything is sized in relative units, so the whole layout reflows together.",
  "usability.textSize": "Text size",
  "usability.textSize.base": "Default",
  "usability.textSize.large": "Large",
  "usability.textSize.larger": "Larger",
  "usability.textSize.largest": "Largest",
  "usability.density": "Density",
  "usability.densityHint": "How much breathing room panels, tables and controls get.",
  "usability.density.compact": "Compact",
  "usability.density.comfortable": "Comfortable",
  "usability.density.spacious": "Spacious",

  "usability.motionAndMedia": "Motion and media",
  "usability.motion": "Animation",
  "usability.motion.full": "Full",
  "usability.motion.reduce": "Reduced",
  "usability.motion.system": "System",
  "usability.motionFollowing": "Following your system setting, currently {motion}.",
  "usability.autoplay": "Autoplay video",
  "usability.autoplayHint": "When off, session and gallery videos wait for you to press play.",

  "usability.captions": "Captions",
  "usability.captionsHint": "Styling applies to every video in the app.",
  "usability.captionsEnabled": "Show captions by default",
  "usability.captionSize": "Size",
  "usability.captionFont": "Font",
  "usability.captionColor": "Text colour",
  "usability.captionBackground": "Background",
  "usability.captionOpacity": "Background opacity",
  "usability.captionPreview": "Preview caption text",

  "usability.feedback": "Sound and haptics",
  "usability.sound": "Sound effects",
  "usability.soundHint": "A short tone when a shot lands or a job finishes.",
  "usability.soundVolume": "Volume",
  "usability.haptics": "Vibration",
  "usability.hapticsHint": "Brief vibration on supported devices. Ignored elsewhere.",
  "usability.toastDuration": "Notification duration",
  "usability.toastDurationHint": "How long a toast stays on screen before dismissing itself.",
  "usability.toast.short": "Short",
  "usability.toast.normal": "Normal",
  "usability.toast.long": "Long",
  "usability.toast.sticky": "Until dismissed",

  "usability.safety": "Confirmations",
  "usability.undoInstead": "Use undo instead of confirmation dialogs",
  "usability.undoInsteadHint":
    "Destructive actions happen right away with a window to undo them, rather than asking first.",
  "usability.undoWindow": "Undo window",
  "usability.autoSaveDrafts": "Auto-save drafts",
  "usability.autoSaveDraftsHint": "Keeps what you typed in a form if you navigate away or reload.",

  "usability.navigation": "Navigation",
  "usability.navigationHint": "How the app behaves when you move between pages.",
  "usability.focusHeading": "Move focus to the page heading",
  "usability.focusHeadingHint":
    "Keeps the keyboard in step with the page instead of leaving focus on the link you just used.",
  "usability.announce": "Announce page changes",
  "usability.announceHint":
    "Reads the new page name through a live region. Turn this off if your screen reader already does it.",

  "usability.session": "Session",
  "usability.sessionTimeout": "Sign out after inactivity",
  "usability.sessionTimeoutHint": "A warning appears before you are signed out.",
  "usability.sessionTimeout.never": "Never",
  "usability.sessionWarning": "Warn before signing out",
  "usability.sessionExpiring": "Your session is about to expire",
  "usability.sessionExpiringBody": "You'll be signed out in {seconds} seconds.",
  "usability.staySignedIn": "Stay signed in",

  "usability.language": "Language and region",
  "usability.languageLabel": "Interface language",
  "usability.languageHint": "Untranslated text stays in English.",
  "usability.regionLabel": "Regional format",
  "usability.regionHint": "Dates, times and numbers. Independent of the interface language.",
  "usability.timeZone": "Time zone",
  "usability.firstDay": "First day of the week",
  "usability.firstDay.region": "Use region default",
  "usability.firstDay.sunday": "Sunday",
  "usability.firstDay.monday": "Monday",
  "usability.firstDay.saturday": "Saturday",
  "usability.hourCycle": "Clock",
  "usability.hourCycle.region": "Use region default",
  "usability.hourCycle.h12": "12-hour",
  "usability.hourCycle.h23": "24-hour",
  "usability.formatPreview": "Preview",

  "usability.shortcuts": "Keyboard shortcuts",
  "usability.shortcutsHint": "Click a shortcut to record a new key combination.",
  "usability.shortcutRecording": "Press keys…",
  "usability.shortcutConflict": "Already used by {command}",
  "usability.shortcutReset": "Reset to default",

  "usability.resetSection": "Restore every setting on this tab to its default.",
  "usability.syncedToAccount": "Synced to your account",
  "usability.syncPending": "Saving to your account…",
  "usability.syncOffline": "Saved on this device only",

  // -- Notification delivery --------------------------------------------
  "notifications.delivery": "Delivery",
  "notifications.quietHours": "Quiet hours",
  "notifications.quietHoursHint": "Notifications are held silently during this window.",
  "notifications.quietFrom": "From",
  "notifications.quietTo": "To",
  "notifications.snooze": "Snooze all",
  "notifications.snoozedUntil": "Snoozed until {time}",
  "notifications.resume": "Resume notifications",
  "notifications.digest": "Digest frequency",
  "notifications.digest.off": "Off",
  "notifications.digest.daily": "Daily",
  "notifications.digest.weekly": "Weekly",
  "notifications.digest.monthly": "Monthly",
  "notifications.history": "Recent notifications",
  "notifications.historyEmpty": "Nothing yet.",
  "notifications.historyLimit": "History length",
  "notifications.clearHistory": "Clear history",
  "notifications.open": "Notifications",

  // -- Command palette ---------------------------------------------------
  "palette.placeholder": "Type a command or search…",
  "palette.empty": "No matching commands.",
  "palette.group.navigate": "Go to",
  "palette.group.actions": "Actions",
  "palette.group.appearance": "Appearance",
  "palette.open": "Open command palette",
  "shots.markMade": "Mark the selected shot as made",
  "shots.markMissed": "Mark the selected shot as missed",
  "shots.markNotAShot": "Remove the selected shot",
} as const;

export type MessageKey = keyof typeof en;
export type Locale = "en" | "es" | "fr" | "de";

/** Locales other than English translate what they can and inherit the rest. */
type Catalogue = Partial<Record<MessageKey, string>>;

const es: Catalogue = {
  "nav.dashboard": "Panel",
  "nav.live": "Entrenamiento en vivo",
  "nav.analytics": "Analíticas",
  "nav.videos": "Galería de vídeos",
  "nav.calendar": "Calendario de entrenamiento",
  "nav.settings": "Ajustes",
  "nav.primary": "Principal",
  "nav.open": "Abrir navegación",
  "nav.home": "Inicio de FollowThrough",
  "nav.skipToContent": "Saltar al contenido principal",
  "nav.plan": "Plan",
  "nav.account": "Menú de cuenta",
  "nav.profile": "Perfil",
  "nav.accountSettings": "Ajustes de la cuenta",
  "nav.signOut": "Cerrar sesión",

  "common.loading": "Cargando…",
  "common.checkingSession": "Comprobando tu sesión…",
  "common.retry": "Reintentar",
  "common.cancel": "Cancelar",
  "common.save": "Guardar cambios",
  "common.saved": "Guardado",
  "common.delete": "Eliminar",
  "common.undo": "Deshacer",
  "common.close": "Cerrar",
  "common.reset": "Restablecer",
  "common.resetAll": "Restablecer todo",
  "common.search": "Buscar",
  "common.noResults": "Sin resultados",

  "settings.title": "Ajustes",
  "settings.description": "Cuenta, valores de analíticas, notificaciones y plan.",
  "settings.tab.profile": "Perfil",
  "settings.tab.preferences": "Preferencias",
  "settings.tab.usability": "Usabilidad",
  "settings.tab.notifications": "Notificaciones",
  "settings.tab.subscription": "Suscripción",
  "settings.searchPlaceholder": "Buscar ajustes…",
  "settings.searchLabel": "Buscar en todos los ajustes",
  "settings.loadError": "No se cargaron tus ajustes",
  "settings.loadErrorBody": "Comprueba tu conexión y vuelve a intentarlo.",

  "usability.appearance": "Apariencia",
  "usability.appearanceHint": "Se aplica al instante y se recuerda en este dispositivo.",
  "usability.theme": "Tema",
  "usability.theme.light": "Claro",
  "usability.theme.dark": "Oscuro",
  "usability.theme.system": "Sistema",
  "usability.themeFollowing": "Siguiendo tu sistema, ahora mismo {theme}.",
  "usability.highContrast": "Alto contraste",
  "usability.highContrastHint":
    "Bordes más marcados, texto secundario más claro y un foco más visible.",
  "usability.readingMode": "Modo lectura",
  "usability.readingModeHint": "Oculta la barra lateral y estrecha el texto a una medida cómoda.",

  "usability.textAndSpacing": "Texto y espaciado",
  "usability.textSize": "Tamaño del texto",
  "usability.textSize.base": "Predeterminado",
  "usability.textSize.large": "Grande",
  "usability.textSize.larger": "Más grande",
  "usability.textSize.largest": "Máximo",
  "usability.density": "Densidad",
  "usability.density.compact": "Compacta",
  "usability.density.comfortable": "Cómoda",
  "usability.density.spacious": "Amplia",

  "usability.motionAndMedia": "Movimiento y multimedia",
  "usability.motion": "Animación",
  "usability.motion.full": "Completa",
  "usability.motion.reduce": "Reducida",
  "usability.motion.system": "Sistema",
  "usability.autoplay": "Reproducción automática",

  "usability.captions": "Subtítulos",
  "usability.captionsEnabled": "Mostrar subtítulos por defecto",
  "usability.captionSize": "Tamaño",
  "usability.captionFont": "Fuente",
  "usability.captionColor": "Color del texto",
  "usability.captionBackground": "Fondo",
  "usability.captionOpacity": "Opacidad del fondo",

  "usability.feedback": "Sonido y vibración",
  "usability.sound": "Efectos de sonido",
  "usability.soundVolume": "Volumen",
  "usability.haptics": "Vibración",
  "usability.toastDuration": "Duración de las notificaciones",
  "usability.toast.short": "Corta",
  "usability.toast.normal": "Normal",
  "usability.toast.long": "Larga",
  "usability.toast.sticky": "Hasta descartarla",

  "usability.safety": "Confirmaciones",
  "usability.undoInstead": "Usar deshacer en lugar de diálogos de confirmación",
  "usability.undoWindow": "Ventana para deshacer",
  "usability.autoSaveDrafts": "Guardar borradores automáticamente",

  "usability.navigation": "Navegación",
  "usability.focusHeading": "Mover el foco al título de la página",
  "usability.announce": "Anunciar los cambios de página",

  "usability.session": "Sesión",
  "usability.sessionTimeout": "Cerrar sesión por inactividad",
  "usability.sessionTimeout.never": "Nunca",
  "usability.sessionExpiring": "Tu sesión está a punto de caducar",
  "usability.sessionExpiringBody": "Se cerrará la sesión en {seconds} segundos.",
  "usability.staySignedIn": "Seguir conectado",

  "usability.language": "Idioma y región",
  "usability.languageLabel": "Idioma de la interfaz",
  "usability.languageHint": "El texto sin traducir permanece en inglés.",
  "usability.regionLabel": "Formato regional",
  "usability.regionHint": "Fechas, horas y números. Independiente del idioma.",
  "usability.timeZone": "Zona horaria",
  "usability.firstDay": "Primer día de la semana",
  "usability.firstDay.region": "Usar el de la región",
  "usability.firstDay.sunday": "Domingo",
  "usability.firstDay.monday": "Lunes",
  "usability.firstDay.saturday": "Sábado",
  "usability.hourCycle": "Reloj",
  "usability.hourCycle.region": "Usar el de la región",
  "usability.hourCycle.h12": "12 horas",
  "usability.hourCycle.h23": "24 horas",
  "usability.formatPreview": "Vista previa",

  "usability.shortcuts": "Atajos de teclado",
  "usability.shortcutRecording": "Pulsa las teclas…",
  "usability.shortcutReset": "Restablecer",

  "notifications.delivery": "Entrega",
  "notifications.quietHours": "Horas de silencio",
  "notifications.quietFrom": "Desde",
  "notifications.quietTo": "Hasta",
  "notifications.snooze": "Posponer todo",
  "notifications.resume": "Reanudar notificaciones",
  "notifications.digest": "Frecuencia del resumen",
  "notifications.digest.off": "Desactivado",
  "notifications.digest.daily": "Diario",
  "notifications.digest.weekly": "Semanal",
  "notifications.digest.monthly": "Mensual",
  "notifications.history": "Notificaciones recientes",
  "notifications.historyEmpty": "Nada todavía.",
  "notifications.clearHistory": "Borrar historial",
  "notifications.open": "Notificaciones",

  "palette.placeholder": "Escribe un comando o busca…",
  "palette.empty": "Ningún comando coincide.",
  "palette.group.navigate": "Ir a",
  "palette.group.actions": "Acciones",
  "palette.group.appearance": "Apariencia",
  "palette.open": "Abrir la paleta de comandos",
};

const fr: Catalogue = {
  "nav.dashboard": "Tableau de bord",
  "nav.live": "Entraînement en direct",
  "nav.analytics": "Analyses",
  "nav.videos": "Galerie vidéo",
  "nav.calendar": "Calendrier d'entraînement",
  "nav.settings": "Paramètres",
  "nav.skipToContent": "Aller au contenu principal",
  "nav.signOut": "Se déconnecter",
  "nav.profile": "Profil",
  "nav.account": "Menu du compte",

  "common.loading": "Chargement…",
  "common.checkingSession": "Vérification de votre session…",
  "common.retry": "Réessayer",
  "common.cancel": "Annuler",
  "common.save": "Enregistrer",
  "common.saved": "Enregistré",
  "common.delete": "Supprimer",
  "common.undo": "Annuler",
  "common.reset": "Réinitialiser",
  "common.resetAll": "Tout réinitialiser",
  "common.search": "Rechercher",

  "settings.title": "Paramètres",
  "settings.tab.profile": "Profil",
  "settings.tab.preferences": "Préférences",
  "settings.tab.usability": "Accessibilité",
  "settings.tab.notifications": "Notifications",
  "settings.tab.subscription": "Abonnement",
  "settings.searchPlaceholder": "Rechercher un paramètre…",

  "usability.appearance": "Apparence",
  "usability.theme": "Thème",
  "usability.theme.light": "Clair",
  "usability.theme.dark": "Sombre",
  "usability.theme.system": "Système",
  "usability.highContrast": "Contraste élevé",
  "usability.readingMode": "Mode lecture",
  "usability.textSize": "Taille du texte",
  "usability.density": "Densité",
  "usability.density.compact": "Compacte",
  "usability.density.comfortable": "Confortable",
  "usability.density.spacious": "Spacieuse",
  "usability.motion": "Animations",
  "usability.motion.full": "Complètes",
  "usability.motion.reduce": "Réduites",
  "usability.motion.system": "Système",
  "usability.captions": "Sous-titres",
  "usability.language": "Langue et région",
  "usability.languageLabel": "Langue de l'interface",
  "usability.regionLabel": "Format régional",
  "usability.timeZone": "Fuseau horaire",
  "usability.shortcuts": "Raccourcis clavier",

  "palette.placeholder": "Tapez une commande ou recherchez…",
  "palette.group.navigate": "Aller à",
  "palette.group.actions": "Actions",
};

const de: Catalogue = {
  "nav.dashboard": "Übersicht",
  "nav.live": "Live-Training",
  "nav.analytics": "Analysen",
  "nav.videos": "Videogalerie",
  "nav.calendar": "Trainingskalender",
  "nav.settings": "Einstellungen",
  "nav.skipToContent": "Zum Hauptinhalt springen",
  "nav.signOut": "Abmelden",
  "nav.profile": "Profil",
  "nav.account": "Kontomenü",

  "common.loading": "Wird geladen…",
  "common.checkingSession": "Sitzung wird geprüft…",
  "common.retry": "Erneut versuchen",
  "common.cancel": "Abbrechen",
  "common.save": "Änderungen speichern",
  "common.saved": "Gespeichert",
  "common.delete": "Löschen",
  "common.undo": "Rückgängig",
  "common.reset": "Zurücksetzen",
  "common.resetAll": "Alles zurücksetzen",
  "common.search": "Suchen",

  "settings.title": "Einstellungen",
  "settings.tab.profile": "Profil",
  "settings.tab.preferences": "Voreinstellungen",
  "settings.tab.usability": "Bedienbarkeit",
  "settings.tab.notifications": "Benachrichtigungen",
  "settings.tab.subscription": "Abonnement",
  "settings.searchPlaceholder": "Einstellungen durchsuchen…",

  "usability.appearance": "Darstellung",
  "usability.theme": "Design",
  "usability.theme.light": "Hell",
  "usability.theme.dark": "Dunkel",
  "usability.theme.system": "System",
  "usability.highContrast": "Hoher Kontrast",
  "usability.readingMode": "Lesemodus",
  "usability.textSize": "Textgröße",
  "usability.density": "Dichte",
  "usability.density.compact": "Kompakt",
  "usability.density.comfortable": "Normal",
  "usability.density.spacious": "Weit",
  "usability.motion": "Animationen",
  "usability.motion.full": "Vollständig",
  "usability.motion.reduce": "Reduziert",
  "usability.motion.system": "System",
  "usability.captions": "Untertitel",
  "usability.language": "Sprache und Region",
  "usability.languageLabel": "Sprache der Oberfläche",
  "usability.regionLabel": "Regionsformat",
  "usability.timeZone": "Zeitzone",
  "usability.shortcuts": "Tastenkürzel",

  "palette.placeholder": "Befehl eingeben oder suchen…",
  "palette.group.navigate": "Gehe zu",
  "palette.group.actions": "Aktionen",
};

const CATALOGUES: Record<Locale, Catalogue> = { en, es, fr, de };

export const LANGUAGE_OPTIONS: { value: LanguageChoice; label: string }[] = [
  { value: "system", label: "Use browser setting" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

const SUPPORTED: Locale[] = ["en", "es", "fr", "de"];

/**
 * Picks the best supported language for a "system" choice, walking the
 * browser's ordered preference list and matching on the base language so
 * that `es-419` or `de-AT` still resolve.
 */
export function resolveLanguage(choice: LanguageChoice): Locale {
  if (choice !== "system") return choice;
  if (typeof navigator === "undefined") return "en";
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const base = tag?.split("-")[0]?.toLowerCase();
    const match = SUPPORTED.find((locale) => locale === base);
    if (match) return match;
  }
  return "en";
}

/** Right-to-left languages need `dir` on the root element. None yet. */
export function textDirection(_locale: Locale): "ltr" | "rtl" {
  return "ltr";
}

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * Builds the lookup for one language. Interpolation is a deliberate
 * `{name}` placeholder rather than a full ICU implementation: the catalogue
 * has no plural or gender cases yet, and pulling in an ICU runtime for
 * simple substitution would cost more than it returns. A key needing real
 * plural rules should use `Intl.PluralRules` at its call site.
 */
export function createTranslate(locale: Locale): Translate {
  const catalogue = CATALOGUES[locale];
  return (key, values) => {
    const template = catalogue[key] ?? en[key];
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
  };
}

/** Untranslated-key count per language, for the settings page to be honest
 * about coverage rather than implying every string is translated. */
export function translationCoverage(locale: Locale): { translated: number; total: number } {
  const total = Object.keys(en).length;
  if (locale === "en") return { translated: total, total };
  return { translated: Object.keys(CATALOGUES[locale]).length, total };
}
