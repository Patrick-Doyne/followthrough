import { DEFAULT_TRIAD, THEME_TOKEN_NAMES } from "@/lib/theme";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  TEXT_SCALE_PX,
  type UsabilitySettings,
} from "@/state/settings";

/**
 * A self-contained script that applies the stored display settings to <html>
 * before the browser paints anything.
 *
 * <p>This exists because the alternative -- letting React apply the theme
 * after hydration -- means the first paint uses the wrong theme and the page
 * visibly flips. That flash is worst for exactly the people the light theme
 * is for, so it has to be fixed before first paint, which means synchronous
 * inline script in <head> and nothing else.
 *
 * <p>The logic here necessarily duplicates {@link applyDocumentChrome}, because a
 * blocking inline script cannot import a module. What is *not* duplicated is
 * the data: the storage key, the defaults, the text-scale table and the
 * theme token names are interpolated from the same constants the React code
 * uses, so the two can only drift if someone changes the resolution logic
 * itself. Any such change has to be made in both places, and the settings
 * page is the obvious place to notice if they disagree.
 *
 * <p>It also flags the logo. The mark is artwork, not CSS, so it cannot
 * be re-coloured by writing a custom property -- its pixels have to be
 * re-hued on a canvas, which cannot happen until React is running. The
 * markup the browser paints first therefore carries the artwork in its
 * shipped orange, and on a themed account that is simply the wrong
 * colour on screen for as long as the bundle takes to arrive (measured
 * at about 370ms). Setting `data-brand-tint="pending"` here lets the
 * stylesheet hold the mark back until the right colour exists; the hook
 * that produces it clears the flag. Only when the accent actually
 * differs from the shipped one, so the default theme still paints its
 * logo straight out of the server's HTML.
 *
 * <p>The three-colour theme is the reason this stayed possible. Resolving a
 * triad into a palette needs gamut mapping and contrast comparisons, none of
 * which belongs in an inline string. So the resolving happens in the app and
 * the *result* is persisted; this script only replays it. The two sides read
 * one object rather than running one algorithm twice.
 */
export function settingsBootScript(): string {
  const bootDefaults = {
    theme: DEFAULT_SETTINGS.theme,
    textScale: DEFAULT_SETTINGS.textScale,
    density: DEFAULT_SETTINGS.density,
    highContrast: DEFAULT_SETTINGS.highContrast,
    motion: DEFAULT_SETTINGS.motion,
    readingMode: DEFAULT_SETTINGS.readingMode,
  } satisfies Partial<UsabilitySettings>;

  return `(function(){try{
var r=document.documentElement,d=${JSON.stringify(bootDefaults)},s=d,k=null,a=null;
try{var v=localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)});if(v){var p=JSON.parse(v);if(p&&typeof p==='object'){s={theme:p.theme||d.theme,textScale:p.textScale||d.textScale,density:p.density||d.density,highContrast:typeof p.highContrast==='boolean'?p.highContrast:d.highContrast,motion:p.motion||d.motion,readingMode:typeof p.readingMode==='boolean'?p.readingMode:d.readingMode};k=p.themeTokens||null;a=(p.themeColors&&p.themeColors.accent)||null}}}catch(e){}
var m=function(q){return typeof matchMedia==='function'&&matchMedia(q).matches};
var t=s.theme==='system'?(m('(prefers-color-scheme: light)')?'light':'dark'):s.theme;
if(t!=='light'&&t!=='dark'){t='dark'}
r.classList.toggle('dark',t==='dark');r.classList.toggle('light',t==='light');r.style.colorScheme=t;
r.dataset.density=s.density;r.dataset.contrast=s.highContrast?'high':'normal';
r.dataset.motion=s.motion==='system'?(m('(prefers-reduced-motion: reduce)')?'reduce':'full'):s.motion;
r.dataset.reading=s.readingMode?'on':'off';
var pk=(t==='dark'?'dark':'light')+(s.highContrast?'High':'');
var kt=k&&k[pk]||null,nm=${JSON.stringify(THEME_TOKEN_NAMES)};
for(var i=0;i<nm.length;i++){var vv=kt&&kt[nm[i]];if(vv){r.style.setProperty('--'+nm[i],vv)}else{r.style.removeProperty('--'+nm[i])}}
var f=${JSON.stringify(TEXT_SCALE_PX)}[s.textScale];if(f){r.style.fontSize=f+'px'}
if(a&&a!==${JSON.stringify(DEFAULT_TRIAD.accent)}){r.dataset.brandTint='pending'}
}catch(e){}})();`;
}
